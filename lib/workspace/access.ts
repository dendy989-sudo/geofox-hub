import type { StaffRole } from "../hub/types";
import { WORKSPACE_MODULES, type WorkspaceAccess, type WorkspaceLevel, type WorkspaceModule, type WorkspacePermissions } from "./types";

export function defaultWorkspacePermissions(role: StaffRole): WorkspacePermissions {
  return { tasks: role === "owner" ? "write" : role === "analyst" ? "read" : "write", marketing: role === "owner" ? "write" : "none", legal: role === "owner" ? "write" : "none", accounting: role === "owner" ? "write" : "none" };
}
export function workspaceAccessFor(role: StaffRole, grants: Partial<WorkspacePermissions> = {}): WorkspaceAccess {
  const defaults = defaultWorkspacePermissions(role);
  return Object.fromEntries(WORKSPACE_MODULES.map((module) => {
    const explicit = Object.hasOwn(grants, module);
    const level = role === "owner" ? "write" : grants[module] ?? defaults[module];
    return [module, { level, companyLevel: role === "owner" ? "write" : explicit ? level : "none", explicit }];
  })) as WorkspaceAccess;
}
export function permits(level: WorkspaceLevel, action: "read" | "write"): boolean {
  return level === "write" || (action === "read" && level === "read");
}
export function isWorkspaceModule(value: unknown): value is WorkspaceModule {
  return typeof value === "string" && (WORKSPACE_MODULES as readonly string[]).includes(value);
}
