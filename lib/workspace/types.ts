import type { StaffRole, HubApp, Capability } from "@/lib/hub/types";

export const WORKSPACE_MODULES = ["tasks", "marketing", "legal", "accounting"] as const;
export type WorkspaceModule = typeof WORKSPACE_MODULES[number];
export type WorkspaceLevel = "none" | "read" | "write";
/** Assigned app access uses level; company records require an explicit company grant (owner always write). */
export interface ModuleAccess { level: WorkspaceLevel; companyLevel: WorkspaceLevel; explicit: boolean; }
export type WorkspaceAccess = Record<WorkspaceModule, ModuleAccess>;
export type WorkspacePermissions = Record<WorkspaceModule, WorkspaceLevel>;
export interface WorkspaceRecord<T = Record<string, unknown>> {
  id: string; module: WorkspaceModule; appSlug: string | null; title: string; status: string;
  data: T; version: number; createdAt: string; updatedAt: string; createdBy: string;
}
export interface WorkspaceList<T = Record<string, unknown>> { items: WorkspaceRecord<T>[]; total: number; }
export interface WorkspaceRecordInput<T = Record<string, unknown>> {
  module: WorkspaceModule; appSlug: string | null; title: string; status: string; data: T; requestId?: string;
}
export interface WorkspaceAttachment { path: string; filename: string; contentType: string; size: number; }
export interface TaskData {
  description: string; priority: "low" | "normal" | "high" | "urgent"; dueDate: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly"; checklist: { id: string; text: string; done: boolean }[];
  assigneeId?: string | null;
}
export type TaskStatus = "todo" | "in_progress" | "done" | "archived";
export interface TaskCompletion { item: WorkspaceRecord<TaskData>; next: WorkspaceRecord<TaskData> | null; }
export interface WorkspaceStaffAccess {
  userId: string; displayName: string; role: StaffRole; active: boolean; appSlugs: string[];
  grants: Partial<WorkspacePermissions>; defaultPermissions: WorkspacePermissions; effectivePermissions: WorkspaceAccess;
}
export interface WorkspaceProfile {
  user: { id: string; email: string; createdAt?: string; lastSignInAt?: string; emailVerified?: boolean; mfaEnabled?: boolean }; staff: { role: StaffRole; displayName: string };
  apps: HubApp[]; capabilities: Capability[]; defaultPermissions: WorkspacePermissions; effectivePermissions: WorkspaceAccess;
}
export interface WorkspaceUpload extends WorkspaceAttachment { token: string; signedUrl: string; bucket: "hub-workspace"; }
