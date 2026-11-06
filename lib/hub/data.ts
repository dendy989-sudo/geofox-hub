import "server-only";

import { createHmac } from "node:crypto";
import type { ActivityItem, ErrorItem, ErrorState, ListResult, ReviewTask, StaffRole, Ticket, TicketDetail, TicketMessage, TicketPriority, TicketReadReceipt, TicketStatus } from "./types";
import { allowedAppSlugs, assertCapability, databaseError, getHubService, HubError, type HubContext } from "./server";
import { redactDiagnostic } from "./redact";
import { assignableRoles, boundedLimit, boundedOffset, cleanText, customerIdentifier, errorStates, isAppSlug, isUuid, reviewPeriod, ticketCategories, ticketPriorities, ticketStatuses } from "./validation";
import { decodeCustomerCursor, encodeCustomerCursor } from "@/lib/customer/validation";
import { supportEmailSettings } from "@/lib/integrations/email-config";

interface MessagePosition { id: string; created_at: string; }
interface StaffReadRow { customer_message_id: string; customer_message_created_at: string; }
interface TicketRow {
  id: string; reference: string; app_slug: string; subject: string; status: TicketStatus;
  priority: TicketPriority; category: string; email: string; customer_id: string | null;
  customer_owner_id: string | null; identity_verified: boolean; source: Ticket["source"];
  created_at: string; updated_at: string; assignee_id: string | null;
  recent_customer_messages?: MessagePosition[];
  staff_read?: StaffReadRow | StaffReadRow[] | null;
}
interface MessageRow {
  id: string; body: string; author_name: string; internal: boolean; created_at: string;
  delivery_status: TicketMessage["deliveryStatus"];
}
interface AuditRow {
  id: string; app_slug: string | null; action: string; summary: string; created_at: string;
}
interface ErrorRow {
  id: string; app_slug: string; severity: ErrorItem["severity"]; error_code: string | null;
  fingerprint: string; title: string; message: string; route: string | null; first_seen: string;
  last_seen: string; occurrence_count: number; status: ErrorState; customer_id: string | null;
  suggested_action: string; source: string; stack: string | null;
}

const ticketColumns = "id,reference,app_slug,subject,status,priority,category,email,customer_id,customer_owner_id,identity_verified,source,created_at,updated_at,assignee_id,recent_customer_messages:hub_ticket_messages(id,created_at),staff_read:hub_ticket_staff_reads(customer_message_id,customer_message_created_at)";
const messageColumns = "id,body,author_name,internal,created_at,delivery_status";
const auditColumns = "id,app_slug,action,summary,created_at";
const errorColumns = "id,app_slug,severity,error_code,fingerprint,title,message,route,first_seen,last_seen,occurrence_count,status,customer_id,suggested_action,source,stack";

