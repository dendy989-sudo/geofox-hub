-- Geofox central project only. Customer identity is verified against the source
-- app Auth and current session by the server before calling these private RPCs.
-- Public-form customer_id/email values never establish ownership.
begin;
set local lock_timeout = '3s';

alter table public.hub_tickets add column if not exists customer_owner_id uuid;
alter table public.hub_tickets add column if not exists customer_updated_at timestamptz;
alter table public.hub_ticket_messages add column if not exists customer_author_id uuid;
alter table public.hub_ticket_messages add column if not exists author_kind text not null default 'guest';
alter table public.hub_ticket_messages add column if not exists staff_request_id uuid;
alter table public.hub_ticket_messages add column if not exists staff_request_hash text;
-- Staff deletion clears author_id; retained internal notes remain staff notes.
update public.hub_ticket_messages set author_kind='staff' where (author_id is not null or internal) and author_kind='guest';
update public.hub_tickets t set customer_updated_at=greatest(t.created_at,
  (select max(m.created_at) from public.hub_ticket_messages m where m.ticket_id=t.id and not m.internal))
where customer_updated_at is null;
alter table public.hub_tickets alter column customer_updated_at set default now();
alter table public.hub_tickets alter column customer_updated_at set not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.hub_tickets'::regclass and conname='hub_ticket_verified_owner') then
    alter table public.hub_tickets add constraint hub_ticket_verified_owner check
      (customer_owner_id is null or (identity_verified and source='app' and customer_id=customer_owner_id::text));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.hub_ticket_messages'::regclass and conname='hub_message_author_kind') then
    alter table public.hub_ticket_messages add constraint hub_message_author_kind check (
      (author_kind='staff' and customer_author_id is null) or
      (author_kind='customer' and author_id is null and customer_author_id is not null and not internal) or
      (author_kind='guest' and author_id is null and customer_author_id is null and not internal)
    );
  end if;
end $$;

create index if not exists hub_customer_ticket_page
  on public.hub_tickets(app_slug,customer_owner_id,created_at desc,id desc) where customer_owner_id is not null;
create index if not exists hub_customer_message_page
  on public.hub_ticket_messages(ticket_id,created_at desc,id desc) where not internal;
create unique index if not exists hub_staff_message_request
  on public.hub_ticket_messages(author_id,staff_request_id) where staff_request_id is not null;

create table if not exists public.hub_customer_requests (
  app_slug text not null references public.hub_apps(slug),
  customer_owner_id uuid not null,
  request_id uuid not null,
  operation text not null check(operation in ('create','reply')),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  ticket_id uuid not null references public.hub_tickets(id) on delete cascade,
  message_id uuid not null references public.hub_ticket_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(app_slug,customer_owner_id,request_id)
);
alter table public.hub_customer_requests enable row level security;
revoke all on table public.hub_customer_requests from public,anon,authenticated;
grant all on table public.hub_customer_requests to service_role;
create index if not exists hub_customer_requests_ticket on public.hub_customer_requests(ticket_id);
create index if not exists hub_customer_requests_message on public.hub_customer_requests(message_id);

-- Private notes, email attempts and assignment changes must not alter the
-- timestamp visible to customers. Public messages and customer-visible status do.
create or replace function public.hub_customer_ticket_touch()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status is distinct from old.status or new.subject is distinct from old.subject or new.category is distinct from old.category then
    new.customer_updated_at=now();
  end if;
  if new.customer_owner_id is distinct from old.customer_owner_id or new.app_slug is distinct from old.app_slug then
    raise exception 'Ticket ownership is immutable' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.hub_customer_ticket_touch() from public,anon,authenticated;
drop trigger if exists hub_customer_ticket_touch on public.hub_tickets;
create trigger hub_customer_ticket_touch before update on public.hub_tickets for each row execute function public.hub_customer_ticket_touch();

create or replace function public.hub_customer_message_touch()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.author_id is not null then new.author_kind='staff'; end if;
  if new.customer_author_id is not null and not exists (
    select 1 from public.hub_tickets t where t.id=new.ticket_id
      and t.customer_owner_id=new.customer_author_id and t.identity_verified and t.source='app'
  ) then raise exception 'Message owner mismatch' using errcode='42501'; end if;
  if not new.internal then
    update public.hub_tickets set customer_updated_at=now() where id=new.ticket_id;
  end if;
  return new;
