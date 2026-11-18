export const TAX_YEARS = Array.from({ length: 9 }, (_, index) => 2018 + index);
export const TAX_KINDS = ["year", "business", "account", "statement", "transaction", "rule", "dependent", "irs_entry", "adjustment", "chat"] as const;
export type TaxKind = typeof TAX_KINDS[number];
export type TaxData = Record<string, unknown>;
export interface TaxRecord<D extends TaxData = TaxData> {
  id: string; kind: TaxKind; tax_year: number | null; title: string; data: D;
  version: number; archived: boolean; created_at: string; updated_at: string;
}
export interface TaxSave {
  id?: string; kind: TaxKind; tax_year: number | null; title: string; data: TaxData; version?: number;
}
export interface TaxSnapshot {
  records: TaxRecord[]; year: number; user: { id: string; display_name: string }; aiAvailable: boolean;
  audit: TaxAudit[];
}
export interface TaxAudit { id: string; record_id: string; action: string; created_at: string; record_title: string; }
export const FILING_STATUSES = ["unknown", "not_filed", "gathering", "ready_to_file", "filed", "needs_amendment", "amendment_in_progress", "amended"] as const;
export const RETURN_STATUSES = ["unknown", "single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"] as const;
export const TRANSACTION_SCOPES = ["unresolved", "business", "personal", "mixed", "transfer", "loan", "owner_contribution", "owner_draw", "tax_payment", "tax_refund", "relief", "excluded"] as const;
export const IRS_ENTRY_TYPES = ["opening_balance", "assessment", "penalty", "interest", "payment", "credit", "abatement", "refund", "stimulus", "advance_child_tax_credit", "ppp_received", "ppp_forgiven", "other_relief", "note"] as const;
export const TAX_CATEGORIES = [
  { id: "uncategorized", label: "Needs a category", line: "" },
  { id: "gross_receipts", label: "Business income / sales", line: "1" },
  { id: "returns_allowances", label: "Returns and allowances", line: "2" },
  { id: "other_income", label: "Other business income", line: "6" },
  { id: "advertising", label: "Advertising", line: "8" },
  { id: "car_truck", label: "Car and truck expenses", line: "9" },
  { id: "commissions", label: "Commissions and fees", line: "10" },
  { id: "contract_labor", label: "Contract labor", line: "11" },
  { id: "depletion", label: "Depletion", line: "12" },
  { id: "depreciation", label: "Depreciation / section 179", line: "13" },
  { id: "employee_benefits", label: "Employee benefit programs", line: "14" },
  { id: "insurance", label: "Business insurance", line: "15" },
  { id: "mortgage_interest", label: "Mortgage interest", line: "16a" },
  { id: "vehicle_loan_interest", label: "Business vehicle loan interest", line: "16b" },
  { id: "other_interest", label: "Other interest", line: "16b" },
  { id: "legal_professional", label: "Legal and professional services", line: "17" },
  { id: "office", label: "Office expense", line: "18" },
  { id: "pension", label: "Pension and profit-sharing plans", line: "19" },
  { id: "equipment_rent", label: "Equipment / vehicle rent", line: "20a" },
  { id: "property_rent", label: "Property / field rental", line: "20b" },
  { id: "repairs", label: "Repairs and maintenance", line: "21" },
  { id: "supplies", label: "Supplies", line: "22" },
  { id: "taxes_licenses", label: "Business taxes and licenses", line: "23" },
  { id: "travel", label: "Business travel", line: "24a" },
  { id: "meals", label: "Deductible business meals", line: "24b" },
  { id: "utilities", label: "Utilities", line: "25" },
  { id: "wages", label: "Employee wages", line: "26" },
  { id: "other_expenses", label: "Other expenses / league fees", line: "27a" },
  { id: "cost_of_goods", label: "Cost of goods sold (review inventory)", line: "4" },
  { id: "home_office", label: "Business use of home (review separately)", line: "30" },
  { id: "energy_deduction", label: "Energy efficient building deduction", line: "" },
] as const;
export type TaxCategory = typeof TAX_CATEGORIES[number]["id"];

/** Signed amount: incoming positive, outgoing negative. Amount and allocations use integer cents / basis points. */
export interface TransactionData extends TaxData {
  date: string; amount_cents: number; account_id: string | null; statement_id: string | null;
  description: string; vendor: string; scope: typeof TRANSACTION_SCOPES[number]; business_id: string | null;
  business_percent: number; category: TaxCategory; review_status: "needs_review" | "confirmed";
  deduction_percent: number | null; deduction_confirmed: boolean; notes: string;
  source: "manual" | "csv" | "ai"; rule_id: string | null; manual_override: boolean;
}
export interface RuleData extends TaxData {
  match: string; match_type: "exact" | "contains"; scope: typeof TRANSACTION_SCOPES[number];
  business_id: string | null; business_percent: number; category: TaxCategory;
  deduction_percent: number | null; deduction_confirmed: boolean; enabled: boolean;
  notes: string;
}
export interface ImportRow {
  date: string; description: string; amount_cents: number; vendor?: string;
  source_row?: number; scope?: typeof TRANSACTION_SCOPES[number]; business_id?: string | null;
  category?: TaxCategory; question?: string; fingerprint?: string; possible_duplicate?: boolean;
}
export interface ImportPreview {
  statement: TaxRecord; rows: ImportRow[]; warnings: string[]; questions: string[];
  totals: { incoming_cents: number; outgoing_cents: number; net_cents: number; row_count: number };
  opening_balance_cents: number | null; closing_balance_cents: number | null;
  reconciliation_difference_cents: number | null; extracted_by: "csv" | "ai";
}
export interface TaxReport {
  year: number; businessId: string | null; income_cents: number; expenses_cents: number; profit_cents: number;
  deductible_expenses_cents: number; draft_profit_cents: number; pending_count: number;
  unreviewed_deductions_count: number; lines: { category: string; label: string; line: string; book_cents: number; deductible_cents: number }[];
  warnings: string[]; sourceUrl: string; record_count: number;
}
