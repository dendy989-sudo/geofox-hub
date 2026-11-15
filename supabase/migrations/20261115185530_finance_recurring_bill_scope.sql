-- Effective-dated recurring bill changes. Existing obligations and posted
-- payments keep their original amounts, dates, identities and attribution.
alter table public.finance_series add column if not exists cancelled_from date
  check(cancelled_from between start_date and date '2100-12-31');
alter table public.finance_entries add column if not exists recurring_cancel_exempt boolean not null default false;

-- An explicit one-occurrence restore remains payable even after its schedule
-- was cancelled. A later bulk cancellation clears that exception again.
create or replace function public.finance_recurring_restore_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.series_id is not null and new.status='active' and old.status='cancelled' then new.recurring_cancel_exempt:=true;
  elsif new.status='cancelled' then new.recurring_cancel_exempt:=false;
  end if;
  return new;
end;
$$;
drop trigger if exists finance_recurring_restore_guard on public.finance_entries;
create trigger finance_recurring_restore_guard before update of status on public.finance_entries
  for each row execute function public.finance_recurring_restore_guard();

-- Paid history is protected at cancellation time. If its payment is reversed
-- later, keep the reopened remainder cancelled unless it was explicitly restored.
create or replace function public.finance_recurring_payment_reversal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare affected public.finance_entries%rowtype;
begin
  if old.reversed_at is null and new.reversed_at is not null then
    perform public.finance_assert_actor(new.user_id);
    update public.finance_entries e set status='cancelled',updated_at=now()
      from public.finance_series s
      where e.id=new.entry_id and e.user_id=new.user_id and e.series_id=s.id and s.user_id=e.user_id
        and e.status='active' and not e.recurring_cancel_exempt and e.original_due_date>=s.cancelled_from
        and e.amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=e.user_id and p.reversed_at is null),0)
      returning e.* into affected;
    if affected.id is not null then
      insert into public.finance_entry_history(user_id,entry_id,action,details)
        values(new.user_id,affected.id,'status',jsonb_build_object('from','active','to','cancelled','reason','payment_reversed_after_recurring_cancellation'));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists finance_recurring_payment_reversal on public.finance_payments;
create trigger finance_recurring_payment_reversal after update of reversed_at on public.finance_payments
  for each row execute function public.finance_recurring_payment_reversal();

