begin;

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
      or (p_data->>'kind'='content' and p_status in ('draft','in_progress','in_review','approved','published','archived'))
      or (p_data->>'kind'='account' and p_status in ('active','archived'))
      or (p_data->>'kind'='inbox' and p_status in ('open','replied','archived','resolved'))),false) then raise exception 'Invalid marketing record' using errcode='22023'; end if;
    if p_data->>'kind' in ('post','content') and (jsonb_typeof(p_data->'platforms') is distinct from 'array' or jsonb_array_length(p_data->'platforms') not between 1 and 4
      or exists(select 1 from jsonb_array_elements_text(p_data->'platforms') p where p not in ('instagram','facebook','tiktok','x'))) then raise exception 'Invalid social platforms' using errcode='22023'; end if;
    if p_data->>'kind'='content' then
      if jsonb_typeof(p_data->'isTemplate') is distinct from 'boolean' or coalesce(p_data->>'contentType','') not in ('photo','video','carousel','text')
        or char_length(coalesce(p_data->>'brief',''))>10000 or char_length(coalesce(p_data->>'script',''))>20000
        or char_length(coalesce(p_data->>'caption',''))>10000 or char_length(coalesce(p_data->>'hashtags',''))>2500
        or char_length(coalesce(p_data->>'notes',''))>10000 or char_length(coalesce(p_data->>'campaign',''))>200
        then raise exception 'Invalid marketing content' using errcode='22023'; end if;
      if (p_data->>'isTemplate')::boolean and p_status in ('approved','published') then raise exception 'Create content from this template first' using errcode='22023'; end if;
      if p_status in ('in_review','approved') and trim(coalesce(p_data->>'script',''))='' and trim(coalesce(p_data->>'caption',''))=''
        and coalesce(jsonb_array_length(p_data->'media'),0)=0 then raise exception 'Add creative content before review' using errcode='22023'; end if;
      if (select count(distinct p) from jsonb_array_elements_text(p_data->'platforms') p)<>jsonb_array_length(p_data->'platforms') then raise exception 'Duplicate social platforms' using errcode='22023'; end if;
    end if;
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

-- Canonical creative fields allow internal notes to evolve without silently changing a review.
create or replace function public.hub_marketing_content_creative(p_title text,p_data jsonb)
returns jsonb language sql immutable set search_path=''
as $$ select jsonb_build_object('title',trim(p_title),'data',p_data-array['notes','approval','linkedPostId']); $$;

create or replace function public.hub_marketing_post_creative(p_title text,p_data jsonb)
returns jsonb language sql immutable set search_path=''
as $$ select jsonb_build_object('title',trim(p_title),'contentType',p_data->'contentType','platforms',p_data->'platforms',
 'caption',coalesce(p_data->>'caption',''),'hashtags',coalesce(p_data->>'hashtags',''),'media',coalesce(p_data->'media','[]'::jsonb),
 'thumbnail',p_data->'thumbnail','campaign',coalesce(p_data->>'campaign','')); $$;

