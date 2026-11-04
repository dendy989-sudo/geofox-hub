begin;
set local lock_timeout = '10s';

-- Company operations share the existing verified staff identity and app assignments.
-- These private tables have no browser grants. Service-only RPCs recheck the actor.
create table if not exists public.hub_staff_modules (
  user_id uuid not null references public.hub_staff(user_id) on delete cascade,
  module text not null check (module in ('tasks','marketing','legal','accounting')),
  access_level text not null check (access_level in ('none','read','write')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id,module)
);
create table if not exists public.hub_workspace_records (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('tasks','marketing','legal','accounting')),
  app_slug text references public.hub_apps(slug),
  title text not null check (char_length(trim(title)) between 1 and 200),
  status text not null check (char_length(status) between 1 and 32),
  data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text)<=100000),
  version integer not null default 1 check (version>0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  request_id uuid,
  parent_record_id uuid references public.hub_workspace_records(id),
  unique (created_by,request_id),
  unique (parent_record_id)
);
create index if not exists hub_workspace_module_app_recent_idx on public.hub_workspace_records(module,app_slug,updated_at desc,id) where deleted_at is null;
create index if not exists hub_workspace_module_status_idx on public.hub_workspace_records(module,status) where deleted_at is null;
create table if not exists public.hub_workspace_uploads (
  path text primary key check (char_length(path) between 1 and 256),
  module text not null check (module in ('tasks','marketing','legal','accounting')),
  app_slug text references public.hub_apps(slug),
  filename text not null check (char_length(filename) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf')),
  size bigint not null check (size between 1 and 52428800),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists hub_workspace_upload_scope_idx on public.hub_workspace_uploads(module,app_slug);

do $$
declare t text;
begin
  foreach t in array array['hub_staff_modules','hub_workspace_records','hub_workspace_uploads'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;

create or replace function public.hub_workspace_role(p_actor uuid)
returns text language sql stable security definer set search_path=''
as $$
  select s.role from public.hub_staff s join auth.users u on u.id=s.user_id
  where s.user_id=p_actor and s.active and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
$$;
create or replace function public.hub_workspace_level(p_actor uuid,p_module text)
returns text language plpgsql stable security definer set search_path=''
as $$
declare staff_role text; explicit_level text;
begin
  staff_role:=public.hub_workspace_role(p_actor);
  if staff_role is null or p_module is null or p_module not in ('tasks','marketing','legal','accounting') then return 'none'; end if;
  if staff_role='owner' then return 'write'; end if;
  select access_level into explicit_level from public.hub_staff_modules where user_id=p_actor and module=p_module;
  if found then return explicit_level; end if;
  if p_module='tasks' then return case when staff_role='analyst' then 'read' else 'write' end; end if;
  return 'none';
end $$;
create or replace function public.hub_workspace_actor_can(p_actor uuid,p_module text,p_action text,p_app text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare access_level text; staff_role text;
begin
  if p_action is null or p_action not in ('read','write') then return false; end if;
  access_level:=public.hub_workspace_level(p_actor,p_module);
  if access_level='none' or (p_action='write' and access_level<>'write') then return false; end if;
  staff_role:=public.hub_workspace_role(p_actor);
  if p_app is null then
    return staff_role='owner' or exists(select 1 from public.hub_staff_modules m where m.user_id=p_actor and m.module=p_module and m.access_level in ('read','write'));
  end if;
  return exists(select 1 from public.hub_apps a where a.slug=p_app and a.active)
    and (staff_role='owner' or exists(select 1 from public.hub_staff_apps g where g.user_id=p_actor and g.app_slug=p_app));
end $$;

create or replace function public.hub_workspace_validate(p_module text,p_status text,p_data jsonb,p_app text)
returns void language plpgsql stable security definer set search_path=''
as $$
declare attachment jsonb; items jsonb; actual_date date; cents numeric; k text;
begin
  if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>100000 or p_status is null then raise exception 'Invalid record' using errcode='22023'; end if;
  foreach k in array array['dueDate','reviewDate','occurredOn','sourceCheckedAt'] loop
    if p_data->>k is not null then
      if p_data->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid calendar date' using errcode='22023'; end if;
      actual_date:=(p_data->>k)::date;
      if actual_date not between date '1900-01-01' and date '2200-12-31' then raise exception 'Calendar date is out of range' using errcode='22023'; end if;
    end if;
  end loop;
  if p_module='tasks' then
    if p_status not in ('todo','in_progress','done','archived') or coalesce(p_data->>'priority','') not in ('low','normal','high','urgent')
      or coalesce(p_data->>'recurrence','') not in ('none','daily','weekly','monthly') or jsonb_typeof(p_data->'checklist') is distinct from 'array'
      or jsonb_array_length(p_data->'checklist')>100 then raise exception 'Invalid task' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_data->'checklist') step where jsonb_typeof(step) is distinct from 'object'
      or jsonb_typeof(step->'id') is distinct from 'string' or char_length(trim(step->>'id')) not between 1 and 80
      or jsonb_typeof(step->'text') is distinct from 'string' or char_length(trim(step->>'text')) not between 1 and 500
      or jsonb_typeof(step->'done') is distinct from 'boolean')
      or (select count(distinct step->>'id') from jsonb_array_elements(p_data->'checklist') step)<>jsonb_array_length(p_data->'checklist')
      then raise exception 'Invalid checklist' using errcode='22023'; end if;
    if char_length(coalesce(p_data->>'description',''))>10000 then raise exception 'Task description too long' using errcode='22023'; end if;
    if p_data->>'recurrence'<>'none' and p_data->>'dueDate' is null then raise exception 'Recurring tasks need a due date' using errcode='22023'; end if;
  elsif p_module='accounting' then
    if p_status not in ('paid','pending','void') or coalesce(p_data->>'type','') not in ('income','expense','owner_contribution','owner_draw','transfer')
      or p_data->>'currency' is distinct from 'USD' or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or p_data->>'occurredOn' is null then raise exception 'Invalid transaction' using errcode='22023'; end if;
    cents:=(p_data->>'amountCents')::numeric;
    if cents<>trunc(cents) or cents not between 1 and 99999999999 then raise exception 'Invalid amount' using errcode='22023'; end if;
    actual_date:=(p_data->>'occurredOn')::date;
  elsif p_module='legal' then
    if p_status not in ('open','in_progress','completed','not_applicable','archived') or p_data->>'currency' is distinct from 'USD'
      or coalesce(p_data->>'recurrence','') not in ('none','monthly','quarterly','annual','continuous') then raise exception 'Invalid compliance item' using errcode='22023'; end if;
    if p_data->>'dueDate' is not null then actual_date:=(p_data->>'dueDate')::date; end if;
    if p_data->>'reviewDate' is not null then actual_date:=(p_data->>'reviewDate')::date; end if;
    if p_data->>'amountCents' is not null then
      cents:=(p_data->>'amountCents')::numeric;
      if jsonb_typeof(p_data->'amountCents')<>'number' or cents<>trunc(cents) or cents not between 0 and 99999999999 then raise exception 'Invalid amount' using errcode='22023'; end if;
    end if;
  elsif p_module='marketing' then
    if not coalesce(((p_data->>'kind'='post' and p_status in ('draft','scheduled','published','cancelled'))
      or (p_data->>'kind'='account' and p_status in ('active','archived'))
      or (p_data->>'kind'='inbox' and p_status in ('open','replied','archived','resolved'))),false) then raise exception 'Invalid marketing record' using errcode='22023'; end if;
    if p_data->>'kind'='post' and (jsonb_typeof(p_data->'platforms') is distinct from 'array' or jsonb_array_length(p_data->'platforms') not between 1 and 4
      or exists(select 1 from jsonb_array_elements_text(p_data->'platforms') p where p not in ('instagram','facebook','tiktok','x'))) then raise exception 'Invalid social platforms' using errcode='22023'; end if;
    if p_status='scheduled' and p_data->>'scheduledAt' is null then raise exception 'Choose a schedule time' using errcode='22023'; end if;
  else raise exception 'Invalid module' using errcode='22023';
  end if;
  -- A file reference cannot be reused to expose a different app or business area.
  items:='[]'::jsonb;
  foreach k in array array['attachments','media'] loop
    if p_data ? k then
      if jsonb_typeof(p_data->k)<>'array' or jsonb_array_length(p_data->k)>20 then raise exception 'Invalid attachments' using errcode='22023'; end if;
      items:=items||(p_data->k);
    end if;
  end loop;
  if p_data->'thumbnail' is not null and p_data->'thumbnail'<>'null'::jsonb then items:=items||jsonb_build_array(p_data->'thumbnail'); end if;
  for attachment in select * from jsonb_array_elements(items) loop
    if not exists(select 1 from public.hub_workspace_uploads u where u.path=attachment->>'path' and u.module=p_module
      and u.app_slug is not distinct from p_app and u.verified_at is not null
      and u.filename=attachment->>'filename' and u.content_type=attachment->>'contentType'
      and to_jsonb(u.size)=attachment->'size') then raise exception 'Attachment does not belong to this scope or upload is incomplete' using errcode='22023'; end if;
  end loop;
end $$;

create or replace function public.hub_workspace_list(p_actor uuid,p_module text,p_scope text default 'all',p_limit integer default 200,p_offset integer default 0,p_status text default null,p_query text default null,p_priority text default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if public.hub_workspace_level(p_actor,p_module)='none' then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_scope is null or p_limit is null or p_offset is null or p_limit not between 1 and 1000 or p_offset not between 0 and 100000 or char_length(coalesce(p_query,''))>200 then raise exception 'Invalid list filter' using errcode='22023'; end if;
  if p_scope<>'all' and not public.hub_workspace_actor_can(p_actor,p_module,'read',case when p_scope='company' then null else p_scope end) then raise exception 'Not permitted' using errcode='42501'; end if;
  with permitted as (
    select r.* from public.hub_workspace_records r where r.module=p_module and r.deleted_at is null
      and public.hub_workspace_actor_can(p_actor,r.module,'read',r.app_slug)
      and (p_scope='all' or (p_scope='company' and r.app_slug is null) or r.app_slug=p_scope)
      and (p_status is null or r.status=p_status)
      and (p_priority is null or r.data->>'priority'=p_priority)
      and (p_query is null or position(lower(p_query) in lower(r.title))>0)
  ), page as (select * from permitted order by updated_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id) from page),'[]'::jsonb),'total',(select count(*) from permitted)) into result;
  return result;
