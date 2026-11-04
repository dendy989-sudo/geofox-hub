import type { WorkspaceAttachment, WorkspaceRecord } from "./types";

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "x"] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];
export type MarketingStatus = "draft" | "scheduled" | "published" | "cancelled";
export interface MarketingMedia extends WorkspaceAttachment { width?: number; height?: number; duration?: number; }
export interface SocialMetrics {
  source: "manual" | "provider";
  capturedAt: string;
  views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number; clicks?: number;
  note?: string;
}
export interface MarketingPost {
  kind: "post";
  platforms: SocialPlatform[];
  caption: string;
  hashtags: string;
  mentions: string;
  media: MarketingMedia[];
  thumbnail: MarketingMedia | null;
  scheduledAt: string | null;
  timeZone: string;
  publishedAt: string | null;
  contentType: "photo" | "video" | "carousel" | "text";
  campaign: string;
  notes: string;
  publication: Partial<Record<SocialPlatform, { url: string; publishedAt: string | null; metrics?: SocialMetrics }>>;
  flags: { platform: SocialPlatform; reason: string; sourceUrl: string; recordedAt: string; resolved: boolean }[];
  delivery?: Partial<Record<SocialPlatform, { state: "publishing" | "published" | "failed" | "uncertain"; attemptId: string; startedAt: string; providerId?: string; caption?: string; error?: string }>>;
}
export interface MarketingAccount {
  kind: "account";
  platform: SocialPlatform;
  handle: string;
  profileUrl: string;
  notes: string;
}
export interface MarketingConversation {
  kind: "inbox";
  platform: SocialPlatform;
  messageType: "comment" | "message";
  author: string;
  body: string;
  sourceUrl: string;
  receivedAt: string;
  draftReply: string;
  repliedAt: string | null;
  source: "manual";
}
export type MarketingData = MarketingPost | MarketingAccount | MarketingConversation;
export type MarketingRecord = WorkspaceRecord<MarketingData>;
export type PostRecord = WorkspaceRecord<MarketingPost>;
export interface ProviderCapability {
  appSlug: string | null;
  platform: SocialPlatform;
  available: boolean;
  mode: "manual" | "direct";
  label: string;
  detail: string;
  accountId?: string;
  handle?: string;
  publishTypes: MarketingPost["contentType"][];
  analytics: boolean;
  comments: boolean;
  messages: boolean;
}
export interface MarketingCapabilities { providers: ProviderCapability[]; automaticScheduling: boolean; }
