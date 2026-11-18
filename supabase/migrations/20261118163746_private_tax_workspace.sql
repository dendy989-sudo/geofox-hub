-- Private tax organizer. Never shares records with company staff or company AI.
-- All access is through authenticated, owner-scoped server routes.
create table if not exists public.tax_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('year','business','account','statement','transaction','rule','dependent','irs_entry','adjustment','chat')),
  tax_year integer check (tax_year between 2018 and 2100),
  title text not null check (length(title) between 1 and 200),
  data jsonb not null default '{}' check (jsonb_typeof(data)='object' and octet_length(data::text)<=3500000),
  version integer not null default 1 check(version>0), archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id),
  check ((kind in ('business','account','rule') and tax_year is null) or (kind not in ('business','account','rule') and tax_year is not null))
);
create index if not exists tax_records_owner_kind_year_idx on public.tax_records(user_id,kind,tax_year) where not archived;
create index if not exists tax_records_owner_updated_idx on public.tax_records(user_id,updated_at,id);
create unique index if not exists tax_records_one_year_idx on public.tax_records(user_id,tax_year) where kind='year' and not archived;
create index if not exists tax_records_fingerprint_idx on public.tax_records(user_id,(data->>'fingerprint')) where kind='transaction' and not archived;
create unique index if not exists tax_records_source_row_idx on public.tax_records(user_id,(data->>'statement_id'),(data->>'source_row')) where kind='transaction' and data->>'statement_id' is not null and data->>'source_row' is not null;

create table if not exists public.tax_audit (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,record_title text not null,action text not null,
  before_state jsonb,after_state jsonb,created_at timestamptz not null default now(),
  foreign key(record_id,user_id) references public.tax_records(id,user_id)
);
create index if not exists tax_audit_owner_date_idx on public.tax_audit(user_id,created_at desc,id);
alter table public.tax_records enable row level security;
alter table public.tax_audit enable row level security;
revoke all on public.tax_records,public.tax_audit from public,anon,authenticated;
revoke all on public.tax_records,public.tax_audit from service_role;
grant select,insert,update on public.tax_records to service_role;
grant select,insert on public.tax_audit to service_role;

create or replace function public.taxes_assert_actor(p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.finance_assert_actor(p_actor);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,814018));
end;
$$;

