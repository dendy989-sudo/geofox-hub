import type { ServiceStatus } from "../hub/types";
import type { TelemetryCheck, TelemetryFailure } from "./telemetry-check";

const FRESH_MS = 5 * 60_000;
const COOLDOWN_MS = 60_000;
const failures: Record<TelemetryFailure, string> = {
  authentication: "NovaNook rejected the signed check. Confirm that the two private signing settings match, then redeploy the affected app.",
  source_not_configured: "NovaNook’s reporter is missing its production destination or signing setting. Check its hosting settings and redeploy.",
  source_unavailable: "NovaNook’s connection-check endpoint could not be reached. Check its latest deployment and try again.",
  delivery_failed: "NovaNook did not complete a verified delivery to Geofox. Check the Geofox receiver, its database, and the matching signing settings, then try again.",
  invalid_response: "NovaNook did not return the expected connection receipt. Check that both apps have the current reporting update.",
  timeout: "The connection check timed out. Try again; if this continues, check both apps’ hosting and database availability.",
};

export function errorCollectionStatus(appSlug: string, check: TelemetryCheck | null, lastErrorAt: string | null, {
  configured = true, production = true, unavailable = false, now = Date.now(),
}: { configured?: boolean; production?: boolean; unavailable?: boolean; now?: number } = {}): ServiceStatus {
  const base: ServiceStatus = {
    id: "errors", appSlug, name: "Application error collection", status: "unknown",
    detail: "A signed connection check has not completed yet.", latencyMs: null, checkedAt: null,
    errorCollection: { state: "not_checked", lastSuccessAt: check?.last_success_at ?? null, lastErrorAt, canCheck: appSlug === "novanook" && production && configured, nextCheckAt: check ? new Date(Date.parse(check.started_at) + COOLDOWN_MS).toISOString() : null },
  };
  if (appSlug !== "novanook") return { ...base, detail: "Add this app’s server reporter and connection-check adapter to verify collection." };
  if (!production) return { ...base, detail: "Production collection is checked from the live Geofox admin. Preview deployments do not send production checks." };
  if (!configured) return { ...base, detail: "Geofox’s receiver signing setting is missing or invalid. Configure the app’s private ingest secret and redeploy." };
  if (unavailable) return { ...base, status: "degraded", detail: "The connection check could not read or save its receipt. Check the Geofox database connection and telemetry migration.", errorCollection: { ...base.errorCollection!, state: "needs_attention" } };
  if (!check) return base;
  base.checkedAt = check.accepted_at || check.started_at;
  base.latencyMs = check.latency_ms;
  if (check.outcome === "pending") {
    if (Date.parse(check.expires_at) > now) return { ...base, detail: "A connection check is in progress. Refresh shortly to see the result.", errorCollection: { ...base.errorCollection!, state: "checking" } };
    return { ...base, status: "degraded", detail: failures.timeout, errorCollection: { ...base.errorCollection!, state: "needs_attention" } };
  }
  if (check.outcome === "connected" && check.accepted_at) {
    const age = now - Date.parse(check.accepted_at);
    if (age >= 0 && age <= FRESH_MS) return { ...base, status: "healthy", detail: lastErrorAt ? "NovaNook’s signed connection receipt reached Geofox. Real application errors are tracked separately below." : "NovaNook’s signed connection receipt reached Geofox. No application errors have been received yet.", errorCollection: { ...base.errorCollection!, state: "connected" } };
    return { ...base, detail: "The last successful connection check is over five minutes old. Check again to verify current delivery.", errorCollection: { ...base.errorCollection!, state: "stale" } };
  }
  return { ...base, status: "degraded", detail: failures[check.outcome as TelemetryFailure] || failures.invalid_response, errorCollection: { ...base.errorCollection!, state: "needs_attention" } };
}

export function errorCollectionLabel(state: NonNullable<ServiceStatus["errorCollection"]>["state"]): string {
  return { connected: "Connected", checking: "Checking connection", needs_attention: "Needs attention", not_checked: "Not checked", stale: "Check again" }[state];
}

/** An open tab must not keep displaying fresh evidence after it expires. */
export function currentErrorCollectionStatus(service: ServiceStatus, now = Date.now()): ServiceStatus {
  const collection = service.errorCollection;
  const checkedAt = Date.parse(service.checkedAt || "");
  if (!collection || !Number.isFinite(checkedAt)) return service;
  if (collection.state === "connected" && now - checkedAt > FRESH_MS) return { ...service, status: "unknown", detail: "The last successful connection check is over five minutes old. Check again to verify current delivery.", errorCollection: { ...collection, state: "stale" } };
  if (collection.state === "checking" && now - checkedAt >= 30_000) return { ...service, status: "degraded", detail: failures.timeout, errorCollection: { ...collection, state: "needs_attention" } };
  return service;
}
