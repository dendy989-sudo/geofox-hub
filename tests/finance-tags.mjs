import assert from "node:assert/strict";
import test from "node:test";
import { filterFinanceByTag, matchesTag, normalizeTagName, tagNameKey, tagOptions, tagsForEntry, tagSummary } from "../lib/finance/tags.ts";
import { monthSummary, remainingAmount } from "../lib/finance/calculations.ts";

const timestamp = "2026-11-01T12:00:00Z";
const ids = {
  a: "aaaaaaaa-1111-4111-8111-111111111111", b: "bbbbbbbb-2222-4222-8222-222222222222",
  c: "cccccccc-3333-4333-8333-333333333333", foreign: "dddddddd-4444-4444-8444-444444444444",
};
function tag(id, name = id, changes = {}) { return { id, user_id: "owner", name, archived_at: null, created_at: timestamp, updated_at: timestamp, ...changes }; }
function entry(id, changes = {}) {
  return { id, user_id: "owner", kind: "bill", title: id, category: "Home", expense_type: "bill", amount_cents: 10000,
    original_amount_cents: changes.amount_cents ?? 10000, original_due_date: "2026-11-10", scheduled_date: "2026-11-10",
    status: "active", archived_at: null, series_id: null, plan_id: null, vendor_id: null, account_id: null,
    payment_method: "manual", reminder_days: 3, reminder_snoozed_until: null, notes: "", tag_ids: [ids.a],
    created_at: timestamp, updated_at: timestamp, ...changes };
}
function payment(id, entryId, amount, paidOn = "2026-11-05", changes = {}) {
  return { id, user_id: "owner", entry_id: entryId, amount_cents: amount, paid_on: paidOn, note: "", reversed_at: null,
    account_id: null, payment_method: "manual", created_at: timestamp, ...changes };
}
function data(changes = {}) {
  return { user: { id: "owner", display_name: "Owner" }, today: "2026-11-15", entries: [], payments: [], series: [], plans: [],
    debts: [], debt_history: [], spending: [], months: [], vendors: [], accounts: [], balance_updates: [], transfers: [],
    goals: [], goal_history: [], tags: [tag(ids.a, "Household"), tag(ids.b, "Work")], ...changes };
}

test("tag names normalize whitespace, preserve punctuation, and use the same explicit Unicode case key", () => {
  assert.equal(normalizeTagName("  Home\u00a0  &\u3000family  "), "Home & family");
  assert.equal(normalizeTagName("Last, First / 2026"), "Last, First / 2026");
  assert.equal(tagNameKey("  HOME & Family "), "home & family");
  assert.equal(tagNameKey("JOSÉ"), tagNameKey("José"));
  assert.notEqual(tagNameKey("José"), tagNameKey("Jose"));
  assert.equal(tagNameKey("İpek"), tagNameKey("i\u0307pek"));
  assert.notEqual(tagNameKey("İpek"), tagNameKey("Ipek"));
  assert.equal(tagNameKey("ΟΣ"), tagNameKey("ος"));
  assert.equal(tagNameKey("ΟΣ"), tagNameKey("οσ"));
});

test("tag names enforce 60 Unicode code points and reject controls before trimming", () => {
  assert.equal(normalizeTagName(` ${"😀".repeat(60)} `), "😀".repeat(60));
  assert.throws(() => normalizeTagName("😀".repeat(61)), /60/);
  for (const value of [undefined, null, false, 1, [], {}, "", "\u00a0\u3000"]) assert.throws(() => normalizeTagName(value), /name/);
  for (const control of ["\u0000", "\t", "\n", "\r", "\u001f", "\u007f", "\u0085", "\u009f", "\u2028", "\u2029"]) {
    assert.throws(() => normalizeTagName(`${control}Home`), /control|line breaks/);
    assert.throws(() => normalizeTagName(`Home${control}`), /control|line breaks/);
  }
  for (const space of ["\u00a0", "\u1680", "\u2000", "\u200a", "\u202f", "\u205f", "\u3000", "\ufeff"]) assert.equal(normalizeTagName(`A${space}${space}B`), "A B");
});

