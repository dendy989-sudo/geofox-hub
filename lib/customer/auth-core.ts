import type { CustomerIdentity } from "./types";
import { CustomerSupportError, customerUuid } from "./validation";

interface SourceUser {
  id: string; email?: string; email_confirmed_at?: string | null;
  is_anonymous?: boolean; banned_until?: string; deleted_at?: string | null;
}
interface SourceError { status?: number; }
export interface CustomerAuthSource {
  getUser(token: string): Promise<{ user: SourceUser | null; error?: SourceError | null }>;
  currentIdentity(userId: string, sessionId: string): Promise<CustomerIdentity | null>;
}
function authRequired(): never { throw new CustomerSupportError(401, "AUTH_REQUIRED", "Sign in to NovaNook again to open your support requests."); }

// Decode only after the source Auth server has verified this exact token.
// No issuer, user id, role, or session id from an unverified token is trusted.
export async function authenticateCustomer(token: string, expectedIssuer: string, source: CustomerAuthSource, now = Date.now()): Promise<CustomerIdentity> {
  if (token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) authRequired();
  const result = await source.getUser(token);
  if (result.error && (!result.error.status || result.error.status >= 500)) throw new CustomerSupportError(503, "SUPPORT_UNAVAILABLE", "NovaNook sign-in could not be checked. Please try again shortly.");
  if (result.error || !result.user) authRequired();
  const user = result.user;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) authRequired();
  } catch { authRequired(); }
  if (!customerUuid(user.id) || claims.sub !== user.id || claims.iss !== expectedIssuer || claims.role !== "authenticated" ||
      !(claims.aud === "authenticated" || (Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now ||
      typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat * 1000 > now + 30000 ||
      !customerUuid(claims.session_id) || claims.is_anonymous === true || user.is_anonymous === true) authRequired();
  if (!user.email || !user.email_confirmed_at) throw new CustomerSupportError(403, "EMAIL_NOT_VERIFIED", "Verify your NovaNook email to view account-linked support. You can also use the public support form.");
  if (user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > now)) throw new CustomerSupportError(403, "ACCESS_DISABLED", "Use the public support form for help accessing this account.");
  const identity = await source.currentIdentity(user.id, claims.session_id);
  if (!identity || identity.id !== user.id || identity.emailVerified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) authRequired();
  return { id: identity.id, email: identity.email, emailVerified: true };
}
