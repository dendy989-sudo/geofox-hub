-- Add private vendors and custom recurrence without changing existing obligations.
-- URL checks run both at the API boundary and inside the service-only database API.
create or replace function public.finance_vendor_url(p_url text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare v_url text; v_authority text; v_host text; v_port text; v_label text; v_address inet;
begin
  if p_url is null or p_url ~ '^[[:space:]]*$' then return null; end if;
  if length(p_url)>2048 or p_url ~ '[[:cntrl:]]' then raise exception 'Enter a website without control characters, using 2048 characters or fewer.'; end if;
  v_url:=btrim(p_url);
  if v_url ~ '[[:space:]]' or strpos(v_url,chr(92))>0 or left(v_url,1) in ('/','?','#') then
    raise exception 'Enter a complete vendor website without spaces or backslashes.';
  end if;
  if v_url !~* '^https?://' then
    if v_url ~ '^[A-Za-z][A-Za-z0-9+.-]*:' and v_url !~ '^[^/:?#]*[.][^/:?#]+:[0-9]+([/?#]|$)' then
      raise exception 'Vendor websites must use http or https.';
    end if;
    v_url:='https://'||v_url;
  end if;
  if length(v_url)>2048 then raise exception 'Enter a vendor website using 2048 characters or fewer.'; end if;
  v_authority:=substring(v_url from '(?i)^https?://([^/?#]+)');
  if v_authority is null or strpos(v_authority,'@')>0 then raise exception 'Vendor websites cannot include login credentials.'; end if;
  if left(v_authority,1)='[' then
    if v_authority !~ '^\[[0-9A-Fa-f:.]+\](:[0-9]+)?$' then raise exception 'Enter a valid vendor website host.'; end if;
    v_host:=substring(v_authority from '^\[([^]]+)\]');
    v_port:=substring(v_authority from '\]:([0-9]+)$');
    begin
      v_address:=v_host::inet;
      if family(v_address)<>6 then raise exception 'Invalid IPv6 address'; end if;
    exception when others then raise exception 'Enter a valid vendor website host.';
    end;
  else
    if v_authority !~ '^[^:]+(:[0-9]+)?$' then raise exception 'Enter a valid vendor website host and port.'; end if;
    v_host:=split_part(v_authority,':',1); v_port:=substring(v_authority from ':([0-9]+)$');
    if right(v_host,1)='.' then v_host:=left(v_host,length(v_host)-1); end if;
    if length(v_host) not between 1 and 253 then raise exception 'Enter a valid vendor website host.'; end if;
    foreach v_label in array string_to_array(v_host,'.') loop
      if length(v_label) not between 1 and 63 or v_label !~ '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$' then
        raise exception 'Enter a valid vendor website host.';
      end if;
    end loop;
    if v_host ~ '^[0-9]+([.][0-9]+){3}$' then
      begin v_address:=v_host::inet;
      exception when others then raise exception 'Enter a valid vendor website host.'; end;
    end if;
  end if;
  if v_port is not null and (length(v_port)>5 or v_port::integer>65535) then raise exception 'Enter a valid vendor website port.'; end if;
  return v_url;
end;
$$;

create or replace function public.finance_custom_schedule_valid(p_frequency text,p_mode text,p_days integer[],p_dates date[],p_start date,p_end date)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_days integer[]; v_dates date[]; v_last_day integer;
begin
  if p_days is null or p_dates is null or p_start is null then return false; end if;
  if p_frequency<>'custom' then return p_mode is null and cardinality(p_days)=0 and cardinality(p_dates)=0; end if;
  if p_mode='month_days' then
    if cardinality(p_days) not between 1 and 31 or cardinality(p_dates)<>0 or array_ndims(p_days)<>1 or array_lower(p_days,1)<>1 or array_position(p_days,null) is not null then return false; end if;
    if exists(select 1 from unnest(p_days) d where d not between 1 and 31) then return false; end if;
    select array_agg(distinct d order by d) into v_days from unnest(p_days) d;
    if v_days is distinct from p_days then return false; end if;
    v_last_day:=extract(day from (date_trunc('month',p_start::timestamp)+interval '1 month - 1 day'))::integer;
    return exists(select 1 from unnest(p_days) d where least(d,v_last_day)=extract(day from p_start)::integer);
  elsif p_mode='specific_dates' then
    if cardinality(p_dates) not between 1 and 240 or cardinality(p_days)<>0 or array_ndims(p_dates)<>1 or array_lower(p_dates,1)<>1 or array_position(p_dates,null) is not null then return false; end if;
    if exists(select 1 from unnest(p_dates) d where d<date '2000-01-01' or d>date '2100-12-31' or d<p_start or (p_end is not null and d>p_end)) then return false; end if;
    select array_agg(distinct d order by d) into v_dates from unnest(p_dates) d;
    return v_dates is not distinct from p_dates and p_dates[1]=p_start;
  end if;
  return false;
end;
$$;

create table if not exists public.finance_vendors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 200 and name=btrim(regexp_replace(name,'[[:space:]]+',' ','g')) and name !~ '[[:cntrl:]]'),
  url text check(url is null or url=public.finance_vendor_url(url)),
  notes text not null default '' check(length(notes)<=4000), archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create unique index if not exists finance_vendors_user_name_idx on public.finance_vendors(user_id,lower(name));