test("tag chips honor direct associations, ownership, archive state, and legacy empty fields", () => {
  const fixture = data({
    tags: [tag(ids.a, "Foreign duplicate", { user_id: "other-owner" }), tag(ids.a, "Home"), tag(ids.b, "Archived", { archived_at: timestamp }), tag(ids.foreign, "Private", { user_id: "other-owner" })],
    plans: [{ id: "plan", user_id: "owner", tag_ids: [ids.a] }], series: [{ id: "series", user_id: "owner", tag_ids: [ids.a] }],
  });
  assert.deepEqual(tagsForEntry(fixture, entry("tagged", { tag_ids: [ids.a, ids.a, ids.b, ids.foreign, ids.c] })).map(item => item.name), ["Archived", "Home"]);
  assert.deepEqual(tagsForEntry(fixture, entry("foreign", { user_id: "other-owner" })), []);
  for (const tagIds of [[], undefined, null]) assert.deepEqual(tagsForEntry(fixture, entry("detached", { tag_ids: tagIds, plan_id: "plan", series_id: "series" })), []);
  assert.equal(tagsForEntry(fixture, fixture.plans[0])[0].id, ids.a, "The same safe direct association helper supports plan/series chips");
});

test("tag matching supports plan/series shapes and legacy records without using tag names as sentinels", () => {
  for (const tagIds of [undefined, null, []]) {
    assert.equal(matchesTag({ tag_ids: tagIds }), true);
    assert.equal(matchesTag({ tag_ids: tagIds }, "untagged"), true);
    assert.equal(matchesTag({ tag_ids: tagIds }, ids.a), false);
  }
  assert.equal(matchesTag({ tag_ids: [ids.a, ids.a] }, ids.a.toUpperCase()), true);
  assert.equal(matchesTag({ tag_ids: [ids.a] }, "untagged"), false);
  assert.equal(matchesTag({ tag_ids: [ids.a] }, ids.b), false);
  assert.equal(matchesTag({ tag_ids: [ids.a] }, "Household"), false);
  assert.equal(matchesTag({ tag_ids: [ids.a] }, null), false);
});

test("tag menu counts unique owned entries and keeps associated archived tags available", () => {
  const same = entry("same", { tag_ids: [ids.a, ids.a, ids.b], status: "cancelled", archived_at: timestamp });
  const fixture = data({
    tags: [tag(ids.a, "All tags"), tag(ids.b, "Untagged", { archived_at: timestamp }), tag(ids.c, "Unused archived", { archived_at: timestamp }), tag(ids.foreign, "Private", { user_id: "other-owner" })],
    entries: [same, { ...same }, entry("empty", { tag_ids: [] }), entry("legacy", { tag_ids: undefined }), entry("foreign", { user_id: "other-owner", tag_ids: [ids.foreign] })],
  });
  const options = tagOptions(fixture);
  assert.deepEqual(options.slice(0, 2), [{ value: "all", label: "All tags", count: 3, archived: false }, { value: "untagged", label: "Untagged", count: 2, archived: false }]);
  assert.deepEqual(options.find(item => item.value === ids.a), { value: ids.a, label: "All tags", count: 1, archived: false });
  assert.deepEqual(options.find(item => item.value === ids.b), { value: ids.b, label: "Untagged", count: 1, archived: true });
  assert.equal(options.some(item => item.value === ids.c || item.value === ids.foreign), false);
  assert.deepEqual(filterFinanceByTag(fixture, ids.b).entries.map(item => item.id), ["same"]);
  assert.deepEqual(filterFinanceByTag(fixture, "untagged").entries.map(item => item.id), ["empty", "legacy"]);
});

test("filtered finance retains selected entries' complete payment history and related data without foreign leakage", () => {
  const owned = entry("bill", { account_id: "new-account" });
  const paid = payment("payment", "bill", 2000, "2026-10-31", { account_id: "old-account" });
  const fixture = data({
    entries: [entry("bill", { user_id: "other-owner" }), owned, { ...owned }, entry("other", { tag_ids: [ids.b] }), entry("foreign", { user_id: "other-owner" })],
    payments: [paid, { ...paid }, payment("foreign-pay", "bill", 8000, "2026-11-05", { user_id: "other-owner" }), payment("reversed", "bill", 1000, "2026-11-05", { reversed_at: timestamp }), payment("other-pay", "other", 3000), payment("orphan", "missing", 4000)],
  });
  const selected = filterFinanceByTag(fixture, ids.a);
  assert.deepEqual(selected.entries.map(item => item.id), ["bill"]);
  assert.deepEqual(selected.payments.map(item => item.id), ["payment", "reversed"]);
  assert.equal(remainingAmount(selected.entries[0], selected.payments), 8000);
  for (const key of ["plans", "series", "accounts", "months", "balance_updates", "transfers", "tags"]) assert.equal(selected[key], fixture[key]);
  for (const scope of [ids.foreign, "missing", null]) {
    assert.deepEqual(filterFinanceByTag(fixture, scope).entries, []);
    assert.deepEqual(filterFinanceByTag(fixture, scope).payments, []);
  }
});

