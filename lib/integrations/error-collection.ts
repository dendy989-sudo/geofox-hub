import "server-only";
import { randomUUID } from "node:crypto";
import { assertCapability, databaseError, getHubService, type HubContext } from "@/lib/hub/server";
import type { ServiceStatus } from "@/lib/hub/types";
import { errorCollectionStatus } from "./error-collection-status";
import { checkTelemetryConnection, sendTelemetryChallenge, type TelemetryCheck } from "./telemetry-check";

const fields = "app_slug,challenge_id,outcome,started_at,expires_at,accepted_at,last_success_at,latency_ms";

export async function errorCollectionHealth(context: HubContext, appSlug: string, lastErrorAt: string | null, force = false): Promise<ServiceStatus> {
  assertCapability(context, "operations:read", appSlug);
  const secret = process.env[`${appSlug.replaceAll("-", "_").toUpperCase()}_HUB_INGEST_SECRET`];
  const configured = typeof secret === "string" && secret.length >= 32 && Boolean(secret.trim());
  const production = process.env.VERCEL_ENV === "production";
  if (appSlug !== "novanook" || !production || !configured) return errorCollectionStatus(appSlug, null, lastErrorAt, { configured, production });
  try {
    const db = getHubService();
    const check = await checkTelemetryConnection({
      force, uuid: randomUUID,
      store: {
        async read() {
          const { data, error } = await db.from("hub_telemetry_checks").select(fields).eq("app_slug", appSlug).abortSignal(AbortSignal.timeout(4000)).maybeSingle();
          if (error) databaseError(error);
          return data as TelemetryCheck | null;
        },
        async begin(challengeId) {
          const { data, error } = await db.rpc("hub_begin_telemetry_check", { p_app: appSlug, p_challenge_id: challengeId }).abortSignal(AbortSignal.timeout(4000));
          if (error) databaseError(error);
          return data as { started: boolean; check: TelemetryCheck };
        },
        async finish(challengeId, outcome, latencyMs) {
          const { data, error } = await db.rpc("hub_finish_telemetry_check", { p_app: appSlug, p_challenge_id: challengeId, p_outcome: outcome, p_latency_ms: latencyMs }).abortSignal(AbortSignal.timeout(4000));
          if (error) databaseError(error);
          return data as TelemetryCheck;
        },
      },
      challenge: challengeId => sendTelemetryChallenge({ secret: secret!, challengeId }),
    });
    return errorCollectionStatus(appSlug, check, lastErrorAt);
  } catch {
    // Monitoring failure must not hide account totals or other service checks.
    return errorCollectionStatus(appSlug, null, lastErrorAt, { unavailable: true });
  }
}