function messagePositionOrder(left: MessagePosition, right: MessagePosition): number | null {
  // PostgreSQL cursors have microsecond precision; Date alone drops the last
  // three digits. UUID byte order resolves messages with identical timestamps.
  const timestamp = (value: string) => {
    const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
    const milliseconds = Date.parse(value);
    return match && Number.isFinite(milliseconds)
      ? { milliseconds, microseconds: Number((match[1] || "").padEnd(6, "0").slice(3)) } : null;
  };
  const a = timestamp(left.created_at), b = timestamp(right.created_at);
  if (!a || !b) return null;
  const timeOrder = a.milliseconds - b.milliseconds || a.microseconds - b.microseconds;
  if (timeOrder) return timeOrder;
  const leftId = left.id.toLowerCase(), rightId = right.id.toLowerCase();
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
function unreadCustomerReply(row: TicketRow): MessagePosition | null {
  // Two public customer messages distinguish a follow-up from the opening
  // request. Staff posts, internal notes and workflow changes are not receipts.
  const customerMessages = row.recent_customer_messages || [];
  if (row.source !== "app" || !row.identity_verified || !row.customer_owner_id || customerMessages.length < 2) return null;
  const latest = customerMessages[0];
  const read = Array.isArray(row.staff_read) ? row.staff_read[0] : row.staff_read;
  if (!read) return latest;
  const order = messagePositionOrder(latest, { id: read.customer_message_id, created_at: read.customer_message_created_at });
  // An advanced cursor also covers older metadata from an overlapping request.
  return order === null || order > 0 ? latest : null;
}
function mapTicket(context: HubContext, row: TicketRow): Ticket {
  const unread = unreadCustomerReply(row);
  return { id: row.id, reference: row.reference, appSlug: row.app_slug,
    appName: context.apps.find((app) => app.slug === row.app_slug)?.name || row.app_slug,
    subject: row.subject, status: row.status, priority: row.priority, category: row.category,
    email: row.email, customerId: row.customer_id, customerOwnerId: row.customer_owner_id,
    identityVerified: row.identity_verified, source: row.source, createdAt: row.created_at,
    updatedAt: row.updated_at, assigneeId: row.assignee_id,
    customerReplyPending: Boolean(unread), customerReplyAt: unread?.created_at || null };
}
function mapMessage(row: MessageRow): TicketMessage {
  return { id: row.id, body: row.body, authorName: row.author_name, internal: row.internal,
    createdAt: row.created_at, deliveryStatus: row.delivery_status };
}
function mapAudit(row: AuditRow): ActivityItem {
  return { id: row.id, appSlug: row.app_slug, title: row.action.replaceAll(".", " ").replaceAll("_", " "),
    detail: redactDiagnostic(row.summary, 500), createdAt: row.created_at, kind: row.action.split(".")[0] || "activity" };
}
function mapError(context: HubContext, row: ErrorRow): ErrorItem {
  return { id: row.id, appSlug: row.app_slug, severity: row.severity, errorCode: row.error_code,
    fingerprint: row.fingerprint, title: redactDiagnostic(row.title, 200), message: redactDiagnostic(row.message),
    route: row.route ? redactDiagnostic(row.route, 500) : null, firstSeen: row.first_seen, lastSeen: row.last_seen,
    count: Number(row.occurrence_count), status: row.status,
    customerId: context.capabilities.includes("customers:read") ? row.customer_id : null,
    suggestedAction: redactDiagnostic(row.suggested_action, 2000), source: row.source,
    stack: row.stack ? redactDiagnostic(row.stack, 8000) : null };
}
function requireId(value: string): void {
  if (!isUuid(value)) throw new HubError(400, "INVALID_INPUT", "Please use a valid record ID.");
}
function checkMember<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new HubError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return value as T;
}

