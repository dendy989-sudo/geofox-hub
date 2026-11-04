import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Capability, HubApp, HubBootstrap, StaffRole } from "./types";
import { workspaceAccessFor, isWorkspaceModule } from "../workspace/access";
import { WORKSPACE_MODULES, type WorkspacePermissions } from "../workspace/types";

export class HubError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HubError";
  }
}

export type HubContext = HubBootstrap;

const roleCapabilities: Record<StaffRole, Capability[]> = {
  owner: ["overview:read", "customers:read", "tickets:read", "tickets:write", "errors:read", "errors:write", "moderation:read", "moderation:write", "operations:read", "settings:write", "staff:write", "audit:read"],
  admin: ["overview:read", "customers:read", "tickets:read", "tickets:write", "errors:read", "errors:write", "moderation:read", "moderation:write", "operations:read", "audit:read"],
  support: ["overview:read", "customers:read", "tickets:read", "tickets:write", "errors:read", "errors:write", "operations:read"],
  moderator: ["overview:read", "moderation:read", "moderation:write", "operations:read"],
  analyst: ["overview:read", "errors:read", "operations:read"],
};

export function capabilitiesForRole(role: StaffRole): Capability[] {
  return [...roleCapabilities[role]];
}

export function hubConfigurationIssues(): string[] {
  const issues: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) issues.push("Geofox Supabase URL is not configured.");
  if (!(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) issues.push("Geofox Supabase publishable key is not configured.");
  if (!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) issues.push("Geofox server database key is not configured.");
  return issues;
}

export function getHubService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HubError(503, "HUB_NOT_CONFIGURED", "The staff hub is waiting for its secure database connection.");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Unsupported database URL");
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  } catch {
    throw new HubError(503, "HUB_NOT_CONFIGURED", "The hub database connection needs to be checked in hosting settings.");
  }
}

