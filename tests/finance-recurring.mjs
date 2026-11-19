import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from "typescript";
import * as validation from "../lib/finance/validation.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const otherOwner = "10000000-0000-4000-8000-000000000002";
const entryId = "20000000-0000-4000-8000-000000000001";
const seriesId = "30000000-0000-4000-8000-000000000001";
const context = { user: { id: owner }, staff: { role: "owner", displayName: "Owner" } };

function bill(changes = {}) {
  return {
    id: entryId, kind: "bill", title: "Electricity", category: "Utilities", expense_type: "bill",
    amount_cents: 12500, original_due_date: "2026-11-15", scheduled_date: "2026-11-20", notes: "",
    ...changes,
  };
}

// Execute the real server module and real sanitizer while replacing only the
// privileged connection. No test reads or writes a hosted finance workspace.
function mutationServer(reply = { data: { id: entryId }, error: null }) {
  const calls = [];
  class HubError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const hub = {
    HubError,
    getHubService: () => ({ rpc: async (name, parameters) => { calls.push({ name, parameters }); return reply; } }),
    getHubContext: async () => context,
  };
  const file = new URL("../lib/finance/server.ts", import.meta.url);
  const compiled = transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: specifier => {
      if (specifier === "server-only") return {};
      if (specifier === "@/lib/hub/server") return hub;
      if (specifier === "./validation") return validation;
      throw new Error(`Unexpected finance server import: ${specifier}`);
    },
  }, { filename: file.pathname });
  return { api: module.exports, calls };
}

test("omitted scope and explicit single scope keep edits and cancellations on the existing occurrence path", async () => {
  for (const scope of [undefined, "single"]) {
    const server = mutationServer();
    const optionalScope = scope === undefined ? {} : { scope };
    await server.api.mutateFinance(context, "save_entry", bill(optionalScope));
    await server.api.mutateFinance(context, "entry_status", { id: entryId, status: "cancelled", ...optionalScope });
    assert.deepEqual(server.calls.map(call => call.name), ["finance_mutate", "finance_mutate"]);
    assert.ok(server.calls.every(call => call.parameters.p_actor === owner));
    assert.ok(server.calls.every(call => call.parameters.p_payload.scope !== "future"));
  }
});

test("future edits and cancellations use the transactional recurrence RPC with the selected occurrence ID", async () => {
  const server = mutationServer();
  await server.api.mutateFinance(context, "save_entry", bill({ scope: "future", title: "Updated electricity", amount_cents: 13500 }));
  await server.api.mutateFinance(context, "entry_status", { id: entryId, status: "cancelled", scope: "future" });
  assert.deepEqual(server.calls.map(call => call.name), ["finance_mutate_recurring", "finance_mutate_recurring"]);
  assert.deepEqual(server.calls.map(call => call.parameters.p_action), ["save_entry", "entry_status"]);
  for (const call of server.calls) {
    assert.equal(call.parameters.p_actor, owner);
    assert.equal(call.parameters.p_payload.id, entryId);
    assert.equal(call.parameters.p_payload.scope, "future");
  }
  assert.equal(server.calls[0].parameters.p_payload.original_due_date, "2026-11-15");
  assert.equal(server.calls[0].parameters.p_payload.scheduled_date, "2026-11-20");
  assert.equal(server.calls[0].parameters.p_payload.amount_cents, 13500);
});

test("original due date edits use a dedicated owner-scoped RPC for one or future bills", async () => {
  const server = mutationServer();
  for (const scope of ["single", "future"]) {
    await server.api.mutateFinance(context, "change_due_date", {
      id: entryId, original_due_date: "2026-11-22", scope,
      user_id: otherOwner, series_id: seriesId, effective_from: "2000-01-01", paid_on: "2000-01-01",
    });
  }
  assert.deepEqual(server.calls.map(call => call.name), ["finance_change_due_date", "finance_change_due_date"]);
  for (const [index, call] of server.calls.entries()) {
    assert.equal(call.parameters.p_actor, owner);
    assert.equal(call.parameters.p_payload.scope, index === 0 ? "single" : "future");
    assert.equal(call.parameters.p_payload.original_due_date, "2026-11-22");
    assert.deepEqual(Object.keys(call.parameters.p_payload).sort(), ["id", "original_due_date", "scope"]);
    assert.equal("p_action" in call.parameters, false);
  }
});

test("changing a due date rejects malformed calendar dates, scopes and missing bill IDs", async () => {
  const server = mutationServer();
  for (const original_due_date of ["2026-02-30", "2101-01-01", "2026-11-99"]) {
    await assert.rejects(server.api.mutateFinance(context, "change_due_date", { id: entryId, original_due_date, scope: "future" }), error => error.status === 400);
  }
  for (const scope of ["all", "future ", null, false]) {
    await assert.rejects(server.api.mutateFinance(context, "change_due_date", { id: entryId, original_due_date: "2026-11-22", scope }), error => error.status === 400);
  }
  await assert.rejects(server.api.mutateFinance(context, "change_due_date", { original_due_date: "2026-11-22", scope: "single" }), error => error.status === 400);
  assert.equal(server.calls.length, 0);
});

