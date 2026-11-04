import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import { supportEmailSettings } from "../lib/integrations/email-config.ts";

const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
async function compile(relative, imports) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [specifier, value] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(value));
  return moduleUrl(code);
}
const empty = moduleUrl("");
const harnessKey = Symbol.for("geofox.support-inbox-test");
const state = { rows: [] };
globalThis[harnessKey] = state;
// A small in-memory data source lets the real ticket service exercise page and
// archive behavior without connecting to production or modifying customer data.
state.from = () => {
  const filters = [], orders = [], messageFilters = [], messageOrders = [];
  let select = "", messageLimit = Infinity;
  const orderRows = (rows, columns) => [...rows].sort((left, right) => {
    for (const { column, ascending } of columns) {
      const difference = String(left[column]).localeCompare(String(right[column]));
      if (difference) return ascending ? difference : -difference;
    }
    return 0;
  });
  return {
    select(columns) { select = columns; return this; },
    in(column, values) { filters.push(row => values.includes(row[column])); return this; },
    eq(column, value) {
      if (column.startsWith("recent_customer_messages.")) messageFilters.push(row => row[column.split(".")[1]] === value);
      else filters.push(row => row[column] === value);
      return this;
    },
    order(column, { ascending, referencedTable }) {
      (referencedTable === "recent_customer_messages" ? messageOrders : orders).push({ column, ascending });
      return this;
    },
    limit(limit, { referencedTable } = {}) {
      assert.equal(referencedTable, "recent_customer_messages");
      messageLimit = limit;
      return this;
    },
    async range(start, end) {
      const rows = orderRows(state.rows.filter(row => filters.every(filter => filter(row))), orders);
      const data = rows.slice(start, end + 1).map(row => ({ ...row,
        recent_customer_messages: select.includes("recent_customer_messages:")
          ? orderRows((row.messages || []).filter(message => messageFilters.every(filter => filter(message))), messageOrders)
            .slice(0, messageLimit).map(message => ({ id: message.id, created_at: message.created_at }))
          : undefined,
      }));
      return { data, count: rows.length, error: null };
    },
  };
};
const server = moduleUrl(`
  export class HubError extends Error { constructor(status, code, message) { super(message); this.name = "HubError"; this.status = status; this.code = code; } }
  export function assertCapability(context, capability) { if (!context.capabilities.includes(capability)) throw new HubError(403, "FORBIDDEN", "Forbidden"); }
  export function allowedAppSlugs(context, app) { return context.apps.filter(item => !app || app === "all" || item.slug === app).map(item => item.slug); }
  export function getHubService() { return globalThis[Symbol.for("geofox.support-inbox-test")]; }
  export async function getHubContext() { return globalThis[Symbol.for("geofox.support-inbox-test")].context; }
  export function databaseError(error) { throw error; }
`);
const emailConfig = new URL("../lib/integrations/email-config.ts", import.meta.url).href;
const dataModule = await compile("../lib/hub/data.ts", {
  "server-only": empty, "./server": server,
  "./redact": new URL("../lib/hub/redact.ts", import.meta.url).href,
  "./validation": new URL("../lib/hub/validation.ts", import.meta.url).href,
  "@/lib/customer/validation": new URL("../lib/customer/validation.ts", import.meta.url).href,
  "@/lib/integrations/email-config": emailConfig,
});
const { listTickets, getTicket, acknowledgeTicketReply } = await import(dataModule);
const { sendCustomerReply, replyEmailConfigured } = await import(await compile("../lib/integrations/email.ts", {
  "server-only": empty, "@/lib/hub/server": server, "./email-config": emailConfig,
}));
const { sendInAppSupportNotification } = await import(await compile("../lib/customer/notification.ts", {
  "server-only": empty, "@/lib/integrations/email-config": emailConfig,
}));
const customer = "10000000-0000-4000-8000-000000000001";
const context = { user: { id: "10000000-0000-4000-8000-000000000099" }, capabilities: ["tickets:read", "customers:read"], apps: [{ slug: "novanook", name: "NovaNook" }] };
const row = (index, status, app = "novanook") => ({
  id: "20000000-0000-4000-8000-" + String(index).padStart(12, "0"), reference: "GFX-" + index,
  app_slug: app, subject: "Help " + index, status, priority: "normal", category: "general", email: "customer@example.test",
  customer_id: customer, customer_owner_id: customer, identity_verified: true, source: "app",
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-11-03T12:00:00Z", assignee_id: null,
});
state.rows = [row(1, "open"), row(2, "in_progress"), row(3, "waiting_customer"), row(4, "open"), row(5, "open"), row(6, "open"), row(7, "resolved"), row(8, "closed"), row(9, "open", "otherapp")];

