-- GEOFOX APPS LLC: private staff operations, support, and monitoring.
-- Apply to the separate Geofox Supabase project, not the NovaNook database.
-- This migration never grants customer-facing clients access to staff data.
begin;
set local lock_timeout = '5s';

create table if not exists public.hub_apps (
  slug text primary key check (slug <> 'all' and slug ~ '^[a-z][a-z0-9-]{1,47}$'),
  name text not null check (char_length(name) between 1 and 100),
  color text not null default '#8b5cf6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  website text not null check (website ~ '^https://'),
  active boolean not null default true,
  integration text not null default 'generic' check (integration in ('novanook', 'generic')),
  created_at timestamptz not null default now()
);

create table if not exists public.hub_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Geofox team' check (char_length(display_name) between 1 and 100),
  role text not null check (role in ('owner','admin','support','moderator','analyst')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hub_staff_apps (
  user_id uuid not null references public.hub_staff(user_id) on delete cascade,
  app_slug text not null references public.hub_apps(slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, app_slug)
);

create table if not exists public.hub_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('GFX-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  app_slug text not null references public.hub_apps(slug),
  subject text not null check (char_length(subject) between 3 and 180),
  category text not null default 'general' check (category in ('general','account','billing','bug','safety','feedback')),
  email text not null check (char_length(email) between 5 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  customer_id text check (customer_id is null or char_length(customer_id) <= 128),
  identity_verified boolean not null default false,
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references public.hub_staff(user_id) on delete set null,
  source text not null default 'web' check (source in ('web','app','staff','email')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hub_tickets_scope_updated on public.hub_tickets(app_slug, updated_at desc);
create index if not exists hub_tickets_customer on public.hub_tickets(app_slug, customer_id);
create index if not exists hub_tickets_status on public.hub_tickets(status, created_at);

create table if not exists public.hub_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hub_tickets(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 12000),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Customer' check (char_length(author_name) between 1 and 100),
  internal boolean not null default false,
  delivery_status text not null default 'not_requested' check (delivery_status in ('not_requested','pending','sent','failed')),
  delivery_provider_id text,
  created_at timestamptz not null default now()
);
create index if not exists hub_ticket_messages_ticket on public.hub_ticket_messages(ticket_id, created_at);

create table if not exists public.hub_errors (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.hub_apps(slug),
  severity text not null default 'error' check (severity in ('info','warning','error','critical')),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  fingerprint text not null check (char_length(fingerprint) between 8 and 128),
  title text not null check (char_length(title) between 1 and 200),
  message text not null check (char_length(message) <= 4000),
  route text check (route is null or char_length(route) <= 500),
  stack text check (stack is null or char_length(stack) <= 8000),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrence_count bigint not null default 1 check (occurrence_count >= 1),
  status text not null default 'open' check (status in ('open','investigating','resolved','ignored')),
  customer_id text check (customer_id is null or char_length(customer_id) <= 128),
  suggested_action text not null default '' check (char_length(suggested_action) <= 2000),
  source text not null default 'application' check (char_length(source) between 1 and 80),
  updated_at timestamptz not null default now(),
  unique (app_slug, fingerprint)
);
create index if not exists hub_errors_scope_recent on public.hub_errors(app_slug, last_seen desc);
create index if not exists hub_errors_scope_customer on public.hub_errors(app_slug, customer_id);

create table if not exists public.hub_error_events (
  id bigint generated by default as identity primary key,
  error_id uuid not null references public.hub_errors(id) on delete cascade,
  app_slug text not null references public.hub_apps(slug),
  customer_id text check (customer_id is null or char_length(customer_id) <= 128),
  occurred_at timestamptz not null default now()
);
create index if not exists hub_error_events_scope_time on public.hub_error_events(app_slug, occurred_at desc);
create index if not exists hub_error_events_customer on public.hub_error_events(app_slug, customer_id, occurred_at desc);

create table if not exists public.hub_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  app_slug text references public.hub_apps(slug),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 50),
  entity_id text check (entity_id is null or char_length(entity_id) <= 128),
  summary text not null default '' check (char_length(summary) <= 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 10000),
  created_at timestamptz not null default now()
);
create index if not exists hub_audit_scope_recent on public.hub_audit_log(app_slug, created_at desc);
create index if not exists hub_audit_entity on public.hub_audit_log(entity_type, entity_id, created_at desc);

create table if not exists public.hub_health_checks (
  app_slug text not null references public.hub_apps(slug),
  service_id text not null check (char_length(service_id) between 1 and 80),
  name text not null check (char_length(name) between 1 and 100),
  status text not null check (status in ('healthy','degraded','down','unknown')),
  detail text not null default '' check (char_length(detail) <= 1000),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 120000),
  checked_at timestamptz not null default now(),
  primary key (app_slug, service_id)
);