end $$;

create or replace function public.hub_workspace_get(p_actor uuid,p_id uuid,p_action text default 'read')
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare item public.hub_workspace_records;
begin
  select * into item from public.hub_workspace_records where id=p_id and deleted_at is null;
  if not found then raise exception 'Record not found' using errcode='P0002'; end if;
  if not public.hub_workspace_actor_can(p_actor,item.module,p_action,item.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  return to_jsonb(item);
end $$;

create or replace function public.hub_workspace_save(p_actor uuid,p_id uuid,p_version integer,p_module text,p_app text,p_title text,p_status text,p_data jsonb,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare existing public.hub_workspace_records; saved public.hub_workspace_records;
begin
  if not public.hub_workspace_actor_can(p_actor,p_module,'write',p_app) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'Invalid title' using errcode='22023'; end if;
  perform public.hub_workspace_validate(p_module,p_status,p_data,p_app);
  if p_module='tasks' and p_data->>'assigneeId' is not null and not public.hub_workspace_actor_can((p_data->>'assigneeId')::uuid,'tasks','read',p_app) then raise exception 'Assignee cannot access this task' using errcode='22023'; end if;
  if p_id is null then
    if p_request is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
      select * into existing from public.hub_workspace_records where created_by=p_actor and request_id=p_request;
      if found then
        if existing.module<>p_module or existing.app_slug is distinct from p_app or existing.deleted_at is not null or existing.title is distinct from trim(p_title) or existing.status is distinct from p_status or existing.data is distinct from p_data then raise exception 'Request ID already used' using errcode='23505'; end if;
        return to_jsonb(existing);
      end if;
    end if;
    if p_module='tasks' and p_status='done' and p_data->>'recurrence'<>'none' then raise exception 'Complete recurring tasks with the completion action' using errcode='22023'; end if;
    insert into public.hub_workspace_records(module,app_slug,title,status,data,created_by,updated_by,request_id)
      values(p_module,p_app,trim(p_title),p_status,p_data,p_actor,p_actor,p_request) returning * into saved;
  else
    select * into existing from public.hub_workspace_records where id=p_id and deleted_at is null for update;
    if not found then raise exception 'Record not found' using errcode='P0002'; end if;
    if existing.module<>p_module or not public.hub_workspace_actor_can(p_actor,existing.module,'write',existing.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_version is null or existing.version<>p_version then raise exception 'Record changed. Refresh before saving.' using errcode='40001'; end if;
    if p_module='tasks' and p_status='done' and existing.status<>'done' and p_data->>'recurrence'<>'none' then raise exception 'Complete recurring tasks with the completion action' using errcode='22023'; end if;
    update public.hub_workspace_records set app_slug=p_app,title=trim(p_title),status=p_status,data=p_data,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
  end if;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
    values(p_actor,p_app,case when p_id is null then 'workspace.created' else 'workspace.updated' end,p_module,saved.id::text,'Workspace record saved',jsonb_build_object('version',saved.version));
  return to_jsonb(saved);
end $$;

create or replace function public.hub_workspace_delete(p_actor uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path=''
as $$
declare item public.hub_workspace_records;
begin
  select * into item from public.hub_workspace_records where id=p_id and deleted_at is null for update;
  if not found then raise exception 'Record not found' using errcode='P0002'; end if;
  if not public.hub_workspace_actor_can(p_actor,item.module,'write',item.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_version is null or item.version<>p_version then raise exception 'Record changed. Refresh before deleting.' using errcode='40001'; end if;
  update public.hub_workspace_records set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=p_actor,version=version+1 where id=p_id;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,item.app_slug,'workspace.deleted',item.module,p_id::text,'Workspace record deleted');
end $$;

create or replace function public.hub_workspace_complete_task(p_actor uuid,p_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item public.hub_workspace_records; next_item public.hub_workspace_records; next_data jsonb; next_due date; checklist jsonb;
begin
  select * into item from public.hub_workspace_records where id=p_id and deleted_at is null for update;
  if not found then raise exception 'Record not found' using errcode='P0002'; end if;
  if item.module<>'tasks' or not public.hub_workspace_actor_can(p_actor,'tasks','write',item.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  if item.status='done' then
    select * into next_item from public.hub_workspace_records where parent_record_id=p_id and deleted_at is null and public.hub_workspace_actor_can(p_actor,'tasks','read',app_slug);
    return jsonb_build_object('item',to_jsonb(item),'next',case when next_item.id is null then null else to_jsonb(next_item) end);
  end if;
  if p_version is null or item.version<>p_version then raise exception 'Record changed. Refresh before completing.' using errcode='40001'; end if;
  update public.hub_workspace_records set status='done',version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into item;
  if item.data->>'recurrence'<>'none' then
    next_due:=((item.data->>'dueDate')::date+case item.data->>'recurrence' when 'daily' then interval '1 day' when 'weekly' then interval '1 week' else interval '1 month' end)::date;
    select coalesce(jsonb_agg(e||'{"done":false}'::jsonb),'[]'::jsonb) into checklist from jsonb_array_elements(item.data->'checklist') e;
    next_data:=item.data||jsonb_build_object('dueDate',to_char(next_due,'YYYY-MM-DD'),'checklist',checklist);
    perform public.hub_workspace_validate('tasks','todo',next_data,item.app_slug);
    insert into public.hub_workspace_records(module,app_slug,title,status,data,created_by,updated_by,parent_record_id)
      values('tasks',item.app_slug,item.title,'todo',next_data,p_actor,p_actor,p_id) on conflict(parent_record_id) do nothing returning * into next_item;
    if next_item.id is null then select * into next_item from public.hub_workspace_records where parent_record_id=p_id and deleted_at is null and public.hub_workspace_actor_can(p_actor,'tasks','read',app_slug); end if;
  end if;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata) values(p_actor,item.app_slug,'workspace.completed','tasks',p_id::text,'Task completed',jsonb_build_object('nextTaskId',next_item.id));
  return jsonb_build_object('item',to_jsonb(item),'next',case when next_item.id is null then null else to_jsonb(next_item) end);
end $$;

create or replace function public.hub_workspace_set_access(p_actor uuid,p_user uuid,p_grants jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare entry record;
begin
  perform pg_advisory_xact_lock(710432821);
  if public.hub_workspace_role(p_actor) is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  if not exists(select 1 from public.hub_staff where user_id=p_user) then raise exception 'Staff member not found' using errcode='P0002'; end if;
  if exists(select 1 from public.hub_staff where user_id=p_user and role='owner') then raise exception 'Owner access cannot be changed' using errcode='42501'; end if;
  if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'Invalid grants' using errcode='22023'; end if;
  for entry in select key,value from jsonb_each(p_grants) loop
    if entry.key not in ('tasks','marketing','legal','accounting') or entry.value not in ('"none"'::jsonb,'"read"'::jsonb,'"write"'::jsonb,'null'::jsonb) then raise exception 'Invalid grant' using errcode='22023'; end if;
  end loop;
  delete from public.hub_staff_modules where user_id=p_user;
  insert into public.hub_staff_modules(user_id,module,access_level,updated_by)
    select p_user,key,value#>>'{}',p_actor from jsonb_each(p_grants) where value<>'null'::jsonb;
  insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary,metadata) values(p_actor,'workspace.access_updated','staff',p_user::text,'Workspace module access updated',p_grants);
end $$;
create or replace function public.hub_workspace_list_access(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if public.hub_workspace_role(p_actor) is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('userId',s.user_id,'displayName',s.display_name,'role',s.role,'active',s.active,
    'appSlugs',coalesce((select jsonb_agg(a.app_slug order by a.app_slug) from public.hub_staff_apps a where a.user_id=s.user_id),'[]'::jsonb),
    'grants',coalesce((select jsonb_object_agg(m.module,m.access_level) from public.hub_staff_modules m where m.user_id=s.user_id),'{}'::jsonb)) order by s.display_name,s.user_id),'[]'::jsonb) from public.hub_staff s);
end $$;
create or replace function public.hub_workspace_update_profile(p_actor uuid,p_name text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if public.hub_workspace_role(p_actor) is null then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid display name' using errcode='22023'; end if;
  update public.hub_staff set display_name=trim(p_name),updated_at=now() where user_id=p_actor;
  insert into public.hub_audit_log(actor_id,action,entity_type,entity_id,summary) values(p_actor,'workspace.profile_updated','staff',p_actor::text,'Account display name updated');
end $$;

create or replace function public.hub_workspace_register_upload(p_actor uuid,p_module text,p_app text,p_path text,p_filename text,p_content_type text,p_size bigint)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not public.hub_workspace_actor_can(p_actor,p_module,'write',p_app) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_path is null or p_path not like p_module||'/'||coalesce(p_app,'company')||'/%' or p_path like '%..%' or p_path !~ '^[a-z0-9/-]+[.][a-z0-9]+$' then raise exception 'Invalid upload path' using errcode='22023'; end if;
  insert into public.hub_workspace_uploads(path,module,app_slug,filename,content_type,size,created_by) values(p_path,p_module,p_app,p_filename,p_content_type,p_size,p_actor);
end $$;
create or replace function public.hub_workspace_upload_info(p_actor uuid,p_path text,p_action text default 'read')
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare item public.hub_workspace_uploads;
begin
  select * into item from public.hub_workspace_uploads where path=p_path;
  if not found then raise exception 'Attachment not found' using errcode='P0002'; end if;
  if not public.hub_workspace_actor_can(p_actor,item.module,p_action,item.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  return to_jsonb(item);
end $$;
create or replace function public.hub_workspace_verify_upload(p_actor uuid,p_path text,p_size bigint,p_content_type text)
returns void language plpgsql security definer set search_path=''
as $$
declare item public.hub_workspace_uploads;
begin
  select * into item from public.hub_workspace_uploads where path=p_path for update;
  if not found or not public.hub_workspace_actor_can(p_actor,item.module,'write',item.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  if item.size is distinct from p_size or item.content_type is distinct from p_content_type then raise exception 'Uploaded file does not match its metadata' using errcode='22023'; end if;
  update public.hub_workspace_uploads set verified_at=now() where path=p_path;
end $$;

-- Make every new RPC private, including the helper functions. Caller IDs only come
-- from a verified server session, never a browser-selected actor argument.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hub_workspace_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Storage is present in Supabase but optional in local SQL test runners.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hub-workspace','hub-workspace',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf'])
      on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists hub_workspace_no_browser_access on storage.objects';
    execute 'create policy hub_workspace_no_browser_access on storage.objects as restrictive for all to anon, authenticated using (bucket_id <> ''hub-workspace'') with check (bucket_id <> ''hub-workspace'')';
  end if;
end $$;

commit;
