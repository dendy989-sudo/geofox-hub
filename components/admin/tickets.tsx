"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ListResult, Ticket, TicketDetail, TicketMessage, TicketPriority, TicketStatus } from "@/lib/hub/types";
import { apiRequest, AppBadge, Card, count, date, Empty, ErrorBanner, label, listNotes, Loading, Notes, PageHeading, Pagination, type PanelProps, Pill, useHubData } from "./common";
import { Icon } from "./icons";
import { CustomersPanel } from "./customers";

const statuses: TicketStatus[] = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const priorities: TicketPriority[] = ["low", "normal", "high", "urgent"];

function TicketConversation({ ticket: initialTicket, props, refresh, openCustomer }: { ticket: TicketDetail; props: PanelProps; refresh: () => void; openCustomer: (appSlug: string, id: string) => void }) {
  const [ticket, setTicket] = useState(initialTicket);
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [messages, setMessages] = useState(ticket.messages);
  const [olderCursor, setOlderCursor] = useState(ticket.nextMessagesCursor);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  useEffect(() => () => refreshRequest.current?.abort(), []);
  const writable = props.can("tickets:write") && !props.preview;
  const inApp = ticket.source === "app" && ticket.identityVerified && Boolean(ticket.customerOwnerId);
  function applyLatest(latest: TicketDetail, savedDetails = false) {
    const overlap = latest.messages.length ? messages.findIndex(message => message.id === latest.messages[0].id) : -1;
    const keepEarlier = Boolean(latest.nextMessagesCursor) && overlap >= 0;
    setMessages(keepEarlier ? [...messages.slice(0, overlap), ...latest.messages] : latest.messages);
    setOlderCursor(keepEarlier ? olderCursor : latest.nextMessagesCursor);
    setStatus(value => savedDetails || value === ticket.status ? latest.status : value);
    setPriority(value => savedDetails || value === ticket.priority ? latest.priority : value);
    setTicket(latest);
  }
  async function refreshConversation() {
    if (props.preview || busy || refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    setBusy("refresh"); setError("");
    try {
      const latest = await apiRequest<TicketDetail>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      applyLatest(latest);
      props.notify("Conversation refreshed.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to refresh the conversation. Your draft is still here.");
    } finally {
      if (refreshRequest.current === controller) refreshRequest.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }
  async function save() {
    if (!writable || busy) return;
    setBusy("save"); setError("");
    try {
      const latest = await apiRequest<TicketDetail>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}`, { method: "PATCH", body: JSON.stringify({ status, priority }) });
      applyLatest(latest, true);
      props.notify(status === "closed" ? inApp ? "Ticket closed. Customer replies are disabled." : "Ticket moved to Closed." : status === "resolved" ? inApp ? "Ticket resolved. A customer reply will reopen it." : "Ticket moved to Resolved." : "Ticket details updated.");
      refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update the ticket."); }
    finally { setBusy(""); }
  }
  async function loadOlder() {
    if (!olderCursor || busy) return;
    setBusy("older"); setError("");
    try {
      const previous = await apiRequest<TicketDetail>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}?messagesBefore=${encodeURIComponent(olderCursor)}`);
      setMessages(current => [...previous.messages.filter(message => !current.some(existing => existing.id === message.id)), ...current]);
      setOlderCursor(previous.nextMessagesCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load earlier messages."); }
    finally { setBusy(""); }
  }
  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!writable || !body.trim() || busy) return;
    setBusy("reply"); setError("");
    const input = { body: body.trim(), internal, notifyEmail: inApp && !internal && notifyEmail };
    const signature = JSON.stringify(input);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() };
    try {
      const message = await apiRequest<TicketMessage>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}/messages`, {
        method: "POST", body: JSON.stringify({ ...input, requestId: pendingRequest.current.id }),
      });
      setBody(""); pendingRequest.current = null;
      setMessages(current => current.some(existing => existing.id === message.id) ? current : [...current, message]);
      props.notify(message.notificationNotice || (internal ? "Internal note saved." : inApp
        ? message.deliveryStatus === "sent" ? "Reply published in NovaNook. Email notification accepted by the provider."
          : message.deliveryStatus === "failed" ? "Reply published in NovaNook. Email sending is not confirmed; check the provider before retrying."
          : message.deliveryStatus === "pending" ? "Reply is available in NovaNook. Check the provider for the pending email notification."
          : "Reply published in NovaNook."
        : message.deliveryStatus === "sent" ? "Reply accepted by the email provider."
          : message.deliveryStatus === "failed" ? "Reply saved, but sending is not confirmed. Check the email provider before retrying to avoid duplicate mail."
          : message.deliveryStatus === "pending" ? "Reply saved; check the provider for the pending email."
          : "Reply saved; email delivery was not requested."));
      refresh();
      const controller = new AbortController();
      refreshRequest.current = controller;
      try {
        const latest = await apiRequest<TicketDetail>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}`, { signal: controller.signal });
        if (!controller.signal.aborted) applyLatest(latest);
      } catch {
        if (!controller.signal.aborted) setError("Your message was saved, but the latest conversation could not be loaded. Use Refresh to check for other replies.");
      } finally {
        if (refreshRequest.current === controller) refreshRequest.current = null;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save your message. Keep this message unchanged and retry to avoid duplicates."); }
    finally { setBusy(""); }
  }
  return <section className="hub-card hub-detail" aria-label={`Ticket ${ticket.reference}`}>
    <header className="hub-detail-head"><div><AppBadge slug={ticket.appSlug} apps={props.apps} /><h2>{ticket.subject}</h2><p>{ticket.reference} · {ticket.email} · Created {date(ticket.createdAt)}</p>
      <div className="hub-detail-meta"><Pill status={ticket.status} /><Pill status={ticket.priority} /><span className="hub-row-sub">{label(ticket.category)}</span><Pill status={inApp ? "healthy" : "unknown"}>{inApp ? "Verified app account · replies in app" : "Email support · verify account claims"}</Pill>{inApp && ticket.customerOwnerId && props.can("customers:read") ? <button type="button" className="hub-section-link" onClick={() => openCustomer(ticket.appSlug, ticket.customerOwnerId!)}><Icon name="users" size={14} />View customer profile <Icon name="arrow" size={12} /></button> : !inApp ? <span className="hub-row-sub">No verified app account linked</span> : null}</div>
    </div><div className="hub-ticket-actions"><button type="button" className="hub-button secondary small" aria-label="Refresh conversation" title="Refresh conversation" aria-busy={busy === "refresh"} disabled={props.preview || Boolean(busy)} onClick={refreshConversation}><Icon name="refresh" size={14} className={busy === "refresh" ? "hub-spinning" : undefined} />{busy === "refresh" ? "Refreshing…" : "Refresh"}</button></div></header>
    <div className="hub-detail-body"><ErrorBanner error={error} />
      <div className="hub-inline-fields" style={{ marginBottom: 23 }}><div className="hub-field"><label htmlFor="ticket-status">Status</label><select id="ticket-status" value={status} disabled={!writable || Boolean(busy)} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><div className="hub-field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={priority} disabled={!writable || Boolean(busy)} onChange={(event) => setPriority(event.target.value as TicketPriority)}>{priorities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><button type="button" className="hub-button secondary" disabled={!writable || Boolean(busy) || (status === ticket.status && priority === ticket.priority)} onClick={save}>{busy === "save" ? "Saving…" : "Save details"}</button></div>
      <p className="hub-ticket-status-help">{inApp ? <><strong>Resolved:</strong> answered and archived; a customer reply reopens the request. <strong>Closed:</strong> archived with customer replies turned off. You can reopen it at any time.</> : <><strong>Resolved and Closed:</strong> archived conversations. Incoming email replies reach your support mailbox; reopen the ticket here when following up.</>}</p>
      {inApp && ticket.status === "closed" ? <p className="hub-text-note">The customer can read this conversation and start a new request, but cannot reply here.</p> : null}
      {olderCursor ? <button type="button" className="hub-button secondary" disabled={Boolean(busy)} onClick={loadOlder}>{busy === "older" ? "Loading earlier messages…" : "Load earlier messages"}</button> : null}
      {messages.length ? messages.map((message) => <article key={message.id} className={`hub-message ${message.internal ? "internal" : ""}`}><div className="hub-message-head"><strong>{message.authorName} {message.internal ? "· Internal note" : inApp ? "· In-app conversation" : "· Email conversation"}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></div><p>{message.body}</p>{!message.internal ? <div className="hub-detail-meta"><Pill status={message.deliveryStatus}>{message.deliveryStatus === "not_requested" ? inApp ? "Available in NovaNook" : "Saved to ticket" : message.deliveryStatus === "sent" ? "Accepted by email provider" : message.deliveryStatus === "failed" ? "Sending not confirmed — check provider before retrying" : "Email pending"}</Pill></div> : null}</article>) : <Empty icon="ticket" title="No conversation messages returned" />}
      <form className="hub-reply" onSubmit={reply}><div className="hub-field"><label htmlFor="ticket-message">{internal ? "Add an internal note" : inApp ? "Reply in NovaNook" : "Write an email reply to the customer"}</label><textarea id="ticket-message" value={body} onChange={(event) => setBody(event.target.value)} placeholder={internal ? "Leave context for yourself or your team…" : "Write a clear, helpful reply…"} maxLength={12000} required disabled={!writable || Boolean(busy)} /><small>{internal ? "Internal notes stay in your staff workspace." : inApp ? "Your reply appears in the customer’s NovaNook conversation. It does not require email delivery." : `This reply is emailed to ${ticket.email}. Incoming email replies arrive in your support mailbox; they are not imported automatically.`}</small></div>
        {!internal && inApp ? <label className="hub-text-note"><input type="checkbox" checked={notifyEmail} onChange={event => setNotifyEmail(event.target.checked)} disabled={!writable || Boolean(busy)} /> Also send an email notification, if a verified sender and current confirmed customer address are available. The email contains no conversation text.</label> : null}
        <div className="hub-reply-actions"><div className="hub-radio-row" style={{ margin: 0 }}><label><input type="radio" name="message-kind" checked={internal} onChange={() => setInternal(true)} disabled={!writable || Boolean(busy)} />Internal note</label><label><input type="radio" name="message-kind" checked={!internal} onChange={() => setInternal(false)} disabled={!writable || Boolean(busy)} />Customer reply</label></div><button className="hub-button" type="submit" disabled={!writable || Boolean(busy) || !body.trim()}><Icon name={internal ? "lock" : "send"} size={14} />{busy === "reply" ? "Saving…" : internal ? "Save internal note" : inApp ? "Publish reply in NovaNook" : "Send email reply"}</button></div>{!writable ? <p className="hub-text-note">Your role can read this ticket. Replying and changing it require support permissions.</p> : null}</form>
      {ticket.audit.length ? <details className="hub-ticket-audit"><summary>Ticket activity</summary><div className="hub-timeline">{ticket.audit.map((event) => <div className="hub-timeline-item" key={event.id}><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.createdAt}>{date(event.createdAt)}</time></div>)}</div></details> : null}
    </div></section>;
}

