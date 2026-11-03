-- A shared staff read cursor is separate from ticket workflow/activity. Merely
-- opening a thread (GET), posting a note, or changing its status is not a read.
begin;
set local lock_timeout='5s';

create table if not exists public.hub_ticket_staff_reads (
  ticket_id uuid primary key references public.hub_tickets(id) on delete cascade,
  customer_message_id uuid not null references public.hub_ticket_messages(id) on delete cascade,
  customer_message_created_at timestamptz not null,
  read_at timestamptz not null default now()
);
alter table public.hub_ticket_staff_reads enable row level security;
revoke all on table public.hub_ticket_staff_reads from public,anon,authenticated,service_role;
grant select on table public.hub_ticket_staff_reads to service_role;
create index if not exists hub_ticket_staff_reads_message on public.hub_ticket_staff_reads(customer_message_id);
create index if not exists hub_customer_reply_page
  on public.hub_ticket_messages(ticket_id,created_at desc,id desc)
  where author_kind='customer' and not internal;

create or replace function public.hub_acknowledge_ticket_reply(p_actor uuid,p_ticket uuid,p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ticket public.hub_tickets;
  message public.hub_ticket_messages;
  receipt public.hub_ticket_staff_reads;
begin
  if p_actor is null or p_ticket is null or p_message is null then
    raise exception 'Invalid read receipt' using errcode='22023';
  end if;
  select * into ticket from public.hub_tickets where id=p_ticket for key share;
  if not found or not public.hub_actor_can(p_actor,'tickets:read',ticket.app_slug) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  select * into message from public.hub_ticket_messages
    where id=p_message and ticket_id=p_ticket and author_kind='customer' and not internal
      and customer_author_id=ticket.customer_owner_id
      and ticket.identity_verified and ticket.source='app'
    for key share;
  if not found then raise exception 'Customer reply unavailable' using errcode='42501'; end if;

  -- Upsert only the exact message the client displayed. Concurrent/newer
  -- customer replies are never selected here. A retry or older tab cannot
  -- regress the cursor, including ties within one JavaScript millisecond.
  insert into public.hub_ticket_staff_reads as current_read(
    ticket_id,customer_message_id,customer_message_created_at,read_at
  ) values(p_ticket,message.id,message.created_at,clock_timestamp())
  on conflict(ticket_id) do update set
    customer_message_id=excluded.customer_message_id,
    customer_message_created_at=excluded.customer_message_created_at,
    read_at=excluded.read_at
  where (current_read.customer_message_created_at,current_read.customer_message_id)
    < (excluded.customer_message_created_at,excluded.customer_message_id);

  select * into receipt from public.hub_ticket_staff_reads where ticket_id=p_ticket;
  return jsonb_build_object(
    'ticketId',p_ticket,'messageId',p_message,
    'readThroughMessageId',receipt.customer_message_id,
    'readThroughCreatedAt',receipt.customer_message_created_at
  );
end; $$;
revoke all on function public.hub_acknowledge_ticket_reply(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hub_acknowledge_ticket_reply(uuid,uuid,uuid) to service_role;

-- Preserve existing customer reply validation, retries, limits and workflow.
-- Only its timestamp assignment changes, under its existing per-ticket lock.
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
    -- The ticket is locked above. Order realtime replies by insertion, not
    -- transaction start: a delayed transaction must not sort behind a seen reply.
    insert into public.hub_ticket_messages(ticket_id,body,author_name,author_kind,customer_author_id,internal,delivery_status,created_at)
    values(p_ticket,trim(p_body),'Customer','customer',p_customer,false,'not_requested',
      greatest(clock_timestamp(),(select m.created_at+interval '1 microsecond' from public.hub_ticket_messages m
        where m.ticket_id=p_ticket and m.author_kind='customer' and not m.internal
        order by m.created_at desc,m.id desc limit 1))) returning * into message;
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

notify pgrst,'reload schema';
commit;