alter table public.finance_vendors enable row level security;
-- Reset Supabase's default grants before granting only the app's required access.
revoke all privileges on table public.finance_vendors from public,anon,authenticated,service_role;
grant select,insert,update on table public.finance_vendors to service_role;

alter table public.finance_entries add column if not exists vendor_id uuid;
alter table public.finance_plans add column if not exists vendor_id uuid;
alter table public.finance_series add column if not exists vendor_id uuid;
alter table public.finance_series add column if not exists custom_mode text;
alter table public.finance_series add column if not exists custom_month_days integer[] not null default '{}';
alter table public.finance_series add column if not exists custom_dates date[] not null default '{}';
alter table public.finance_series drop constraint if exists finance_series_frequency_check;
alter table public.finance_series add constraint finance_series_frequency_check check(frequency in ('weekly','biweekly','monthly','yearly','custom'));
alter table public.finance_series drop constraint if exists finance_series_custom_schedule_check;
alter table public.finance_series add constraint finance_series_custom_schedule_check
  check(public.finance_custom_schedule_valid(frequency,custom_mode,custom_month_days,custom_dates,start_date,end_date));
do $$
begin
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.finance_entries'::regclass and conname='finance_entries_vendor_owner_fkey') then
    alter table public.finance_entries add constraint finance_entries_vendor_owner_fkey foreign key(vendor_id,user_id) references public.finance_vendors(id,user_id);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.finance_series'::regclass and conname='finance_series_vendor_owner_fkey') then
    alter table public.finance_series add constraint finance_series_vendor_owner_fkey foreign key(vendor_id,user_id) references public.finance_vendors(id,user_id);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.finance_plans'::regclass and conname='finance_plans_vendor_owner_fkey') then
    alter table public.finance_plans add constraint finance_plans_vendor_owner_fkey foreign key(vendor_id,user_id) references public.finance_vendors(id,user_id);
  end if;
end;
$$;
create index if not exists finance_entries_vendor_idx on public.finance_entries(vendor_id,user_id) where vendor_id is not null;
create index if not exists finance_series_vendor_idx on public.finance_series(vendor_id,user_id) where vendor_id is not null;
create index if not exists finance_plans_vendor_idx on public.finance_plans(vendor_id,user_id) where vendor_id is not null;

-- Resolve or create an inline vendor in the same transaction as its bill or plan.
create or replace function public.finance_resolve_vendor(p_actor uuid,p_payload jsonb,p_current uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_name text; v_url text; v_input jsonb; v_vendor public.finance_vendors%rowtype;
begin
  perform public.finance_assert_actor(p_actor);
  if p_payload ? 'vendor_id' and p_payload ? 'new_vendor' then raise exception 'Choose an existing vendor or create a new vendor, not both.'; end if;
  if p_payload ? 'new_vendor' then
    v_input:=p_payload->'new_vendor';
    if jsonb_typeof(v_input) is distinct from 'object' or jsonb_typeof(v_input->'name') is distinct from 'string' or (v_input->>'name') ~ '[[:cntrl:]]' then raise exception 'Enter the new vendor name.'; end if;
    if v_input ? 'url' and jsonb_typeof(v_input->'url') not in ('string','null') then raise exception 'Enter a valid vendor website.'; end if;
    v_id:=(v_input->>'id')::uuid;
    if v_id is null then raise exception 'A new vendor identifier is required.'; end if;
    v_name:=btrim(regexp_replace(v_input->>'name','[[:space:]]+',' ','g'));
    if length(v_name) not between 1 and 200 then raise exception 'Enter a vendor name using 200 characters or fewer.'; end if;
    v_url:=public.finance_vendor_url(v_input->>'url');
    select * into v_vendor from public.finance_vendors where id=v_id and user_id=p_actor for update;
    if v_vendor.id is not null then
      if v_vendor.name is distinct from v_name or v_vendor.url is distinct from v_url then raise exception 'This vendor identifier is already in use. Choose the existing vendor or reopen the form.'; end if;
    else
      if exists(select 1 from public.finance_vendors where id=v_id) then raise exception using errcode='P0002',message='This vendor was not found.'; end if;
      if exists(select 1 from public.finance_vendors where user_id=p_actor and lower(name)=lower(v_name)) then raise exception 'A vendor with this name already exists. Choose it from your vendors, or restore it if archived.'; end if;
      insert into public.finance_vendors(id,user_id,name,url) values(v_id,p_actor,v_name,v_url) returning * into v_vendor;
    end if;
  else
    v_id:=case when p_payload ? 'vendor_id' then (p_payload->>'vendor_id')::uuid else p_current end;
    if v_id is null then return null; end if;
    select * into v_vendor from public.finance_vendors where id=v_id and user_id=p_actor;
    if v_vendor.id is null then raise exception using errcode='P0002',message='This vendor was not found.'; end if;
  end if;
  if v_vendor.archived_at is not null and v_id is distinct from p_current then raise exception 'Restore this archived vendor before assigning it to another bill or plan.'; end if;
  return v_id;
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
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,notes)
          select p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,x,x,s.id,s.vendor_id,s.notes
          from unnest(s.custom_dates) x where x>=s.start_date and x<=p_through and (s.end_date is null or x<=s.end_date)
          on conflict(series_id,original_due_date) do nothing;
      else
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,notes)
          select p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,x.day,x.day,s.id,s.vendor_id,s.notes
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
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,notes)
          values(p_actor,s.kind,s.title,s.category,s.expense_type,s.amount_cents,s.amount_cents,d,d,s.id,s.vendor_id,s.notes)
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
  v_note text; v_changed boolean; v_count integer;
  v_vendor uuid; v_vendor_record public.finance_vendors%rowtype; v_vendor_name text; v_vendor_url text;
  v_frequency text; v_custom_mode text; v_custom_days integer[]:='{}'; v_custom_dates date[]:='{}';
