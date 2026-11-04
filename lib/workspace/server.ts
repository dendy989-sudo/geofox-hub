import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { databaseError, getHubContext, getHubService, HubError, type HubContext } from "@/lib/hub/server";
import type { StaffRole } from "@/lib/hub/types";
import { defaultWorkspacePermissions, permits, workspaceAccessFor } from "./access";
import { WORKSPACE_MODULES, type TaskCompletion, type WorkspaceAttachment, type WorkspaceList, type WorkspaceModule, type WorkspacePermissions, type WorkspaceProfile, type WorkspaceRecord, type WorkspaceStaffAccess, type WorkspaceUpload } from "./types";
import { appScope, choice, integer, object, text, uploadMaximumBytes, uploadMimeExtensions, uuid, validateWorkspaceData, WorkspaceInputError } from "./validation";

const bucket = "hub-workspace" as const;
type Row = Record<string, unknown>;

export function workspaceDatabaseError(error: { code?: string } | null): never {
  if (error?.code === "40001") throw new HubError(409, "RECORD_CHANGED", "Someone changed this item. Refresh it before saving your changes.");
  if (error?.code === "23505") throw new HubError(409, "REQUEST_CONFLICT", "This request was already used for another change. Refresh the page before trying again.");
  if (error?.code === "P0002") throw new HubError(404, "NOT_FOUND", "This item no longer exists.");
  if (["22007", "22008", "23503", "22003"].includes(error?.code ?? "")) throw new HubError(400, "INVALID_INPUT", "Please check the dates, amounts, and selected app.");
  return databaseError(error, "The company workspace could not complete this request. Please try again.");
}

export async function workspaceRpc<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
  const { data, error } = await getHubService().rpc(name, parameters);
  if (error) workspaceDatabaseError(error);
  return data as T;
}

export function assertWorkspaceAccess(context: HubContext, module: WorkspaceModule, action: "read" | "write", app: string | null) {
  const level = app === null ? context.workspaceAccess[module].companyLevel : context.workspaceAccess[module].level;
  if (!permits(level, action)) throw new HubError(403, "FORBIDDEN", "Your account does not have access to this workspace area.");
  if (app !== null && !context.apps.some((item) => item.slug === app)) throw new HubError(403, "APP_ACCESS_REQUIRED", "Your staff account does not have access to this app.");
}

async function reserve(context: HubContext, category: string, window = 60, limit = 240) {
  const key = createHash("sha256").update(`workspace:${category}:${context.user.id}`).digest("hex");
  const allowed = await workspaceRpc<boolean>("hub_reserve_rate_limit", { p_key_hash: key, p_window_seconds: window, p_limit: limit });
  if (!allowed) throw new HubError(429, "RATE_LIMITED", "Too many requests. Please wait a moment before trying again.");
}

/** Only public record fields cross the API boundary. Actor IDs always come from the verified session. */
export function toWorkspaceRecord<T = Record<string, unknown>>(row: Row): WorkspaceRecord<T> {
  return { id: row.id as string, module: row.module as WorkspaceModule, appSlug: row.app_slug as string | null, title: row.title as string, status: row.status as string, data: row.data as T, version: row.version as number, createdAt: row.created_at as string, updatedAt: row.updated_at as string, createdBy: row.created_by as string };
}

export async function getWorkspaceRecord(context: HubContext, id: string, action: "read" | "write" = "read") {
  const result = await workspaceRpc<Row>("hub_workspace_get", { p_actor: context.user.id, p_id: uuid(id), p_action: action });
  return toWorkspaceRecord(result);
}

function numberParameter(value: string | null, fallback: number, min: number, max: number, label: string) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new WorkspaceInputError(`Please check ${label}.`);
  return integer(Number(value), min, max, label);
}

export async function listWorkspaceRecords(context: HubContext, query: URLSearchParams): Promise<WorkspaceList> {
  const module = choice(query.get("module"), WORKSPACE_MODULES, "workspace area");
  const scope = query.get("app") ?? "all";
  if (scope !== "all" && scope !== "company") appScope(scope);
  if (scope !== "all") assertWorkspaceAccess(context, module, "read", scope === "company" ? null : scope);
  else if (!permits(context.workspaceAccess[module].level, "read")) throw new HubError(403, "FORBIDDEN", "Your account does not have access to this workspace area.");
  const status = query.get("status");
  const search = query.get("query") ?? query.get("q");
  const priority = query.get("priority");
  const result = await workspaceRpc<{ items: Row[]; total: number }>("hub_workspace_list", {
    p_actor: context.user.id, p_module: module, p_scope: scope,
    p_limit: numberParameter(query.get("limit"), 200, 1, 1000, "page size"),
    p_offset: numberParameter(query.get("offset"), 0, 0, 100000, "page offset"),
    p_status: status ? text(status, 32, "status") : null,
    p_query: search ? text(search, 200, "search") : null,
    p_priority: priority ? choice(priority, ["low", "normal", "high", "urgent"], "priority") : null,
  });
  return { items: result.items.map((item) => toWorkspaceRecord(item)), total: result.total };
}

