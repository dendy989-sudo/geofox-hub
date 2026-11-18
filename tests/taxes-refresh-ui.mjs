import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url), React = require("react");
const root = new URL("../", import.meta.url).pathname;
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = data => new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
const record = (id, kind, data, tax_year = 2020) => ({ id, kind, tax_year, title: id, data, version: 1, archived: false, created_at: "2026-11-18T12:00:00Z", updated_at: "2026-11-18T12:00:00Z" });
const statement = record("sample.csv", "statement", { status: "uploaded", mime_type: "text/csv", document_type: "bank_statement", account_id: "account", sha256: "a".repeat(64) });
const snapshot = { year: 2020, user: { id: "synthetic-owner", display_name: "Owner" }, aiAvailable: false, audit: [], records: [
  statement, record("account", "account", { account_type: "checking" }, null),
  record("business", "business", { reporting_treatment: "sole_proprietor" }, null),
  record("2020", "year", { status: "gathering" }),
] };

// Existing React element factories plus controlled hooks let these tests exercise
// the actual callbacks without adding a DOM package. Boundary type, key and the
// entire ancestor path are checked because those determine state preservation.
async function harness(fetch) {
  const cache = new Map(), lazy = []; let active;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const hooks = { ...React,
    useState(initial) { const frame = active, i = frame.cursor++; if (!(i in frame.slots)) frame.slots[i] = typeof initial === "function" ? initial() : initial; return [frame.slots[i], value => { frame.slots[i] = typeof value === "function" ? value(frame.slots[i]) : value; }]; },
    useRef(initial) { const frame = active, i = frame.cursor++; return frame.slots[i] ||= { current: initial }; },
    useMemo(calculate, deps) { const frame = active, i = frame.cursor++; if (!frame.slots[i] || changed(frame.slots[i].deps, deps)) frame.slots[i] = { deps, value: calculate() }; return frame.slots[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) { const frame = active, i = frame.cursor++; if (!frame.slots[i] || changed(frame.slots[i].deps, deps)) { const old = frame.slots[i]; frame.slots[i] = { deps }; frame.effects.push(() => { old?.cleanup?.(); frame.slots[i].cleanup = effect(); }); } },
  };
  const window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, scrollTo() {}, setTimeout: () => 1, clearTimeout() {} };
  function load(relative) {
    const candidate = resolve(root, relative), filename = [candidate, `${candidate}.tsx`, `${candidate}.ts`].find(existsSync);
    if (!filename) throw new Error(`Missing UI module: ${relative}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      module, exports: module.exports, window, fetch,
      require: name => name === "react" ? hooks : name === "next/dynamic" ? { default: loader => {
        function Boundary() {} lazy.push(loader().then(component => { Boundary.component = component; })); return Boundary;
      } } : name.endsWith(".css") ? {} : name.startsWith("@/") ? load(name.slice(2)) : name.startsWith(".") ? load(resolve(dirname(filename), name)) : require(name),
    }, { filename });
    return module.exports;
  }
  const { TaxWorkspace } = load("components/taxes/tax-workspace.tsx"); await Promise.all(lazy);
  const frame = () => ({ slots: [], cursor: 0, effects: [] });
  function render(component, props, state) {
    state.cursor = 0; state.effects = []; const prior = active; active = state;
    const tree = component(props); active = prior; for (const effect of state.effects) effect(); return tree;
  }
  const workspace = frame();
  return { frame, render, workspace: () => render(TaxWorkspace, { initialData: structuredClone(snapshot) }, workspace) };
}
function nodes(node, ancestors = [], path = "root") {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child, i) => nodes(child, ancestors, `${path}.${i}`));
  return [{ node, ancestors, path }, ...nodes(node.props?.children, [...ancestors, { type: node.type, key: node.key }], `${path}.children`)];
}
function text(node) { if (node == null || typeof node === "boolean") return ""; if (Array.isArray(node)) return node.map(text).join(""); return typeof node === "object" ? text(node.props?.children) : String(node); }
function button(tree, label) { const found = nodes(tree).find(({ node }) => node.type === "button" && (text(node) === label || node.props["aria-label"] === label)); assert.ok(found, `Missing button: ${label}`); return found.node; }
function boundary(tree, name) { const found = nodes(tree).find(({ node }) => node.type?.component?.name === name); assert.ok(found, `${name} must remain mounted during same-year refresh`); return found; }
function sameBoundary(before, after) { assert.equal(after.node.type, before.node.type); assert.equal(after.node.key, before.node.key); assert.equal(after.path, before.path); assert.deepEqual(after.ancestors, before.ancestors); }
function busyBoundary(tree, expected) { const wrapper = nodes(tree).find(({ node }) => node.props?.["aria-busy"] !== undefined); assert.ok(wrapper, "The persistent panel wrapper communicates refresh state"); assert.equal(wrapper.node.props["aria-busy"], expected); assert.equal(wrapper.node.props.inert, expected); }

for (const mapping of [false, true]) test(`${mapping ? "CSV column mapping" : "statement preview"} survives its parent refresh`, async () => {
  let finishRefresh, refreshes = 0;
  const preview = mapping ? { needs_mapping: true, statement, headers: ["Booked", "Details", "Value"], sample: [["01/02/2020", "Synthetic row", "-12.34"]], suggested_mapping: { date: "Booked", description: "Details", amount: "Value" } }
    : { statement, rows: [{ date: "2020-01-02", description: "Synthetic preview row", amount_cents: -1234 }], warnings: [], questions: [], totals: { incoming_cents: 0, outgoing_cents: 1234, net_cents: -1234, row_count: 1 }, opening_balance_cents: null, closing_balance_cents: null, reconciliation_difference_cents: null, extracted_by: "csv" };
  const app = await harness(async (url, init) => {
    if (url === "/api/taxes/import") { assert.equal(JSON.parse(init.body).action, "preview"); return response(preview); }
    assert.equal(url, "/api/taxes?year=2020"); refreshes++; return new Promise(resolve => { finishRefresh = resolve; });
  });
  button(app.workspace(), "Statements & documents").props.onClick();
  const initial = boundary(app.workspace(), "TaxImportPanel"), childState = app.frame();
  const renderImport = item => app.render(item.node.type.component, item.node.props, childState);
  button(renderImport(initial), "Review transactions").props.onClick(); await flush();
  assert.equal(refreshes, 1, "The import callback must actually start the parent GET refresh");
  let tree = app.workspace(), pending = boundary(tree, "TaxImportPanel"); sameBoundary(initial, pending); busyBoundary(tree, true);
  const expectedPanel = mapping ? "Match this bank’s columns" : "Review before importing";
  assert.ok(nodes(renderImport(pending)).some(({ node }) => node.props?.title === expectedPanel));
  finishRefresh(response(structuredClone(snapshot))); await flush();
  tree = app.workspace(); const completed = boundary(tree, "TaxImportPanel"); sameBoundary(initial, completed); busyBoundary(tree, false);
  const content = renderImport(completed);
  assert.ok(nodes(content).some(({ node }) => node.props?.title === expectedPanel));
  if (mapping) assert.ok(nodes(content).some(({ node }) => node.type === "select" && node.props.value === "Booked"));
  else { assert.match(text(content), /Synthetic preview row/); assert.match(text(content), /Import 1 selected transactions/); }
});

test("saving report details keeps the selected Schedule C tab through refresh", async () => {
  let finishRefresh, saves = 0;
  const app = await harness(async (url, init) => {
    if (init?.method === "POST") { assert.equal(url, "/api/taxes"); assert.equal(JSON.parse(init.body).action, "save"); saves++; return response({ saved: true }); }
    assert.equal(url, "/api/taxes?year=2020"); return new Promise(resolve => { finishRefresh = resolve; });
  });
  button(app.workspace(), "Reports & Schedule C").props.onClick();
  const initial = boundary(app.workspace(), "TaxReports"), childState = app.frame();
  const renderReports = item => app.render(item.node.type.component, item.node.props, childState);
  button(renderReports(initial), "Schedule C").props.onClick();
  assert.equal(button(renderReports(initial), "Schedule C").props.className, "active");
  const save = initial.node.props.onSave({ id: "2020", kind: "year", tax_year: 2020, title: "2020", version: 1, data: { status: "gathering", notes: "Synthetic supporting detail" } });
  await flush(); assert.equal(saves, 1);
  let tree = app.workspace(), pending = boundary(tree, "TaxReports"); sameBoundary(initial, pending); busyBoundary(tree, true);
  assert.equal(button(renderReports(pending), "Schedule C").props.className, "active");
  finishRefresh(response(structuredClone(snapshot))); await save;
  tree = app.workspace(); const completed = boundary(tree, "TaxReports"); sameBoundary(initial, completed); busyBoundary(tree, false);
  assert.equal(button(renderReports(completed), "Schedule C").props.className, "active");
});