begin
  perform public.finance_assert_actor(p_actor);
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object' then raise exception 'Enter the details for this change.'; end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if p_action='save_entry' then
    if v_id is not null then select * into v_entry from public.finance_entries where id=v_id and user_id=p_actor for update; end if;
    v_vendor:=public.finance_resolve_vendor(p_actor,p_payload,v_entry.vendor_id);
    v_amount:=(p_payload->>'amount_cents')::bigint;
    if v_entry.id is not null then
      if v_entry.status='collections' then raise exception 'Manage this item on Credit & collections.'; end if;
      if (p_payload->>'kind') is distinct from v_entry.kind or (p_payload->>'original_due_date')::date is distinct from v_entry.original_due_date then raise exception 'The original type and due date are preserved. Use the payment date to move this occurrence.'; end if;
      if v_entry.plan_id is not null and (v_amount<>v_entry.amount_cents or p_payload->>'expense_type' is distinct from v_entry.expense_type) then raise exception 'Installment amounts and types are fixed by their payment plan. You can move the payment date.'; end if;
      select coalesce(sum(amount_cents),0) into v_paid from public.finance_payments where entry_id=v_id and user_id=p_actor and reversed_at is null;
      if v_amount<v_paid then raise exception 'The bill or income amount cannot be lower than its recorded payments.'; end if;
      update public.finance_entries set title=p_payload->>'title',category=p_payload->>'category',expense_type=p_payload->>'expense_type',amount_cents=v_amount,scheduled_date=(p_payload->>'scheduled_date')::date,vendor_id=v_vendor,notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v_id and user_id=p_actor;
      insert into public.finance_entry_history(user_id,entry_id,action,details) values(p_actor,v_id,'edited',pg_catalog.jsonb_build_object('previous_amount_cents',v_entry.amount_cents,'amount_cents',v_amount,'previous_scheduled_date',v_entry.scheduled_date,'scheduled_date',p_payload->>'scheduled_date','previous_vendor_id',v_entry.vendor_id,'vendor_id',v_vendor));
    else
      v_id:=coalesce(v_id,gen_random_uuid());
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
          select coalesce(array_agg(distinct x::date order by x::date),'{}'::date[]) into v_custom_dates from jsonb_array_elements_text(p_payload->'custom_dates') x;
        end if;
        if not public.finance_custom_schedule_valid(v_frequency,v_custom_mode,v_custom_days,v_custom_dates,(p_payload->>'original_due_date')::date,nullif(p_payload->>'end_date','')::date) then
          raise exception 'Choose a valid custom schedule matching the first due date, with at most 240 specific dates and no dates beyond the repeat end date.';
        end if;
      end if;
      if v_frequency<>'once' then
        insert into public.finance_series(user_id,kind,title,category,expense_type,amount_cents,start_date,end_date,frequency,custom_mode,custom_month_days,custom_dates,vendor_id,notes)
          values(p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,(p_payload->>'original_due_date')::date,nullif(p_payload->>'end_date','')::date,v_frequency,v_custom_mode,v_custom_days,v_custom_dates,v_vendor,coalesce(p_payload->>'notes','')) returning id into v_series;
      end if;
      insert into public.finance_entries(id,user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,series_id,vendor_id,notes)
        values(v_id,p_actor,p_payload->>'kind',p_payload->>'title',p_payload->>'category',p_payload->>'expense_type',v_amount,v_amount,(p_payload->>'original_due_date')::date,(p_payload->>'scheduled_date')::date,v_series,v_vendor,coalesce(p_payload->>'notes',''));
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
    v_vendor:=public.finance_resolve_vendor(p_actor,p_payload,v_plan.vendor_id);
    if v_plan.id is not null then
      if (p_payload->>'total_amount_cents')::bigint is distinct from v_plan.total_amount_cents or (p_payload->>'opening_paid_cents')::bigint is distinct from v_plan.opening_paid_cents or (p_payload->>'installment_amount_cents')::bigint is distinct from v_plan.installment_amount_cents or p_payload->>'frequency' is distinct from v_plan.frequency or (p_payload->>'first_due_date')::date is distinct from v_plan.first_due_date or p_payload->>'kind' is distinct from v_plan.kind then raise exception 'A saved plan keeps its original amounts and schedule. Move individual payment dates or create a new plan.'; end if;
      update public.finance_plans set title=p_payload->>'title',creditor=p_payload->>'creditor',category=p_payload->>'category',vendor_id=v_vendor,notes=coalesce(p_payload->>'notes','') where id=v_id and user_id=p_actor;
      -- Changing a plan's vendor updates all of its installment history. An
      -- omitted or unchanged vendor preserves individually edited associations.
      if v_vendor is distinct from v_plan.vendor_id then
        insert into public.finance_entry_history(user_id,entry_id,action,details)
          select p_actor,e.id,'vendor_changed',jsonb_build_object('plan_id',v_id,'previous_vendor_id',e.vendor_id,'vendor_id',v_vendor)
          from public.finance_entries e where e.plan_id=v_id and e.user_id=p_actor and e.vendor_id is distinct from v_vendor;
        update public.finance_entries set vendor_id=v_vendor,updated_at=now() where plan_id=v_id and user_id=p_actor and vendor_id is distinct from v_vendor;
      end if;
    else
      v_id:=coalesce(v_id,gen_random_uuid());
      insert into public.finance_plans(id,user_id,title,creditor,kind,category,total_amount_cents,opening_paid_cents,installment_amount_cents,frequency,first_due_date,vendor_id,notes)
        values(v_id,p_actor,p_payload->>'title',p_payload->>'creditor',p_payload->>'kind',p_payload->>'category',(p_payload->>'total_amount_cents')::bigint,(p_payload->>'opening_paid_cents')::bigint,(p_payload->>'installment_amount_cents')::bigint,p_payload->>'frequency',(p_payload->>'first_due_date')::date,v_vendor,coalesce(p_payload->>'notes','')) returning * into v_plan;
      v_remaining:=v_plan.total_amount_cents-v_plan.opening_paid_cents; v_n:=0;
      while v_remaining>0 loop
        v_amount:=least(v_remaining,v_plan.installment_amount_cents); v_date:=public.finance_occurrence_date(v_plan.first_due_date,v_plan.frequency,v_n);
        insert into public.finance_entries(user_id,kind,title,category,expense_type,amount_cents,original_amount_cents,original_due_date,scheduled_date,plan_id,vendor_id,notes)
          values(p_actor,'bill',left(v_plan.title,190)||' · '||(v_n+1)::text,v_plan.category,v_plan.kind,v_amount,v_amount,v_date,v_date,v_id,v_vendor,v_plan.notes);
        v_remaining:=v_remaining-v_amount; v_n:=v_n+1;
        if v_n>240 then raise exception 'A plan can include at most 240 installments.'; end if;
      end loop;
    end if;
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
    'vendors',coalesce((select jsonb_agg(to_jsonb(v) order by lower(v.name),v.id) from public.finance_vendors v where v.user_id=p_actor),'[]'::jsonb)
  );
end;
$$;

-- Every added function is private even if its name is known to a browser caller.
revoke all on function public.finance_vendor_url(text),public.finance_custom_schedule_valid(text,text,integer[],date[],date,date),public.finance_resolve_vendor(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.finance_vendor_url(text),public.finance_custom_schedule_valid(text,text,integer[],date[],date,date),public.finance_resolve_vendor(uuid,jsonb,uuid) to service_role;
revoke all on function public.finance_expand(uuid,date),public.finance_mutate(uuid,text,jsonb),public.finance_snapshot(uuid,date) from public,anon,authenticated;
grant execute on function public.finance_expand(uuid,date),public.finance_mutate(uuid,text,jsonb),public.finance_snapshot(uuid,date) to service_role;
