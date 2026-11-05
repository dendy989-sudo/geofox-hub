import assert from "node:assert/strict";
import test from "node:test";
import { debtPeopleOptions, debtPersonKey, debtSummaryForPerson, filterDebtsByPerson, normalizeResponsiblePeople } from "../lib/finance/debt-people.ts";

function debt(id, overrides = {}) {
  return {
    id, user_id: "owner", title: "Shared household bill", stage: "collections", original_creditor: "Original company", collector: "Collector",
    original_balance_cents: 10000, current_balance_cents: 10000, status: "open", date_added: "2026-11-01", date_removed: null,
    settlement_offer_cents: null, offer_monthly_cents: null, offer_expires_on: null, source_entry_id: null, source_plan_id: null,
    responsible_people: [], notes: "", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z", ...overrides,
  };
}

function data(debts = []) {
  return {
    user: { id: "owner", display_name: "Owner" }, today: "2026-11-05", entries: [], payments: [], series: [], plans: [], debts,
    debt_history: [], spending: [], months: [], vendors: [], accounts: [], balance_updates: [], transfers: [], goals: [], goal_history: [],
  };
}

test("responsible names normalize whitespace and case duplicates without splitting commas or changing first spelling", () => {
  const names = ["  Mary\u00a0 Ann  ", "mary ann", " Last, First ", "last, first", "JEAN-LUC", "Jean-Luc", "O’Neil"];
  assert.deepEqual(normalizeResponsiblePeople(names), ["Mary Ann", "Last, First", "JEAN-LUC", "O’Neil"]);
  assert.deepEqual(names, ["  Mary\u00a0 Ann  ", "mary ann", " Last, First ", "last, first", "JEAN-LUC", "Jean-Luc", "O’Neil"]);
  assert.equal(debtPersonKey(" Last,  First "), "person:last, first");
});

