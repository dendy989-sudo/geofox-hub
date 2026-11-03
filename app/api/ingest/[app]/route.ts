import { recordIngestEvent, type IngestEvent } from "@/lib/hub/ingest";
import { isAppSlug } from "@/lib/hub/validation";
import { apiError, json, RequestError } from "@/lib/security/http";
import { verifyIngestSignature } from "@/lib/security/ingest-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, route: { params: Promise<{ app: string }> }) {
  try {
    const { app } = await route.params;
    if (!isAppSlug(app)) throw new RequestError(404, "NOT_FOUND", "This event source is not available.");
    const secret = process.env[`${app.replaceAll("-", "_").toUpperCase()}_HUB_INGEST_SECRET`];
    if (!secret || secret.length < 32) throw new RequestError(503, "INGEST_NOT_CONFIGURED", "Event ingestion is not configured for this source.");
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new RequestError(415, "JSON_REQUIRED", "Send a JSON event.");
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError(400, "EMPTY_EVENT", "The event body is empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) { await reader.cancel(); throw new RequestError(413, "EVENT_TOO_LARGE", "The event exceeds the maximum size."); }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks);
    if (!verifyIngestSignature(raw, request.headers.get("x-geofox-timestamp"), request.headers.get("x-geofox-signature"), secret)) throw new RequestError(401, "INVALID_SIGNATURE", "The event signature or timestamp is invalid.");
    let event: IngestEvent;
    try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { throw new RequestError(400, "INVALID_EVENT", "The event body is invalid JSON."); }
    return json(await recordIngestEvent(app, event), 202);
  } catch (error) { return apiError(error); }
}
