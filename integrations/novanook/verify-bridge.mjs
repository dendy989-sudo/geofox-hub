// Isolated PostgreSQL compatibility/security fixture. Never connects to Supabase.
// Requires @electric-sql/pglite, optionally at an absolute PGLITE_MODULE path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let checks = 0;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hubActor = id(100);
const fixture = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  created_at timestamptz default now(), last_sign_in_at timestamptz, deleted_at timestamptz, banned_until timestamptz
);
create table public.booknook_profiles(user_id uuid primary key references auth.users(id), username text, display_name text);
create table public.booknook_entitlements(user_id uuid primary key references auth.users(id), plan text,
  pro_expires_at timestamptz, store text, will_renew boolean, billing_checked_at timestamptz);
create table public.booknook_plan_testers(user_id uuid primary key references auth.users(id), preview text);
create table public.booknook_library_books(user_id uuid references auth.users(id), book_id text, data jsonb, primary key(user_id,book_id));
create table public.booknook_user_data(user_id uuid primary key references auth.users(id), updated_at timestamptz default now());
create table public.booknook_search_usage(user_id uuid references auth.users(id), period date, used integer, primary key(user_id,period));
create table public.booknook_age_eligibility(user_id uuid primary key references auth.users(id), age_band text, adult_on date);
create table public.booknook_policy_acceptance_history(user_id uuid references auth.users(id), terms_version text, privacy_version text, accepted_at timestamptz default now());
create table public.isbndb_request_budget(budget_key text primary key, day date, daily_count integer, blocked_until timestamptz);
create table public.booknook_safety_reports(
  id bigint generated always as identity primary key,
  reporter uuid references auth.users(id), reported_user uuid references auth.users(id),
  target_type text default 'profile', content_id text default '', category text default 'other',
  reason text, context jsonb default '{}', status text default 'open', created_at timestamptz default now(),
  resolution text, resolved_at timestamptz, image_hash text
);
create table public.booknook_content_holds(
  owner_id uuid references auth.users(id), target_type text, content_id text,
  active boolean default true, reason text, updated_at timestamptz default now(),
  primary key(owner_id,target_type,content_id),
  check(target_type not in ('avatar','coverImage') or content_id ~ '^[a-f0-9]{64}$')
);
create table public.booknook_moderation_actions(
  id bigint generated always as identity primary key,
  moderator uuid references auth.users(id), owner_id uuid references auth.users(id),
  report_id bigint references public.booknook_safety_reports(id), action text, note text, created_at timestamptz default now()
);
create table public.booknook_moderators(user_id uuid primary key references auth.users(id), active boolean default true, is_admin boolean default false);
create table public.booknook_safety_alert_outbox(id bigint generated always as identity primary key, delivered_at timestamptz, last_error text);
create table public.booknook_deletion_requests(user_id uuid primary key, status text, requested_at timestamptz,
  updated_at timestamptz, revenuecat_state text, last_error_code text, retention_review_required boolean, completed_at timestamptz);
create function public.booknook_is_adult(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.booknook_age_eligibility where user_id=p_user and
    case when adult_on is not null then adult_on <= (now() at time zone 'UTC')::date else age_band='adult' end);
