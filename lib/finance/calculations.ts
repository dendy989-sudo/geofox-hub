import type { FinanceAccount, FinanceAccountScope, FinanceBalanceUpdate, FinanceData, FinanceEntry, FinancePayment, FinancePlan, FinanceTransfer } from "./types";

export type FinanceEntryState = "paid" | "received" | "partial" | "past_due" | "scheduled" | "cancelled" | "collections";

export interface FinanceDraft {
  id: string;
  kind: "income" | "bill" | "spending";
  date: string;
  amount_cents: number;
  account_id?: string | null;
}

export interface DailyLedgerOptions {
  /** Planning spending is excluded unless explicitly requested by Live Money. */
  includeSpending?: boolean;
  drafts?: FinanceDraft[];
  /** Payments use their saved account, while unpaid plans use the entry's current account. */
  accountScope?: FinanceAccountScope;
}

export interface FinanceLedgerDay {
  date: string;
  income_cents: number;
  bills_cents: number;
  spending_cents: number;
  /** Internal transfers are separate from income and bills; they net to zero across all accounts. */
  transfer_cents: number;
  /** Balance after this day's anchors, before this day's flows. */
  starting_cents: number;
  /** Difference caused by a dated balance anchor, never treated as income or spending. */
  balance_adjustment_cents: number;
  net_cents: number;
  ending_cents: number;
  /** Entries with a payment or an outstanding scheduled amount on this day. */
  entries: FinanceEntry[];
  balance_updates: FinanceBalanceUpdate[];
  account_openings: FinanceAccount[];
  transfers: FinanceTransfer[];
}

export interface FinanceMonthSummary {
  opening_cents: number;
  /** Original amounts of every bill originally due this month, including inactive bills. */
  original_bills_cents: number;
  /** Current amounts of active bills originally due this month. */
  original_payable_cents: number;
  /** Recorded payments against active bills originally due this month, on any payment date. */
  original_paid_cents: number;
  original_remaining_cents: number;
  original_cancelled_cents: number;
  original_collections_cents: number;
  original_progress_percent: number;
  /** Cash forecast: actual payments plus outstanding bills scheduled in this month. */
  scheduled_bills_cents: number;
  /** Cash forecast: actual receipts plus outstanding income scheduled in this month. */
  income_cents: number;
  net_cents: number;
  transfer_cents: number;
  balance_adjustment_cents: number;
  /** Actual cash paid/received in this month, including inactive or archived entry history. */
  paid_bills_cents: number;
  received_income_cents: number;
  scheduled_remaining_cents: number;
  expected_income_cents: number;
  ending_cents: number;
  /** Lowest projected daily closing balance; ties use the first date. */
  lowest_cents: number;
  lowest_date: string;
  /** All active overdue bills, irrespective of which month is being viewed. */
  past_due_cents: number;
  past_due_before_month_cents: number;
  /** Overdue bills still scheduled before this month; these are never silently carried in. */
  unscheduled_past_due_cents: number;
  moved_in_cents: number;
  moved_out_cents: number;
  next_bill: FinanceEntry | null;
  next_income: FinanceEntry | null;
  /** Outstanding scheduled amounts from today through the following six days. */
  upcoming_bills_cents: number;
  upcoming_income_cents: number;
  installments_remaining_cents: number;
}

export interface FinancePlanProgress {
  paid_cents: number;
  /** Unpaid portion of the original agreement, including cancelled/transferred source history. */
  remaining_cents: number;
  /** Outstanding installments still on an active payment schedule. */
  active_remaining_cents: number;
  /** Cancelling a schedule stops its forecast, but does not record a payment or forgive the debt. */
  cancelled_remaining_cents: number;
  /** Unpaid source amounts transferred out; current collection balances live in finance_debts. */
  collections_remaining_cents: number;
  percent: number;
  past_due_cents: number;
  next_entry: FinanceEntry | null;
}

export interface FinanceDebtSummary {
  balance_cents: number;
  /** Potential total if every unexpired settlement offer is accepted; otherwise current balance. */
  settlement_cents: number;
  /** Unexpired monthly offers, not a committed payment schedule. */
  monthly_offers_cents: number;
  collections_cents: number;
}

function monthParts(month: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) === 0) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDay(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parts = monthParts(date.slice(0, 7));
  if (!parts) return false;
  const day = Number(date.slice(8));
  return day > 0 && day <= daysInMonth(parts.year, parts.month);
}

