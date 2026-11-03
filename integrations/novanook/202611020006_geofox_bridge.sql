-- NovaNook -> GEOFOX APPS LLC operations bridge, version 1.
-- Apply in the NOVANOOK database only, after its 202611020005 migration.
-- Additive: no customer data is rewritten, removed, or made public.
-- The Geofox server must authenticate staff and check capabilities before RPCs.
begin;
set local lock_timeout = '3s';

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'booknook_profiles','booknook_entitlements','booknook_plan_testers',
    'booknook_library_books','booknook_user_data','booknook_search_usage',
    'booknook_age_eligibility','booknook_policy_acceptance_history',
    'isbndb_request_budget','booknook_safety_reports','booknook_content_holds',
    'booknook_moderation_actions','booknook_moderators',
    'booknook_safety_alert_outbox','booknook_deletion_requests'
  ] loop
    if to_regclass('public.' || relation_name) is null then
      raise exception 'Geofox bridge prerequisite missing: %. Apply NovaNook migrations through 202611020005 first.', relation_name;
    end if;
  end loop;
  if to_regprocedure('public.booknook_moderator_account_eligible(uuid)') is null then
    raise exception 'Geofox bridge requires the NovaNook moderator-management migration.';
  end if;
end $$;

-- An explicit cross-project identity link preserves NovaNook's existing
-- moderator eligibility and self-review protection. This grants no membership.
create table if not exists public.booknook_geofox_staff_links (
  hub_user_id uuid primary key,
  novanook_user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now()
);
comment on table public.booknook_geofox_staff_links is
  'Operator-maintained mapping of a verified Geofox staff account to its NovaNook account; does not itself grant moderator rights.';

