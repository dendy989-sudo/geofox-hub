import { normalizeVendorUrl } from "./vendors.ts";
import { normalizeResponsiblePeople } from "./debt-people.ts";
import { normalizeTagName } from "./tags.ts";
import { BILL_PAYMENT_METHODS, INCOME_PAYMENT_METHODS } from "./types.ts";

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
function vendorName(value: unknown): string {
  const name = text(value, "Vendor name");
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return fail("Enter a vendor name without control characters.");
  return name.replace(/\s+/g, " ");
}
function vendorUrl(value: unknown): string | null {
  try { return normalizeVendorUrl(value); }
  catch (error) { return fail(error instanceof Error ? error.message : "Enter a valid vendor website."); }
}
function vendorLink(p: Record<string, unknown>): Record<string, unknown> {
  if (p.vendor_id !== undefined && p.new_vendor !== undefined) return fail("Choose an existing vendor or create a new vendor, not both.");
  if (p.new_vendor !== undefined) {
    if (!p.new_vendor || typeof p.new_vendor !== "object" || Array.isArray(p.new_vendor)) return fail("Enter the new vendor's name and optional website.");
    const vendor = p.new_vendor as Record<string, unknown>;
    return { new_vendor: { id: uuid(vendor.id, "Vendor"), name: vendorName(vendor.name), url: vendorUrl(vendor.url) } };
  }
  if (p.vendor_id !== undefined) return { vendor_id: p.vendor_id === null ? null : uuid(p.vendor_id, "Vendor") };
  return {}; // Older clients and occurrence edits preserve an omitted association.
}
function accountLink(p: Record<string, unknown>): Record<string, unknown> {
  return p.account_id === undefined ? {} : { account_id: p.account_id === null ? null : uuid(p.account_id, "Account") };
}
function debtPeople(p: Record<string, unknown>): Record<string, unknown> {
  if (p.responsible_people === undefined) return {}; // Older forms preserve the existing assignment.
  if (!Array.isArray(p.responsible_people)) return fail("Choose household names as a list, or leave the list empty.");
  try { return { responsible_people: normalizeResponsiblePeople(p.responsible_people) }; }
  catch (error) { return fail(error instanceof Error ? error.message : "Enter valid household names."); }
}
function tagName(value: unknown): string {
  try { return normalizeTagName(value); }
  catch (error) { return fail(error instanceof Error ? error.message : "Enter a valid tag name."); }
}
function tagLinks(p: Record<string, unknown>): Record<string, unknown> {
  if (p.tag_ids === undefined) return {}; // Older forms preserve saved tags.
  if (!Array.isArray(p.tag_ids)) return fail("Choose tags as a list, or leave the list empty.");
  const ids = [...new Set(p.tag_ids.map(value => uuid(value, "Tag")!.toLowerCase()))].sort();
  if (ids.length > 20) return fail("Choose at most 20 tags for one record.");
  return { tag_ids: ids };
}
function forecastFields(p: Record<string, unknown>, kind: "bill" | "income"): Record<string, unknown> {
  const fields = accountLink(p);
  if (p.payment_method !== undefined) fields.payment_method = choice(p.payment_method, kind === "bill" ? BILL_PAYMENT_METHODS : INCOME_PAYMENT_METHODS, "payment or receipt method");
  if (p.reminder_days !== undefined) {
    if (p.reminder_days !== null && (typeof p.reminder_days !== "number" || !Number.isInteger(p.reminder_days) || p.reminder_days < 0 || p.reminder_days > 30)) return fail("Reminder lead time must be between 0 and 30 days, or turned off.");
    fields.reminder_days = p.reminder_days;
  }
  return fields;
}
function customRepeat(p: Record<string, unknown>, frequency: string, due: string, end: string | null): Record<string, unknown> {
  if (frequency !== "custom") return { custom_mode: null, custom_month_days: [], custom_dates: [] };
  const mode = choice(p.custom_mode, ["month_days", "specific_dates"], "custom schedule");
  if (mode === "month_days") {
    if (!Array.isArray(p.custom_month_days) || p.custom_month_days.some(day => typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 31)) {
      return fail("Choose days of the month from 1 through 31.");
    }
    const days = [...new Set(p.custom_month_days as number[])].sort((a, b) => a - b);
    if (!days.length) return fail("Choose at least one day of the month.");
    const [year, month, day] = due.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    if (!days.some(selected => Math.min(selected, lastDay) === day)) return fail("The first due date must match a selected day. Days beyond the end of a month use its last day.");
    return { custom_mode: mode, custom_month_days: days, custom_dates: [] };
  }
  if (!Array.isArray(p.custom_dates)) return fail("Choose the specific dates for this schedule.");
  const dates = [...new Set([due, ...p.custom_dates.map(date => financeDate(date, "Custom date")!)])].sort();
  if (!dates.length || dates.length > 240) return fail("Choose between 1 and 240 specific dates, including the first due date.");
  if (end && dates[dates.length - 1] > end) return fail("Every custom date must be on or before the repeat end date.");
  return { custom_mode: mode, custom_month_days: [], custom_dates: dates };
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
      const originalDue = financeDate(p.original_due_date, "Original due date")!;
      let due = originalDue;
      let scheduled = financeDate(p.scheduled_date, "Scheduled date");
      const end = financeDate(p.end_date, "Repeat end date", true);
      if (end && due && end < due) return fail("The repeat end date must be on or after the first due date.");
      const frequency = choice(p.frequency ?? "once", ["once", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"], "repeat frequency");
      const kind = choice(p.kind, ["bill", "income"], "entry type");
      const custom = customRepeat(p, frequency, due, end);
      if (frequency === "custom" && custom.custom_mode === "specific_dates") {
        due = (custom.custom_dates as string[])[0];
        if (scheduled === originalDue) scheduled = due;
      }
      result = { id: optionalId(), kind, title: text(p.title, "Title"), category: text(p.category, "Category", 80), expense_type: choice(p.expense_type ?? "bill", ["bill", "installment", "payment_plan"], "expense type"), amount_cents: cents(p.amount_cents, "Amount", 1), original_due_date: due, scheduled_date: scheduled, notes: text(p.notes, "Notes", 4000, false), frequency, end_date: end, ...custom, ...vendorLink(p), ...forecastFields(p, kind), ...tagLinks(p) };
      break;
    }
    case "entry_status":
      result = { id: id(), status: choice(p.status, ["active", "cancelled"], "status") };
      if (p.archived !== undefined) result.archived = bool(p.archived, "Archive");
      break;
    case "move_entry":
      result = { id: id(), scheduled_date: financeDate(p.scheduled_date, "Payment date"), note: text(p.note, "Move note", 1000, false) }; break;
    case "record_payment":
      result = { id: id(), entry_id: uuid(p.entry_id, "Entry"), amount_cents: cents(p.amount_cents, "Payment amount", 1), paid_on: financeDate(p.paid_on, "Paid date"), note: text(p.note, "Payment note", 1000, false), ...accountLink(p) };
      if (p.payment_method !== undefined) result.payment_method = choice(p.payment_method, [...BILL_PAYMENT_METHODS, ...INCOME_PAYMENT_METHODS], "payment or receipt method");
      break;
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
      result = { id: optionalId(), title: text(p.title, "Plan name"), creditor: text(p.creditor, "Creditor", 200), kind: choice(p.kind, ["installment", "payment_plan"], "plan type"), category: text(p.category, "Category", 80), total_amount_cents: total, opening_paid_cents: paid, installment_amount_cents: installment, frequency: choice(p.frequency, ["weekly", "biweekly", "monthly", "quarterly"], "frequency"), first_due_date: financeDate(p.first_due_date, "First due date"), notes: text(p.notes, "Notes", 4000, false), ...vendorLink(p), ...forecastFields(p, "bill"), ...tagLinks(p) }; break;
    }
    case "plan_status":
      result = { id: id(), status: choice(p.status, ["active", "cancelled"], "status") }; break;
    case "save_vendor":
      result = { id: id(), name: vendorName(p.name), url: vendorUrl(p.url), notes: text(p.notes, "Vendor notes", 4000, false) }; break;
    case "vendor_status":
      result = { id: id(), archived: bool(p.archived, "Archive vendor") }; break;
    case "save_tag":
      result = { id: id(), name: tagName(p.name) }; break;
    case "archive_tag":
      result = { id: id(), archived: bool(p.archived, "Archive tag") }; break;
    case "save_account": {
      const kind = choice(p.kind, ["checking", "savings", "cash", "credit_card"], "account type");
      const lastFour = p.last_four === null || p.last_four === undefined || p.last_four === "" ? null : text(p.last_four, "Last four digits", 4);
      if (lastFour !== null && !/^\d{4}$/.test(lastFour)) return fail("Enter exactly the last four digits, or leave this blank.");
      const limit = cents(p.credit_limit_cents, "Credit limit", 0, true);
      if (kind !== "credit_card" && limit !== null) return fail("A credit limit applies only to a credit card.");
      result = { id: id(), name: text(p.name, "Account name"), institution: text(p.institution, "Institution", 200, false), kind, last_four: lastFour, opening_date: financeDate(p.opening_date, "Opening date"), opening_balance_cents: cents(p.opening_balance_cents, "Opening balance", -MAX_CENTS), credit_limit_cents: limit, notes: text(p.notes, "Account notes", 4000, false) }; break;
    }
    case "account_status":
      result = { id: id(), archived: bool(p.archived, "Archive account") }; break;
    case "save_balance_update":
      result = { id: optionalId(), ...accountLink(p), date: financeDate(p.date, "Balance date"), balance_cents: cents(p.balance_cents, "Balance", -MAX_CENTS), notes: text(p.notes, "Balance notes", 4000, false) }; break;
    case "remove_balance_update":
      result = { id: id() }; break;
    case "save_transfer": {
      const from = uuid(p.from_account_id, "From account")!, to = uuid(p.to_account_id, "To account")!;
      if (from.toLowerCase() === to.toLowerCase()) return fail("Choose two different accounts for a transfer.");
      result = { id: id(), from_account_id: from, to_account_id: to, amount_cents: cents(p.amount_cents, "Transfer amount", 1), date: financeDate(p.date, "Transfer date"), status: choice(p.status, ["planned", "completed", "cancelled"], "transfer status"), notes: text(p.notes, "Transfer notes", 4000, false) }; break;
    }
    case "transfer_status":
      result = { id: id(), status: choice(p.status, ["planned", "completed", "cancelled"], "transfer status") }; break;
    case "snooze_reminder":
      result = { id: id(), until: financeDate(p.until, "Reminder date", true) }; break;
    case "save_goal": {
      const start = financeDate(p.start_date, "Goal start date"), target = financeDate(p.target_date, "Goal target date", true);
      if (start && target && target < start) return fail("The target date must be on or after the goal start date.");
      result = { id: id(), account_id: uuid(p.account_id, "Savings account"), title: text(p.title, "Goal name"), target_cents: cents(p.target_cents, "Goal target", 1), allocated_cents: cents(p.allocated_cents, "Allocated savings"), start_date: start, target_date: target, notes: text(p.notes, "Goal notes", 4000, false), change_note: text(p.change_note, "Allocation note", 1000, false) }; break;
    }
    case "goal_status":
      result = { id: id(), archived: bool(p.archived, "Archive goal") }; break;
    case "save_debt": {
      const balance = cents(p.current_balance_cents, "Current balance")!;
      const status = choice(p.status, ["open", "charged_off", "closed", "paid"], "debt status");
      if (status === "paid" && balance !== 0) return fail("Set the current balance to zero before marking the debt paid.");
      const added = financeDate(p.date_added, "Date added");
      const removed = financeDate(p.date_removed, "Date removed", true);
      if (added && removed && removed < added) return fail("Date removed must be on or after date added.");
      result = { id: optionalId(), stage: choice(p.stage, ["credit_report", "collections"], "debt location"), title: text(p.title, "Debt name"), original_creditor: text(p.original_creditor, "Original creditor", 200), collector: text(p.collector, "Collector", 200, false), original_balance_cents: cents(p.original_balance_cents, "Original balance"), current_balance_cents: balance, status, date_added: added, date_removed: removed, settlement_offer_cents: cents(p.settlement_offer_cents, "Settlement offer", 0, true), offer_monthly_cents: cents(p.offer_monthly_cents, "Monthly offer", 0, true), offer_expires_on: financeDate(p.offer_expires_on, "Offer expiration", true), notes: text(p.notes, "Notes", 4000, false), change_note: text(p.change_note, "Change note", 1000, false), ...debtPeople(p) }; break;
    }
    case "transfer_collections": {
      const entry = uuid(p.entry_id, "Bill", true), plan = uuid(p.plan_id, "Plan", true);
      if (Boolean(entry) === Boolean(plan)) return fail("Choose either a bill or a payment plan to transfer.");
      result = { id: optionalId(), entry_id: entry, plan_id: plan, collector: text(p.collector, "Collector", 200, false), notes: text(p.notes, "Notes", 4000, false), ...debtPeople(p) }; break;
    }
    case "save_month":
      result = { month: financeMonth(p.month), opening_balance_cents: cents(p.opening_balance_cents, "Opening balance", -MAX_CENTS) }; break;
    case "save_spending":
      result = { id: optionalId(), date: financeDate(p.date, "Spending date"), amount_cents: cents(p.amount_cents, "Spending amount", 1), title: text(p.title, "Spending description", 200), ...accountLink(p) }; break;
    case "remove_spending":
      result = { id: id() }; break;
    case "clear_spending":
      result = { month: financeMonth(p.month), ...accountLink(p) }; break;
    default: return fail("This finance action is not available.");
  }
  return { action, payload: Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) };
}
