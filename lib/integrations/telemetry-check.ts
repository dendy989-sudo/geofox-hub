import { createHmac } from "node:crypto";

export const TELEMETRY_CHECK_URL = "https://www.mynovanook.com/api/geofox-telemetry-check";
export const TELEMETRY_CHECK_TIMEOUT_MS = 8000;
export const TELEMETRY_CHECK_FRESH_MS = 5 * 60_000;
export const TELEMETRY_CHECK_COOLDOWN_MS = 60_000;
export type TelemetryFailure = "authentication" | "source_not_configured" | "source_unavailable" | "delivery_failed" | "invalid_response" | "timeout";
export type TelemetryOutcome = "pending" | "connected" | TelemetryFailure;
export interface TelemetryCheck {
  app_slug: string;
  challenge_id: string;
  outcome: TelemetryOutcome;
  started_at: string;
  expires_at: string;
  accepted_at: string | null;
  last_success_at: string | null;
  latency_ms: number | null;
}

interface ChallengeOptions {
  secret: string;
  challengeId: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Fixed target and domain-separated authentication. Never return remote text. */
export async function sendTelemetryChallenge({ secret, challengeId, fetcher = fetch, now = Date.now, timeoutMs = TELEMETRY_CHECK_TIMEOUT_MS }: ChallengeOptions): Promise<TelemetryFailure> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TelemetryFailure>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, timeoutMs);
  });
  const request = (async (): Promise<TelemetryFailure> => {
    try {
      const body = JSON.stringify({ challengeId });
      const timestamp = String(Math.floor(now() / 1000));
      const signature = createHmac("sha256", secret).update(`${timestamp}.geofox-telemetry-check.v1.${body}`).digest("hex");
      const response = await fetcher(TELEMETRY_CHECK_URL, {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/octet-stream", "x-geofox-timestamp": timestamp, "x-geofox-signature": signature }, body,
      });
      if (response.status === 401 || response.status === 403) return "authentication";
      if (response.status === 404 || response.status === 405) return "source_unavailable";
      // Read within the overall deadline and enforce a small receipt size.
      const reader = response.body?.getReader();
      if (!reader) return "invalid_response";
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { void reader.cancel().catch(() => {}); return "invalid_response"; }
        chunks.push(value);
      }
      const reply = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (response.status === 503 && reply?.code === "NOT_CONFIGURED") return "source_not_configured";
      if (response.status === 503 && reply?.code === "DELIVERY_FAILED") return "delivery_failed";
      // A positive source response is NOT proof of delivery. The caller reads
      // its exact challenge receipt from the receiving database before success.
      if (response.status === 200 && reply?.ok === true && reply?.challengeId === challengeId) return "delivery_failed";
      return response.status >= 500 ? "source_unavailable" : "invalid_response";
    } catch { return controller.signal.aborted ? "timeout" : "source_unavailable"; }
  })();
  try { return await Promise.race([deadline, request]); }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}

export interface TelemetryCheckStore {
  read(): Promise<TelemetryCheck | null>;
  begin(challengeId: string): Promise<{ started: boolean; check: TelemetryCheck }>;
  finish(challengeId: string, outcome: TelemetryFailure, latencyMs: number): Promise<TelemetryCheck>;
}

/** DB-backed claim prevents concurrent dashboards from creating probe storms. */
export async function checkTelemetryConnection({ store, challenge, uuid, now = Date.now, force = false }: {
  store: TelemetryCheckStore;
  challenge: (id: string) => Promise<TelemetryFailure>;
  uuid: () => string;
  now?: () => number;
  force?: boolean;
}): Promise<TelemetryCheck | null> {
  const previous = await store.read();
  if (!force && previous && now() - Date.parse(previous.started_at) < TELEMETRY_CHECK_FRESH_MS) return previous;
  const id = uuid();
  const claim = await store.begin(id);
  if (!claim.started) return claim.check;
  const started = now();
  const outcome = await challenge(id);
  // finish is atomic: an accepted callback always wins; old results cannot
  // replace a newer check. An HTTP 200 without a receipt remains a failure.
  return store.finish(id, outcome, Math.max(0, Math.min(10_000, Math.round(now() - started))));
}