test("malformed scope is rejected before any privileged mutation, instead of silently becoming a single edit", async () => {
  const server = mutationServer();
  for (const scope of [null, "", "all", "Future", " future ", false, 0, [], {}, ["future"]]) {
    await assert.rejects(server.api.mutateFinance(context, "save_entry", bill({ scope })), error => error.status === 400 && error.code === "INVALID_FINANCE_INPUT");
    await assert.rejects(server.api.mutateFinance(context, "entry_status", { id: entryId, status: "cancelled", scope }), error => error.status === 400 && error.code === "INVALID_FINANCE_INPUT");
  }
  assert.equal(server.calls.length, 0);
});

test("future changes require a selected bill and cannot be used to create a new recurring schedule", async () => {
  const server = mutationServer();
  for (const changes of [{ id: undefined }, { id: null }, { id: "" }, { kind: "income" }]) {
    await assert.rejects(server.api.mutateFinance(context, "save_entry", bill({ ...changes, scope: "future" })), error => error.status === 400);
  }
  assert.equal(server.calls.length, 0);
});

test("future cancellation cannot be combined with restore or archive operations", async () => {
  const server = mutationServer();
  for (const payload of [
    { id: entryId, status: "active", scope: "future" },
    { id: entryId, status: "cancelled", scope: "future", archived: true },
    { id: entryId, status: "cancelled", scope: "future", archived: false },
  ]) {
    await assert.rejects(server.api.mutateFinance(context, "entry_status", payload), error => error.status === 400);
  }
  assert.equal(server.calls.length, 0);
  await server.api.mutateFinance(context, "entry_status", { id: entryId, status: "active", scope: "single" });
  await server.api.mutateFinance(context, "entry_status", { id: entryId, status: "cancelled", archived: true });
  assert.deepEqual(server.calls.map(call => call.name), ["finance_mutate", "finance_mutate"]);
});

test("future scope cannot choose another owner, series, boundary date, or payment history", async () => {
  const server = mutationServer();
  await server.api.mutateFinance(context, "save_entry", bill({
    scope: "future", user_id: otherOwner, p_actor: otherOwner, series_id: seriesId,
    effective_from: "2000-01-01", cancelled_from: "2000-01-01", original_amount_cents: 1,
    status: "active", payments: [{ amount_cents: 1 }],
  }));
  const call = server.calls[0];
  assert.equal(call.name, "finance_mutate_recurring");
  assert.equal(call.parameters.p_actor, owner);
  for (const key of ["user_id", "p_actor", "series_id", "effective_from", "cancelled_from", "original_amount_cents", "status", "payments"]) {
    assert.equal(Object.hasOwn(call.parameters.p_payload, key), false, key);
  }
});

test("unrelated payment and series actions cannot enter the recurring mutation RPC through an injected scope", async () => {
  const server = mutationServer();
  await assert.rejects(server.api.mutateFinance(context, "save_series", { id: seriesId, active: false, scope: "future" }), error => error.status === 400);
  await assert.rejects(server.api.mutateFinance(context, "record_payment", { id: seriesId, entry_id: entryId, amount_cents: 100, paid_on: "2026-11-15", scope: "future" }), error => error.status === 400);
  assert.equal(server.calls.length, 0);
  await server.api.mutateFinance(context, "save_series", { id: seriesId, active: false });
  assert.equal(server.calls[0].name, "finance_mutate");
});

test("business-rule failures from a future change are returned without retrying a single occurrence", async () => {
  const message = "A future bill already has payments greater than the new amount.";
  const server = mutationServer({ data: null, error: { code: "P0001", message } });
  await assert.rejects(server.api.mutateFinance(context, "save_entry", bill({ scope: "future", amount_cents: 100 })), error => error.status === 409 && error.code === "FINANCE_CHANGE_REJECTED" && error.message === message);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].name, "finance_mutate_recurring");
});

test("missing recurring database setup reports a setup error without applying only part of the requested scope", async () => {
  const server = mutationServer({ data: null, error: { code: "PGRST202" } });
  await assert.rejects(server.api.mutateFinance(context, "entry_status", { id: entryId, status: "cancelled", scope: "future" }), error => error.status === 503 && error.code === "FINANCE_DATABASE_NOT_READY");
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].name, "finance_mutate_recurring");
});

