-- Owner-only due date corrections. Each recurring occurrence keeps its original
-- recurrence slot so changing its visible due date cannot regenerate duplicates.
alter table public.finance_entries add column if not exists recurrence_slot_date date;
update public.finance_entries set recurrence_slot_date=original_due_date
  where series_id is not null and recurrence_slot_date is null;
do $migration$
begin
  if not exists (select 1 from pg_constraint where conname='finance_entries_series_slot_key' and conrelid='public.finance_entries'::regclass) then
    alter table public.finance_entries add constraint finance_entries_series_slot_key unique(series_id,recurrence_slot_date);
  end if;
  if not exists (select 1 from pg_constraint where conname='finance_entries_slot_required' and conrelid='public.finance_entries'::regclass) then
    alter table public.finance_entries add constraint finance_entries_slot_required check (series_id is null or recurrence_slot_date is not null);
  end if;
end;
$migration$;

-- Future changes are effective from a recurrence SLOT, not the new display date.
-- Earlier materialized and unmaterialized bills keep the former schedule.
create table if not exists public.finance_series_due_rules (
  series_id uuid not null, user_id uuid not null,
  effective_from date not null,
  target_day integer, offset_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(series_id,effective_from),
  foreign key(series_id,user_id) references public.finance_series(id,user_id) on delete cascade,
  check ((target_day is not null) <> (offset_days is not null)),
  check (target_day is null or target_day between 1 and 31),
  check (offset_days is null or offset_days between -31 and 31)
);
create index if not exists finance_series_due_rules_owner_idx on public.finance_series_due_rules(user_id);
alter table public.finance_series_due_rules enable row level security;
revoke all on public.finance_series_due_rules from public,anon,authenticated,service_role;
grant select,insert,update on public.finance_series_due_rules to service_role;

create or replace function public.finance_due_for_slot(p_series uuid,p_slot date)
returns date language plpgsql stable security invoker set search_path='' as $$
declare v_target integer; v_offset integer; v_day integer; v_resolved date;
begin
  select r.target_day,r.offset_days into v_target,v_offset
    from public.finance_series_due_rules r
    where r.series_id=p_series and r.effective_from<=p_slot
    order by r.effective_from desc limit 1;
  if v_target is not null then
    v_day:=least(v_target,extract(day from
      (date_trunc('month',p_slot::timestamp)+interval '1 month - 1 day'))::integer);
    v_resolved:=make_date(extract(year from p_slot)::integer,extract(month from p_slot)::integer,v_day);
  else
    v_resolved:=p_slot+coalesce(v_offset,0);
  end if;
  if v_resolved not between date '2000-01-01' and date '2100-12-31'
    then raise exception 'The updated due date falls outside the supported calendar range.'; end if;
  return v_resolved;
end;
$$;
revoke all on function public.finance_due_for_slot(uuid,date) from public,anon,authenticated;
grant execute on function public.finance_due_for_slot(uuid,date) to service_role;

-- Remap only newly generated series entries, preserving the untouched slot date.
-- A single-occurrence edit changes the due date, never its recurrence slot.
create or replace function public.finance_entry_due_slot_insert()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_date date;
begin
  if new.series_id is not null then
    new.recurrence_slot_date:=coalesce(new.recurrence_slot_date,new.original_due_date);
    v_date:=public.finance_due_for_slot(new.series_id,new.recurrence_slot_date);
    if v_date is distinct from new.original_due_date then
      if new.scheduled_date=new.original_due_date then new.scheduled_date:=v_date; end if;
      new.original_due_date:=v_date;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists finance_entry_due_slot_insert on public.finance_entries;
create trigger finance_entry_due_slot_insert before insert on public.finance_entries
  for each row execute function public.finance_entry_due_slot_insert();
revoke all on function public.finance_entry_due_slot_insert() from public,anon,authenticated;

-- Existing forecast expansion must deduplicate by the stable recurrence slot,
-- rather than the visible date which the owner can now change.
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
        on conflict(series_id,recurrence_slot_date) do nothing;
      get diagnostics affected=row_count; added:=added+affected;
    end loop;
  end loop;
  return added;
end;
$$;

