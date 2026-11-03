import { NextResponse } from "next/server";
import { RequestError } from "@/lib/security/http";
import { CustomerSupportError, customerOrigins } from "./validation";

function responseHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex", Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && customerOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
export function assertCustomerOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Native HTTP clients may omit Origin. They still require the same verified
  // Bearer token; cookies never authorize these routes.
  if (origin !== null && !customerOrigins.has(origin)) throw new CustomerSupportError(403, "ORIGIN_REJECTED", "Open support from the NovaNook app or website.");
}
export function customerPreflight(request: Request): Response {
  try {
    assertCustomerOrigin(request);
    const method = request.headers.get("access-control-request-method");
    const requested = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map(item => item.trim()).filter(Boolean);
    if (!["GET", "POST"].includes(method || "") || requested.some(header => !["authorization", "content-type"].includes(header))) {
      throw new CustomerSupportError(403, "ORIGIN_REJECTED", "This support request is not supported.");
    }
    const headers = responseHeaders(request);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  } catch (error) { return customerError(request, error); }
}
export function customerJson(request: Request, data: unknown, status = 200): Response {
  return NextResponse.json({ data }, { status, headers: responseHeaders(request) });
}
export function customerError(request: Request, error: unknown): Response {
  const safe = error instanceof CustomerSupportError || error instanceof RequestError;
  const status = safe ? error.status : 503;
  const headers = responseHeaders(request);
  if (status === 429) headers.set("Retry-After", "60");
  return NextResponse.json({
    error: safe ? error.message : "Support is temporarily unavailable. Please try again shortly.",
    code: safe ? error.code : "SUPPORT_UNAVAILABLE",
  }, { status, headers });
}