export interface TicketFilters { status?: string; query?: string; customerId?: string; limit?: number; offset?: number; }
export async function listTickets(context: HubContext, appSlug: string | null = null, options: TicketFilters = {}): Promise<ListResult<Ticket>> {
  assertCapability(context, "tickets:read");
  const scope = allowedAppSlugs(context, appSlug);
  if (!scope.length) return { items: [], total: 0, notes: ["No apps are assigned to your staff account."] };
  let query = getHubService().from("hub_tickets").select(ticketColumns, { count: "exact" }).in("app_slug", scope)
    .eq("recent_customer_messages.internal", false).eq("recent_customer_messages.author_kind", "customer")
    .order("created_at", { referencedTable: "recent_customer_messages", ascending: false })
    .order("id", { referencedTable: "recent_customer_messages", ascending: false })
    .limit(2, { referencedTable: "recent_customer_messages" });
  const status = options.status || "active";
  if (status === "active") query = query.in("status", ["open", "in_progress", "waiting_customer"]);
  else if (status !== "all") query = query.eq("status", checkMember(status, ticketStatuses, "ticket status"));
  if (options.customerId) {
    const customerId = customerIdentifier(options.customerId);
    if (!customerId) throw new HubError(400, "INVALID_INPUT", "Enter a valid customer ID.");
    assertCapability(context, "customers:read");
    query = query.eq("customer_id", customerId);
  }
  if (options.query) {
    // PostgREST filter syntax is never accepted from a user-entered search.
    const search = cleanText(options.query, 100).replace(/[^\p{L}\p{N} @.+_-]/gu, "").replace(/[%_]/g, "");
    if (search) query = query.or(`subject.ilike.%${search}%,email.ilike.%${search}%,reference.ilike.%${search}%`);
  }
  const offset = boundedOffset(options.offset);
  const { data, error, count } = await query.order("updated_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + boundedLimit(options.limit, 5) - 1);
  if (error) databaseError(error, "The support queue could not be loaded.");
  return { items: (data || []).map((row) => mapTicket(context, row)), total: count || 0,
    notes: options.customerId ? ["Signed-in app tickets are linked to a verified account. Customer IDs supplied through the public form are unverified; check ownership before sharing private information or changing an account."] : [] };
}

export async function getTicket(context: HubContext, idOrReference: string, options: { messagesBefore?: string | null } = {}): Promise<TicketDetail> {
  assertCapability(context, "tickets:read");
  let cursor;
  try { cursor = decodeCustomerCursor(options.messagesBefore || null); }
  catch { throw new HubError(400, "INVALID_CURSOR", "Refresh the ticket and try loading the conversation again."); }
  const scope = allowedAppSlugs(context);
  const validReference = /^GFX-[A-F0-9]{12}$/.test(idOrReference);
  if (!isUuid(idOrReference) && !validReference) throw new HubError(400, "INVALID_INPUT", "Enter a valid ticket ID or reference.");
  const db = getHubService();
  const { data: ticket, error } = await db.from("hub_tickets").select(ticketColumns)
    .eq(validReference ? "reference" : "id", idOrReference).in("app_slug", scope.length ? scope : ["__no_access__"])
    .eq("recent_customer_messages.internal", false).eq("recent_customer_messages.author_kind", "customer")
    .order("created_at", { referencedTable: "recent_customer_messages", ascending: false })
    .order("id", { referencedTable: "recent_customer_messages", ascending: false })
    .limit(2, { referencedTable: "recent_customer_messages" }).maybeSingle();
  if (error) databaseError(error);
  if (!ticket) throw new HubError(404, "NOT_FOUND", "This support request is unavailable or outside your app access.");
  assertCapability(context, "tickets:read", ticket.app_slug);
  const [messages, audit] = await Promise.all([
    db.rpc("hub_staff_ticket_messages", { p_actor: context.user.id, p_ticket: ticket.id, p_before_created: cursor?.createdAt || null, p_before_id: cursor?.id || null }),
    db.from("hub_audit_log").select(auditColumns).eq("entity_type", "ticket").eq("entity_id", ticket.id).eq("app_slug", ticket.app_slug).order("created_at", { ascending: false }).limit(30),
  ]);
  if (messages.error) databaseError(messages.error);
  if (audit.error) databaseError(audit.error);
  if (!messages.data) throw new HubError(503, "DATABASE_UNAVAILABLE", "The ticket conversation could not be loaded.");
  const visibleMessages: TicketMessage[] = (messages.data.messages || []).map(mapMessage);
  const unread = unreadCustomerReply(ticket);
  return { ...mapTicket(context, ticket), messages: visibleMessages,
    customerReplyMessageId: unread && visibleMessages.some(message => message.id === unread.id && !message.internal) ? unread.id : null,
    nextMessagesCursor: encodeCustomerCursor(messages.data.nextCursor), audit: (audit.data || []).map(mapAudit) };
}

export async function acknowledgeTicketReply(context: HubContext, ticketId: string, messageId: string): Promise<TicketReadReceipt> {
  assertCapability(context, "tickets:read");
  requireId(ticketId);
  requireId(messageId);
  // The RPC rechecks active staff/app access and advances only to this exact
  // public customer message, never to a newer reply that arrived meanwhile.
  const { data, error } = await getHubService().rpc("hub_acknowledge_ticket_reply", {
    p_actor: context.user.id, p_ticket: ticketId, p_message: messageId,
  });
  if (error) databaseError(error, "The read receipt could not be saved. Please refresh the conversation and try again.");
  if (!data) throw new HubError(503, "DATABASE_UNAVAILABLE", "The read receipt could not be saved.");
  return data as TicketReadReceipt;
}

export interface PublicTicketInput { appSlug: string; email: string; subject: string; body: string; category?: string; customerId?: string | null; }
export async function createTicket(input: PublicTicketInput, request: { ip: string }): Promise<{ id: string; reference: string; createdAt: string }> {
  if (!isAppSlug(input.appSlug)) throw new HubError(400, "INVALID_INPUT", "Choose the app this support request is about.");
  const email = cleanText(input.email, 255).toLowerCase();
  const subject = cleanText(input.subject, 181);
  const body = cleanText(input.body, 12001);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HubError(400, "INVALID_INPUT", "Enter a valid email address so support can respond.");
  if (subject.length < 3 || subject.length > 180 || body.length < 10 || body.length > 12000) throw new HubError(400, "INVALID_INPUT", "Use a subject of 3–180 characters and a message of 10–12,000 characters.");
  const category = checkMember(input.category || "general", ticketCategories, "support category");
  const customerId = customerIdentifier(input.customerId);
  if (input.customerId && !customerId) throw new HubError(400, "INVALID_INPUT", "Check the customer ID, or leave it blank.");
  // IP must be supplied by a trusted hosting header, not a JSON body. Never persist the raw IP.
  const address = cleanText(request.ip, 200);
  if (!address) throw new HubError(503, "RATE_LIMIT_UNAVAILABLE", "We could not verify this request. Please try again.");
  const salt = process.env.HUB_RATE_LIMIT_SALT || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) throw new HubError(503, "HUB_NOT_CONFIGURED", "The support form is waiting for its secure database connection.");
  const hash = (kind: string, value: string) => createHmac("sha256", salt).update(`support:${kind}:${value}`).digest("hex");
  const { data, error } = await getHubService().rpc("hub_create_public_ticket", {
    p_app: input.appSlug, p_email: email, p_subject: subject, p_body: body, p_category: category,
    p_customer_id: customerId, p_ip_key: hash("ip", address), p_email_key: hash("email", email),
  });
  if (error) databaseError(error, "We could not save your support request. Please try again.");
  if (!data?.id || !data?.reference) throw new HubError(503, "DATABASE_UNAVAILABLE", "We could not confirm your support request was saved.");
  return { id: data.id, reference: data.reference, createdAt: data.createdAt };
}