test("unknown and foreign tag IDs cannot be used to select an owned record from a mixed snapshot", () => {
  const fixture = data({ tags: [tag(ids.a, "Own"), tag(ids.foreign, "Other owner", { user_id: "other-owner" })], entries: [entry("owned", { tag_ids: [ids.foreign, ids.c] })] });
  assert.deepEqual(tagsForEntry(fixture, fixture.entries[0]), []);
  assert.deepEqual(filterFinanceByTag(fixture, ids.foreign).entries, []);
  assert.deepEqual(filterFinanceByTag(fixture, ids.c).entries, []);
  assert.equal(tagSummary(fixture, ids.foreign, "2026-11").original_bills_cents, 0);
  assert.equal(tagOptions(fixture).some(item => item.label === "Other owner"), false);
});

test("overlapping tags show full group amounts while All tags counts each bill and receipt once", () => {
  const shared = entry("shared", { amount_cents: 10000, tag_ids: [ids.a, ids.b, ids.a] });
  const fixture = data({ entries: [shared, { ...shared }, entry("income", { kind: "income", amount_cents: 15000, tag_ids: [ids.a, ids.b] }), entry("empty", { amount_cents: 2000, tag_ids: [] })], payments: [payment("part", "shared", 2000)] });
  for (const scope of [ids.a, ids.b]) {
    const summary = tagSummary(fixture, scope, "2026-11");
    assert.equal(summary.entry_count, 2);
    assert.equal(summary.original_bills_cents, 10000);
    assert.equal(summary.paid_cents, 2000);
    assert.equal(summary.remaining_cents, 8000);
    assert.equal(summary.income_cents, 15000);
    assert.equal(summary.net_cents, 5000);
  }
  assert.equal(tagSummary(fixture, "all", "2026-11").original_bills_cents, 12000);
  assert.equal(tagSummary(fixture, "all", "2026-11").paid_cents, 2000);
  assert.equal(tagSummary(fixture, "untagged", "2026-11").original_bills_cents, 2000);
});

test("tag totals separate original obligations, moved forecasts, all-date remainders, and actual payment months", () => {
  const fixture = data({ entries: [
    entry("moved-out", { amount_cents: 12000, original_amount_cents: 10000, scheduled_date: "2026-12-05" }),
    entry("moved-in", { amount_cents: 5000, original_due_date: "2026-10-01", scheduled_date: "2026-11-20" }),
    entry("cancelled", { amount_cents: 6000, status: "cancelled" }), entry("collections", { amount_cents: 7000, status: "collections" }),
    entry("archived", { amount_cents: 8000, original_due_date: "2026-11-15", scheduled_date: "2026-11-15", archived_at: timestamp }),
    entry("paid", { amount_cents: 2000 }), entry("income", { kind: "income", amount_cents: 30000, scheduled_date: "2026-11-18" }),
    entry("cancelled-income", { kind: "income", amount_cents: 5000, status: "cancelled" }), entry("other", { amount_cents: 99999, tag_ids: [ids.b] }),
  ], payments: [
    payment("prior", "moved-out", 3000, "2026-10-31"), payment("part", "moved-out", 1000), payment("reversed", "moved-out", 2000, "2026-11-05", { reversed_at: timestamp }),
    payment("moved-in-part", "moved-in", 1000), payment("cancelled-paid", "cancelled", 2000), payment("collections-paid", "collections", 500),
    payment("archive-part", "archived", 1000), payment("fully-paid", "paid", 2000), payment("prior-income", "income", 10000, "2026-10-28"),
    payment("receipt", "income", 5000), payment("cancelled-receipt", "cancelled-income", 1200),
  ] });
  const summary = tagSummary(fixture, ids.a, "2026-11");
  assert.equal(summary.entry_count, 8);
  assert.equal(summary.original_bills_cents, 33000);
  assert.equal(summary.outstanding_cents, 19000);
  assert.equal(summary.past_due_cents, 12000);
  assert.equal(summary.remaining_cents, 11000);
  assert.equal(summary.paid_cents, 7500);
  assert.equal(summary.scheduled_bills_cents, 18500);
  assert.equal(summary.received_cents, 6200);
  assert.equal(summary.expected_income_cents, 15000);
  assert.equal(summary.income_cents, 21200);
  assert.equal(summary.net_cents, 2700);
  const december = tagSummary(fixture, ids.a, "2026-12");
  assert.equal(december.remaining_cents, 8000);
  assert.equal(december.paid_cents, 0);
  assert.equal(december.outstanding_cents, 19000);
  assert.equal(december.entry_count, 8, "Summary entries include all dates rather than silently hiding their history");
});

