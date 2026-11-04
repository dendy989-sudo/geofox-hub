import type { MarketingPost, PostRecord, SocialMetrics, SocialPlatform } from "./marketing-types";

export const PLATFORM_NAMES: Record<SocialPlatform, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", x: "X" };
export const PLATFORM_URLS: Record<SocialPlatform, string> = { instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", tiktok: "https://www.tiktok.com/", x: "https://x.com/compose/post" };
export const PLATFORM_GUIDANCE: Record<SocialPlatform, string> = {
  instagram: "Portrait feed: 1080 × 1350. Reels: 1080 × 1920 (9:16). Keep essential text away from edges.",
  facebook: "Feed: 1080 × 1350 or square. Reels: 1080 × 1920 (9:16). Check the destination’s native preview.",
  tiktok: "Recommended vertical video: 1080 × 1920 (9:16). Select the cover and complete publishing in TikTok.",
  x: "Landscape image: 1600 × 900 or square. Standard posts allow 280 weighted characters; links and emoji may count differently.",
};
export function emptyPost(): MarketingPost {
  return { kind: "post", platforms: ["instagram"], caption: "", hashtags: "", mentions: "", media: [], thumbnail: null, scheduledAt: null, timeZone: "America/Chicago", publishedAt: null, contentType: "photo", campaign: "", notes: "", publication: {}, flags: [] };
}
export function captionFor(post: MarketingPost) { return [post.caption.trim(), post.mentions.trim(), normalizeHashtags(post.hashtags)].filter(Boolean).join("\n\n"); }
export function normalizeHashtags(value: string) {
  return [...new Set(value.split(/[\s,]+/).map(item => item.replace(/^#+/, "").trim()).filter(Boolean))].map(tag => `#${tag}`).join(" ");
}
export function safeSocialUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
export function validatePost(title: string, status: string, post: MarketingPost, now = new Date()): string[] {
  const errors: string[] = [];
  if (!title.trim()) errors.push("Give this post an internal title.");
  if (!post.platforms.length) errors.push("Choose at least one social network.");
  if (status === "scheduled" && (!post.scheduledAt || Number.isNaN(Date.parse(post.scheduledAt)))) errors.push("Choose a valid publishing date and time.");
  if (status === "scheduled" && post.scheduledAt && Date.parse(post.scheduledAt) <= now.getTime()) errors.push("Schedule this post in the future, or save it as a draft.");
  if (status !== "draft" && !post.caption.trim() && !post.media.length) errors.push("Add a caption or media before scheduling or recording a published post.");
  if (post.media.length > 10) errors.push("Use no more than 10 media files in one shared post.");
  for (const platform of post.platforms) {
    const publication = post.publication[platform];
    if (publication?.url && !safeSocialUrl(publication.url)) errors.push(`Use a valid HTTPS link for the ${PLATFORM_NAMES[platform]} post.`);
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: post.timeZone }).format(now); } catch { errors.push("Choose a valid IANA timezone, such as America/Chicago."); }
  return [...new Set(errors)];
}
export function mediaWarnings(post: MarketingPost): string[] {
  const warnings: string[] = [];
  if (post.platforms.some(p => p === "instagram" || p === "tiktok") && post.contentType === "text") warnings.push("Instagram and TikTok need a photo or video for a feed post.");
  if (!post.media.length && post.contentType !== "text") warnings.push("Attach the final media before publishing. You can still plan and save this post.");
  if (post.contentType === "video" && !post.media.some(m => m.contentType.startsWith("video/"))) warnings.push("Add a video file for this video post.");
  if (post.platforms.includes("x") && post.media.length > 4) warnings.push("X supports up to four images in a post; prepare a separate version with fewer files.");
  for (const media of post.media) {
    if (media.width && media.height && post.contentType === "video" && post.platforms.some(p => p === "tiktok" || p === "instagram") && Math.abs(media.width / media.height - 9 / 16) > .04) warnings.push(`${media.filename}: ${media.width} × ${media.height} is not 9:16. Check the phone preview and crop in your editor if needed.`);
  }
  return [...new Set(warnings)];
}
export function localDateKey(value: string | Date, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); } catch { return date.toISOString().slice(0, 10); }
}
export function dateTimeInput(iso: string | null, timeZone: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
/** Translate wall-clock input in an explicit timezone; reject DST gaps instead of silently shifting. */
export function localInputToIso(value: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const guess = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(guess)) return null;
  try {
    let stamp = guess;
    for (let i = 0; i < 4; i++) {
      const rendered = dateTimeInput(new Date(stamp).toISOString(), timeZone);
      stamp += guess - Date.parse(`${rendered}:00Z`);
    }
    const iso = new Date(stamp).toISOString();
    return dateTimeInput(iso, timeZone) === value ? iso : null;
  } catch { return null; }
}
export function metricNumber(value: string): number | undefined { if (!value.trim()) return undefined; const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : undefined; }
export function engagementCount(metrics: SocialMetrics): number { return (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0) + (metrics.saves ?? 0); }
export interface AnalyticsSample { post: PostRecord; platform: SocialPlatform; metrics: SocialMetrics; publishedAt: string; engagement: number; }
export function analyticsSamples(posts: PostRecord[], platform: SocialPlatform | "all"): AnalyticsSample[] {
  return posts.flatMap(post => post.data.platforms.flatMap(network => {
    const item = post.data.publication[network];
    if ((platform !== "all" && network !== platform) || !item?.metrics || !item.publishedAt || !Number.isFinite(Date.parse(item.publishedAt))) return [];
    return [{ post, platform: network, metrics: item.metrics, publishedAt: item.publishedAt, engagement: engagementCount(item.metrics) }];
  }));
}
export function rankInsights(samples: AnalyticsSample[], timeZone: string) {
  const times = new Map<string, { total: number; count: number }>();
  const formats = new Map<string, { total: number; count: number }>();
  const hashtags = new Map<string, { total: number; count: number }>();
  const add = (map: Map<string, { total: number; count: number }>, key: string, value: number) => { const current = map.get(key) ?? { total: 0, count: 0 }; map.set(key, { total: current.total + value, count: current.count + 1 }); };
  for (const sample of samples) {
    // A missing count is not a zero. Rank only snapshots with all four recorded engagement counts.
    if ([sample.metrics.likes, sample.metrics.comments, sample.metrics.shares, sample.metrics.saves].some(value => value === undefined)) continue;
    const time = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hour12: true }).format(new Date(sample.publishedAt));
    add(times, time, sample.engagement);
    add(formats, sample.post.data.contentType, sample.engagement);
    for (const tag of normalizeHashtags(sample.post.data.hashtags).split(" ").filter(Boolean)) add(hashtags, tag.toLowerCase(), sample.engagement);
  }
  const rank = (map: Map<string, { total: number; count: number }>) => [...map.entries()].map(([name, item]) => ({ name, count: item.count, average: item.total / item.count })).sort((a, b) => b.average - a.average || b.count - a.count).slice(0, 5);
  return { times: rank(times), formats: rank(formats), hashtags: rank(hashtags) };
}
