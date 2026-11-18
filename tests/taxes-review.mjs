import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRuleToTransaction, buildTaxReport, csvCell, irsBalance,
  normalizeVendor, parseAmountCents, percentOf, ruleMatches, scheduleLine,
} from "../lib/taxes/model.ts";
import { TAX_YEARS } from "../lib/taxes/types.ts";
import { parseBankDate, parseStatementCsv, readCsv } from "../lib/taxes/csv.ts";
import { validateTaxSave } from "../lib/taxes/validation.ts";
import { INVENTORY_FIELDS, inventoryWorksheet, itemizedOtherExpenses } from "../lib/taxes/schedule-worksheet.ts";

const timestamp = "2026-11-18T15:00:00Z";
function record(id, kind, data = {}, extra = {}) {
  return { id, kind, tax_year: 2020, title: id, data, version: 1, archived: false,
    created_at: timestamp, updated_at: timestamp, ...extra };
}
function business(id = "soccer", treatment = "needs_review") {
  return record(id, "business", { reporting_treatment: treatment }, { tax_year: null });
}
function transaction(id, amount, category = "supplies", data = {}, extra = {}) {
  return record(id, "transaction", {
    date: "2020-05-01", amount_cents: amount, account_id: "checking", statement_id: null,
    description: id, vendor: id, scope: "business", business_id: "soccer",
    business_percent: 100, category, review_status: "confirmed", deduction_percent: 100,
    deduction_confirmed: true, notes: "", source: "manual", rule_id: null,
    manual_override: false, ...data,
  }, extra);
}
function irs(id, type, amount, date, extra = {}) {
  return record(id, "irs_entry", { type, amount_cents: amount, date, ...extra });
}
function rule(data = {}, extra = {}) {
  return record("upsl-rule", "rule", { match: "UPSL", match_type: "contains", scope: "business",
    business_id: "soccer", business_percent: 100, category: "other_expenses",
    deduction_percent: 100, deduction_confirmed: false, enabled: true, notes: "League fees", ...data },
    { tax_year: null, ...extra });
}

test("requested tax range includes all nine distinct calendar years", () => {
  assert.deepEqual(TAX_YEARS, [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
});

test("Schedule C semantic categories keep historical line numbers and 2026 interest split", () => {
  for (let year = 2018; year <= 2024; year++) assert.equal(scheduleLine("other_expenses", year), "27a");
  for (const year of [2025, 2026]) assert.equal(scheduleLine("other_expenses", year), "27b");
  assert.equal(scheduleLine("energy_deduction", 2024), "27b");
  assert.equal(scheduleLine("energy_deduction", 2025), "27a");
  assert.equal(scheduleLine("other_interest", 2025), "16b");
  assert.equal(scheduleLine("other_interest", 2026), "16c");
  assert.equal(scheduleLine("vehicle_loan_interest", 2026), "16b");
});

test("merchant refunds reverse book expenses and their confirmed deductible share", () => {
  const rows = [business(), transaction("equipment", -10000), transaction("refund", 2500)];
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.expenses_cents, 7500);
  assert.equal(report.deductible_expenses_cents, 7500);
  assert.equal(report.profit_cents, -7500);
});

test("a refund exactly cancels its original mixed allocation, including half-cent rounding", () => {
  const rows = [business(), transaction("small", -1, "supplies", { scope: "mixed", business_percent: 50 }),
    transaction("small-refund", 1, "supplies", { scope: "mixed", business_percent: 50 })];
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.expenses_cents, 0);
  assert.equal(report.deductible_expenses_cents, 0);
  assert.equal(percentOf(-12345, 60), -percentOf(12345, 60));
});

test("returns and allowances reduce receipts without requiring expense deduction approval", () => {
  const rows = [business(), transaction("sales", 100000, "gross_receipts"),
    transaction("customer-refund", -10000, "returns_allowances", { deduction_confirmed: false, deduction_percent: null }),
    transaction("cogs", -20000, "cost_of_goods"), transaction("supplies", -15000),
    transaction("home", -5000, "home_office")];
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.income_cents, 90000);
  assert.equal(report.expenses_cents, 40000);
  assert.equal(report.profit_cents, 50000);
  assert.equal(report.draft_profit_cents, 50000);
  assert.equal(report.unreviewed_deductions_count, 0);
});