create table if not exists public.hub_metric_snapshots (
  id bigint generated by default as identity primary key,
  app_slug text not null references public.hub_apps(slug),
  period_start date not null,
  source text not null check (char_length(source) between 1 and 100),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 30000),
  recorded_at timestamptz not null default now(),
  unique (app_slug, period_start, source)
);

create table if not exists public.hub_review_checks (
  app_slug text not null references public.hub_apps(slug),
  task_key text not null check (task_key ~ '^[a-z0-9-]{1,80}$'),
  period_key date not null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  primary key (app_slug, task_key, period_key)
);

create table if not exists public.hub_rate_limits (
  key_hash text primary key check (char_length(key_hash) between 32 and 128),
  window_start timestamptz not null default now(),
  hits integer not null default 1 check (hits >= 1)
);

create table if not exists public.hub_ingest_events (
  app_slug text not null references public.hub_apps(slug),
  event_id text not null check (char_length(event_id) between 8 and 128),
  kind text not null check (kind in ('error','metric','payment')),
  accepted_at timestamptz not null default now(),
  primary key (app_slug,event_id)
);

create table if not exists public.hub_usage_events (
  id bigint generated by default as identity primary key,
  app_slug text not null references public.hub_apps(slug),
  event_id text not null,
  metric text not null check (metric in ('search','book_added','isbn_call','reading_session','reading_minutes')),
  value numeric not null default 1 check (value >= 0 and value <= 10000000),
  customer_id text check (customer_id is null or char_length(customer_id) <= 128),
  provider text check (provider is null or char_length(provider) <= 80),
  occurred_at timestamptz not null default now(),
  unique (app_slug,event_id),
  foreign key (app_slug,event_id) references public.hub_ingest_events(app_slug,event_id)
);
create index if not exists hub_usage_scope_time on public.hub_usage_events(app_slug,metric,occurred_at desc);

create table if not exists public.hub_payments (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.hub_apps(slug),
  event_id text not null,
  provider text not null check (provider in ('apple','google','stripe','manual_verified')),
  environment text not null default 'production' check (environment='production'),
  transaction_id text not null check (char_length(transaction_id) between 1 and 200),
  customer_id text check (customer_id is null or char_length(customer_id) <= 128),
  status text not null check (status in ('paid','refunded','revoked','pending','failed')),
  amount_minor bigint check (amount_minor is null or amount_minor between -10000000000 and 10000000000),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  product text check (product is null or char_length(product) <= 200),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check (amount_minor is null or status not in ('paid','refunded') or (status='paid' and amount_minor >= 0) or (status='refunded' and amount_minor <= 0)),
  unique (app_slug,event_id),
  unique (app_slug,provider,transaction_id,status),
  foreign key (app_slug,event_id) references public.hub_ingest_events(app_slug,event_id)
);
create index if not exists hub_payments_scope_customer on public.hub_payments(app_slug,customer_id,occurred_at desc);

