-- Private finance workspace. Browser roles have no direct table or RPC access.
-- All cents are integers; original obligations survive rescheduling and cancellation.
create table if not exists public.finance_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.finance_months (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check(month ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
  opening_balance_cents bigint not null check(abs(opening_balance_cents) <= 1000000000000),
  updated_at timestamptz not null default now(), primary key(user_id,month)
);
create table if not exists public.finance_series (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('bill','income')), title text not null check(length(title) between 1 and 200),
  category text not null check(length(category) between 1 and 80),
  expense_type text not null default 'bill' check(expense_type in ('bill','installment','payment_plan')),
  amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
  start_date date not null check(start_date between date '2000-01-01' and date '2100-12-31'),
  end_date date check(end_date >= start_date and end_date <= date '2100-12-31'),
  frequency text not null check(frequency in ('weekly','biweekly','monthly','yearly')),
  active boolean not null default true, notes text not null default '' check(length(notes)<=4000),
  created_at timestamptz not null default now(), unique(id,user_id)
);
create index if not exists finance_series_user_idx on public.finance_series(user_id);
create table if not exists public.finance_plans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 200), creditor text not null check(length(creditor) between 1 and 200),
  kind text not null check(kind in ('installment','payment_plan')), category text not null check(length(category) between 1 and 80),
  total_amount_cents bigint not null check(total_amount_cents between 1 and 1000000000000),
  opening_paid_cents bigint not null default 0 check(opening_paid_cents between 0 and total_amount_cents),
  installment_amount_cents bigint not null check(installment_amount_cents between 1 and 1000000000000),
  frequency text not null check(frequency in ('weekly','biweekly','monthly')),
  first_due_date date not null check(first_due_date between date '2000-01-01' and date '2100-12-31'),
  status text not null default 'active' check(status in ('active','cancelled','collections')),
  notes text not null default '' check(length(notes)<=4000), created_at timestamptz not null default now(), unique(id,user_id),
  check(ceil((total_amount_cents-opening_paid_cents)::numeric/installment_amount_cents)<=240)
);
create index if not exists finance_plans_user_idx on public.finance_plans(user_id);
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('bill','income')), title text not null check(length(title) between 1 and 200),
  category text not null check(length(category) between 1 and 80),
  expense_type text not null default 'bill' check(expense_type in ('bill','installment','payment_plan')),
  amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
  original_amount_cents bigint not null check(original_amount_cents between 1 and 1000000000000),
  original_due_date date not null check(original_due_date between date '2000-01-01' and date '2100-12-31'),
  scheduled_date date not null check(scheduled_date between date '2000-01-01' and date '2100-12-31'),
  status text not null default 'active' check(status in ('active','cancelled','collections')),
  archived_at timestamptz, series_id uuid, plan_id uuid,
  cancelled_by_plan boolean not null default false,
  notes text not null default '' check(length(notes)<=4000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
  foreign key(series_id,user_id) references public.finance_series(id,user_id),
  foreign key(plan_id,user_id) references public.finance_plans(id,user_id),
  check(series_id is null or plan_id is null),
  unique(series_id,original_due_date)
);
create index if not exists finance_entries_user_schedule_idx on public.finance_entries(user_id,scheduled_date);
create index if not exists finance_entries_user_original_idx on public.finance_entries(user_id,original_due_date);
create index if not exists finance_entries_plan_idx on public.finance_entries(plan_id,user_id) where plan_id is not null;
create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null, amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
  paid_on date not null check(paid_on between date '2000-01-01' and date '2100-12-31'),
  note text not null default '' check(length(note)<=1000), reversed_at timestamptz, created_at timestamptz not null default now(),
  foreign key(entry_id,user_id) references public.finance_entries(id,user_id)
);
create index if not exists finance_payments_user_idx on public.finance_payments(user_id,paid_on);
create index if not exists finance_payments_entry_idx on public.finance_payments(entry_id,user_id);
create table if not exists public.finance_debts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 200), stage text not null check(stage in ('credit_report','collections')),
  original_creditor text not null check(length(original_creditor) between 1 and 200), collector text not null default '' check(length(collector)<=200),
  original_balance_cents bigint not null check(original_balance_cents between 0 and 1000000000000),
  current_balance_cents bigint not null check(current_balance_cents between 0 and 1000000000000),
  status text not null default 'open' check(status in ('open','charged_off','closed','paid')),
  date_added date not null check(date_added between date '2000-01-01' and date '2100-12-31'),
  date_removed date check(date_removed >= date_added and date_removed<=date '2100-12-31'),
  settlement_offer_cents bigint check(settlement_offer_cents between 0 and 1000000000000),
  offer_monthly_cents bigint check(offer_monthly_cents between 0 and 1000000000000), offer_expires_on date,
  source_entry_id uuid, source_plan_id uuid,
  notes text not null default '' check(length(notes)<=4000), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), unique(source_entry_id), unique(source_plan_id),
  foreign key(source_entry_id,user_id) references public.finance_entries(id,user_id),
  foreign key(source_plan_id,user_id) references public.finance_plans(id,user_id),
  check(source_entry_id is null or source_plan_id is null), check(status<>'paid' or current_balance_cents=0)
);
create index if not exists finance_debts_user_idx on public.finance_debts(user_id,stage);
create table if not exists public.finance_debt_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  debt_id uuid not null, previous_balance_cents bigint, balance_cents bigint not null,
  note text not null default '', details jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(debt_id,user_id) references public.finance_debts(id,user_id)
);
create index if not exists finance_debt_history_user_idx on public.finance_debt_history(user_id,created_at);
create index if not exists finance_debt_history_debt_idx on public.finance_debt_history(debt_id,user_id);
create table if not exists public.finance_spending (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  date date not null check(date between date '2000-01-01' and date '2100-12-31'),
  title text not null check(length(title) between 1 and 200), amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
  created_at timestamptz not null default now()
);
create index if not exists finance_spending_user_idx on public.finance_spending(user_id,date);
create table if not exists public.finance_entry_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null, action text not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(entry_id,user_id) references public.finance_entries(id,user_id)
);
create index if not exists finance_entry_history_user_idx on public.finance_entry_history(user_id,created_at);
create index if not exists finance_entry_history_entry_idx on public.finance_entry_history(entry_id,user_id);