export async function updateTicket(context: HubContext, id: string, patch: { status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null }): Promise<TicketDetail> {
  assertCapability(context, "tickets:write"); requireId(id);
  if (patch.status !== undefined) checkMember(patch.status, ticketStatuses, "ticket status");
  if (patch.priority !== undefined) checkMember(patch.priority, ticketPriorities, "priority");
  if (patch.assigneeId !== undefined && patch.assigneeId !== null) requireId(patch.assigneeId);
  const { error } = await getHubService().rpc("hub_update_ticket", { p_actor: context.user.id, p_ticket: id,
    p_status: patch.status || null, p_priority: patch.priority || null, p_assignee: patch.assigneeId || null,
    p_set_assignee: patch.assigneeId !== undefined });
  if (error) databaseError(error);
  return getTicket(context, id);
}

export async function addTicketMessage(context: HubContext, id: string, input: { body: string; internal: boolean; deliveryStatus?: "not_requested" | "pending"; requestId: string; alfredActionId?: string }): Promise<TicketMessage> {
  assertCapability(context, "tickets:write"); requireId(id);
  if (typeof input.internal !== "boolean") throw new HubError(400, "INVALID_INPUT", "Choose an internal note or a customer reply.");
  requireId(input.requestId);
  const body = cleanText(input.body, 12001);
  if (!body || body.length > 12000) throw new HubError(400, "INVALID_INPUT", "Enter a message of 1–12,000 characters.");
  const deliveryStatus = checkMember(input.deliveryStatus || "not_requested", ["not_requested", "pending"], "delivery status");
  const db = getHubService();
  const { data: result, error } = await db.rpc(input.alfredActionId ? "hub_alfred_add_ticket_message_once" : "hub_add_ticket_message_once", { ...(input.alfredActionId ? { p_action: input.alfredActionId } : {}), p_actor: context.user.id, p_ticket: id,
    p_body: body, p_internal: input.internal, p_delivery_status: deliveryStatus, p_request: input.requestId });
  if (input.alfredActionId && error?.code === "40001") throw new HubError(409, "TICKET_CHANGED", "The conversation changed. Generate and review a new reply before sending.");
  if (error?.code === "P0101") throw new HubError(409, "IDEMPOTENCY_CONFLICT", "This retry has different content. Refresh the ticket before sending another message.");
  if (error) databaseError(error);
  if (!result?.id) throw new HubError(503, "DATABASE_UNAVAILABLE", "We could not confirm your message was saved. Keep the same message and try again.");
  const { data: message, error: readError } = await db.from("hub_ticket_messages").select(messageColumns).eq("id", result.id).eq("ticket_id", id).single();
  if (readError) databaseError(readError);
  return { ...mapMessage(message), replayed: result.replayed === true };
}

