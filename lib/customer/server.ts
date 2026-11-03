import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getHubService } from "@/lib/hub/server";
import { authenticateCustomer } from "./auth-core";
import type { CustomerContext, CustomerIdentity } from "./types";
import { CustomerSupportError, customerUuid } from "./validation";

function unavailable(): never { throw new CustomerSupportError(503, "SUPPORT_UNAVAILABLE", "Support is temporarily unavailable. Please try again or use the Geofox support form."); }
function novaSupportClient(): { client: SupabaseClient; issuer: string } {
  const configured = process.env.NOVANOOK_SUPABASE_URL;
  const secret = process.env.NOVANOOK_SUPABASE_SECRET_KEY || process.env.NOVANOOK_SUPABASE_SERVICE_ROLE_KEY;
  if (!configured || !secret) unavailable();
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) unavailable();
    return { client: createClient(url.origin, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10000) }) },
    }), issuer: url.origin + "/auth/v1" };
  } catch { unavailable(); }
}
export function customerDbError(error: { code?: string } | null): never {
  switch (error?.code) {
    case "P0100": throw new CustomerSupportError(404, "TICKET_NOT_FOUND", "This support request is unavailable.");
    case "P0101": throw new CustomerSupportError(409, "IDEMPOTENCY_CONFLICT", "This retry has different content. Start a new submission after checking your requests.");
    case "P0102": throw new CustomerSupportError(409, "TICKET_CLOSED", "This request is closed. Create a new support request if you still need help.");
    case "P0103": throw new CustomerSupportError(429, "RATE_LIMITED", "You have sent several support messages. Please wait before trying again.");
    case "22023": case "23514": case "22P02": throw new CustomerSupportError(400, "INVALID_INPUT", "Please check the message and try again.");
    default: unavailable();
  }
}
export function customerRateKey(scope: string, value: string): string {
  const salt = process.env.HUB_RATE_LIMIT_SALT || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) unavailable();
  return createHmac("sha256", salt).update("customer-support:" + scope + ":" + value).digest("hex");
}
async function reserve(key: string, seconds: number, limit: number): Promise<void> {
  const { data, error } = await getHubService().rpc("hub_reserve_rate_limit", { p_key_hash: key, p_window_seconds: seconds, p_limit: limit });
  if (error) unavailable();
  if (data !== true) throw new CustomerSupportError(429, "RATE_LIMITED", "Too many support requests. Please wait a moment and try again.");
}
export async function getCustomerContext(request: Request): Promise<CustomerContext> {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization) || authorization.length > 16400) {
    throw new CustomerSupportError(401, "AUTH_REQUIRED", "Sign in to NovaNook to open your support requests.");
  }
  // Never trust arbitrary X-Forwarded-For or a JSON IP field. Vercel supplies
  // this header. Native requests still arrive through the same trusted edge.
  const ip = process.env.VERCEL ? (request.headers.get("x-vercel-forwarded-for") || "").split(",")[0].trim()
    : process.env.NODE_ENV === "development" ? "127.0.0.1" : "";
  if (!isIP(ip)) unavailable();
  const ipKey = customerRateKey("novanook:ip", ip);
  await reserve(customerRateKey("novanook:edge", ip), 60, 180);
  const { client, issuer } = novaSupportClient();
  const identity = await authenticateCustomer(authorization.slice(7), issuer, {
    async getUser(token) {
      try {
        const result = await client.auth.getUser(token);
        return { user: result.data.user, error: result.error };
      } catch { unavailable(); }
    },
    async currentIdentity(userId, sessionId) {
      const { data, error } = await client.rpc("geofox_hub_customer_identity", { p_user_id: userId, p_session_id: sessionId });
      if (error) unavailable();
      return data as CustomerIdentity | null;
    },
  });
  const { data: app, error } = await getHubService().from("hub_apps").select("name").eq("slug", "novanook").eq("active", true).maybeSingle();
  if (error || !app) unavailable();
  const accountKey = customerRateKey("novanook:account", identity.id);
  await reserve(customerRateKey("novanook:access", identity.id), 60, 120);
  return { ...identity, appSlug: "novanook", appName: app.name, ipKey, accountKey };
}

// Email is an optional notification channel for an already-published in-app
// reply. Resolve today's confirmed source address, never a stale ticket field.
export async function currentCustomerNotificationEmail(appSlug: string, ownerId: string): Promise<string | null> {
  if (appSlug !== "novanook" || !customerUuid(ownerId)) return null;
  try {
    const { client } = novaSupportClient();
    const { data, error } = await client.auth.admin.getUserById(ownerId);
    const user = data.user as (typeof data.user & { banned_until?: string; deleted_at?: string }) | null;
    if (error || !user || user.id !== ownerId || user.is_anonymous || !user.email_confirmed_at || !user.email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) || user.deleted_at ||
        (user.banned_until && Date.parse(user.banned_until) > Date.now())) return null;
    return user.email;
  } catch { return null; }
}
