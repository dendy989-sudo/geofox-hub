import { dayInMonth, isPastDue, matchesAccountScope, remainingAmount } from "./calculations.ts";
import type { FinanceAccountScope, FinanceData, FinanceEntry, FinanceTag, FinanceTagScope } from "./types";
export type { FinanceTagScope } from "./types";

export interface FinanceTagOption {
  value: string;
  label: string;
  count: number;
  archived: boolean;
}

export interface FinanceTagSummary {
  /** Unique owned matching entries across every date, status, and archive state. */
  entries: FinanceEntry[];
  entry_count: number;
  /** Preserved original bill amounts originally due in the selected month, including inactive bills. */
  original_bills_cents: number;
  /** Recorded payments this month plus active unpaid bills scheduled this month. */
  scheduled_bills_cents: number;
  /** Recorded receipts this month plus active unreceived income scheduled this month. */
  income_cents: number;
  /** Actual unreversed bill payments and income receipts, on their recorded dates. */
  paid_cents: number;
  received_cents: number;
  /** Active outstanding bills and income scheduled in the selected month. */
  remaining_cents: number;
  expected_income_cents: number;
  /** Active outstanding bills across every date; postponing a bill does not clear overdue status. */
  outstanding_cents: number;
  past_due_cents: number;
  /** Selected-month income forecast minus bill forecast; excludes balances, transfers, and scenarios. */
  net_cents: number;
}

const invalidNameCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function normalizeTagName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a name for this tag.");
  if (invalidNameCharacters.test(value)) throw new Error("Tag names cannot include control characters or line breaks.");
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name) throw new Error("Enter a name for this tag.");
  if (Array.from(name).length > 60) throw new Error("Tag names must be 60 characters or fewer.");
  return name;
}

/** The matching SQL key preserves dotted-I's mark and equates both Greek sigmas. */
export function tagNameKey(value: unknown): string {
  return normalizeTagName(value).toLocaleLowerCase("en-US").replace(/\u03c2/gu, "\u03c3");
}

function ownedUnique<T extends { id: string; user_id: string }>(items: readonly T[], userId: string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.user_id !== userId || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function entryTagIds(entry: { tag_ids?: readonly string[] | null }): Set<string> {
  const ids = Array.isArray(entry.tag_ids) ? entry.tag_ids : [];
  return new Set(ids.filter((id) => typeof id === "string" && id.length > 0).map((id) => id.toLowerCase()));
}

/** Primitive association matching; use filterFinanceByTag when checking a complete owner snapshot. */
export function matchesTag(entry: { tag_ids?: readonly string[] | null }, tagScope: FinanceTagScope = "all"): boolean {
  if (tagScope === "all") return true;
  const ids = entryTagIds(entry);
  if (tagScope === "untagged") return ids.size === 0;
  return typeof tagScope === "string" && ids.has(tagScope.toLowerCase());
}

/** Direct entry associations are authoritative, including an explicit empty list. */
export function tagsForEntry(data: FinanceData, entry: Pick<FinanceEntry, "user_id"> & { tag_ids?: readonly string[] | null }): FinanceTag[] {
  if (entry.user_id !== data.user.id) return [];
  const ids = entryTagIds(entry);
  return ownedUnique(data.tags ?? [], data.user.id).filter((tag) => ids.has(tag.id.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Archived tags remain filterable while any owned entry still uses them. */
export function tagOptions(data: FinanceData): FinanceTagOption[] {
  const entries = ownedUnique(data.entries, data.user.id);
  const tags = ownedUnique(data.tags ?? [], data.user.id);
  const options = tags.map((tag) => ({ value: tag.id, label: tag.name,
    count: entries.filter((entry) => matchesTag(entry, tag.id)).length, archived: Boolean(tag.archived_at),
  })).filter((tag) => !tag.archived || tag.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label, "en-US", { sensitivity: "base" }) || a.value.localeCompare(b.value));
  return [
    { value: "all", label: "All tags", count: entries.length, archived: false },
    { value: "untagged", label: "Untagged", count: entries.filter((entry) => matchesTag(entry, "untagged")).length, archived: false },
    ...options,
  ];
}

/**
 * Retains all payment dates/accounts for selected entries so remainders stay correct.
 * Other related data is preserved for existing summaries. Filtered account balance
 * fields are not real bank balances: a tag groups flows, not ownership of cash.
 */
export function filterFinanceByTag(data: FinanceData, tagScope: FinanceTagScope = "all"): FinanceData {
  const tags = ownedUnique(data.tags ?? [], data.user.id);
  const knownScope = tagScope === "all" || tagScope === "untagged" || typeof tagScope === "string" && tags.some((tag) => tag.id.toLowerCase() === tagScope.toLowerCase());
  const entries = knownScope ? ownedUnique(data.entries, data.user.id).filter((entry) => matchesTag(entry, tagScope)) : [];
  const ids = new Set(entries.map((entry) => entry.id));
  const payments = ownedUnique(data.payments, data.user.id).filter((payment) => ids.has(payment.entry_id));
  return { ...data, entries, payments };
}

export function tagSummary(data: FinanceData, tagScope: FinanceTagScope, month: string, today = data.today, accountScope: FinanceAccountScope = "all"): FinanceTagSummary {
  const selected = filterFinanceByTag(data, tagScope);
  const summary: FinanceTagSummary = { entries: selected.entries, entry_count: selected.entries.length,
    original_bills_cents: 0, scheduled_bills_cents: 0, income_cents: 0, paid_cents: 0, received_cents: 0,
    remaining_cents: 0, expected_income_cents: 0, outstanding_cents: 0, past_due_cents: 0, net_cents: 0 };
  const byId = new Map(selected.entries.map((entry) => [entry.id, entry]));
  for (const payment of selected.payments) {
    if (payment.reversed_at || !dayInMonth(payment.paid_on, month) || !matchesAccountScope(payment.account_id, accountScope)) continue;
    const entry = byId.get(payment.entry_id);
    if (entry?.kind === "bill") summary.paid_cents += payment.amount_cents;
    else if (entry?.kind === "income") summary.received_cents += payment.amount_cents;
  }
  for (const entry of selected.entries) {
    if (!matchesAccountScope(entry.account_id, accountScope)) continue;
    if (entry.kind === "bill" && dayInMonth(entry.original_due_date, month)) summary.original_bills_cents += entry.original_amount_cents;
    if (entry.status !== "active") continue;
    const remaining = remainingAmount(entry, selected.payments);
    if (entry.kind === "bill") {
      summary.outstanding_cents += remaining;
      if (isPastDue(entry, selected.payments, today)) summary.past_due_cents += remaining;
      if (dayInMonth(entry.scheduled_date, month)) summary.remaining_cents += remaining;
    } else if (dayInMonth(entry.scheduled_date, month)) summary.expected_income_cents += remaining;
  }
  summary.scheduled_bills_cents = summary.paid_cents + summary.remaining_cents;
  summary.income_cents = summary.received_cents + summary.expected_income_cents;
  summary.net_cents = summary.income_cents - summary.scheduled_bills_cents;
  return summary;
}