test("account-scoped tag actuals follow immutable payment accounts while unpaid forecasts follow current assignments", () => {
  const fixture = data({ entries: [entry("bill", { account_id: "checking-b" }), entry("income", { kind: "income", amount_cents: 12000, account_id: "checking-b" })],
    payments: [payment("a", "bill", 3000, "2026-11-05", { account_id: "checking-a" }), payment("b", "bill", 2000, "2026-11-05", { account_id: "checking-b" }), payment("receipt", "income", 4000, "2026-11-05", { account_id: "checking-a" })] });
  const a = tagSummary(fixture, ids.a, "2026-11", fixture.today, "checking-a");
  assert.equal(a.paid_cents, 3000); assert.equal(a.received_cents, 4000); assert.equal(a.remaining_cents, 0); assert.equal(a.original_bills_cents, 0); assert.equal(a.net_cents, 1000);
  const b = tagSummary(fixture, ids.a, "2026-11", fixture.today, "checking-b");
  assert.equal(b.paid_cents, 2000); assert.equal(b.remaining_cents, 5000); assert.equal(b.expected_income_cents, 8000); assert.equal(b.original_bills_cents, 10000); assert.equal(b.net_cents, 1000);
  assert.equal(tagSummary(fixture, ids.a, "2026-11").net_cents, 2000);
  fixture.payments[0].account_id = null;
  assert.equal(tagSummary(fixture, ids.a, "2026-11", fixture.today, null).paid_cents, 3000, "Legacy unassigned snapshots never fall back to the entry's new account");
  assert.equal(tagSummary(fixture, ids.a, "2026-11", fixture.today, "checking-b").remaining_cents, 5000);
});

test("filtered monthly commitment summaries retain parent plan status and all payments without including other installments", () => {
  const fixture = data({ plans: [{ id: "plan", user_id: "owner", status: "active", tag_ids: [ids.a], total_amount_cents: 20000, opening_paid_cents: 0 }],
    entries: [entry("one", { expense_type: "installment", plan_id: "plan" }), entry("two", { expense_type: "installment", plan_id: "plan", tag_ids: [ids.b] })],
    payments: [payment("prior", "one", 3000, "2026-10-31"), payment("other", "two", 4000)] });
  const summary = monthSummary(filterFinanceByTag(fixture, ids.a), "2026-11", fixture.today);
  assert.equal(summary.original_bills_cents, 10000);
  assert.equal(summary.original_paid_cents, 3000);
  assert.equal(summary.original_remaining_cents, 7000);
  assert.equal(summary.installments_remaining_cents, 7000);
  assert.equal(summary.paid_bills_cents, 0);
});

test("archiving a tag preserves group totals and helpers never mutate the source snapshot", () => {
  const fixture = data({ tags: [tag(ids.a, "Archived", { archived_at: timestamp })], entries: [entry("bill")], payments: [payment("part", "bill", 2500)] });
  const before = structuredClone(fixture);
  const summary = tagSummary(fixture, ids.a, "2026-11");
  assert.equal(summary.paid_cents, 2500);
  assert.equal(summary.outstanding_cents, 7500);
  tagsForEntry(fixture, fixture.entries[0]); tagOptions(fixture); filterFinanceByTag(fixture, ids.a);
  assert.deepEqual(fixture, before);
});
