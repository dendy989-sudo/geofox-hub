import type { FinanceData, FinanceEntry, FinancePayment, FinanceVendor } from "./types";

const URL_LIMIT = 2048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function validHostname(hostname: string): boolean {
  // The URL parser has already validated and normalized a bracketed IPv6 address.
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  const host = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (!host || host.length > 253) return false;
  return host.split(".").every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

/** Normalize a user-entered website; no credentials, scripts, or ambiguous relative URLs. */
export function normalizeVendorUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Enter the website address as text.");
  const input = value.trim();
  if (!input) return null;
  if (input.length > URL_LIMIT) throw new Error("Keep the website address within 2,048 characters.");
  if (CONTROL_CHARACTERS.test(value) || /\s/u.test(input)) throw new Error("Remove spaces and line breaks from the website address.");
  if (input.includes("\\")) throw new Error("Use forward slashes in the website address.");
  if (/^[/?#]/.test(input)) throw new Error("Enter the full website address, such as https://example.com.");

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input);
  // A dotted hostname with a numeric port is also a normal address without a scheme.
  const hostWithPort = Boolean(scheme && scheme[1].includes(".") && /^\d{1,5}(?:[/?#]|$)/.test(input.slice(scheme[0].length)));
  let candidate: string;
  if (scheme && !hostWithPort) {
    if (!/^https?$/i.test(scheme[1])) throw new Error("Use an http:// or https:// website address.");
    if (!/^https?:\/\/[^/]/i.test(input)) throw new Error("Enter the full website address after http:// or https://.");
    candidate = input;
  } else candidate = `https://${input}`;

  const authority = /^https?:\/\/([^/?#]*)/i.exec(candidate)?.[1] ?? "";
  if (authority.includes("@")) throw new Error("Use a website address without a username or password.");
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error("Enter a valid website address, such as https://example.com."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an http:// or https:// website address.");
  if (parsed.username || parsed.password) throw new Error("Use a website address without a username or password.");
  if (!validHostname(parsed.hostname)) throw new Error("Enter a website address with a valid host name.");
  if (parsed.href.length > URL_LIMIT) throw new Error("Keep the website address within 2,048 characters.");
  return parsed.href;
}

/** Stored URLs are checked again before they become a browser navigation target. */
export function vendorWebsiteUrl(value: string | null | undefined): string | null {
  try { return normalizeVendorUrl(value); }
  catch { return null; }
}

/** Direct links are authoritative: null explicitly detaches an occurrence from its vendor. */
export function vendorForEntry(data: FinanceData, entry: FinanceEntry): FinanceVendor | undefined {
  if (entry.user_id !== data.user.id || !entry.vendor_id) return undefined;
  return (data.vendors ?? []).find((vendor) => vendor.id === entry.vendor_id && vendor.user_id === data.user.id);
}

export interface VendorPaymentHistory {
  payment: FinancePayment;
  entry: FinanceEntry;
}

export interface VendorSummary {
  /** All directly linked records, including archived, cancelled, and transferred history. */
  entries: FinanceEntry[];
  /** Newest payment date first. Reversed records stay visible through payment.reversed_at. */
  history: VendorPaymentHistory[];
  /** Unreversed actual bill payments, independent of the entry's current status. */
  paid_cents: number;
  month_paid_cents: number;
  /** Actual income receipts are kept separate from money paid to the vendor. */
  received_cents: number;
  month_received_cents: number;
  /** Outstanding active bills only; archived active bills retain their financial effect. */
  outstanding_cents: number;
  past_due_cents: number;
  entry_count: number;
}

export function vendorSummary(data: FinanceData, vendorId: string, today: string, month: string): VendorSummary {
  const summary: VendorSummary = { entries: [], history: [], paid_cents: 0, month_paid_cents: 0, received_cents: 0, month_received_cents: 0, outstanding_cents: 0, past_due_cents: 0, entry_count: 0 };
  const ownerId = data.user.id;
  if (!(data.vendors ?? []).some((vendor) => vendor.id === vendorId && vendor.user_id === ownerId)) return summary;
  summary.entries = data.entries.filter((entry) => entry.user_id === ownerId && entry.vendor_id === vendorId);
  summary.entry_count = summary.entries.length;
  const byId = new Map(summary.entries.map((entry) => [entry.id, entry]));
  const paidByEntry = new Map<string, number>();

  for (const payment of data.payments) {
    if (payment.user_id !== ownerId) continue;
    const entry = byId.get(payment.entry_id);
    if (!entry) continue;
    summary.history.push({ payment, entry });
    if (payment.reversed_at) continue;
    paidByEntry.set(entry.id, (paidByEntry.get(entry.id) ?? 0) + payment.amount_cents);
    const inMonth = payment.paid_on.startsWith(`${month}-`);
    if (entry.kind === "bill") {
      summary.paid_cents += payment.amount_cents;
      if (inMonth) summary.month_paid_cents += payment.amount_cents;
    } else {
      summary.received_cents += payment.amount_cents;
      if (inMonth) summary.month_received_cents += payment.amount_cents;
    }
  }

  for (const entry of summary.entries) {
    if (entry.kind !== "bill" || entry.status !== "active") continue;
    const remaining = Math.max(0, entry.amount_cents - (paidByEntry.get(entry.id) ?? 0));
    summary.outstanding_cents += remaining;
    // Moving a payment never changes its original overdue status.
    if (entry.original_due_date < today) summary.past_due_cents += remaining;
  }
  summary.history.sort((a, b) => b.payment.paid_on.localeCompare(a.payment.paid_on) || b.payment.created_at.localeCompare(a.payment.created_at) || b.payment.id.localeCompare(a.payment.id));
  return summary;
}