test("active inbox has five stable tickets per page and accurate totals without archived or unauthorized apps", async () => {
  const first = await listTickets(context);
  const next = await listTickets(context, "all", { status: "active", offset: 5, limit: 5 });
  assert.equal(first.total, 6);
  assert.equal(next.total, 6);
  assert.equal(first.items.length, 5);
  assert.equal(next.items.length, 1);
  assert.deepEqual([...first.items, ...next.items].map(ticket => ticket.id), [6, 5, 4, 3, 2, 1].map(index => row(index, "open").id));
  assert.ok([...first.items, ...next.items].every(ticket => ["open", "in_progress", "waiting_customer"].includes(ticket.status)));
});

test("archive tabs and full customer history retain exact server-side totals", async () => {
  for (const status of ["resolved", "closed"]) {
    const result = await listTickets(context, "novanook", { status, limit: 5 });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].status, status);
  }
  const history = await listTickets(context, "novanook", { status: "all", customerId: customer, limit: 100 });
  assert.equal(history.total, 8);
  assert.equal(history.items.length, 8);
  assert.ok(history.items.some(ticket => ticket.status === "closed"));
  await assert.rejects(() => listTickets(context, "novanook", { status: "invalid" }), error => error.code === "INVALID_INPUT");
  await assert.rejects(() => listTickets({ ...context, capabilities: [] }), error => error.code === "FORBIDDEN");
});

test("customer follow-ups stay unread through staff posts, internal notes, and workflow edits until a seen receipt", async () => {
  const originalRows = state.rows;
  const message = (index, author, internal = false) => ({
    id: "30000000-0000-4000-8000-" + String(index).padStart(12, "0"), author_kind: author, internal,
    created_at: `2026-11-03T12:00:00.${String(index).padStart(6, "0")}Z`,
  });
  try {
    const ticket = { ...row(1, "open"), messages: [message(1, "customer")] };
    state.rows = [ticket];
    const current = async () => (await listTickets(context)).items[0];
    assert.equal((await current()).customerReplyPending, false, "the opening message is a new request, not a reply");
    ticket.messages.push(message(2, "staff"), message(3, "customer"));
    assert.equal((await current()).customerReplyPending, true);
    assert.equal((await current()).customerReplyAt, message(3, "customer").created_at);
    ticket.messages.push(message(4, "staff", true), message(5, "staff", true), message(6, "staff", true));
    ticket.priority = "urgent";
    ticket.status = "in_progress";
    ticket.updated_at = "2026-11-03T13:00:00Z";
    assert.equal((await current()).customerReplyPending, true, "private notes and metadata do not mark a reply as viewed");
    assert.equal((await current()).customerReplyAt, message(3, "customer").created_at);
    ticket.messages.push(message(7, "staff"));
    assert.equal((await current()).customerReplyPending, true, "a staff post is not a read receipt and cannot bury the customer message");
    ticket.staff_read = { customer_message_id: message(3, "customer").id, customer_message_created_at: message(3, "customer").created_at };
    assert.equal((await current()).customerReplyPending, false);
    assert.equal((await current()).customerReplyAt, null);
    ticket.messages.push(message(8, "customer"));
    assert.equal((await current()).customerReplyPending, true, "a new reply beyond the read cursor marks the ticket again");
    for (const status of ["resolved", "closed"]) {
      ticket.status = status;
      const archived = (await listTickets(context, "novanook", { status })).items[0];
      assert.equal(archived.customerReplyPending, true, "workflow/archive decisions remain separate from whether staff saw the reply");
      assert.equal(archived.customerReplyAt, message(8, "customer").created_at);
    }
    ticket.status = "open";
    assert.equal((await current()).customerReplyPending, true);
    ticket.staff_read = null;
    ticket.messages = [message(1, "customer"), message(2, "customer")];
    assert.equal((await current()).customerReplyPending, true, "a follow-up before the first staff answer is still a reply");
    ticket.identity_verified = false;
    assert.equal((await current()).customerReplyPending, false);
    ticket.identity_verified = true; ticket.source = "web";
    assert.equal((await current()).customerReplyPending, false, "email/public-form traffic does not impersonate app replies");
  } finally { state.rows = originalRows; }
});