test("Unicode spacing matches the storage normalization without accepting line or control characters", () => {
  for (const space of [" ", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f", "\u205f", "\u3000", "\ufeff"]) {
    assert.deepEqual(normalizeResponsiblePeople([`${space}Mary${space}${space}Ann${space}`]), ["Mary Ann"]);
  }
  for (const control of ["\u0000", "\t", "\n", "\r", "\u001f", "\u007f", "\u0085", "\u009f", "\u2028", "\u2029"]) {
    assert.throws(() => normalizeResponsiblePeople([`${control}Name`]), /control|line breaks/, JSON.stringify(control));
    assert.throws(() => normalizeResponsiblePeople([`Name${control}`]), /control|line breaks/, JSON.stringify(control));
  }
});

test("legacy absent fields are unassigned while invalid collection values and empty names reject", () => {
  for (const value of [null, undefined, []]) assert.deepEqual(normalizeResponsiblePeople(value), []);
  for (const value of ["Alice", 1, true, {}]) assert.throws(() => normalizeResponsiblePeople(value), /list/);
  for (const value of [[null], [undefined], [1], [{}], [[]]]) assert.throws(() => normalizeResponsiblePeople(value), /name/);
  for (const name of ["", "   ", "\u00a0\u3000"]) assert.throws(() => normalizeResponsiblePeople([name]), /empty name/);
});

test("name and household limits count Unicode code points and distinct normalized people", () => {
  assert.deepEqual(normalizeResponsiblePeople(["😀".repeat(100)]), ["😀".repeat(100)]);
  assert.throws(() => normalizeResponsiblePeople(["😀".repeat(101)]), /100/);
  assert.equal(normalizeResponsiblePeople([`  ${"A".repeat(100)}  `])[0].length, 100);
  const twenty = Array.from({ length: 20 }, (_, index) => `Person ${index}`);
  assert.deepEqual(normalizeResponsiblePeople([...twenty, ...twenty.map((name) => name.toUpperCase())]), twenty);
  assert.deepEqual(normalizeResponsiblePeople(Array(50).fill(" Alice ")), ["Alice"]);
  assert.throws(() => normalizeResponsiblePeople([...twenty, "One more"]), /20/);
});

test("dotted I retains its mark while Greek final sigma shares one comparison key", () => {
  assert.deepEqual(normalizeResponsiblePeople(["İpek", "Ipek", "i\u0307pek", "ipek"]), ["İpek", "Ipek"]);
  assert.notEqual(debtPersonKey("İpek"), debtPersonKey("Ipek"));
  assert.equal(debtPersonKey("İpek"), debtPersonKey("i\u0307pek"));
  assert.deepEqual(normalizeResponsiblePeople(["ΟΣ", "ος", "οσ"]), ["ΟΣ"]);
  assert.equal(debtPersonKey("ΟΣ"), debtPersonKey("ος"));
  assert.equal(debtPersonKey("ΟΣ"), debtPersonKey("οσ"));
  const fixture = data([debt("greek", { responsible_people: ["ΟΣ"] }), debt("dotted", { responsible_people: ["İpek"] }), debt("plain", { responsible_people: ["Ipek"] })]);
  assert.deepEqual(filterDebtsByPerson(fixture, debtPersonKey("ος")).map((item) => item.id), ["greek"]);
  assert.deepEqual(filterDebtsByPerson(fixture, debtPersonKey("i\u0307pek")).map((item) => item.id), ["dotted"]);
});

test("person options count each owned debt once and keep reserved labels separate from real names", () => {
  const fixture = data([
    debt("shared", { responsible_people: ["Alice", "alice", "Bob"] }), debt("empty"),
    debt("all-name", { responsible_people: ["All"] }), debt("unassigned-name", { responsible_people: ["Unassigned"] }),
    debt("all-people-name", { responsible_people: ["All people"] }), debt("prefix-name", { responsible_people: ["person:all"] }),
    debt("foreign", { user_id: "another-owner", responsible_people: ["Secret name"] }),
  ]);
  const options = debtPeopleOptions(fixture);
  assert.deepEqual(options.slice(0, 2), [{ value: "all", label: "All people", count: 6 }, { value: "unassigned", label: "Unassigned debts", count: 1 }]);
  for (const name of ["Alice", "Bob", "All", "Unassigned", "All people", "person:all"]) {
    const option = options.find((item) => item.value === debtPersonKey(name));
    assert.equal(option.label, name);
    assert.equal(option.count, 1);
  }
  assert.equal(new Set(options.map((option) => option.value)).size, options.length);
  assert.equal(options.some((option) => option.label === "Secret name"), false);
  assert.deepEqual(filterDebtsByPerson(fixture, "unassigned").map((item) => item.id), ["empty"]);
  assert.deepEqual(filterDebtsByPerson(fixture, debtPersonKey("Unassigned")).map((item) => item.id), ["unassigned-name"]);
  assert.deepEqual(filterDebtsByPerson(fixture, debtPersonKey("All")).map((item) => item.id), ["all-name"]);
});

test("person selection uses the complete case-insensitive normalized name and fails closed for unknown filters", () => {
  const fixture = data([
    debt("ann", { responsible_people: ["Ann"] }), debt("anna", { responsible_people: ["Anna"] }),
    debt("mary", { responsible_people: ["Mary Ann"] }), debt("comma", { responsible_people: ["Last, First"] }),
    debt("accent", { responsible_people: ["José"] }), debt("plain", { responsible_people: ["Jose"] }),
  ]);
  assert.deepEqual(filterDebtsByPerson(fixture, "person: ANN ").map((item) => item.id), ["ann"]);
  assert.deepEqual(filterDebtsByPerson(fixture, "person:mary\u00a0  ann").map((item) => item.id), ["mary"]);
  assert.deepEqual(filterDebtsByPerson(fixture, "person:LAST, FIRST").map((item) => item.id), ["comma"]);
  assert.deepEqual(filterDebtsByPerson(fixture, "person:JOSÉ").map((item) => item.id), ["accent"]);
  for (const filter of ["Ann", "missing", "person:an", "person:Last", "person:", "person:Ann\n", null]) {
    assert.deepEqual(filterDebtsByPerson(fixture, filter), [], String(filter));
    assert.equal(debtSummaryForPerson(fixture, filter).balance_cents, 0);
  }
});

test("shared balances are not divided or duplicated in All people", () => {
  const fixture = data([
    debt("shared", { responsible_people: ["Alice", "Bob"], current_balance_cents: 10000 }),
    debt("alice", { responsible_people: ["Alice"], current_balance_cents: 2000 }),
    debt("bob", { responsible_people: ["Bob"], current_balance_cents: 3000 }),
    debt("empty", { current_balance_cents: 4000 }),
    debt("paid", { responsible_people: ["Alice", "Bob"], current_balance_cents: 0, status: "paid" }),
  ]);
  assert.equal(debtSummaryForPerson(fixture).balance_cents, 19000);
  assert.equal(debtSummaryForPerson(fixture, debtPersonKey("Alice")).balance_cents, 12000);
  assert.equal(debtSummaryForPerson(fixture, debtPersonKey("Bob")).balance_cents, 13000);
  assert.equal(debtSummaryForPerson(fixture, "unassigned").balance_cents, 4000);
  assert.equal(debtPeopleOptions(fixture)[0].count, 5);
  assert.equal(debtPeopleOptions(fixture).find((option) => option.value === debtPersonKey("Alice")).count, 3);
});

test("mixed-owner snapshots and repeated debt IDs cannot leak names or inflate selected balances", () => {
  const owned = debt("same-id", { responsible_people: ["Alice"], current_balance_cents: 4500 });
  const fixture = data([
    debt("same-id", { user_id: "another-owner", responsible_people: ["Private name"], current_balance_cents: 999999 }),
    owned, { ...owned },
    debt("other-id", { title: owned.title, responsible_people: ["Alice"], current_balance_cents: 500 }),
    debt("foreign-only", { user_id: "another-owner", responsible_people: ["Alice"], current_balance_cents: 999999 }),
  ]);
  assert.equal(debtPeopleOptions(fixture)[0].count, 2);
  assert.equal(debtPeopleOptions(fixture).some((option) => option.label === "Private name"), false);
  assert.deepEqual(filterDebtsByPerson(fixture).map((item) => item.id), ["same-id", "other-id"]);
  assert.equal(debtSummaryForPerson(fixture).balance_cents, 5000);
  assert.equal(debtSummaryForPerson(fixture, debtPersonKey("Alice")).balance_cents, 5000);
  assert.equal(debtSummaryForPerson(fixture, debtPersonKey("Private name")).balance_cents, 0);
});

test("older snapshots remain in unassigned and malformed cache data cannot crash the person menu", () => {
  const fixture = data([
    debt("missing", { responsible_people: undefined }), debt("null", { responsible_people: null }), debt("empty"),
    debt("malformed", { responsible_people: "Alice" }), debt("named", { responsible_people: ["Alice"] }),
  ]);
  assert.equal(debtPeopleOptions(fixture)[1].count, 4);
  assert.deepEqual(filterDebtsByPerson(fixture, "unassigned").map((item) => item.id), ["missing", "null", "empty", "malformed"]);
  assert.equal(debtSummaryForPerson(fixture, "unassigned").balance_cents, 40000);
});

test("person summaries preserve existing status, collections, and offer-expiry accounting", () => {
  const fixture = data([
    debt("closed", { responsible_people: ["Alice", "Bob"], status: "closed", current_balance_cents: 5000, settlement_offer_cents: 2000, offer_monthly_cents: 200, offer_expires_on: "2026-11-05" }),
    debt("charged-off", { responsible_people: ["Alice"], stage: "credit_report", status: "charged_off", current_balance_cents: 7000, settlement_offer_cents: 4000, offer_monthly_cents: 400, offer_expires_on: "2026-11-04", date_removed: "2026-11-01" }),
    debt("capped-offer", { responsible_people: ["Alice"], current_balance_cents: 1000, settlement_offer_cents: 5000, offer_monthly_cents: 100 }),
    debt("paid", { responsible_people: ["Alice"], status: "paid", current_balance_cents: 0, settlement_offer_cents: 500, offer_monthly_cents: 500 }),
    debt("unselected", { responsible_people: ["Carol"], current_balance_cents: 999999 }),
  ]);
  assert.deepEqual(debtSummaryForPerson(fixture, debtPersonKey("Alice")), { balance_cents: 13000, settlement_cents: 10000, monthly_offers_cents: 300, collections_cents: 6000 });
  assert.deepEqual(debtSummaryForPerson(fixture, debtPersonKey("Alice"), "2026-11-06"), { balance_cents: 13000, settlement_cents: 13000, monthly_offers_cents: 100, collections_cents: 6000 });
  assert.deepEqual(debtSummaryForPerson(fixture, debtPersonKey("Bob")), { balance_cents: 5000, settlement_cents: 2000, monthly_offers_cents: 200, collections_cents: 5000 });
});

test("menus, filtered summaries, and sorted names never mutate the source snapshot", () => {
  const fixture = data([
    debt("z", { responsible_people: ["Zoe", " alice "] }), debt("a", { responsible_people: ["ALICE", "Bob"] }),
  ]);
  const before = structuredClone(fixture);
  assert.deepEqual(debtPeopleOptions(fixture).slice(2).map((option) => option.label), ["alice", "Bob", "Zoe"]);
  const visible = filterDebtsByPerson(fixture, debtPersonKey("Alice"));
  assert.equal(visible[0], fixture.debts[0]);
  debtSummaryForPerson(fixture, debtPersonKey("Alice"));
  assert.deepEqual(fixture, before);
});
