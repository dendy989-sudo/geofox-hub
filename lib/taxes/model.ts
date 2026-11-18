import { TAX_CATEGORIES, type TaxRecord, type TaxReport, type TransactionData, type RuleData } from "./types.ts";

export function taxLabel(value: unknown): string { return String(value ?? "").replaceAll("_", " "); }
export function money(cents: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
export function normalizeVendor(value: unknown): string { return String(value ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
export function percentOf(cents: number, percent: number): number { return Math.sign(cents) * Math.round(Math.abs(cents) * Math.round(percent * 100) / 10000); }
export function parseAmountCents(value: string): number {
  const trimmed = value.trim();
  let normalized = /^\(.*\)$/.test(trimmed) ? `-${trimmed.slice(1, -1)}` : trimmed;
  normalized = normalized.replace(/^([+-]?)\$/, "$1");
  if (normalized.includes(",") && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Check the thousands separators in this amount.");
  const text = normalized.replaceAll(",", "");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Use a monetary amount with at most two decimal places.");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000_000) throw new Error("The amount is outside the supported range.");
  return negative ? -cents : cents;
}

export function scheduleLine(category: string, year: number): string {
  if (category === "other_expenses") return year >= 2025 ? "27b" : "27a";
  if (category === "energy_deduction") return year >= 2025 ? "27a" : year >= 2023 ? "27b" : "Review year form";
  if (category === "other_interest") return year >= 2026 ? "16c" : "16b";
  return TAX_CATEGORIES.find(item => item.id === category)?.line ?? "";
}
export function ruleMatches(rule: TaxRecord<RuleData> | TaxRecord, transaction: TaxRecord | TransactionData): boolean {
  if (rule.archived || rule.data.enabled === false) return false;
  const data = "data" in transaction ? transaction.data as TransactionData : transaction as TransactionData;
  const match = normalizeVendor(rule.data.match);
  if (!match) return false;
  const vendor = normalizeVendor(data.vendor || data.description);
  return rule.data.match_type === "exact" ? vendor === match : (` ${vendor} `).includes(` ${match} `);
}
export function applyRuleToTransaction(rule: TaxRecord, transaction: TransactionData): TransactionData {
  if (transaction.manual_override || !ruleMatches(rule, transaction)) return transaction;
  return { ...transaction,
    scope: rule.data.scope as TransactionData["scope"], business_id: rule.data.business_id as string | null,
    business_percent: Number(rule.data.business_percent), category: rule.data.category as TransactionData["category"],
    // A learned vendor identifies business purpose, but never silently approves a tax deduction.
    deduction_percent: rule.data.deduction_percent == null ? null : Number(rule.data.deduction_percent),
    deduction_confirmed: false, review_status: rule.data.scope !== "unresolved" && (!["business", "mixed"].includes(String(rule.data.scope)) || rule.data.category !== "uncategorized" && Boolean(rule.data.business_id)) ? "confirmed" : "needs_review", rule_id: rule.id,
  };
}

export function buildTaxReport(records: TaxRecord[], year: number, businessId: string | null = null): TaxReport {
  const lines = TAX_CATEGORIES.filter(item => item.id !== "uncategorized").map(item => ({ category: item.id as string, label: item.label as string, line: scheduleLine(item.id, year), book_cents: 0, deductible_cents: 0 }));
  const byCategory = new Map(lines.map(line => [line.category, line]));
  const incomeCategories = new Set(["gross_receipts", "other_income"]);
  const relevant = records.filter(record => !record.archived && record.tax_year === year && ["transaction", "adjustment"].includes(record.kind));
  let pending = 0, unreviewedDeductions = 0, recordCount = 0;
  for (const record of relevant) {
    const data = record.data;
    if (businessId && data.business_id !== businessId) {
      // Unclassified records are surfaced for every business rather than silently disappearing.
      if (data.scope === "unresolved") pending++;
      continue;
    }
    if (data.scope === "unresolved") { pending++; continue; }
    if (!["business", "mixed"].includes(String(data.scope))) continue;
    if (data.review_status !== "confirmed" || data.category === "uncategorized" || !data.business_id) { pending++; continue; }
    const line = byCategory.get(String(data.category));
    if (!line) { pending++; continue; }
    const amount = Number(data.amount_cents);
    const percent = Number(data.business_percent);
    if (!Number.isSafeInteger(amount) || !Number.isFinite(percent)) { pending++; continue; }
    const businessCents = percentOf(amount, percent);
    const signedBook = incomeCategories.has(line.category) ? businessCents : -businessCents;
    line.book_cents += signedBook;
    if (incomeCategories.has(line.category) || line.category === "returns_allowances") line.deductible_cents += signedBook;
    else if (data.deduction_confirmed === true && typeof data.deduction_percent === "number") line.deductible_cents += percentOf(signedBook, data.deduction_percent);
    else unreviewedDeductions++;
    recordCount++;
  }
  const returns = byCategory.get("returns_allowances")?.book_cents ?? 0;
  const income = lines.filter(line => incomeCategories.has(line.category)).reduce((sum, line) => sum + line.book_cents, 0) - returns;
  const expenses = lines.filter(line => !incomeCategories.has(line.category) && line.category !== "returns_allowances").reduce((sum, line) => sum + line.book_cents, 0);
  const deductible = lines.filter(line => !incomeCategories.has(line.category) && line.category !== "returns_allowances").reduce((sum, line) => sum + line.deductible_cents, 0);
  const warnings: string[] = [];
  if (pending) warnings.push(`${pending} transaction${pending === 1 ? "" : "s"} still need review and are excluded from these totals.`);
  if (unreviewedDeductions) warnings.push(`${unreviewedDeductions} business expense${unreviewedDeductions === 1 ? "" : "s"} have no confirmed deduction treatment; they appear in book expenses only.`);
  if (!businessId) warnings.push("Select one business to prepare its Schedule C worksheet. Combined business totals are a management report.");
  const business = records.find(record => record.kind === "business" && record.id === businessId);
  const yearRecord = records.find(record => record.kind === "year" && record.tax_year === year);
  const override = yearRecord?.data.business_treatments as Record<string, string> | undefined;
  const treatment = (businessId && override?.[businessId]) || business?.data.reporting_treatment;
  if (businessId && (!treatment || treatment === "needs_review" || treatment === "unknown")) warnings.push("Confirm this year's business reporting treatment before using a Schedule C. Spouse ownership, partnerships and LLC elections can require other returns or separate schedules.");
  if (["partnership", "s_corporation", "c_corporation", "other"].includes(String(treatment))) warnings.push("The selected reporting treatment does not map to a single Schedule C. Use this business P&L to prepare the appropriate entity return with your tax professional.");
  if (["qualified_joint_venture", "community_property"].includes(String(treatment))) warnings.push("Confirm each spouse's allocation and filing treatment. This report shows the full business totals and does not allocate separate spouse schedules or self-employment tax.");
  if (lines.some(line => ["car_truck", "depreciation", "cost_of_goods", "home_office", "energy_deduction"].includes(line.category) && line.book_cents)) warnings.push("Vehicle method, depreciation, inventory, energy deductions and business use of home need supporting worksheets and year-specific review; the app does not calculate these elections or limits.");
  if (year >= 2026) warnings.push("2026 is a working-year worksheet. Check the final IRS form and instructions before filing.");
  return { year, businessId, income_cents: income, expenses_cents: expenses, profit_cents: income - expenses,
    deductible_expenses_cents: deductible, draft_profit_cents: income - deductible,
    pending_count: pending, unreviewed_deductions_count: unreviewedDeductions, lines, warnings,
    sourceUrl: year >= 2026 ? "https://www.irs.gov/pub/irs-pdf/f1040sc.pdf" : `https://www.irs.gov/pub/irs-prior/f1040sc--${year}.pdf`, record_count: recordCount };
}

/** A balance snapshot already contains all activity on or before its date. Do not count that activity twice. */
export function irsBalance(records: TaxRecord[], year: number): { balance_cents: number; known: boolean; as_of: string | null; entries_count: number; snapshot_date: string | null } {
  const entries = records.filter(record => !record.archived && record.kind === "irs_entry" && record.tax_year === year)
    .sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)) || a.created_at.localeCompare(b.created_at));
  const opening = entries.filter(record => record.data.type === "opening_balance" && record.data.affects_balance !== false).at(-1);
  let balance = opening ? Number(opening.data.amount_cents) : 0;
  let known = Boolean(opening), lastDate = opening ? String(opening.data.date) : null;
  for (const entry of entries) {
    const data = entry.data;
    if (data.type === "opening_balance" || (opening && String(data.date) <= String(opening.data.date))) continue;
    if (data.affects_balance === false) continue;
    const sign = ["assessment", "penalty", "interest"].includes(String(data.type)) ? 1 : ["payment", "credit", "abatement"].includes(String(data.type)) ? -1 : data.type === "refund" && data.affects_balance === true ? 1 : 0;
    if (!sign) continue;
    balance += sign * Number(data.amount_cents); if (data.type === "assessment") known = true; lastDate = String(data.date);
  }
  return { balance_cents: balance, known, as_of: lastDate, entries_count: entries.length, snapshot_date: opening ? String(opening.data.date) : null };
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
