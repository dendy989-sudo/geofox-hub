import type { WorkspaceAttachment, WorkspaceRecord } from "./types";
export const TRANSACTION_TYPES = ["income", "expense", "owner_contribution", "owner_draw", "transfer"] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];
export interface AccountingData {
  type: TransactionType; amountCents: number; currency: "USD"; occurredOn: string;
  category: string; payee: string; reference: string; notes: string;
  attachments: WorkspaceAttachment[];
}
export const TYPE_LABELS: Record<TransactionType, string> = { income: "Income", expense: "Expense", owner_contribution: "Owner contribution", owner_draw: "Owner draw", transfer: "Internal transfer" };
export const CATEGORIES = ["App sales", "Subscriptions", "Advertising revenue", "Services", "Hosting & infrastructure", "Software", "Marketing", "Professional services", "Filing & agent fees", "Equipment", "Bank & processing fees", "Other"];
export function parseAmountCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 99999999999 ? cents : null;
}
export function amountText(cents: number): string { return (cents / 100).toFixed(2); }
export function accountingTotals(items: WorkspaceRecord<AccountingData>[]) {
  const totals = { income: 0, expenses: 0, contributions: 0, draws: 0, transfers: 0, pendingIncome: 0, pendingExpenses: 0, pendingCount: 0, net: 0, cashMovement: 0 };
  for (const record of items) {
    const amount = record.data.amountCents;
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    if (record.status === "pending") {
      totals.pendingCount += 1;
      if (record.data.type === "income") totals.pendingIncome += amount;
      if (record.data.type === "expense") totals.pendingExpenses += amount;
      continue;
    }
    if (record.status !== "paid") continue;
    if (record.data.type === "income") totals.income += amount;
    if (record.data.type === "expense") totals.expenses += amount;
    if (record.data.type === "owner_contribution") totals.contributions += amount;
    if (record.data.type === "owner_draw") totals.draws += amount;
    if (record.data.type === "transfer") totals.transfers += amount;
  }
  totals.net = totals.income - totals.expenses;
  totals.cashMovement = totals.net + totals.contributions - totals.draws;
  return totals;
}
/** Prevent spreadsheet cells from being interpreted as formulas when opened outside the app. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function accountingCsv(items: WorkspaceRecord<AccountingData>[]): string {
  const columns = ["Date", "Company or app", "Description", "Type", "Category", "Payee or customer", "Amount USD", "Status", "Reference", "Notes", "Receipt count"];
  return [columns, ...items.map((record) => [record.data.occurredOn, record.appSlug || "Company", record.title, TYPE_LABELS[record.data.type], record.data.category, record.data.payee, amountText(record.data.amountCents), record.status, record.data.reference, record.data.notes, record.data.attachments?.length || 0])].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