export interface ErrorFilters { status?: string; customerId?: string; ids?: string[]; limit?: number; offset?: number; }
export async function listErrors(context: HubContext, appSlug: string | null = null, options: ErrorFilters = {}): Promise<ListResult<ErrorItem>> {
  assertCapability(context, "errors:read");
  const scope = allowedAppSlugs(context, appSlug);
  if (options.ids !== undefined && (!Array.isArray(options.ids) || options.ids.length > 30 || options.ids.some((id) => !isUuid(id)))) {
    throw new HubError(400, "INVALID_INPUT", "Choose up to 30 valid recorded error IDs.");
  }
  const ids = options.ids?.map((id) => id.toLowerCase());
  if (ids && !ids.length) return { items: [], total: 0, notes: [] };
  if (!scope.length) return { items: [], total: 0, notes: ["No apps are assigned to your staff account."] };
  const db = getHubService();
  let query = db.from("hub_errors").select(errorColumns, { count: "exact" }).in("app_slug", scope);
  if (ids) query = query.in("id", [...new Set(ids)]);
  if (options.status && options.status !== "all") query = query.eq("status", checkMember(options.status, errorStates, "error status"));
  if (options.customerId) {
    assertCapability(context, "customers:read");
    const customerId = customerIdentifier(options.customerId);
    if (!customerId) throw new HubError(400, "INVALID_INPUT", "Enter a valid customer ID.");
    const { data, error } = await db.rpc("hub_customer_errors", { p_apps: scope, p_customer_id: customerId,
      p_status: options.status && options.status !== "all" ? options.status : null,
      p_limit: boundedLimit(options.limit), p_offset: boundedOffset(options.offset), p_ids: ids || null });
    if (error) databaseError(error);
    return { items: ((data?.items || []) as ErrorRow[]).map((row) => mapError(context, row)), total: data?.total || 0,
      notes: ["Counts and first/last occurrence times reflect this customer's received error reports. Group investigation status applies to the shared underlying issue.", "Only errors received after monitoring was connected are available."] };
  }
  const offset = boundedOffset(options.offset);
  const { data, error, count } = await query.order("last_seen", { ascending: false }).range(offset, offset + boundedLimit(options.limit) - 1);
  if (error) databaseError(error, "The error queue could not be loaded.");
  return { items: (data || []).map((row) => mapError(context, row)), total: count || 0,
    notes: ["Only received error reports are shown. An empty queue does not establish that the app is healthy."] };
}

export async function updateError(context: HubContext, id: string, input: { status: ErrorState }): Promise<void> {
  assertCapability(context, "errors:write"); requireId(id);
  const status = checkMember(input.status, errorStates, "error status");
  const { error } = await getHubService().rpc("hub_update_error", { p_actor: context.user.id, p_error: id, p_status: status });
  if (error) databaseError(error);
}

export async function listAudit(context: HubContext, appSlug: string | null = null, options: { limit?: number } = {}): Promise<ActivityItem[]> {
  assertCapability(context, "audit:read");
  const scope = allowedAppSlugs(context, appSlug);
  let query = getHubService().from("hub_audit_log").select(auditColumns);
  if (appSlug && appSlug !== "all") query = query.in("app_slug", scope);
  else if (context.staff.role !== "owner") query = query.in("app_slug", scope.length ? scope : ["__no_access__"]);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(boundedLimit(options.limit, 30));
  if (error) databaseError(error);
  return (data || []).map(mapAudit);
}

export interface AuditInput { appSlug?: string | null; action: string; entityType: string; entityId?: string | null; summary: string; metadata?: Record<string, unknown>; }
export async function recordAudit(context: HubContext, input: AuditInput): Promise<void> {
  if (input.appSlug) allowedAppSlugs(context, input.appSlug);
  else if (context.staff.role !== "owner") throw new HubError(403, "FORBIDDEN", "Global audit records require owner access.");
  if (!/^[a-z][a-z0-9_.-]{1,99}$/.test(input.action) || !/^[a-z][a-z0-9_-]{0,49}$/.test(input.entityType)) throw new HubError(400, "INVALID_INPUT", "The audit action is invalid.");
  const metadata: Record<string, string | number | boolean | null> = {};
  const permitted = new Set(["status", "priority", "count", "errorGroups", "provider", "role", "reference", "decision", "result"]);
  for (const [key, value] of Object.entries(input.metadata || {})) {
    if (!permitted.has(key)) continue;
    if (typeof value === "string") metadata[key] = redactDiagnostic(value, 160);
    else if (typeof value === "boolean" || value === null || (typeof value === "number" && Number.isFinite(value))) metadata[key] = value;
  }
  const { error } = await getHubService().from("hub_audit_log").insert({ actor_id: context.user.id, app_slug: input.appSlug || null,
    action: input.action, entity_type: input.entityType, entity_id: input.entityId ? cleanText(input.entityId, 128) : null,
    summary: redactDiagnostic(input.summary, 500), metadata });
  if (error) databaseError(error, "The action could not be recorded in the audit log.");
}

