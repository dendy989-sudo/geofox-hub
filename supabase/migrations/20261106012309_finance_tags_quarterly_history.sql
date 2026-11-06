-- Reusable private tags, anchored quarterly schedules and earlier custom dates.
-- Existing obligations, posted payments and tag-free records remain unchanged.
create or replace function public.finance_normalize_tag_name(p_name text)
returns text language plpgsql immutable strict security invoker set search_path='' as $$
declare v_name text;
begin
  if p_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]' then raise exception 'Enter a tag name without control characters or line breaks.'; end if;
  v_name:=pg_catalog.btrim(pg_catalog.regexp_replace(p_name,U&'[ \00A0\1680\2000-\200A\202F\205F\3000\FEFF]+',' ','g'));
  if pg_catalog.length(v_name) not between 1 and 60 then raise exception 'Enter a tag name using 1 to 60 characters.'; end if;
  return v_name;
end;
$$;

create or replace function public.finance_tag_name_key(p_name text)
returns text language sql immutable strict security invoker set search_path='' as $$
  select pg_catalog.replace(pg_catalog.lower(pg_catalog.replace(public.finance_normalize_tag_name(p_name),U&'\0130',U&'i\0307')),U&'\03C2',U&'\03C3');
$$;

create table if not exists public.finance_tags (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(name=public.finance_normalize_tag_name(name)), archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
-- Archived names remain reserved so old associations can always be restored.
create unique index if not exists finance_tags_user_name_idx on public.finance_tags(user_id,public.finance_tag_name_key(name));
alter table public.finance_tags enable row level security;
revoke all privileges on table public.finance_tags from public,anon,authenticated,service_role;
grant select,insert,update on table public.finance_tags to service_role;

alter table public.finance_entries add column if not exists tag_ids uuid[] not null default '{}';
alter table public.finance_series add column if not exists tag_ids uuid[] not null default '{}';
alter table public.finance_plans add column if not exists tag_ids uuid[] not null default '{}';

create or replace function public.finance_tag_identity_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
    raise exception 'A saved tag keeps its original identity and owner.';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_tags_identity_guard on public.finance_tags;
create trigger finance_tags_identity_guard before update of id,user_id on public.finance_tags
  for each row execute function public.finance_tag_identity_guard();

create or replace function public.finance_tag_links_check()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_tags uuid[]; v_count integer;
begin
  if new.tag_ids is null or coalesce(pg_catalog.array_ndims(new.tag_ids),1)>1 or pg_catalog.array_position(new.tag_ids,null) is not null then
    raise exception 'Choose tags as a list of valid identifiers, or leave the list empty.';
  end if;
  select coalesce(pg_catalog.array_agg(distinct t order by t),'{}'::uuid[]) into v_tags from pg_catalog.unnest(new.tag_ids) t;
  if pg_catalog.cardinality(v_tags)>20 then raise exception 'Choose at most 20 tags for one record.'; end if;
  -- A row-level ownership check protects arrays even on privileged direct writes.
  perform 1 from public.finance_tags where user_id=new.user_id and id=any(v_tags) for key share;
  get diagnostics v_count=row_count;
  if v_count<>pg_catalog.cardinality(v_tags) then raise exception using errcode='23503',message='Every tag must belong to the same finance owner as its record.'; end if;
  new.tag_ids:=v_tags;
  return new;
end;
$$;
drop trigger if exists finance_entries_tag_links on public.finance_entries;
create trigger finance_entries_tag_links before insert or update of tag_ids,user_id on public.finance_entries
  for each row execute function public.finance_tag_links_check();
drop trigger if exists finance_series_tag_links on public.finance_series;
create trigger finance_series_tag_links before insert or update of tag_ids,user_id on public.finance_series
  for each row execute function public.finance_tag_links_check();
drop trigger if exists finance_plans_tag_links on public.finance_plans;
create trigger finance_plans_tag_links before insert or update of tag_ids,user_id on public.finance_plans
  for each row execute function public.finance_tag_links_check();

create or replace function public.finance_resolve_tags(p_actor uuid,p_payload jsonb,p_current uuid[] default '{}')
returns uuid[] language plpgsql security invoker set search_path='' as $$
declare v_tags uuid[];
begin
  perform public.finance_assert_actor(p_actor);
  if not p_payload ? 'tag_ids' then return coalesce(p_current,'{}'::uuid[]); end if;
  if pg_catalog.jsonb_typeof(p_payload->'tag_ids') is distinct from 'array' then raise exception 'Choose tags as a list, or leave the list empty.'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_payload->'tag_ids') t
    where pg_catalog.jsonb_typeof(t)<>'string' or (t#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'Choose valid tag identifiers.'; end if;
  select coalesce(pg_catalog.array_agg(distinct t::uuid order by t::uuid),'{}'::uuid[]) into v_tags from pg_catalog.jsonb_array_elements_text(p_payload->'tag_ids') t;
  if pg_catalog.cardinality(v_tags)>20 then raise exception 'Choose at most 20 tags for one record.'; end if;
  if exists(select 1 from pg_catalog.unnest(v_tags) t where not exists(select 1 from public.finance_tags where id=t and user_id=p_actor)) then
    raise exception using errcode='P0002',message='One of these tags was not found in your finance workspace.';
  end if;
  if exists(select 1 from public.finance_tags where user_id=p_actor and id=any(v_tags) and archived_at is not null and not id=any(coalesce(p_current,'{}'::uuid[]))) then
    raise exception 'Restore an archived tag before assigning it to another record.';
  end if;
  return v_tags;
end;
$$;

alter table public.finance_series drop constraint if exists finance_series_frequency_check;
alter table public.finance_series add constraint finance_series_frequency_check check(frequency in ('weekly','biweekly','monthly','quarterly','yearly','custom'));
alter table public.finance_plans drop constraint if exists finance_plans_frequency_check;
alter table public.finance_plans add constraint finance_plans_frequency_check check(frequency in ('weekly','biweekly','monthly','quarterly'));

create or replace function public.finance_occurrence_date(p_anchor date,p_frequency text,p_index integer)
returns date language plpgsql immutable strict security invoker set search_path='' as $$
begin
  if p_index < 0 then raise exception 'Occurrence index must be nonnegative.'; end if;
  if p_frequency='weekly' then return p_anchor + 7*p_index;
  elsif p_frequency='biweekly' then return p_anchor + 14*p_index;
  elsif p_frequency='monthly' then return (p_anchor + pg_catalog.make_interval(months=>p_index))::date;
  elsif p_frequency='quarterly' then return (p_anchor + pg_catalog.make_interval(months=>3*p_index))::date;
  elsif p_frequency='yearly' then return (p_anchor + pg_catalog.make_interval(years=>p_index))::date;
  else raise exception 'Choose a valid repeating frequency.'; end if;
end;
$$;

create or replace function public.finance_expand(p_actor uuid,p_through date)
returns integer language plpgsql security invoker set search_path='' as $$
declare s public.finance_series%rowtype; d date; n integer; added integer:=0; affected integer;
begin
  perform public.finance_assert_actor(p_actor);
  if p_through is null or p_through not between date '2000-01-01' and date '2100-12-31' then raise exception 'Choose a valid forecast month.'; end if;
  for s in select * from public.finance_series where user_id=p_actor and active and start_date<=p_through loop
    if s.frequency='custom' then
      if s.custom_mode='specific_dates' then
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
          select p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,x,x,s.id,s.vendor_id,s.account_id,s.payment_method,s.reminder_days,s.tag_ids,s.notes
          from unnest(s.custom_dates) x where x>=s.start_date and x<=p_through and (s.end_date is null or x<=s.end_date)
          on conflict(series_id,original_due_date) do nothing;
      else
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
          select p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,x.day,x.day,s.id,s.vendor_id,s.account_id,s.payment_method,s.reminder_days,s.tag_ids,s.notes
          from (
            select distinct m::date+least(day_number,extract(day from m+interval '1 month - 1 day')::integer)-1 as day
            from generate_series(date_trunc('month',s.start_date::timestamp),date_trunc('month',least(p_through,coalesce(s.end_date,p_through))::timestamp),interval '1 month') m
            cross join unnest(s.custom_month_days) day_number
          ) x where x.day>=s.start_date and x.day<=p_through and (s.end_date is null or x.day<=s.end_date)
          on conflict(series_id,original_due_date) do nothing;
      end if;
      get diagnostics affected=row_count; added:=added+affected;
    else
      n:=0;
      loop
        d:=public.finance_occurrence_date(s.start_date,s.frequency,n);
        exit when d>p_through or (s.end_date is not null and d>s.end_date);
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
          values(p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,d,d,s.id,s.vendor_id,s.account_id,s.payment_method,s.reminder_days,s.tag_ids,s.notes)
          on conflict(series_id,original_due_date) do nothing;
        get diagnostics affected=row_count; added:=added+affected; n:=n+1;
        if n>10000 then raise exception 'This repeating schedule exceeds the supported forecast range.'; end if;
      end loop;
    end if;
  end loop;
  return added;
end;
$$;

create or replace function public.finance_mutate(p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid; v_entry public.finance_entries%rowtype; v_payment public.finance_payments%rowtype;
  v_plan public.finance_plans%rowtype; v_debt public.finance_debts%rowtype; v_new_debt public.finance_debts%rowtype;
  v_series uuid; v_source_entry uuid; v_source_plan uuid; v_amount bigint; v_paid bigint; v_remaining bigint;
  v_date date; v_n integer; v_status text; v_today date:=(now() at time zone 'America/Chicago')::date;
  v_note text; v_changed boolean; v_count integer; v_people text[];
  v_tags uuid[]; v_tag_record public.finance_tags%rowtype; v_tag_name text; v_original_due date; v_scheduled date;
  v_vendor uuid; v_vendor_record public.finance_vendors%rowtype; v_vendor_name text; v_vendor_url text;
  v_frequency text; v_custom_mode text; v_custom_days integer[]:='{}'; v_custom_dates date[]:='{}';
  v_account uuid; v_current_account uuid; v_from uuid; v_to uuid; v_existing_id uuid; v_method text; v_reminder integer; v_first_anchor date;
  v_account_record public.finance_accounts%rowtype; v_balance_update public.finance_balance_updates%rowtype;
  v_transfer public.finance_transfers%rowtype; v_goal public.finance_savings_goals%rowtype; v_new_goal public.finance_savings_goals%rowtype;
  v_target bigint; v_actual bigint; v_other_allocations numeric; v_available numeric; v_new_milestones integer[]; v_all_milestones integer[];
begin
  perform public.finance_assert_actor(p_actor);
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object' then raise exception 'Enter the details for this change.'; end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if p_action='save_entry' then
    if v_id is not null then select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update; end if;
    v_tags:=public.finance_resolve_tags(p_actor,p_payload,v_entry.tag_ids);
    v_vendor:=public.finance_resolve_vendor(p_actor,p_payload,v_entry.vendor_id);
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_entry.account_id);
    v_method:=case when p_payload ? 'payment_method' then p_payload->>'payment_method' else coalesce(v_entry.payment_method,'manual') end;
    if public.finance_payment_method_valid(p_payload->>'kind',v_method) is not true then raise exception 'Choose a valid payment or receipt method for this entry.'; end if;
    v_reminder:=case when p_payload ? 'reminder_days' then (p_payload->>'reminder_days')::integer when v_entry.id is not null then v_entry.reminder_days when p_payload->>'kind'='bill' then 3 else null end;
    v_amount:=(p_payload->>'amount_cents')::bigint;
    v_original_due:=(p_payload->>'original_due_date')::date; v_scheduled:=(p_payload->>'scheduled_date')::date;
    v_frequency:=coalesce(p_payload->>'frequency','once');
    if v_frequency='custom' then
      v_custom_mode:=p_payload->>'custom_mode';
      if v_custom_mode='month_days' then
        if jsonb_typeof(p_payload->'custom_month_days') is distinct from 'array' then raise exception 'Choose days of the month from 1 through 31.'; end if;
        if exists(select 1 from jsonb_array_elements(p_payload->'custom_month_days') x where jsonb_typeof(x)<>'number') then raise exception 'Custom days must be whole numbers from 1 through 31.'; end if;
        select coalesce(array_agg(distinct x::integer order by x::integer),'{}'::integer[]) into v_custom_days from jsonb_array_elements_text(p_payload->'custom_month_days') x;
      elsif v_custom_mode='specific_dates' then
        if jsonb_typeof(p_payload->'custom_dates') is distinct from 'array' then raise exception 'Choose the specific dates for this schedule.'; end if;
        if exists(select 1 from jsonb_array_elements(p_payload->'custom_dates') x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$') then raise exception 'Choose valid custom dates between 2000 and 2100.'; end if;
        -- Keep the entered first date and make the earliest selected date the
        -- canonical start. Earlier occurrences stay unpaid until recorded.
        select array_agg(distinct day order by day) into v_custom_dates from (
          select x::date as day from jsonb_array_elements_text(p_payload->'custom_dates') x
          union all select v_original_due
        ) dates;
        if v_scheduled=v_original_due then v_scheduled:=v_custom_dates[1]; end if;
        v_original_due:=v_custom_dates[1];
      end if;
      if not public.finance_custom_schedule_valid(v_frequency,v_custom_mode,v_custom_days,v_custom_dates,v_original_due,nullif(p_payload->>'end_date','')::date) then
        raise exception 'Choose a valid custom schedule matching the first due date, with at most 240 specific dates and no dates beyond the repeat end date.';
      end if;
    end if;
    if v_entry.id is not null then
      if v_entry.status='collections' then raise exception 'Manage this item on Credit & collections.'; end if;
      if (p_payload->>'kind') is distinct from v_entry.kind or v_original_due is distinct from v_entry.original_due_date then raise exception 'The original type and due date are preserved. Use the payment date to move this occurrence.'; end if;
      if v_entry.plan_id is not null and (v_amount<>v_entry.amount_cents or p_payload->>'expense_type' is distinct from v_entry.expense_type) then raise exception 'Installment amounts and types are fixed by their payment plan. You can move the payment date.'; end if;
      select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_id and user_id=p_actor and reversed_at is null;
      if v_amount<v_paid then raise exception 'The bill or income amount cannot be lower than its recorded payments.'; end if;
      update public.finance_entries set title=p_payload->>'title',category=p_payload->>'category',expense_type=p_payload->>'expense_type',amount_cents=v_amount,scheduled_date=v_scheduled,vendor_id=v_vendor,account_id=v_account,payment_method=v_method,reminder_days=v_reminder,tag_ids=v_tags,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,v_id,'edited',pg_catalog.jsonb_build_object('previous_amount_cents',v_entry.amount_cents,'amount_cents',v_amount,'previous_scheduled_date',v_entry.scheduled_date,'scheduled_date',v_scheduled,'previous_vendor_id',v_entry.vendor_id,'vendor_id',v_vendor,'previous_account_id',v_entry.account_id,'account_id',v_account,'previous_payment_method',v_entry.payment_method,'payment_method',v_method,'reminder_days',v_reminder,'previous_tag_ids',v_entry.tag_ids,'tag_ids',v_tags));
    else
      v_id:=coalesce(v_id,gen_random_uuid());
      if v_frequency<>'once' then
        insert into public.finance_series(user_id,kind,title,category,expense_type,amount_cents,start_date,end_date,frequency,custom_mode,custom_month_days,custom_dates,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
          values(p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,v_original_due,nullif(p_payload->>'end_date','')::date,v_frequency,v_custom_mode,v_custom_days,v_custom_dates,v_vendor,v_account,v_method,v_reminder,v_tags,coalesce(p_payload->>'notes','')) returning id into v_series;
      end if;
      insert into public.finance_entries(id,user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
        values(v_id,p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,v_amount,v_original_due,v_scheduled,v_series,v_vendor,v_account,v_method,v_reminder,v_tags,coalesce(p_payload->>'notes',''));
    end if;
  elsif p_action='entry_status' then
    select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update;
    if v_entry.id is null then raise exception using errcode='P0002',message='This entry was not found.'; end if;
    if v_entry.status='collections' then raise exception 'Manage this item on Credit & collections.'; end if;
    v_status:=p_payload->>'status';
    if v_status not in ('active','cancelled') then raise exception 'Choose a valid bill status.'; end if;
    if v_status='active' and v_entry.status<>'active' and v_entry.plan_id is not null and exists(select 1 from public.finance_plans where id=v_entry.plan_id and user_id=p_actor and status<>'active') then raise exception 'Restore the payment plan before restoring this installment.'; end if;
    update public.finance_entries set status=v_status,cancelled_by_plan=case when v_status=v_entry.status then v_entry.cancelled_by_plan else false end,archived_at=case when p_payload ? 'archived' then case when (p_payload->>'archived')::boolean then coalesce(archived_at,now()) else null end else archived_at end,updated_at=now() where id=v_id and user_id=p_actor;
    insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,v_id,'status',pg_catalog.jsonb_build_object('from',v_entry.status,'to',v_status,'archived',p_payload->'archived'));
  elsif p_action='move_entry' then
    select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update;
    if v_entry.id is null then raise exception using errcode='P0002',message='This entry was not found.'; end if;
    if v_entry.status<>'active' then raise exception 'Restore this entry before moving its payment date.'; end if;
    update public.finance_entries set scheduled_date=(p_payload->>'scheduled_date')::date,updated_at=now() where id=v_id and user_id=p_actor;
    insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,v_id,'moved',pg_catalog.jsonb_build_object('original_due_date',v_entry.original_due_date,'previous_date',v_entry.scheduled_date,'new_date',p_payload->>'scheduled_date','note',coalesce(p_payload->>'note','')));
  elsif p_action='record_payment' then
    if v_id is null then raise exception 'A payment identifier is required.'; end if;
    select * into v_payment from public.finance_payments where id=v_id and user_id=p_actor;
    if v_payment.id is not null then
      if v_payment.entry_id is distinct from (p_payload->>'entry_id')::uuid or v_payment.amount_cents is distinct from (p_payload->>'amount_cents')::bigint or v_payment.paid_on is distinct from (p_payload->>'paid_on')::date or (p_payload ? 'account_id' and v_payment.account_id is distinct from (p_payload->>'account_id')::uuid) or (p_payload ? 'payment_method' and v_payment.payment_method is distinct from p_payload->>'payment_method') then raise exception 'This payment identifier was already used. Reopen the payment form.'; end if;
      return pg_catalog.jsonb_build_object('id',v_id,'replayed',true);
    end if;
    select * into v_entry from public.finance_entries where id=(p_payload->>'entry_id')::uuid and user_id=p_actor for update;
    if v_entry.id is null then raise exception using errcode='P0002',message='This entry was not found.'; end if;
    if v_entry.status<>'active' then raise exception 'Restore this entry before recording a payment or receipt.'; end if;
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_entry.account_id);
    v_method:=case when p_payload ? 'payment_method' then p_payload->>'payment_method' else v_entry.payment_method end;
    if public.finance_payment_method_valid(v_entry.kind,v_method) is not true then raise exception 'Choose a valid payment or receipt method for this entry.'; end if;
    v_amount:=(p_payload->>'amount_cents')::bigint; v_date:=(p_payload->>'paid_on')::date;
    if v_date>v_today then raise exception 'Record a payment only after it has happened. Use the scheduled date for future payments.'; end if;
    select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_entry.id and user_id=p_actor and reversed_at is null;
    if v_amount>v_entry.amount_cents-v_paid then raise exception 'This payment exceeds the remaining amount.'; end if;
    insert into public.finance_payments(id,user_id,entry_id,amount_cents,paid_on,account_id,payment_method,note) values(v_id,p_actor,v_entry.id,v_amount,v_date,v_account,v_method,coalesce(p_payload->>'note',''));
    update public.finance_entries set updated_at=now() where id=v_entry.id and user_id=p_actor;
  elsif p_action='remove_payment' then
    select * into v_payment from public.finance_payments where id=v_id and user_id=p_actor for update;
    if v_payment.id is null then raise exception using errcode='P0002',message='This payment was not found.'; end if;
    if v_payment.reversed_at is not null then return pg_catalog.jsonb_build_object('id',v_id,'replayed',true); end if;
    update public.finance_payments set reversed_at=now() where id=v_id and user_id=p_actor;
    select * into v_entry from public.finance_entries where id=v_payment.entry_id and user_id=p_actor;
    -- A reversal also restores transferred debt, including a fully paid child
    -- that was retained as payment history when the rest of its plan moved.
    -- An individually transferred child always belongs to its own debt record.
    select * into v_debt from public.finance_debts where user_id=p_actor and (source_entry_id=v_entry.id or source_plan_id=v_entry.plan_id)
      order by case when source_entry_id=v_entry.id then 0 else 1 end limit 1 for update;
    if v_debt.id is not null then
      update public.finance_debts set current_balance_cents=current_balance_cents+v_payment.amount_cents,status=case when status='paid' then 'open' else status end,updated_at=now() where id=v_debt.id and user_id=p_actor;
      update public.finance_entries set status='collections',cancelled_by_plan=false,updated_at=now() where id=v_entry.id and user_id=p_actor;
      insert into public.finance_debt_history(user_id,debt_id,previous_balance_cents,balance_cents,note,details) values(p_actor,v_debt.id,v_debt.current_balance_cents,v_debt.current_balance_cents+v_payment.amount_cents,'Payment reversed on the original bill.',pg_catalog.jsonb_build_object('payment_id',v_id));
    elsif v_entry.status='active' and exists(select 1 from public.finance_plans where id=v_entry.plan_id and user_id=p_actor and status='cancelled') then
      update public.finance_entries set status='cancelled',cancelled_by_plan=true,updated_at=now() where id=v_entry.id and user_id=p_actor;
    else
      update public.finance_entries set updated_at=now() where id=v_entry.id and user_id=p_actor;
    end if;
  elsif p_action='save_series' then
    update public.finance_series set active=(p_payload->>'active')::boolean where id=v_id and user_id=p_actor;
    if not found then raise exception using errcode='P0002',message='This repeating schedule was not found.'; end if;
  elsif p_action='save_plan' then
    if v_id is not null then select * into v_plan from public.finance_plans where id=v_id and user_id=p_actor for update; end if;
    v_tags:=public.finance_resolve_tags(p_actor,p_payload,v_plan.tag_ids);
    v_vendor:=public.finance_resolve_vendor(p_actor,p_payload,v_plan.vendor_id);
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_plan.account_id);
    v_method:=case when p_payload ? 'payment_method' then p_payload->>'payment_method' else coalesce(v_plan.payment_method,'manual') end;
    if public.finance_payment_method_valid('bill',v_method) is not true then raise exception 'Choose a valid payment method for this plan.'; end if;
    v_reminder:=case when p_payload ? 'reminder_days' then (p_payload->>'reminder_days')::integer when v_plan.id is not null then v_plan.reminder_days else 3 end;
    if v_plan.id is not null then
      if (p_payload->>'total_amount_cents')::bigint is distinct from v_plan.total_amount_cents or (p_payload->>'opening_paid_cents')::bigint is distinct from v_plan.opening_paid_cents or (p_payload->>'installment_amount_cents')::bigint is distinct from v_plan.installment_amount_cents or p_payload->>'frequency' is distinct from v_plan.frequency or (p_payload->>'first_due_date')::date is distinct from v_plan.first_due_date or p_payload->>'kind' is distinct from v_plan.kind then raise exception 'A saved plan keeps its original amounts and schedule. Move individual payment dates or create a new plan.'; end if;
      update public.finance_plans set title=p_payload->>'title',creditor=p_payload->>'creditor',category=p_payload->>'category',vendor_id=v_vendor,account_id=v_account,payment_method=v_method,reminder_days=v_reminder,tag_ids=v_tags,notes=coalesce(p_payload->>'notes','') where id=v_id and user_id=p_actor;
      -- Change only the forecast settings that actually changed on the parent.
      -- Actual payments are immutable snapshots; paid/inactive children stay put.
      if v_account is distinct from v_plan.account_id or v_method is distinct from v_plan.payment_method or v_reminder is distinct from v_plan.reminder_days then
        update public.finance_entries e set
          account_id=case when v_account is distinct from v_plan.account_id then v_account else e.account_id end,
          payment_method=case when v_method is distinct from v_plan.payment_method then v_method else e.payment_method end,
          reminder_days=case when v_reminder is distinct from v_plan.reminder_days then v_reminder else e.reminder_days end,updated_at=now()
          where e.plan_id=v_id and e.user_id=p_actor and e.status='active'
            and e.amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and p.reversed_at is null),0);
      end if;
      -- Changing a plan's vendor updates all of its installment history. An
      -- omitted or unchanged vendor preserves individually edited associations.
      if v_vendor is distinct from v_plan.vendor_id then
        insert into public.finance_entry_history(user_id,entry_id,action,details)
          select p_actor,e.id,'vendor_changed',jsonb_build_object('plan_id',v_id,'previous_vendor_id',e.vendor_id,'vendor_id',v_vendor)
          from public.finance_entries e where e.plan_id=v_id and e.user_id=p_actor and e.vendor_id is distinct from v_vendor;
        update public.finance_entries set vendor_id=v_vendor,updated_at=now() where plan_id=v_id and user_id=p_actor and vendor_id is distinct from v_vendor;
      end if;
      -- Match canonical sets so customized installments keep their own labels.
      -- Tags describe history too; updating them never changes posted cash.
      if v_tags is distinct from v_plan.tag_ids then
        insert into public.finance_entry_history(user_id,entry_id,action,details)
          select p_actor,e.id,'tags_changed',jsonb_build_object('plan_id',v_id,'previous_tag_ids',e.tag_ids,'tag_ids',v_tags)
          from public.finance_entries e where e.plan_id=v_id and e.user_id=p_actor and e.tag_ids=v_plan.tag_ids;
        update public.finance_entries set tag_ids=v_tags,updated_at=now() where plan_id=v_id and user_id=p_actor and tag_ids=v_plan.tag_ids;
      end if;
    else
      v_id:=coalesce(v_id,gen_random_uuid());
      insert into public.finance_plans(id,user_id,title,creditor,kind,category,total_amount_cents,opening_paid_cents,installment_amount_cents,frequency,first_due_date,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
        values(v_id,p_actor,p_payload->>'title',p_payload->>'creditor',p_payload->>'kind',p_payload->>'category',(p_payload->>'total_amount_cents')::bigint,(p_payload->>'opening_paid_cents')::bigint,(p_payload->>'installment_amount_cents')::bigint,p_payload->>'frequency',(p_payload->>'first_due_date')::date,v_vendor,v_account,v_method,v_reminder,v_tags,coalesce(p_payload->>'notes','')) returning * into v_plan;
      v_remaining:=v_plan.total_amount_cents-v_plan.opening_paid_cents; v_n:=0;
      while v_remaining>0 loop
        v_amount:=least(v_remaining,v_plan.installment_amount_cents); v_date:=public.finance_occurrence_date(v_plan.first_due_date,v_plan.frequency,v_n);
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,plan_id,vendor_id,account_id,payment_method,reminder_days,tag_ids,notes)
          values(p_actor,'bill',left(v_plan.title,190)||' · '||(v_n+1)::text,v_plan.category,v_plan.kind,v_amount,v_amount,v_date,v_date,v_id,v_vendor,v_account,v_method,v_reminder,v_tags,v_plan.notes);
        v_remaining:=v_remaining-v_amount; v_n:=v_n+1;
        if v_n>240 then raise exception 'A plan can include at most 240 installments.'; end if;
      end loop;
    end if;
  elsif p_action='save_tag' then
    if v_id is null then raise exception 'A tag identifier is required.'; end if;
    if jsonb_typeof(p_payload->'name') is distinct from 'string' then raise exception 'Enter a valid tag name.'; end if;
    v_tag_name:=public.finance_normalize_tag_name(p_payload->>'name');
    select * into v_tag_record from public.finance_tags where id=v_id and user_id=p_actor for update;
    if v_tag_record.id is null and exists(select 1 from public.finance_tags where id=v_id) then raise exception using errcode='P0002',message='This tag was not found.'; end if;
    if exists(select 1 from public.finance_tags where user_id=p_actor and id<>v_id and public.finance_tag_name_key(name)=public.finance_tag_name_key(v_tag_name)) then
      raise exception 'A tag with this name already exists. Choose that tag, or restore it if archived.';
    end if;
    if v_tag_record.id is null then
      insert into public.finance_tags(id,user_id,name) values(v_id,p_actor,v_tag_name);
    elsif v_tag_record.name is distinct from v_tag_name then
      update public.finance_tags set name=v_tag_name,updated_at=now() where id=v_id and user_id=p_actor;
    end if;
  elsif p_action='archive_tag' then
    if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then raise exception 'Choose whether this tag should be archived.'; end if;
    update public.finance_tags set archived_at=case when (p_payload->>'archived')::boolean then coalesce(archived_at,now()) else null end,updated_at=now() where id=v_id and user_id=p_actor;
    if not found then raise exception using errcode='P0002',message='This tag was not found.'; end if;
  elsif p_action='save_vendor' then
    if v_id is null then raise exception 'A vendor identifier is required.'; end if;
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or (p_payload->>'name') ~ '[[:cntrl:]]' then raise exception 'Enter a valid vendor name.'; end if;
    if p_payload ? 'url' and jsonb_typeof(p_payload->'url') not in ('string','null') then raise exception 'Enter a valid vendor website.'; end if;
    v_vendor_name:=btrim(regexp_replace(p_payload->>'name','[[:space:]]+',' ','g'));
    if length(v_vendor_name) not between 1 and 200 then raise exception 'Enter a vendor name using 200 characters or fewer.'; end if;
    v_vendor_url:=public.finance_vendor_url(p_payload->>'url');
    select * into v_vendor_record from public.finance_vendors where id=v_id and user_id=p_actor for update;
    if v_vendor_record.id is null and exists(select 1 from public.finance_vendors where id=v_id) then raise exception using errcode='P0002',message='This vendor was not found.'; end if;
    if exists(select 1 from public.finance_vendors where user_id=p_actor and id<>v_id and lower(name)=lower(v_vendor_name)) then raise exception 'A vendor with this name already exists. Choose it from your vendors, or restore it if archived.'; end if;
    if v_vendor_record.id is null then
      insert into public.finance_vendors(id,user_id,name,url,notes) values(v_id,p_actor,v_vendor_name,v_vendor_url,coalesce(p_payload->>'notes',''));
    else
      update public.finance_vendors set name=v_vendor_name,url=v_vendor_url,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
    end if;
  elsif p_action='vendor_status' then
    if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then raise exception 'Choose whether this vendor should be archived.'; end if;
    update public.finance_vendors set archived_at=case when (p_payload->>'archived')::boolean then coalesce(archived_at,now()) else null end,updated_at=now() where id=v_id and user_id=p_actor;
    if not found then raise exception using errcode='P0002',message='This vendor was not found.'; end if;
  elsif p_action='plan_status' then
    select * into v_plan from public.finance_plans where id=v_id and user_id=p_actor for update;
    if v_plan.id is null then raise exception using errcode='P0002',message='This payment plan was not found.'; end if;
    if v_plan.status='collections' then raise exception 'Manage this plan on Credit & collections.'; end if;
    v_status:=p_payload->>'status'; if v_status not in ('active','cancelled') then raise exception 'Choose a valid plan status.'; end if;
    update public.finance_plans set status=v_status where id=v_id and user_id=p_actor;
    if v_status='cancelled' then
      update public.finance_entries e set status='cancelled',cancelled_by_plan=true,updated_at=now() where plan_id=v_id and user_id=p_actor and status='active'
        and amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and reversed_at is null),0);
    else
      update public.finance_entries set status='active',cancelled_by_plan=false,updated_at=now() where plan_id=v_id and user_id=p_actor and status='cancelled' and cancelled_by_plan;
    end if;
  elsif p_action='save_debt' then
    if v_id is not null then select * into v_debt from public.finance_debts where id=v_id and user_id=p_actor for update; end if;
    -- Older forms leave an existing assignment intact; an explicit empty list clears it.
    v_people:=case when p_payload ? 'responsible_people' then public.finance_responsible_people(p_payload->'responsible_people') else coalesce(v_debt.responsible_people,'{}'::text[]) end;
    v_id:=coalesce(v_id,gen_random_uuid());
    if v_debt.id is not null then
      if (p_payload->>'original_balance_cents')::bigint is distinct from v_debt.original_balance_cents then raise exception 'The original debt balance is preserved. Update the current balance and add a note.'; end if;
      update public.finance_debts set title=p_payload->>'title',stage=p_payload->>'stage',original_creditor=p_payload->>'original_creditor',collector=coalesce(p_payload->>'collector',''),current_balance_cents=(p_payload->>'current_balance_cents')::bigint,status=p_payload->>'status',date_added=(p_payload->>'date_added')::date,date_removed=nullif(p_payload->>'date_removed','')::date,settlement_offer_cents=nullif(p_payload->>'settlement_offer_cents','')::bigint,offer_monthly_cents=nullif(p_payload->>'offer_monthly_cents','')::bigint,offer_expires_on=nullif(p_payload->>'offer_expires_on','')::date,responsible_people=v_people,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor returning * into v_new_debt;
    else
      insert into public.finance_debts(id,user_id,title,stage,original_creditor,collector,original_balance_cents,current_balance_cents,status,date_added,date_removed,settlement_offer_cents,offer_monthly_cents,offer_expires_on,responsible_people,notes)
        values(v_id,p_actor,p_payload->>'title',p_payload->>'stage',p_payload->>'original_creditor',coalesce(p_payload->>'collector',''),(p_payload->>'original_balance_cents')::bigint,(p_payload->>'current_balance_cents')::bigint,p_payload->>'status',(p_payload->>'date_added')::date,nullif(p_payload->>'date_removed','')::date,nullif(p_payload->>'settlement_offer_cents','')::bigint,nullif(p_payload->>'offer_monthly_cents','')::bigint,nullif(p_payload->>'offer_expires_on','')::date,v_people,coalesce(p_payload->>'notes','')) returning * into v_new_debt;
    end if;
    v_changed:=v_debt.id is null or (to_jsonb(v_debt)-'updated_at') is distinct from (to_jsonb(v_new_debt)-'updated_at');
    if v_changed or coalesce(p_payload->>'change_note','')<>'' then
      insert into public.finance_debt_history(user_id,debt_id,previous_balance_cents,balance_cents,note,details)
        values(p_actor,v_id,v_debt.current_balance_cents,v_new_debt.current_balance_cents,coalesce(nullif(p_payload->>'change_note',''),case when v_debt.id is null then 'Debt added.' else 'Debt details updated.' end),pg_catalog.jsonb_build_object('previous_status',v_debt.status,'status',v_new_debt.status,'previous_settlement_offer_cents',v_debt.settlement_offer_cents,'settlement_offer_cents',v_new_debt.settlement_offer_cents,'previous_monthly_offer_cents',v_debt.offer_monthly_cents,'offer_monthly_cents',v_new_debt.offer_monthly_cents,'previous_responsible_people',coalesce(v_debt.responsible_people,'{}'::text[]),'responsible_people',v_new_debt.responsible_people));
    end if;
  elsif p_action='transfer_collections' then
    v_source_entry:=nullif(p_payload->>'entry_id','')::uuid; v_source_plan:=nullif(p_payload->>'plan_id','')::uuid;
    if (v_source_entry is null)=(v_source_plan is null) then raise exception 'Choose one bill or payment plan to transfer.'; end if;
    v_people:=case when p_payload ? 'responsible_people' then public.finance_responsible_people(p_payload->'responsible_people') else '{}'::text[] end;
    -- A retry never rewrites names on a debt already created by this source.
    select * into v_debt from public.finance_debts where user_id=p_actor and (source_entry_id=v_source_entry or source_plan_id=v_source_plan);
    if v_debt.id is not null then return pg_catalog.jsonb_build_object('id',v_debt.id,'replayed',true); end if;
    if v_source_entry is not null then
      select * into v_entry from public.finance_entries where id=v_source_entry and user_id=p_actor for update;
      if v_entry.id is null then raise exception using errcode='P0002',message='This bill was not found.'; end if;
      if v_entry.kind<>'bill' or v_entry.status<>'active' then raise exception 'Choose an active unpaid bill to transfer.'; end if;
      select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_entry.id and user_id=p_actor and reversed_at is null;
      v_remaining:=v_entry.amount_cents-v_paid;
    else
      select * into v_plan from public.finance_plans where id=v_source_plan and user_id=p_actor for update;
      if v_plan.id is null then raise exception using errcode='P0002',message='This plan was not found.'; end if;
      if v_plan.status<>'active' then raise exception 'Choose an active payment plan to transfer.'; end if;
      select coalesce(sum(greatest(e.amount_cents-coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and reversed_at is null),0),0)),0)
        into v_remaining from public.finance_entries e where e.plan_id=v_source_plan and e.user_id=p_actor and e.status<>'collections';
    end if;
    if v_remaining<=0 then raise exception 'There is no unpaid balance to transfer.'; end if;
    v_id:=coalesce(v_id,gen_random_uuid());
    insert into public.finance_debts(id,user_id,title,stage,original_creditor,collector,original_balance_cents,current_balance_cents,status,date_added,source_entry_id,source_plan_id,responsible_people,notes)
      values(v_id,p_actor,coalesce(v_entry.title,v_plan.title),'collections',coalesce(v_plan.creditor,v_entry.title),coalesce(p_payload->>'collector',''),v_remaining,v_remaining,'open',v_today,v_source_entry,v_source_plan,v_people,coalesce(p_payload->>'notes',''));
    if v_source_entry is not null then
      update public.finance_entries set status='collections',updated_at=now() where id=v_source_entry and user_id=p_actor;
    else
      update public.finance_plans set status='collections' where id=v_source_plan and user_id=p_actor;
      update public.finance_entries e set status='collections',updated_at=now() where plan_id=v_source_plan and user_id=p_actor and status<>'collections'
        and amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and reversed_at is null),0);
    end if;
    insert into public.finance_debt_history(user_id,debt_id,balance_cents,note,details) values(p_actor,v_id,v_remaining,'Unpaid balance transferred to collections.',pg_catalog.jsonb_build_object('source_entry_id',v_source_entry,'source_plan_id',v_source_plan,'previous_responsible_people','{}'::text[],'responsible_people',v_people));
  elsif p_action='save_account' then
    if v_id is null then raise exception 'An account identifier is required.'; end if;
    select * into v_account_record from public.finance_accounts where id=v_id and user_id=p_actor for update;
    if v_account_record.id is null and exists(select 1 from public.finance_accounts where id=v_id) then raise exception using errcode='P0002',message='This account was not found.'; end if;
    if p_payload->>'kind'<>'savings' and exists(select 1 from public.finance_savings_goals where user_id=p_actor and account_id=v_id and archived_at is null) then
      raise exception 'Move or archive this account''s active savings goals before changing its account type.';
    end if;
    if v_account_record.id is not null then
      perform public.finance_assert_account_tracking(p_actor,v_id,(p_payload->>'opening_date')::date);
      update public.finance_accounts set name=btrim(p_payload->>'name'),institution=coalesce(p_payload->>'institution',''),kind=p_payload->>'kind',last_four=nullif(p_payload->>'last_four',''),opening_date=(p_payload->>'opening_date')::date,opening_balance_cents=(p_payload->>'opening_balance_cents')::bigint,credit_limit_cents=nullif(p_payload->>'credit_limit_cents','')::bigint,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
    else
      insert into public.finance_accounts(id,user_id,name,institution,kind,last_four,opening_date,opening_balance_cents,credit_limit_cents,notes)
        values(v_id,p_actor,btrim(p_payload->>'name'),coalesce(p_payload->>'institution',''),p_payload->>'kind',nullif(p_payload->>'last_four',''),(p_payload->>'opening_date')::date,(p_payload->>'opening_balance_cents')::bigint,nullif(p_payload->>'credit_limit_cents','')::bigint,coalesce(p_payload->>'notes',''));
    end if;
  elsif p_action='account_status' then
    if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then raise exception 'Choose whether to archive this account.'; end if;
    update public.finance_accounts set archived_at=case when (p_payload->>'archived')::boolean then coalesce(archived_at,now()) else null end,updated_at=now() where id=v_id and user_id=p_actor;
    if not found then raise exception using errcode='P0002',message='This account was not found.'; end if;
  elsif p_action='save_balance_update' then
    if v_id is not null then select * into v_balance_update from public.finance_balance_updates where id=v_id and user_id=p_actor for update; end if;
    if v_balance_update.id is null and exists(select 1 from public.finance_balance_updates where id=v_id) then raise exception using errcode='P0002',message='This balance update was not found.'; end if;
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_balance_update.account_id);
    v_date:=(p_payload->>'date')::date; v_amount:=(p_payload->>'balance_cents')::bigint;
    if v_balance_update.id is not null then
      if exists(select 1 from public.finance_balance_updates where user_id=p_actor and account_id is not distinct from v_account and date=v_date and id<>v_id) then raise exception 'A balance update already exists for this account and date. Edit that update instead.'; end if;
      if v_balance_update.account_id is not null and (v_date is distinct from v_balance_update.date or v_account is distinct from v_balance_update.account_id) then
        perform public.finance_assert_account_tracking(p_actor,v_balance_update.account_id,null,v_id,case when v_account=v_balance_update.account_id then v_date else null end);
      end if;
      update public.finance_balance_updates set account_id=v_account,date=v_date,balance_cents=v_amount,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
    else
      select id into v_existing_id from public.finance_balance_updates where user_id=p_actor and account_id is not distinct from v_account and date=v_date;
      if v_existing_id is not null then
        v_id:=v_existing_id;
        update public.finance_balance_updates set balance_cents=v_amount,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
      else
        v_id:=coalesce(v_id,gen_random_uuid());
        insert into public.finance_balance_updates(id,user_id,account_id,date,balance_cents,notes) values(v_id,p_actor,v_account,v_date,v_amount,coalesce(p_payload->>'notes',''));
      end if;
    end if;
  elsif p_action='remove_balance_update' then
    select * into v_balance_update from public.finance_balance_updates where id=v_id and user_id=p_actor for update;
    if v_balance_update.account_id is not null then perform public.finance_assert_account_tracking(p_actor,v_balance_update.account_id,null,v_id); end if;
    delete from public.finance_balance_updates where id=v_id and user_id=p_actor;
  elsif p_action='save_transfer' then
    if v_id is null then raise exception 'A transfer identifier is required.'; end if;
    select * into v_transfer from public.finance_transfers where id=v_id and user_id=p_actor for update;
    if v_transfer.id is null and exists(select 1 from public.finance_transfers where id=v_id) then raise exception using errcode='P0002',message='This transfer was not found.'; end if;
    v_from:=public.finance_resolve_account(p_actor,p_payload,v_transfer.from_account_id,'from_account_id');
    v_to:=public.finance_resolve_account(p_actor,p_payload,v_transfer.to_account_id,'to_account_id');
    if v_from is null or v_to is null or v_from=v_to then raise exception 'Choose two different accounts for a transfer.'; end if;
    v_date:=(p_payload->>'date')::date; v_status:=p_payload->>'status';
    if v_status is null or v_status not in ('planned','completed','cancelled') then raise exception 'Choose a valid transfer status.'; end if;
    if v_status='completed' and v_date>v_today then raise exception 'Future transfers must stay planned until they happen.'; end if;
    if v_status<>'cancelled' then
      foreach v_account in array array[v_from,v_to] loop
        select min(x.date) into v_first_anchor from (select opening_date as date from public.finance_accounts where id=v_account and user_id=p_actor union all select date from public.finance_balance_updates where account_id=v_account and user_id=p_actor) x;
        if v_date<v_first_anchor then raise exception 'This transfer is before an account starts tracking. Add an earlier dated balance update for that account or choose a later transfer date.'; end if;
      end loop;
    end if;
    if v_transfer.id is null then
      insert into public.finance_transfers(id,user_id,from_account_id,to_account_id,amount_cents,date,status,notes) values(v_id,p_actor,v_from,v_to,(p_payload->>'amount_cents')::bigint,v_date,v_status,coalesce(p_payload->>'notes',''));
    else
      update public.finance_transfers set from_account_id=v_from,to_account_id=v_to,amount_cents=(p_payload->>'amount_cents')::bigint,date=v_date,status=v_status,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
    end if;
  elsif p_action='transfer_status' then
    select * into v_transfer from public.finance_transfers where id=v_id and user_id=p_actor for update;
    if v_transfer.id is null then raise exception using errcode='P0002',message='This transfer was not found.'; end if;
    v_status:=p_payload->>'status';
    if v_status is null or v_status not in ('planned','completed','cancelled') then raise exception 'Choose a valid transfer status.'; end if;
    if v_status='completed' and v_transfer.date>v_today then raise exception 'Future transfers must stay planned until they happen.'; end if;
    if v_status<>'cancelled' then
      foreach v_account in array array[v_transfer.from_account_id,v_transfer.to_account_id] loop
        select min(x.date) into v_first_anchor from (select opening_date as date from public.finance_accounts where id=v_account and user_id=p_actor union all select date from public.finance_balance_updates where account_id=v_account and user_id=p_actor) x;
        if v_transfer.date<v_first_anchor then raise exception 'This transfer is before an account starts tracking. Add an earlier dated balance update for that account or choose a later transfer date.'; end if;
      end loop;
    end if;
    update public.finance_transfers set status=v_status,updated_at=now() where id=v_id and user_id=p_actor;
  elsif p_action='snooze_reminder' then
    update public.finance_entries set reminder_snoozed_until=nullif(p_payload->>'until','')::date,updated_at=now() where id=v_id and user_id=p_actor;
    if not found then raise exception using errcode='P0002',message='This entry was not found.'; end if;
  elsif p_action='save_goal' then
    if v_id is null then raise exception 'A goal identifier is required.'; end if;
    select * into v_goal from public.finance_savings_goals where id=v_id and user_id=p_actor for update;
    if v_goal.id is null and exists(select 1 from public.finance_savings_goals where id=v_id) then raise exception using errcode='P0002',message='This savings goal was not found.'; end if;
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_goal.account_id);
    select * into v_account_record from public.finance_accounts where id=v_account and user_id=p_actor;
    if v_account_record.id is null or v_account_record.kind<>'savings' then raise exception 'Savings goals must use a savings account.'; end if;
    v_amount:=(p_payload->>'allocated_cents')::bigint; v_target:=(p_payload->>'target_cents')::bigint;
    if v_goal.id is null or v_amount>v_goal.allocated_cents or v_account is distinct from v_goal.account_id then
      v_actual:=public.finance_actual_account_balance(p_actor,v_account,v_today);
      select coalesce(sum(allocated_cents),0) into v_other_allocations from public.finance_savings_goals where user_id=p_actor and account_id=v_account and id<>v_id and archived_at is null;
      v_available:=greatest(0,greatest(v_actual,0)-v_other_allocations);
      if v_amount>v_available then raise exception 'This allocation exceeds the unallocated savings in this account. Lower the allocation or record the real balance or completed transfer first.'; end if;
    end if;
    select coalesce(array_agg(m order by m),'{}'::integer[]) into v_new_milestones from unnest(array[25,50,75,100]) m
      where v_amount*100>=v_target*m and not m=any(coalesce(v_goal.achieved_milestones,'{}'::integer[]));
    select coalesce(array_agg(distinct m order by m),'{}'::integer[]) into v_all_milestones from unnest(coalesce(v_goal.achieved_milestones,'{}'::integer[])||v_new_milestones) m;
    if v_goal.id is null then
      insert into public.finance_savings_goals(id,user_id,account_id,title,target_cents,allocated_cents,start_date,target_date,notes,achieved_milestones)
        values(v_id,p_actor,v_account,p_payload->>'title',v_target,v_amount,(p_payload->>'start_date')::date,nullif(p_payload->>'target_date','')::date,coalesce(p_payload->>'notes',''),v_all_milestones) returning * into v_new_goal;
    else
      update public.finance_savings_goals set account_id=v_account,title=p_payload->>'title',target_cents=v_target,allocated_cents=v_amount,start_date=(p_payload->>'start_date')::date,target_date=nullif(p_payload->>'target_date','')::date,notes=coalesce(p_payload->>'notes',''),achieved_milestones=v_all_milestones,updated_at=now() where id=v_id and user_id=p_actor returning * into v_new_goal;
    end if;
    v_changed:=v_goal.id is null or (to_jsonb(v_goal)-'updated_at') is distinct from (to_jsonb(v_new_goal)-'updated_at');
    v_note:=coalesce(nullif(p_payload->>'change_note',''),case when v_goal.id is null then 'Savings goal created.' when v_account is distinct from v_goal.account_id then 'Goal moved to another savings account.' when v_amount is distinct from v_goal.allocated_cents then 'Savings allocation updated.' else 'Savings goal details updated.' end);
    if v_changed or (coalesce(p_payload->>'change_note','')<>'' and v_note is distinct from (select note from public.finance_goal_history where user_id=p_actor and goal_id=v_id order by created_at desc,id desc limit 1)) then
      insert into public.finance_goal_history(user_id,goal_id,previous_allocated_cents,allocated_cents,note) values(p_actor,v_id,v_goal.allocated_cents,v_amount,v_note);
    end if;
    return jsonb_build_object('id',v_id,'milestones',v_new_milestones);
  elsif p_action='goal_status' then
    select * into v_goal from public.finance_savings_goals where id=v_id and user_id=p_actor for update;
    if v_goal.id is null then raise exception using errcode='P0002',message='This savings goal was not found.'; end if;
    if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then raise exception 'Choose whether to archive this savings goal.'; end if;
    if (p_payload->>'archived')::boolean=(v_goal.archived_at is not null) then return jsonb_build_object('id',v_id,'milestones','[]'::jsonb); end if;
    if not (p_payload->>'archived')::boolean then
      select * into v_account_record from public.finance_accounts where id=v_goal.account_id and user_id=p_actor;
      if v_account_record.kind<>'savings' then raise exception 'Move this goal to a savings account before restoring it.'; end if;
      v_actual:=public.finance_actual_account_balance(p_actor,v_goal.account_id,v_today);
      select coalesce(sum(allocated_cents),0) into v_other_allocations from public.finance_savings_goals where user_id=p_actor and account_id=v_goal.account_id and id<>v_id and archived_at is null;
      if v_goal.allocated_cents>greatest(0,greatest(v_actual,0)-v_other_allocations) then raise exception 'This account does not have enough unallocated savings to restore the goal. Lower its allocation or record the real balance first.'; end if;
    end if;
    update public.finance_savings_goals set archived_at=case when (p_payload->>'archived')::boolean then now() else null end,updated_at=now() where id=v_id and user_id=p_actor;
    insert into public.finance_goal_history(user_id,goal_id,previous_allocated_cents,allocated_cents,note) values(p_actor,v_id,v_goal.allocated_cents,v_goal.allocated_cents,case when (p_payload->>'archived')::boolean then 'Savings goal archived; its allocation is no longer reserved.' else 'Savings goal restored.' end);
  elsif p_action='save_month' then
    insert into public.finance_months(user_id,month,opening_balance_cents) values(p_actor,p_payload->>'month',(p_payload->>'opening_balance_cents')::bigint)
      on conflict(user_id,month) do update set opening_balance_cents=excluded.opening_balance_cents,updated_at=now();
  elsif p_action='save_spending' then
    v_id:=coalesce(v_id,gen_random_uuid());
    if exists(select 1 from public.finance_spending where id=v_id and user_id<>p_actor) then raise exception using errcode='P0002',message='This spending item was not found.'; end if;
    select account_id into v_current_account from public.finance_spending where id=v_id and user_id=p_actor;
    v_account:=public.finance_resolve_account(p_actor,p_payload,v_current_account);
    insert into public.finance_spending(id,user_id,date,title,amount_cents,account_id) values(v_id,p_actor,(p_payload->>'date')::date,p_payload->>'title',(p_payload->>'amount_cents')::bigint,v_account)
      on conflict(id) do update set date=excluded.date,title=excluded.title,amount_cents=excluded.amount_cents,account_id=excluded.account_id where finance_spending.user_id=p_actor;
  elsif p_action='remove_spending' then
    delete from public.finance_spending where id=v_id and user_id=p_actor;
  elsif p_action='clear_spending' then
    if (p_payload->>'month') !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Choose a valid month.'; end if;
    if p_payload ? 'account_id' then v_account:=public.finance_resolve_account(p_actor,p_payload,(p_payload->>'account_id')::uuid); end if;
    delete from public.finance_spending where user_id=p_actor and date>=(p_payload->>'month'||'-01')::date and date<((p_payload->>'month'||'-01')::date+interval '1 month')::date
      and (not p_payload ? 'account_id' or account_id is not distinct from v_account);
  else raise exception 'This finance action is not available.';
  end if;
  return pg_catalog.jsonb_build_object('id',v_id);