type CustomerTarget = { appSlug: string; id: string };
const inboxViews = ["active", "resolved", "closed"] as const;
const pageSize = 5;

export function TicketsPanel(props: PanelProps) {
  const [status, setStatus] = useState("active");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<CustomerTarget | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const view = status === "resolved" || status === "closed" ? status : "active";
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const list = useHubData<ListResult<Ticket>>(props.preview ? null : `/api/admin/tickets?app=${encodeURIComponent(props.app)}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(search)}&limit=${pageSize}&offset=${offset}`, props.refreshKey);
  const detail = useHubData<TicketDetail>(!props.preview && selected ? `/api/admin/tickets/${encodeURIComponent(selected)}` : null, props.refreshKey);
  const tickets = list.data?.items || [];
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined && offset > 0 && offset >= total) setOffset(Math.max(0, Math.ceil(total / pageSize) - 1) * pageSize);
  }, [total, offset]);
  useEffect(() => {
    if (selected) { backButton.current?.focus(); window.scrollTo({ top: 0, behavior: "instant" }); }
  }, [selected, customerTarget]);
  function filter(nextStatus: string) { setStatus(nextStatus); setOffset(0); }
  function backToInbox() {
    const ticketId = selected;
    setSelected(null); setCustomerTarget(null);
    window.requestAnimationFrame(() => {
      const button = ticketId ? document.getElementById(`ticket-open-${ticketId}`) : null;
      if (button) button.focus(); else document.getElementById("ticket-search")?.focus();
    });
  }

  if (selected) return <div className="hub-ticket-page">
    <div className="hub-ticket-navigation">
      <button ref={backButton} type="button" className="hub-button secondary" onClick={customerTarget ? () => setCustomerTarget(null) : backToInbox}>
        <Icon name="arrow" size={14} className="hub-back-arrow" />{customerTarget ? "Back to ticket" : "Back to inbox"}
      </button>
      {customerTarget ? <button type="button" className="hub-section-link" onClick={backToInbox}>Back to inbox</button> : null}
    </div>
    <PageHeading kicker={customerTarget ? "CUSTOMER CONTEXT" : "SUPPORT INBOX"} title={customerTarget ? "Customer profile." : "Support conversation."} description={customerTarget ? "The verified app account attached to this request." : "Keep the conversation, account context, and next step together."} />
    <div hidden={Boolean(customerTarget)}>
      <ErrorBanner error={detail.error} />
      {detail.loading || (!detail.data && !detail.error) ? <Loading label="Opening the ticket…" /> : detail.data?.id === selected ? <TicketConversation key={detail.data.id} ticket={detail.data} props={props} refresh={list.reload} openCustomer={(appSlug, id) => setCustomerTarget({ appSlug, id })} /> : null}
      {detail.error ? <button type="button" className="hub-button secondary" onClick={detail.reload}>Try again</button> : null}
    </div>
    {customerTarget ? <CustomersPanel key={`${customerTarget.appSlug}-${customerTarget.id}`} {...props} initialCustomer={customerTarget} embedded /> : null}
  </div>;

  return <>
    <PageHeading kicker="ONE INBOX, EVERY APP" title="A little help goes a long way." description="Active requests stay here. Finished conversations are easy to find in their archives." />
    <ErrorBanner error={list.error} />
    <div className="hub-controls hub-inbox-controls">
      <div className="hub-field hub-filter-search"><label className="hub-sr-only" htmlFor="ticket-search">Search tickets</label><input id="ticket-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search subject, reference, or email" /></div>
      <select className="hub-select" aria-label="Filter tickets by status" value={status} onChange={event => filter(event.target.value)}>
        <option value="active">All active statuses</option>{statuses.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select>
      <div className="hub-inbox-tabs" role="group" aria-label="Ticket folders">
        {inboxViews.map(folder => <button key={folder} type="button" className={view === folder ? "is-active" : ""} aria-pressed={view === folder} onClick={() => filter(folder)}>{label(folder)}</button>)}
      </div>
    </div>
    <Card title={view === "active" ? "Active tickets" : `${label(view)} tickets`} subtitle={view === "active" ? "Open, in progress, and waiting for a customer · 5 per page" : "Archived conversations · 5 per page"} action={<Icon name="ticket" size={17} />}>
      {list.loading ? <Loading /> : tickets.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Ticket</th><th>App</th><th>Status</th><th>Priority</th><th>Updated</th><th><span className="hub-sr-only">Open ticket</span></th></tr></thead><tbody>
        {tickets.map(ticket => <tr key={ticket.id}><td><span className="hub-row-title">{ticket.subject}</span><span className="hub-row-sub">{ticket.reference} · {ticket.email}</span></td><td><AppBadge slug={ticket.appSlug} apps={props.apps} /></td><td><Pill status={ticket.status} /></td><td><Pill status={ticket.priority} /></td><td className="hub-no-wrap">{date(ticket.updatedAt, true)}</td><td><button id={`ticket-open-${ticket.id}`} type="button" className="hub-table-action" onClick={() => setSelected(ticket.id)}>Open <span className="hub-sr-only">{ticket.reference}</span></button></td></tr>)}
      </tbody></table></div> : <Empty icon="ticket" title={search || (view === "active" && status !== "active") ? "No tickets match these filters" : `No ${view} tickets`} description={listNotes(list.data, props.preview, `${view} support tickets`)} />}
    </Card>
    {list.data ? <><Pagination offset={offset} limit={pageSize} total={list.data.total} loaded={tickets.length} disabled={list.loading} onPage={setOffset} /><p className="hub-inbox-count" aria-live="polite">{count(list.data.total)} {view} {list.data.total === 1 ? "ticket" : "tickets"}{search ? " matching your search" : ""}</p></> : null}
    <Notes notes={list.data?.notes} />
    <p className="hub-footer-note"><Icon name="lock" size={12} />Staff tools follow app access permissions. Customers see only their own public messages in the app.</p>
  </>;
}