test("book P&L and tax worksheet keep mixed use and unconfirmed deductions distinct", () => {
  const rows = [business(), transaction("income", 100000, "gross_receipts"),
    transaction("meal", -10000, "meals", { scope: "mixed", business_percent: 60, deduction_percent: 50 }),
    transaction("pending-tax-treatment", -5000, "car_truck", { deduction_confirmed: false })];
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.income_cents, 100000);
  assert.equal(report.expenses_cents, 11000);
  assert.equal(report.profit_cents, 89000);
  assert.equal(report.deductible_expenses_cents, 3000);
  assert.equal(report.draft_profit_cents, 97000);
  assert.equal(report.unreviewed_deductions_count, 1);
});

test("personal spending, funding, account transfers and IRS activity never become operating costs", () => {
  const excludedScopes = ["personal", "transfer", "loan", "owner_contribution", "owner_draw", "tax_payment", "tax_refund", "relief", "excluded"];
  const rows = [business(), ...excludedScopes.map((scope, index) => transaction(scope, index % 2 ? 900000 : -900000, "supplies", { scope })),
    transaction("valid", -1000)];
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.expenses_cents, 1000);
  assert.equal(report.income_cents, 0);
  assert.equal(report.record_count, 1);
});

test("year and business selection exclude unrelated and archived records while surfacing unresolved items", () => {
  const rows = [business(), business("apps"), transaction("valid", 10000, "gross_receipts"),
    transaction("other-business", 900000, "gross_receipts", { business_id: "apps" }),
    transaction("other-year", 900000, "gross_receipts", {}, { tax_year: 2021 }),
    transaction("archived", 900000, "gross_receipts", {}, { archived: true }),
    transaction("unknown", -7000, "uncategorized", { scope: "unresolved", business_id: null }),
    transaction("awaiting-review", -3000, "supplies", { review_status: "needs_review" })];
  const original = structuredClone(rows);
  const report = buildTaxReport(rows, 2020, "soccer");
  assert.equal(report.income_cents, 10000);
  assert.equal(report.expenses_cents, 0);
  assert.equal(report.pending_count, 2);
  assert.deepEqual(rows, original, "Reports do not mutate saved data");
});

test("unresolved business structure remains visible in draft reports", () => {
  const report = buildTaxReport([business(), transaction("income", 10000, "gross_receipts")], 2020, "soccer");
  assert.ok(report.warnings.some(message => /reporting treatment/i.test(message)));
  assert.equal(report.sourceUrl, "https://www.irs.gov/pub/irs-prior/f1040sc--2020.pdf");
  const combined = buildTaxReport([business()], 2020);
  assert.ok(combined.warnings.some(message => /management report/i.test(message)));
  for (const treatment of ["partnership", "s_corporation", "c_corporation"]) {
    const entityReport = buildTaxReport([business("soccer", treatment)], 2020, "soccer");
    assert.ok(entityReport.warnings.some(message => /does not map to a single Schedule C/i.test(message)), treatment);
  }
});

test("IRS snapshot excludes historical and same-day activity before applying later changes", () => {
  const rows = [irs("assessment-before", "assessment", 999999, "2020-01-01"),
    irs("payment-before", "payment", 40000, "2020-04-01"),
    irs("snapshot", "opening_balance", 200000, "2020-05-01"),
    irs("same-day", "payment", 90000, "2020-05-01"),
    irs("penalty", "penalty", 10000, "2020-06-01"),
    irs("payment", "payment", 50000, "2020-06-02"),
    irs("credit", "credit", 20000, "2020-06-03"),
    irs("stimulus", "stimulus", 120000, "2020-06-04"),
    irs("ppp", "ppp_received", 1000000, "2020-06-04")];
  const result = irsBalance(rows, 2020);
  assert.equal(result.balance_cents, 140000);
  assert.equal(result.known, true);
  assert.equal(result.snapshot_date, "2020-05-01");
  assert.equal(result.as_of, "2020-06-03");
});

