import type { MarketingPost, SocialPlatform } from "./marketing-types";

/** Tokens are server configuration only. Never serialize this type into a client response. */
export interface SocialConnection {
  appSlug: string | null;
  platform: "facebook" | "x";
  accountId: string;
  handle: string;
  accessToken: string;
  apiVersion?: string;
}
export interface DeliveryResult {
  state: "published" | "failed" | "uncertain";
  providerId?: string;
  url?: string;
  message?: string;
}
export function parseSocialConnections(raw: string | undefined): SocialConnection[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Invalid social connection configuration."); }
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid social connection configuration.");
  const keys = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid social connection configuration.");
    const source = item as Record<string, unknown>;
    if ((source.platform !== "facebook" && source.platform !== "x") || (source.appSlug !== null && (typeof source.appSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(source.appSlug))) || typeof source.accountId !== "string" || !/^\d{1,40}$/.test(source.accountId) || typeof source.accessToken !== "string" || !source.accessToken.trim() || source.accessToken.length > 10000 || /[\r\n]/.test(source.accessToken)) throw new Error("Invalid social connection configuration.");
    if (source.platform === "facebook" && (typeof source.apiVersion !== "string" || !/^v\d{1,2}\.\d{1,2}$/.test(source.apiVersion))) throw new Error("Set the supported Facebook Graph API version in the connection configuration.");
    if (source.handle !== undefined && (typeof source.handle !== "string" || source.handle.length > 200)) throw new Error("Invalid social connection configuration.");
    const key = `${source.appSlug ?? "company"}:${source.platform}`;
    if (keys.has(key)) throw new Error("Use one publishing account per network and app.");
    keys.add(key);
    return { appSlug: source.appSlug as string | null, platform: source.platform, accountId: source.accountId, accessToken: source.accessToken, handle: typeof source.handle === "string" ? source.handle.trim() : source.accountId, ...(source.platform === "facebook" ? { apiVersion: source.apiVersion as string } : {}) };
  });
}
export function findSocialConnection(connections: SocialConnection[], appSlug: string | null, platform: SocialPlatform) {
  return connections.find(item => item.appSlug === appSlug && item.platform === platform);
}
export function supportsDirectPublishing(post: MarketingPost) {
  return post.contentType === "text" && post.media.length === 0 && !post.thumbnail;
}
function accountUrl(connection: SocialConnection) {
  return connection.platform === "facebook" ? `https://graph.facebook.com/${connection.apiVersion}/me?fields=id,name` : "https://api.x.com/2/users/me";
}
const options = (connection: SocialConnection): RequestInit => ({ headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
/** A read request confirms that the configured token belongs to the account shown in the confirmation dialog. */
export async function verifySocialIdentity(connection: SocialConnection, transport: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await transport(accountUrl(connection), options(connection));
    if (!response.ok) return false;
    const body = await response.json() as { id?: unknown; data?: { id?: unknown } };
    return (connection.platform === "facebook" ? body.id : body.data?.id) === connection.accountId;
  } catch { return false; }
}
/** Exactly one outbound write. A timeout or an ambiguous provider response never triggers a retry. */
export async function sendTextPost(connection: SocialConnection, caption: string, transport: typeof fetch = fetch): Promise<DeliveryResult> {
  try {
    const url = connection.platform === "facebook" ? `https://graph.facebook.com/${connection.apiVersion}/${connection.accountId}/feed` : "https://api.x.com/2/tweets";
    const response = await transport(url, { ...options(connection), method: "POST", body: JSON.stringify(connection.platform === "facebook" ? { message: caption } : { text: caption }) });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408) return { state: "uncertain", message: "The network did not confirm delivery. Check the social account before trying another post." };
      return { state: "failed", message: "The network rejected this post. Review its content and the connection’s publishing permissions or API allowance." };
    }
    const body = await response.json() as { id?: unknown; data?: { id?: unknown } };
    const id = connection.platform === "facebook" ? body.id : body.data?.id;
    if (typeof id !== "string" || !(connection.platform === "facebook" ? /^\d+(?:_\d+)?$/ : /^\d+$/).test(id)) return { state: "uncertain", message: "The network accepted the request without a usable post ID. Check the social account before trying another post." };
    return { state: "published", providerId: id, url: connection.platform === "facebook" ? `https://www.facebook.com/${id}` : `https://x.com/i/web/status/${id}` };
  } catch { return { state: "uncertain", message: "Delivery could not be confirmed. Check the social account; automatic retries are blocked to prevent duplicate posts." }; }
}
