import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = new URL("../", import.meta.url).pathname;
const cache = new Map();
function load(relative) {
  const candidate = resolve(root, relative);
  const filename = [candidate, `${candidate}.tsx`, `${candidate}.ts`].find(existsSync);
  if (!filename) throw new Error(`Missing UI module: ${relative}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: module.exports, module,
    fetch: () => { assert.fail("Rendering tax records must not contact AI or mutate records"); },
    require: name => name.endsWith(".css") ? {} : name.startsWith("@/") ? load(name.slice(2)) : name.startsWith(".") ? load(resolve(dirname(filename), name)) : require(name),
  }, { filename });
  return module.exports;
}
const snapshot = { records: [], year: 2020, user: { id: "test-owner", display_name: "Owner" }, aiAvailable: true, audit: [] };
const record = (id, kind, data, year = 2020) => ({ id, kind, tax_year: year, title: "Test record", data, version: 1, archived: false, created_at: "2026-11-18T12:00:00Z", updated_at: "2026-11-18T12:00:00Z" });
const props = data => ({ snapshot: data, notify() {}, onRefresh: async () => { assert.fail("Rendering must not refresh private records"); } });

test("statement intake initially requires an account and AI opt-in without reading a file", () => {
  const { TaxImportPanel } = load("components/taxes/import-panel.tsx");
  const html = renderToStaticMarkup(React.createElement(TaxImportPanel, props(snapshot)));
  assert.match(html, /Add a bank or card/);
  assert.match(html, /type="file"/);
  assert.match(html, /value="2018"/);
  assert.match(html, /value="2026"/);
  const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.doesNotMatch(checkbox, /checked/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[^]*?Upload &amp; review/);
});

test("assistant displays proposals as escaped reviewable text and does not expose other years", () => {
  const { TaxAssistantPanel } = load("components/taxes/assistant-panel.tsx");
  const proposal = { id: "new-rule", kind: "rule", tax_year: null, title: "League rule", data: { match: "LEAGUE", match_type: "contains", scope: "business", category: "other_expenses", notes: "<img src=x onerror=bad()>" } };
  const data = { ...snapshot, records: [record("chat-one", "chat", { message: "<script>bad()</script>", reply: "Check this suggestion first.", questions: [], proposals: [proposal] }), record("chat-other", "chat", { message: "Other-year private details", reply: "Secret reply", questions: [], proposals: [] }, 2019)] };
  const html = renderToStaticMarkup(React.createElement(TaxAssistantPanel, props(data)));
  assert.match(html, /Apply this change/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img |Other-year private details|Secret reply/);
  assert.match(html, /LEAGUE/);
  assert.match(html, /Other expenses \/ league fees/);
});

test("an already applied stable proposal is not offered for repeated saving", () => {
  const { TaxAssistantPanel } = load("components/taxes/assistant-panel.tsx");
  const rule = record("rule-one", "rule", { match: "LEAGUE", enabled: true }, null);
  rule.title = "League rule";
  const proposal = { id: rule.id, kind: rule.kind, tax_year: null, title: rule.title, data: rule.data };
  const data = { ...snapshot, records: [rule, record("chat-one", "chat", { message: "Create a rule", reply: "Here is a suggestion", proposals: [proposal], questions: [] })] };
  const html = renderToStaticMarkup(React.createElement(TaxAssistantPanel, props(data)));
  assert.match(html, /This change has been saved/);
  assert.doesNotMatch(html, /Apply this change/);
});

test("supporting IRS documents retain private originals without offering transaction extraction", () => {
  const { TaxImportPanel } = load("components/taxes/import-panel.tsx");
  const notice = record("notice-one", "statement", { document_type: "notice", file_name: "IRS notice.pdf", status: "uploaded", mime_type: "application/pdf", account_id: null, sha256: "a".repeat(64), size_bytes: 2048 });
  const html = renderToStaticMarkup(React.createElement(TaxImportPanel, props({ ...snapshot, records: [notice] })));
  assert.match(html, /IRS notice.pdf/);
  assert.match(html, /Original saved/);
  assert.match(html, /Original file details/);
  assert.match(html, /SHA-256 fingerprint/);
  assert.doesNotMatch(html, /Review transactions/);
  assert.doesNotMatch(html, /Account not available/);
});

test("bulk editor offers explicit classifications, category and opt-in future merchant rule",()=>{
  const {TaxBulkEditDialog}=load("components/taxes/bulk-edit-dialog.tsx");
  const items=[record("tx1","transaction",{vendor:"UPSL League Fee",description:"UPSL league",date:"2024-04-01",amount_cents:-10000,review_status:"needs_review"},2024),record("tx2","transaction",{vendor:"UPSL League Fee",description:"UPSL league",date:"2024-05-01",amount_cents:-10000,review_status:"needs_review"},2024)];
  const business=record("business","business",{reporting_treatment:"needs_review"},null);
  const html=renderToStaticMarkup(React.createElement(TaxBulkEditDialog,{items,businesses:[business],rules:[],onClose(){},onApply:async()=>{assert.fail("Only explicit submit may edit");}}));
  assert.match(html,/Bulk edit/);assert.match(html,/Personal/);assert.match(html,/Mixed personal and business/);
  assert.match(html,/Remember this vendor next time/);assert.match(html,/UPSL LEAGUE FEE/);
  assert.doesNotMatch(html,/<input[^>]*type="checkbox"[^>]*checked/); // never preselect a reusable rule
});