test("latest IRS balance snapshot replaces earlier snapshots and subsequent history", () => {
  const rows = [irs("first", "opening_balance", 200000, "2020-01-01"),
    irs("payment", "payment", 50000, "2020-02-01"),
    irs("later", "opening_balance", 170000, "2020-03-01"),
    irs("interest", "interest", 1000, "2020-03-02")];
  assert.equal(irsBalance(rows, 2020).balance_cents, 171000);
});

test("a payment alone does not establish the taxpayer's complete IRS balance", () => {
  assert.equal(irsBalance([], 2020).known, false);
  assert.equal(irsBalance([irs("payment", "payment", 50000, "2020-01-01")], 2020).known, false);
});

test("IRS refunds consume a recorded credit only when explicitly marked as affecting this balance", () => {
  const start = irs("credit-balance", "opening_balance", -25000, "2020-01-01");
  const refund = irs("refund", "refund", 25000, "2020-01-02");
  assert.equal(irsBalance([start, refund], 2020).balance_cents, -25000);
  assert.equal(irsBalance([start, { ...refund, data: { ...refund.data, affects_balance: true } }], 2020).balance_cents, 0);
});

test("an excluded opening-balance note never resets the recorded IRS balance", () => {
  const rows = [irs("actual", "opening_balance", 200000, "2020-01-01"),
    irs("payment", "payment", 50000, "2020-02-01"),
    irs("for-reference", "opening_balance", 999999, "2020-03-01", { affects_balance: false })];
  const result = irsBalance(rows, 2020);
  assert.equal(result.balance_cents, 150000);
  assert.equal(result.snapshot_date, "2020-01-01");
  assert.equal(irsBalance([rows[2]], 2020).known, false);
});

test("vendor matching is normalized, word-bounded and independent of payment account", () => {
  assert.equal(normalizeVendor("  upsl---LEAGUE  "), "UPSL LEAGUE");
  for (const account_id of ["personal-bank", "business-bank", null]) {
    assert.equal(ruleMatches(rule(), transaction("fee", -10000, "uncategorized", { account_id, vendor: "UPSL LEAGUE FEE" })), true);
  }
  for (const vendor of ["SUPSL", "UPSLATER", "SOME OTHER MERCHANT"]) {
    assert.equal(ruleMatches(rule(), transaction("fee", -10000, "uncategorized", { vendor })), false);
  }
  assert.equal(ruleMatches(rule({}, { archived: true }), transaction("UPSL", -1000)), false);
  assert.equal(ruleMatches(rule({ enabled: false }), transaction("UPSL", -1000)), false);
});

test("manual exceptions beat remembered rules and learned rules do not approve tax deductions", () => {
  const manual = transaction("UPSL", -10000, "supplies", { manual_override: true, scope: "personal", business_id: null }).data;
  assert.deepEqual(applyRuleToTransaction(rule(), manual), manual);
  const raw = transaction("UPSL", -10000, "uncategorized", { scope: "unresolved", business_id: null }).data;
  const applied = applyRuleToTransaction(rule(), raw);
  assert.equal(applied.business_id, "soccer");
  assert.equal(applied.category, "other_expenses");
  assert.equal(applied.rule_id, "upsl-rule");
  assert.equal(applied.deduction_confirmed, false);
  assert.equal(raw.scope, "unresolved");
  const personal = applyRuleToTransaction(rule({ scope: "personal", business_id: null, category: "uncategorized", business_percent: 0 }), raw);
  assert.equal(personal.review_status, "confirmed", "A specific personal vendor rule does not require a business tax category");
  assert.equal(personal.deduction_confirmed, false);
});

test("exact cent parsing and spreadsheet exports preserve values without executable formula cells", () => {
  for (const [input, expected] of [["0.29", 29], ["$1,234.56", 123456], ["(1,234.56)", -123456], ["($1,234.56)", -123456], ["-$1,234.56", -123456], ["-0.01", -1]]) {
    assert.equal(parseAmountCents(input), expected);
  }
  for (const input of ["", "1e3", "NaN", "Infinity", "1.005", "1,23", "12,34,567.89", "1,2345", "9007199254740991"]) {
    assert.throws(() => parseAmountCents(input));
  }
  assert.equal(csvCell('a"b'), '"a""b"');
  for (const value of ["=SUM(A1)", "+cmd", "-cmd", "@SUM(A1)", "\t=cmd", "\r=cmd"]) {
    assert.equal(csvCell(value).startsWith('"\''), true);
  }
});