create or replace function public.taxes_save_record(p_actor uuid,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid:=coalesce((p_record->>'id')::uuid,gen_random_uuid());
  v_kind text:=p_record->>'kind';v_year integer:=(p_record->>'tax_year')::integer;
  v_title text:=btrim(p_record->>'title');v_data jsonb:=p_record->'data';
  v_old public.tax_records;v_saved public.tax_records;v_ref text;v_ref_kind text;v_before jsonb;
begin
  perform public.taxes_assert_actor(p_actor);
  if v_data is null or jsonb_typeof(v_data)<>'object' or length(v_title) not between 1 and 200 or octet_length(v_data::text)>3500000 then
    raise exception using errcode='22023',message='Invalid tax record.';
  end if;
  select * into v_old from public.tax_records where id=v_id and user_id=p_actor for update;
  if found then
    if v_old.archived or v_old.kind<>v_kind then raise exception using errcode='40001',message='The record changed. Refresh before saving.'; end if;
    if v_kind='year' and v_old.tax_year is distinct from v_year then raise exception using errcode='22023',message='An existing tax-year record cannot move to a different year.';end if;
    if p_record->>'version' is null then
      if v_old.title=v_title and v_old.tax_year is not distinct from v_year and v_old.data=v_data then return to_jsonb(v_old)-'user_id'; end if;
      raise exception using errcode='40001',message='This item already exists. Refresh before editing.';
    end if;
    if v_old.version<>(p_record->>'version')::integer then raise exception using errcode='40001',message='The record changed. Refresh before saving.'; end if;
  elsif p_record->>'version' is not null then raise exception using errcode='P0002',message='The tax record was not found.';
  end if;
  foreach v_ref in array array['business_id','account_id','statement_id','document_id','rule_id'] loop
    if v_data->>v_ref is not null then
      v_ref_kind:=case v_ref when 'business_id' then 'business' when 'account_id' then 'account' when 'rule_id' then 'rule' else 'statement' end;
      if not exists(select 1 from public.tax_records r where r.id=(v_data->>v_ref)::uuid and r.user_id=p_actor and r.kind=v_ref_kind and not r.archived
        and (v_ref not in ('statement_id','document_id') or r.tax_year=v_year)) then
        raise exception using errcode='23503',message='A linked tax record is unavailable.';
      end if;
    end if;
  end loop;
  if v_kind in ('transaction','adjustment') then
    if jsonb_typeof(v_data->'amount_cents') is distinct from 'number' or (v_data->>'amount_cents') !~ '^-?[0-9]+$' or abs((v_data->>'amount_cents')::numeric)>1000000000000
      or extract(year from (v_data->>'date')::date)<>v_year
      or (v_data->>'scope' in ('business','mixed') and v_data->>'business_id' is null)
      or (v_data->>'business_percent')::numeric not between 0 and 100
      or (v_data->>'deduction_percent' is not null and (v_data->>'deduction_percent')::numeric not between 0 and 100)
      then raise exception using errcode='22023',message='Invalid tax transaction amount, date or allocation.'; end if;
  end if;
  if v_old.id is null then
    insert into public.tax_records(id,user_id,kind,tax_year,title,data) values(v_id,p_actor,v_kind,v_year,v_title,v_data) returning * into v_saved;
  else
    update public.tax_records set title=v_title,tax_year=v_year,data=v_data,version=version+1,updated_at=now() where id=v_id and user_id=p_actor returning * into v_saved;
  end if;
  v_before:=case when v_old.id is null then null else (to_jsonb(v_old)-'user_id')||jsonb_build_object('data',v_old.data-'preview') end;
  insert into public.tax_audit(user_id,record_id,record_title,action,before_state,after_state)
  values(p_actor,v_id,v_title,case when v_old.id is null then 'created' else 'updated' end,v_before,(to_jsonb(v_saved)-'user_id')||jsonb_build_object('data',v_saved.data-'preview'));
  return to_jsonb(v_saved)-'user_id';
end;
$$;

create or replace function public.taxes_save_batch(p_actor uuid,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_record jsonb;v_result jsonb:='[]'::jsonb;
begin
  perform public.taxes_assert_actor(p_actor);
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000 then raise exception using errcode='22023',message='Batch size is not supported.';end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    v_result:=v_result||jsonb_build_array(public.taxes_save_record(p_actor,v_record));
  end loop;
  return v_result;
end;
$$;

create or replace function public.taxes_archive_record(p_actor uuid,p_id uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.tax_records;v_saved public.tax_records;
begin
  perform public.taxes_assert_actor(p_actor);
  select * into v_old from public.tax_records where id=p_id and user_id=p_actor for update;
  if not found then raise exception using errcode='P0002',message='Tax record not found.';end if;
  if v_old.version is distinct from p_version or v_old.archived then raise exception using errcode='40001',message='The record changed.';end if;
  if v_old.kind in ('business','account','statement') and exists(select 1 from public.tax_records r where r.user_id=p_actor and not r.archived
    and (r.data->>'business_id'=p_id::text or r.data->>'account_id'=p_id::text or r.data->>'statement_id'=p_id::text or r.data->>'document_id'=p_id::text)) then
    raise exception using errcode='23503',message='This record supports other saved tax records and must be kept.';
  end if;
  update public.tax_records set archived=true,version=version+1,updated_at=now() where id=p_id and user_id=p_actor returning * into v_saved;
  insert into public.tax_audit(user_id,record_id,record_title,action,before_state,after_state) values(p_actor,p_id,v_old.title,'archived',
    (to_jsonb(v_old)-'user_id')||jsonb_build_object('data',v_old.data-'preview'),(to_jsonb(v_saved)-'user_id')||jsonb_build_object('data',v_saved.data-'preview'));
  return to_jsonb(v_saved)-'user_id';
end;
$$;

create or replace function public.taxes_commit_import(p_actor uuid,p_statement_id uuid,p_version integer,p_rows jsonb,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_statement public.tax_records;v_record jsonb;v_result jsonb;v_saved jsonb;v_count integer:=0;
begin
  perform public.taxes_assert_actor(p_actor);
  select * into v_statement from public.tax_records where id=p_statement_id and user_id=p_actor and kind='statement' and not archived for update;
  if not found then raise exception using errcode='P0002',message='Statement not found.';end if;
  if v_statement.data->>'status'='imported' then
    if v_statement.data->>'import_hash'=p_hash then return jsonb_build_object('imported',(v_statement.data->>'imported_count')::integer,'statement_id',p_statement_id,'replayed',true);end if;
    raise exception using errcode='40001',message='This statement was already imported with a different selection.';
  end if;
  if v_statement.version is distinct from p_version or v_statement.data->>'status' is distinct from 'preview' then raise exception using errcode='40001',message='Review the latest statement preview before importing.';end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 0 and 2000 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid import.';end if;
  for v_record in select value from jsonb_array_elements(p_rows) loop
    if v_record->>'kind'<>'transaction' or v_record->'data'->>'statement_id'<>p_statement_id::text or (v_record->>'tax_year')::integer<>v_statement.tax_year
      then raise exception using errcode='22023',message='The import contains an unrelated transaction.';end if;
    if v_record->'data'->>'fingerprint' is not null and not coalesce((v_record->>'allow_duplicate')::boolean,false) and exists(
      select 1 from public.tax_records r where r.user_id=p_actor and r.kind='transaction' and not r.archived
        and r.data->>'fingerprint'=v_record->'data'->>'fingerprint' and r.data->>'statement_id' is distinct from p_statement_id::text
    ) then raise exception using errcode='40001',message='A matching transaction was imported after this preview. Review duplicates again.';end if;
    perform public.taxes_save_record(p_actor,v_record);v_count:=v_count+1;
  end loop;
  v_saved:=public.taxes_save_record(p_actor,jsonb_build_object('id',v_statement.id,'kind','statement','tax_year',v_statement.tax_year,'title',v_statement.title,'version',v_statement.version,
    'data',v_statement.data||jsonb_build_object('status','imported','imported_count',v_count,'import_hash',p_hash,'imported_at',now())));
  return jsonb_build_object('imported',v_count,'statement_id',p_statement_id,'replayed',false);
end;
$$;

revoke all on function public.taxes_assert_actor(uuid),public.taxes_save_record(uuid,jsonb),public.taxes_save_batch(uuid,jsonb),public.taxes_archive_record(uuid,uuid,integer),public.taxes_commit_import(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.taxes_assert_actor(uuid),public.taxes_save_record(uuid,jsonb),public.taxes_save_batch(uuid,jsonb),public.taxes_archive_record(uuid,uuid,integer),public.taxes_commit_import(uuid,uuid,integer,jsonb,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tax-documents','tax-documents',false,20971520,array['text/csv','application/csv','application/vnd.ms-excel','application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policy prevents an unrelated permissive storage policy from exposing originals.
drop policy if exists tax_documents_block_browser on storage.objects;
create policy tax_documents_block_browser on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'tax-documents') with check(bucket_id<>'tax-documents');
comment on table public.tax_records is 'Private tax organizer; server verified owner access only. No company workspace or Alfred access.';
comment on table public.tax_audit is 'Private append-only tax record history. Ordinary staff and browser roles have no access.';

create or replace function public.taxes_snapshot(p_actor uuid,p_year integer,p_full_audit boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_records jsonb;v_audit jsonb;v_total bigint;
begin
  perform public.taxes_assert_actor(p_actor);
  if p_year is null or p_year not between 2018 and 2100 then raise exception using errcode='22023',message='Choose a supported tax year.';end if;
  select coalesce(jsonb_agg((to_jsonb(r)-'user_id')||jsonb_build_object('data',case when r.kind='statement' and not p_full_audit then r.data-'preview' else r.data end) order by r.created_at,r.id),'[]'::jsonb)
    into v_records from public.tax_records r where r.user_id=p_actor and not r.archived and (r.kind not in ('transaction','adjustment','chat') or r.tax_year=p_year);
  select count(*) into v_total from public.tax_audit a join public.tax_records r on r.id=a.record_id and r.user_id=a.user_id where a.user_id=p_actor and (r.tax_year is null or r.tax_year=p_year);
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) into v_audit from
    (select a.created_at,case when p_full_audit then to_jsonb(a)-'user_id' else jsonb_build_object('id',a.id,'record_id',a.record_id,'record_title',a.record_title,'action',a.action,'created_at',a.created_at) end as item
      from public.tax_audit a join public.tax_records r on r.id=a.record_id and r.user_id=a.user_id
      where a.user_id=p_actor and (r.tax_year is null or r.tax_year=p_year) order by a.created_at desc,a.id limit case when p_full_audit then null else 100 end) x;
  return jsonb_build_object('records',v_records,'audit',v_audit,'audit_total',v_total,'year',p_year);
end;
$$;
revoke all on function public.taxes_snapshot(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.taxes_snapshot(uuid,integer,boolean) to service_role;
