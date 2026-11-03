import "server-only";
import { createClient } from "@supabase/supabase-js";
import { HubError, assertCapability, type HubContext } from "@/lib/hub/server";
import type { ActivityItem, Capability, ListResult, ModerationItem } from "@/lib/hub/types";

export interface NovaOverview {
  appId: "novanook"; capturedAt: string; periodStart: string; periodEnd: string;
  users: { total: number; free: number; pro: number; adultFree: number; adultPro: number; teenFree: number; teenPro: number; unknownAgeFree: number; unknownAgePro: number; newInPeriod: number; activeInPeriod: number };
  usage: { libraryBooks: number; searchReservationsAllTime: number; searchReservationsMonth: number; isbnReservationsToday: number };
  operations: { openReports: number; reviewingReports: number; childSafetyReports: number; pendingAlerts: number; failedAlerts: number; pendingDeletions: number; blockedUntil: string | null };
  dailySignups: { date: string; count: number }[];
}
export interface NovaCustomer {
  found: boolean;
  customer?: { id: string; email: string | null; displayName: string | null; username: string | null; createdAt: string; lastSignInAt: string | null; emailVerified: boolean; ageBand: "adult" | "teen" | "unknown"; plan: "free" | "pro"; proExpiresAt: string | null; store: string | null; willRenew: boolean | null; billingCheckedAt: string | null; testPreview: string | null; socialRestricted: boolean };
  usage?: { libraryBooks: number; searchReservationsAllTime: number; searchReservationsMonth: number; readingSessions: number | null; readingMinutes: number | null };
  history?: Omit<ActivityItem, "appSlug">[];
  paymentsReason?: string;
  notes?: string[];
  deletion?: { status: string; requestedAt: string } | null;
  moderation?: { reportCount: number; openReports: number; activeHolds: number };
}
interface NovaQueue { reports: { id: string; reportedUserId: string | null; reporterId: string | null; targetType: string; category: string; reason: string; context: unknown; status: string; createdAt: string; version: string; urgent: boolean; hasReportedImage: boolean }[]; total: number; pendingReports: number; undeliveredAlerts: number; }

