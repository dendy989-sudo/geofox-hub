import { getHubContext, getHubService, assertCapability, allowedAppSlugs, HubError } from "@/lib/hub/server";
import { addTicketMessage, completeReview, getSettings, getTicket, listErrors, listStaff, listTickets, recordAudit, saveApp, saveStaff, setTicketDelivery, updateError, updateTicket } from "@/lib/hub/data";
import { assignableRoles } from "@/lib/hub/validation";
import type { ErrorState, StaffRole, TicketPriority, TicketStatus } from "@/lib/hub/types";
import { apiError, json, readJson, RequestError, sameOrigin, textValue, validUuid } from "@/lib/security/http";
import { integrationInfo, loadCustomer, loadOperations, loadOverview } from "@/lib/integrations/reporting";
import { moderateNova, novaModeration } from "@/lib/integrations/novanook";
import { replyEmailConfigured, sendCustomerReply } from "@/lib/integrations/email";
import { buildRepairBrief } from "@/lib/diagnostics/repair";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type RouteContext = { params: Promise<{ path: string[] }> };

function inputScope(value: unknown) { return textValue(value, 48) || "all"; }
function queryNumber(params: URLSearchParams, name: string, fallback: number) { const value = Number(params.get(name)); return params.has(name) && Number.isInteger(value) ? value : fallback; }
function oneApp(value: unknown) { const app = inputScope(value); if (app === "all") throw new RequestError(400, "APP_REQUIRED", "Select a specific app for this action."); return app; }

export async function GET(request: Request, route: RouteContext) {
  try {
    const context = await getHubContext();
    const path = (await route.params).path;
    const name = path.join("/");
    const query = new URL(request.url).searchParams;
    const app = inputScope(query.get("app"));
    if (name === "bootstrap") return json(context);
    if (name === "overview") return json(await loadOverview(context, app));
    if (name === "customers") {
      const id = query.get("id");
      if (!validUuid(id)) throw new RequestError(400, "CUSTOMER_ID_REQUIRED", "Enter the customer’s full account UUID from NovaNook.");
      return json(await loadCustomer(context, oneApp(app), id));
    }
    if (name === "tickets") return json(await listTickets(context, app, { status: query.get("status") || undefined, query: query.get("query") || undefined, customerId: query.get("customerId") || undefined, limit: queryNumber(query, "limit", 25), offset: queryNumber(query, "offset", 0) }));
    if (path[0] === "tickets" && path.length === 2) return json(await getTicket(context, path[1]));
    if (name === "errors") return json(await listErrors(context, app, { status: query.get("status") || undefined, customerId: query.get("customerId") || undefined, limit: queryNumber(query, "limit", 25), offset: queryNumber(query, "offset", 0) }));
    if (name === "moderation") {
      assertCapability(context, "moderation:read");
      const scope = allowedAppSlugs(context, app);
      const result = scope.includes("novanook") ? await novaModeration(context, query.get("status") || "unresolved") : { items: [], total: 0, notes: [] as string[] };
      if (scope.some(slug => slug !== "novanook")) result.notes.push("Moderation adapters are not yet connected for every selected app. The queue includes connected sources only.");
      return json(result);
    }
    if (name === "operations") return json(await loadOperations(context, app));
    if (name === "settings") return json({ ...await getSettings(context), integrations: integrationInfo(context), setupIssues: context.setupIssues });
    throw new RequestError(404, "NOT_FOUND", "This staff endpoint does not exist.");
  } catch (error) { return apiError(error); }
}