export async function saveWorkspaceRecord(context: HubContext, input: Row, id?: string): Promise<WorkspaceRecord> {
  await reserve(context, "record-write");
  const existing = id ? await getWorkspaceRecord(context, id, "write") : undefined;
  const module = choice(input.module ?? existing?.module, WORKSPACE_MODULES, "workspace area");
  const app = appScope(Object.hasOwn(input, "appSlug") ? input.appSlug : existing ? existing.appSlug : null);
  const title = text(input.title ?? existing?.title, 200, "title", true);
  const status = text(input.status ?? existing?.status, 32, "status", true);
  const version = existing ? integer(input.version, 1, 2147483647, "record version") : null;
  if (existing && existing.module !== module) throw new WorkspaceInputError("An item cannot move to a different workspace area.");
  assertWorkspaceAccess(context, module, "write", app);
  const data = validateWorkspaceData(module, status, Object.hasOwn(input, "data") ? input.data : existing?.data, existing?.data);
  const saved = await workspaceRpc<Row>("hub_workspace_save", {
    p_actor: context.user.id, p_id: id ?? null, p_version: version, p_module: module,
    p_app: app, p_title: title, p_status: status, p_data: data,
    p_request: !existing && input.requestId !== undefined ? uuid(input.requestId, "request ID") : null,
  });
  return toWorkspaceRecord(saved);
}

export async function deleteWorkspaceRecord(context: HubContext, id: string, version: unknown) {
  await reserve(context, "record-write");
  await workspaceRpc("hub_workspace_delete", { p_actor: context.user.id, p_id: uuid(id), p_version: integer(version, 1, 2147483647, "record version") });
  return { deleted: true };
}

export async function completeWorkspaceTask(context: HubContext, id: string, version: unknown): Promise<TaskCompletion> {
  await reserve(context, "record-write");
  const saved = await workspaceRpc<{ item: Row; next: Row | null }>("hub_workspace_complete_task", { p_actor: context.user.id, p_id: uuid(id), p_version: integer(version, 1, 2147483647, "record version") });
  return { item: toWorkspaceRecord(saved.item), next: saved.next ? toWorkspaceRecord(saved.next) : null };
}

export async function workspaceProfile(context: HubContext): Promise<WorkspaceProfile> {
  const { data, error } = await getHubService().auth.admin.getUserById(context.user.id);
  if (error || !data.user) throw new HubError(503, "AUTH_UNAVAILABLE", "Your account information could not be loaded. Please try again.");
  const user = data.user;
  return {
    user: { ...context.user, createdAt: user.created_at, lastSignInAt: user.last_sign_in_at, emailVerified: Boolean(user.email_confirmed_at), mfaEnabled: (user.factors ?? []).some((factor) => factor.status === "verified") },
    staff: context.staff, apps: context.apps, capabilities: context.capabilities,
    defaultPermissions: defaultWorkspacePermissions(context.staff.role), effectivePermissions: context.workspaceAccess,
  };
}

export async function updateWorkspaceProfile(context: HubContext, input: Row) {
  if (Object.keys(input).some((key) => key !== "displayName")) throw new WorkspaceInputError("Only your display name can be changed here.");
  await reserve(context, "profile-write", 60, 20);
  await workspaceRpc("hub_workspace_update_profile", { p_actor: context.user.id, p_name: text(input.displayName, 100, "display name", true) });
  return workspaceProfile(await getHubContext());
}

export async function listWorkspaceAccess(context: HubContext): Promise<{ members: WorkspaceStaffAccess[] }> {
  if (context.staff.role !== "owner") throw new HubError(403, "FORBIDDEN", "Only the owner can manage workspace access.");
  const members = await workspaceRpc<Array<{ userId: string; displayName: string; role: StaffRole; active: boolean; appSlugs: string[]; grants: Partial<WorkspacePermissions> }>>("hub_workspace_list_access", { p_actor: context.user.id });
  return { members: members.map((member) => ({ ...member, defaultPermissions: defaultWorkspacePermissions(member.role), effectivePermissions: workspaceAccessFor(member.role, member.grants) })) };
}

