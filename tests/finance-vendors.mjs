import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVendorUrl, vendorForEntry, vendorSummary, vendorWebsiteUrl } from "../lib/finance/vendors.ts";

const created = "2026-11-01T12:00:00Z";

function vendor(id, overrides = {}) {
  return { id, user_id: "owner", name: id, url: "https://vendor.example/", notes: "", archived_at: null, created_at: created, updated_at: created, ...overrides };
}

function entry(id, overrides = {}) {
  return {
    id, user_id: "owner", kind: "bill", title: id, category: "Home", expense_type: "bill", amount_cents: 10000,
    original_amount_cents: overrides.amount_cents ?? 10000, original_due_date: "2026-11-10", scheduled_date: "2026-11-10",
    status: "active", archived_at: null, series_id: null, plan_id: null, vendor_id: "vendor", notes: "",
    created_at: created, updated_at: created, ...overrides,
  };
}

function payment(id, entryId, amount, paidOn, overrides = {}) {
  return { id, user_id: "owner", entry_id: entryId, amount_cents: amount, paid_on: paidOn, note: "", reversed_at: null, created_at: created, ...overrides };
}

function data(overrides = {}) {
  return { user: { id: "owner", display_name: "Owner" }, today: "2026-11-15", entries: [], payments: [], series: [], plans: [], debts: [], debt_history: [], spending: [], months: [], vendors: [vendor("vendor")], ...overrides };
}

test("vendor websites normalize ordinary addresses, ports, IDNs, and null values", () => {
  for (const blank of [undefined, null, "", "   ", "\t \r\n"]) assert.equal(normalizeVendorUrl(blank), null);
  assert.equal(normalizeVendorUrl(" Example.COM/pay?invoice=12#receipt "), "https://example.com/pay?invoice=12#receipt");
  assert.equal(normalizeVendorUrl("HTTPS://EXAMPLE.COM:443"), "https://example.com/");
  assert.equal(normalizeVendorUrl("http://example.com:80/pay"), "http://example.com/pay");
  assert.equal(normalizeVendorUrl("billing.example.com:8443/pay"), "https://billing.example.com:8443/pay");
  assert.equal(normalizeVendorUrl("https://bücher.example/Über"), "https://xn--bcher-kva.example/%C3%9Cber");
  assert.equal(normalizeVendorUrl("https://[2001:db8::1]:443/pay"), "https://[2001:db8::1]/pay");
  assert.equal(normalizeVendorUrl("http://127.0.0.1:8080/pay"), "http://127.0.0.1:8080/pay");
  assert.equal(normalizeVendorUrl("https://example.com./pay"), "https://example.com./pay");
});

test("vendor websites reject script schemes, credentials, ambiguous relative URLs, and malformed schemes", () => {
  const unsafe = [
    "javascript:alert(1)", "JAVASCRIPT://vendor.example/%0aalert(1)", "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://vendor.example", "mailto:billing@example.com", "blob:https://example.com/id",
    "//evil.example/pay", "///evil.example", "/payments", "?next=https://example.com", "#payment",
    "https:example.com", "https:/example.com", "https:///example.com", "https:////example.com",
    "https://user:password@example.com/pay", "https://user@example.com", "https://@example.com",
    "https://user%40example.com@evil.example", "https://example.com\\@evil.example", "https:\\example.com",
  ];
  for (const value of unsafe) {
    assert.throws(() => normalizeVendorUrl(value), (error) => error instanceof Error && error.message.length > 10, value);
    assert.equal(vendorWebsiteUrl(value), null, value);
  }
});

test("vendor URL controls and raw whitespace cannot be hidden in a safe-looking website", () => {
  for (const value of [
    "java\nscript:alert(1)", "\thttps://example.com", "https://example.com\n", "https://exa\tmple.com",
    "https://example.com/my bill", "https://example.com/\u0000", "https://example.com/\u007f", "https://example.com/\u0085",
    "https://example.com/\u2028", "https://example.com/\u2029", "https://example.com/with\u00a0space",
  ]) assert.throws(() => normalizeVendorUrl(value), Error, JSON.stringify(value));
  assert.equal(normalizeVendorUrl("https://example.com/my%20bill"), "https://example.com/my%20bill");
  assert.equal(normalizeVendorUrl("https://example.com/pay?note=javascript%3Aalert(1)"), "https://example.com/pay?note=javascript%3Aalert(1)");
});

test("vendor URLs reject invalid hosts, wrong value types, and overlong input or normalized output", () => {
  for (const value of [
    1, false, {}, [], "https://", "https://-vendor.example", "https://vendor-.example", "https://vendor..example",
    "https://.vendor.example", "https://vendor_example.com", "https://vendor.example..", "https://example.com:65536",
    "https://[not-an-ip]", `https://${"a".repeat(64)}.example`, `https://${Array(4).fill("a".repeat(63)).join(".")}`,
  ]) assert.throws(() => normalizeVendorUrl(value), Error);
  const prefix = "https://example.com/";
  const maximum = prefix + "a".repeat(2048 - prefix.length);
  assert.equal(normalizeVendorUrl(maximum), maximum);
  assert.throws(() => normalizeVendorUrl(`${maximum}a`), /2,048/);
  assert.throws(() => normalizeVendorUrl(prefix + "é".repeat(700)), /2,048/, "URL encoding cannot exceed the stored limit");
});