end;
$$;

create or replace function public.finance_snapshot(p_actor uuid,p_through date)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.finance_expand(p_actor,p_through);
  return pg_catalog.jsonb_build_object(
    'today',(now() at time zone 'America/Chicago')::date,
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.original_due_date,e.id) from public.finance_entries e where e.user_id=p_actor),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_on,p.id) from public.finance_payments p where p.user_id=p_actor),'[]'::jsonb),
    'series',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from public.finance_series s where s.user_id=p_actor),'[]'::jsonb),
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

-- New helpers and trigger functions stay private, just like the existing RPCs.
revoke all on function public.finance_normalize_tag_name(text),public.finance_tag_name_key(text),public.finance_tag_identity_guard(),public.finance_tag_links_check(),public.finance_resolve_tags(uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.finance_normalize_tag_name(text),public.finance_tag_name_key(text),public.finance_tag_identity_guard(),public.finance_tag_links_check(),public.finance_resolve_tags(uuid,jsonb,uuid[]) to service_role;
revoke all on function public.finance_occurrence_date(date,text,integer),public.finance_expand(uuid,date),public.finance_mutate(uuid,text,jsonb),public.finance_snapshot(uuid,date) from public,anon,authenticated;
grant execute on function public.finance_occurrence_date(date,text,integer),public.finance_expand(uuid,date),public.finance_mutate(uuid,text,jsonb),public.finance_snapshot(uuid,date) to service_role;
