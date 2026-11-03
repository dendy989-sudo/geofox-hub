import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const filters = [], orders = [];
  return {
    select() { return this; },
    in(column, values) { filters.push(row => values.includes(row[column])); return this; },
    eq(column, value) { filters.push(row => row[column] === value); return this; },
    order(column, { ascending }) { orders.push({ column, ascending }); return this; },
    async range(start, end) {
      const rows = state.rows.filter(row => filters.every(filter => filter(row))).sort((left, right) => {
        for (const { column, ascending } of orders) {
          const difference = String(left[column]).localeCompare(String(right[column]));
          if (difference) return ascending ? difference : -difference;
        }
        return 0;
      });
      return { data: rows.slice(start, end + 1), count: rows.length, error: null };
    },
  };
};
const server = moduleUrl(`
  export class HubError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  export function assertCapability(context, capability) { if (!context.capabilities.includes(capability)) throw new HubError(403, "FORBIDDEN", "Forbidden"); }
  export function allowedAppSlugs(context, app) { return context.apps.filter(item => !app || app === "all" || item.slug === app).map(item => item.slug); }
  export function getHubService() { return globalThis[Symbol.for("geofox.support-inbox-test")]; }
  export function databaseError(error) { throw error; }
`);
const emailConfig = new URL("../lib/integrations/email-config.ts", import.meta.url).href;
const { listTickets } = await import(await compile("../lib/hub/data.ts", {
  "server-only": empty, "./server": server,
  "./redact": new URL("../lib/hub/redact.ts", import.meta.url).href,
  "./validation": new URL("../lib/hub/validation.ts", import.meta.url).href,
  "@/lib/customer/validation": new URL("../lib/customer/validation.ts", import.meta.url).href,
  "@/lib/integrations/email-config": emailConfig,
}));
const { sendCustomerReply, replyEmailConfigured } = await import(await compile("../lib/integrations/email.ts", {
  "server-only": empty, "@/lib/hub/server": server, "./email-config": emailConfig,
}));
const { sendInAppSupportNotification } = await import(await compile("../lib/customer/notification.ts", {
  "server-only": empty, "@/lib/integrations/email-config": emailConfig,
}));
const customer = "10000000-0000-4000-8000-000000000001";
const context = { capabilities: ["tickets:read", "customers:read"], apps: [{ slug: "novanook", name: "NovaNook" }] };
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
