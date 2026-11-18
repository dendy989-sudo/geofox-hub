import assert from "node:assert/strict";
import test from "node:test";
import { selectTaxAssistantEvidence, taxProposalMatchesYear } from "../lib/taxes/assistant-policy.ts";

const record = (id, kind, taxYear, data = {}, archived = false) => ({
  id, kind, tax_year: taxYear, data, archived, title: id, version: 1,
  created_at: "2026-11-18T00:00:00Z", updated_at: "2026-11-18T00:00:00Z",
});

test("assistant evidence contains the selected year and reusable metadata only", () => {
  const records = [
    record("current-year", "year", 2020, { notes: "Current filing notes" }),
    record("other-year", "year", 2019, { notes: "Unrelated filing notes" }),
    record("current-transaction", "transaction", 2020, { description: "Equipment purchase" }),
    record("other-transaction", "transaction", 2019, { description: "Equipment purchase" }),
    record("business", "business", null), record("account", "account", null),
    record("global-rule", "rule", null), record("archived-rule", "rule", null, {}, true),
    record("dependent", "dependent", 2020), record("prior-chat", "chat", 2020),
  ];
  const selected = selectTaxAssistantEvidence(records, 2020, "equipment");
  assert.deepEqual(selected.transactions.map(item => item.id), ["current-transaction"]);
  assert.deepEqual(selected.metadata.map(item => item.id), ["current-year", "business", "account", "global-rule"]);
  assert.deepEqual(selected.evidence.map(item => item.id), ["current-year", "business", "account", "global-rule", "current-transaction"]);
});

test("assistant proposals cannot edit records from another year or change kind", () => {
  for (const kind of ["year", "transaction"]) {
    assert.equal(taxProposalMatchesYear(record("current", kind, 2020), kind, 2020), true);
    assert.equal(taxProposalMatchesYear(record("other", kind, 2019), kind, 2020), false);
    assert.equal(taxProposalMatchesYear(record("archived", kind, 2020, {}, true), kind, 2020), false);
  }
  assert.equal(taxProposalMatchesYear(record("rule", "rule", null), "rule", 2020), true);
  assert.equal(taxProposalMatchesYear(record("year", "year", 2020), "rule", 2020), false);
});

test("assistant evidence bounds transaction context without dropping global rules", () => {
  const records = [record("rule", "rule", null), record("current-year", "year", 2020),
    record("ordinary", "transaction", 2020, { description: "Supplies" }),
    record("matched", "transaction", 2020, { description: "Equipment", review_status: "needs_review" })];
  const selected = selectTaxAssistantEvidence(records, 2020, "Equipment", 1);
  assert.equal(selected.transactions.length, 2);
  assert.deepEqual(selected.visible.map(item => item.id), ["matched"]);
  assert.deepEqual(selected.evidence.map(item => item.id), ["rule", "current-year", "matched"]);
});
