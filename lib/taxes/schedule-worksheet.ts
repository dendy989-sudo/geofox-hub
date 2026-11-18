import { percentOf } from "./model.ts";
import type { TaxData, TaxRecord } from "./types.ts";

export const INVENTORY_FIELDS = [
  ["opening_inventory_cents", "35 · Opening inventory"],
  ["purchases_cents", "36 · Purchases before personal withdrawals"],
  ["personal_withdrawals_cents", "36 · Items withdrawn for personal use"],
  ["cost_of_labor_cents", "37 · Inventory labor, excluding your own pay"],
  ["materials_cents", "38 · Inventory materials and supplies"],
  ["other_costs_cents", "39 · Other inventory costs"],
  ["closing_inventory_cents", "41 · Closing inventory"],
] as const;

/** Missing amounts are unknown, including purchases and personal withdrawals. */
export function inventoryWorksheet(data: TaxData) {
  const amount = (key: string): number | null => typeof data[key] === "number" && Number.isSafeInteger(data[key]) && Number(data[key]) >= 0 ? Number(data[key]) : null;
  const opening = amount("opening_inventory_cents"), purchases = amount("purchases_cents"), withdrawals = amount("personal_withdrawals_cents"), labor = amount("cost_of_labor_cents"), materials = amount("materials_cents"), other = amount("other_costs_cents"), closing = amount("closing_inventory_cents");
  const netPurchases = purchases === null || withdrawals === null ? null : purchases - withdrawals;
  const available = [opening, netPurchases, labor, materials, other].every(value => value !== null) ? opening! + netPurchases! + labor! + materials! + other! : null;
  const costOfGoods = available === null || closing === null ? null : available - closing;
  const issue = costOfGoods !== null && costOfGoods < 0 ? "Closing inventory exceeds recorded available costs. Check the inventory worksheet." : null;
  return { opening, netPurchases, labor, materials, other, available, closing, costOfGoods, issue };
}

/** Matches the report's two-stage cent rounding, including expense refunds. */
export function itemizedOtherExpenses(records: TaxRecord[], year: number, businessId: string) {
  return records.filter(record => !record.archived && record.tax_year === year && ["transaction", "adjustment"].includes(record.kind) && record.data.business_id === businessId && ["business", "mixed"].includes(String(record.data.scope)) && record.data.category === "other_expenses" && record.data.review_status === "confirmed" && record.data.deduction_confirmed === true && typeof record.data.deduction_percent === "number")
    .map(record => ({ id: record.id, date: String(record.data.date), label: String(record.data.vendor || record.title), purpose: String(record.data.notes || record.data.source_reference || ""), cents: percentOf(-percentOf(Number(record.data.amount_cents), Number(record.data.business_percent)), Number(record.data.deduction_percent)) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
