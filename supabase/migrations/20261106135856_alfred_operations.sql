begin;
set local lock_timeout='10s';

-- Alfred is a private owner workspace, not a customer-facing chatbot.
create table if not exists public.hub_alfred_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 consent_at timestamptz,
 daily_limit_cents integer not null default 500 check(daily_limit_cents between 25 and 5000),
 monthly_limit_cents integer not null default 2500 check(monthly_limit_cents between 25 and 50000),
 scheduled_enabled boolean not null default false,
 scheduled_by uuid references auth.users(id) on delete set null,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.hub_alfred_settings(singleton) values(true) on conflict(singleton) do nothing;
create table if not exists public.hub_alfred_runs (
 id uuid primary key,
 actor_id uuid not null references auth.users(id),
 scope text not null check(char_length(scope) between 1 and 48),
 department text not null check(department in ('briefing','support','marketing','accounting','engineering','product','legal')),
 question text not null check(char_length(question)<=4000),
 request_hash text not null check(char_length(request_hash)=64),
 state text not null default 'running' check(state in ('running','completed','failed')),
 output jsonb,
 evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array' and octet_length(evidence::text)<=100000),
 budget_cents integer not null default 25 check(budget_cents between 0 and 100000),
 estimated_usd numeric(12,6),
 input_tokens integer, output_tokens integer,
 error text,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists hub_alfred_runs_created_idx on public.hub_alfred_runs(created_at desc);
create index if not exists hub_alfred_runs_actor_idx on public.hub_alfred_runs(actor_id,created_at desc);
create table if not exists public.hub_alfred_actions (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.hub_alfred_runs(id),
 kind text not null check(kind in ('task','marketing_draft','support_reply')),
 app_slug text references public.hub_apps(slug),
 title text not null check(char_length(title) between 1 and 200),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=20000),
 state text not null default 'pending' check(state in ('pending','executing','completed','rejected','needs_review')),
 approved_by uuid references auth.users(id),
 result jsonb,
 created_at timestamptz not null default now(), decided_at timestamptz,
 expires_at timestamptz not null default (now()+interval '7 days')
);
create index if not exists hub_alfred_actions_state_idx on public.hub_alfred_actions(state,created_at desc);
create index if not exists hub_alfred_actions_run_idx on public.hub_alfred_actions(run_id);
create index if not exists hub_alfred_actions_app_idx on public.hub_alfred_actions(app_slug);
create index if not exists hub_alfred_actions_approver_idx on public.hub_alfred_actions(approved_by);
create table if not exists public.hub_alfred_knowledge (
 id uuid primary key default gen_random_uuid(),
 app_slug text references public.hub_apps(slug),
 title text not null check(char_length(title) between 1 and 180),
 body text not null check(char_length(body) between 1 and 6000),
 enabled boolean not null default true,
 version integer not null default 1,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index if not exists hub_alfred_knowledge_app_idx on public.hub_alfred_knowledge(app_slug);
create index if not exists hub_alfred_knowledge_actor_idx on public.hub_alfred_knowledge(updated_by);

do $$ declare t text; begin
 foreach t in array array['hub_alfred_settings','hub_alfred_runs','hub_alfred_actions','hub_alfred_knowledge'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.hub_alfred_owner(p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if public.hub_workspace_role(p_actor) is distinct from 'owner' then
  raise exception 'Only an active verified owner can use Alfred' using errcode='42501';
 end if;
end $$;

create or replace function public.hub_alfred_configure(p_actor uuid,p_version integer,p_enabled boolean,p_consent boolean,p_daily integer,p_monthly integer,p_scheduled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hub_alfred_settings; begin
 perform public.hub_alfred_owner(p_actor);
 select * into s from public.hub_alfred_settings where singleton for update;
 if s.version is distinct from p_version then raise exception 'Settings changed' using errcode='40001'; end if;
 if p_enabled and s.consent_at is null and not coalesce(p_consent,false) then raise exception 'Data processing consent required' using errcode='22023'; end if;
 update public.hub_alfred_settings set enabled=p_enabled,
  consent_at=case when p_consent then coalesce(consent_at,now()) else consent_at end,
  daily_limit_cents=p_daily,monthly_limit_cents=p_monthly,scheduled_enabled=p_scheduled,
  scheduled_by=case when p_scheduled then p_actor else null end,version=version+1,updated_at=now()
 where singleton returning * into s;
 insert into public.hub_audit_log(actor_id,action,entity_type,summary,metadata) values
 (p_actor,'alfred.settings','alfred','Alfred operating controls updated',jsonb_build_object('enabled',p_enabled,'scheduled',p_scheduled,'dailyCents',p_daily,'monthlyCents',p_monthly));
 return to_jsonb(s);
end $$;

create or replace function public.hub_alfred_begin(p_actor uuid,p_id uuid,p_scope text,p_department text,p_question text,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hub_alfred_settings; r public.hub_alfred_runs; day_total bigint; month_total bigint; begin
 perform public.hub_alfred_owner(p_actor);
 select * into s from public.hub_alfred_settings where singleton for update;
 select * into r from public.hub_alfred_runs where id=p_id;
 if found then
  if r.actor_id<>p_actor or r.request_hash<>p_hash then raise exception 'Request conflict' using errcode='23505'; end if;
  return jsonb_build_object('replayed',true,'run',to_jsonb(r));
 end if;
 if not s.enabled or s.consent_at is null then raise exception 'Alfred is paused; activate in controls' using errcode='P0201'; end if;
 if p_scope not in ('all','company') and not exists(select 1 from public.hub_apps where slug=p_scope and active) then raise exception 'Invalid app' using errcode='22023'; end if;
 if (select count(*) from public.hub_alfred_runs where created_at>now()-interval '5 minutes')>=10 then raise exception 'Run rate limit reached' using errcode='P0202'; end if;
 update public.hub_alfred_runs set state='failed',error='Interrupted run. Its budget reservation is retained; review before retrying.',finished_at=now() where state='running' and created_at<now()-interval '5 minutes';
 if (select count(*) from public.hub_alfred_runs where state='running')>=2 then raise exception 'Two runs are already active' using errcode='P0202'; end if;
 select coalesce(sum(budget_cents) filter(where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(budget_cents),0)
 into day_total,month_total from public.hub_alfred_runs where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 if day_total+25>s.daily_limit_cents or month_total+25>s.monthly_limit_cents then raise exception 'Alfred budget limit reached' using errcode='P0203'; end if;
 insert into public.hub_alfred_runs(id,actor_id,scope,department,question,request_hash) values(p_id,p_actor,p_scope,p_department,p_question,p_hash) returning * into r;
 insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary) values(p_actor,'alfred.run.started','alfred',p_id::text,'Alfred investigation started');
 return jsonb_build_object('replayed',false,'run',to_jsonb(r));
end $$;

create or replace function public.hub_alfred_finish(p_actor uuid,p_id uuid,p_output jsonb,p_evidence jsonb,p_actions jsonb,p_input integer,p_output_tokens integer,p_cost numeric,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.hub_alfred_runs; a jsonb; app text; begin
 perform public.hub_alfred_owner(p_actor);
 select * into r from public.hub_alfred_runs where id=p_id and actor_id=p_actor for update;
 if not found then raise exception 'Run unavailable' using errcode='P0002'; end if;
 if r.state<>'running' then return; end if;
 if octet_length(coalesce(p_output,'{}')::text)>60000 or jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions)>4 then raise exception 'Invalid output' using errcode='22023'; end if;
 update public.hub_alfred_runs set state=case when p_error is null then 'completed' else 'failed' end,
 output=p_output,evidence=p_evidence,input_tokens=p_input,output_tokens=p_output_tokens,estimated_usd=p_cost,
 budget_cents=case when p_error is null and p_cost is not null and p_cost>=0 then greatest(1,ceil(p_cost*100)::int) else budget_cents end,
 error=left(p_error,500),finished_at=now() where id=p_id;
 if p_error is null then
  for a in select value from jsonb_array_elements(p_actions) loop
   app:=nullif(a->>'appSlug','');
   if (r.scope='company' and app is not null) or (r.scope not in ('all','company') and app is distinct from r.scope) then raise exception 'Scope mismatch' using errcode='42501'; end if;
   if app is not null and not exists(select 1 from public.hub_apps where slug=app and active) then raise exception 'Inactive app' using errcode='42501'; end if;
   insert into public.hub_alfred_actions(run_id,kind,app_slug,title,payload) values(p_id,a->>'kind',app,a->>'title',a->'payload');
  end loop;
 end if;
 insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary) values(p_actor,'alfred.run.finished','alfred',p_id::text,case when p_error is null then 'Investigation completed; proposed actions require owner approval' else 'Investigation failed; no proposed actions were applied' end);
end $$;

create or replace function public.hub_alfred_decide(p_actor uuid,p_id uuid,p_decision text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hub_alfred_settings; a public.hub_alfred_actions; begin
 perform public.hub_alfred_owner(p_actor);
 if p_decision not in ('approve','reject') or p_decision is null then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into s from public.hub_alfred_settings where singleton for update;
 select * into a from public.hub_alfred_actions where id=p_id for update;
 if not found then raise exception 'Action unavailable' using errcode='P0002'; end if;
 if a.state<>'pending' then raise exception 'Action was already decided' using errcode='40001'; end if;
 if p_decision='approve' then
  if not s.enabled then raise exception 'Alfred is paused' using errcode='P0201'; end if;
  if a.expires_at<now() then raise exception 'Proposal expired; investigate again' using errcode='40001'; end if;
  if a.app_slug is not null and not exists(select 1 from public.hub_apps where slug=a.app_slug and active) then raise exception 'App inactive' using errcode='42501'; end if;
 end if;
 update public.hub_alfred_actions set state=case when p_decision='approve' then 'executing' else 'rejected' end,approved_by=p_actor,decided_at=now() where id=p_id returning * into a;
 insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,a.app_slug,'alfred.action.'||p_decision,'alfred_action',p_id::text,left(a.title,500));
 return to_jsonb(a);
end $$;

create or replace function public.hub_alfred_action_finish(p_actor uuid,p_id uuid,p_ok boolean,p_result jsonb)
returns void language plpgsql security invoker set search_path='' as $$ begin
 perform public.hub_alfred_owner(p_actor);
 update public.hub_alfred_actions set state=case when p_ok then 'completed' else 'needs_review' end,result=p_result
 where id=p_id and approved_by=p_actor and state='executing';
 if not found then raise exception 'Action claim missing' using errcode='40001'; end if;
 insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary) values(p_actor,'alfred.action.finished','alfred_action',p_id::text,case when p_ok then 'Approved action completed' else 'Action needs manual review; not automatically retried' end);
end $$;

create or replace function public.hub_alfred_save_knowledge(p_actor uuid,p_id uuid,p_version integer,p_app text,p_title text,p_body text,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare k public.hub_alfred_knowledge; begin
 perform public.hub_alfred_owner(p_actor);
 if p_app is not null and not exists(select 1 from public.hub_apps where slug=p_app and active) then raise exception 'Invalid app' using errcode='22023'; end if;
 if p_id is null then
  insert into public.hub_alfred_knowledge(app_slug,title,body,enabled,updated_by) values(p_app,p_title,p_body,p_enabled,p_actor) returning * into k;
 else
  update public.hub_alfred_knowledge set app_slug=p_app,title=p_title,body=p_body,enabled=p_enabled,updated_by=p_actor,version=version+1,updated_at=now()
  where id=p_id and version=p_version returning * into k;
  if not found then raise exception 'Knowledge changed' using errcode='40001'; end if;
 end if;
 insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,p_app,'alfred.knowledge.saved','alfred_knowledge',k.id::text,left(p_title,500));
 return to_jsonb(k);
end $$;

-- Ticket staleness and the reply insert share one row lock/transaction, avoiding
-- the race between checking a conversation and submitting a response.
create or replace function public.hub_alfred_add_ticket_message_once(p_actor uuid,p_action uuid,p_ticket uuid,p_body text,p_internal boolean,p_delivery_status text,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.hub_alfred_actions; t public.hub_tickets; begin
 perform public.hub_alfred_owner(p_actor);
 perform 1 from public.hub_alfred_settings where singleton and enabled for share;
 if not found then raise exception 'Alfred paused' using errcode='P0201'; end if;
 select * into a from public.hub_alfred_actions where id=p_action and state='executing' and approved_by=p_actor for update;
 if not found or a.kind<>'support_reply' or p_request is distinct from a.id or p_ticket is distinct from (a.payload->>'ticketId')::uuid or p_body is distinct from (a.payload->>'body') or p_internal is distinct from false then
  raise exception 'Reply does not match the approved action' using errcode='42501';
 end if;
 select * into t from public.hub_tickets where id=p_ticket for update;
 if not found or t.app_slug is distinct from a.app_slug or t.status in ('closed','resolved') or t.updated_at is distinct from (a.payload->>'ticketUpdatedAt')::timestamptz then
  raise exception 'Ticket changed; generate a new proposal' using errcode='40001';
 end if;
 return public.hub_add_ticket_message_once(p_actor,p_ticket,p_body,p_internal,p_delivery_status,p_request);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hub_alfred_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;