test("CSV extraction preserves quoted commas, escaped quotes and multiline merchant evidence", () => {
  const input = '\uFEFFDate,Description,Amount\r\n01/15/2020,"UPSL, League ""A""\nSeason fee",-100.05\r\n01/16/2020,"Team dues","$1,234.56"\r\n';
  const parsed = parseStatementCsv(input, 2020);
  assert.equal(parsed.needs_mapping, false);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].description, 'UPSL, League "A"\nSeason fee');
  assert.equal(parsed.rows[0].amount_cents, -10005);
  assert.equal(parsed.rows[1].amount_cents, 123456);
  assert.deepEqual(parsed.rows.map(value => value.source_row), [2, 3]);
  assert.throws(() => readCsv('Date,Description,Amount\n01/01/2020,"unclosed,-1'), /not closed/);
});

test("debit and credit mapping normalizes direction and refuses ambiguous double-sided rows", () => {
  const input = "Date,Description,Debit,Credit\n01/01/2020,Field rental,100.25,\n01/02/2020,Dues,,200.00";
  const parsed = parseStatementCsv(input, 2020);
  assert.deepEqual(parsed.rows.map(value => value.amount_cents), [-10025, 20000]);
  const reverse = parseStatementCsv("Date,Description,Amount\n01/01/2020,Card purchase,100.25", 2020,
    { date: "Date", description: "Description", amount: "Amount", invert_amount: true });
  assert.equal(reverse.rows[0].amount_cents, -10025);
  assert.throws(() => parseStatementCsv("Date,Description,Debit,Credit\n01/01/2020,Ambiguous,10,20", 2020), /one nonzero/);
  assert.throws(() => parseStatementCsv("Date,Description,Debit,Credit\n01/01/2020,Bad sign,-10,", 2020), /positive debit/);
});

test("CSV date formats are explicit and invalid dates or wrong-year rows are never normalized away", () => {
  assert.equal(parseBankDate("10/11/2020", "mdy"), "2020-10-11");
  assert.equal(parseBankDate("10/11/2020", "dmy"), "2020-11-10");
  assert.equal(parseBankDate("2020/2/29", "ymd"), "2020-02-29");
  assert.equal(parseBankDate("01/02/18", "mdy"), "2018-01-02");
  for (const input of ["2021-02-29", "2020-11-31", "2020-00-01", "2020-01-00"]) assert.throws(() => parseBankDate(input));
  assert.throws(() => parseStatementCsv("Date,Description,Amount\n12/31/2019,Prior year,-100", 2020), /belongs to 2019/);
});

test("unknown CSV layouts stay reviewable and malformed rows are never silently dropped", () => {
  const unmapped = parseStatementCsv("Booked,Details,Value\n2020-01-01,League fee,-100", 2020);
  assert.equal(unmapped.needs_mapping, true);
  assert.equal(unmapped.rows.length, 0);
  assert.equal(unmapped.sample.length, 1);
  const mapped = parseStatementCsv("Booked,Details,Value\n2020-01-01,League fee,-100", 2020,
    { date: "Booked", description: "Details", amount: "Value", date_format: "ymd" });
  assert.equal(mapped.rows[0].amount_cents, -10000);
  assert.equal(parseStatementCsv("Date,Description,Amount\n01/01/2020,Fee,-1", 2020, undefined, true).needs_mapping, true);
  assert.throws(() => parseStatementCsv("Date,Description,Amount\n01/01/2020,Fee,-1,extra", 2020), /different number of columns/);
  assert.throws(() => parseStatementCsv("Date,Description,Amount,Amount\n01/01/2020,Fee,-1,-1", 2020), /duplicate column headings/);
});

test("same-day equal charges keep distinct source rows and the import cap rejects rather than truncates", () => {
  const header = "Date,Description,Amount\n";
  const row = "01/01/2020,UPSL league,-100";
  const duplicates = parseStatementCsv(header + [row, row].join("\n"), 2020);
  assert.equal(duplicates.rows.length, 2);
  assert.notEqual(duplicates.rows[0].source_row, duplicates.rows[1].source_row);
  assert.equal(parseStatementCsv(header + Array(2000).fill(row).join("\n"), 2020).rows.length, 2000);
  assert.throws(() => parseStatementCsv(header + Array(2001).fill(row).join("\n"), 2020), /more than 2,000/);
});