create table if not exists public.booknook_geofox_audit (
  id uuid primary key default gen_random_uuid(),
  hub_actor_id uuid not null,
  novanook_actor_id uuid references auth.users(id) on delete set null,
  report_id bigint references public.booknook_safety_reports(id) on delete set null,
  moderation_action_id bigint references public.booknook_moderation_actions(id) on delete set null,
  action text not null check (action in ('review','resolve','hide','restore','restrict','unrestrict')),
  note text not null check (length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now()
);
comment on table public.booknook_geofox_audit is
  'Durable cross-project staff attribution. No tokens, customer libraries, raw payment events or dates of birth.';

alter table public.booknook_geofox_staff_links enable row level security;
alter table public.booknook_geofox_audit enable row level security;
revoke all on public.booknook_geofox_staff_links, public.booknook_geofox_audit from public, anon, authenticated;
grant all on public.booknook_geofox_staff_links to service_role;
grant select, insert on public.booknook_geofox_audit to service_role;
create index if not exists booknook_geofox_audit_created on public.booknook_geofox_audit(created_at desc);
create index if not exists booknook_geofox_actions_report on public.booknook_moderation_actions(report_id, id desc);

create or replace function public.booknook_geofox_require_service()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Geofox server credentials required' using errcode = '42501';
  end if;
end $$;
revoke all on function public.booknook_geofox_require_service() from public, anon, authenticated, service_role;

-- Aggregate reading usage without returning titles, ISBNs, notes, or journals.
-- Mirrors book-details.js sessions/sessionSeconds validation; never exports logs.
create or replace function public.booknook_geofox_reading_totals(p_data jsonb)
returns table(session_count bigint, seconds_total numeric)
language plpgsql immutable security invoker set search_path = '' as $$
declare entry jsonb; session_day date; seconds_value numeric;
begin
  session_count := 0;
  seconds_total := 0;
  for entry in select value from jsonb_array_elements(
    case when jsonb_typeof(p_data->'readingLog') = 'array' then p_data->'readingLog' else '[]'::jsonb end
  ) loop
    if jsonb_typeof(entry->'date') is distinct from 'string'
      or jsonb_typeof(entry->'pages') is distinct from 'number'
      or jsonb_typeof(entry->'from') is distinct from 'number'
      or jsonb_typeof(entry->'minutes') is distinct from 'number' then continue; end if;
    if entry->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (entry->>'pages')::numeric < 0 or (entry->>'from')::numeric < 0
      or (entry->>'pages')::numeric <> trunc((entry->>'pages')::numeric)
      or (entry->>'from')::numeric <> trunc((entry->>'from')::numeric)
      or (entry->>'pages')::numeric > 1.7976931348623157e308
      or (entry->>'from')::numeric > 1.7976931348623157e308
      or (entry->>'minutes')::numeric not between 0 and 1.7976931348623157e308 then continue; end if;
    begin
      session_day := (entry->>'date')::date;
    exception when others then continue;
    end;
    if to_char(session_day, 'YYYY-MM-DD') <> entry->>'date' then continue; end if;
    seconds_value := round((entry->>'minutes')::numeric * 60);
    if jsonb_typeof(entry->'seconds') = 'number' then
      if (entry->>'seconds')::numeric between 0 and 1.7976931348623157e308
        and (entry->>'seconds')::numeric = trunc((entry->>'seconds')::numeric) then
        seconds_value := (entry->>'seconds')::numeric;
      end if;
    end if;
    session_count := session_count + 1;
    seconds_total := seconds_total + seconds_value;
  end loop;
  return next;
end $$;
revoke all on function public.booknook_geofox_reading_totals(jsonb) from public, anon, authenticated, service_role;

create or replace function public.booknook_geofox_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  start_day date;
  users_json jsonb;
  usage_json jsonb;
  operations_json jsonb;
  signups_json jsonb;
begin
  perform public.booknook_geofox_require_service();
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'Choose 1 to 90 days' using errcode = '22023';
  end if;
  start_day := today - (p_days - 1);
  with accounts as (
    select u.id, u.created_at, u.last_sign_in_at,
      case when a.user_id is null then 'unknown'
        when public.booknook_is_adult(u.id) then 'adult' else 'teen' end as age_band,
      coalesce(e.plan = 'pro' and (e.pro_expires_at is null or e.pro_expires_at > now()), false) as pro
    from auth.users u
    left join public.booknook_age_eligibility a on a.user_id = u.id
    left join public.booknook_entitlements e on e.user_id = u.id
    where u.deleted_at is null
  ) select jsonb_build_object(
    'total', count(*), 'free', count(*) filter (where not pro), 'pro', count(*) filter (where pro),
    'adultFree', count(*) filter (where age_band = 'adult' and not pro),
    'adultPro', count(*) filter (where age_band = 'adult' and pro),
    'teenFree', count(*) filter (where age_band = 'teen' and not pro),
    'teenPro', count(*) filter (where age_band = 'teen' and pro),
    'unknownAgeFree', count(*) filter (where age_band = 'unknown' and not pro),
    'unknownAgePro', count(*) filter (where age_band = 'unknown' and pro),
    'newInPeriod', count(*) filter (where created_at >= start_day::timestamp at time zone 'UTC'),
    'activeInPeriod', count(*) filter (where last_sign_in_at >= start_day::timestamp at time zone 'UTC')
  ) into users_json from accounts;

  select jsonb_build_object(
    'libraryBooks', (select count(*) from public.booknook_library_books),
    'searchReservationsAllTime', (select coalesce(sum(used), 0) from public.booknook_search_usage),
    'searchReservationsMonth', (select coalesce(sum(used), 0) from public.booknook_search_usage
      where period = date_trunc('month', now() at time zone 'UTC')::date),
    'isbnReservationsToday', coalesce((select case when day = today then daily_count else 0 end
      from public.isbndb_request_budget where budget_key = 'provider'), 0),
    'searchMonthStart', date_trunc('month', now() at time zone 'UTC')::date,
    'isbnDay', today
  ) into usage_json;

  select jsonb_build_object(
    'openReports', (select count(*) from public.booknook_safety_reports where status = 'open'),
    'reviewingReports', (select count(*) from public.booknook_safety_reports where status = 'reviewing'),
    'childSafetyReports', (select count(*) from public.booknook_safety_reports where status <> 'resolved' and category = 'child-safety'),
    'pendingAlerts', (select count(*) from public.booknook_safety_alert_outbox where delivered_at is null),
    'failedAlerts', (select count(*) from public.booknook_safety_alert_outbox where delivered_at is null and last_error is not null),
    'pendingDeletions', (select count(*) from public.booknook_deletion_requests where status <> 'complete'),
    'blockedUntil', (select case when blocked_until > now() then blocked_until end
      from public.isbndb_request_budget where budget_key = 'provider')
  ) into operations_json;

  select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'count', coalesce(s.n, 0)) order by d.day), '[]'::jsonb)
  into signups_json
  from (select start_day + i as day from generate_series(0, p_days - 1) i) d
  left join (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from auth.users where deleted_at is null and created_at >= start_day::timestamp at time zone 'UTC'
    group by (created_at at time zone 'UTC')::date
  ) s on s.day = d.day;

  return jsonb_build_object(
    'version', 1, 'appId', 'novanook', 'appName', 'NovaNook', 'capturedAt', now(),
    'periodDays', p_days, 'periodStart', start_day, 'periodEnd', today, 'timezone', 'UTC',
    'users', users_json, 'usage', usage_json, 'operations', operations_json, 'dailySignups', signups_json,
    'billing', jsonb_build_object('revenue', null, 'currency', null,
      'reason', 'The current NovaNook webhook stores verified entitlement state, not a transaction ledger. Revenue must come from verified billing events or a provider financial report.'),
    'availability', jsonb_build_object(
      'revenue', 'not_recorded', 'paymentHistory', 'not_recorded', 'errors', 'not_instrumented',
      'dailySearches', 'not_recorded', 'historicalIsbnCalls', 'not_recorded',
      'activeUsersDefinition', 'Accounts whose last Auth sign-in is inside this UTC period; not sessions or daily active users.',
      'proDefinition', 'Unexpired current Pro entitlements; excludes tester previews and does not establish payments received.',
      'booksDefinition', 'Books currently saved across libraries; deleted books/accounts are not a lifetime additions ledger.',
      'searchesDefinition', 'Reserved uncached lookups captured by monthly quota rows; not successful searches or cached searches. Deleted accounts remove their rows.',
      'isbnDefinition', 'Provider budget reservations today in UTC; not confirmed successful provider responses.',
      'signupsDefinition', 'Creation dates of currently retained Auth accounts; deleted accounts are not included.'
    )
  );
