-- Supabase's default privileges can grant ALL to service_role on new tables.
-- The private allowlist is administered through migrations, never app writes.
revoke all privileges on table public.finance_access from service_role;
grant select on table public.finance_access to service_role;