const businessUuid = "30000000-0000-4000-8000-000000000001";
function validSave(data = {}, extra = {}) {
  return { kind: "transaction", tax_year: 2020, title: "League fee", data: { date: "2020-01-01", amount_cents: -10000,
    business_id: businessUuid, scope: "business", business_percent: 100, category: "other_expenses", review_status: "confirmed",
    deduction_confirmed: false, deduction_percent: null, ...data }, ...extra };
}

test("validation requires a reviewed business category and a real deduction percentage", () => {
  assert.throws(() => validateTaxSave(validSave({ category: "uncategorized" })), /categor/i);
  assert.equal(validateTaxSave(validSave({ category: "uncategorized", review_status: "needs_review" })).data.review_status, "needs_review");
  assert.throws(() => validateTaxSave(validSave({ deduction_confirmed: true, deduction_percent: null })), /percentage/);
  assert.throws(() => validateTaxSave(validSave({ deduction_percent: 101 })));
  assert.throws(() => validateTaxSave(validSave({ deduction_percent: 33.333 })));
  assert.throws(() => validateTaxSave(validSave({ scope: "business", business_percent: 50 })), /Mixed/);
  assert.throws(() => validateTaxSave(validSave({ business_id: null })), /business/);
  assert.throws(() => validateTaxSave(validSave({ category: "pretend_category" })));
  assert.throws(() => validateTaxSave({ ...validSave(), user_id: businessUuid }));
});

test("personal transactions reject deduction claims and remain valid without a tax category", () => {
  const personal = { scope: "personal", business_id: null, category: "uncategorized", business_percent: 75 };
  assert.throws(() => validateTaxSave(validSave({ ...personal, deduction_confirmed: true, deduction_percent: 100 })), /deduction/i);
  const saved = validateTaxSave(validSave(personal));
  assert.equal(saved.data.business_percent, 0);
  assert.equal(saved.data.deduction_percent, null);
  assert.equal(saved.data.deduction_confirmed, false);
});

test("unknown ownership stays unknown and rules cannot target a missing or malformed business", () => {
  const businessRecord = validateTaxSave({ kind: "business", tax_year: null, title: "Soccer club", data: {} });
  assert.equal(businessRecord.data.owner_share_percent, null);
  assert.equal(businessRecord.data.reporting_treatment, "needs_review");
  for (const business_id of [null, "not-a-uuid"]) {
    assert.throws(() => validateTaxSave({ kind: "rule", tax_year: null, title: "League fees", data: { match: "UPSL", scope: "business", business_id } }));
  }
});

test("IRS payment dates may follow their tax year while only a balance snapshot accepts a credit balance", () => {
  const value = { kind: "irs_entry", tax_year: 2018, title: "Payment", data: { type: "payment", date: "2020-06-01", amount_cents: 50000 } };
  assert.equal(validateTaxSave(value).data.affects_balance, true);
  assert.throws(() => validateTaxSave({ ...value, data: { ...value.data, amount_cents: -100 } }), /positive IRS activity/);
  const credit = validateTaxSave({ ...value, data: { ...value.data, type: "opening_balance", amount_cents: -100 } });
  assert.equal(credit.data.amount_cents, -100);
  assert.equal(validateTaxSave({ ...value, data: { ...value.data, type: "stimulus" } }).data.affects_balance, false);
  assert.throws(() => validateTaxSave(validSave({ date: "2019-12-31" })), /selected tax year/);
});

test("inventory blanks stay unknown while verified zeroes produce a zero COGS worksheet", () => {
  const unknown = inventoryWorksheet({});
  for (const key of ["opening", "netPurchases", "labor", "materials", "other", "available", "closing", "costOfGoods"]) {
    assert.equal(unknown[key], null, key);
  }
  assert.equal(unknown.issue, null);
  const zeroes = Object.fromEntries(INVENTORY_FIELDS.map(([key]) => [key, 0]));
  const emptyInventory = inventoryWorksheet(zeroes);
  assert.equal(emptyInventory.available, 0);
  assert.equal(emptyInventory.costOfGoods, 0);
  assert.equal(emptyInventory.issue, null);
  for (const [missing] of INVENTORY_FIELDS) {
    assert.equal(inventoryWorksheet({ ...zeroes, [missing]: null }).costOfGoods, null, missing);
  }
  assert.equal(inventoryWorksheet({ ...zeroes, purchases_cents: "0" }).netPurchases, null);
});