// NovaNook records a bounded JSON object, not a string, for report context.
// Return only its known text fields. The UI must render this as escaped text.
function reportContext(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 12_000) || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  const lines: string[] = [];
  const add = (label: string, text: unknown, maximum: number) => {
    if (typeof text === "string" && text.trim()) lines.push(`${label}: ${text.trim().slice(0, maximum)}`);
  };
  const object = (item: unknown): Record<string, unknown> | null => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
  add("Reader", context.name, 100);
  add("Handle", context.handle, 100);
  add("Profile bio", context.bio, 1000);
  const post = object(context.post);
  if (post) add("Reported post", post.body, 2000);
  const shelf = object(context.shelf);
  if (shelf) {
    add("Reported shelf", shelf.title, 200);
    add("Shelf description", shelf.description, 2000);
    if (Array.isArray(shelf.items)) shelf.items.slice(0, 20).forEach((item, index) => {
      const entry = object(item);
      if (!entry) return;
      add(`Shelf item ${index + 1}`, entry.title, 200);
      add(`Item ${index + 1} note`, entry.note, 500);
      add(`Item ${index + 1} character`, entry.character, 100);
    });
  }
  const text = lines.join("\n\n");
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[Additional context available in NovaNook moderation.]` : text || null;
}

export function novaConfigured(): boolean { return Boolean(process.env.NOVANOOK_SUPABASE_URL && (process.env.NOVANOOK_SUPABASE_SECRET_KEY || process.env.NOVANOOK_SUPABASE_SERVICE_ROLE_KEY)); }

async function rpc<T>(context: HubContext, capability: Capability, name: string, args: Record<string, unknown>): Promise<T> {
  assertCapability(context, capability, "novanook");
  const url = process.env.NOVANOOK_SUPABASE_URL;
  const secret = process.env.NOVANOOK_SUPABASE_SECRET_KEY || process.env.NOVANOOK_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new HubError(503, "APP_NOT_CONNECTED", "NovaNook’s database connection is awaiting configuration.");
  try { if (new URL(url).protocol !== "https:") throw new Error(); }
  catch { throw new HubError(503, "APP_NOT_CONNECTED", "NovaNook’s database URL needs to be checked in hosting settings."); }
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  if (error) {
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code)) throw new HubError(503, "APP_BRIDGE_NOT_INSTALLED", "Install the NovaNook bridge migration to make this information available.");
    if (error.code === "40001") throw new HubError(409, "REPORT_CHANGED", "This report changed since you opened it. Refresh the queue and review the latest information.");
    if (error.code === "42501") {
      const text = `${error.message || ""}`;
      if (/moderator_link_required/.test(text)) throw new HubError(403, "MODERATOR_LINK_REQUIRED", "Link this Geofox staff account to your existing eligible NovaNook moderator account before making decisions.");
      if (/self|own.report|different moderator|report about your account/i.test(text)) throw new HubError(403, "SELF_REVIEW_BLOCKED", "A separate eligible moderator must review this report.");
      if (capability === "moderation:write") throw new HubError(403, "MODERATION_NOT_PERMITTED", "Your linked NovaNook moderator account must be active and eligible for this action.");
      throw new HubError(503, "APP_CREDENTIALS_INVALID", "NovaNook refused the server connection. Check its server credentials and bridge permissions in hosting settings.");
    }
    if (error.code === "P0002") throw new HubError(404, "REPORT_NOT_FOUND", "This report is no longer available. Refresh the moderation queue.");
    if (["22023", "22P02"].includes(error.code)) throw new HubError(400, "INVALID_ACTION", "Check the report, decision and required reason.");
    throw new HubError(503, "APP_SOURCE_UNAVAILABLE", "NovaNook’s data source did not respond successfully. Check Operations and try again.");
  }
  if (!data || typeof data !== "object" || data.appId !== "novanook") throw new HubError(503, "APP_RESPONSE_INVALID", "The NovaNook bridge returned an unexpected response. Check its migration version.");
  return data as T;
}

export function novaOverview(context: HubContext) { return rpc<NovaOverview>(context, "overview:read", "booknook_geofox_overview", { p_days: 30 }); }
export function novaCustomer(context: HubContext, id: string) { return rpc<NovaCustomer>(context, "customers:read", "booknook_geofox_customer", { p_user_id: id }); }

export async function novaModeration(context: HubContext, status = "unresolved"): Promise<ListResult<ModerationItem>> {
  if (!["open", "reviewing", "resolved", "unresolved", "all"].includes(status)) throw new HubError(400, "INVALID_STATUS", "Choose a valid moderation report status.");
  const data = await rpc<NovaQueue>(context, "moderation:read", "booknook_geofox_moderation", { p_status: status, p_limit: 100 });
  return {
    items: data.reports.map(item => ({ id: item.id, appSlug: "novanook", type: item.category || item.targetType, status: item.status, reason: item.reason, reportedAt: item.createdAt, reporterId: item.reporterId, subjectUserId: item.reportedUserId, summary: `${item.urgent ? "Priority safety review · " : ""}${item.targetType} report${item.hasReportedImage ? " · reported image available in NovaNook’s moderator page" : ""}`, content: reportContext(item.context), version: item.version })),
    total: data.total,
    notes: [`Up to 100 ${status === "all" ? "matching" : status} reports are shown, with unresolved child-safety reports prioritized. Reports are allegations requiring review. Image evidence stays in NovaNook’s existing moderator tools.`, ...(data.undeliveredAlerts ? [`${data.undeliveredAlerts} safety notification(s) have not yet been delivered.`] : [])],
  };
}

const actionMap: Record<string, string> = { review: "review", dismiss: "resolve", remove_content: "hide", restore_content: "restore", suspend_user: "restrict", restore_user: "unrestrict" };
export async function moderateNova(context: HubContext, id: string, action: string, reason: string, version: string) {
  if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807") || !Object.hasOwn(actionMap, action) || typeof reason !== "string" || !reason.trim() || reason.length > 1000 || !/^[a-f0-9]{32}$/.test(version)) throw new HubError(400, "INVALID_ACTION", "Choose a report and action, and provide a short review reason.");
  return rpc<{ ok: true; reportId: string; status: string; action: string; auditId: string }>(context, "moderation:write", "booknook_geofox_moderate", { p_report_id: id, p_action: actionMap[action], p_note: reason.trim(), p_actor_id: context.user.id, p_expected_version: version });
}