test("read cursor comparison preserves microseconds, timezone offsets, UUID ties, and advanced cursors over stale metadata", async () => {
  const previous = state.rows;
  const id = index => "30000000-0000-4000-8000-" + String(index).padStart(12, "0");
  const at = "2026-11-03T12:00:00.123456Z";
  const ticket = { ...row(1, "open"), messages: [
    { id: id(1), author_kind: "customer", internal: false, created_at: "2026-11-03T12:00:00.000001Z" },
    { id: id(3), author_kind: "customer", internal: false, created_at: at },
  ] };
  const current = async () => (await listTickets(context)).items[0].customerReplyPending;
  try {
    state.rows = [ticket];
    ticket.staff_read = { customer_message_id: id(9), customer_message_created_at: "2026-11-03T12:00:00.123455Z" };
    assert.equal(await current(), true, "one microsecond later stays unread even with a smaller UUID");
    ticket.staff_read.customer_message_created_at = "2026-11-03T12:00:00.123457Z";
    assert.equal(await current(), false, "a cursor ahead of stale message metadata already covers it");
    ticket.staff_read = { customer_message_id: id(2), customer_message_created_at: at };
    assert.equal(await current(), true, "same-microsecond higher UUID is later");
    ticket.staff_read.customer_message_id = id(3);
    assert.equal(await current(), false);
    ticket.staff_read.customer_message_id = id(4);
    assert.equal(await current(), false, "same-microsecond advanced UUID also covers older metadata");
    ticket.staff_read = { customer_message_id: id(3), customer_message_created_at: "2026-11-03T14:00:00.123456+02:00" };
    assert.equal(await current(), false, "equivalent offset timestamps compare as the same instant");
    ticket.staff_read = [{ customer_message_id: id(3), customer_message_created_at: at }];
    assert.equal(await current(), false, "relation shape normalization preserves read state");
  } finally { state.rows = previous; }
});

test("real PostgREST queries bound customer metadata and expose acknowledgement targets only from the returned message page", async () => {
  const newest = "2026-11-03T12:00:00.000003Z";
  const newestId = "30000000-0000-4000-8000-000000000003";
  const ticket = { ...row(1, "open"), recent_customer_messages: [
    { id: newestId, created_at: newest },
    { id: "30000000-0000-4000-8000-000000000001", created_at: "2026-11-03T12:00:00.000001Z" },
  ], staff_read: null };
  const oldFrom = state.from, oldRpc = state.rpc;
  const requests = [];
  const cursor = { createdAt: "2026-11-03T12:00:00.000001Z", id: "30000000-0000-4000-8000-000000000001" };
  const client = createClient("https://geofox-fixture.example.test", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      requests.push(url);
      if (url.pathname === "/rest/v1/hub_tickets") {
        assert.match(url.searchParams.get("select"), /recent_customer_messages:hub_ticket_messages\(id,created_at\)/);
        assert.match(url.searchParams.get("select"), /staff_read:hub_ticket_staff_reads\(customer_message_id,customer_message_created_at\)/);
        assert.equal(url.searchParams.get("recent_customer_messages.internal"), "eq.false");
        assert.equal(url.searchParams.get("recent_customer_messages.author_kind"), "eq.customer");
        assert.equal(url.searchParams.get("recent_customer_messages.order"), "created_at.desc,id.desc");
        assert.equal(url.searchParams.get("recent_customer_messages.limit"), "2");
        assert.equal(url.searchParams.get("app_slug"), "in.(novanook)");
        return new Response(JSON.stringify([ticket]), { headers: { "Content-Type": "application/json", "Content-Range": "0-0/1" } });
      }
      if (url.pathname === "/rest/v1/hub_audit_log") return Response.json([]);
      assert.equal(url.pathname, "/rest/v1/rpc/hub_staff_ticket_messages");
      const params = JSON.parse(options.body);
      assert.equal(params.p_ticket, ticket.id);
      if (params.p_before_created) {
        assert.equal(params.p_before_created, cursor.createdAt);
        assert.equal(params.p_before_id, cursor.id);
        return Response.json({ messages: [{ id: "older", body: "An earlier staff answer", author_name: "Staff", internal: false, created_at: cursor.createdAt, delivery_status: "not_requested" }], nextCursor: null });
      }
      return Response.json({ messages: [{ id: newestId, body: "The displayed customer reply", author_name: "Customer", internal: false, created_at: newest, delivery_status: "not_requested" }], nextCursor: null });
    } },
  });
  try {
    state.from = client.from.bind(client);
    state.rpc = client.rpc.bind(client);
    const list = await listTickets(context);
    assert.equal(list.items[0].customerReplyPending, true);
    assert.equal(list.total, 1);
    const listRequest = requests[0];
    assert.equal(listRequest.searchParams.get("limit"), "5");
    assert.equal(listRequest.searchParams.get("offset"), "0");
    assert.equal(listRequest.searchParams.get("order"), "updated_at.desc,id.desc");
    assert.equal(listRequest.searchParams.get("status"), "in.(open,in_progress,waiting_customer)");
    const detail = await getTicket(context, ticket.id, { messagesBefore: Buffer.from(JSON.stringify(cursor)).toString("base64url") });
    assert.equal(detail.customerReplyPending, true);
    assert.equal(detail.customerReplyAt, newest);
    assert.equal(detail.customerReplyMessageId, null, "metadata alone never grants a target for an undisplayed message");
    assert.equal(detail.messages[0].body, "An earlier staff answer");
    assert.equal(requests.filter(url => url.pathname === "/rest/v1/hub_tickets").length, 2);
    assert.equal((await getTicket(context, ticket.id)).customerReplyMessageId, newestId);
    ticket.recent_customer_messages.unshift({ id: "30000000-0000-4000-8000-000000000004", created_at: "2026-11-03T12:00:00.000004Z" });
    ticket.recent_customer_messages.pop();
    const raced = await getTicket(context, ticket.id);
    assert.equal(raced.customerReplyPending, true);
    assert.equal(raced.customerReplyMessageId, null, "a newer metadata target cannot be acknowledged from an older returned thread snapshot");
  } finally {
    state.from = oldFrom;
    if (oldRpc === undefined) delete state.rpc; else state.rpc = oldRpc;
  }
});