create or replace function public.finance_assert_actor(p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or not exists(
    select 1 from public.finance_access a join public.hub_staff s on s.user_id=a.user_id
    where a.user_id=p_actor and a.active and s.active and s.role='owner'
      and public.hub_actor_can(p_actor,'staff:write',null)
  ) then raise exception using errcode='42501',message='Finance is available only to its approved owner.'; end if;
  -- A single per-owner lock serializes financial updates, including duplicate retries.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,751134));
end;
$$;

create or replace function public.finance_occurrence_date(p_anchor date,p_frequency text,p_index integer)
returns date language plpgsql immutable strict security invoker set search_path='' as $$
begin
  if p_index < 0 then raise exception 'Occurrence index must be nonnegative.'; end if;
  if p_frequency='weekly' then return p_anchor + 7*p_index;
  elsif p_frequency='biweekly' then return p_anchor + 14*p_index;
  elsif p_frequency='monthly' then return (p_anchor + pg_catalog.make_interval(months=>p_index))::date;
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
    n:=0;
    loop
      d:=public.finance_occurrence_date(s.start_date,s.frequency,n);
      exit when d>p_through or (s.end_date is not null and d>s.end_date);
      insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,notes)
        values(p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,d,d,s.id,s.notes)
        on conflict(series_id,original_due_date) do nothing;
      get diagnostics affected=row_count; added:=added+affected; n:=n+1;
      if n>10000 then raise exception 'This repeating schedule exceeds the supported forecast range.'; end if;
    end loop;
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
  v_note text; v_changed boolean; v_count integer;