-- Keep all workspace mutations version checked and scope checked. Content approvals are
-- stamped here, so the privileged API cannot accidentally accept client-authored approval.
create or replace function public.hub_workspace_save(p_actor uuid,p_id uuid,p_version integer,p_module text,p_app text,p_title text,p_status text,p_data jsonb,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare existing public.hub_workspace_records; saved public.hub_workspace_records; source public.hub_workspace_records;
  linked public.hub_workspace_records; creative_changed boolean; owner_review boolean;
begin
  if not public.hub_workspace_actor_can(p_actor,p_module,'write',p_app) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'Invalid title' using errcode='22023'; end if;
  perform public.hub_workspace_validate(p_module,p_status,p_data,p_app);
  if p_module='tasks' and p_data->>'assigneeId' is not null and not public.hub_workspace_actor_can((p_data->>'assigneeId')::uuid,'tasks','read',p_app) then raise exception 'Assignee cannot access this task' using errcode='22023'; end if;
  -- Always lock a linked source before its post, including the direct-publishing claim.
  -- A simultaneous creative edit cannot invalidate a review between claim and delivery.
  if p_module='marketing' and p_data->>'kind'='post' and p_data->>'sourceContentId' is not null then
    select * into source from public.hub_workspace_records where id=(p_data->>'sourceContentId')::uuid and deleted_at is null for update;
  end if;
  if p_id is null then
    if p_request is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
      select * into existing from public.hub_workspace_records where created_by=p_actor and request_id=p_request;
      if found then
        if existing.module<>p_module or existing.app_slug is distinct from p_app or existing.deleted_at is not null or existing.title is distinct from trim(p_title) or existing.status is distinct from p_status or existing.data is distinct from p_data then raise exception 'Request ID already used' using errcode='23505'; end if;
        return to_jsonb(existing);
      end if;
    end if;
  else
    select * into existing from public.hub_workspace_records where id=p_id and deleted_at is null for update;
    if not found then raise exception 'Record not found' using errcode='P0002'; end if;
    if existing.module<>p_module or not public.hub_workspace_actor_can(p_actor,existing.module,'write',existing.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
    if p_version is null or existing.version<>p_version then raise exception 'Record changed. Refresh before saving.' using errcode='40001'; end if;
    if p_module='marketing' and existing.data->>'kind' is distinct from p_data->>'kind' then raise exception 'Marketing kind cannot change' using errcode='22023'; end if;
  end if;
  if p_module='marketing' and p_data->>'kind'='content' then
    if coalesce(p_data->'approval','null'::jsonb) is distinct from coalesce(existing.data->'approval','null'::jsonb)
      or coalesce(p_data->>'linkedPostId','') is distinct from coalesce(existing.data->>'linkedPostId','')
      then raise exception 'Approval and planner link are server managed' using errcode='22023'; end if;
    if p_data->>'sourceTemplateId' is not null and (p_data->>'sourceTemplateId' is distinct from existing.data->>'sourceTemplateId' or p_app is distinct from existing.app_slug) and not exists(select 1 from public.hub_workspace_records t
      where t.id=(p_data->>'sourceTemplateId')::uuid and t.module='marketing' and t.data->>'kind'='content' and t.data->>'isTemplate'='true'
      and t.deleted_at is null and t.app_slug is not distinct from p_app and public.hub_workspace_actor_can(p_actor,'marketing','read',t.app_slug))
      then raise exception 'Choose a template from this scope' using errcode='22023'; end if;
    if existing.data->>'linkedPostId' is not null then
      if existing.app_slug is distinct from p_app then raise exception 'Linked content cannot move scope' using errcode='22023'; end if;
      select * into linked from public.hub_workspace_records where id=(existing.data->>'linkedPostId')::uuid and deleted_at is null;
      if exists(select 1 from jsonb_each(coalesce(linked.data->'delivery','{}'::jsonb)) d where d.value->>'state'='publishing') then raise exception 'Post is being published' using errcode='40001'; end if;
    end if;
    creative_changed:=p_id is null or existing.app_slug is distinct from p_app
      or public.hub_marketing_content_creative(existing.title,existing.data) is distinct from public.hub_marketing_content_creative(p_title,p_data);
    if (existing.status='published' or linked.status='published') and creative_changed then raise exception 'Duplicate published content before changing its creative' using errcode='22023'; end if;
    if p_status='approved' and existing.status is distinct from 'approved' then
      owner_review:=exists(select 1 from public.hub_staff where user_id=p_actor and role='owner' and active);
      if not owner_review then raise exception 'Owner review is required' using errcode='42501'; end if;
      if p_id is null or existing.status<>'in_review' or creative_changed then raise exception 'Save and submit the current creative for review first' using errcode='22023'; end if;
      p_data:=jsonb_set(p_data,'{approval}',jsonb_build_object('reviewedBy',p_actor,'reviewedAt',clock_timestamp()));
    elsif p_status='published' then
      if existing.data->>'approval' is null or linked.id is null or linked.status<>'published' or creative_changed then raise exception 'Record the linked post as published first' using errcode='22023'; end if;
    elsif creative_changed or p_status not in ('approved','published','archived') then
      p_data:=jsonb_set(p_data,'{approval}','null'::jsonb);
      if p_status='approved' then p_status:='in_progress'; end if;
    end if;
  elsif p_module='marketing' and p_data->>'kind'='post' then
    if coalesce(p_data->>'sourceContentId','') is distinct from coalesce(existing.data->>'sourceContentId','')
      or coalesce(p_data->>'sourceApprovalAt','') is distinct from coalesce(existing.data->>'sourceApprovalAt','')
      then raise exception 'Content review links are server managed' using errcode='22023'; end if;
    if p_data->>'sourceContentId' is not null then
      if existing.app_slug is distinct from p_app or coalesce(p_data->>'mentions','')<>coalesce(existing.data->>'mentions','')
        or public.hub_marketing_post_creative(existing.title,existing.data) is distinct from public.hub_marketing_post_creative(p_title,p_data)
        then raise exception 'Edit and reapprove the source content before changing this post' using errcode='22023'; end if;
      if p_status='scheduled' or (p_status='published' and existing.status<>'published')
        or exists(select 1 from jsonb_each(coalesce(p_data->'delivery','{}'::jsonb)) d where d.value->>'state'='publishing') then
        if source.id is null or source.module<>'marketing' or source.data->>'kind'<>'content' or source.status not in ('approved','published')
          or source.app_slug is distinct from p_app or source.data->>'linkedPostId' is distinct from existing.id::text
          or source.data->'approval'->>'reviewedAt' is distinct from p_data->>'sourceApprovalAt'
          or source.data->>'approval' is null
          or public.hub_marketing_post_creative(source.title,source.data) is distinct from public.hub_marketing_post_creative(p_title,p_data)
          then raise exception 'Source content needs a current owner approval' using errcode='22023'; end if;
      end if;
    end if;
  end if;
  if p_module='tasks' and p_status='done' and (p_id is null or existing.status<>'done') and p_data->>'recurrence'<>'none' then raise exception 'Complete recurring tasks with the completion action' using errcode='22023'; end if;
  if p_id is null then
    insert into public.hub_workspace_records(module,app_slug,title,status,data,created_by,updated_by,request_id)
      values(p_module,p_app,trim(p_title),p_status,p_data,p_actor,p_actor,p_request) returning * into saved;
  else
    update public.hub_workspace_records set app_slug=p_app,title=trim(p_title),status=p_status,data=p_data,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
  end if;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
    values(p_actor,p_app,case when p_id is null then 'workspace.created' else 'workspace.updated' end,p_module,saved.id::text,'Workspace record saved',jsonb_build_object('version',saved.version));
  return to_jsonb(saved);
end $$;

-- One source owns one planner draft. A repeated handoff returns it instead of
-- creating another post; the content and post link are committed together.
create or replace function public.hub_marketing_content_post(p_actor uuid,p_id uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare source public.hub_workspace_records; post public.hub_workspace_records; post_data jsonb; refresh_needed boolean;
begin
  select * into source from public.hub_workspace_records where id=p_id and deleted_at is null for update;
  if not found then raise exception 'Content not found' using errcode='P0002'; end if;
  if not public.hub_workspace_actor_can(p_actor,'marketing','write',source.app_slug) then raise exception 'Not permitted' using errcode='42501'; end if;
  if source.module<>'marketing' or source.data->>'kind'<>'content' or source.data->>'isTemplate'<>'false'
    or source.status not in ('approved','published') or source.data->>'approval' is null then raise exception 'Owner-approved content is required' using errcode='22023'; end if;
  if p_version is null or p_version<1 then raise exception 'Invalid version' using errcode='22023'; end if;
  if source.data->>'linkedPostId' is not null then
    select * into post from public.hub_workspace_records where id=(source.data->>'linkedPostId')::uuid and deleted_at is null for update;
    if not found or post.module<>'marketing' or post.data->>'kind'<>'post' or post.app_slug is distinct from source.app_slug
      or post.data->>'sourceContentId' is distinct from source.id::text then raise exception 'Linked planner post is unavailable' using errcode='22023'; end if;
    refresh_needed:=post.data->>'sourceApprovalAt' is distinct from source.data->'approval'->>'reviewedAt'
      or public.hub_marketing_post_creative(post.title,post.data) is distinct from public.hub_marketing_post_creative(source.title,source.data);
    if not refresh_needed then return jsonb_build_object('content',to_jsonb(source),'post',to_jsonb(post)); end if;
    if post.status<>'draft' or coalesce(post.data->'delivery','{}'::jsonb)<>'{}'::jsonb or coalesce(post.data->'publication','{}'::jsonb)<>'{}'::jsonb
      then raise exception 'Return the linked post to an unpublished draft before refreshing it' using errcode='22023'; end if;
  end if;
  if source.version<>p_version then raise exception 'Content changed. Refresh before continuing.' using errcode='40001'; end if;
  if source.data->>'contentType'='video' and not exists(select 1 from jsonb_array_elements(source.data->'media') m where m->>'contentType' like 'video/%') then raise exception 'Attach the final video before creating a planner post' using errcode='22023'; end if;
  if source.data->>'contentType' in ('photo','carousel') and not exists(select 1 from jsonb_array_elements(source.data->'media') m where m->>'contentType' like 'image/%') then raise exception 'Attach the final image before creating a planner post' using errcode='22023'; end if;
  if source.data->>'contentType'='text' and trim(coalesce(source.data->>'caption',''))='' then raise exception 'Add the final caption first' using errcode='22023'; end if;
  post_data:=jsonb_build_object('kind','post','platforms',source.data->'platforms','caption',source.data->>'caption','hashtags',source.data->>'hashtags','mentions','',
    'media',source.data->'media','thumbnail',source.data->'thumbnail','scheduledAt',null,'timeZone','America/Chicago','publishedAt',null,
    'contentType',source.data->>'contentType','campaign',source.data->>'campaign','notes',source.data->>'notes','publication','{}'::jsonb,'flags','[]'::jsonb,
    'sourceContentId',source.id,'sourceApprovalAt',source.data->'approval'->>'reviewedAt');
  perform public.hub_workspace_validate('marketing','draft',post_data,source.app_slug);
  if post.id is null then
    insert into public.hub_workspace_records(module,app_slug,title,status,data,created_by,updated_by)
      values('marketing',source.app_slug,source.title,'draft',post_data,p_actor,p_actor) returning * into post;
    update public.hub_workspace_records set data=jsonb_set(data,'{linkedPostId}',to_jsonb(post.id::text)),version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=source.id returning * into source;
  else
    -- Preserve planner notes and prior planned time when replacing the reviewed creative.
    post_data:=post_data||jsonb_build_object('notes',post.data->'notes','scheduledAt',post.data->'scheduledAt','timeZone',post.data->'timeZone','flags',post.data->'flags');
    update public.hub_workspace_records set title=source.title,data=post_data,version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=post.id returning * into post;
  end if;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary,metadata)
    values(p_actor,source.app_slug,'marketing.content.planner','marketing',source.id::text,'Approved content saved to planner draft',jsonb_build_object('postId',post.id,'version',source.version));
  return jsonb_build_object('content',to_jsonb(source),'post',to_jsonb(post));
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
  if item.module='marketing' and ((item.data->>'kind'='content' and item.data->>'linkedPostId' is not null)
    or (item.data->>'kind'='post' and item.data->>'sourceContentId' is not null)) then
    raise exception 'Archive linked content or cancel its planner post instead of deleting it' using errcode='22023';
  end if;
  update public.hub_workspace_records set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=p_actor,version=version+1 where id=p_id;
  insert into public.hub_audit_log(actor_id,app_slug,action,entity_type,entity_id,summary) values(p_actor,item.app_slug,'workspace.deleted',item.module,p_id::text,'Workspace record deleted');
end $$;

-- These routines take a verified server actor and are never callable by browser roles.
revoke all on function public.hub_marketing_content_creative(text,jsonb) from public,anon,authenticated;
revoke all on function public.hub_marketing_post_creative(text,jsonb) from public,anon,authenticated;
revoke all on function public.hub_marketing_content_post(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.hub_marketing_content_creative(text,jsonb) to service_role;
grant execute on function public.hub_marketing_post_creative(text,jsonb) to service_role;
grant execute on function public.hub_marketing_content_post(uuid,uuid,integer) to service_role;
revoke all on function public.hub_workspace_validate(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.hub_workspace_save(uuid,uuid,integer,text,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.hub_workspace_validate(text,text,jsonb,text) to service_role;
grant execute on function public.hub_workspace_save(uuid,uuid,integer,text,text,text,text,jsonb,uuid) to service_role;

revoke all on function public.hub_workspace_delete(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.hub_workspace_delete(uuid,uuid,integer) to service_role;

commit;