test("rendering helper fails closed for invalid stored URLs and normalizes safe legacy values", () => {
  assert.equal(vendorWebsiteUrl(null), null);
  assert.equal(vendorWebsiteUrl(undefined), null);
  assert.equal(vendorWebsiteUrl(""), null);
  assert.equal(vendorWebsiteUrl("billing.example.com/pay"), "https://billing.example.com/pay");
  assert.equal(vendorWebsiteUrl("javascript:alert(document.cookie)"), null);
  assert.equal(vendorWebsiteUrl("https://user:secret@billing.example.com"), null);
  assert.equal(vendorWebsiteUrl("https://billing.example.com"), "https://billing.example.com/");
});

test("vendor selection honors direct links, ownership, explicit detachment, and archived vendors", () => {
  const archived = vendor("archived", { archived_at: created });
  const fixture = data({
    vendors: [vendor("vendor", { user_id: "other-owner" }), vendor("vendor"), archived, vendor("foreign", { user_id: "other-owner" })],
    plans: [{ id: "plan", user_id: "owner", vendor_id: "vendor" }],
    series: [{ id: "series", user_id: "owner", vendor_id: "vendor" }],
  });
  assert.equal(vendorForEntry(fixture, entry("bill")).user_id, "owner");
  assert.equal(vendorForEntry(fixture, entry("archived-bill", { vendor_id: archived.id })), archived);
  assert.equal(vendorForEntry(fixture, entry("foreign-record", { user_id: "other-owner" })), undefined);
  assert.equal(vendorForEntry(fixture, entry("foreign-vendor", { vendor_id: "foreign" })), undefined);
  assert.equal(vendorForEntry(fixture, entry("missing-vendor", { vendor_id: "missing" })), undefined);
  assert.equal(vendorForEntry(fixture, entry("detached", { vendor_id: null, plan_id: "plan", series_id: "series" })), undefined);
  assert.equal(vendorForEntry(fixture, entry("legacy", { vendor_id: undefined, plan_id: "plan" })), undefined);
});

test("vendor totals retain cancelled, archived, and collections payment history without counting their stopped forecasts", () => {
  const fixture = data({
    entries: [
      entry("active", { scheduled_date: "2026-12-01" }),
      entry("cancelled", { amount_cents: 5000, status: "cancelled" }),
      entry("collections", { amount_cents: 9000, status: "collections" }),
      entry("archived-active", { amount_cents: 4000, original_due_date: "2026-11-20", archived_at: created }),
      entry("archived-paid", { amount_cents: 1500, archived_at: created }),
      entry("income", { kind: "income", amount_cents: 20000 }),
      entry("other-vendor", { vendor_id: "other" }),
    ],
    payments: [
      payment("earlier", "active", 1000, "2026-10-25"), payment("partial", "active", 2000, "2026-11-02"),
      payment("reversed", "active", 1500, "2026-11-03", { reversed_at: created }),
      payment("cancelled-paid", "cancelled", 2000, "2026-11-04"), payment("collections-paid", "collections", 1000, "2026-11-05"),
      payment("archived-partial", "archived-active", 500, "2026-11-06"), payment("archived-full", "archived-paid", 1500, "2026-11-07"),
      payment("receipt", "income", 10000, "2026-11-08"), payment("different-vendor", "other-vendor", 5000, "2026-11-09"),
    ],
  });
  const before = structuredClone(fixture);
  const summary = vendorSummary(fixture, "vendor", fixture.today, "2026-11");
  assert.equal(summary.entry_count, 6);
  assert.equal(summary.paid_cents, 8000);
  assert.equal(summary.month_paid_cents, 7000);
  assert.equal(summary.received_cents, 10000);
  assert.equal(summary.month_received_cents, 10000);
  assert.equal(summary.outstanding_cents, 10500);
  assert.equal(summary.past_due_cents, 7000, "Moving an overdue bill does not clear its original due date");
  assert.equal(summary.history.length, 8);
  assert.equal(summary.history[0].payment.id, "receipt");
  assert.equal(summary.history.at(-1).payment.id, "earlier");
  assert.ok(summary.history.find((row) => row.payment.id === "reversed").payment.reversed_at);
  assert.equal(summary.history.find((row) => row.payment.id === "collections-paid").entry.status, "collections");
  assert.deepEqual(fixture, before, "Summaries do not mutate source arrays or records");
});