-- Private-by-default: all reads and writes flow through verified server routes.
do $$
declare table_name text;
begin
  foreach table_name in array array['hub_apps','hub_staff','hub_staff_apps','hub_tickets','hub_ticket_messages','hub_errors','hub_error_events','hub_audit_log','hub_health_checks','hub_metric_snapshots','hub_review_checks','hub_rate_limits','hub_ingest_events','hub_usage_events','hub_payments'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;
grant usage, select on sequence public.hub_error_events_id_seq, public.hub_metric_snapshots_id_seq, public.hub_usage_events_id_seq to service_role;
revoke all on sequence public.hub_error_events_id_seq, public.hub_metric_snapshots_id_seq, public.hub_usage_events_id_seq from public, anon, authenticated;

create or replace function public.hub_actor_can(p_actor uuid, p_capability text, p_app text default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.hub_staff s
    where s.user_id = p_actor and s.active
      and exists(select 1 from auth.users u where u.id=s.user_id and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now()))
      and (p_app is null or exists(select 1 from public.hub_apps app where app.slug=p_app and app.active))
      and p_capability = any(array['overview:read','customers:read','tickets:read','tickets:write','errors:read','errors:write','moderation:read','moderation:write','operations:read','settings:write','staff:write','audit:read'])
      and (s.role = 'owner' or (p_app is not null and exists(select 1 from public.hub_staff_apps a where a.user_id = s.user_id and a.app_slug = p_app)))
      and (
        s.role = 'owner'
        or (s.role = 'admin' and p_capability <> all(array['staff:write','settings:write']))
        or (s.role = 'support' and p_capability = any(array['overview:read','customers:read','tickets:read','tickets:write','errors:read','errors:write','operations:read']))
        or (s.role = 'moderator' and p_capability = any(array['overview:read','moderation:read','moderation:write','operations:read']))
        or (s.role = 'analyst' and p_capability = any(array['overview:read','errors:read','operations:read']))
      )
  );
$$;
revoke all on function public.hub_actor_can(uuid,text,text) from public, anon, authenticated;
grant execute on function public.hub_actor_can(uuid,text,text) to service_role;