test("read acknowledgement uses authenticated tickets:read access and POST only, with exact message IDs and same-origin protection", async () => {
  const blocked = moduleUrl(`
    const unexpected = () => { throw new Error("Unrelated dependency must not run during a read receipt"); };
    export const integrationInfo=unexpected,loadCustomer=unexpected,loadOperations=unexpected,loadOverview=unexpected,errorCollectionHealth=unexpected;
    export const moderateNova=unexpected,novaModeration=unexpected;
    export const replyEmailConfigured=unexpected,sendCustomerReply=unexpected,currentCustomerNotificationEmail=unexpected,sendInAppSupportNotification=unexpected;
    export const buildRepairBrief=unexpected;
  `);
  const http = await compile("../lib/security/http.ts", { "next/server": import.meta.resolve("next/server.js") });
  const route = await import(await compile("../app/api/admin/[...path]/route.ts", {
    "@/lib/hub/server": server, "@/lib/hub/data": dataModule,
    "@/lib/hub/validation": new URL("../lib/hub/validation.ts", import.meta.url).href,
    "@/lib/security/http": http,
    "@/lib/integrations/reporting": blocked, "@/lib/integrations/novanook": blocked,
    "@/lib/integrations/error-collection": blocked,
    "@/lib/integrations/email": blocked, "@/lib/customer/server": blocked,
    "@/lib/customer/notification": blocked, "@/lib/diagnostics/repair": blocked,
  }));
  const ticketId = row(1, "open").id, messageId = "30000000-0000-4000-8000-000000000003";
  const receipt = { ticketId, messageId, readThroughMessageId: messageId, readThroughCreatedAt: "2026-11-03T12:00:00.000003Z" };
  const oldRpc = state.rpc, oldContext = state.context, calls = [];
  state.context = { ...context, capabilities: ["tickets:read"] };
  state.rpc = async (name, params) => { calls.push({ name, params }); return { data: receipt, error: null }; };
  const url = `https://www.geofoxapps.com/api/admin/tickets/${ticketId}/read`;
  const params = { params: Promise.resolve({ path: ["tickets", ticketId, "read"] }) };
  const post = (payload, origin = "https://www.geofoxapps.com", method = "POST") => new Request(url, { method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  try {
    const result = await route.POST(post({ messageId, actor: "ignored-client-actor", status: "closed" }), params);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).data, receipt);
    assert.match(result.headers.get("cache-control"), /no-store/);
    assert.deepEqual(calls, [{ name: "hub_acknowledge_ticket_reply", params: { p_actor: context.user.id, p_ticket: ticketId, p_message: messageId } }]);
    assert.equal((await route.GET(new Request(url), params)).status, 404);
    assert.equal((await route.PATCH(post({ messageId }, "https://www.geofoxapps.com", "PATCH"), params)).status, 404);
    assert.equal((await route.POST(post({ messageId }, "https://unrelated.example.test"), params)).status, 403);
    for (const invalid of [undefined, "latest", "not-a-message-id"]) {
      assert.equal((await route.POST(post({ messageId: invalid }), params)).status, 400);
    }
    state.context = { ...context, capabilities: [] };
    assert.equal((await route.POST(post({ messageId }), params)).status, 403);
    assert.equal(calls.length, 1, "no rejected request or GET can write a receipt");
    await assert.rejects(() => acknowledgeTicketReply(context, "invalid-ticket", messageId), error => error.code === "INVALID_INPUT");
  } finally {
    if (oldRpc === undefined) delete state.rpc; else state.rpc = oldRpc;
    if (oldContext === undefined) delete state.context; else state.context = oldContext;
  }
});