end $$;

create or replace function public.booknook_geofox_customer(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare customer_json jsonb; usage_json jsonb; history_json jsonb; deletion_json jsonb; moderation_json jsonb;
begin
  perform public.booknook_geofox_require_service();
  if p_user_id is null then raise exception 'Customer UUID required' using errcode = '22023'; end if;
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'username', p.username, 'displayName', p.display_name,
    'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at, 'emailVerified', u.email_confirmed_at is not null,
    'ageBand', case when a.user_id is null then 'unknown' when public.booknook_is_adult(u.id) then 'adult' else 'teen' end,
    'plan', case when e.plan = 'pro' and (e.pro_expires_at is null or e.pro_expires_at > now()) then 'pro' else 'free' end,
    'proExpiresAt', e.pro_expires_at, 'store', e.store, 'willRenew', e.will_renew,
    'billingCheckedAt', e.billing_checked_at, 'testPreview', t.preview,
    'socialRestricted', exists(select 1 from public.booknook_content_holds h where h.owner_id = u.id and h.target_type = 'profile' and h.active)
  ) into customer_json from auth.users u
  left join public.booknook_profiles p on p.user_id = u.id
  left join public.booknook_age_eligibility a on a.user_id = u.id
  left join public.booknook_entitlements e on e.user_id = u.id
  left join public.booknook_plan_testers t on t.user_id = u.id
  where u.id = p_user_id and u.deleted_at is null;
  if customer_json is null then
    return jsonb_build_object('found', false, 'appId', 'novanook', 'capturedAt', now());
  end if;

  select jsonb_build_object(
    'libraryBooks', count(*),
    'readingSessions', coalesce(sum(r.session_count), 0),
    'readingMinutes', case when coalesce(sum(r.seconds_total), 0) <= 9007199254740991
      then round(coalesce(sum(r.seconds_total), 0) / 60, 1) else null end,
    'searchReservationsAllTime', (select coalesce(sum(used), 0) from public.booknook_search_usage where user_id = p_user_id),
    'searchReservationsMonth', (select coalesce(sum(used), 0) from public.booknook_search_usage
      where user_id = p_user_id and period = date_trunc('month', now() at time zone 'UTC')::date),
    'lastLibraryUpdate', (select updated_at from public.booknook_user_data where user_id = p_user_id)
  ) into usage_json from public.booknook_library_books b
  cross join lateral public.booknook_geofox_reading_totals(b.data) r where b.user_id = p_user_id;

  select coalesce(jsonb_agg(to_jsonb(h) order by h."createdAt" desc), '[]'::jsonb) into history_json from (
    select 'account-created' as id, 'Account created' as title, 'NovaNook account created' as detail,
      u.created_at as "createdAt", 'account' as kind from auth.users u where u.id = p_user_id
    union all
    select 'last-sign-in', 'Last sign-in', 'Most recent Auth sign-in; full sign-in history is not retained here',
      u.last_sign_in_at, 'account' from auth.users u where u.id = p_user_id and u.last_sign_in_at is not null
    union all
    select 'policy-' || h.terms_version || '-' || h.privacy_version, 'Policies accepted',
      'Terms ' || h.terms_version || '; privacy ' || h.privacy_version, h.accepted_at, 'policy'
      from public.booknook_policy_acceptance_history h where h.user_id = p_user_id
    union all
    select 'billing-verified', 'Subscription verified', 'Latest provider entitlement reconciliation; not a payment event',
      e.billing_checked_at, 'billing' from public.booknook_entitlements e where e.user_id = p_user_id and e.billing_checked_at is not null
    union all
    select 'deletion-request', 'Deletion requested', 'Current deletion status: ' || d.status,
      d.requested_at, 'account' from public.booknook_deletion_requests d where d.user_id = p_user_id
    order by "createdAt" desc limit 100
  ) h;

  select jsonb_build_object('status', status, 'requestedAt', requested_at, 'updatedAt', updated_at,
    'providerState', revenuecat_state, 'lastErrorCode', last_error_code,
    'retentionReviewRequired', retention_review_required, 'completedAt', completed_at)
  into deletion_json from public.booknook_deletion_requests where user_id = p_user_id;
  select jsonb_build_object(
    'reportCount', (select count(*) from public.booknook_safety_reports where reported_user = p_user_id),
    'openReports', (select count(*) from public.booknook_safety_reports where reported_user = p_user_id and status <> 'resolved'),
    'activeHolds', (select count(*) from public.booknook_content_holds where owner_id = p_user_id and active)
  ) into moderation_json;

  return jsonb_build_object('found', true, 'appId', 'novanook', 'appName', 'NovaNook', 'capturedAt', now(),
    'customer', customer_json, 'usage', usage_json, 'history', history_json,
    'payments', null, 'paymentsReason', 'Only current entitlement state is stored. No transaction history is recorded by the existing billing webhook.',
    'errors', '[]'::jsonb, 'errorsAvailability', 'not_instrumented', 'moderation', moderation_json, 'deletion', deletion_json,
    'notes', jsonb_build_array(
      'Reading totals use saved valid reading sessions in the current library, including manual entries. Deleted books and logs are not retained.',
      'Search totals are quota reservations, not successful searches; cached searches are not included.',
      'History is a bounded set of recorded milestones, not a complete audit trail of every action.',
      'No date of birth, private book list, journal text, access tokens or payment credentials are returned.'
    )
  );
