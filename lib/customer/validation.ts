import type { CustomerCursor, CustomerTicketCategory } from "./types";

export class CustomerSupportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CustomerSupportError";
    this.status = status;
    this.code = code;
  }
}

export const customerOrigins = new Set([
  "https://mynovanook.com",
  "https://www.mynovanook.com",
  "capacitor://localhost",
  "https://localhost",
]);
export const customerCategories: CustomerTicketCategory[] = ["general", "account", "billing", "bug", "safety", "feedback"];
export function customerUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function requireCustomerUuid(value: unknown): string {
  if (!customerUuid(value)) throw new CustomerSupportError(400, "INVALID_INPUT", "Please refresh and try this request again.");
  return value.toLowerCase();
}
export function customerText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw new CustomerSupportError(400, "INVALID_INPUT", "Please complete the required message fields.");
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new CustomerSupportError(400, "INVALID_INPUT", "Check the message length and remove unsupported characters.");
  }
  return normalized;
}
function onlyKeys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new CustomerSupportError(400, "INVALID_INPUT", "This request contains unsupported fields.");
}
export function customerCreateInput(input: Record<string, unknown>) {
  onlyKeys(input, ["subject", "body", "category", "requestId"]);
  const subject = customerText(input.subject, 3, 180);
  if (subject.includes("\n")) throw new CustomerSupportError(400, "INVALID_INPUT", "Keep the subject on one line.");
  if (!customerCategories.includes(input.category as CustomerTicketCategory)) throw new CustomerSupportError(400, "INVALID_INPUT", "Choose a support category.");
  return { subject, body: customerText(input.body, 10, 12000), category: input.category as CustomerTicketCategory, requestId: requireCustomerUuid(input.requestId) };
}
export function customerReplyInput(input: Record<string, unknown>) {
  onlyKeys(input, ["body", "requestId"]);
  return { body: customerText(input.body, 1, 12000), requestId: requireCustomerUuid(input.requestId) };
}
export function customerLimit(raw: string | null): number {
  if (raw === null) return 20;
  if (!/^[1-9][0-9]?$/.test(raw) || Number(raw) > 25) throw new CustomerSupportError(400, "INVALID_INPUT", "Choose a page size from 1 to 25.");
  return Number(raw);
}
export function encodeCustomerCursor(value: CustomerCursor | null): string | null {
  return value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url") : null;
}
export function decodeCustomerCursor(value: string | null): CustomerCursor | null {
  if (!value) return null;
  try {
    if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as CustomerCursor;
    if (!decoded || Object.keys(decoded).sort().join(",") !== "createdAt,id" || !customerUuid(decoded.id) || typeof decoded.createdAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(decoded.createdAt) || !Number.isFinite(Date.parse(decoded.createdAt))) throw new Error();
    // Preserve PostgreSQL microseconds; Date.toISOString would silently skip
    // adjacent rows whose creation timestamps differ within one millisecond.
    return { id: decoded.id.toLowerCase(), createdAt: decoded.createdAt };
  } catch {
    throw new CustomerSupportError(400, "INVALID_CURSOR", "Refresh your support requests and try again.");
  }
}
