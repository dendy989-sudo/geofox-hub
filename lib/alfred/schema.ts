import { z } from "zod";

export const DEPARTMENTS = ["briefing", "support", "marketing", "accounting", "engineering", "product", "legal"] as const;
export type Department = typeof DEPARTMENTS[number];
export const DEPARTMENT_LABELS: Record<Department, string> = {
  briefing: "Chief of Staff", support: "Customer support", marketing: "Marketing studio",
  accounting: "Business finance", engineering: "Systems & engineering", product: "Product & growth", legal: "Compliance assistant",
};
export const runInputSchema = z.object({
  requestId: z.uuid(), scope: z.string().min(1).max(48), department: z.enum(DEPARTMENTS),
  question: z.string().trim().min(3).max(4000), ticketId: z.uuid().nullable().optional(),
}).strict();
export const outputSchema = z.object({
  report: z.string().min(1).max(12000),
  limitations: z.array(z.string().max(600)).max(8),
  proposals: z.array(z.object({
    kind: z.enum(["task", "marketing_draft", "support_reply"]),
    appSlug: z.string().max(48).nullable(), title: z.string().min(1).max(200),
    body: z.string().min(1).max(6000), reason: z.string().max(1000),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    platform: z.enum(["instagram", "facebook", "tiktok", "x"]).nullable(),
    sourceIds: z.array(z.string().max(20)).max(10),
  }).strict()).max(4),
}).strict();
export type AlfredOutput = z.infer<typeof outputSchema>;
export interface Evidence { id: string; label: string; data: unknown; }
export interface AlfredSettings {
  enabled: boolean; consent_at: string | null; daily_limit_cents: number; monthly_limit_cents: number;
  scheduled_enabled: boolean; version: number; updated_at: string;
}
export interface AlfredRun {
  id: string; scope: string; department: Department; question: string; state: "running" | "completed" | "failed";
  output: AlfredOutput | null; evidence: Evidence[]; budget_cents: number; estimated_usd: number | null;
  input_tokens: number | null; output_tokens: number | null; error: string | null; created_at: string; finished_at: string | null;
}
export interface AlfredAction {
  id: string; run_id: string; kind: "task" | "marketing_draft" | "support_reply"; app_slug: string | null;
  title: string; payload: Record<string, unknown>; state: "pending" | "executing" | "completed" | "rejected" | "needs_review";
  result: { message?: string; recordId?: string } | null; created_at: string; expires_at: string;
}
export interface Knowledge { id: string; app_slug: string | null; title: string; body: string; enabled: boolean; version: number; updated_at: string; }
export interface Connection { name: string; state: "available" | "not_connected" | "not_implemented" | "not_verified"; detail: string; }
export interface AlfredDashboard {
  settings: AlfredSettings; runs: AlfredRun[]; actions: AlfredAction[]; knowledge: Knowledge[];
  tickets: { id: string; reference: string; subject: string; app_slug: string }[];
  connections: Connection[]; pendingCount: number;
  usage: { dayCents: number; monthCents: number; monthEstimatedUsd: number; monthRuns: number; period: string };
}

/** Permission is deliberately stricter than general staff access. */
export function isAlfredOwner(role: unknown) { return role === "owner"; }
export function scopeAllows(scope: string, app: string | null, appSlugs: readonly string[]): boolean {
  if (app !== null && !appSlugs.includes(app)) return false;
  return scope === "all" || (scope === "company" ? app === null : app === scope);
}

