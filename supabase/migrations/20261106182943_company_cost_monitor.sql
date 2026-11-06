begin;
set local lock_timeout='10s';
create table public.hub_cost_services (
 id text primary key check(id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 connector text not null check(connector in ('gateway','isbn','manual')),
 app_slug text references public.hub_apps(slug),
 config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<16000),
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.hub_cost_samples (
 id bigint generated always as identity primary key,
 service_id text not null references public.hub_cost_services(id),
 source text not null check(source in ('gateway','isbn','manual')),
 captured_at timestamptz not null default now(),
 balance_usd numeric(18,6), cumulative_usd numeric(18,6), usage_count numeric(18,4), usage_period text,
 error text,
 check(cumulative_usd is null or cumulative_usd>=0), check(usage_count is null or usage_count>=0)
);
create index hub_cost_samples_recent on public.hub_cost_samples(service_id,captured_at desc,id desc);
create table public.hub_cost_alerts (
 key text primary key, service_id text not null references public.hub_cost_services(id),
 severity text not null check(severity in ('warning','critical','exhausted')),
 title text not null, detail text not null, active boolean not null default true,
 revision integer not null default 1, opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 email_state text not null default 'none' check(email_state in ('none','pending','accepted','failed','uncertain')),
 email_revision integer, email_at timestamptz
);
create table public.hub_cost_monitor (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 owner_id uuid references auth.users(id), email_enabled boolean not null default true,
 lease uuid, lease_until timestamptz, last_started_at timestamptz, last_completed_at timestamptz
);
insert into public.hub_cost_monitor(singleton) values(true);
do $$ declare t text; begin
 foreach t in array array['hub_cost_services','hub_cost_samples','hub_cost_alerts','hub_cost_monitor'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.hub_cost_samples_id_seq to service_role;
-- These are inventory entries, not invented bills or statements of account status.
insert into public.hub_cost_services(id,connector,app_slug,config) values
 ('ai-gateway','gateway',null,'{"name":"Vercel AI Gateway","kind":"prepaid","autoReload":"unknown","warningBalance":10,"criticalBalance":5,"notes":"Team-wide credit balance and total consumption. Purchases and usage are separate."}'),
 ('vercel','manual',null,'{"name":"Vercel hosting & builds","kind":"usage","notes":"Connect billing/usage exports. Include functions, bandwidth, builds and sandboxes; AI Gateway is separate."}'),
 ('supabase','manual',null,'{"name":"Supabase databases & storage","kind":"usage","notes":"Record the organization invoice once. Track each project/resource with separate meters as needed."}'),
 ('github','manual',null,'{"name":"GitHub Actions & storage","kind":"usage","usageUnit":"minutes","usagePeriod":"monthly","notes":"Enter the current account allowance and actual usage; no plan limit is assumed."}'),
 ('isbndb','isbn','novanook','{"name":"ISBNdb · NovaNook","kind":"subscription","usageUnit":"reported requests","usagePeriod":"daily","notes":"Passive NovaNook request telemetry, not provider-wide billing. Enter the verified daily allowance."}'),
 ('google-books','manual','novanook','{"name":"Google Books API","kind":"usage","usageUnit":"requests","usagePeriod":"daily","notes":"Enter the project quota and usage from Google Cloud."}'),
 ('resend','manual',null,'{"name":"Resend email","kind":"usage","usageUnit":"emails","usagePeriod":"monthly","notes":"Connect the actual sending allowance and invoice."}'),
 ('godaddy','manual',null,'{"name":"GoDaddy domains & email","kind":"subscription","notes":"Add domain and mailbox renewal dates and actual bills."}'),
 ('apple','manual',null,'{"name":"Apple Developer membership","kind":"annual","notes":"Enter paid membership invoice and renewal. Store commissions are separate from membership."}'),
 ('google-play','manual',null,'{"name":"Google Play developer account","kind":"one_time","notes":"Record the registration payment when paid. Do not assume it has already been paid."}'),
 ('codemagic','manual',null,'{"name":"Codemagic mobile builds","kind":"usage","usageUnit":"build minutes","usagePeriod":"monthly","notes":"Enter the actual build plan and usage allowance."}');

create function public.hub_cost_save(p_actor uuid,p_id text,p_version integer,p_app text,p_config jsonb)
returns void language plpgsql security invoker set search_path='' as $$ begin
 perform public.hub_alfred_owner(p_actor);
 if jsonb_typeof(p_config)<>'object' or length(coalesce(p_config->>'name','')) not between 1 and 160 then raise exception 'Invalid service' using errcode='22023'; end if;
 if p_app is not null and not exists(select 1 from public.hub_apps where slug=p_app and active) then raise exception 'Invalid app' using errcode='42501'; end if;
 if p_version is null then
  insert into public.hub_cost_services(id,connector,app_slug,config) values(p_id,'manual',p_app,p_config);
 else
  update public.hub_cost_services set config=p_config,app_slug=p_app,version=version+1,updated_at=now()
  where id=p_id and version=p_version and (connector='manual' or app_slug is not distinct from p_app);
  if not found then raise exception 'Service changed or scope locked' using errcode='40001'; end if;
 end if;
 insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary) values(p_actor,'cost.service.saved','cost',p_id,'Service monitoring configuration updated; provider billing not changed');
end $$;

create function public.hub_cost_claim(p_actor uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$ declare s public.hub_cost_monitor; begin
 perform public.hub_alfred_owner(p_actor);
 select * into s from public.hub_cost_monitor where singleton for update;
 if not s.enabled or s.owner_id is distinct from p_actor or s.lease_until>now() or s.last_started_at>now()-interval '60 seconds' then return false; end if;
 update public.hub_cost_monitor set lease=p_lease,lease_until=now()+interval '110 seconds',last_started_at=now() where singleton;
 return true;
end $$;

create function public.hub_cost_publish(p_actor uuid,p_lease uuid,p_alerts jsonb)
returns void language plpgsql security invoker set search_path='' as $$ declare item jsonb; begin
 perform public.hub_alfred_owner(p_actor);
 perform 1 from public.hub_cost_monitor where singleton and lease=p_lease and lease_until>now() and enabled for update;
 if not found then raise exception 'Check lease expired' using errcode='40001'; end if;
 if jsonb_typeof(p_alerts)<>'array' or jsonb_array_length(p_alerts)>1000 then raise exception 'Invalid alerts' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_alerts) loop
  insert into public.hub_cost_alerts as a(key,service_id,severity,title,detail) values(item->>'key',item->>'serviceId',item->>'severity',left(item->>'title',200),left(item->>'detail',1200))
  on conflict(key) do update set severity=excluded.severity,title=excluded.title,detail=excluded.detail,active=true,updated_at=now(),
   revision=case when not a.active or a.severity<>excluded.severity then a.revision+1 else a.revision end,
   email_state=case when not a.active or a.severity<>excluded.severity then 'none' else a.email_state end;
 end loop;
 update public.hub_cost_alerts set active=false,updated_at=now() where active and key not in(select value->>'key' from jsonb_array_elements(p_alerts));
 update public.hub_cost_monitor set last_completed_at=now(),lease_until=null where singleton;
end $$;

create function public.hub_cost_claim_mail(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare result jsonb; begin
 perform public.hub_alfred_owner(p_actor);
 perform 1 from public.hub_cost_monitor where singleton and enabled and email_enabled and owner_id=p_actor for update;
 if not found then return '[]'; end if;
 update public.hub_cost_alerts set email_state='uncertain' where email_state='pending' and email_at<now()-interval '10 minutes';
 with chosen as (select key from public.hub_cost_alerts where active and email_state='none' order by opened_at limit 50 for update skip locked), changed as (
 update public.hub_cost_alerts a set email_state='pending',email_revision=revision,email_at=now() from chosen c where a.key=c.key returning a.*)
 select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into result from changed;
 return result;
end $$;

create function public.hub_cost_dashboard(p_actor uuid,p_scope text,p_month text)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare result jsonb; begin
 perform public.hub_alfred_owner(p_actor);
 if p_scope not in ('all','company') and not exists(select 1 from public.hub_apps where slug=p_scope and active) then raise exception 'Invalid app' using errcode='42501'; end if;
 if p_month !~ '^20[0-9]{2}-(0[1-9]|1[012])$' then raise exception 'Invalid month' using errcode='22023'; end if;
 select jsonb_build_object(
  'services',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object(
   'latest',(select to_jsonb(x) from public.hub_cost_samples x where service_id=s.id order by captured_at desc,id desc limit 1),
   'good',(select to_jsonb(x) from public.hub_cost_samples x where service_id=s.id and error is null order by captured_at desc,id desc limit 1),
   'monthStart',(select to_jsonb(x) from public.hub_cost_samples x where service_id=s.id and error is null and captured_at>=((p_month||'-01')::date::timestamp at time zone 'UTC') and captured_at<(((p_month||'-01')::date+interval '1 month') at time zone 'UTC') order by captured_at,id limit 1),
   'monthEnd',(select to_jsonb(x) from public.hub_cost_samples x where service_id=s.id and error is null and captured_at>=((p_month||'-01')::date::timestamp at time zone 'UTC') and captured_at<(((p_month||'-01')::date+interval '1 month') at time zone 'UTC') order by captured_at desc,id desc limit 1),
   'weekStart',(select to_jsonb(x) from public.hub_cost_samples x where service_id=s.id and error is null and captured_at>=now()-interval '7 days' order by captured_at,id limit 1)
  ) order by s.config->>'name') from public.hub_cost_services s where p_scope='all' or (p_scope='company' and s.app_slug is null) or s.app_slug=p_scope),'[]'),
  'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.active desc,a.updated_at desc) from public.hub_cost_alerts a join public.hub_cost_services s on s.id=a.service_id where p_scope='all' or (p_scope='company' and s.app_slug is null) or s.app_slug=p_scope),'[]'),
  'cash', (select jsonb_build_object('paid',coalesce(sum((data->>'amountCents')::bigint) filter(where status='paid'),0),'pending',coalesce(sum((data->>'amountCents')::bigint) filter(where status='pending'),0),'count',count(*)) from public.hub_workspace_records where module='accounting' and deleted_at is null and data->>'type'='expense' and data->>'currency'='USD' and left(data->>'occurredOn',7)=p_month and (p_scope='all' or (p_scope='company' and app_slug is null) or app_slug=p_scope)),
  'monitor',(select jsonb_build_object('enabled',enabled,'emailEnabled',email_enabled,'lastStartedAt',last_started_at,'lastCompletedAt',last_completed_at) from public.hub_cost_monitor where singleton),
  'month',p_month
 ) into result;
 return result;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'hub_cost_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