export function isAppConnectionConfigured(slug: string): boolean {
  const prefix = slug.replaceAll("-", "_").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(prefix)) return false;
  return Boolean(process.env[`${prefix}_SUPABASE_URL`] && (process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`] || process.env[`${prefix}_SUPABASE_SECRET_KEY`]));
}

export function databaseError(error: { code?: string } | null, message = "The hub could not complete this request. Please try again."): never {
  if (error?.code === "42P01" || error?.code === "42883" || error?.code === "PGRST202" || error?.code === "PGRST205") {
    throw new HubError(503, "HUB_DATABASE_NOT_READY", "Apply the Geofox database setup migration before using this feature.");
  }
  if (error?.code === "42501") throw new HubError(403, "FORBIDDEN", "Your staff role does not allow this action.");
  if (error?.code === "22023" || error?.code === "23514" || error?.code === "22P02") throw new HubError(400, "INVALID_INPUT", "Please check the information and try again.");
  if (error?.code === "P0001") throw new HubError(429, "RATE_LIMITED", "Too many requests. Please wait before trying again.");
  throw new HubError(503, "DATABASE_UNAVAILABLE", message);
}

export async function getHubContext(options: { allowMfaEnrollment?: boolean } = {}): Promise<HubContext> {
  const auth = await createSupabaseServerClient();
  if (!auth) throw new HubError(503, "HUB_NOT_CONFIGURED", "The staff hub is waiting for its secure sign-in connection.");
  const { data: authData, error: authError } = await auth.auth.getUser();
  if (authError || !authData.user) throw new HubError(401, "AUTH_REQUIRED", "Sign in to your staff account to continue.");
  const user = authData.user;
  if (!user.email_confirmed_at || !user.email) throw new HubError(403, "EMAIL_NOT_VERIFIED", "Verify your email before using the staff hub.");
  const bannedUntil = (user as typeof user & { banned_until?: string }).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) throw new HubError(403, "ACCESS_DISABLED", "Staff access for this account is disabled.");

  const service = getHubService();
  const { data: staff, error: staffError } = await service.from("hub_staff").select("user_id,display_name,role,active").eq("user_id", user.id).maybeSingle();
  if (staffError) databaseError(staffError);
  if (!staff || !staff.active || !Object.hasOwn(roleCapabilities, staff.role)) {
    throw new HubError(403, "STAFF_ACCESS_REQUIRED", "This account has not been granted staff access. The company owner must add it to the staff allowlist.");
  }
  const role = staff.role as StaffRole;
  const { data: assurance, error: assuranceError } = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new HubError(503, "AUTH_UNAVAILABLE", "We could not verify the security level of this session. Sign in again.");
  if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    throw new HubError(403, "MFA_REQUIRED", "Complete your two-step verification to access the staff hub.");
  }
  if (process.env.HUB_REQUIRE_MFA === "true" && ["owner", "admin"].includes(role) && assurance?.currentLevel !== "aal2" && !options.allowMfaEnrollment) {
    throw new HubError(403, "MFA_ENROLLMENT_REQUIRED", "Set up two-step verification for this staff account to open the hub.");
  }

  let permitted: string[] | null = null;
  if (role !== "owner") {
    const { data: grants, error: grantsError } = await service.from("hub_staff_apps").select("app_slug").eq("user_id", user.id);
    if (grantsError) databaseError(grantsError);
    permitted = (grants || []).map((grant) => grant.app_slug as string);
  }
  let appsQuery = service.from("hub_apps").select("slug,name,color,website").eq("active", true).order("name");
  if (permitted !== null) appsQuery = appsQuery.in("slug", permitted.length ? permitted : ["__no_app_access__"]);
  const { data: appsData, error: appsError } = await appsQuery;
  if (appsError) databaseError(appsError);
  const apps: HubApp[] = (appsData || []).map((app) => ({
    slug: app.slug, name: app.name, color: app.color, website: app.website, configured: isAppConnectionConfigured(app.slug),
  }));
  const setupIssues = apps.length ? [] : ["No apps are assigned to this staff account."];
  const { data: moduleRows, error: moduleError } = await service.from("hub_staff_modules").select("module,access_level").eq("user_id", user.id);
  if (moduleError && !["42P01", "PGRST205"].includes(moduleError.code)) databaseError(moduleError);
  if (moduleError) setupIssues.push("The company workspace database setup is pending.");
  const grants: Partial<WorkspacePermissions> = {};
  for (const row of moduleRows ?? []) if (isWorkspaceModule(row.module) && ["none", "read", "write"].includes(row.access_level)) grants[row.module] = row.access_level;
  const workspaceAccess = workspaceAccessFor(role, grants);
  const capabilities = capabilitiesForRole(role);
  for (const module of WORKSPACE_MODULES) {
    if (workspaceAccess[module].level !== "none") capabilities.push(`${module}:read`);
    if (workspaceAccess[module].level === "write") capabilities.push(`${module}:write`);
  }
  return {
    user: { id: user.id, email: user.email },
    staff: { role, displayName: staff.display_name },
    apps,
    capabilities,
    workspaceAccess,
    setupIssues,
  };
}

export function assertCapability(context: HubContext, capability: Capability, appSlug?: string | null): void {
  if (!context.capabilities.includes(capability)) throw new HubError(403, "FORBIDDEN", "Your staff role does not allow this action.");
  if (appSlug && !context.apps.some((app) => app.slug === appSlug)) throw new HubError(403, "APP_ACCESS_REQUIRED", "Your staff account does not have access to this app.");
}

export function allowedAppSlugs(context: HubContext, requestedApp?: string | null): string[] {
  if (requestedApp && requestedApp !== "all") {
    if (!context.apps.some((app) => app.slug === requestedApp)) throw new HubError(403, "APP_ACCESS_REQUIRED", "Your staff account does not have access to this app.");
    return [requestedApp];
  }
  return context.apps.map((app) => app.slug);
}

export async function requireHubStaff(capability: Capability, appSlug?: string | null): Promise<HubContext> {
  const context = await getHubContext();
  assertCapability(context, capability, appSlug === "all" ? null : appSlug);
  return context;
}