end $$;

create or replace function public.booknook_geofox_moderation(p_status text default 'open', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare reports_json jsonb; matching bigint;
begin
  perform public.booknook_geofox_require_service();
  if p_status is null or p_status not in ('open','reviewing','resolved','unresolved','all')
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid report filter or limit' using errcode = '22023';
  end if;
  select count(*) into matching from public.booknook_safety_reports r
    where p_status = 'all' or r.status = p_status or (p_status = 'unresolved' and r.status <> 'resolved');
  select coalesce(jsonb_agg(to_jsonb(q) order by q.sort_resolved, q.sort_urgent desc, q."createdAt"), '[]'::jsonb)
    into reports_json from (
    select r.id::text as id, r.reported_user as "reportedUserId", r.reporter as "reporterId",
      r.target_type as "targetType", r.content_id as "contentId", r.category, r.reason, r.context,
      r.status, r.created_at as "createdAt", r.resolution, r.resolved_at as "resolvedAt",
      r.category = 'child-safety' as urgent,
      r.image_hash is not null as "hasReportedImage",
      md5(jsonb_build_array(r.id, r.status, r.resolution, extract(epoch from r.resolved_at),
        (select coalesce(max(a.id), 0) from public.booknook_moderation_actions a where a.report_id = r.id))::text) as version,
      r.status = 'resolved' as sort_resolved, r.category = 'child-safety' as sort_urgent
    from public.booknook_safety_reports r
    where p_status = 'all' or r.status = p_status or (p_status = 'unresolved' and r.status <> 'resolved')
    order by (r.status = 'resolved'), (r.category = 'child-safety') desc, r.created_at, r.id limit p_limit
  ) q;
  -- Internal ordering helpers are not part of the wire contract.
  select coalesce(jsonb_agg(value - array['sort_resolved','sort_urgent']), '[]'::jsonb)
    into reports_json from jsonb_array_elements(reports_json);
  return jsonb_build_object('appId', 'novanook', 'appName', 'NovaNook', 'capturedAt', now(),
    'reports', reports_json, 'total', matching,
    'pendingReports', (select count(*) from public.booknook_safety_reports where status <> 'resolved'),
    'undeliveredAlerts', (select count(*) from public.booknook_safety_alert_outbox where delivered_at is null));
end $$;

create or replace function public.booknook_geofox_moderate(
  p_report_id bigint, p_action text, p_note text, p_actor_id uuid, p_expected_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item public.booknook_safety_reports;
  moderator_id uuid;
  target text;
  content text;
  current_version text;
  action_id bigint;
  audit_id uuid;
begin
  perform public.booknook_geofox_require_service();
  if p_actor_id is null or p_report_id is null or p_action is null
    or p_action not in ('review','resolve','hide','restore','restrict','unrestrict')
    or length(btrim(coalesce(p_note, ''))) not between 1 and 1000
    or coalesce(p_expected_version, '') !~ '^[a-f0-9]{32}$' then
    raise exception 'Report, action, staff identity, current version and a note of 1–1000 characters are required' using errcode = '22023';
  end if;
  select l.novanook_user_id into moderator_id
    from public.booknook_geofox_staff_links l
    join public.booknook_moderators m on m.user_id = l.novanook_user_id and m.active
    where l.hub_user_id = p_actor_id and public.booknook_moderator_account_eligible(l.novanook_user_id);
  if moderator_id is null then
    raise exception 'moderator_link_required: Link this Geofox staff account to its active, eligible NovaNook moderator account' using errcode = '42501';
  end if;
  select * into item from public.booknook_safety_reports where id = p_report_id for update;
  if not found then raise exception 'Report unavailable' using errcode = 'P0002'; end if;
  if item.reported_user = moderator_id then
    raise exception 'A different moderator must handle a report about your account' using errcode = '42501';
  end if;
  current_version := md5(jsonb_build_array(item.id, item.status, item.resolution, extract(epoch from item.resolved_at),
    (select coalesce(max(a.id), 0) from public.booknook_moderation_actions a where a.report_id = item.id))::text);
  if current_version <> p_expected_version then
    raise exception 'Report changed. Refresh the queue before acting.' using errcode = '40001';
  end if;
  if p_action in ('hide','restore','restrict','unrestrict') then
    if item.reported_user is null then
      raise exception 'The reported account was deleted. Resolve the report with an explanation.' using errcode = '22023';
    end if;
    target := case when p_action in ('restrict','unrestrict') then 'profile' else item.target_type end;
    content := case when target = 'profile' then '' else item.content_id end;
    if target in ('avatar','coverImage') then
      if item.image_hash is null then
        raise exception 'This report does not identify an exact image. Review it in NovaNook moderation.' using errcode = '22023';
      end if;
      content := item.image_hash;
    end if;
    insert into public.booknook_content_holds(owner_id, target_type, content_id, active, reason)
      values(item.reported_user, target, content, p_action in ('hide','restrict'), btrim(p_note))
      on conflict(owner_id, target_type, content_id) do update
        set active = excluded.active, reason = excluded.reason, updated_at = now();
  end if;
  update public.booknook_safety_reports set
    status = case when p_action = 'review' then 'reviewing' else 'resolved' end,
    resolution = btrim(p_note), resolved_at = case when p_action = 'review' then null else now() end
    where id = p_report_id;
  insert into public.booknook_moderation_actions(moderator, owner_id, report_id, action, note)
    values(moderator_id, item.reported_user, item.id, p_action, btrim(p_note)) returning id into action_id;
  insert into public.booknook_geofox_audit(hub_actor_id, novanook_actor_id, report_id, moderation_action_id, action, note)
    values(p_actor_id, moderator_id, item.id, action_id, p_action, btrim(p_note)) returning id into audit_id;
  return jsonb_build_object('ok', true, 'appId', 'novanook', 'reportId', item.id::text,
    'status', case when p_action = 'review' then 'reviewing' else 'resolved' end,
    'action', p_action, 'auditId', audit_id);
end $$;

revoke all on function public.booknook_geofox_overview(integer), public.booknook_geofox_customer(uuid),
  public.booknook_geofox_moderation(text,integer), public.booknook_geofox_moderate(bigint,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.booknook_geofox_overview(integer), public.booknook_geofox_customer(uuid),
  public.booknook_geofox_moderation(text,integer), public.booknook_geofox_moderate(bigint,text,text,uuid,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
