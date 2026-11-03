import "server-only";

import { createHash } from "node:crypto";
import { databaseError, getHubService, HubError } from "./server";
import { redactDiagnostic, suggestErrorAction } from "./redact";
import { cleanText, customerIdentifier, isAppSlug } from "./validation";

export interface IngestEvent {
  eventId: string;
  kind: "error" | "metric" | "payment";
  occurredAt?: string;
  customerId?: string | null;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function invalid(message = "The monitoring event is invalid."): never {
  throw new HubError(400, "INVALID_EVENT", message);
}
function member(value: unknown, choices: readonly string[], fallback?: string): string {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "string" || !choices.includes(candidate)) invalid();
  return candidate;
}

/**
 * This is deliberately not a public auth boundary. Only call after verifying the
 * exact raw request body's app-specific HMAC and timestamp in the ingest route.
 * Discard unknown fields rather than persisting request bodies or arbitrary metadata.
 */
export async function recordIngestEvent(appSlug: string, event: IngestEvent): Promise<{ accepted: true; duplicate: boolean; id?: string | null }> {
  if (!isAppSlug(appSlug) || !event || typeof event !== "object" || Array.isArray(event)) invalid();
  if (typeof event.eventId !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(event.eventId)) invalid("Provide a unique monitoring event ID of 8–128 characters.");
  const kind = member(event.kind, ["error", "metric", "payment"]);
  if (event.payload !== undefined && (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))) invalid();
  const source = event.payload || event;
  const rawCustomer = event.customerId ?? source.customerId;
  const customerId = customerIdentifier(rawCustomer);
  if (rawCustomer && !customerId) invalid("The customer ID has an invalid format.");
  const occurredAt = event.occurredAt === undefined ? new Date() : new Date(event.occurredAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60_000 || occurredAt.getTime() < Date.UTC(2000, 0, 1)) invalid("The event time is invalid.");
  let payload: Record<string, unknown>;

  if (kind === "error") {
    const message = redactDiagnostic(source.message, 4000).trim();
    const title = redactDiagnostic(source.title, 200).trim() || "Application error";
    if (!message) invalid("Provide a diagnostic error message without credentials or personal data.");
    const rawCode = cleanText(source.code ?? source.errorCode, 120);
    const code = rawCode && /^[A-Za-z0-9_.:-]{1,120}$/.test(rawCode) ? rawCode : null;
    // Routes never retain query strings or fragments, including relative URLs.
    const route = redactDiagnostic(cleanText(source.route, 500).split(/[?#]/, 1)[0], 500) || null;
    const stack = redactDiagnostic(source.stack, 8000) || null;
    const rawSource = cleanText(source.source, 80);
    const errorSource = /^[A-Za-z0-9_.:-]{1,80}$/.test(rawSource) ? rawSource : "application";
    const fingerprintBasis = typeof source.fingerprint === "string" && source.fingerprint.length <= 128
      ? source.fingerprint : `${code || ""}\n${route || ""}\n${title}\n${message}`;
    const fingerprint = createHash("sha256").update(`${appSlug}\n${fingerprintBasis}`).digest("hex");
    payload = { customerId, title, message, code, route, stack, severity: member(source.severity, ["info", "warning", "error", "critical"], "error"),
      source: errorSource, fingerprint, suggestedAction: suggestErrorAction(code, message) };
  } else if (kind === "metric") {
    const metric = member(source.metric, ["search", "book_added", "isbn_call", "reading_session", "reading_minutes"]);
    const value = source.value === undefined ? 1 : source.value;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) invalid("The usage value must be a finite, non-negative number.");
    if (metric !== "reading_minutes" && !Number.isInteger(value)) invalid("Usage counts must be whole numbers.");
    const rawProvider = cleanText(source.provider, 80);
    payload = { customerId, metric, value, provider: /^[A-Za-z0-9_.:-]{1,80}$/.test(rawProvider) ? rawProvider : null };
  } else {
    // A signed backend must verify the store receipt/webhook before marking this true.
    if (source.verified !== true) invalid("Only server-verified billing events can be recorded.");
    if (source.environment !== "production") invalid("Revenue reporting accepts only verified production billing events.");
    const provider = member(source.provider, ["apple", "google", "stripe", "manual_verified"]);
    const status = member(source.status, ["paid", "refunded", "revoked", "pending", "failed"]);
    const transactionId = cleanText(source.transactionId, 201);
    if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(transactionId)) invalid("Provide the provider's transaction or refund ID.");
    const amountMinor = source.amountMinor === undefined ? null : source.amountMinor;
    if (amountMinor !== null && (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || Math.abs(amountMinor) > 10_000_000_000)) invalid("Payment amounts must be whole minor currency units, or null if unknown.");
    if (typeof amountMinor === "number" && ((status === "paid" && amountMinor < 0) || (status === "refunded" && amountMinor > 0))) invalid("Paid amounts must be positive and refund amounts must be negative.");
    const currency = typeof source.currency === "string" ? source.currency.toUpperCase() : null;
    if ((currency !== null && !/^[A-Z]{3}$/.test(currency)) || (amountMinor !== null && currency === null)) invalid("Provide a three-letter currency code with a known payment amount.");
    const product = cleanText(source.product, 200) || null;
    payload = { customerId, verified: true, environment: "production", provider, transactionId, status, amountMinor, currency, product };
  }

  const { data, error } = await getHubService().rpc("hub_accept_ingest", { p_app: appSlug, p_event_id: event.eventId,
    p_kind: kind, p_payload: payload, p_occurred_at: occurredAt.toISOString() });
  if (error) databaseError(error, "The monitoring event could not be recorded.");
  if (data?.accepted !== true) throw new HubError(503, "DATABASE_UNAVAILABLE", "The monitoring event was not confirmed.");
  return { accepted: true, duplicate: data.duplicate === true, id: data.id || null };
}