create table if not exists public.finance_series_terms (
  series_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null check(effective_from between date '2000-01-01' and date '2100-12-31'),
  kind text not null check(kind in ('bill','income')),
  title text not null check(length(title) between 1 and 200),
  category text not null check(length(category) between 1 and 80),
  expense_type text not null check(expense_type in ('bill','installment','payment_plan')),
  amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
  vendor_id uuid, account_id uuid,
  payment_method text not null check(public.finance_payment_method_valid(kind,payment_method)),
  reminder_days integer check(reminder_days between 0 and 30),
  tag_ids uuid[] not null default '{}', notes text not null default '' check(length(notes)<=4000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(series_id,effective_from),
  foreign key(series_id,user_id) references public.finance_series(id,user_id),
  foreign key(vendor_id,user_id) references public.finance_vendors(id,user_id),
  foreign key(account_id,user_id) references public.finance_accounts(id,user_id)
);
create index if not exists finance_series_terms_user_idx on public.finance_series_terms(user_id);
alter table public.finance_series_terms enable row level security;
revoke all privileges on table public.finance_series_terms from public,anon,authenticated,service_role;
grant select,insert,update on table public.finance_series_terms to service_role;
drop trigger if exists finance_series_terms_tag_links on public.finance_series_terms;
create trigger finance_series_terms_tag_links before insert or update of tag_ids,user_id on public.finance_series_terms
  for each row execute function public.finance_tag_links_check();

create or replace function public.finance_expand(p_actor uuid,p_through date)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  s public.finance_series%rowtype; terms public.finance_series_terms%rowtype; effective public.finance_series%rowtype;
  d date; dates date[]; through_date date; n integer; added integer:=0; affected integer;
begin
  perform public.finance_assert_actor(p_actor);
  if p_through is null or p_through not between date '2000-01-01' and date '2100-12-31' then raise exception 'Choose a valid forecast month.'; end if;
  for s in select * from public.finance_series where user_id=p_actor and active and start_date<=p_through loop
    through_date:=least(p_through,coalesce(s.end_date,p_through),coalesce(s.cancelled_from-1,p_through));
    if through_date<s.start_date then continue; end if;
    dates:='{}'::date[];
    if s.frequency='custom' and s.custom_mode='specific_dates' then
      select coalesce(array_agg(x order by x),'{}'::date[]) into dates
        from unnest(s.custom_dates) x where x>=s.start_date and x<=through_date;
    elsif s.frequency='custom' then
      select coalesce(array_agg(x.day order by x.day),'{}'::date[]) into dates from (
        select distinct m::date+least(day_number,extract(day from m+interval '1 month - 1 day')::integer)-1 as day
        from generate_series(date_trunc('month',s.start_date::timestamp),date_trunc('month',through_date::timestamp),interval '1 month') m
        cross join unnest(s.custom_month_days) day_number
      ) x where x.day>=s.start_date and x.day<=through_date;
    else
      n:=0;
      loop
        d:=public.finance_occurrence_date(s.start_date,s.frequency,n);
        exit when d>through_date;
        dates:=array_append(dates,d); n:=n+1;
        if n>10000 then raise exception 'This repeating schedule exceeds the supported forecast range.'; end if;
      end loop;
    end if;
    foreach d in array dates loop
      -- Resolve from the original anchor, never from a clamped monthly date or
      -- the latest terms globally. Opening older months must not backdate edits.
      select * into terms from public.finance_series_terms
        where series_id=s.id and user_id=p_actor and effective_from<=d
        order by effective_from desc limit 1;
      effective:=jsonb_populate_record(s,case when terms.series_id is null then '{}'::jsonb else to_jsonb(terms) end);
      insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
        values(p_actor,effective.kind,effective.title,effective.category,effective.expense_type,effective.amount_cents,effective.amount_cents,d,d,s.id,effective.vendor_id,effective.account_id,effective.payment_method,effective.reminder_days,effective.tag_ids,effective.notes)
        on conflict(series_id,original_due_date) do nothing;
      get diagnostics affected=row_count; added:=added+affected;
    end loop;
  end loop;
  return added;
end;
$$;

-- This RPC is used only for an explicit future scope. The established mutation
-- API continues to handle individual occurrences and all other finance actions.
create or replace function public.finance_mutate_recurring(p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  selected public.finance_entries%rowtype; current_entry public.finance_entries%rowtype; next_entry public.finance_entries%rowtype;
  series public.finance_series%rowtype; effective public.finance_series%rowtype;
  terms public.finance_series_terms%rowtype; next_terms public.finance_series_terms%rowtype;
  v_id uuid; v_vendor uuid; v_account uuid; v_tags uuid[]; v_method text; v_reminder integer; v_amount bigint;
  v_paid bigint; v_values jsonb; v_patch jsonb; v_boundary date; v_count integer:=0;
begin
  -- The shared owner lock also serializes expansion, single edits and payments.
  perform public.finance_assert_actor(p_actor);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'scope' is distinct from 'future' then
    raise exception 'Choose this and future bills to change a recurring schedule.';
  end if;
  if p_action is null or p_action not in ('save_entry','entry_status') then raise exception 'This recurring bill action is not available.'; end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  select * into selected from public.finance_entries where id=v_id and user_id=p_actor for update;
  if selected.id is null then raise exception using errcode='P0002',message='This entry was not found.'; end if;
  if selected.series_id is null or selected.plan_id is not null or selected.kind<>'bill' then
    raise exception 'This and future bills is available only for a repeating bill.';
  end if;
  if selected.status='collections' then raise exception 'Manage this item on Credit & collections.'; end if;
  select * into series from public.finance_series where id=selected.series_id and user_id=p_actor for update;
  if series.id is null then raise exception using errcode='P0002',message='This repeating schedule was not found.'; end if;
  v_boundary:=selected.original_due_date;

  if p_action='entry_status' then
    if p_payload->>'status' is distinct from 'cancelled' or p_payload ? 'archived' then
      raise exception 'Cancel this and future bills, or change this bill only to restore or archive it.';
    end if;
    update public.finance_series set cancelled_from=least(coalesce(cancelled_from,v_boundary),v_boundary)
      where id=series.id and user_id=p_actor;
    update public.finance_entries set recurring_cancel_exempt=false
      where series_id=series.id and user_id=p_actor and original_due_date>=v_boundary and recurring_cancel_exempt;
    for current_entry in select e.* from public.finance_entries e
      where e.series_id=series.id and e.user_id=p_actor and e.original_due_date>=v_boundary and e.status='active'
        and e.amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and p.reversed_at is null),0)
      order by e.original_due_date,e.id for update of e loop
      update public.finance_entries set status='cancelled',updated_at=now() where id=current_entry.id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details)
        values(p_actor,current_entry.id,'status',jsonb_build_object('from','active','to','cancelled','scope','future','series_id',series.id,'effective_from',v_boundary));
      v_count:=v_count+1;
    end loop;
    -- Retain the schedule decision even if the anchor was already cancelled or paid.
    insert into public.finance_entry_history(user_id,entry_id,action,details)
      values(p_actor,v_id,'recurring_cancelled',jsonb_build_object('series_id',series.id,'effective_from',v_boundary,'affected_entries',v_count));
    return jsonb_build_object('id',v_id,'affected_entries',v_count);
  end if;

  if p_payload->>'kind' is distinct from selected.kind or (p_payload->>'original_due_date')::date is distinct from selected.original_due_date then
    raise exception 'The original type and due date are preserved. Use the payment date to move this occurrence.';
  end if;
  v_vendor:=public.finance_resolve_vendor(p_actor,p_payload,selected.vendor_id);
  v_account:=public.finance_resolve_account(p_actor,p_payload,selected.account_id);
  v_tags:=public.finance_resolve_tags(p_actor,p_payload,selected.tag_ids);
  v_method:=case when p_payload ? 'payment_method' then p_payload->>'payment_method' else selected.payment_method end;
  if public.finance_payment_method_valid(selected.kind,v_method) is not true then raise exception 'Choose a valid payment method for this bill.'; end if;
  v_reminder:=case when p_payload ? 'reminder_days' then (p_payload->>'reminder_days')::integer else selected.reminder_days end;
  v_amount:=(p_payload->>'amount_cents')::bigint;
  v_values:=jsonb_build_object('kind',selected.kind,'title',p_payload->>'title','category',p_payload->>'category',
    'expense_type',p_payload->>'expense_type','amount_cents',v_amount,'vendor_id',v_vendor,'account_id',v_account,
    'payment_method',v_method,'reminder_days',v_reminder,'tag_ids',v_tags,'notes',coalesce(p_payload->>'notes',''));
  -- Sending the full editor must not spread unchanged single-occurrence overrides.
  select coalesce(jsonb_object_agg(kv.key,kv.value),'{}'::jsonb) into v_patch from jsonb_each(v_values) kv
    where kv.value is distinct from to_jsonb(selected)->kv.key;

  select * into terms from public.finance_series_terms where series_id=series.id and user_id=p_actor and effective_from<=v_boundary
    order by effective_from desc limit 1;
  effective:=jsonb_populate_record(series,case when terms.series_id is null then '{}'::jsonb else to_jsonb(terms) end);
  next_terms:=jsonb_populate_record(null::public.finance_series_terms,to_jsonb(effective)||v_patch||jsonb_build_object(
    'series_id',series.id,'user_id',p_actor,'effective_from',v_boundary,'created_at',now(),'updated_at',now()));
  -- Even a no-op form is validated against the normal field constraints. No base
  -- series values are rewritten, so earlier unmaterialized dates remain correct.
  insert into public.finance_series_terms(series_id,user_id,effective_from,kind,title,category,expense_type,amount_cents,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
    values(next_terms.series_id,next_terms.user_id,next_terms.effective_from,next_terms.kind,next_terms.title,next_terms.category,next_terms.expense_type,next_terms.amount_cents,next_terms.vendor_id,next_terms.account_id,next_terms.payment_method,next_terms.reminder_days,next_terms.tag_ids,next_terms.notes)
    on conflict(series_id,effective_from) do update set kind=excluded.kind,title=excluded.title,category=excluded.category,expense_type=excluded.expense_type,
      amount_cents=excluded.amount_cents,vendor_id=excluded.vendor_id,account_id=excluded.account_id,payment_method=excluded.payment_method,
      reminder_days=excluded.reminder_days,tag_ids=excluded.tag_ids,notes=excluded.notes,updated_at=now()
      where finance_series_terms.user_id=p_actor;
  -- An edit from an earlier month also applies its changed fields beyond later
  -- saved boundaries. Other fields of those future terms retain their own changes.
  for terms in select * from public.finance_series_terms where series_id=series.id and user_id=p_actor and effective_from>v_boundary for update loop
    next_terms:=jsonb_populate_record(terms,v_patch);
    update public.finance_series_terms set title=next_terms.title,category=next_terms.category,expense_type=next_terms.expense_type,
      amount_cents=next_terms.amount_cents,vendor_id=next_terms.vendor_id,account_id=next_terms.account_id,payment_method=next_terms.payment_method,
      reminder_days=next_terms.reminder_days,tag_ids=next_terms.tag_ids,notes=next_terms.notes,updated_at=now()
      where series_id=series.id and user_id=p_actor and effective_from=terms.effective_from;
  end loop;

  for current_entry in select e.* from public.finance_entries e
    where e.series_id=series.id and e.user_id=p_actor and e.original_due_date>=v_boundary and e.status='active'
      and e.amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and p.reversed_at is null),0)
    order by e.original_due_date,e.id for update of e loop
    next_entry:=jsonb_populate_record(current_entry,v_patch);
    if current_entry.id=v_id then next_entry.scheduled_date:=(p_payload->>'scheduled_date')::date; end if;
    select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=current_entry.id and user_id=p_actor and reversed_at is null;
    if next_entry.amount_cents<v_paid then raise exception 'The new amount is lower than recorded payments on an affected bill. No bills were changed.'; end if;
    update public.finance_entries set title=next_entry.title,category=next_entry.category,expense_type=next_entry.expense_type,
      amount_cents=next_entry.amount_cents,scheduled_date=next_entry.scheduled_date,vendor_id=next_entry.vendor_id,account_id=next_entry.account_id,
      payment_method=next_entry.payment_method,reminder_days=next_entry.reminder_days,tag_ids=next_entry.tag_ids,notes=next_entry.notes,updated_at=now()
      where id=current_entry.id and user_id=p_actor;
    insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,current_entry.id,'edited',
      jsonb_build_object('scope','future','series_id',series.id,'effective_from',v_boundary,'changes',v_patch,
        'previous_amount_cents',current_entry.amount_cents,'amount_cents',next_entry.amount_cents,
        'previous_scheduled_date',current_entry.scheduled_date,'scheduled_date',next_entry.scheduled_date));
    v_count:=v_count+1;
  end loop;
  insert into public.finance_entry_history(user_id,entry_id,action,details)
    values(p_actor,v_id,'recurring_edited',jsonb_build_object('series_id',series.id,'effective_from',v_boundary,'changes',v_patch,'affected_entries',v_count));
  return jsonb_build_object('id',v_id,'affected_entries',v_count);
