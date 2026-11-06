begin;
set local lock_timeout='10s';
create table public.hub_ops_settings(
 singleton boolean primary key default true check(singleton), owner_id uuid references auth.users(id),
 enabled boolean not null default false, support_enabled boolean not null default false, incidents_enabled boolean not null default false,
 max_daily_runs integer not null default 8 check(max_daily_runs between 1 and 40),version integer not null default 1,updated_at timestamptz not null default now()
);
insert into public.hub_ops_settings(singleton) values(true);
create table public.hub_ops_jobs(
 id uuid primary key, dedupe_key text not null unique check(length(dedupe_key)<=200),
 kind text not null check(kind in ('support','incident','publish','email_test')),
 actor_id uuid not null references auth.users(id), ref_id uuid,
 state text not null default 'running' check(state in ('scheduled','running','completed','needs_review','cancelled')),
 payload jsonb not null default '{}', result jsonb, run_id uuid references public.hub_alfred_runs(id),
 created_at timestamptz not null default now(),finished_at timestamptz,scheduled_at timestamptz,
 check(octet_length(payload::text)<30000),check(result is null or octet_length(result::text)<12000)
);
create index hub_ops_jobs_recent on public.hub_ops_jobs(created_at desc);
create index hub_ops_jobs_due on public.hub_ops_jobs(scheduled_at) where state='scheduled';
create table public.hub_ops_mail(
 id uuid primary key, sender text not null check(length(sender)<=254), recipient text not null check(length(recipient)<=254),
 subject text not null check(length(subject)<=180),body text not null check(length(body)<=12000),
 received_at timestamptz not null default now(), attachment_count integer not null default 0,
 state text not null default 'review' check(state in ('review','routed','ignored')), ticket_id uuid references public.hub_tickets(id),
 note text not null default 'Email sender is not an authenticated customer identity. Attachments are not imported.'
);
create table public.hub_ops_checks(
 key text primary key,state text not null check(state in ('verified','blocked','failed','configured')),
 summary text not null check(length(summary)<=1200), data jsonb not null default '{}', checked_at timestamptz not null default now(),
 check(octet_length(data::text)<200000)
);
create table public.hub_ops_repairs(
 id uuid primary key,actor_id uuid not null references auth.users(id),run_id uuid references public.hub_alfred_runs(id),
 app_slug text references public.hub_apps(slug),repo text not null,base_sha text not null check(base_sha~'^[0-9a-f]{40}$'),
 summary text not null,files jsonb not null check(jsonb_typeof(files)='array' and octet_length(files::text)<150000),
 state text not null default 'draft' check(state in ('draft','creating','open','needs_review','rejected')),
 result jsonb,created_at timestamptz not null default now()
);
create table public.hub_ops_invoices(
 service_id text not null references public.hub_cost_services(id),reference text not null check(length(reference) between 1 and 120),
 record_id uuid not null references public.hub_workspace_records(id),payload jsonb not null,created_at timestamptz not null default now(),primary key(service_id,reference)
);
do $$ declare t text;begin foreach t in array array['hub_ops_settings','hub_ops_jobs','hub_ops_mail','hub_ops_checks','hub_ops_repairs','hub_ops_invoices'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;end $$;
create function public.hub_ops_configure(p_actor uuid,p_version integer,p_enabled boolean,p_support boolean,p_incidents boolean,p_daily integer)
returns void language plpgsql security invoker set search_path='' as $$ begin
 perform public.hub_alfred_owner(p_actor);
 if p_enabled and not exists(select 1 from public.hub_alfred_settings where singleton and consent_at is not null) then raise exception 'Alfred processing consent required' using errcode='42501';end if;
 update public.hub_ops_settings set owner_id=p_actor,enabled=p_enabled,support_enabled=p_support,incidents_enabled=p_incidents,max_daily_runs=p_daily,version=version+1,updated_at=now() where singleton and version=p_version;
 if not found then raise exception 'Settings changed' using errcode='40001';end if;
 insert into public.hub_audit_log(actor_id,action,entity_type,summary) values(p_actor,'alfred.workflows.configured','alfred','Bounded draft workflows updated; customer replies, public posts and code changes still require exact approval');
end $$;
create function public.hub_ops_claim(p_actor uuid,p_id uuid,p_key text,p_kind text,p_ref uuid,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$ declare s public.hub_ops_settings;begin
 perform public.hub_alfred_owner(p_actor);select * into s from public.hub_ops_settings where singleton for update;
 if p_kind not in ('support','incident') then raise exception 'Invalid automated workflow' using errcode='22023';end if;
 if not s.enabled or s.owner_id is distinct from p_actor or (p_kind='support' and not s.support_enabled) or (p_kind='incident' and not s.incidents_enabled) then return false;end if;
 if not exists(select 1 from public.hub_alfred_settings where singleton and enabled and consent_at is not null) then return false;end if;
 update public.hub_ops_jobs set state='needs_review',result='{"message":"Interrupted workflow; inspect the linked investigation before retrying."}',finished_at=now() where state='running' and kind in ('support','incident') and created_at<now()-interval '5 minutes';
 if exists(select 1 from public.hub_ops_jobs where dedupe_key=p_key) or exists(select 1 from public.hub_ops_jobs where kind in ('support','incident') and state='running') then return false;end if;
 if (select count(*) from public.hub_ops_jobs where kind in ('support','incident') and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=s.max_daily_runs then return false;end if;
 insert into public.hub_ops_jobs(id,dedupe_key,kind,actor_id,ref_id,payload) values(p_id,p_key,p_kind,p_actor,p_ref,p_payload);return true;
end $$;
create function public.hub_ops_route_mail(p_actor uuid,p_id uuid,p_app text,p_ignore boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare m public.hub_ops_mail;t public.hub_tickets;begin
 perform public.hub_alfred_owner(p_actor);select * into m from public.hub_ops_mail where id=p_id for update;
 if not found then raise exception 'Email missing' using errcode='P0002';end if;
 if m.state<>'review' then return jsonb_build_object('state',m.state,'ticketId',m.ticket_id);end if;
 if p_ignore then update public.hub_ops_mail set state='ignored' where id=p_id;return jsonb_build_object('state','ignored');end if;
 if not exists(select 1 from public.hub_apps where slug=p_app and active) then raise exception 'Choose an active app' using errcode='22023';end if;
 insert into public.hub_tickets(app_slug,email,subject,source,identity_verified,category) values(p_app,m.sender,left(case when length(m.subject)<3 then 'Email inquiry' else m.subject end,180),'email',false,'general') returning * into t;
 insert into public.hub_ticket_messages(ticket_id,body,author_name,author_kind,internal) values(t.id,left('[Imported email; sender is NOT account-verified. Do not disclose account-specific data without verification.]'||E'\n\n'||m.body,12000),'Email sender','guest',false);
 update public.hub_ops_mail set state='routed',ticket_id=t.id where id=p_id;
 insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,p_app,'alfred.email.routed','ticket',t.id::text,'Owner routed an unverified email to a new support ticket; no account identity granted');
 return jsonb_build_object('state','routed','ticketId',t.id,'reference',t.reference);
end $$;
create function public.hub_ops_schedule(p_actor uuid,p_id uuid,p_record uuid,p_version integer,p_platform text,p_account text,p_when timestamptz)
returns void language plpgsql security invoker set search_path='' as $$ declare r public.hub_workspace_records;begin
 perform public.hub_alfred_owner(p_actor);select * into r from public.hub_workspace_records where id=p_record and deleted_at is null for update;
 if not found or r.module<>'marketing' or r.data->>'kind'<>'post' or r.version<>p_version or r.status not in ('draft','scheduled') then raise exception 'Post changed' using errcode='40001';end if;
 if p_platform not in ('facebook','x') or not (r.data->'platforms' ? p_platform) or r.data->>'contentType'<>'text' or jsonb_array_length(r.data->'media')<>0 or r.data->'thumbnail'<>'null'::jsonb then raise exception 'Only supported text posts can be scheduled' using errcode='22023';end if;
 if p_when is null or p_when<=now() or p_when>now()+interval '90 days' or p_account !~ '^[0-9]{1,40}$' then raise exception 'Invalid schedule' using errcode='22023';end if;
 if exists(select 1 from public.hub_ops_jobs where ref_id=p_record and kind='publish' and state in ('scheduled','running')) then raise exception 'A publication is already approved for this post' using errcode='40001';end if;
 insert into public.hub_ops_jobs(id,dedupe_key,kind,actor_id,ref_id,state,payload,scheduled_at) values(p_id,'publish:'||p_id,'publish',p_actor,p_record,'scheduled',jsonb_build_object('version',p_version,'platform',p_platform,'expectedAccountId',p_account,'title',r.title),p_when);
 insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata) values(p_actor,r.app_slug,'alfred.post.approved','marketing',p_record::text,'Owner approved an exact post version, account and future publication',jsonb_build_object('jobId',p_id,'version',p_version,'platform',p_platform,'scheduledAt',p_when));
end $$;
create function public.hub_ops_take_scheduled(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare j public.hub_ops_jobs;begin
 perform public.hub_alfred_owner(p_actor);
 if not exists(select 1 from public.hub_ops_settings where singleton and enabled and owner_id=p_actor) or not exists(select 1 from public.hub_alfred_settings where singleton and enabled) then return null;end if;
 update public.hub_ops_jobs set state='needs_review',finished_at=now(),result='{"message":"Publication attempt was interrupted; inspect the native account. No automatic resend."}' where kind='publish' and state='running' and scheduled_at<now()-interval '5 minutes';
 update public.hub_ops_jobs set state='needs_review',finished_at=now(),result='{"message":"Missed approved publication window; approve a new time after review."}' where kind='publish' and state='scheduled' and scheduled_at<now()-interval '30 minutes';
 select * into j from public.hub_ops_jobs where kind='publish' and state='scheduled' and actor_id=p_actor and scheduled_at<=now() order by scheduled_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.hub_ops_jobs set state='running' where id=j.id;return to_jsonb(j);
end $$;
create function public.hub_ops_claim_repair(p_actor uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare r public.hub_ops_repairs;begin
 perform public.hub_alfred_owner(p_actor);
 if not exists(select 1 from public.hub_alfred_settings where singleton and enabled) then raise exception 'Alfred is paused' using errcode='42501';end if;
 update public.hub_ops_repairs set state='creating' where id=p_id and state='draft' and actor_id=p_actor and created_at>now()-interval '1 day' returning * into r;
 if not found then raise exception 'Repair changed, expired or already claimed' using errcode='40001';end if;
 insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,r.app_slug,'alfred.repair.approved','alfred_repair',p_id::text,'Owner approved exact patch for a DRAFT pull request only; no merge or deployment authorized');
 return to_jsonb(r);
end $$;
create function public.hub_ops_import_bills(p_actor uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare item jsonb; s public.hub_cost_services; old public.hub_ops_invoices; saved jsonb; n integer:=0;replayed integer:=0;begin
 perform public.hub_alfred_owner(p_actor);
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Invalid invoice batch' using errcode='22023';end if;
 if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct (value->>'serviceId',value->>'reference')) from jsonb_array_elements(p_rows)) then raise exception 'Duplicate invoice references' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) order by value->>'serviceId',value->>'reference' loop
  if length(coalesce(item->>'reference','')) not between 1 and 120 or item->>'status' not in ('paid','pending') or jsonb_typeof(item->'amountCents') is distinct from 'number' or (item->>'amountCents')::numeric not between 1 and 100000000 or (item->>'amountCents')::numeric<>trunc((item->>'amountCents')::numeric) then raise exception 'Invalid invoice fields' using errcode='22023';end if;
  if item->>'date' !~ '^20[0-9]{2}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])$' then raise exception 'Invalid invoice date' using errcode='22023';end if;
  perform (item->>'date')::date;
  select * into s from public.hub_cost_services where id=item->>'serviceId' for update;
  if not found then raise exception 'Unknown invoice service' using errcode='P0002';end if;
  select * into old from public.hub_ops_invoices where service_id=s.id and reference=item->>'reference';
  if found then
   if old.payload is distinct from item then raise exception 'Previously imported invoice differs; review the existing record' using errcode='40001';end if;
   replayed:=replayed+1;continue;
  end if;
  if exists(select 1 from public.hub_workspace_records where module='accounting' and deleted_at is null and data->>'reference'=item->>'reference' and data->>'payee'=s.config->>'name') then raise exception 'Invoice reference already exists in Accounting; review before importing' using errcode='40001';end if;
  saved:=public.hub_workspace_save(p_actor,null,null,'accounting',s.app_slug,left((s.config->>'name')||' · '||(item->>'reference'),200),item->>'status',jsonb_build_object('type','expense','currency','USD','amountCents',(item->>'amountCents')::bigint,'occurredOn',item->>'date','category','Hosting & infrastructure','payee',s.config->>'name','reference',item->>'reference','notes','Owner-reviewed invoice import. Not provider-confirmed payment. Attach receipt in Accounting.','attachments','[]'::jsonb),gen_random_uuid());
  insert into public.hub_ops_invoices(service_id,reference,record_id,payload) values(s.id,item->>'reference',(saved->>'id')::uuid,item);n:=n+1;
 end loop;
 insert into public.hub_audit_log(actor_id,action,entity_type,summary,metadata) values(p_actor,'alfred.bills.imported','accounting','Owner-reviewed invoice batch imported atomically',jsonb_build_object('created',n,'alreadyRecorded',replayed));
 return jsonb_build_object('created',n,'alreadyRecorded',replayed);
end $$;
do $$ declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'hub_ops_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
commit;