create or replace function public.hub_reserve_rate_limit(p_key_hash text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare current_hits integer;
begin
  if char_length(p_key_hash) not between 32 and 128 or p_window_seconds not between 1 and 86400 or p_limit not between 1 and 10000 then
    raise exception 'Invalid limiter input' using errcode = '22023';
  end if;
  insert into public.hub_rate_limits(key_hash, window_start, hits)
  values(p_key_hash, now(), 1)
  on conflict (key_hash) do update set
    hits = case when public.hub_rate_limits.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else public.hub_rate_limits.hits + 1 end,
    window_start = case when public.hub_rate_limits.window_start <= now() - make_interval(secs => p_window_seconds) then now() else public.hub_rate_limits.window_start end
  returning hits into current_hits;
  return current_hits <= p_limit;
end;
$$;
revoke all on function public.hub_reserve_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.hub_reserve_rate_limit(text,integer,integer) to service_role;

create or replace function public.hub_create_public_ticket(
  p_app text, p_email text, p_subject text, p_body text,
  p_ip_key text, p_email_key text,
  p_category text default 'general', p_customer_id text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare ticket public.hub_tickets;
begin
  -- Reservation and creation are one database transaction; a reference is
  -- returned only after both the ticket and its opening message exist.
  if not public.hub_reserve_rate_limit(p_ip_key,900,5)
    or not public.hub_reserve_rate_limit(p_email_key,3600,3) then
    raise exception 'Support request limit reached' using errcode='P0001';
  end if;
  if not exists (select 1 from public.hub_apps where slug = p_app and active) then
    raise exception 'App unavailable' using errcode = '22023';
  end if;
  insert into public.hub_tickets(app_slug,email,subject,category,customer_id,priority)
  values(p_app,lower(trim(p_email)),trim(p_subject),p_category,nullif(trim(p_customer_id),''),case when p_category='safety' then 'high' else 'normal' end)
  returning * into ticket;
  insert into public.hub_ticket_messages(ticket_id,body,author_name,internal,delivery_status)
  values(ticket.id,trim(p_body),'Customer',false,'not_requested');
  insert into public.hub_audit_log(app_slug,action,entity_type,entity_id,summary)
  values(p_app,'ticket.created','ticket',ticket.id::text,'Support request received');
  return jsonb_build_object('id',ticket.id,'reference',ticket.reference,'createdAt',ticket.created_at);
end;
$$;
revoke all on function public.hub_create_public_ticket(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hub_create_public_ticket(text,text,text,text,text,text,text,text) to service_role;

create or replace function public.hub_update_ticket(p_actor uuid, p_ticket uuid, p_status text default null, p_priority text default null,p_assignee uuid default null,p_set_assignee boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare ticket public.hub_tickets;
begin
  select * into ticket from public.hub_tickets where id=p_ticket for update;
  if not found or not public.hub_actor_can(p_actor,'tickets:write',ticket.app_slug) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_set_assignee and p_assignee is not null and not public.hub_actor_can(p_assignee,'tickets:write',ticket.app_slug) then
    raise exception 'Assignee cannot access this app support queue' using errcode='22023';
  end if;
  update public.hub_tickets set status=coalesce(p_status,status),priority=coalesce(p_priority,priority),
    assignee_id=case when p_set_assignee then p_assignee else assignee_id end,updated_at=now() where id=p_ticket;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
  values(p_actor,ticket.app_slug,'ticket.updated','ticket',ticket.id::text,'Ticket status or priority updated',jsonb_build_object('status',coalesce(p_status,ticket.status),'priority',coalesce(p_priority,ticket.priority)));
end;
$$;
revoke all on function public.hub_update_ticket(uuid,uuid,text,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.hub_update_ticket(uuid,uuid,text,text,uuid,boolean) to service_role;

create or replace function public.hub_add_ticket_message(p_actor uuid,p_ticket uuid,p_body text,p_internal boolean default true,p_delivery_status text default 'not_requested')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare ticket public.hub_tickets; message_id uuid; author text;
begin
  select * into ticket from public.hub_tickets where id=p_ticket for update;
  if not found or not public.hub_actor_can(p_actor,'tickets:write',ticket.app_slug) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  select display_name into author from public.hub_staff where user_id=p_actor;
  insert into public.hub_ticket_messages(ticket_id,body,author_id,author_name,internal,delivery_status)
  values(p_ticket,trim(p_body),p_actor,author,p_internal,case when p_internal then 'not_requested' else p_delivery_status end)
  returning id into message_id;
  update public.hub_tickets set updated_at=now() where id=p_ticket;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary)
  values(p_actor,ticket.app_slug,case when p_internal then 'ticket.note_added' else 'ticket.reply_added' end,'ticket',p_ticket::text,case when p_internal then 'Internal support note added' else 'Customer reply recorded' end);
  return message_id;
end;
$$;
revoke all on function public.hub_add_ticket_message(uuid,uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function public.hub_add_ticket_message(uuid,uuid,text,boolean,text) to service_role;

create or replace function public.hub_record_error(
 p_app text,p_fingerprint text,p_title text,p_message text,p_code text default null,
 p_route text default null,p_stack text default null,p_severity text default 'error',
 p_source text default 'application',p_customer_id text default null,p_suggested_action text default '',p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare error_id uuid;
begin
  if not exists(select 1 from public.hub_apps where slug=p_app and active) then raise exception 'App unavailable' using errcode='22023'; end if;
  insert into public.hub_errors(app_slug,fingerprint,title,message,error_code,route,stack,severity,source,customer_id,suggested_action,first_seen,last_seen)
  values(p_app,p_fingerprint,p_title,p_message,p_code,p_route,p_stack,p_severity,p_source,p_customer_id,p_suggested_action,p_occurred_at,p_occurred_at)
  on conflict(app_slug,fingerprint) do update set last_seen=greatest(public.hub_errors.last_seen,p_occurred_at),
    first_seen=least(public.hub_errors.first_seen,p_occurred_at),occurrence_count=public.hub_errors.occurrence_count+1,
    status=case when public.hub_errors.status='resolved' then 'open' else public.hub_errors.status end,
    updated_at=now(),customer_id=case when public.hub_errors.customer_id is not distinct from excluded.customer_id then public.hub_errors.customer_id else null end
  returning id into error_id;
  insert into public.hub_error_events(error_id,app_slug,customer_id,occurred_at) values(error_id,p_app,p_customer_id,p_occurred_at);
  return error_id;
end;
$$;
revoke all on function public.hub_record_error(text,text,text,text,text,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.hub_record_error(text,text,text,text,text,text,text,text,text,text,text,timestamptz) to service_role;

create or replace function public.hub_update_error(p_actor uuid,p_error uuid,p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare incident public.hub_errors;
begin
  select * into incident from public.hub_errors where id=p_error for update;
  if not found or not public.hub_actor_can(p_actor,'errors:write',incident.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  update public.hub_errors set status=p_status,updated_at=now() where id=p_error;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
  values(p_actor,incident.app_slug,'error.updated','error',p_error::text,'Error investigation status updated',jsonb_build_object('status',p_status));
end;
$$;
revoke all on function public.hub_update_error(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.hub_update_error(uuid,uuid,text) to service_role;

create or replace function public.hub_complete_review(p_actor uuid,p_app text,p_task text,p_period date,p_completed boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.hub_actor_can(p_actor,'operations:read',p_app) or exists(select 1 from public.hub_staff where user_id=p_actor and role='analyst') then raise exception 'Not permitted' using errcode='42501'; end if;
  insert into public.hub_review_checks(app_slug,task_key,period_key,completed_at,completed_by)
  values(p_app,p_task,p_period,case when p_completed then now() else null end,case when p_completed then p_actor else null end)
  on conflict(app_slug,task_key,period_key) do update set completed_at=excluded.completed_at,completed_by=excluded.completed_by;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary)
  values(p_actor,p_app,'review.updated','review',p_task,case when p_completed then 'Operations review completed' else 'Operations review reopened' end);
end;
$$;
revoke all on function public.hub_complete_review(uuid,text,text,date,boolean) from public, anon, authenticated;
grant execute on function public.hub_complete_review(uuid,text,text,date,boolean) to service_role;

create or replace function public.hub_complete_reviews(p_actor uuid,p_apps text[],p_task text,p_period date,p_completed boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare app_slug text;
begin
  if coalesce(cardinality(p_apps),0) not between 1 and 100 then raise exception 'Invalid app scope' using errcode='22023'; end if;
  foreach app_slug in array p_apps loop
    perform public.hub_complete_review(p_actor,app_slug,p_task,p_period,p_completed);
  end loop;
end $$;
revoke all on function public.hub_complete_reviews(uuid,text[],text,date,boolean) from public, anon, authenticated;
grant execute on function public.hub_complete_reviews(uuid,text[],text,date,boolean) to service_role;

create or replace function public.hub_save_staff(p_actor uuid,p_user uuid,p_name text,p_role text,p_active boolean,p_apps text[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  -- Serialize membership changes; the only owner lifecycle is explicit SQL.
  perform pg_advisory_xact_lock(710432821);
  if not public.hub_actor_can(p_actor,'staff:write',null) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_user=p_actor or exists(select 1 from public.hub_staff where user_id=p_user and role='owner') then
    raise exception 'Owner access cannot be changed through this workflow' using errcode='42501';
  end if;
  if p_role not in ('admin','support','moderator','analyst') or p_active is null
    or coalesce(cardinality(p_apps),0) not between 1 and 100
    or not exists(select 1 from auth.users where id=p_user)
    or exists(select 1 from unnest(p_apps) as x(slug) where not exists(select 1 from public.hub_apps a where a.slug=x.slug and a.active))
  then raise exception 'Invalid staff details' using errcode='22023'; end if;
  insert into public.hub_staff(user_id,display_name,role,active)
  values(p_user,trim(p_name),p_role,p_active)
  on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active,updated_at=now();
  delete from public.hub_staff_apps where user_id=p_user;
  insert into public.hub_staff_apps(user_id,app_slug) select p_user,slug from (select distinct unnest(p_apps) as slug) scoped;
  insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary,metadata)
  values(p_actor,'staff.access_updated','staff',p_user::text,'Staff role and app access updated',jsonb_build_object('role',p_role,'active',p_active,'appSlugs',to_jsonb(p_apps)));
end $$;
revoke all on function public.hub_save_staff(uuid,uuid,text,text,boolean,text[]) from public, anon, authenticated;
grant execute on function public.hub_save_staff(uuid,uuid,text,text,boolean,text[]) to service_role;

create or replace function public.hub_save_app(p_actor uuid,p_slug text,p_name text,p_website text,p_color text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.hub_actor_can(p_actor,'settings:write',null) then raise exception 'Not permitted' using errcode='42501'; end if;
  insert into public.hub_apps(slug,name,website,color) values(p_slug,p_name,p_website,p_color)
  on conflict(slug) do update set name=excluded.name,website=excluded.website,color=excluded.color;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary)
  values(p_actor,p_slug,'app.updated','app',p_slug,'App directory details updated');
end $$;
revoke all on function public.hub_save_app(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hub_save_app(uuid,text,text,text,text) to service_role;

create or replace function public.hub_set_ticket_delivery(p_actor uuid,p_ticket uuid,p_message uuid,p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare ticket public.hub_tickets; changed uuid;
begin
  select * into ticket from public.hub_tickets where id=p_ticket for update;
  if not found or not public.hub_actor_can(p_actor,'tickets:write',ticket.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_status not in ('sent','failed') then raise exception 'Invalid delivery state' using errcode='22023'; end if;
  update public.hub_ticket_messages set delivery_status=p_status
  where id=p_message and ticket_id=p_ticket and not internal and delivery_status='pending'
  returning id into changed;
  if changed is null then raise exception 'Reply is not pending delivery' using errcode='22023'; end if;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
  values(p_actor,ticket.app_slug,'ticket.delivery_updated','ticket',p_ticket::text,'Customer reply delivery result recorded',jsonb_build_object('status',p_status));
end $$;
revoke all on function public.hub_set_ticket_delivery(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.hub_set_ticket_delivery(uuid,uuid,uuid,text) to service_role;

-- Only the trusted HMAC-verified ingestion route can invoke this service-only RPC.
-- The event marker and resulting data commit together, so replay never doubles counts.
create or replace function public.hub_accept_ingest(p_app text,p_event_id text,p_kind text,p_payload jsonb,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare inserted integer; result_id uuid;
begin
  if not exists(select 1 from public.hub_apps where slug=p_app and active)
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text)>20000
    or p_occurred_at is null or p_occurred_at > now()+interval '5 minutes' or p_occurred_at < timestamptz '2000-01-01 00:00:00+00'
  then raise exception 'Invalid event' using errcode='22023'; end if;
  insert into public.hub_ingest_events(app_slug,event_id,kind) values(p_app,p_event_id,p_kind)
  on conflict(app_slug,event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted=0 then return jsonb_build_object('accepted',true,'duplicate',true); end if;
  if p_kind='error' then
    result_id:=public.hub_record_error(p_app,p_payload->>'fingerprint',p_payload->>'title',p_payload->>'message',p_payload->>'code',
      p_payload->>'route',p_payload->>'stack',p_payload->>'severity',p_payload->>'source',p_payload->>'customerId',p_payload->>'suggestedAction',p_occurred_at);
  elsif p_kind='metric' then
    insert into public.hub_usage_events(app_slug,event_id,metric,value,customer_id,provider,occurred_at)
    values(p_app,p_event_id,p_payload->>'metric',(p_payload->>'value')::numeric,p_payload->>'customerId',p_payload->>'provider',p_occurred_at);
  elsif p_kind='payment' then
    if coalesce((p_payload->>'verified')::boolean,false) is not true or (p_payload->>'environment') is distinct from 'production' then
      raise exception 'Payment must be verified production data' using errcode='22023';
    end if;
    insert into public.hub_payments(app_slug,event_id,provider,environment,transaction_id,customer_id,status,amount_minor,currency,product,occurred_at)
    values(p_app,p_event_id,p_payload->>'provider','production',p_payload->>'transactionId',p_payload->>'customerId',p_payload->>'status',
      (p_payload->>'amountMinor')::bigint,p_payload->>'currency',p_payload->>'product',p_occurred_at)
    on conflict(app_slug,provider,transaction_id,status) do nothing returning id into result_id;
    if result_id is null then
      if not exists(select 1 from public.hub_payments p where p.app_slug=p_app and p.provider=p_payload->>'provider'
        and p.transaction_id=p_payload->>'transactionId' and p.status=p_payload->>'status'
        and p.amount_minor is not distinct from (p_payload->>'amountMinor')::bigint
        and p.currency is not distinct from p_payload->>'currency'
        and p.customer_id is not distinct from p_payload->>'customerId'
        and p.product is not distinct from p_payload->>'product') then
        raise exception 'Conflicting payment identity' using errcode='22023';
      end if;
      return jsonb_build_object('accepted',true,'duplicate',true);
    end if;
  else raise exception 'Invalid event kind' using errcode='22023';
  end if;
  return jsonb_build_object('accepted',true,'duplicate',false,'id',result_id);
end $$;
revoke all on function public.hub_accept_ingest(text,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.hub_accept_ingest(text,text,text,jsonb,timestamptz) to service_role;

create or replace function public.hub_reporting_summary(p_apps text[],p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(cardinality(p_apps),0) not between 1 and 100 or p_start is null or p_end is null
    or p_start>=p_end or p_end-p_start>interval '400 days' then raise exception 'Invalid report scope' using errcode='22023'; end if;
  return jsonb_build_object(
    'openTickets',(select count(*) from public.hub_tickets where app_slug=any(p_apps) and status not in ('resolved','closed')),
    'openErrors',(select count(*) from public.hub_errors where app_slug=any(p_apps) and status in ('open','investigating')),
    'paymentTotals',coalesce((select jsonb_agg(row_to_json(t)) from (
      select app_slug as "appSlug",currency,
        case when bool_or(amount_minor is null) then null else sum(amount_minor) end as "amountMinor",count(*) as count
      from public.hub_payments where app_slug=any(p_apps) and occurred_at>=p_start and occurred_at<p_end and status in ('paid','refunded')
      group by app_slug,currency) t),'[]'::jsonb),
    'ingestion',coalesce((select jsonb_agg(row_to_json(t)) from (
      select app_slug as "appSlug",kind,max(accepted_at) as "lastAt" from public.hub_ingest_events where app_slug=any(p_apps) group by app_slug,kind) t),'[]'::jsonb),
    'dailyErrors',coalesce((select jsonb_agg(row_to_json(t) order by t.date) from (
      select (occurred_at at time zone 'UTC')::date as date,count(*) as count from public.hub_error_events
      where app_slug=any(p_apps) and occurred_at>=p_start and occurred_at<p_end group by (occurred_at at time zone 'UTC')::date) t),'[]'::jsonb)
  );
end $$;
revoke all on function public.hub_reporting_summary(text[],timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.hub_reporting_summary(text[],timestamptz,timestamptz) to service_role;

create or replace function public.hub_customer_errors(p_apps text[],p_customer_id text,p_status text default null,p_limit integer default 50,p_offset integer default 0,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if coalesce(cardinality(p_apps),0) not between 1 and 100 or p_customer_id is null or char_length(p_customer_id) not between 1 and 128
    or p_limit not between 1 and 100 or p_offset not between 0 and 10000 or (p_ids is not null and cardinality(p_ids)>30)
    or (p_status is not null and p_status not in ('open','investigating','resolved','ignored')) then
    raise exception 'Invalid customer error scope' using errcode='22023';
  end if;
  with occurrences as (
    select error_id,count(*) as customer_count,min(occurred_at) as first_at,max(occurred_at) as last_at
    from public.hub_error_events where app_slug=any(p_apps) and customer_id=p_customer_id group by error_id
  ), scoped as (
    select to_jsonb(e)||jsonb_build_object('occurrence_count',o.customer_count,'first_seen',o.first_at,'last_seen',o.last_at,'customer_id',p_customer_id) as item,o.last_at
    from occurrences o join public.hub_errors e on e.id=o.error_id
    where e.app_slug=any(p_apps) and (p_status is null or e.status=p_status) and (p_ids is null or e.id=any(p_ids))
  ) select jsonb_build_object('total',(select count(*) from scoped),'items',coalesce((
    select jsonb_agg(paged.item order by paged.last_at desc) from (select item,last_at from scoped order by last_at desc limit p_limit offset p_offset) paged
  ),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.hub_customer_errors(text[],text,text,integer,integer,uuid[]) from public, anon, authenticated;
grant execute on function public.hub_customer_errors(text[],text,text,integer,integer,uuid[]) to service_role;

insert into public.hub_apps(slug,name,color,website,integration)
values('novanook','NovaNook','#a78bfa','https://mynovanook.com','novanook')
on conflict(slug) do nothing;

comment on table public.hub_tickets is 'Staff-only support records. Publicly supplied customer IDs are unverified claims until separately verified.';
comment on table public.hub_errors is 'Redacted operational error groups; never store credentials, request payloads, email addresses, or exact dates of birth.';
comment on table public.hub_staff is 'Explicit allowlist. Never populate from public signups, JWT user_metadata, or a first-user-wins flow.';

notify pgrst, 'reload schema';
commit;
