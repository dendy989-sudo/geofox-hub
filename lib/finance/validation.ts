/** Input checks are shared by the API and tests; never trust client ownership fields. */
export class FinanceInputError extends Error {
  readonly status = 400;
  readonly code = "INVALID_FINANCE_INPUT";
  constructor(message: string) { super(message); this.name = "FinanceInputError"; }
}

const MAX_CENTS = 1_000_000_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message: string): never => { throw new FinanceInputError(message); };
function text(value: unknown, label: string, max = 200, required = true): string {
  if (value == null && !required) return "";
  if (typeof value !== "string") return fail(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /\u0000/.test(result)) return fail(`Enter ${label.toLowerCase()}${max ? ` using ${max} characters or fewer` : ""}.`);
  return result;
}
function uuid(value: unknown, label = "Record", optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string" || !uuidPattern.test(value)) return fail(`${label} has an invalid identifier.`);
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return fail(`Choose a valid ${label}.`);
  return value as T;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(`${label} must be on or off.`);
  return value;
}
function cents(value: unknown, label: string, minimum = 0, nullable = false): number | null {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > MAX_CENTS) return fail(`${label} must be a valid amount${minimum > 0 ? " greater than zero" : ""}.`);
  return value;
}
export function financeDate(value: unknown, label = "Date", nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !/^(20\d\d|2100)-\d{2}-\d{2}$/.test(value)) return fail(`Choose a valid ${label.toLowerCase()} between 2000 and 2100.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return fail(`Choose a valid ${label.toLowerCase()}.`);
  return value;
}
export function financeMonth(value: unknown): string {
  if (typeof value !== "string" || !/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(value)) return fail("Choose a valid month between 2000 and 2100.");
  return value;
}
/** Keep upcoming forecasts independent of which months have been opened. */
export function financeForecastThrough(requestedMonth: string, currentMonth: string): string {
  const selected = financeMonth(requestedMonth);
  const [currentYear, currentNumber] = financeMonth(currentMonth).split("-").map(Number);
  const horizonIndex = Math.min(2100 * 12 + 11, currentYear * 12 + currentNumber - 1 + 5);
  const horizonMonth = `${Math.floor(horizonIndex / 12)}-${String(horizonIndex % 12 + 1).padStart(2, "0")}`;
  const [year, number] = (selected > horizonMonth ? selected : horizonMonth).split("-").map(Number);
  return new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10);
}
export function validateFinanceMutation(actionValue: unknown, payloadValue: unknown): { action: string; payload: Record<string, unknown> } {
  const action = typeof actionValue === "string" ? actionValue : "";
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) return fail("Enter the details for this change.");
  const p = payloadValue as Record<string, unknown>;
  const id = () => uuid(p.id);
  const optionalId = () => uuid(p.id, "Record", true);
  let result: Record<string, unknown>;
  switch (action) {
    case "save_entry": {
      const due = financeDate(p.original_due_date, "Original due date");
      const end = financeDate(p.end_date, "Repeat end date", true);
      if (end && due && end < due) return fail("The repeat end date must be on or after the first due date.");
      result = { id: optionalId(), kind: choice(p.kind, ["bill", "income"], "entry type"), title: text(p.title, "Title"), category: text(p.category, "Category", 80), expense_type: choice(p.expense_type ?? "bill", ["bill", "installment", "payment_plan"], "expense type"), amount_cents: cents(p.amount_cents, "Amount", 1), original_due_date: due, scheduled_date: financeDate(p.scheduled_date, "Scheduled date"), notes: text(p.notes, "Notes", 4000, false), frequency: choice(p.frequency ?? "once", ["once", "weekly", "biweekly", "monthly", "yearly"], "repeat frequency"), end_date: end };
      break;
    }
    case "entry_status":
      result = { id: id(), status: choice(p.status, ["active", "cancelled"], "status") };
      if (p.archived !== undefined) result.archived = bool(p.archived, "Archive");
      break;
    case "move_entry":
      result = { id: id(), scheduled_date: financeDate(p.scheduled_date, "Payment date"), note: text(p.note, "Move note", 1000, false) }; break;
    case "record_payment":
      result = { id: id(), entry_id: uuid(p.entry_id, "Entry"), amount_cents: cents(p.amount_cents, "Payment amount", 1), paid_on: financeDate(p.paid_on, "Paid date"), note: text(p.note, "Payment note", 1000, false) }; break;
    case "remove_payment":
      result = { id: id() }; break;
    case "save_series":
      result = { id: id(), active: bool(p.active, "Repeating schedule") }; break;
    case "save_plan": {
      const total = cents(p.total_amount_cents, "Total balance", 1)!;
      const paid = cents(p.opening_paid_cents, "Already paid")!;
      const installment = cents(p.installment_amount_cents, "Installment", 1)!;
      if (paid > total) return fail("Already paid cannot exceed the total balance.");
      if (Math.ceil((total - paid) / installment) > 240) return fail("A plan can include at most 240 installments. Increase the installment amount.");
      result = { id: optionalId(), title: text(p.title, "Plan name"), creditor: text(p.creditor, "Creditor", 200), kind: choice(p.kind, ["installment", "payment_plan"], "plan type"), category: text(p.category, "Category", 80), total_amount_cents: total, opening_paid_cents: paid, installment_amount_cents: installment, frequency: choice(p.frequency, ["weekly", "biweekly", "monthly"], "frequency"), first_due_date: financeDate(p.first_due_date, "First due date"), notes: text(p.notes, "Notes", 4000, false) }; break;
    }
    case "plan_status":
      result = { id: id(), status: choice(p.status, ["active", "cancelled"], "status") }; break;
    case "save_debt": {
      const balance = cents(p.current_balance_cents, "Current balance")!;
      const status = choice(p.status, ["open", "charged_off", "closed", "paid"], "debt status");
      if (status === "paid" && balance !== 0) return fail("Set the current balance to zero before marking the debt paid.");
      const added = financeDate(p.date_added, "Date added");
      const removed = financeDate(p.date_removed, "Date removed", true);
      if (added && removed && removed < added) return fail("Date removed must be on or after date added.");
      result = { id: optionalId(), stage: choice(p.stage, ["credit_report", "collections"], "debt location"), title: text(p.title, "Debt name"), original_creditor: text(p.original_creditor, "Original creditor", 200), collector: text(p.collector, "Collector", 200, false), original_balance_cents: cents(p.original_balance_cents, "Original balance"), current_balance_cents: balance, status, date_added: added, date_removed: removed, settlement_offer_cents: cents(p.settlement_offer_cents, "Settlement offer", 0, true), offer_monthly_cents: cents(p.offer_monthly_cents, "Monthly offer", 0, true), offer_expires_on: financeDate(p.offer_expires_on, "Offer expiration", true), notes: text(p.notes, "Notes", 4000, false), change_note: text(p.change_note, "Change note", 1000, false) }; break;
    }
    case "transfer_collections": {
      const entry = uuid(p.entry_id, "Bill", true), plan = uuid(p.plan_id, "Plan", true);
      if (Boolean(entry) === Boolean(plan)) return fail("Choose either a bill or a payment plan to transfer.");
      result = { id: optionalId(), entry_id: entry, plan_id: plan, collector: text(p.collector, "Collector", 200, false), notes: text(p.notes, "Notes", 4000, false) }; break;
    }
    case "save_month":
      result = { month: financeMonth(p.month), opening_balance_cents: cents(p.opening_balance_cents, "Opening balance", -MAX_CENTS) }; break;
    case "save_spending":
      result = { id: optionalId(), date: financeDate(p.date, "Spending date"), amount_cents: cents(p.amount_cents, "Spending amount", 1), title: text(p.title, "Spending description", 200) }; break;
    case "remove_spending":
      result = { id: id() }; break;
    case "clear_spending":
      result = { month: financeMonth(p.month) }; break;
    default: return fail("This finance action is not available.");
  }
  return { action, payload: Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) };
}