/** Calendar arithmetic uses date strings throughout, with no UTC/local-midnight conversion. */
export function monthDays(month: string): string[] {
  const parts = monthParts(month);
  if (!parts) throw new RangeError("Choose a valid month in YYYY-MM format.");
  return Array.from({ length: daysInMonth(parts.year, parts.month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftMonth(month: string, offset: number): string {
  const parts = monthParts(month);
  if (!parts || !Number.isSafeInteger(offset)) throw new RangeError("Choose a valid month and a whole month offset.");
  const index = parts.year * 12 + parts.month - 1 + offset;
  const year = Math.floor(index / 12);
  if (year < 1 || year > 9999) throw new RangeError("The resulting year is outside the supported calendar.");
  return `${String(year).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

export function dayInMonth(date: string, month: string): boolean {
  return Boolean(monthParts(month)) && date.slice(0, 7) === month && validDay(date);
}

/** Strict decimal input: no floating-point multiplication of fractional dollars. Zero is valid. */
export function parseMoney(value: string, allowNegative = false): number | null {
  const input = value.trim();
  const pattern = allowNegative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(input)) return null;
  const negative = input.startsWith("-");
  const [dollars, fraction = ""] = (negative ? input.slice(1) : input).split(".");
  const whole = Number(dollars);
  // Keep every intermediate operation within the exact integer range.
  if (!Number.isSafeInteger(whole) || whole > Math.floor(Number.MAX_SAFE_INTEGER / 100)) return null;
  const cents = whole * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return cents === 0 ? 0 : negative ? -cents : cents;
}

export function paidAmount(entry: FinanceEntry, payments: FinancePayment[]): number {
  return payments.reduce((total, payment) => payment.entry_id === entry.id && payment.user_id === entry.user_id && !payment.reversed_at ? total + payment.amount_cents : total, 0);
}

export function remainingAmount(entry: FinanceEntry, payments: FinancePayment[]): number {
  return Math.max(0, entry.amount_cents - paidAmount(entry, payments));
}

export function isPastDue(entry: FinanceEntry, payments: FinancePayment[], today: string): boolean {
  return entry.status === "active" && entry.original_due_date < today && remainingAmount(entry, payments) > 0;
}

export function isMoved(entry: FinanceEntry): boolean {
  return entry.scheduled_date !== entry.original_due_date;
}

export function entryState(entry: FinanceEntry, payments: FinancePayment[], today: string): FinanceEntryState {
  if (entry.status === "cancelled" || entry.status === "collections") return entry.status;
  if (remainingAmount(entry, payments) === 0) return entry.kind === "income" ? "received" : "paid";
  if (isPastDue(entry, payments, today)) return "past_due";
  return paidAmount(entry, payments) > 0 ? "partial" : "scheduled";
}

/** Missing account fields on migrated records mean unassigned, never the entry's current account. */
export function matchesAccountScope(accountId: string | null | undefined, scope: FinanceAccountScope = "all"): boolean {
  return scope === "all" || (accountId ?? null) === scope;
}

function ownedAccounts(data: FinanceData): FinanceAccount[] {
  return (data.accounts ?? []).filter((account) => account.user_id === data.user.id);
}

function accountIds(data: FinanceData, scope: FinanceAccountScope): (string | null)[] {
  const accounts = ownedAccounts(data);
  if (scope === "all") return [null, ...accounts.map((account) => account.id)];
  if (scope === null) return [null];
  return accounts.some((account) => account.id === scope) ? [scope] : [];
}

/** A correction can establish tracking before the account's original opening date. */
export function accountTrackingStart(data: FinanceData, accountId: string): string | null {
  const account = ownedAccounts(data).find((item) => item.id === accountId);
  if (!account) return null;
  return (data.balance_updates ?? []).filter((item) => item.user_id === data.user.id && item.account_id === accountId)
    .reduce((first, item) => item.date < first ? item.date : first, account.opening_date);
}

interface BalanceAnchor { date: string; balance_cents: number }

function latestAnchor(data: FinanceData, accountId: string | null, asOf: string): BalanceAnchor | null {
  let anchor: BalanceAnchor | null;
  if (accountId === null) {
    // The unassigned bucket keeps the original explicit month-by-month opening workflow.
    anchor = { date: `${asOf.slice(0, 7)}-01`, balance_cents: data.months.find((item) => item.user_id === data.user.id && item.month === asOf.slice(0, 7))?.opening_balance_cents ?? 0 };
  } else {
    const account = ownedAccounts(data).find((item) => item.id === accountId);
    if (!account) return null;
    anchor = account.opening_date <= asOf ? { date: account.opening_date, balance_cents: account.opening_balance_cents } : null;
  }
  const updates = (data.balance_updates ?? []).filter((item) => item.user_id === data.user.id && item.account_id === accountId && item.date <= asOf && (accountId !== null || item.date >= `${asOf.slice(0, 7)}-01`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  for (const update of updates) {
    if (!anchor || update.date >= anchor.date) anchor = { date: update.date, balance_cents: update.balance_cents };
  }
  return anchor;
}

function postedFlow(data: FinanceData, accountId: string | null, from: string, through: string, includeThrough: boolean): number {
  const entries = new Map(data.entries.filter((entry) => entry.user_id === data.user.id).map((entry) => [entry.id, entry]));
  const inRange = (date: string) => date >= from && (includeThrough ? date <= through : date < through);
  let result = 0;
  for (const payment of data.payments) {
    if (payment.user_id !== data.user.id || payment.reversed_at || !matchesAccountScope(payment.account_id, accountId) || !inRange(payment.paid_on)) continue;
    const entry = entries.get(payment.entry_id);
    if (entry) result += entry.kind === "income" ? payment.amount_cents : -payment.amount_cents;
  }
  if (accountId !== null) {
    const ownedIds = new Set(ownedAccounts(data).map((account) => account.id));
    for (const transfer of data.transfers ?? []) {
      if (transfer.user_id !== data.user.id || transfer.status !== "completed" || !inRange(transfer.date) || !ownedIds.has(transfer.from_account_id) || !ownedIds.has(transfer.to_account_id)) continue;
      if (transfer.to_account_id === accountId) result += transfer.amount_cents;
      if (transfer.from_account_id === accountId) result -= transfer.amount_cents;
    }
  }
  return result;
}

/** Posted funds only: plans, scenarios, future anchors, and planned transfers never fund savings goals. */
export function actualAccountBalance(data: FinanceData, accountId: string | null, asOf: string): number {
  if (!validDay(asOf)) throw new RangeError("Choose a valid balance date in YYYY-MM-DD format.");
  const anchor = latestAnchor(data, accountId, asOf);
  return anchor ? anchor.balance_cents + postedFlow(data, accountId, anchor.date, asOf, true) : 0;
}

function accountMonthOpening(data: FinanceData, accountId: string | null, firstDay: string): number {
  const anchor = latestAnchor(data, accountId, firstDay);
  return anchor ? anchor.balance_cents + postedFlow(data, accountId, anchor.date, firstDay, false) : 0;
}

/** Account openings carry posted history; unassigned months retain an explicit saved opening. */
export function monthOpening(data: FinanceData, month: string, accountScope: FinanceAccountScope = "all"): number {
  if (!monthParts(month)) throw new RangeError("Choose a valid month in YYYY-MM format.");
  return accountIds(data, accountScope).reduce<number>((sum, accountId) => sum + accountMonthOpening(data, accountId, `${month}-01`), 0);
}

function paymentsByEntry(payments: FinancePayment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.reversed_at) totals.set(payment.entry_id, (totals.get(payment.entry_id) ?? 0) + payment.amount_cents);
  }
  return totals;
}

function outstanding(entry: FinanceEntry, paid: Map<string, number>): number {
  return Math.max(0, entry.amount_cents - (paid.get(entry.id) ?? 0));
}

function scheduleOrder(a: FinanceEntry, b: FinanceEntry): number {
  return a.scheduled_date.localeCompare(b.scheduled_date) || a.original_due_date.localeCompare(b.original_due_date) || a.id.localeCompare(b.id);
}

export function dailyLedger(data: FinanceData, month: string, options: DailyLedgerOptions = {}): FinanceLedgerDay[] {
  const days: FinanceLedgerDay[] = monthDays(month).map((date) => ({ date, income_cents: 0, bills_cents: 0, spending_cents: 0, transfer_cents: 0, starting_cents: 0, balance_adjustment_cents: 0, net_cents: 0, ending_cents: 0, entries: [], balance_updates: [], account_openings: [], transfers: [] }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const scope = options.accountScope === undefined ? "all" : options.accountScope;
  const ids = accountIds(data, scope), idSet = new Set(ids);
  const accounts = ownedAccounts(data), ownedIds = new Set(accounts.map((account) => account.id));
  const starts = new Map(accounts.map((account) => [account.id, accountTrackingStart(data, account.id)!]));
  const balances = new Map(ids.map((accountId) => [accountId, accountMonthOpening(data, accountId, days[0].date)]));
  const flows = new Map<string, Map<string | null, number>>();
  const entries = data.entries.filter((entry) => entry.user_id === data.user.id);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const paid = paymentsByEntry(data.payments.filter((payment) => payment.user_id === data.user.id));
  const entryIds = new Map<string, Set<string>>();
  const tracked = (accountId: string | null, date: string) => idSet.has(accountId) && (accountId === null || date >= (starts.get(accountId) ?? "9999-12-31"));
  const post = (day: FinanceLedgerDay, accountId: string | null, amount: number) => {
    const bucket = flows.get(day.date) ?? new Map<string | null, number>();
    bucket.set(accountId, (bucket.get(accountId) ?? 0) + amount);
    flows.set(day.date, bucket);
  };
  const attach = (day: FinanceLedgerDay, entry: FinanceEntry) => {
    const ids = entryIds.get(day.date) ?? new Set<string>();
    if (!ids.has(entry.id)) {
      day.entries.push(entry);
      ids.add(entry.id);
      entryIds.set(day.date, ids);
    }
  };

  // Actual cash history survives cancellation, transfer to collections, and archiving.
  for (const payment of data.payments) {
    const accountId = payment.account_id ?? null;
    if (payment.user_id !== data.user.id || payment.reversed_at || !tracked(accountId, payment.paid_on)) continue;
    const day = byDate.get(payment.paid_on);
    const entry = byId.get(payment.entry_id);
    if (!day || !entry) continue;
    if (entry.kind === "income") day.income_cents += payment.amount_cents;
    else day.bills_cents += payment.amount_cents;
    post(day, accountId, entry.kind === "income" ? payment.amount_cents : -payment.amount_cents);
    attach(day, entry);
  }

  // Only the unpaid remainder is forecast. Moving a bill changes this date, not its original due date.
  for (const entry of entries) {
    const accountId = entry.account_id ?? null;
    if (entry.status !== "active" || !tracked(accountId, entry.scheduled_date)) continue;
    const day = byDate.get(entry.scheduled_date);
    const amount = outstanding(entry, paid);
    if (!day || amount === 0) continue;
    if (entry.kind === "income") day.income_cents += amount;
    else day.bills_cents += amount;
    post(day, accountId, entry.kind === "income" ? amount : -amount);
    attach(day, entry);
  }

  if (options.includeSpending) {
    for (const spending of data.spending) {
      const accountId = spending.account_id ?? null;
      if (spending.user_id !== data.user.id || !tracked(accountId, spending.date)) continue;
      const day = byDate.get(spending.date);
      if (day) { day.spending_cents += spending.amount_cents; post(day, accountId, -spending.amount_cents); }
    }
  }
  for (const draft of options.drafts ?? []) {
    const accountId = draft.account_id ?? null;
    if (!tracked(accountId, draft.date)) continue;
    const day = byDate.get(draft.date);
    if (!day) continue;
    if (draft.kind === "income") { day.income_cents += draft.amount_cents; post(day, accountId, draft.amount_cents); }
    else if (draft.kind === "bill") { day.bills_cents += draft.amount_cents; post(day, accountId, -draft.amount_cents); }
    else if (options.includeSpending) { day.spending_cents += draft.amount_cents; post(day, accountId, -draft.amount_cents); }
  }

  for (const transfer of data.transfers ?? []) {
    const day = byDate.get(transfer.date);
    if (!day || transfer.user_id !== data.user.id || transfer.status === "cancelled" || !ownedIds.has(transfer.from_account_id) || !ownedIds.has(transfer.to_account_id)) continue;
    let involved = false;
    for (const [accountId, sign] of [[transfer.from_account_id, -1], [transfer.to_account_id, 1]] as const) {
      if (!tracked(accountId, transfer.date)) continue;
      const amount = sign * transfer.amount_cents;
      day.transfer_cents += amount; post(day, accountId, amount); involved = true;
    }
    if (involved) day.transfers.push(transfer);
  }

  for (const account of accounts) {
    const day = byDate.get(account.opening_date);
    if (day && idSet.has(account.id)) day.account_openings.push(account);
  }
  for (const update of (data.balance_updates ?? []).filter((item) => item.user_id === data.user.id && idSet.has(item.account_id)).sort((a, b) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))) {
    byDate.get(update.date)?.balance_updates.push(update);
  }

  for (const day of days) {
    const reset = (accountId: string | null, amount: number) => {
      day.balance_adjustment_cents += amount - (balances.get(accountId) ?? 0);
      balances.set(accountId, amount);
    };
    // The first day's opening already includes its latest anchor; markers remain visible.
    if (day.date !== days[0].date) {
      for (const account of day.account_openings) reset(account.id, account.opening_balance_cents);
      for (const update of day.balance_updates) reset(update.account_id, update.balance_cents);
    }
    day.starting_cents = [...balances.values()].reduce((sum, amount) => sum + amount, 0);
    day.net_cents = day.income_cents - day.bills_cents - day.spending_cents + day.transfer_cents;
    for (const [accountId, amount] of flows.get(day.date) ?? []) balances.set(accountId, (balances.get(accountId) ?? 0) + amount);
    day.ending_cents = [...balances.values()].reduce((sum, amount) => sum + amount, 0);
    day.entries.sort(scheduleOrder);
  }
  return days;
}

function addCalendarDays(date: string, amount: number): string {
  if (!validDay(date)) throw new RangeError("Choose a valid date in YYYY-MM-DD format.");
  let result = date;
  for (let i = 0; i < amount; i += 1) {
    const month = result.slice(0, 7);
    const parts = monthParts(month)!;
    const nextDay = Number(result.slice(8)) + 1;
    result = nextDay > daysInMonth(parts.year, parts.month) ? `${shiftMonth(month, 1)}-01` : `${month}-${String(nextDay).padStart(2, "0")}`;
  }
  return result;
}

export function monthSummary(data: FinanceData, month: string, today: string, accountScope: FinanceAccountScope = "all"): FinanceMonthSummary {
  const ledger = dailyLedger(data, month, { accountScope });
  const firstDay = ledger[0].date;
  const payments = data.payments.filter((payment) => payment.user_id === data.user.id);
  const entries = data.entries.filter((entry) => entry.user_id === data.user.id);
  const paid = paymentsByEntry(payments);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const planById = new Map(data.plans.filter((plan) => plan.user_id === data.user.id).map((plan) => [plan.id, plan]));
  const upcomingEnd = addCalendarDays(today, 6);
  const summary: FinanceMonthSummary = {
    opening_cents: monthOpening(data, month, accountScope), original_bills_cents: 0, original_payable_cents: 0,
    original_paid_cents: 0, original_remaining_cents: 0, original_cancelled_cents: 0,
    original_collections_cents: 0, original_progress_percent: 0,
    scheduled_bills_cents: 0, income_cents: 0, net_cents: 0, transfer_cents: 0, balance_adjustment_cents: 0, paid_bills_cents: 0,
    received_income_cents: 0, scheduled_remaining_cents: 0, expected_income_cents: 0,
    ending_cents: ledger[ledger.length - 1].ending_cents,
    lowest_cents: ledger[0].ending_cents, lowest_date: firstDay,
    past_due_cents: 0, past_due_before_month_cents: 0, unscheduled_past_due_cents: 0,
    moved_in_cents: 0, moved_out_cents: 0, next_bill: null, next_income: null,
    upcoming_bills_cents: 0, upcoming_income_cents: 0, installments_remaining_cents: 0,
  };

  for (const day of ledger) {
    summary.scheduled_bills_cents += day.bills_cents;
    summary.income_cents += day.income_cents;
    summary.net_cents += day.net_cents;
    summary.transfer_cents += day.transfer_cents;
    summary.balance_adjustment_cents += day.balance_adjustment_cents;
    if (day.ending_cents < summary.lowest_cents) {
      summary.lowest_cents = day.ending_cents;
      summary.lowest_date = day.date;
    }
  }
  for (const payment of payments) {
    if (payment.reversed_at || !dayInMonth(payment.paid_on, month) || !matchesAccountScope(payment.account_id, accountScope)) continue;
    const entry = byId.get(payment.entry_id);
    if (entry?.kind === "bill") summary.paid_bills_cents += payment.amount_cents;
    else if (entry?.kind === "income") summary.received_income_cents += payment.amount_cents;
  }

  for (const entry of entries) {
    if (!matchesAccountScope(entry.account_id, accountScope)) continue;
    const originalMonth = dayInMonth(entry.original_due_date, month);
    const scheduledMonth = dayInMonth(entry.scheduled_date, month);
    const remaining = outstanding(entry, paid);
    if (entry.kind === "bill" && originalMonth) {
      summary.original_bills_cents += entry.original_amount_cents;
      if (entry.status === "active") {
        summary.original_payable_cents += entry.amount_cents;
        summary.original_remaining_cents += remaining;
        summary.original_paid_cents += entry.amount_cents - remaining;
      } else if (entry.status === "cancelled") summary.original_cancelled_cents += entry.original_amount_cents;
      else if (entry.status === "collections") summary.original_collections_cents += entry.original_amount_cents;
    }
    if (entry.status !== "active" || remaining === 0) continue;
    if (scheduledMonth) {
      if (entry.kind === "bill") summary.scheduled_remaining_cents += remaining;
      else summary.expected_income_cents += remaining;
    }
    if (entry.kind === "bill") {
      if (entry.original_due_date < today) {
        summary.past_due_cents += remaining;
        if (entry.original_due_date < firstDay) summary.past_due_before_month_cents += remaining;
        if (entry.scheduled_date < firstDay) summary.unscheduled_past_due_cents += remaining;
      }
      if (scheduledMonth && !originalMonth) summary.moved_in_cents += remaining;
      if (originalMonth && !scheduledMonth) summary.moved_out_cents += remaining;
      if (entry.expense_type !== "bill" && (!entry.plan_id || planById.get(entry.plan_id)?.status === "active")) summary.installments_remaining_cents += remaining;
    }
    if (entry.scheduled_date >= today) {
      if (entry.kind === "bill") {
        if (!summary.next_bill || scheduleOrder(entry, summary.next_bill) < 0) summary.next_bill = entry;
        if (entry.scheduled_date <= upcomingEnd) summary.upcoming_bills_cents += remaining;
      } else {
        if (!summary.next_income || scheduleOrder(entry, summary.next_income) < 0) summary.next_income = entry;
        if (entry.scheduled_date <= upcomingEnd) summary.upcoming_income_cents += remaining;
      }
    }
  }
  summary.original_progress_percent = summary.original_payable_cents > 0 ? Math.min(100, summary.original_paid_cents / summary.original_payable_cents * 100) : 0;
  return summary;
}

export function planProgress(plan: FinancePlan, data: FinanceData): FinancePlanProgress {
  const paid = paymentsByEntry(data.payments);
  const children = data.entries.filter((entry) => entry.kind === "bill" && entry.plan_id === plan.id);
  const paidCents = plan.opening_paid_cents + children.reduce((total, entry) => total + (paid.get(entry.id) ?? 0), 0);
  const outstandingEntries = plan.status === "active" ? children.filter((entry) => entry.status === "active" && outstanding(entry, paid) > 0).sort(scheduleOrder) : [];
  const remainingByStatus = { active: 0, cancelled: 0, collections: 0 };
  for (const entry of children) {
    // A source occurrence transferred separately no longer belongs to the active plan balance.
    const status = entry.status === "active" ? plan.status : entry.status;
    remainingByStatus[status] += outstanding(entry, paid);
  }
  return {
    paid_cents: paidCents,
    remaining_cents: Math.max(0, plan.total_amount_cents - paidCents),
    active_remaining_cents: remainingByStatus.active,
    cancelled_remaining_cents: remainingByStatus.cancelled,
    collections_remaining_cents: remainingByStatus.collections,
    percent: plan.total_amount_cents > 0 ? Math.min(100, Math.max(0, paidCents / plan.total_amount_cents * 100)) : 0,
    past_due_cents: outstandingEntries.reduce((total, entry) => entry.original_due_date < data.today ? total + outstanding(entry, paid) : total, 0),
    next_entry: outstandingEntries[0] ?? null,
  };
}

export function debtSummary(data: FinanceData, today: string): FinanceDebtSummary {
  const summary: FinanceDebtSummary = { balance_cents: 0, settlement_cents: 0, monthly_offers_cents: 0, collections_cents: 0 };
  for (const debt of data.debts) {
    // Closed/charged-off/removed-from-report does not mean the balance was forgiven.
    const balance = debt.current_balance_cents;
    const offerCurrent = !debt.offer_expires_on || debt.offer_expires_on >= today;
    summary.balance_cents += balance;
    summary.settlement_cents += offerCurrent && debt.settlement_offer_cents !== null ? Math.min(balance, debt.settlement_offer_cents) : balance;
    if (debt.stage === "collections") summary.collections_cents += balance;
    if (offerCurrent && balance > 0) summary.monthly_offers_cents += debt.offer_monthly_cents ?? 0;
  }
  return summary;
}