const reviewTemplates: Omit<ReviewTask, "completedAt" | "completedBy">[] = [
  { id: "service-health", label: "Review service health", description: "Check current availability, failed deployments, and provider incidents for each app.", cadence: "daily" },
  { id: "support-queue", label: "Triage support and safety requests", description: "Review new tickets, urgent customer issues, and unresolved moderation reports.", cadence: "daily" },
  { id: "error-queue", label: "Review new and recurring errors", description: "Investigate failures that affect sign-in, payments, searches, and customer data.", cadence: "daily" },
  { id: "usage-billing", label: "Check usage and billing", description: "Review ISBN provider limits, verified payment events, and unusual changes in usage.", cadence: "daily" },
  { id: "backups-restore", label: "Review backups and recovery", description: "Confirm the actual Supabase backup policy and recovery options in the provider project.", cadence: "weekly" },
  { id: "staff-access", label: "Review staff access", description: "Check active staff, app assignments, and two-step verification. Remove access that is no longer needed.", cadence: "weekly" },
  { id: "release-costs", label: "Review releases and operating costs", description: "Check Vercel and Supabase billing, app store notices, and upcoming releases.", cadence: "weekly" },
];

export async function listReviewTasks(context: HubContext, appSlug: string | null = null): Promise<ReviewTask[]> {
  assertCapability(context, "operations:read");
  const scope = allowedAppSlugs(context, appSlug);
  if (!scope.length) return reviewTemplates.map((task) => ({ ...task, completedAt: null, completedBy: null }));
  const { data, error } = await getHubService().from("hub_review_checks").select("app_slug,task_key,period_key,completed_at,completed_by")
    .in("app_slug", scope).in("period_key", [reviewPeriod("daily"), reviewPeriod("weekly")]);
  if (error) databaseError(error);
  return reviewTemplates.map((task) => {
    const rows = (data || []).filter((row) => row.task_key === task.id && row.period_key === reviewPeriod(task.cadence) && row.completed_at);
    const complete = scope.every((slug) => rows.some((row) => row.app_slug === slug));
    const last = complete ? rows.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] : null;
    return { ...task, completedAt: last?.completed_at || null, completedBy: last?.completed_by || null };
  });
}

export async function completeReview(context: HubContext, appSlug: string | null, taskId: string, completed: boolean): Promise<ReviewTask[]> {
  assertCapability(context, "operations:read");
  if (context.staff.role === "analyst") throw new HubError(403, "FORBIDDEN", "Analyst accounts have read-only access to operations reviews.");
  const task = reviewTemplates.find((item) => item.id === taskId);
  if (!task || typeof completed !== "boolean") throw new HubError(400, "INVALID_INPUT", "Choose a valid operations review.");
  const scope = allowedAppSlugs(context, appSlug);
  if (!scope.length) throw new HubError(403, "APP_ACCESS_REQUIRED", "No apps are assigned to this account.");
  const { error } = await getHubService().rpc("hub_complete_reviews", { p_actor: context.user.id, p_apps: scope,
    p_task: task.id, p_period: reviewPeriod(task.cadence), p_completed: completed });
  if (error) databaseError(error);
  return listReviewTasks(context, appSlug);
}

