"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ListResult, Ticket, TicketDetail, TicketMessage, TicketPriority, TicketStatus } from "@/lib/hub/types";
import { apiRequest, AppBadge, Card, count, date, Empty, ErrorBanner, label, listNotes, Loading, Notes, PageHeading, Pagination, type PanelProps, Pill, useHubData } from "./common";
import { Icon } from "./icons";

const statuses: TicketStatus[] = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const priorities: TicketPriority[] = ["low", "normal", "high", "urgent"];

function TicketConversation({ ticket: initialTicket, props, refresh, close }: { ticket: TicketDetail; props: PanelProps; refresh: () => void; close: () => void }) {
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
  async function refreshConversation() {
    if (props.preview || busy || refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    setBusy("refresh"); setError("");
    try {
      const latest = await apiRequest<TicketDetail>(`/api/admin/tickets/${encodeURIComponent(ticket.id)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const overlap = latest.messages.length ? messages.findIndex(message => message.id === latest.messages[0].id) : -1;
      const keepEarlier = Boolean(latest.nextMessagesCursor) && overlap >= 0;
      setMessages(keepEarlier ? [...messages.slice(0, overlap), ...latest.messages] : latest.messages);
      setOlderCursor(keepEarlier ? olderCursor : latest.nextMessagesCursor);
      setStatus(value => value === ticket.status ? latest.status : value);
      setPriority(value => value === ticket.priority ? latest.priority : value);
      setTicket(latest);
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
    try { await apiRequest(`/api/admin/tickets/${encodeURIComponent(ticket.id)}`, { method: "PATCH", body: JSON.stringify({ status, priority }) }); props.notify("Ticket details updated."); refresh(); }
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save your message. Keep this message unchanged and retry to avoid duplicates."); }
    finally { setBusy(""); }
  }
  return <section className="hub-card hub-detail" aria-label={`Ticket ${ticket.reference}`}>
    <header className="hub-detail-head"><div><AppBadge slug={ticket.appSlug} apps={props.apps} /><h2>{ticket.subject}</h2><p>{ticket.reference} · {ticket.email} · Created {date(ticket.createdAt)}</p>
      <div className="hub-detail-meta"><Pill status={ticket.status} /><Pill status={ticket.priority} /><span className="hub-row-sub">{label(ticket.category)}</span><Pill status={inApp ? "healthy" : "unknown"}>{inApp ? "Verified app account · replies in app" : "Email support · verify account claims"}</Pill>{ticket.customerId ? <span className="hub-row-sub hub-mono">Customer: {ticket.customerId}</span> : null}</div>
    </div><div className="hub-ticket-actions"><button type="button" className="hub-button secondary small" aria-label="Refresh conversation" title="Refresh conversation" aria-busy={busy === "refresh"} disabled={props.preview || Boolean(busy)} onClick={refreshConversation}><Icon name="refresh" size={14} className={busy === "refresh" ? "hub-spinning" : undefined} />{busy === "refresh" ? "Refreshing…" : "Refresh"}</button><button type="button" className="hub-icon-button" aria-label="Close ticket" onClick={close}><Icon name="close" size={17} /></button></div></header>
    <div className="hub-detail-body"><ErrorBanner error={error} />
      <div className="hub-inline-fields" style={{ marginBottom: 23 }}><div className="hub-field"><label htmlFor="ticket-status">Status</label><select id="ticket-status" value={status} disabled={!writable || Boolean(busy)} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><div className="hub-field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={priority} disabled={!writable || Boolean(busy)} onChange={(event) => setPriority(event.target.value as TicketPriority)}>{priorities.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><button type="button" className="hub-button secondary" disabled={!writable || Boolean(busy) || (status === ticket.status && priority === ticket.priority)} onClick={save}>{busy === "save" ? "Saving…" : "Save details"}</button></div>
      {inApp && ticket.status === "closed" ? <p className="hub-text-note">This request is closed to customer replies. Reopen it above to continue the conversation, or the customer can create a new request.</p> : null}
      {olderCursor ? <button type="button" className="hub-button secondary" disabled={Boolean(busy)} onClick={loadOlder}>{busy === "older" ? "Loading earlier messages…" : "Load earlier messages"}</button> : null}
      {messages.length ? messages.map((message) => <article key={message.id} className={`hub-message ${message.internal ? "internal" : ""}`}><div className="hub-message-head"><strong>{message.authorName} {message.internal ? "· Internal note" : inApp ? "· In-app conversation" : "· Email conversation"}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></div><p>{message.body}</p>{!message.internal ? <div className="hub-detail-meta"><Pill status={message.deliveryStatus}>{message.deliveryStatus === "not_requested" ? inApp ? "Available in NovaNook" : "Saved to ticket" : message.deliveryStatus === "sent" ? "Accepted by email provider" : message.deliveryStatus === "failed" ? "Sending not confirmed — check provider before retrying" : "Email pending"}</Pill></div> : null}</article>) : <Empty icon="ticket" title="No conversation messages returned" />}
      <form className="hub-reply" onSubmit={reply}><div className="hub-field"><label htmlFor="ticket-message">{internal ? "Add an internal note" : inApp ? "Reply in NovaNook" : "Write an email reply to the customer"}</label><textarea id="ticket-message" value={body} onChange={(event) => setBody(event.target.value)} placeholder={internal ? "Leave context for yourself or your team…" : "Write a clear, helpful reply…"} maxLength={12000} required disabled={!writable || Boolean(busy)} /><small>{internal ? "Internal notes stay in your staff workspace." : inApp ? "Your reply appears in the customer’s NovaNook conversation. It does not require email delivery." : `This reply is emailed to ${ticket.email}. Incoming email replies arrive in your support mailbox; they are not imported automatically.`}</small></div>
        {!internal && inApp ? <label className="hub-text-note"><input type="checkbox" checked={notifyEmail} onChange={event => setNotifyEmail(event.target.checked)} disabled={!writable || Boolean(busy)} /> Also send an email notification, if a verified sender and current confirmed customer address are available. The email contains no conversation text.</label> : null}
        <div className="hub-reply-actions"><div className="hub-radio-row" style={{ margin: 0 }}><label><input type="radio" name="message-kind" checked={internal} onChange={() => setInternal(true)} disabled={!writable || Boolean(busy)} />Internal note</label><label><input type="radio" name="message-kind" checked={!internal} onChange={() => setInternal(false)} disabled={!writable || Boolean(busy)} />Customer reply</label></div><button className="hub-button" type="submit" disabled={!writable || Boolean(busy) || !body.trim()}><Icon name={internal ? "lock" : "send"} size={14} />{busy === "reply" ? "Saving…" : internal ? "Save internal note" : inApp ? "Publish reply in NovaNook" : "Send email reply"}</button></div>{!writable ? <p className="hub-text-note">Your role can read this ticket. Replying and changing it require support permissions.</p> : null}</form>
      {ticket.audit.length ? <details className="hub-ticket-audit"><summary>Ticket activity</summary><div className="hub-timeline">{ticket.audit.map((event) => <div className="hub-timeline-item" key={event.id}><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.createdAt}>{date(event.createdAt)}</time></div>)}</div></details> : null}
    </div></section>;
}

export function TicketsPanel(props: PanelProps) {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const pageSize = 50;
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 350); return () => window.clearTimeout(timer); }, [query]);
  const list = useHubData<ListResult<Ticket>>(props.preview ? null : `/api/admin/tickets?app=${encodeURIComponent(props.app)}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(search)}&limit=${pageSize}&offset=${offset}`, props.refreshKey);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useHubData<TicketDetail>(!props.preview && selected ? `/api/admin/tickets/${encodeURIComponent(selected)}` : null, props.refreshKey);
  const tickets = list.data?.items || [];
  function refresh() { detail.reload(); list.reload(); }
  return <><PageHeading kicker="ONE INBOX, EVERY APP" title="A little help goes a long way." description="Keep every customer conversation in context, with a clear app label and a next step." /><ErrorBanner error={list.error || detail.error} /><div className="hub-controls"><div className="hub-field hub-filter-search"><label className="hub-sr-only" htmlFor="ticket-search">Search tickets</label><input id="ticket-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject, reference, or email" /></div><select className="hub-select" aria-label="Filter tickets by status" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select><span className="hub-text-note">{list.data ? `${count(tickets.length)} shown · ${count(list.data.total)} matching tickets` : "App scope follows your workspace selector"}</span></div><Card title="Support inbox" subtitle="Customer requests from your selected apps" action={<Icon name="ticket" size={17} />}>{list.loading ? <Loading /> : tickets.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Ticket</th><th>App</th><th>Status</th><th>Priority</th><th>Updated</th><th><span className="hub-sr-only">Open ticket</span></th></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}><td><span className="hub-row-title">{ticket.subject}</span><span className="hub-row-sub">{ticket.reference} · {ticket.email}</span></td><td><AppBadge slug={ticket.appSlug} apps={props.apps} /></td><td><Pill status={ticket.status} /></td><td><Pill status={ticket.priority} /></td><td className="hub-no-wrap">{date(ticket.updatedAt, true)}</td><td><button type="button" className="hub-table-action" onClick={() => setSelected(ticket.id)}>Open <span className="hub-sr-only">{ticket.reference}</span></button></td></tr>)}</tbody></table></div> : <Empty icon="ticket" title={query || status !== "all" ? "No tickets match these filters" : "Your support inbox starts here"} description={listNotes(list.data, props.preview, "support tickets")} />}</Card>{list.data ? <Pagination offset={offset} limit={pageSize} total={list.data.total} loaded={tickets.length} disabled={list.loading} onPage={setOffset} /> : null}<Notes notes={list.data?.notes} />{detail.loading ? <Loading label="Opening the ticket…" /> : detail.data ? <TicketConversation key={`${detail.data.id}-${detail.data.updatedAt}`} ticket={detail.data} props={props} refresh={refresh} close={() => setSelected(null)} /> : null}<p className="hub-footer-note"><Icon name="lock" size={12} />Staff tools follow app access permissions. Customers see only their own public messages in the app.</p></>;
}
