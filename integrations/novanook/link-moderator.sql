-- Run in the NOVANOOK SQL Editor after installing the bridge.
-- Replace both zero UUIDs with the SAME PERSON'S account IDs from the two projects.
-- Geofox role authorization is checked by the Geofox server on every request.
-- NovaNook moderator membership must already have been assigned using its
-- existing owner bootstrap or moderator-management workflow.
-- This script only links identities. It grants no staff/moderator/admin role.
begin;
do $$
declare
  geofox_staff_user_id uuid := '00000000-0000-0000-0000-000000000000';
  novanook_moderator_user_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if geofox_staff_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    or novanook_moderator_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace both placeholder UUIDs with verified account IDs before running this script.';
  end if;
  if not exists(select 1 from public.booknook_moderators
    where user_id = novanook_moderator_user_id and active)
    or not exists(select 1 from auth.users where id = novanook_moderator_user_id
      and deleted_at is null and (banned_until is null or banned_until <= now()))
    or not public.booknook_moderator_account_eligible(novanook_moderator_user_id) then
    raise exception 'The NovaNook account must already be an active moderator with a verified email, adult eligibility, no deletion request and no current account ban or deletion.';
  end if;
  insert into public.booknook_geofox_staff_links(hub_user_id, novanook_user_id)
    values(geofox_staff_user_id, novanook_moderator_user_id)
    on conflict(hub_user_id) do update
      set novanook_user_id = excluded.novanook_user_id, linked_at = now();
end $$;
commit;
