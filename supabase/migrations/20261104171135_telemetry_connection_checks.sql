-- A signed connection check is operational evidence, not an application error.
-- Keep one bounded state row per app; never write test traffic to incident,
-- usage, payment, or accepted application-event tables.
begin;
set local lock_timeout = '5s';

create table if not exists public.hub_telemetry_checks (
  app_slug text primary key references public.hub_apps(slug),
  challenge_id uuid not null,
  outcome text not null check (outcome in (
    'pending', 'connected', 'authentication', 'source_not_configured',
    'source_unavailable', 'delivery_failed', 'invalid_response', 'timeout'
  )),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  last_success_at timestamptz,
  latency_ms integer check (latency_ms between 0 and 10000),
  check (isfinite(started_at) and isfinite(expires_at)
    and expires_at = started_at + interval '30 seconds'),
  check ((outcome = 'connected') = (accepted_at is not null)),
  check (accepted_at is null or (isfinite(accepted_at)
    and accepted_at >= started_at and accepted_at <= expires_at)),
  check (last_success_at is null or isfinite(last_success_at)),
  check (accepted_at is null or (last_success_at is not null and last_success_at = accepted_at))
);

alter table public.hub_telemetry_checks enable row level security;
revoke all on table public.hub_telemetry_checks from public, anon, authenticated;
revoke all on table public.hub_telemetry_checks from service_role;
grant select, insert, update on table public.hub_telemetry_checks to service_role;

comment on table public.hub_telemetry_checks is
  'Server-only signed reporter connection evidence. Connection checks are never application errors or usage events.';

-- The authenticated staff route checks role and app scope before calling this
-- RPC. Claiming in the database shares the one-per-minute budget across every
-- staff session and server instance, including concurrent refreshes.
create or replace function public.hub_begin_telemetry_check(p_app text, p_challenge_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s'
as $$
declare
  current_check public.hub_telemetry_checks%rowtype;
  server_time timestamptz;
begin
  if p_challenge_id is null then
    raise exception 'A connection challenge is required' using errcode = '22023';
  end if;
  perform 1 from public.hub_apps where slug = p_app and active for share;
  if not found then
    raise exception 'The event source is not active' using errcode = '22023';
  end if;

  server_time := clock_timestamp();
  insert into public.hub_telemetry_checks(app_slug, challenge_id, outcome, started_at, expires_at)
    values(p_app, p_challenge_id, 'pending', server_time, server_time + interval '30 seconds')
    on conflict(app_slug) do nothing returning * into current_check;
  if found then
    return jsonb_build_object('started', true, 'check', to_jsonb(current_check));
  end if;

  select * into current_check from public.hub_telemetry_checks where app_slug = p_app for update;
  server_time := clock_timestamp();
  if current_check.challenge_id = p_challenge_id
    or current_check.started_at > server_time - interval '60 seconds' then
    return jsonb_build_object('started', false, 'check', to_jsonb(current_check));
  end if;

  update public.hub_telemetry_checks
    set challenge_id = p_challenge_id, outcome = 'pending', started_at = server_time,
      expires_at = server_time + interval '30 seconds', accepted_at = null, latency_ms = null
    where app_slug = p_app returning * into current_check;
  return jsonb_build_object('started', true, 'check', to_jsonb(current_check));
end $$;

revoke all on function public.hub_begin_telemetry_check(text, uuid) from public, anon, authenticated;
grant execute on function public.hub_begin_telemetry_check(text, uuid) to service_role;

-- Called only after the ingestion route validates the app-specific HMAC and
-- the fixed production heartbeat payload. The nonce must have been issued by
-- Geofox; a signed unsolicited heartbeat cannot establish a connection.
create or replace function public.hub_accept_telemetry_check(
  p_app text, p_challenge_id uuid, p_occurred_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s'
as $$
declare
  current_check public.hub_telemetry_checks%rowtype;
  server_time timestamptz;
begin
  if p_challenge_id is null or p_occurred_at is null or not isfinite(p_occurred_at) then
    raise exception 'The connection receipt is invalid' using errcode = '22023';
  end if;
  perform 1 from public.hub_apps where slug = p_app and active for share;
  if not found then
    raise exception 'The event source is not active' using errcode = '22023';
  end if;

  select * into current_check from public.hub_telemetry_checks where app_slug = p_app for update;
  if not found or current_check.challenge_id <> p_challenge_id then
    raise exception 'The connection challenge does not match' using errcode = '22023';
  end if;
  server_time := clock_timestamp();
  if current_check.expires_at < server_time or current_check.started_at > server_time
    or p_occurred_at < server_time - interval '60 seconds'
    or p_occurred_at > server_time + interval '60 seconds' then
    raise exception 'The connection challenge has expired' using errcode = '22023';
  end if;
  if current_check.accepted_at is not null then
    -- Replaying a receipt never refreshes evidence of connectivity.
    return jsonb_build_object('accepted', true, 'duplicate', true, 'checkId', p_challenge_id);
  end if;

  update public.hub_telemetry_checks
    set outcome = 'connected', accepted_at = server_time, last_success_at = server_time, latency_ms = null
    where app_slug = p_app;
  return jsonb_build_object('accepted', true, 'duplicate', false, 'checkId', p_challenge_id);
end $$;

revoke all on function public.hub_accept_telemetry_check(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.hub_accept_telemetry_check(text, uuid, timestamptz) to service_role;

-- A transport response cannot create success: only the separate signed
-- receipt above can do that. A delayed finish never changes a newer check,
-- and a timeout cannot overwrite a receipt already accepted by the hub.
create or replace function public.hub_finish_telemetry_check(
  p_app text, p_challenge_id uuid, p_outcome text, p_latency_ms integer
)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s'
as $$
declare
  current_check public.hub_telemetry_checks%rowtype;
begin
  if p_challenge_id is null or p_outcome is null or p_outcome not in (
    'connected', 'authentication', 'source_not_configured', 'source_unavailable',
    'delivery_failed', 'invalid_response', 'timeout'
  ) or (p_latency_ms is not null and p_latency_ms not between 0 and 10000) then
    raise exception 'The connection result is invalid' using errcode = '22023';
  end if;
  perform 1 from public.hub_apps where slug = p_app and active for share;
  if not found then
    raise exception 'The event source is not active' using errcode = '22023';
  end if;

  select * into current_check from public.hub_telemetry_checks where app_slug = p_app for update;
  if not found then
    raise exception 'The connection check is not available' using errcode = '22023';
  end if;
  if current_check.challenge_id <> p_challenge_id then return to_jsonb(current_check); end if;
  if current_check.accepted_at is not null then
    update public.hub_telemetry_checks set latency_ms = coalesce(latency_ms, p_latency_ms)
      where app_slug = p_app returning * into current_check;
  elsif p_outcome = 'connected' then
    raise exception 'A matching connection receipt has not arrived' using errcode = '22023';
  elsif current_check.outcome = 'pending' then
    update public.hub_telemetry_checks set outcome = p_outcome, latency_ms = p_latency_ms
      where app_slug = p_app returning * into current_check;
  end if;
  return to_jsonb(current_check);
end $$;

revoke all on function public.hub_finish_telemetry_check(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.hub_finish_telemetry_check(text, uuid, text, integer) to service_role;

commit;