async function mutate(request: Request, route: RouteContext) {
  try {
    sameOrigin(request);
    const context = await getHubContext();
    const path = (await route.params).path;
    const name = path.join("/");
    const input = await readJson(request);
    if (path[0] === "tickets" && path.length === 2 && request.method === "PATCH") {
      return json(await updateTicket(context, path[1], { ...(input.status !== undefined ? { status: input.status as TicketStatus } : {}), ...(input.priority !== undefined ? { priority: input.priority as TicketPriority } : {}) }));
    }
    if (path[0] === "tickets" && path.length === 3 && path[2] === "messages" && request.method === "POST") {
      if (typeof input.internal !== "boolean") throw new RequestError(400, "MESSAGE_TYPE_REQUIRED", "Choose an internal note or customer reply.");
      assertCapability(context, "tickets:write");
      const ticket = await getTicket(context, path[1]);
      if (!input.internal && !replyEmailConfigured()) throw new HubError(503, "EMAIL_NOT_CONFIGURED", "Customer email replies need a verified sender and monitored reply-to mailbox. You can save an internal note while email delivery is being connected.");
      const message = await addTicketMessage(context, ticket.id, { body: textValue(input.body, 12000, true), internal: input.internal, deliveryStatus: input.internal ? "not_requested" : "pending" });
      if (!input.internal) {
        const sent = await sendCustomerReply(ticket, message);
        await setTicketDelivery(context, ticket.id, message.id, sent ? "sent" : "failed");
        message.deliveryStatus = sent ? "sent" : "failed";
      }
      return json(message, 201);
    }
    if (path[0] === "errors" && path.length === 2) { await updateError(context, path[1], { status: input.status as ErrorState }); return json({ updated: true }); }
    if (name === "diagnostics") {
      assertCapability(context, "errors:read");
      const app = oneApp(input.app);
      const customerId = input.customerId === undefined ? undefined : textValue(input.customerId, 36, true);
      if (customerId && !validUuid(customerId)) throw new RequestError(400, "INVALID_CUSTOMER", "Check the customer account ID.");
      if (customerId) assertCapability(context, "customers:read", app);
      if (input.errorIds !== undefined && (!Array.isArray(input.errorIds) || input.errorIds.length > 30 || input.errorIds.some(id => !validUuid(id)))) throw new RequestError(400, "INVALID_ERRORS", "Choose up to 30 recorded errors.");
      const ids = input.errorIds as string[] | undefined;
      const errors = await listErrors(context, app, { customerId, ids, limit: 30 });
      const selected = errors.items;
      if (ids && selected.length !== new Set(ids.map(id => id.toLowerCase())).size) throw new RequestError(404, "ERRORS_UNAVAILABLE", "Some selected errors are no longer available in this app scope. Refresh the list and select them again.");
      const prompt = buildRepairBrief(context.apps.find(item => item.slug === app)?.name || app, selected);
      await recordAudit(context, { appSlug: app, action: "diagnostics.prepared", entityType: "diagnostic", summary: "Redacted repair brief prepared.", metadata: { errorGroups: selected.length } });
      return json({ prompt, redacted: true });
    }
    if (path[0] === "moderation" && path.length === 2) {
      const app = oneApp(input.app);
      assertCapability(context, "moderation:write", app);
      if (app !== "novanook") throw new HubError(503, "APP_NOT_CONNECTED", "Moderation actions are not connected for this app.");
      return json(await moderateNova(context, path[1], textValue(input.action, 40, true), textValue(input.reason, 1000, true), textValue(input.version, 2000, true)));
    }
    if (name === "operations") {
      const app = inputScope(new URL(request.url).searchParams.get("app"));
      if (typeof input.completed !== "boolean") throw new RequestError(400, "INVALID_CHECK", "Choose whether this review is complete.");
      return json(await completeReview(context, app, textValue(input.id, 80, true), input.completed));
    }
    if (name === "settings") {
      assertCapability(context, "settings:write");
      if (input.action === "update-app") { await saveApp(context, { slug: textValue(input.slug, 48, true), name: textValue(input.name, 100, true), website: textValue(input.website, 500, true), color: textValue(input.color, 7, true) }); return json({ saved: true }); }
      assertCapability(context, "staff:write");
      const role = input.role as Exclude<StaffRole, "owner">;
      if (!assignableRoles.includes(role)) throw new RequestError(400, "INVALID_ROLE", "Choose admin, support, moderator, or analyst. Owner access is managed explicitly in the setup process.");
      if (!Array.isArray(input.appSlugs) || !input.appSlugs.length || input.appSlugs.length > 100 || input.appSlugs.some(value => typeof value !== "string")) throw new RequestError(400, "APP_ACCESS_REQUIRED", "Assign at least one app.");
      const apps = input.appSlugs as string[];
      if (apps.some(app => !context.apps.some(allowed => allowed.slug === app))) throw new RequestError(403, "APP_ACCESS_REQUIRED", "Assign only registered apps available to your staff account.");
      if (input.action === "update-staff") {
        const id = textValue(input.id, 36, true);
        const existing = (await listStaff(context)).find(member => member.id === id);
        if (!existing) throw new RequestError(404, "STAFF_NOT_FOUND", "This staff account could not be found.");
        if (typeof input.active !== "boolean") throw new RequestError(400, "INVALID_INPUT", "Choose the staff access status.");
        return json(await saveStaff(context, { userId: id, displayName: existing.displayName, role, active: input.active, appSlugs: apps }));
      }
      if (input.action === "invite") {
        const email = textValue(input.email, 254, true).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError(400, "INVALID_EMAIL", "Enter a valid staff email address.");
        const service = getHubService();
        if (input.userId) {
          if (!validUuid(input.userId)) throw new RequestError(400, "INVALID_USER", "Enter a valid existing Geofox Auth user UUID.");
          const found = await service.auth.admin.getUserById(input.userId);
          if (found.error || found.data.user?.email?.toLowerCase() !== email || !found.data.user.email_confirmed_at) throw new RequestError(400, "USER_NOT_VERIFIED", "The existing Geofox Auth user must have a verified matching email address.");
          await saveStaff(context, { userId: input.userId, displayName: "Geofox team", role, active: true, appSlugs: apps });
          return json({ invited: false, linked: true });
        }
        const invited = await service.auth.admin.inviteUserByEmail(email, { redirectTo: "https://www.geofoxapps.com/auth/callback?next=/admin/password" });
        if (invited.error || !invited.data.user) throw new HubError(400, "INVITATION_FAILED", "The invitation could not be sent. Check your Supabase email setup. If the account already exists, enter its verified Geofox Auth UUID to link it.");
        try { await saveStaff(context, { userId: invited.data.user.id, displayName: "Geofox team", role, active: true, appSlugs: apps }); }
        catch { throw new HubError(503, "INVITATION_ACCESS_INCOMPLETE", "The invitation was sent, but staff permissions could not be saved. Link the invited Geofox Auth UUID after its email is verified. Access remains blocked until then."); }
        return json({ invited: true, linked: false }, 201);
      }
    }
    throw new RequestError(404, "NOT_FOUND", "This staff action does not exist.");
  } catch (error) { return apiError(error); }
}
export const POST = mutate;
export const PATCH = mutate;
