/** Shared input rules. No connection, user record, or secret belongs in this file. */
export const ticketStatuses = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export const ticketPriorities = ["low", "normal", "high", "urgent"] as const;
export const ticketCategories = ["general", "account", "billing", "bug", "safety", "feedback"] as const;
export const errorStates = ["open", "investigating", "resolved", "ignored"] as const;
export const assignableRoles = ["admin", "support", "moderator", "analyst"] as const;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isAppSlug(value: unknown): value is string {
  return typeof value === "string" && value !== "all" && /^[a-z][a-z0-9-]{1,47}$/.test(value);
}

export function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, limit) : "";
}

export function customerIdentifier(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.trim()) ? value.trim() : null;
}

export function boundedLimit(value: unknown, fallback = 50, maximum = 100): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(1, Math.min(value, maximum)) : fallback;
}

export function boundedOffset(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(0, Math.min(value, 10000)) : 0;
}

/** Calendar periods used by checklists are explicitly UTC, including Monday week starts. */
export function reviewPeriod(cadence: "daily" | "weekly", now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (cadence === "weekly") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