const builtinRequire = createRequire(import.meta.url);
const React = builtinRequire("react");
const { renderToStaticMarkup } = builtinRequire("react-dom/server");
const root = new URL("../", import.meta.url).pathname;
const uiModules = new Map();
function loadUi(relative) {
  const candidate = resolve(root, relative);
  const filename = [candidate, `${candidate}.tsx`, `${candidate}.ts`].find(path => existsSync(path));
  if (!filename) throw new Error(`Missing finance UI module: ${relative}`);
  if (uiModules.has(filename)) return uiModules.get(filename).exports;
  const module = { exports: {} };
  uiModules.set(filename, module);
  const compiled = transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports, crypto: globalThis.crypto,
    require: specifier => {
      if (specifier.endsWith(".css")) return {};
      if (specifier.startsWith("@/")) return loadUi(specifier.slice(2));
      if (specifier.startsWith(".")) return loadUi(resolve(dirname(filename), specifier));
      return builtinRequire(specifier);
    },
  }, { filename });
  return module.exports;
}

function displayEntry(id, changes = {}) {
  return {
    ...bill(), id, user_id: owner, original_amount_cents: 12500, status: "active", archived_at: null,
    series_id: null, plan_id: null, vendor_id: null, account_id: null, payment_method: "manual",
    reminder_days: 3, reminder_snoozed_until: null, tag_ids: [],
    created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z", ...changes,
  };
}
function displayData(changes = {}) {
  return {
    user: { id: owner, display_name: "Owner" }, today: "2026-11-15", entries: [], payments: [],
    series: [], plans: [], debts: [], debt_history: [], spending: [], months: [], vendors: [], tags: [],
    accounts: [], balance_updates: [], transfers: [], goals: [], goal_history: [], ...changes,
  };
}
function uiProps(data) {
  return {
    data, month: "2026-11", today: data.today, accountScope: "all", notify: () => {},
    mutate: async () => { throw new Error("A render must not write finance records."); },
    openEntry: () => {}, openPlan: () => {}, openDebt: () => {}, openPayment: () => {}, openMove: () => {}, onClose: () => {},
  };
}

test("Bills initially hides cancelled rows while retaining active and paid rows and a visible show option", () => {
  const { BillsPanel } = loadUi("components/finance/records.tsx");
  const data = displayData({ entries: [
    displayEntry(entryId, { title: "Active service" }),
    displayEntry(seriesId, { title: "Cancelled service", status: "cancelled" }),
    displayEntry(otherOwner, { title: "Paid service" }),
  ], payments: [{ id: "payment", user_id: owner, entry_id: otherOwner, amount_cents: 12500, paid_on: "2026-11-05", reversed_at: null, account_id: null, payment_method: "manual" }] });
  const html = renderToStaticMarkup(React.createElement(BillsPanel, uiProps(data)));
  assert.match(html, /Active service/);
  assert.match(html, /Paid service/);
  assert.doesNotMatch(html, /Cancelled service/);
  assert.match(html, /Show cancelled/);
  assert.match(html, /Cancelled bills hidden/);
  assert.match(html, /\$375\.00/, "Original monthly obligations still include retained cancelled history");
  const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  assert.ok(checkbox, "Show cancelled has a native checkbox");
  assert.doesNotMatch(checkbox, /checked/, "Cancelled bills start hidden");
});

test("only recurring bills offer scope and the editor starts with this bill only", () => {
  const { EntryEditor } = loadUi("components/finance/editors.tsx");
  const series = { id: seriesId, user_id: owner, title: "Electricity", frequency: "monthly", active: true, start_date: "2026-01-15", end_date: null };
  for (const kind of ["recurring-bill", "standalone-bill", "recurring-income"]) {
    const entry = displayEntry(entryId, { series_id: kind === "standalone-bill" ? null : seriesId, kind: kind === "recurring-income" ? "income" : "bill" });
    const data = displayData({ entries: [entry], series: [series] });
    const html = renderToStaticMarkup(React.createElement(EntryEditor, { ...uiProps(data), entry }));
    if (kind === "recurring-bill") {
      assert.match(html, /This bill only/);
      assert.match(html, /This and future bills/);
      const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
      assert.equal(radios.length, 2);
      assert.match(radios.find(radio => /value="single"/.test(radio)) ?? "", /checked/);
      assert.doesNotMatch(radios.find(radio => /value="future"/.test(radio)) ?? "", /checked/);
    } else {
      assert.doesNotMatch(html, /name="bill-edit-scope"/);
    }
  }
});

test("a cancelled recurring bill exposes only individual restore and does not promise that resume restarts it", () => {
  const { EntryEditor } = loadUi("components/finance/editors.tsx");
  const entry = displayEntry(entryId, { series_id: seriesId, status: "cancelled" });
  const data = displayData({ entries: [entry], series: [{
    id: seriesId, user_id: owner, title: "Electricity", frequency: "monthly", active: false,
    start_date: "2026-01-15", end_date: null, cancelled_from: "2026-11-15",
  }] });
  const html = renderToStaticMarkup(React.createElement(EntryEditor, { ...uiProps(data), entry }));
  assert.match(html, /Restore this bill only/);
  assert.match(html, /Cancelled from Nov 15, 2026/);
  assert.match(html, /Restoring an individual bill restores that bill only/);
  assert.doesNotMatch(html, /Resume repeats/);
});