end; $$;
revoke all on function public.hub_customer_message_touch() from public,anon,authenticated;
drop trigger if exists hub_customer_message_touch on public.hub_ticket_messages;
create trigger hub_customer_message_touch before insert on public.hub_ticket_messages for each row execute function public.hub_customer_message_touch();

-- This whitelist is deliberately separate from the staff ticket response.
create or replace function public.hub_customer_ticket_json(p_ticket public.hub_tickets)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',p_ticket.id,'reference',p_ticket.reference,'appSlug',p_ticket.app_slug,
    'appName',(select name from public.hub_apps where slug=p_ticket.app_slug),
    'subject',p_ticket.subject,'category',p_ticket.category,'status',p_ticket.status,
    'createdAt',p_ticket.created_at,'updatedAt',p_ticket.customer_updated_at
  );
$$;
revoke all on function public.hub_customer_ticket_json(public.hub_tickets) from public,anon,authenticated;
grant execute on function public.hub_customer_ticket_json(public.hub_tickets) to service_role;

create or replace function public.hub_customer_list_tickets(
  p_app text,p_customer uuid,p_limit integer default 20,p_before_created timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_customer is null or p_limit is null or p_limit not between 1 and 25 or ((p_before_created is null)<>(p_before_id is null)) then
    raise exception 'Invalid page' using errcode='22023';
  end if;
  if not exists(select 1 from public.hub_apps where slug=p_app and active) then
    raise exception 'Ticket unavailable' using errcode='P0100';
  end if;
  with page as materialized (
    select t.* from public.hub_tickets t
    where t.app_slug=p_app and t.customer_owner_id=p_customer and t.identity_verified and t.source='app'
      and (p_before_created is null or (t.created_at,t.id)<(p_before_created,p_before_id))
    order by t.created_at desc,t.id desc limit p_limit+1
  ), visible as materialized (
    select * from page order by created_at desc,id desc limit p_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(public.hub_customer_ticket_json(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('createdAt',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;
revoke all on function public.hub_customer_list_tickets(text,uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.hub_customer_list_tickets(text,uuid,integer,timestamptz,uuid) to service_role;

create or replace function public.hub_customer_ticket_detail(
  p_app text,p_customer uuid,p_ticket uuid,p_before_created timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.hub_tickets; result jsonb;
begin
  if p_customer is null or p_ticket is null or ((p_before_created is null)<>(p_before_id is null)) then
    raise exception 'Invalid page' using errcode='22023';
  end if;
  select t.* into ticket from public.hub_tickets t join public.hub_apps a on a.slug=t.app_slug and a.active
    where t.id=p_ticket and t.app_slug=p_app and t.customer_owner_id=p_customer and t.identity_verified and t.source='app';
  if not found then raise exception 'Ticket unavailable' using errcode='P0100'; end if;
  with page as materialized (
    select m.id,m.body,m.author_kind,m.created_at from public.hub_ticket_messages m
    where m.ticket_id=ticket.id and not m.internal
      and (m.author_kind='staff' or (m.author_kind='customer' and m.customer_author_id=p_customer))
      and (p_before_created is null or (m.created_at,m.id)<(p_before_created,p_before_id))
    order by m.created_at desc,m.id desc limit 51
  ), visible as materialized (
    select * from page order by created_at desc,id desc limit 50
  )
  select jsonb_build_object(
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'body',body,'author',case when author_kind='staff' then 'support' else 'customer' end,'createdAt',created_at
    ) order by created_at,id) from visible),'[]'::jsonb),
    'nextMessagesCursor',case when (select count(*) from page)>50 then
      (select jsonb_build_object('createdAt',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return public.hub_customer_ticket_json(ticket)||result;
end; $$;
revoke all on function public.hub_customer_ticket_detail(text,uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.hub_customer_ticket_detail(text,uuid,uuid,timestamptz,uuid) to service_role;

create or replace function public.hub_customer_create_ticket(
  p_app text,p_customer uuid,p_email text,p_subject text,p_body text,p_category text,p_request uuid,p_account_key text,p_ip_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.hub_customer_requests; ticket public.hub_tickets; message_id uuid; payload text;
begin
  if p_customer is null or p_request is null or p_subject is null or p_body is null or p_category is null
    or char_length(trim(p_subject)) not between 3 and 180 or char_length(trim(p_body)) not between 10 and 12000
    or p_category<>all(array['general','account','billing','bug','safety','feedback'])
    or p_account_key is null or p_ip_key is null or p_account_key !~ '^[a-f0-9]{64}$' or p_ip_key !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid request' using errcode='22023'; end if;
  if not exists(select 1 from public.hub_apps where slug=p_app and active) then raise exception 'Ticket unavailable' using errcode='P0100'; end if;
  payload=encode(sha256(convert_to(jsonb_build_object('operation','create','subject',trim(p_subject),'body',trim(p_body),'category',p_category)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_app||':'||p_customer::text||':'||p_request::text,0));
  select * into prior from public.hub_customer_requests where app_slug=p_app and customer_owner_id=p_customer and request_id=p_request;
  if found then
    if prior.operation<>'create' or prior.payload_hash<>payload then raise exception 'Conflicting retry' using errcode='P0101'; end if;
    return public.hub_customer_ticket_detail(p_app,p_customer,prior.ticket_id)||jsonb_build_object('replayed',true);
  end if;
  if not public.hub_reserve_rate_limit(p_account_key,3600,5) or not public.hub_reserve_rate_limit(p_ip_key,900,20) then
    raise exception 'Support rate limit' using errcode='P0103';
  end if;
  insert into public.hub_tickets(app_slug,email,subject,category,customer_id,customer_owner_id,identity_verified,source,priority)
  values(p_app,lower(trim(p_email)),trim(p_subject),p_category,p_customer::text,p_customer,true,'app',case when p_category='safety' then 'high' else 'normal' end)
  returning * into ticket;
  insert into public.hub_ticket_messages(ticket_id,body,author_name,author_kind,customer_author_id,internal,delivery_status)
  values(ticket.id,trim(p_body),'Customer','customer',p_customer,false,'not_requested') returning id into message_id;
  insert into public.hub_customer_requests(app_slug,customer_owner_id,request_id,operation,payload_hash,ticket_id,message_id)
  values(p_app,p_customer,p_request,'create',payload,ticket.id,message_id);
  insert into public.hub_audit_log(app_slug,action,entity_type,entity_id,summary)
  values(p_app,'ticket.app_created','ticket',ticket.id::text,'Support request received from a verified app account');
  return public.hub_customer_ticket_detail(p_app,p_customer,ticket.id)||jsonb_build_object('replayed',false);
end; $$;
revoke all on function public.hub_customer_create_ticket(text,uuid,text,text,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hub_customer_create_ticket(text,uuid,text,text,text,text,uuid,text,text) to service_role;

create or replace function public.hub_customer_reply(
  p_app text,p_customer uuid,p_ticket uuid,p_body text,p_request uuid,p_account_key text,p_ip_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.hub_tickets; prior public.hub_customer_requests; message public.hub_ticket_messages; payload text; replayed boolean=false;
begin
  if p_customer is null or p_ticket is null or p_request is null or p_body is null or char_length(trim(p_body)) not between 1 and 12000
    or p_account_key is null or p_ip_key is null or p_account_key !~ '^[a-f0-9]{64}$' or p_ip_key !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid reply' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_app||':'||p_customer::text||':'||p_request::text,0));
  select t.* into ticket from public.hub_tickets t join public.hub_apps a on a.slug=t.app_slug and a.active
    where t.id=p_ticket and t.app_slug=p_app and t.customer_owner_id=p_customer and t.identity_verified and t.source='app'
    for update of t;
  if not found then raise exception 'Ticket unavailable' using errcode='P0100'; end if;
  payload=encode(sha256(convert_to(jsonb_build_object('operation','reply','ticket',p_ticket,'body',trim(p_body))::text,'UTF8')),'hex');
  select * into prior from public.hub_customer_requests where app_slug=p_app and customer_owner_id=p_customer and request_id=p_request;
  if found then
    if prior.operation<>'reply' or prior.ticket_id<>p_ticket or prior.payload_hash<>payload then raise exception 'Conflicting retry' using errcode='P0101'; end if;
    select * into message from public.hub_ticket_messages where id=prior.message_id and ticket_id=p_ticket and not internal and customer_author_id=p_customer;
    if not found then raise exception 'Ticket unavailable' using errcode='P0100'; end if;
    replayed=true;
  else
    if ticket.status='closed' then raise exception 'Ticket is closed' using errcode='P0102'; end if;
    if not public.hub_reserve_rate_limit(p_account_key,3600,60) or not public.hub_reserve_rate_limit(p_ip_key,900,120) then
      raise exception 'Support rate limit' using errcode='P0103';
    end if;
    insert into public.hub_ticket_messages(ticket_id,body,author_name,author_kind,customer_author_id,internal,delivery_status)
    values(p_ticket,trim(p_body),'Customer','customer',p_customer,false,'not_requested') returning * into message;
    update public.hub_tickets set status=case when status in ('resolved','waiting_customer') then 'open' else status end,updated_at=now()
      where id=p_ticket returning * into ticket;
    insert into public.hub_customer_requests(app_slug,customer_owner_id,request_id,operation,payload_hash,ticket_id,message_id)
    values(p_app,p_customer,p_request,'reply',payload,p_ticket,message.id);
    insert into public.hub_audit_log(app_slug,action,entity_type,entity_id,summary)
    values(p_app,'ticket.customer_replied','ticket',p_ticket::text,'Reply received from the verified app account');
  end if;
  return jsonb_build_object('message',jsonb_build_object('id',message.id,'body',message.body,'author','customer','createdAt',message.created_at),
    'ticketStatus',ticket.status,'updatedAt',ticket.customer_updated_at,'replayed',replayed);
end; $$;
revoke all on function public.hub_customer_reply(text,uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hub_customer_reply(text,uuid,uuid,text,uuid,text,text) to service_role;

-- Staff retries also reuse the recorded message. The API never resends an
-- optional email automatically when publication has already committed.
create or replace function public.hub_add_ticket_message_once(
  p_actor uuid,p_ticket uuid,p_body text,p_internal boolean,p_delivery_status text,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.hub_tickets; prior public.hub_ticket_messages; message_id uuid; payload text;
begin
  if p_request is null or p_actor is null or p_internal is null then raise exception 'Invalid request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-message:'||p_actor::text||':'||p_request::text,0));
  select * into ticket from public.hub_tickets where id=p_ticket for update;
  if not found or not public.hub_actor_can(p_actor,'tickets:write',ticket.app_slug) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  payload=encode(sha256(convert_to(jsonb_build_object('ticket',p_ticket,'body',trim(p_body),'internal',p_internal)::text,'UTF8')),'hex');
  select * into prior from public.hub_ticket_messages where author_id=p_actor and staff_request_id=p_request;
  if found then
    if prior.ticket_id<>p_ticket or prior.staff_request_hash<>payload then raise exception 'Conflicting retry' using errcode='P0101'; end if;
    return jsonb_build_object('id',prior.id,'replayed',true);
  end if;
  message_id=public.hub_add_ticket_message(p_actor,p_ticket,p_body,p_internal,p_delivery_status);
  update public.hub_ticket_messages set staff_request_id=p_request,staff_request_hash=payload where id=message_id;
  return jsonb_build_object('id',message_id,'replayed',false);
end; $$;
revoke all on function public.hub_add_ticket_message_once(uuid,uuid,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.hub_add_ticket_message_once(uuid,uuid,text,boolean,text,uuid) to service_role;

create or replace function public.hub_staff_ticket_messages(
  p_actor uuid,p_ticket uuid,p_before_created timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare app text; result jsonb;
begin
  select app_slug into app from public.hub_tickets where id=p_ticket;
  if not found or not public.hub_actor_can(p_actor,'tickets:read',app) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if (p_before_created is null)<>(p_before_id is null) then raise exception 'Invalid page' using errcode='22023'; end if;
  with page as materialized (
    select m.* from public.hub_ticket_messages m
    where m.ticket_id=p_ticket and (p_before_created is null or (m.created_at,m.id)<(p_before_created,p_before_id))
    order by m.created_at desc,m.id desc limit 101
  ), visible as materialized (
    select * from page order by created_at desc,id desc limit 100
  )
  select jsonb_build_object(
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'body',body,'author_name',author_name,'internal',internal,'created_at',created_at,'delivery_status',delivery_status
    ) order by created_at,id) from visible),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>100 then
      (select jsonb_build_object('createdAt',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;
revoke all on function public.hub_staff_ticket_messages(uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.hub_staff_ticket_messages(uuid,uuid,timestamptz,uuid) to service_role;

commit;
