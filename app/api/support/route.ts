import { isIP } from "node:net";
import { createTicket } from "@/lib/hub/data";
import { apiError, json, readJson, RequestError, sameOrigin, textValue } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = await readJson(request, 48_000);
    if (input.website) throw new RequestError(400, "REQUEST_REJECTED", "This request could not be submitted.");
    const ip = process.env.VERCEL ? (request.headers.get("x-vercel-forwarded-for") || "").split(",")[0].trim() : process.env.NODE_ENV === "development" ? "127.0.0.1" : "";
    if (!isIP(ip)) throw new RequestError(503, "REQUEST_UNVERIFIED", "This request could not be verified. Please try again later.");
    const result = await createTicket({ appSlug: textValue(input.appSlug, 48, true), email: textValue(input.email, 254, true), subject: textValue(input.subject, 180, true), body: textValue(input.body, 12000, true), category: textValue(input.category, 30, true), customerId: textValue(input.customerId, 128) || null }, { ip });
    return json({ reference: result.reference, createdAt: result.createdAt }, 201);
  } catch (error) { return apiError(error); }
}
