import { NextResponse } from "next/server";

export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) throw new RequestError(403, "ORIGIN_REJECTED", "Please submit this action from the Geofox website.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new RequestError(403, "ORIGIN_REJECTED", "This action must be made from Geofox.");
}

export async function readJson(request: Request, limit = 32_768): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new RequestError(415, "JSON_REQUIRED", "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "BODY_REQUIRED", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RequestError(413, "REQUEST_TOO_LARGE", "Please shorten your message."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new RequestError(400, "INVALID_JSON", "The request could not be read."); }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}

export function apiError(error: unknown) {
  const e = error as { name?: string; status?: number; code?: string; message?: string };
  const safe = error instanceof RequestError || (e?.name === "HubError");
  return NextResponse.json({ error: safe ? e.message : "This request could not be completed. Please try again or review the connection status.", code: safe ? e.code : "REQUEST_FAILED" }, { status: safe && e.status ? e.status : 500, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}

export function textValue(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > max) throw new RequestError(400, "INVALID_INPUT", "Please check the required fields and message length.");
  return text;
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