begin
  perform public.finance_assert_actor(p_actor);
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object' then raise exception 'Enter the details for this change.'; end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if p_action='save_entry' then
    if v_id is not null then select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update; end if;
    v_amount:=(p_payload->>'amount_cents')::bigint;
    if v_entry.id is not null then
      if v_entry.status='collections' then raise exception 'Manage this item on Credit & collections.'; end if;
      if (p_payload->>'kind') is distinct from v_entry.kind or (p_payload->>'original_due_date')::date is distinct from v_entry.original_due_date then raise exception 'The original type and due date are preserved. Use the payment date to move this occurrence.'; end if;
      if v_entry.plan_id is not null and (v_amount<>v_entry.amount_cents or p_payload->>'expense_type' is distinct from v_entry.expense_type) then raise exception 'Installment amounts and types are fixed by their payment plan. You can move the payment date.'; end if;
      select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_id and user_id=p_actor and reversed_at is null;
      if v_amount<v_paid then raise exception 'The bill or income amount cannot be lower than its recorded payments.'; end if;
      update public.finance_entries set title=p_payload->>'title',category=p_payload->>'category',expense_type=p_payload->>'expense_type',amount_cents=v_amount,scheduled_date=(p_payload->>'scheduled_date')::date,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,v_id,'edited',pg_catalog.jsonb_build_object('previous_amount_cents',v_entry.amount_cents,'amount_cents',v_amount,'previous_scheduled_date',v_entry.scheduled_date,'scheduled_date',p_payload->>'scheduled_date'));
    else
      v_id:=coalesce(v_id,gen_random_uuid());
      if coalesce(p_payload->>'frequency','once')<>'once' then
        insert into public.finance_series(user_id,kind,title,category,expense_type,amount_cents,start_date,end_date,frequency,notes)
          values(p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,(p_payload->>'original_due_date')::date,nullif(p_payload->>'end_date','')::date,p_payload->>'frequency',coalesce(p_payload->>'notes','')) returning id into v_series;
      end if;
      insert into public.finance_entries(id,user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,notes)
        values(v_id,p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,v_amount,(p_payload->>'original_due_date')::date,(p_payload->>'scheduled_date')::date,v_series,coalesce(p_payload->>'notes',''));
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
      if v_payment.entry_id is distinct from (p_payload->>'entry_id')::uuid or v_payment.amount_cents is distinct from (p_payload->>'amount_cents')::bigint or v_payment.paid_on is distinct from (p_payload->>'paid_on')::date then raise exception 'This payment identifier was already used. Reopen the payment form.'; end if;
      return pg_catalog.jsonb_build_object('id',v_id,'replayed',true);
    end if;
    select * into v_entry from public.finance_entries where id=(p_payload->>'entry_id')::uuid and user_id=p_actor for update;
    if v_entry.id is null then raise exception using errcode='P0002',message='This entry was not found.'; end if;
    if v_entry.status<>'active' then raise exception 'Restore this entry before recording a payment or receipt.'; end if;
    v_amount:=(p_payload->>'amount_cents')::bigint; v_date:=(p_payload->>'paid_on')::date;
    if v_date>v_today then raise exception 'Record a payment only after it has happened. Use the scheduled date for future payments.'; end if;
    select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_entry.id and user_id=p_actor and reversed_at is null;
    if v_amount>v_entry.amount_cents-v_paid then raise exception 'This payment exceeds the remaining amount.'; end if;
    insert into public.finance_payments(id,user_id,entry_id,amount_cents,paid_on,note) values(v_id,p_actor,v_entry.id,v_amount,v_date,coalesce(p_payload->>'note',''));
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
    if v_plan.id is not null then
      if (p_payload->>'total_amount_cents')::bigint is distinct from v_plan.total_amount_cents or (p_payload->>'opening_paid_cents')::bigint is distinct from v_plan.opening_paid_cents or (p_payload->>'installment_amount_cents')::bigint is distinct from v_plan.installment_amount_cents or p_payload->>'frequency' is distinct from v_plan.frequency or (p_payload->>'first_due_date')::date is distinct from v_plan.first_due_date or p_payload->>'kind' is distinct from v_plan.kind then raise exception 'A saved plan keeps its original amounts and schedule. Move individual payment dates or create a new plan.'; end if;
      update public.finance_plans set title=p_payload->>'title',creditor=p_payload->>'creditor',category=p_payload->>'category',notes=coalesce(p_payload->>'notes','') where id=v_id and user_id=p_actor;
    else
      v_id:=coalesce(v_id,gen_random_uuid());
      insert into public.finance_plans(id,user_id,title,creditor,kind,category,total_amount_cents,opening_paid_cents,installment_amount_cents,frequency,first_due_date,notes)
        values(v_id,p_actor,p_payload->>'title',p_payload->>'creditor',p_payload->>'kind',p_payload->>'category',(p_payload->>'total_amount_cents')::bigint,(p_payload->>'opening_paid_cents')::bigint,(p_payload->>'installment_amount_cents')::bigint,p_payload->>'frequency',(p_payload->>'first_due_date')::date,coalesce(p_payload->>'notes','')) returning * into v_plan;
      v_remaining:=v_plan.total_amount_cents-v_plan.opening_paid_cents; v_n:=0;
      while v_remaining>0 loop
        v_amount:=least(v_remaining,v_plan.installment_amount_cents); v_date:=public.finance_occurrence_date(v_plan.first_due_date,v_plan.frequency,v_n);
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,plan_id,notes)
          values(p_actor,'bill',left(v_plan.title,190)||' · '||(v_n+1)::text,v_plan.category,v_plan.kind,v_amount,v_amount,v_date,v_date,v_id,v_plan.notes);
        v_remaining:=v_remaining-v_amount; v_n:=v_n+1;
        if v_n>240 then raise exception 'A plan can include at most 240 installments.'; end if;
      end loop;
    end if;
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
    v_id:=coalesce(v_id,gen_random_uuid());
    if v_debt.id is not null then
      if (p_payload->>'original_balance_cents')::bigint is distinct from v_debt.original_balance_cents then raise exception 'The original debt balance is preserved. Update the current balance and add a note.'; end if;
      update public.finance_debts set title=p_payload->>'title',stage=p_payload->>'stage',original_creditor=p_payload->>'original_creditor',collector=coalesce(p_payload->>'collector',''),current_balance_cents=(p_payload->>'current_balance_cents')::bigint,status=p_payload->>'status',date_added=(p_payload->>'date_added')::date,date_removed=nullif(p_payload->>'date_removed','')::date,settlement_offer_cents=nullif(p_payload->>'settlement_offer_cents','')::bigint,offer_monthly_cents=nullif(p_payload->>'offer_monthly_cents','')::bigint,offer_expires_on=nullif(p_payload->>'offer_expires_on','')::date,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor returning * into v_new_debt;
    else
      insert into public.finance_debts(id,user_id,title,stage,original_creditor,collector,original_balance_cents,current_balance_cents,status,date_added,date_removed,settlement_offer_cents,offer_monthly_cents,offer_expires_on,notes)
        values(v_id,p_actor,p_payload->>'title',p_payload->>'stage',p_payload->>'original_creditor',coalesce(p_payload->>'collector',''),(p_payload->>'original_balance_cents')::bigint,(p_payload->>'current_balance_cents')::bigint,p_payload->>'status',(p_payload->>'date_added')::date,nullif(p_payload->>'date_removed','')::date,nullif(p_payload->>'settlement_offer_cents','')::bigint,nullif(p_payload->>'offer_monthly_cents','')::bigint,nullif(p_payload->>'offer_expires_on','')::date,coalesce(p_payload->>'notes','')) returning * into v_new_debt;
    end if;
    v_changed:=v_debt.id is null or (to_jsonb(v_debt)-'updated_at') is distinct from (to_jsonb(v_new_debt)-'updated_at');
    if v_changed or coalesce(p_payload->>'change_note','')<>'' then
      insert into public.finance_debt_history(user_id,debt_id,previous_balance_cents,balance_cents,note,details)
        values(p_actor,v_id,v_debt.current_balance_cents,v_new_debt.current_balance_cents,coalesce(nullif(p_payload->>'change_note',''),case when v_debt.id is null then 'Debt added.' else 'Debt details updated.' end),pg_catalog.jsonb_build_object('previous_status',v_debt.status,'status',v_new_debt.status,'previous_settlement_offer_cents',v_debt.settlement_offer_cents,'settlement_offer_cents',v_new_debt.settlement_offer_cents,'previous_monthly_offer_cents',v_debt.offer_monthly_cents,'offer_monthly_cents',v_new_debt.offer_monthly_cents));
    end if;
  elsif p_action='transfer_collections' then
    v_source_entry:=nullif(p_payload->>'entry_id','')::uuid; v_source_plan:=nullif(p_payload->>'plan_id','')::uuid;
    if (v_source_entry is null)=(v_source_plan is null) then raise exception 'Choose one bill or payment plan to transfer.'; end if;
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
    insert into public.finance_debts(id,user_id,title,stage,original_creditor,collector,original_balance_cents,current_balance_cents,status,date_added,source_entry_id,source_plan_id,notes)
      values(v_id,p_actor,coalesce(v_entry.title,v_plan.title),'collections',coalesce(v_plan.creditor,v_entry.title),coalesce(p_payload->>'collector',''),v_remaining,v_remaining,'open',v_today,v_source_entry,v_source_plan,coalesce(p_payload->>'notes',''));
    if v_source_entry is not null then
      update public.finance_entries set status='collections',updated_at=now() where id=v_source_entry and user_id=p_actor;
    else
      update public.finance_plans set status='collections' where id=v_source_plan and user_id=p_actor;
      update public.finance_entries e set status='collections',updated_at=now() where plan_id=v_source_plan and user_id=p_actor and status<>'collections'
        and amount_cents>coalesce((select sum(p.amount_cents) from public.finance_payments p where p.entry_id=e.id and p.user_id=p_actor and reversed_at is null),0);
    end if;
    insert into public.finance_debt_history(user_id,debt_id,balance_cents,note,details) values(p_actor,v_id,v_remaining,'Unpaid balance transferred to collections.',pg_catalog.jsonb_build_object('source_entry_id',v_source_entry,'source_plan_id',v_source_plan));
  elsif p_action='save_month' then
    insert into public.finance_months(user_id,month,opening_balance_cents) values(p_actor,p_payload->>'month',(p_payload->>'opening_balance_cents')::bigint)
      on conflict(user_id,month) do update set opening_balance_cents=excluded.opening_balance_cents,updated_at=now();
  elsif p_action='save_spending' then
    v_id:=coalesce(v_id,gen_random_uuid());
    if exists(select 1 from public.finance_spending where id=v_id and user_id<>p_actor) then raise exception using errcode='P0002',message='This spending item was not found.'; end if;
    insert into public.finance_spending(id,user_id,date,title,amount_cents) values(v_id,p_actor,(p_payload->>'date')::date,p_payload->>'title',(p_payload->>'amount_cents')::bigint)
      on conflict(id) do update set date=excluded.date,title=excluded.title,amount_cents=excluded.amount_cents where finance_spending.user_id=p_actor;
  elsif p_action='remove_spending' then
    delete from public.finance_spending where id=v_id and user_id=p_actor;
  elsif p_action='clear_spending' then
    if (p_payload->>'month') !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then raise exception 'Choose a valid month.'; end if;
    delete from public.finance_spending where user_id=p_actor and date>=(p_payload->>'month'||'-01')::date and date<((p_payload->>'month'||'-01')::date+interval '1 month')::date;
  else raise exception 'This finance action is not available.';
  end if;
  return pg_catalog.jsonb_build_object('id',v_id);
