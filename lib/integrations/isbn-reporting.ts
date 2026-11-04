import type { IsbnDailyUsage, IsbnObservation, IsbnOutcome, IsbnProviderReport, ServiceStatus } from "../hub/types.ts";

// Passive observations describe recent use, not an on-demand availability probe.
export const ISBN_HEALTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const outcomes = new Set<IsbnOutcome>(["success", "not_found", "authentication", "rate_limited", "unavailable", "invalid_response", "timeout", "network_error"]);
const validResponse = (outcome: IsbnOutcome) => outcome === "success" || outcome === "not_found";
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isbnOutcomeLabel: Record<IsbnOutcome, string> = {
  success: "Successful response", not_found: "No matching book", authentication: "Provider authentication failed",
  rate_limited: "Provider rate limit", unavailable: "Provider unavailable", invalid_response: "Unexpected provider response",
  timeout: "Provider request timed out", network_error: "Provider connection failed",
};

function observation(value: unknown): IsbnObservation | null {
  const row = object(value);
  if (!row || !timestamp(row.observedAt) || !["detail", "search"].includes(String(row.operation)) || !outcomes.has(row.outcome as IsbnOutcome)
    || !integer(row.latencyMs) || row.latencyMs > 300_000
    || (row.httpStatus !== null && (!integer(row.httpStatus) || row.httpStatus < 100 || row.httpStatus > 599))) return null;
  const outcome = row.outcome as IsbnOutcome, status = row.httpStatus as number | null;
  if ((outcome === "success" && (status === null || status < 200 || status >= 300))
    || (outcome === "not_found" && status !== 404)
    || (outcome === "authentication" && status !== 401 && status !== 403)
    || (outcome === "rate_limited" && status !== 429)) return null;
  return { observedAt: row.observedAt, operation: row.operation as IsbnObservation["operation"], outcome, httpStatus: status, latencyMs: row.latencyMs };
}

function dailyUsage(value: unknown): IsbnDailyUsage | null {
  const row = object(value);
  if (!row || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !timestamp(row.date)
    || ![row.requests, row.successes, row.notFound, row.failures, row.rateLimited].every(integer)
    || (row.avgLatencyMs !== null && (typeof row.avgLatencyMs !== "number" || !Number.isFinite(row.avgLatencyMs) || row.avgLatencyMs < 0 || row.avgLatencyMs > 300_000))) return null;
  const result = { date: row.date, requests: row.requests as number, successes: row.successes as number, notFound: row.notFound as number, failures: row.failures as number, rateLimited: row.rateLimited as number, avgLatencyMs: row.avgLatencyMs as number | null };
  return result.requests === result.successes + result.notFound + result.failures && result.rateLimited <= result.failures ? result : null;
}

// Keep malformed/missing telemetry unknown and expose only the documented fields.
export function normalizeIsbnReport(value: unknown): IsbnProviderReport | null {
  const report = object(value);
  if (!report || report.version !== 1 || report.appId !== "novanook" || report.provider !== "isbndb" || report.timezone !== "UTC"
    || !timestamp(report.capturedAt) || !timestamp(report.collectedSince)
    || (report.lastSuccessAt !== null && !timestamp(report.lastSuccessAt))
    || !Array.isArray(report.daily) || report.daily.length > 31) return null;
  const today = dailyUsage(report.today);
  const latest = report.lastObservation === null ? null : observation(report.lastObservation);
  const failure = report.lastFailure === null ? null : observation(report.lastFailure);
  const daily = report.daily.map(dailyUsage);
  if (!today || today.date !== new Date(report.capturedAt).toISOString().slice(0, 10)
    || (report.lastObservation !== null && !latest) || (report.lastFailure !== null && (!failure || validResponse(failure.outcome)))
    || daily.some(day => !day) || (today.requests > 0 && !latest)) return null;
  return { version: 1, appId: "novanook", provider: "isbndb", capturedAt: report.capturedAt, timezone: "UTC", collectedSince: report.collectedSince,
    today, lastObservation: latest, lastSuccessAt: report.lastSuccessAt as string | null, lastFailure: failure,
    daily: (daily as IsbnDailyUsage[]).filter(day => day.date >= new Date(report.collectedSince as string).toISOString().slice(0, 10)) };
}

export function isbnServiceStatus(appSlug: string, report: IsbnProviderReport | null, blockedUntil: string | null, unavailable: string, now = Date.now()): ServiceStatus {
  const latest = report?.lastObservation;
  const age = latest ? now - Date.parse(latest.observedAt) : Infinity;
  const cooldownActive = Boolean(blockedUntil && Date.parse(blockedUntil) > now);
  const base: ServiceStatus = { id: "isbn", appSlug, name: "ISBNdb provider", status: "unknown", detail: unavailable, latencyMs: latest?.latencyMs ?? null, checkedAt: latest?.observedAt ?? null, ...(report ? { isbn: report } : {}) };
  if (cooldownActive) return { ...base, status: "degraded", detail: `ISBNdb requests are paused by a recorded provider cooldown until ${blockedUntil}.` };
  if (!report) return base;
  if (!latest) return { ...base, detail: "Request reporting is connected. Waiting for the first ISBNdb lookup; cached books do not create provider requests." };
  if (age < -CLOCK_SKEW_MS) return { ...base, detail: "The provider observation has an unexpected timestamp. Refresh after the reporting clock has been checked." };
  if (age > ISBN_HEALTH_MAX_AGE_MS) return { ...base, detail: "No provider request has been observed in the last 24 hours. The last result is historical; cached books can still load normally." };
  if (latest.outcome === "success") return { ...base, status: "healthy", detail: "The latest ISBNdb request returned a valid response within the last 24 hours." };
  if (latest.outcome === "not_found") return { ...base, status: "healthy", detail: "ISBNdb responded within the last 24 hours. The requested book was not found; this is a valid provider response." };
  return { ...base, status: "degraded", detail: `${isbnOutcomeLabel[latest.outcome]}${latest.httpStatus ? ` (HTTP ${latest.httpStatus})` : ""}. This was the latest recorded request; review the provider account or retry a normal lookup.` };
}

export function isbnCallsToday(reports: (IsbnProviderReport | null)[], now = Date.now()): number | null {
  const today = new Date(now).toISOString().slice(0, 10);
  if (!reports.length || reports.some(report => !report || report.today.date !== today)) return null;
  const result = reports.reduce((sum, report) => sum + report!.today.requests, 0);
  return Number.isSafeInteger(result) ? result : null;
}