$$;
create function public.booknook_moderator_account_eligible(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
    and public.booknook_is_adult(p_user)
    and not exists(select 1 from public.booknook_deletion_requests where user_id=p_user);
$$;
`;
const migration = await readFile(new URL('./202611020006_geofox_bridge.sql', import.meta.url), 'utf8');

async function rejectsMissingPrerequisite(change, expected) {
  const probe = new PGlite();
  try {
    await probe.exec(fixture);
    await probe.exec(change);
    await assert.rejects(() => probe.exec(migration), error => error.code === '55000' && error.message.includes(expected));
    checks++;
    await probe.exec('rollback');
    const objects = (await probe.query("select to_regclass('public.booknook_geofox_staff_links') as links, to_regclass('public.booknook_geofox_audit') as audit")).rows[0];
    check(objects.links === null && objects.audit === null, 'Prerequisite rejection must leave no bridge objects');
  } finally { await probe.close(); }
}

async function run(sql, args = []) { return (await db.query(sql, args)).rows; }
async function rpc(name, args = []) {
  const values = args.map((_, i) => `$${i + 1}`).join(',');
  return (await run(`select public.${name}(${values}) as data`, args))[0].data;
}
function check(condition, message) { assert.ok(condition, message); checks++; }
async function rejects(fn, code, message) {
  await assert.rejects(fn, error => error.code === code, message);
  checks++;
}
async function role(name, claim = name) {
  assert.ok(['postgres', 'anon', 'authenticated', 'service_role'].includes(name));
  await db.exec(`reset role; set role ${name};`);
  await run("select set_config('request.jwt.claim.role', $1, false)", [claim]);
}

try {
  await rejectsMissingPrerequisite('drop table public.booknook_profiles;', 'booknook_profiles');
  await rejectsMissingPrerequisite('drop function public.booknook_is_adult(uuid) cascade;', 'booknook_is_adult(uuid)');
  await rejectsMissingPrerequisite('alter table public.booknook_entitlements rename column billing_checked_at to old_billing_check;', 'billing_checked_at');
  await rejectsMissingPrerequisite('alter table public.booknook_content_holds drop constraint booknook_content_holds_pkey; create unique index partial_hold_key on public.booknook_content_holds(owner_id,target_type,content_id) where active;', 'immediate unique key');
  await db.exec(fixture);
  await db.exec(migration);
  for (let n = 1; n <= 9; n++) {
    await run("insert into auth.users(id,email,email_confirmed_at,created_at,last_sign_in_at,deleted_at) values($1,$2,now(),now()-interval '2 days',now(),case when $3 then now() else null end)", [id(n), `fixture${n}@example.invalid`, n === 9]);
    await run('insert into public.booknook_profiles values($1,$2,$3)', [id(n), `fixture${n}`, `Fixture ${n}`]);
    await run('insert into public.booknook_user_data(user_id) values($1)', [id(n)]);
  }
  for (const [n, band, dayOffset] of [[1, 'adult', null], [2, 'adult', null], [3, '13-15', 800], [4, '16-17', 10], [7, 'adult', null], [8, '16-17', -1]]) {
    await run("insert into public.booknook_age_eligibility values($1,$2,(now() at time zone 'UTC')::date + $3::integer)", [id(n), band, dayOffset]);
  }
  for (const n of [2, 4, 6, 9]) {
    await run("insert into public.booknook_entitlements values($1,'pro',null,'APP_STORE',true,now())", [id(n)]);
  }
  await run("insert into public.booknook_entitlements values($1,'pro',now()-interval '1 day','APP_STORE',false,now())", [id(5)]);
  await run("insert into public.booknook_plan_testers values($1,'pro')", [id(7)]);
  await run('insert into public.booknook_library_books values($1,$2,$3)', [id(2), 'secret-book-1', {
    title: 'PRIVATE_BOOK_TITLE', notes: 'PRIVATE_JOURNAL_TEXT', readingLog: [
      { date: '2026-01-05', pages: 5, from: 0, minutes: 1.2, seconds: 90, notes: [{ text: 'PRIVATE_READING_NOTE' }] },
      { date: '2026-02-30', pages: 5, from: 0, minutes: 10 },
      { date: '2026-01-05', pages: -1, from: 0, minutes: 10 }
    ]
  }]);
  await run('insert into public.booknook_library_books values($1,$2,$3)', [id(2), 'secret-book-2', { readingLog: [{ date: '2026-01-06', pages: 10, from: 5, minutes: 10 }] }]);
  await run('insert into public.booknook_library_books values($1,$2,$3)', [id(3), 'secret-book-3', { readingLog: 'malformed' }]);
  await run("insert into public.booknook_search_usage values($1,date_trunc('month',now() at time zone 'UTC')::date,4),($1,(date_trunc('month',now() at time zone 'UTC')-interval '1 month')::date,3),($2,date_trunc('month',now() at time zone 'UTC')::date,2)", [id(2), id(5)]);
  await db.exec("insert into public.isbndb_request_budget values('provider',(now() at time zone 'UTC')::date-1,999,now()+interval '1 hour');");
  await run("insert into public.booknook_safety_reports(reporter,reported_user,target_type,content_id,category,reason,image_hash) values($1,$2,'avatar','reported-avatar','child-safety','Fixture report',$3)", [id(3), id(2), 'a'.repeat(64)]);
  await run("insert into public.booknook_safety_reports(reporter,reported_user,category,reason,created_at) values($1,$2,'spam','Fixture spam',now()-interval '1 day')", [id(2), id(3)]);
  await db.exec("insert into public.booknook_safety_alert_outbox(delivered_at,last_error) values(null,null),(null,'fixture_retry'),(now(),null);");
  await run('insert into public.booknook_moderators(user_id) values($1),($2),($3)', [id(1), id(2), id(3)]);
  await run('insert into public.booknook_geofox_staff_links(hub_user_id,novanook_user_id) values($1,$2),($3,$4),($5,$6)', [hubActor, id(1), id(101), id(2), id(102), id(3)]);

  await role('anon', 'service_role');
  await rejects(() => rpc('booknook_geofox_overview'), '42501', 'Anon cannot call even with a forged claim');
  await rejects(() => run('select * from public.booknook_geofox_staff_links'), '42501', 'No public staff identity mapping');
  await role('authenticated');
  await rejects(() => rpc('booknook_geofox_customer', [id(2)]), '42501', 'Ordinary user cannot look up another customer');
  await rejects(() => rpc('booknook_geofox_moderation'), '42501', 'Ordinary user cannot read the safety queue');
  await role('service_role', 'authenticated');
  await rejects(() => rpc('booknook_geofox_overview'), '42501', 'Service RPC checks JWT role as well as grants');
  await role('service_role');
  await rejects(() => rpc('booknook_geofox_reading_totals', [{}]), '42501', 'Internal helper is not a public RPC');
  await rejects(() => rpc('booknook_geofox_overview', [999]), '22023', 'Query bounds enforced');
  let overview = await rpc('booknook_geofox_overview', [7]);
  check(overview.users.total === 8 && overview.users.free === 5 && overview.users.pro === 3, 'Current user and entitlement totals');
  check(overview.users.adultFree === 3 && overview.users.adultPro === 1 && overview.users.teenFree === 1 && overview.users.teenPro === 1 && overview.users.unknownAgeFree === 1 && overview.users.unknownAgePro === 1, 'Age/plan partition includes birthday transitions and unknown ages');
  check(overview.users.total === ['adultFree', 'adultPro', 'teenFree', 'teenPro', 'unknownAgeFree', 'unknownAgePro'].reduce((sum, key) => sum + overview.users[key], 0), 'Six age-plan buckets partition all users');
  check(overview.dailySignups.length === 7 && overview.dailySignups.reduce((sum, item) => sum + item.count, 0) === 8, 'UTC signup series zero-filled');
  check(overview.usage.searchReservationsAllTime === 9 && overview.usage.searchReservationsMonth === 6, 'Monthly and retained-total search reservations separated');
  check(overview.usage.isbnReservationsToday === 0, 'Yesterday ISBN budget is not today usage');
  check(overview.usage.libraryBooks === 3 && overview.billing.revenue === null && overview.availability.errors === 'not_instrumented', 'Real books and explicit unavailable telemetry/revenue');
  check(overview.operations.pendingAlerts === 2 && overview.operations.failedAlerts === 1 && overview.operations.childSafetyReports === 1, 'Operational counts distinguish retry failure and pending delivery');
  const customer = await rpc('booknook_geofox_customer', [id(2)]);
  check(customer.found && customer.customer.plan === 'pro' && customer.customer.ageBand === 'adult', 'Customer exact UUID lookup');
  check(customer.usage.libraryBooks === 2 && customer.usage.readingSessions === 2 && customer.usage.readingMinutes === 11.5, 'Valid saved session counts/time without private logs');
  check(!JSON.stringify(customer).includes('PRIVATE_') && !JSON.stringify(customer).includes('secret-book') && !JSON.stringify(customer).includes('date_of_birth'), 'Customer response excludes book lists, notes and birthdates');
  check(customer.payments === null && customer.errorsAvailability === 'not_instrumented', 'Missing ledger/telemetry not disguised as zero history');
  check(!(await rpc('booknook_geofox_customer', [id(999)])).found, 'Unknown UUID is not found');
  check(!(await rpc('booknook_geofox_customer', [id(9)])).found, 'Deleted account is not returned');
  check((await rpc('booknook_geofox_customer', [id(7)])).customer.plan === 'free', 'Tester Pro preview does not count as paid entitlement');
  let queue = await rpc('booknook_geofox_moderation', ['unresolved', 50]);
  check(queue.total === 2 && queue.reports[0].category === 'child-safety' && queue.reports[0].urgent, 'Child safety reports sorted first and marked urgent');
  const report = queue.reports[0];
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'review', 'Fixture review', id(199), report.version]), '42501', 'Unlinked hub actor cannot moderate');
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'review', 'Fixture review', id(102), report.version]), '42501', 'Teen moderator identity remains ineligible');
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'review', 'Fixture review', id(101), report.version]), '42501', 'Linked moderator cannot review own report');
  const review = await rpc('booknook_geofox_moderate', [report.id, 'review', 'Fixture review', hubActor, report.version]);
  check(review.ok && review.status === 'reviewing', 'Authorized review changes status');
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'resolve', 'Stale review', hubActor, report.version]), '40001', 'Stale review cannot overwrite newer decision');
  await db.exec("set time zone '-08:00'");
  queue = await rpc('booknook_geofox_moderation', ['all', 50]);
  const current = queue.reports.find(row => row.id === report.id);
  await db.exec("set time zone 'UTC'");
  const hidden = await rpc('booknook_geofox_moderate', [report.id, 'hide', 'Fixture image hold', hubActor, current.version]);
  check(hidden.ok && hidden.status === 'resolved', 'Authorized action permits exact-image hold');
  await role('postgres');
  const holds = await run('select target_type,content_id,active from public.booknook_content_holds');
  check(holds.length === 1 && holds[0].target_type === 'avatar' && holds[0].content_id === 'a'.repeat(64) && holds[0].active, 'Image moderation holds exact reported hash');
  await role('service_role');
  await db.exec("set time zone '-08:00'");
  queue = await rpc('booknook_geofox_moderation', ['all', 50]);
  const resolved = queue.reports.find(row => row.id === report.id);
  await db.exec("set time zone 'UTC'");
  const restored = await rpc('booknook_geofox_moderate', [report.id, 'restore', 'Fixture restore', hubActor, resolved.version]);
  check(restored.ok && restored.status === 'resolved', 'Resolved report version remains valid across session time-zone changes');
  await role('postgres');
  check((await run('select active from public.booknook_content_holds'))[0].active === false, 'Restore reversibly releases the exact hold');
  const audits = await run('select hub_actor_id,novanook_actor_id from public.booknook_geofox_audit');
  check(audits.length === 3 && audits.every(row => row.hub_actor_id === hubActor && row.novanook_actor_id === id(1)), 'Successful actions have separate cross-project attribution');
  check((await run('select count(*)::integer as n from public.booknook_moderation_actions'))[0].n === 3, 'Rejected action made no underlying audit mutation');
  await run("update auth.users set banned_until=now()+interval '1 day' where id=$1", [id(1)]);
  await role('service_role');
  queue = await rpc('booknook_geofox_moderation', ['all', 50]);
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'review', 'Banned source account', hubActor, queue.reports.find(row => row.id === report.id).version]), '42501', 'A current source Auth ban blocks moderation despite active membership');
  await role('postgres');
  await run("update auth.users set banned_until=now()-interval '1 day' where id=$1", [id(1)]);
  await role('service_role');
  const afterExpiredBan = await rpc('booknook_geofox_moderate', [report.id, 'review', 'Eligible after expired ban', hubActor, queue.reports.find(row => row.id === report.id).version]);
  check(afterExpiredBan.ok, 'An expired source Auth ban does not block an otherwise eligible moderator');
  await role('postgres');
  await run('update auth.users set deleted_at=now() where id=$1', [id(1)]);
  await role('service_role');
  queue = await rpc('booknook_geofox_moderation', ['all', 50]);
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'resolve', 'Deleted source account', hubActor, queue.reports.find(row => row.id === report.id).version]), '42501', 'A source soft deletion blocks moderation despite active membership');
  await role('postgres');
  await run('update auth.users set deleted_at=null where id=$1', [id(1)]);
  check((await run('select count(*)::integer as n from public.booknook_moderation_actions'))[0].n === 4, 'Banned and deleted source attempts make no action writes');
  check((await run('select count(*)::integer as n from public.booknook_geofox_audit'))[0].n === 4, 'Banned and deleted source attempts make no attribution writes');
  await run('update public.booknook_moderators set active=false where user_id=$1', [id(1)]);
  await role('service_role');
  queue = await rpc('booknook_geofox_moderation', ['all', 50]);
  await rejects(() => rpc('booknook_geofox_moderate', [report.id, 'restore', 'Fixture restore', hubActor, queue.reports.find(row => row.id === report.id).version]), '42501', 'Revoking NovaNook moderator immediately blocks future writes');
  console.log(`NovaNook bridge: ${checks} isolated PostgreSQL fixture checks passed.`);
} finally {
  await db.close();
}
