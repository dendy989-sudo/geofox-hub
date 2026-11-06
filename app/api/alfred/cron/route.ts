import { createHash, timingSafeEqual } from "node:crypto";
import { apiError, json } from "@/lib/security/http";
import { capabilitiesForRole, databaseError, getHubService, HubError, type HubContext } from "@/lib/hub/server";
import { workspaceAccessFor } from "@/lib/workspace/access";
import { alfredRpc, runAlfred } from "@/lib/alfred/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
    const actual = request.headers.get("authorization") ?? "";
    if (!expected || actual.length !== expected.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new HubError(401, "AUTH_REQUIRED", "Scheduled access is not authorized.");
    if (process.env.VERCEL_ENV !== "production") return json({ skipped: true, reason: "Daily briefings only run in production." });
    const db = getHubService();
    const { data: settings, error } = await db.from("hub_alfred_settings").select("enabled,scheduled_enabled,scheduled_by,consent_at").eq("singleton", true).single();
    if (error) databaseError(error);
    if (!settings.enabled || !settings.scheduled_enabled || !settings.scheduled_by || !settings.consent_at) return json({ skipped: true, reason: "Daily briefing is paused or has not been authorized by the owner." });
    // The owner explicitly delegates this read-only daily workflow in Controls.
    // Revalidate current owner status, verified email and bans every time.
    await alfredRpc("hub_alfred_owner", { p_actor: settings.scheduled_by });
    const { data: apps, error: appError } = await db.from("hub_apps").select("slug,name,color,website").eq("active", true).order("name");
    if (appError) databaseError(appError);
    const context: HubContext = { user: { id: settings.scheduled_by, email: "" }, staff: { role: "owner", displayName: "Owner-authorized daily briefing" }, apps: (apps ?? []).map(a => ({ ...a, configured: true })), capabilities: capabilitiesForRole("owner"), workspaceAccess: workspaceAccessFor("owner"), setupIssues: [] };
    const hash = createHash("sha256").update(`alfred-daily-v1:${settings.scheduled_by}:${new Date().toISOString().slice(0, 10)}`).digest("hex");
    const requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const run = await runAlfred(context, { requestId, scope: "all", department: "briefing", question: "Prepare today's private company briefing from the available records. Identify urgent support and error patterns, priorities and missing integrations. Propose only useful internal tasks. Never send replies, schedule publication, spend money, or claim to have changed anything.", ticketId: null });
    return json({ runId: run.id, state: run.state });
  } catch (error) { return apiError(error); }
}

