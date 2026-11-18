import "server-only";

import { createHash } from "node:crypto";
import { HubError, type HubContext } from "@/lib/hub/server";
import { assertWorkspaceAccess, getWorkspaceRecord, toWorkspaceRecord, workspaceRpc } from "./server";
import { integer, uuid } from "./validation";
import type { ContentRecord, MarketingContent, MarketingPost, PostRecord } from "./marketing-types";

/** The RPC locks the source and creates/refreshes its single linked draft atomically. */
export async function createMarketingContentPost(context: HubContext, id: string, version: unknown): Promise<{ content: ContentRecord; post: PostRecord }> {
  const source = await getWorkspaceRecord(context, uuid(id), "write");
  if (source.module !== "marketing" || source.data.kind !== "content") throw new HubError(400, "INVALID_CONTENT", "Choose a saved content item.");
  assertWorkspaceAccess(context, "marketing", "write", source.appSlug);
  const checkedVersion = integer(version, 1, 2147483647, "record version");
  const allowed = await workspaceRpc<boolean>("hub_reserve_rate_limit", { p_key_hash: createHash("sha256").update(`marketing:content-post:${context.user.id}`).digest("hex"), p_window_seconds: 60, p_limit: 30 });
  if (!allowed) throw new HubError(429, "RATE_LIMITED", "Please wait a moment before creating another planner draft.");
  const result = await workspaceRpc<{ content: Record<string, unknown>; post: Record<string, unknown> }>("hub_marketing_content_post", { p_actor: context.user.id, p_id: source.id, p_version: checkedVersion });
  return { content: toWorkspaceRecord<MarketingContent>(result.content), post: toWorkspaceRecord<MarketingPost>(result.post) };
}
