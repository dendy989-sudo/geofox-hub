import type { WorkspaceAttachment, WorkspaceModule } from "./types";

export class WorkspaceInputError extends Error {
  status = 400;
  code = "INVALID_INPUT";
  constructor(message: string) { super(message); this.name = "HubError"; }
}
const invalid = (message: string): never => { throw new WorkspaceInputError(message); };
export const uploadMimeExtensions = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf",
} as const;
export const uploadMaximumBytes = 50 * 1024 * 1024;
export function object(value: unknown, field = "data"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`Please provide valid ${field}.`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, limit: number, field: string, required = false): string {
  if (value === undefined || value === null) { if (required) return invalid(`${field} is required.`); return ""; }
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return invalid(`Please check ${field} (maximum ${limit} characters).`);
  const result = value.trim();
  if (required && !result) return invalid(`${field} is required.`);
  return result;
}
export function choice<T extends string>(value: unknown, values: readonly T[], field: string, fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) return invalid(`Please choose a valid ${field}.`);
  return value as T;
}
export function integer(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return invalid(`Please check ${field}.`);
  return value;
}
export function uuid(value: unknown, field = "record ID"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return invalid(`Please check ${field}.`);
  return value;
}
export function appScope(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value === "all" || value === "company" || !/^[a-z][a-z0-9-]{1,47}$/.test(value)) return invalid("Choose an app or the company scope.");
  return value;
}
export function dateOnly(value: unknown, field: string, required = false): string | null {
  if (value === null || value === undefined || value === "") { if (required) return invalid(`${field} is required.`); return null; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2200-12-31") return invalid(`Please choose a valid ${field}.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid(`Please choose a real calendar date for ${field}.`);
  return value;
}
export function timestamp(value: unknown, field: string, required = false): string | null {
  if (value === null || value === undefined || value === "") { if (required) return invalid(`${field} is required.`); return null; }
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return invalid(`Please choose a valid ${field} with a timezone.`);
  dateOnly(value.slice(0, 10), field, true);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (value[16] === ":" && Number(value.slice(17, 19)) > 59)) return invalid(`Please check ${field}.`);
  return parsed.toISOString();
}
export function safeUrl(value: unknown, field: string): string {
  const result = text(value, 2000, field);
  if (!result) return "";
  try { const url = new URL(result); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
  catch { return invalid(`${field} must be a complete HTTPS link.`); }
  return result;
}
function array(value: unknown, maximum: number, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) return invalid(`Please keep ${field} to ${maximum} items or fewer.`);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") return invalid(`Please check ${field}.`);
  return value;
}
export function attachment(value: unknown): WorkspaceAttachment & { width?: number; height?: number; duration?: number } {
  const item = object(value, "attachment");
  const path = text(item.path, 256, "attachment path", true);
  if (!/^(tasks|marketing|legal|accounting)\/[a-z][a-z0-9-]*\/[0-9a-f-]+\.(jpg|png|webp|gif|mp4|mov|pdf)$/.test(path)) return invalid("Please choose an uploaded file.");
  const filename = text(item.filename, 200, "filename", true);
  const contentType = choice(item.contentType, Object.keys(uploadMimeExtensions), "file format");
  const result: WorkspaceAttachment & { width?: number; height?: number; duration?: number } = { path, filename, contentType, size: integer(item.size, 1, uploadMaximumBytes, "file size") };
  for (const key of ["width", "height"] as const) if (item[key] !== undefined) result[key] = integer(item[key], 1, 100000, `media ${key}`);
  if (item.duration !== undefined) { if (typeof item.duration !== "number" || !Number.isFinite(item.duration) || item.duration < 0 || item.duration > 86400) return invalid("Please check video duration."); result.duration = item.duration; }
  return result;
}
const platforms = ["instagram", "facebook", "tiktok", "x"] as const;
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a).sort(); const right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, i) => key === right[i] && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
export function validateWorkspaceData(module: WorkspaceModule, status: string, value: unknown, previous?: Record<string, unknown>): Record<string, unknown> {
  const data = object(value);
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 95000) return invalid("This record is too large. Shorten the notes or reduce attachments.");
  if (module === "tasks") {
    choice(status, ["todo", "in_progress", "done", "archived"], "task status");
    const recurrence = choice(data.recurrence, ["none", "daily", "weekly", "monthly"], "repeat frequency", "none");
    const dueDate = dateOnly(data.dueDate, "due date", recurrence !== "none");
    const checklist = array(data.checklist, 100, "checklist steps").map(value => { const step = object(value, "checklist step"); return { id: text(step.id, 80, "step ID", true), text: text(step.text, 500, "step text", true), done: boolean(step.done, "step status") }; });
    if (new Set(checklist.map(step => step.id)).size !== checklist.length) return invalid("Checklist steps must have unique IDs.");
    return { description: text(data.description, 10000, "description"), priority: choice(data.priority, ["low", "normal", "high", "urgent"], "priority", "normal"), dueDate, recurrence, checklist, assigneeId: data.assigneeId == null || data.assigneeId === "" ? null : uuid(data.assigneeId, "assignee") };
  }
  if (module === "accounting") {
    choice(status, ["paid", "pending", "void"], "transaction status");
    return { type: choice(data.type, ["income", "expense", "owner_contribution", "owner_draw", "transfer"], "transaction type"), amountCents: integer(data.amountCents, 1, 99999999999, "amount"), currency: choice(data.currency, ["USD"], "currency", "USD"), occurredOn: dateOnly(data.occurredOn, "transaction date", true), category: text(data.category, 120, "category"), payee: text(data.payee, 200, "payee"), reference: text(data.reference, 200, "reference"), notes: text(data.notes, 10000, "notes"), attachments: array(data.attachments, 20, "attachments").map(attachment) };
  }
  if (module === "legal") {
    choice(status, ["open", "in_progress", "completed", "not_applicable", "archived"], "compliance status");
    return { dueDate: dateOnly(data.dueDate, "due date"), reviewDate: dateOnly(data.reviewDate, "review date"), amountCents: data.amountCents == null ? null : integer(data.amountCents, 0, 99999999999, "amount"), currency: choice(data.currency, ["USD"], "currency", "USD"), payee: text(data.payee, 200, "payee"), jurisdiction: text(data.jurisdiction, 200, "jurisdiction"), category: text(data.category, 120, "category"), recurrence: choice(data.recurrence, ["none", "monthly", "quarterly", "annual", "continuous"], "repeat frequency", "none"), sourceUrl: safeUrl(data.sourceUrl, "source link"), notes: text(data.notes, 10000, "notes"), condition: text(data.condition, 2000, "applicability"), starterKey: text(data.starterKey, 100, "template reference"), sourceCheckedAt: data.sourceCheckedAt ? dateOnly(data.sourceCheckedAt, "source review date") : undefined, completedAt: timestamp(data.completedAt, "completion time"), attachments: array(data.attachments, 20, "attachments").map(attachment) };
  }
  const kind = choice(data.kind, ["post", "account", "inbox"], "marketing record type");
  if (previous?.kind && kind !== previous.kind) return invalid("A marketing record's type cannot be changed.");
  if (kind === "account") {
    choice(status, ["active", "archived"], "account status");
    return { kind, platform: choice(data.platform, platforms, "social platform"), handle: text(data.handle, 200, "account handle", true), profileUrl: safeUrl(data.profileUrl, "profile link"), notes: text(data.notes, 10000, "notes") };
  }
  if (kind === "inbox") {
    choice(status, ["open", "replied", "archived", "resolved"], "conversation status");
    return { kind, platform: choice(data.platform, platforms, "social platform"), messageType: choice(data.messageType, ["comment", "message"], "message type"), author: text(data.author, 200, "author", true), body: text(data.body, 10000, "message", true), sourceUrl: safeUrl(data.sourceUrl, "message link"), receivedAt: timestamp(data.receivedAt, "received time", true), draftReply: text(data.draftReply, 10000, "reply draft"), repliedAt: timestamp(data.repliedAt, "reply time"), source: choice(data.source, ["manual"], "message source", "manual") };
  }
  choice(status, ["draft", "scheduled", "published", "cancelled"], "post status");
  const selected = array(data.platforms, 4, "social platforms").map(p => choice(p, platforms, "social platform"));
  if (!selected.length || new Set(selected).size !== selected.length) return invalid("Choose at least one platform without duplicates.");
  const timeZone = text(data.timeZone, 100, "timezone", true);
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); } catch { return invalid("Choose a valid timezone."); }
  const publication: Record<string, Record<string, unknown>> = {};
  const previousPublication = previous?.publication && typeof previous.publication === "object" ? previous.publication as Record<string, Record<string, unknown>> : {};
  for (const [platform, raw] of Object.entries(object(data.publication ?? {}, "publication details"))) {
    choice(platform, platforms, "social platform"); const item = object(raw, "publication details");
    const result: Record<string, unknown> = { url: safeUrl(item.url, "post link"), publishedAt: timestamp(item.publishedAt, "published time") };
    if (item.metrics !== undefined) {
      const metrics = object(item.metrics, "post statistics");
      if (metrics.source === "provider") {
        if (!same(metrics, previousPublication[platform]?.metrics)) return invalid("Provider statistics can only be updated through a connected social account.");
        result.metrics = previousPublication[platform].metrics;
      } else {
        if ((previousPublication[platform]?.metrics as Record<string, unknown> | undefined)?.source === "provider") return invalid("Connected account statistics cannot be overwritten manually.");
        const parsed: Record<string, unknown> = { source: choice(metrics.source, ["manual"], "statistics source", "manual"), capturedAt: timestamp(metrics.capturedAt, "statistics time", true), note: text(metrics.note, 2000, "statistics note") };
        for (const key of ["views", "reach", "likes", "comments", "shares", "saves", "clicks"]) if (metrics[key] !== undefined) parsed[key] = integer(metrics[key], 0, Number.MAX_SAFE_INTEGER, key);
        result.metrics = parsed;
      }
    } else if ((previousPublication[platform]?.metrics as Record<string, unknown> | undefined)?.source === "provider") result.metrics = previousPublication[platform].metrics;
    publication[platform] = result;
  }
  // Delivery attempts and provider IDs are written exclusively by the provider worker.
  if (data.delivery !== undefined && !same(data.delivery, previous?.delivery)) return invalid("Social delivery details cannot be edited manually.");
  const delivery = previous?.delivery as Record<string, Record<string, unknown>> | undefined;
  for (const [platform, item] of Object.entries(previousPublication)) {
    if ((item.metrics as Record<string, unknown> | undefined)?.source === "provider" && !publication[platform]) publication[platform] = item;
    if (delivery?.[platform]?.state === "published") {
      // The provider owns the post identity and time. Manual statistics remain
      // editable until a connected provider supplies its own statistics.
      publication[platform] = publication[platform] ? { ...publication[platform], url: item.url, publishedAt: item.publishedAt } : item;
    }
  }
  return { kind, platforms: selected, caption: text(data.caption, 10000, "caption"), hashtags: text(data.hashtags, 2500, "hashtags"), mentions: text(data.mentions, 2500, "mentions"), media: array(data.media, 20, "media files").map(attachment), thumbnail: data.thumbnail == null ? null : attachment(data.thumbnail), scheduledAt: timestamp(data.scheduledAt, "scheduled time", status === "scheduled"), timeZone, publishedAt: timestamp(data.publishedAt, "published time"), contentType: choice(data.contentType, ["photo", "video", "carousel", "text"], "content type"), campaign: text(data.campaign, 200, "campaign"), notes: text(data.notes, 10000, "notes"), publication, flags: array(data.flags, 100, "post flags").map(value => { const flag = object(value, "post flag"); return { platform: choice(flag.platform, platforms, "social platform"), reason: text(flag.reason, 2000, "flag reason", true), sourceUrl: safeUrl(flag.sourceUrl, "flag source"), recordedAt: timestamp(flag.recordedAt, "flag time", true), resolved: boolean(flag.resolved, "flag status") }; }), ...(delivery ? { delivery } : {}) };
}
export function recordAttachments(data: Record<string, unknown>): WorkspaceAttachment[] {
  return [...(Array.isArray(data.attachments) ? data.attachments : []), ...(Array.isArray(data.media) ? data.media : []), ...(data.thumbnail ? [data.thumbnail] : [])] as WorkspaceAttachment[];
}