export async function updateWorkspaceAccess(context: HubContext, input: Row) {
  if (context.staff.role !== "owner") throw new HubError(403, "FORBIDDEN", "Only the owner can manage workspace access.");
  const userId = uuid(input.userId, "staff account");
  const grants = object(input.grants, "workspace permissions");
  if (Object.keys(grants).some((key) => !WORKSPACE_MODULES.includes(key as WorkspaceModule))) throw new WorkspaceInputError("Unknown workspace area.");
  const checked = Object.fromEntries(WORKSPACE_MODULES.map((module) => [module, grants[module] === null || grants[module] === undefined ? null : choice(grants[module], ["none", "read", "write"], `${module} access`)]));
  await reserve(context, "access-write", 60, 40);
  await workspaceRpc("hub_workspace_set_access", { p_actor: context.user.id, p_user: userId, p_grants: checked });
  return listWorkspaceAccess(context);
}

function toAttachment(row: Row): WorkspaceAttachment {
  return { path: row.path as string, filename: row.filename as string, contentType: row.content_type as string, size: row.size as number };
}

export async function prepareWorkspaceUpload(context: HubContext, input: Row): Promise<WorkspaceUpload> {
  const module = choice(input.module, WORKSPACE_MODULES, "workspace area");
  const app = appScope(input.appSlug ?? null);
  assertWorkspaceAccess(context, module, "write", app);
  const filename = text(input.filename, 200, "filename", true).replace(/[\\/]/g, "_");
  const contentType = choice(input.contentType, Object.keys(uploadMimeExtensions) as Array<keyof typeof uploadMimeExtensions>, "file type");
  const size = integer(input.size, 1, uploadMaximumBytes, "file size (50 MB maximum)");
  if (module !== "marketing" && contentType.startsWith("video/")) throw new WorkspaceInputError("Use a photo or PDF attachment in this area.");
  await reserve(context, "upload", 3600, 120);
  const path = `${module}/${app ?? "company"}/${randomUUID()}.${uploadMimeExtensions[contentType]}`;
  await workspaceRpc("hub_workspace_register_upload", { p_actor: context.user.id, p_module: module, p_app: app, p_path: path, p_filename: filename, p_content_type: contentType, p_size: size });
  const { data, error } = await getHubService().storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) throw new HubError(503, "UPLOAD_UNAVAILABLE", "The file upload could not be prepared. Please try again.");
  return { path, filename, contentType, size, bucket, token: data.token, signedUrl: data.signedUrl };
}

export async function verifyWorkspaceUpload(context: HubContext, value: unknown): Promise<WorkspaceAttachment> {
  const path = text(value, 256, "attachment path", true);
  const row = await workspaceRpc<Row>("hub_workspace_upload_info", { p_actor: context.user.id, p_path: path, p_action: "write" });
  const { data, error } = await getHubService().storage.from(bucket).info(path);
  if (error || !data) throw new HubError(409, "UPLOAD_INCOMPLETE", "The upload has not finished. Upload the file again before attaching it.");
  if (data.size !== row.size || data.contentType !== row.content_type) throw new HubError(400, "UPLOAD_MISMATCH", "The uploaded file does not match the selected size or type. Please select and upload it again.");
  await workspaceRpc("hub_workspace_verify_upload", { p_actor: context.user.id, p_path: path, p_size: data.size, p_content_type: data.contentType });
  return toAttachment(row);
}

export async function downloadWorkspaceUpload(context: HubContext, value: unknown): Promise<{ url: string }> {
  const path = text(value, 256, "attachment path", true);
  const row = await workspaceRpc<Row>("hub_workspace_upload_info", { p_actor: context.user.id, p_path: path, p_action: "read" });
  if (!row.verified_at) throw new HubError(409, "UPLOAD_INCOMPLETE", "This attachment has not finished uploading.");
  const options = row.content_type === "application/pdf" ? { download: row.filename as string } : undefined;
  const { data, error } = await getHubService().storage.from(bucket).createSignedUrl(path, 300, options);
  if (error || !data) throw new HubError(503, "DOWNLOAD_UNAVAILABLE", "This attachment could not be opened. Please try again.");
  return { url: data.signedUrl };
}