end;
$$;

-- Every finance object remains private even if callers know table or function names.
do $$
declare t text;
begin
  foreach t in array array['finance_access','finance_months','finance_series','finance_plans','finance_entries','finance_payments','finance_debts','finance_debt_history','finance_spending','finance_entry_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    if t='finance_access' then execute format('grant select on table public.%I to service_role',t);
    else execute format('grant select,insert,update,delete on table public.%I to service_role',t); end if;
  end loop;
end;
$$;
-- Read one consistent account snapshot after materializing recurring occurrences.
-- A single RPC avoids PostgREST's per-table row ceiling and ledger/entry races.
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
    'months',coalesce((select jsonb_agg(to_jsonb(m) order by m.month) from public.finance_months m where m.user_id=p_actor),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.finance_snapshot(uuid,date) from public,anon,authenticated;
grant execute on function public.finance_snapshot(uuid,date) to service_role;

revoke all on function public.finance_assert_actor(uuid) from public,anon,authenticated;
revoke all on function public.finance_occurrence_date(date,text,integer) from public,anon,authenticated;
revoke all on function public.finance_expand(uuid,date) from public,anon,authenticated;
revoke all on function public.finance_mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finance_assert_actor(uuid),public.finance_occurrence_date(date,text,integer),public.finance_expand(uuid,date),public.finance_mutate(uuid,text,jsonb) to service_role;

-- Resolve the already verified owner in this project; no generated user ID is embedded.
insert into public.finance_access(user_id)
select u.id from auth.users u join public.hub_staff s on s.user_id=u.id
where lower(u.email)='janna@geofoxapps.com' and u.email_confirmed_at is not null and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=now()) and s.role='owner' and s.active
on conflict(user_id) do nothing;