test("outbound mail uses only the public support alias and brand even with stale personal environment settings", async () => {
  const originals = Object.fromEntries(["RESEND_API_KEY", "SUPPORT_FROM_EMAIL", "SUPPORT_REPLY_TO_EMAIL"].map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const sent = [];
  try {
    process.env.RESEND_API_KEY = "test-only-never-sent";
    process.env.SUPPORT_FROM_EMAIL = "Private Staff Name <support@notify.geofoxapps.com>";
    process.env.SUPPORT_REPLY_TO_EMAIL = "owner@geofoxapps.com";
    globalThis.fetch = async (url, options) => { assert.equal(url, "https://api.resend.com/emails"); sent.push(JSON.parse(options.body)); return Response.json({ id: "test-receipt" }); };
    const ticket = { id: "ticket", reference: "GFX-TEST", appSlug: "novanook", appName: "NovaNook", source: "app", identityVerified: true, customerOwnerId: customer, email: "customer@example.test", subject: "Private customer subject" };
    const message = { id: "message", internal: false, body: "Private conversation text" };
    assert.equal(replyEmailConfigured(), true);
    assert.equal(await sendCustomerReply(ticket, message), true);
    assert.equal(await sendInAppSupportNotification(ticket, message, "current@example.test"), true);
    assert.equal(sent.length, 2);
    for (const payload of sent) {
      assert.equal(payload.from, "Geofox Support <support@notify.geofoxapps.com>");
      assert.equal(payload.reply_to, "support@geofoxapps.com");
      assert.equal(JSON.stringify(payload).includes("owner@geofoxapps.com"), false);
      assert.equal(JSON.stringify(payload).includes("Private Staff Name"), false);
    }
    assert.deepEqual(sent[1].to, ["current@example.test"]);
    assert.equal(JSON.stringify(sent[1]).includes(ticket.subject), false);
    assert.equal(JSON.stringify(sent[1]).includes(message.body), false);
    process.env.SUPPORT_FROM_EMAIL = "owner@geofoxapps.com";
    assert.equal(replyEmailConfigured(), false);
    assert.equal(await sendCustomerReply(ticket, message), false);
    assert.equal(await sendInAppSupportNotification(ticket, message, "current@example.test"), false);
    assert.equal(sent.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("malformed or non-support From addresses cannot bypass the public identity", () => {
  for (const value of [undefined, "", "owner@geofoxapps.com", "support@other.test", "support@geofoxapps.com>", "<support@geofoxapps.com", "Geofox Support <support@geofoxapps.com>\r\nCc:other@example.test"]) {
    assert.equal(supportEmailSettings({ SUPPORT_FROM_EMAIL: value }), null);
  }
  assert.deepEqual(supportEmailSettings({ SUPPORT_FROM_EMAIL: "support@geofoxapps.com" }), { from: "Geofox Support <support@geofoxapps.com>", replyTo: "support@geofoxapps.com" });
});

test.after(() => { delete globalThis[harnessKey]; });
