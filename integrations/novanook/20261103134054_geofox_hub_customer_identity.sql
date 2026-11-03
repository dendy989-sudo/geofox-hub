-- NovaNook source database only: verified identity for in-app customer support.
-- Additive and independent of the staff operations bridge. No source data,
-- account policies, sessions, or existing grants are changed.
-- The Geofox API must first validate the access token with this source's Auth
-- getUser(token), then pass that user's id and the verified token's session_id.
-- Caller-supplied user/session IDs are not proof of customer authentication.
begin;
set local lock_timeout = '3s';

do $$
declare
  prerequisite record;
  source_relation regclass;
  source_type oid;
begin
  if pg_catalog.to_regprocedure('auth.role()') is null then
    raise exception 'Geofox customer identity prerequisite missing: auth.role(). Apply only to a Supabase source database.' using errcode = '55000';
  end if;
  -- PL/pgSQL does not plan embedded queries until first use. Fail atomically
  -- before adding the RPC if any required current-identity field is unavailable.
  -- auth.users.email is varchar in Supabase; text is also safe for this RPC.
  for prerequisite in select * from (values
    ('users', 'id', array['uuid']),
    ('users', 'email', array['text', 'character varying']),
    ('users', 'email_confirmed_at', array['timestamp with time zone']),
    ('users', 'deleted_at', array['timestamp with time zone']),
    ('users', 'banned_until', array['timestamp with time zone']),
    ('users', 'is_anonymous', array['boolean']),
    ('sessions', 'id', array['uuid']),
    ('sessions', 'user_id', array['uuid']),
    ('sessions', 'not_after', array['timestamp with time zone'])
  ) as required(table_name, column_name, allowed_types) loop
    source_relation := pg_catalog.to_regclass(pg_catalog.format('auth.%I', prerequisite.table_name));
    if source_relation is null then
      raise exception 'Geofox customer identity prerequisite missing: auth.%.', prerequisite.table_name using errcode = '55000';
    end if;
    select a.atttypid into source_type
      from pg_catalog.pg_attribute a
      where a.attrelid = source_relation and a.attname = prerequisite.column_name
        and a.attnum > 0 and not a.attisdropped;
    if source_type is null then
      raise exception 'Geofox customer identity prerequisite missing: auth.%.%.', prerequisite.table_name, prerequisite.column_name using errcode = '55000';
    end if;
    if not exists (
      select 1 from pg_catalog.unnest(prerequisite.allowed_types) as expected(type_name)
      where source_type = pg_catalog.to_regtype(expected.type_name)::oid
    ) then
      raise exception 'Geofox customer identity prerequisite incompatible: auth.%.% type.', prerequisite.table_name, prerequisite.column_name using errcode = '55000';
    end if;
  end loop;
end $$;

create or replace function public.geofox_hub_customer_identity(p_user_id uuid, p_session_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  identity_json jsonb;
begin
  -- EXECUTE grants and this JWT-role check are independent gates. The source
  -- service credential stays on the Geofox server, never in a customer client.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Geofox server credentials required' using errcode = '42501';
  end if;
  if p_user_id is null or p_session_id is null then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'emailVerified', true
  ) into identity_json
  from auth.users u
  join auth.sessions s on s.user_id = u.id and s.id = p_session_id
  where u.id = p_user_id
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= pg_catalog.statement_timestamp())
    and u.email_confirmed_at is not null
    and u.email is not null and pg_catalog.btrim(u.email) <> ''
    and u.is_anonymous is false
    and (s.not_after is null or s.not_after > pg_catalog.statement_timestamp());

  -- All ineligible/missing account or session states have the same result.
  -- No subscriptions, social holds, profiles, reading data, or metadata are read.
  return identity_json;
end $$;

comment on function public.geofox_hub_customer_identity(uuid, uuid) is
  'Service-only source identity lookup after Auth token validation. Returns {id,email,emailVerified:true} or SQL NULL. Checks current verified nonanonymous account plus matching retained session and explicit not_after deadline; no billing or social-moderation gate.';

revoke all on function public.geofox_hub_customer_identity(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.geofox_hub_customer_identity(uuid, uuid) to service_role;

-- This is a point-in-time read. Row locks cannot make a subsequent write in the
-- separate Geofox database atomic with source sign-out/account changes. Recheck
-- on every customer request; do not cache this identity authorization result.
-- A null not_after means no explicit stored deadline, not proof that all project
-- time-box/inactivity/single-session settings have been evaluated. Supabase may
-- retain sessions pending refresh/cleanup; this RPC does not guess those settings.
-- https://supabase.com/docs/guides/auth/sessions
commit;
