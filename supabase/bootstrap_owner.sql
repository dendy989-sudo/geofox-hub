-- Run once in the Geofox project's SQL Editor AFTER applying the migration.
-- First create/invite your own Auth user and verify its email address.
-- Replace only the email below with your verified company email.
-- This script is never called by the public website or a signup route.
begin;
do $$
declare
  owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL';
  owner_id uuid;
begin
  perform pg_advisory_xact_lock(710432821);
  if owner_email = 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL' then
    raise exception 'Replace the owner email before running this script';
  end if;
  select id into owner_id from auth.users
  where lower(email)=lower(trim(owner_email)) and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until<=now());
  if owner_id is null then
    raise exception 'A verified Auth user with this email does not exist in this Geofox project';
  end if;
  if exists(select 1 from public.hub_staff where role='owner' and active and user_id<>owner_id) then
    raise exception 'An owner already exists. Manage additional staff through the authorized owner workflow';
  end if;
  insert into public.hub_staff(user_id,display_name,role,active)
  values(owner_id,'Geofox owner','owner',true)
  on conflict(user_id) do update set role='owner',active=true,updated_at=now();
  insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary)
  values(owner_id,'owner.bootstrapped','staff',owner_id::text,'Verified company owner granted access in SQL Editor');
end $$;
commit;