export interface StaffMember { id: string; email: string | null; displayName: string; role: StaffRole; active: boolean; appSlugs: string[]; createdAt: string; }
export async function listStaff(context: HubContext): Promise<StaffMember[]> {
  assertCapability(context, "staff:write");
  const db = getHubService();
  const [staff, grants] = await Promise.all([
    db.from("hub_staff").select("user_id,display_name,role,active,created_at").order("created_at").limit(100),
    db.from("hub_staff_apps").select("user_id,app_slug"),
  ]);
  if (staff.error) databaseError(staff.error);
  if (grants.error) databaseError(grants.error);
  const members = staff.data || [];
  const emails = new Map<string, string | null>();
  for (let index = 0; index < members.length; index += 10) {
    const resolved = await Promise.all(members.slice(index, index + 10).map(async (row) => {
      const result = await db.auth.admin.getUserById(row.user_id);
      return [row.user_id, result.data.user?.email || null] as const;
    }));
    resolved.forEach(([id, email]) => emails.set(id, email));
  }
  return members.map((row) => ({ id: row.user_id, email: emails.get(row.user_id) || null, displayName: row.display_name, role: row.role, active: row.active,
    appSlugs: row.role === "owner" ? context.apps.map((app) => app.slug) : (grants.data || []).filter((grant) => grant.user_id === row.user_id).map((grant) => grant.app_slug), createdAt: row.created_at }));
}

export async function saveStaff(context: HubContext, input: { userId: string; displayName: string; role: Exclude<StaffRole, "owner">; active: boolean; appSlugs: string[] }): Promise<StaffMember[]> {
  assertCapability(context, "staff:write"); requireId(input.userId);
  const role = checkMember(input.role, assignableRoles, "staff role");
  const displayName = cleanText(input.displayName, 101);
  if (!displayName || displayName.length > 100 || typeof input.active !== "boolean" || !Array.isArray(input.appSlugs)) throw new HubError(400, "INVALID_INPUT", "Check the staff name, role, and app access.");
  const apps = [...new Set(input.appSlugs)];
  if (!apps.length || apps.length > 100 || apps.some((slug) => !isAppSlug(slug))) throw new HubError(400, "INVALID_INPUT", "Assign at least one valid app to this staff member.");
  apps.forEach((slug) => allowedAppSlugs(context, slug));
  const { error } = await getHubService().rpc("hub_save_staff", { p_actor: context.user.id, p_user: input.userId,
    p_name: displayName, p_role: role, p_active: input.active, p_apps: apps });
  if (error) databaseError(error, "Staff access could not be updated. Confirm this user has been invited to the Geofox Supabase project.");
  return listStaff(context);
}

export async function getSettings(context: HubContext) {
  assertCapability(context, "settings:write");
  return { apps: context.apps, staff: await listStaff(context), mfaRequired: process.env.HUB_REQUIRE_MFA === "true",
    emailDeliveryConfigured: Boolean(process.env.RESEND_API_KEY && supportEmailSettings()),
    monitoringConfigured: context.apps.map((app) => ({ appSlug: app.slug, connected: app.configured,
      ingestionConfigured: Boolean(process.env[`${app.slug.replaceAll("-", "_").toUpperCase()}_HUB_INGEST_SECRET`]) })),
    checklistTimezone: "UTC", notes: ["Owner access is provisioned explicitly in the Geofox project's SQL Editor.", "App secrets are configured in Vercel environment variables and are never exposed in this page."] };
}

export async function saveApp(context: HubContext, input: { slug: string; name: string; website: string; color: string }): Promise<void> {
  assertCapability(context, "settings:write");
  if (!isAppSlug(input.slug)) throw new HubError(400, "INVALID_INPUT", "Use an app ID with 2–48 lowercase letters, numbers, or hyphens. The ID ‘all’ is reserved.");
  const name = cleanText(input.name, 101);
  if (!name || name.length > 100 || !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new HubError(400, "INVALID_INPUT", "Enter the app name and a valid color.");
  let website: string;
  try {
    const url = new URL(input.website);
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 500) throw new Error("Invalid website");
    website = url.toString();
  } catch { throw new HubError(400, "INVALID_INPUT", "Enter a complete HTTPS website address."); }
  const { error } = await getHubService().rpc("hub_save_app", { p_actor: context.user.id, p_slug: input.slug,
    p_name: name, p_website: website, p_color: input.color });
  if (error) databaseError(error);
}

/** Called only by the trusted server after the mail provider returns a result. */
export async function setTicketDelivery(context: HubContext, ticketId: string, messageId: string, status: "sent" | "failed"): Promise<void> {
  assertCapability(context, "tickets:write"); requireId(ticketId); requireId(messageId);
  checkMember(status, ["sent", "failed"], "delivery status");
  const { error } = await getHubService().rpc("hub_set_ticket_delivery", { p_actor: context.user.id, p_ticket: ticketId, p_message: messageId, p_status: status });
  if (error) databaseError(error, "The reply delivery result could not be saved. Check the provider before retrying to avoid duplicate mail.");
}