test("vendor monthly totals follow actual payment dates rather than original or moved due months", () => {
  const fixture = data({
    entries: [entry("bill", { original_due_date: "2026-01-31", scheduled_date: "2026-03-01" }), entry("receipt", { kind: "income", original_due_date: "2026-03-01", scheduled_date: "2026-03-01" })],
    payments: [payment("paid", "bill", 2500, "2026-02-28"), payment("received", "receipt", 6000, "2026-02-28")],
  });
  const february = vendorSummary(fixture, "vendor", "2026-03-02", "2026-02");
  assert.equal(february.paid_cents, 2500);
  assert.equal(february.month_paid_cents, 2500);
  assert.equal(february.month_received_cents, 6000);
  assert.equal(february.outstanding_cents, 7500);
  const march = vendorSummary(fixture, "vendor", "2026-03-02", "2026-03");
  assert.equal(march.paid_cents, 2500);
  assert.equal(march.month_paid_cents, 0);
  assert.equal(march.month_received_cents, 0);
});

test("reversed bill payments and receipts remain visible but do not affect any vendor cash totals", () => {
  const fixture = data({
    entries: [entry("bill", { amount_cents: 29 }), entry("income", { kind: "income", amount_cents: 2000 })],
    payments: [payment("reversed-bill", "bill", 29, "2026-11-01", { reversed_at: created }), payment("reversed-receipt", "income", 2000, "2026-11-02", { reversed_at: created })],
  });
  const summary = vendorSummary(fixture, "vendor", fixture.today, "2026-11");
  assert.equal(summary.paid_cents, 0);
  assert.equal(summary.month_paid_cents, 0);
  assert.equal(summary.received_cents, 0);
  assert.equal(summary.month_received_cents, 0);
  assert.equal(summary.outstanding_cents, 29);
  assert.equal(summary.past_due_cents, 29);
  assert.equal(summary.history.length, 2);
});

test("vendor summaries ignore foreign ownership and orphan payments even in an incorrectly mixed input snapshot", () => {
  const fixture = data({
    vendors: [vendor("vendor"), vendor("foreign", { user_id: "other-owner" })],
    entries: [entry("owned"), entry("foreign-entry", { user_id: "other-owner" }), entry("foreign-vendor", { vendor_id: "foreign" })],
    payments: [
      payment("owned-payment", "owned", 1000, "2026-11-01"),
      payment("foreign-payment", "owned", 9000, "2026-11-01", { user_id: "other-owner" }),
      payment("wrong-entry-owner", "foreign-entry", 5000, "2026-11-01"),
      payment("orphan", "missing-entry", 5000, "2026-11-01"),
    ],
  });
  const summary = vendorSummary(fixture, "vendor", fixture.today, "2026-11");
  assert.equal(summary.entry_count, 1);
  assert.equal(summary.paid_cents, 1000);
  assert.equal(summary.outstanding_cents, 9000);
  assert.deepEqual(summary.history.map((row) => row.payment.id), ["owned-payment"]);
  for (const id of ["foreign", "missing"]) {
    const hidden = vendorSummary(fixture, id, fixture.today, "2026-11");
    assert.equal(hidden.entry_count, 0);
    assert.equal(hidden.paid_cents, 0);
    assert.equal(hidden.outstanding_cents, 0);
    assert.deepEqual(hidden.history, []);
  }
});

test("archiving a vendor preserves its associations, actual payments, and active outstanding amounts", () => {
  const fixture = data({ vendors: [vendor("vendor", { archived_at: created })], entries: [entry("bill")], payments: [payment("part", "bill", 2000, "2026-11-01")] });
  const summary = vendorSummary(fixture, "vendor", fixture.today, "2026-11");
  assert.equal(summary.entry_count, 1);
  assert.equal(summary.paid_cents, 2000);
  assert.equal(summary.outstanding_cents, 8000);
  assert.equal(summary.history[0].entry.vendor_id, "vendor");
});

test("history is deterministic by payment date, recorded time, and identifier without changing input order", () => {
  const fixture = data({
    entries: [entry("bill")],
    payments: [
      payment("a", "bill", 100, "2026-11-02", { created_at: "2026-11-03T12:00:00Z" }),
      payment("latest-paid-day", "bill", 100, "2026-11-05", { created_at: "2026-11-05T12:00:00Z" }),
      payment("z", "bill", 100, "2026-11-02", { created_at: "2026-11-03T12:00:00Z" }),
      payment("older-record", "bill", 100, "2026-11-02", { created_at: "2026-11-02T12:00:00Z" }),
    ],
  });
  const ids = fixture.payments.map((item) => item.id);
  assert.deepEqual(vendorSummary(fixture, "vendor", fixture.today, "2026-11").history.map((row) => row.payment.id), ["latest-paid-day", "z", "a", "older-record"]);
  assert.deepEqual(fixture.payments.map((item) => item.id), ids);
});

test("bills due today are not overdue and expected income never becomes a vendor payable", () => {
  const fixture = data({ entries: [entry("due-today", { original_due_date: "2026-11-15" }), entry("income", { kind: "income", amount_cents: 50000 })] });
  const summary = vendorSummary(fixture, "vendor", fixture.today, "2026-11");
  assert.equal(summary.outstanding_cents, 10000);
  assert.equal(summary.past_due_cents, 0);
  assert.equal(summary.received_cents, 0);
});
