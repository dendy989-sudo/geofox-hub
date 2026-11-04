import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { HubError, type HubContext } from "@/lib/hub/server";
import { validUuid } from "@/lib/security/http";
import { permits } from "./access";
import { assertWorkspaceAccess, getWorkspaceRecord, toWorkspaceRecord, workspaceRpc } from "./server";
import { SOCIAL_PLATFORMS, type MarketingCapabilities, type MarketingPost, type PostRecord, type ProviderCapability, type SocialPlatform } from "./marketing-types";
import { captionFor, PLATFORM_NAMES } from "./marketing-utils";
import { findSocialConnection, parseSocialConnections, sendTextPost, supportsDirectPublishing, verifySocialIdentity, type DeliveryResult } from "./marketing-providers";

function connections() {
  try { return parseSocialConnections(process.env.MARKETING_SOCIAL_ACCOUNTS); }
  catch { throw new HubError(503, "SOCIAL_CONFIGURATION", "The publishing connection configuration needs attention. The planner and native publishing workflow are still available."); }
}
function scopesFor(context: HubContext, scope: string) {
  if (scope !== "all") { const app = scope === "company" ? null : scope; assertWorkspaceAccess(context, "marketing", "read", app); return [app]; }
  const scopes: (string | null)[] = [];
  if (permits(context.workspaceAccess.marketing.companyLevel, "read")) scopes.push(null);
  if (permits(context.workspaceAccess.marketing.level, "read")) scopes.push(...context.apps.map(app => app.slug));
  if (!scopes.length) throw new HubError(403, "FORBIDDEN", "Your account does not have access to marketing.");
  return scopes;
}
export function marketingCapabilities(context: HubContext, scope: string): MarketingCapabilities {
  const scopes = scopesFor(context, scope);
  const configured = connections();
  const providers: ProviderCapability[] = scopes.flatMap(appSlug => SOCIAL_PLATFORMS.map(platform => {
    const connection = findSocialConnection(configured, appSlug, platform);
    const detail = connection ? "Text publishing is configured. Account identity and publishing permission are checked when you publish. Media, scheduling, metrics, comments, and messages use the native workflow." : platform === "tiktok" ? "Use TikTok’s native tools or an approved publishing partner. TikTok’s Direct Post rules exclude private utilities for accounts managed by your own team." : "Plan and prepare posts here, then publish in the social app. Automatic publishing, metrics, comments, and messages are not connected.";
    return { appSlug, platform, available: Boolean(connection), mode: connection ? "direct" : "manual", label: connection ? "Text publishing configured" : "Native publishing workflow", detail, ...(connection ? { accountId: connection.accountId, handle: connection.handle } : {}), publishTypes: connection ? ["text"] : [], analytics: false, comments: false, messages: false } satisfies ProviderCapability;
  }));
  return { providers, automaticScheduling: false };
}
function asPost(record: Awaited<ReturnType<typeof getWorkspaceRecord>>): PostRecord {
  if (record.module !== "marketing" || record.data.kind !== "post") throw new HubError(400, "INVALID_POST", "Choose a marketing post.");
  return record as unknown as PostRecord;
}
async function saveDelivery(context: HubContext, record: PostRecord, data: MarketingPost, status = record.status) {
  const row = await workspaceRpc<Record<string, unknown>>("hub_workspace_save", { p_actor: context.user.id, p_id: record.id, p_version: record.version, p_module: "marketing", p_app: record.appSlug, p_title: record.title, p_status: status, p_data: data, p_request: null });
  return toWorkspaceRecord<MarketingPost>(row);
}
async function finishDelivery(context: HubContext, claimed: PostRecord, platform: SocialPlatform, attemptId: string, result: DeliveryResult) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = attempt === 0 ? claimed : asPost(await getWorkspaceRecord(context, claimed.id, "write"));
    const delivery = latest.data.delivery?.[platform];
    if (!delivery || delivery.attemptId !== attemptId) throw new HubError(409, "DELIVERY_CHANGED", "Delivery details changed. Review the social account before taking another action.");
    const timestamp = new Date().toISOString();
    const data: MarketingPost = { ...latest.data, delivery: { ...latest.data.delivery, [platform]: { ...delivery, state: result.state, ...(result.providerId ? { providerId: result.providerId } : {}), ...(result.message ? { error: result.message } : {}) } } };
    if (result.state === "published") data.publication = { ...data.publication, [platform]: { ...data.publication[platform], url: result.url!, publishedAt: timestamp } };
    const allPublished = data.platforms.length > 0 && data.platforms.every(network => Boolean(data.publication[network]?.publishedAt));
    if (allPublished) data.publishedAt = data.publishedAt || timestamp;
    try { return await saveDelivery(context, latest, data, allPublished ? "published" : latest.status); }
    catch (error) { if (!(error instanceof HubError) || error.status !== 409 || attempt === 2) throw error; }
  }
  throw new Error("Unreachable delivery result.");
}
export async function publishMarketingPost(context: HubContext, input: Record<string, unknown>) {
  if (!validUuid(input.id) || !Number.isSafeInteger(input.version) || Number(input.version) < 1 || !SOCIAL_PLATFORMS.includes(input.platform as SocialPlatform) || typeof input.expectedAccountId !== "string") throw new HubError(400, "INVALID_INPUT", "Please refresh the post and confirm its destination again.");
  const record = asPost(await getWorkspaceRecord(context, input.id, "write"));
  assertWorkspaceAccess(context, "marketing", "write", record.appSlug);
  if (record.version !== input.version) throw new HubError(409, "RECORD_CHANGED", "This post changed. Refresh it and review the latest content before publishing.");
  const platform = input.platform as SocialPlatform;
  const connection = findSocialConnection(connections(), record.appSlug, platform);
  if (!connection || connection.accountId !== input.expectedAccountId) throw new HubError(409, "ACCOUNT_CHANGED", "The publishing account is unavailable or changed. Review the account before publishing.");
  if (!record.data.platforms.includes(platform) || !["draft", "scheduled"].includes(record.status) || !supportsDirectPublishing(record.data)) throw new HubError(400, "UNSUPPORTED_POST", "This connection publishes text-only drafts and planned posts. Use the native workflow for media.");
  if (record.data.publication[platform]?.publishedAt || record.data.publication[platform]?.url || (record.data.delivery?.[platform] && record.data.delivery[platform]?.state !== "failed")) throw new HubError(409, "DELIVERY_EXISTS", "A delivery already exists for this channel. Review its result on the social network before taking another action.");
  const caption = captionFor(record.data);
  if (!caption || caption.length > 15000) throw new HubError(400, "INVALID_CAPTION", "Add a caption within the supported length before publishing.");
  const allowed = await workspaceRpc<boolean>("hub_reserve_rate_limit", { p_key_hash: createHash("sha256").update(`marketing:publish:${context.user.id}`).digest("hex"), p_window_seconds: 60, p_limit: 10 });
  if (!allowed) throw new HubError(429, "RATE_LIMITED", "Please wait a minute before another publishing request.");
  if (!(await verifySocialIdentity(connection))) throw new HubError(503, "ACCOUNT_VERIFICATION", `The configured ${PLATFORM_NAMES[platform]} account could not be verified. Review the server connection and token permissions.`);
  const attemptId = randomUUID();
  // The version-checked database claim happens before the only outbound write. Concurrent requests cannot both claim this version.
  const claimed = await saveDelivery(context, record, { ...record.data, delivery: { ...record.data.delivery, [platform]: { state: "publishing", attemptId, startedAt: new Date().toISOString(), caption } } });
  const result = await sendTextPost(connection, caption);
  let saved: PostRecord;
  try { saved = await finishDelivery(context, claimed, platform, attemptId, result); }
  catch { throw new HubError(502, "DELIVERY_UNCERTAIN", "The social request finished, but its result could not be saved. Check the social account. This attempt will not be sent again automatically."); }
  if (result.state !== "published") throw new HubError(502, result.state === "failed" ? "PUBLISH_REJECTED" : "DELIVERY_UNCERTAIN", result.message || "Review the social account before publishing again.");
  return { state: result.state, record: saved };
}
