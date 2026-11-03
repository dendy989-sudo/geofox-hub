-- Geofox project only. The platform's RLS helper runs as a DDL event trigger;
-- browser roles do not need permission to invoke it as a public RPC.
begin;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
      and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