test("inventory purchases subtract personal withdrawals before line 40 and closing inventory before line 42", () => {
  const data = { opening_inventory_cents: 10000, purchases_cents: 50000, personal_withdrawals_cents: 5000,
    cost_of_labor_cents: 12000, materials_cents: 3000, other_costs_cents: 2000, closing_inventory_cents: 17000 };
  const before = structuredClone(data);
  const result = inventoryWorksheet(data);
  assert.equal(result.netPurchases, 45000);
  assert.equal(result.available, 72000);
  assert.equal(result.costOfGoods, 55000);
  assert.equal(result.issue, null);
  assert.deepEqual(data, before, "Calculating a worksheet does not change saved facts");
});

test("personal withdrawals can use opening inventory while negative final COGS remains a visible issue", () => {
  const zeroes = Object.fromEntries(INVENTORY_FIELDS.map(([key]) => [key, 0]));
  const withdrawals = inventoryWorksheet({ ...zeroes, opening_inventory_cents: 10000, personal_withdrawals_cents: 1000, closing_inventory_cents: 9000 });
  assert.equal(withdrawals.netPurchases, -1000);
  assert.equal(withdrawals.available, 9000);
  assert.equal(withdrawals.costOfGoods, 0);
  assert.equal(withdrawals.issue, null, "A personal withdrawal from opening inventory is not an impossible cost calculation");
  const excessiveClosing = inventoryWorksheet({ ...zeroes, purchases_cents: 10000, closing_inventory_cents: 10001 });
  assert.equal(excessiveClosing.costOfGoods, -1);
  assert.match(excessiveClosing.issue, /closing inventory exceeds/i);
});

test("Part V preserves signed rounded refunds and reconciles to the same business and year report total", () => {
  const rows = [business(),
    transaction("league", -10001, "other_expenses", { scope: "mixed", business_percent: 66.67, deduction_percent: 50, vendor: "UPSL", notes: "League registration" }),
    transaction("league-refund", 2501, "other_expenses", { scope: "mixed", business_percent: 66.67, deduction_percent: 50 }),
    transaction("one-cent", -1, "other_expenses", { scope: "mixed", business_percent: 50, deduction_percent: 50 }),
    transaction("one-cent-refund", 1, "other_expenses", { scope: "mixed", business_percent: 50, deduction_percent: 50 }),
    transaction("manual-adjustment", -20000, "other_expenses", { vendor: "", source_reference: "Receipt #100" }, { kind: "adjustment" }),
    transaction("classification-pending", -90000, "other_expenses", { review_status: "needs_review" }),
    transaction("deduction-pending", -90000, "other_expenses", { deduction_confirmed: false }),
    transaction("personal", -90000, "other_expenses", { scope: "personal" }),
    transaction("different-business", -90000, "other_expenses", { business_id: "apps" }),
    transaction("different-year", -90000, "other_expenses", {}, { tax_year: 2021 }),
    transaction("archived", -90000, "other_expenses", {}, { archived: true }),
    transaction("other-category", -90000, "supplies"),
  ];
  const before = structuredClone(rows);
  const items = itemizedOtherExpenses(rows, 2020, "soccer");
  assert.equal(items.length, 5);
  assert.equal(items.find(item => item.id === "league").cents, 3334);
  assert.equal(items.find(item => item.id === "league-refund").cents, -834);
  assert.equal(items.find(item => item.id === "league").purpose, "League registration");
  assert.equal(items.find(item => item.id === "manual-adjustment").purpose, "Receipt #100");
  const total = items.reduce((sum, item) => sum + item.cents, 0);
  assert.equal(total, 22500);
  assert.equal(total, buildTaxReport(rows, 2020, "soccer").lines.find(line => line.category === "other_expenses").deductible_cents);
  assert.deepEqual(rows, before, "Itemization does not change saved records");
});