end;
$$;

revoke all on function public.finance_expand(uuid,date),public.finance_mutate_recurring(uuid,text,jsonb),public.finance_recurring_restore_guard(),public.finance_recurring_payment_reversal() from public,anon,authenticated;
grant execute on function public.finance_expand(uuid,date),public.finance_mutate_recurring(uuid,text,jsonb),public.finance_recurring_restore_guard(),public.finance_recurring_payment_reversal() to service_role;

create or replace function public.finance_snapshot(p_actor uuid,p_through date)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.finance_expand(p_actor,p_through);
  return pg_catalog.jsonb_build_object(
    'today',(now() at time zone 'America/Chicago')::date,
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.original_due_date,e.id) from public.finance_entries e where e.user_id=p_actor),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_on,p.id) from public.finance_payments p where p.user_id=p_actor),'[]'::jsonb),
    'series',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from public.finance_series s where s.user_id=p_actor),'[]'::jsonb),
    'series_terms',coalesce((select jsonb_agg(to_jsonb(t) order by t.series_id,t.effective_from) from public.finance_series_terms t where t.user_id=p_actor),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.finance_plans p where p.user_id=p_actor),'[]'::jsonb),
    'debts',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.finance_debts d where d.user_id=p_actor),'[]'::jsonb),
    'debt_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from public.finance_debt_history h where h.user_id=p_actor),'[]'::jsonb),
    'spending',coalesce((select jsonb_agg(to_jsonb(s) order by s.date,s.id) from public.finance_spending s where s.user_id=p_actor),'[]'::jsonb),
    'months',coalesce((select jsonb_agg(to_jsonb(m) order by m.month) from public.finance_months m where m.user_id=p_actor),'[]'::jsonb),
    'vendors',coalesce((select jsonb_agg(to_jsonb(v) order by lower(v.name),v.id) from public.finance_vendors v where v.user_id=p_actor),'[]'::jsonb),
    'tags',coalesce((select jsonb_agg(to_jsonb(t) order by public.finance_tag_name_key(t.name),t.id) from public.finance_tags t where t.user_id=p_actor),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.finance_accounts a where a.user_id=p_actor),'[]'::jsonb),
    'balance_updates',coalesce((select jsonb_agg(to_jsonb(b) order by b.date,b.id) from public.finance_balance_updates b where b.user_id=p_actor),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.date,t.id) from public.finance_transfers t where t.user_id=p_actor),'[]'::jsonb),
    'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at,g.id) from public.finance_savings_goals g where g.user_id=p_actor),'[]'::jsonb),
    'goal_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from public.finance_goal_history h where h.user_id=p_actor),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.finance_snapshot(uuid,date) from public,anon,authenticated;
grant execute on function public.finance_snapshot(uuid,date) to service_role;
