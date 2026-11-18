import type { ContentStatus, MarketingContent } from "./marketing-types";

export const CONTENT_STATUSES: readonly ContentStatus[] = ["draft", "in_progress", "in_review", "approved", "published", "archived"];
export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "In draft", in_progress: "In progress", in_review: "Waiting on review",
  approved: "Approved", published: "Published", archived: "Archived",
};
export function emptyContent(isTemplate = false): MarketingContent {
  return { kind: "content", isTemplate, contentType: "video", platforms: ["tiktok"], brief: "", script: "", caption: "", hashtags: "", notes: "", campaign: "", media: [], thumbnail: null, sourceTemplateId: null, approval: null, linkedPostId: null };
}