create or replace function public.finance_change_due_date(p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid; v_scope text; v_new date; v_slot date; v_count integer:=0;
  v_shift integer; v_target integer; v_resolved date;
  v_series public.finance_series%rowtype;
  v_entry public.finance_entries%rowtype;
  v_current public.finance_entries%rowtype;
begin
  perform public.finance_assert_actor(p_actor);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Enter a new due date.'; end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  v_scope:=p_payload->>'scope';
  v_new:=(p_payload->>'original_due_date')::date;
  if v_scope not in ('single','future') or v_scope is null then raise exception 'Choose which bills to update.'; end if;
  if v_new is null or v_new not between date '2000-01-01' and date '2100-12-31'
    then raise exception 'Choose a due date between 2000 and 2100.'; end if;
  select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update;
  if v_entry.id is null then raise exception using errcode='P0002',message='This bill was not found.'; end if;
  if v_entry.kind<>'bill' or v_entry.status='collections' then
    raise exception 'Only regular bills outside collections can have their original due date changed.';
  end if;
  if v_entry.plan_id is not null then
    raise exception 'Payment plan installment due dates follow the plan schedule. Move its planned payment date instead.';
  end if;
  v_slot:=coalesce(v_entry.recurrence_slot_date,v_entry.original_due_date);

  if v_scope='single' then
    if v_new is distinct from v_entry.original_due_date then
      update public.finance_entries
        set original_due_date=v_new,
          scheduled_date=case when scheduled_date=original_due_date then v_new else scheduled_date end,
          updated_at=now()
        where id=v_id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details)
        values(p_actor,v_id,'due_date_changed',jsonb_build_object(
          'scope','single','previous_due_date',v_entry.original_due_date,
          'new_due_date',v_new,'recurrence_slot_date',v_entry.recurrence_slot_date));
      v_count:=1;
    end if;
    return jsonb_build_object('id',v_id,'affected_entries',v_count);
  end if;

  if v_entry.series_id is null then
    raise exception 'This and future bills is available only for a recurring bill.';
  end if;
  select * into v_series from public.finance_series
    where id=v_entry.series_id and user_id=p_actor for update;
  if v_series.id is null then raise exception using errcode='P0002',message='Recurring schedule not found.'; end if;

  if v_series.frequency in ('monthly','quarterly','yearly') then
    if date_trunc('month',v_new::timestamp) is distinct from date_trunc('month',v_slot::timestamp) then
      raise exception 'For monthly, quarterly, or yearly bills, choose a new day in this bill''s same calendar month. Future months will use that day (or their last day).';
    end if;
    v_target:=extract(day from v_new)::integer;
    v_shift:=null;
  else
    v_shift:=v_new-v_slot;
    if abs(v_shift)>31 then raise exception 'For weekly or custom schedules, choose a date within 31 days of the original schedule date.'; end if;
    v_target:=null;
  end if;

  insert into public.finance_series_due_rules(series_id,user_id,effective_from,target_day,offset_days)
    values(v_series.id,p_actor,v_slot,v_target,v_shift)
    on conflict(series_id,effective_from)
    do update set target_day=excluded.target_day,offset_days=excluded.offset_days,updated_at=now()
    where public.finance_series_due_rules.user_id=p_actor;

  -- Paid and cancelled bills retain their original obligations and payment
  -- history. Unpaid bills get a corrected original due date, not merely a moved
  -- planned payment. Previously moved planned dates remain independently set.
  for v_current in select e.* from public.finance_entries e
    where e.user_id=p_actor and e.series_id=v_series.id
      and coalesce(e.recurrence_slot_date,e.original_due_date)>=v_slot
      and e.status='active'
      and e.amount_cents>coalesce((
        select sum(p.amount_cents) from public.finance_payments p
        where p.entry_id=e.id and p.user_id=p_actor and p.reversed_at is null),0)
    order by e.recurrence_slot_date,e.id for update of e loop
    v_resolved:=public.finance_due_for_slot(v_series.id,coalesce(v_current.recurrence_slot_date,v_current.original_due_date));
    if v_resolved is distinct from v_current.original_due_date then
      update public.finance_entries
        set original_due_date=v_resolved,
          scheduled_date=case when scheduled_date=original_due_date then v_resolved else scheduled_date end,
          updated_at=now()
        where id=v_current.id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details)
        values(p_actor,v_current.id,'due_date_changed',jsonb_build_object(
          'scope','future','series_id',v_series.id,'effective_from',v_slot,
          'recurrence_slot_date',v_current.recurrence_slot_date,
          'previous_due_date',v_current.original_due_date,'new_due_date',v_resolved));
      v_count:=v_count+1;
    end if;
  end loop;
  insert into public.finance_entry_history(user_id,entry_id,action,details)
    values(p_actor,v_id,'recurring_due_date_changed',jsonb_build_object(
      'series_id',v_series.id,'effective_from',v_slot,'target_day',v_target,
      'offset_days',v_shift,'affected_entries',v_count));
  return jsonb_build_object('id',v_id,'affected_entries',v_count);
end;
$$;
revoke all on function public.finance_change_due_date(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finance_change_due_date(uuid,jsonb) to service_role;
