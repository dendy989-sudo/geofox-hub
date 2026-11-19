-- Let one original statement contribute dated rows to multiple tax years.
-- The source year remains the original's nominal period, never the row's filing year.
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
        ) then
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
    if v_record->>'kind'<>'transaction' or v_record->'data'->>'statement_id'<>p_statement_id::text or (v_record->>'tax_year')::integer is distinct from extract(year from (v_record->'data'->>'date')::date)::integer
      then raise exception using errcode='22023',message='The import contains an unrelated transaction.';end if;
    if v_record->'data'->>'fingerprint' is not null and not coalesce((v_record->>'allow_duplicate')::boolean,false) and exists(
      select 1 from public.tax_records r where r.user_id=p_actor and r.kind='transaction' and not r.archived
        and r.data->>'fingerprint'=v_record->'data'->>'fingerprint' and r.data->>'statement_id' is distinct from p_statement_id::text
    ) then raise exception using errcode='40001',message='A matching transaction was imported after this preview. Review duplicates again.';end if;
    perform public.taxes_save_record(p_actor,v_record);v_count:=v_count+1;
  end loop;
  v_saved:=public.taxes_save_record(p_actor,jsonb_build_object('id',v_statement.id,'kind','statement','tax_year',v_statement.tax_year,'title',v_statement.title,'version',v_statement.version,
    'data',v_statement.data||jsonb_build_object('status','imported','imported_count',v_count,'import_hash',p_hash,'imported_at',now(),'imported_years',(select coalesce(jsonb_agg(distinct (entry->>'tax_year')::integer),'[]'::jsonb) from jsonb_array_elements(p_rows) entry))));
  return jsonb_build_object('imported',v_count,'statement_id',p_statement_id,'replayed',false);
end;
$$;


create or replace function public.taxes_find_duplicate_fingerprints(p_actor uuid,p_account uuid,p_except_statement uuid,p_hashes text[])
returns text[] language plpgsql security invoker set search_path='' as $$
declare v_matches text[];
begin
  perform public.taxes_assert_actor(p_actor);
  if p_hashes is null or cardinality(p_hashes)>2000 then
    raise exception using errcode='22023',message='Invalid fingerprint batch.';
  end if;
  select coalesce(array_agg(distinct r.data->>'fingerprint'),'{}'::text[]) into v_matches
  from public.tax_records r
  where r.user_id=p_actor and r.kind='transaction' and not r.archived
    and r.data->>'account_id'=p_account::text
    and r.data->>'statement_id' is distinct from p_except_statement::text
    and r.data->>'fingerprint'=any(p_hashes);
  return v_matches;
end;
$$;

-- Archive the document and all its imported transactions in a single database
-- transaction. Keep the non-editable audit entries even after removing the file.
create or replace function public.taxes_remove_document(p_actor uuid,p_statement_id uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_source public.tax_records; v_child record; v_count integer:=0;
begin
  perform public.taxes_assert_actor(p_actor);
  select * into v_source from public.tax_records
    where id=p_statement_id and user_id=p_actor and kind='statement' and not archived for update;
  if not found then raise exception using errcode='P0002',message='Document was not found.';end if;
  if v_source.version is distinct from p_version then
    raise exception using errcode='40001',message='Document changed. Refresh before deleting.';end if;
  if exists(
     select 1 from public.tax_records r where r.user_id=p_actor and not r.archived
       and r.id<>v_source.id and r.kind<>'transaction'
       and (r.data->>'document_id'=v_source.id::text or r.data->>'statement_id'=v_source.id::text)
  ) then raise exception using errcode='23503',message='The original supports another linked record. Review the link before deleting.';end if;
  for v_child in
    select id,version from public.tax_records r
    where r.user_id=p_actor and not r.archived and r.kind='transaction'
      and r.data->>'statement_id'=v_source.id::text order by id
  loop
    perform public.taxes_archive_record(p_actor,v_child.id,v_child.version);
    v_count:=v_count+1;
  end loop;
  perform public.taxes_archive_record(p_actor,v_source.id,v_source.version);
  return jsonb_build_object('removed_transactions',v_count,'storage_path',v_source.data->>'storage_path');
end;
$$;

revoke all on function public.taxes_find_duplicate_fingerprints(uuid,uuid,uuid,text[]),
  public.taxes_remove_document(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.taxes_find_duplicate_fingerprints(uuid,uuid,uuid,text[]),
  public.taxes_remove_document(uuid,uuid,integer) to service_role;
