begin;
set local lock_timeout='10s';
-- Release only explicitly confirmed zero-token, zero-cost failures. Unknown outcomes retain the reservation.
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
 budget_cents=case when p_error is not null and p_cost=0 and p_input=0 and p_output_tokens=0 then 0 when p_error is null and p_cost is not null and p_cost>=0 then greatest(1,ceil(p_cost*100)::int) else budget_cents end,
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

revoke all on function public.hub_alfred_finish(uuid,uuid,jsonb,jsonb,jsonb,integer,integer,numeric,text) from public,anon,authenticated;
grant execute on function public.hub_alfred_finish(uuid,uuid,jsonb,jsonb,jsonb,integer,integer,numeric,text) to service_role;
commit;

