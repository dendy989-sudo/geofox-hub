import "server-only";

import { getHubContext, getHubService, HubError, type HubContext } from "@/lib/hub/server";
import type { FinanceData } from "./types";
import { financeMonth, financeForecastThrough, FinanceInputError, validateFinanceMutation } from "./validation";

type FinanceDatabaseError = { code?: string; message?: string };
function financeDatabaseError(error: FinanceDatabaseError): never {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    throw new HubError(503, "FINANCE_DATABASE_NOT_READY", "The private finance database setup is not available yet.");
  }
  if (error.code === "42501") throw new HubError(403, "FINANCE_ACCESS_REQUIRED", "This finance workspace is available only to its approved owner.");
  if (error.code === "P0002") throw new HubError(404, "FINANCE_RECORD_NOT_FOUND", "This finance record was not found. Refresh the page and try again.");
  // These are deliberately authored business-rule messages from the private RPC.
  if (error.code === "P0001") throw new HubError(409, "FINANCE_CHANGE_REJECTED", error.message ?? "This change cannot be applied to the current record.");
  if (error.code === "23505" && error.message?.includes("finance_vendors_user_name_idx")) {
    throw new HubError(409, "FINANCE_VENDOR_EXISTS", "A vendor with this name already exists. Choose it from your vendors, or restore it if archived.");
  }
  if (error.code === "23505") throw new HubError(409, "FINANCE_RECORD_EXISTS", "This change already exists or the record changed. Refresh the page before trying again.");
  if (["22023", "23514", "23502", "23503", "22P02", "22007", "22008", "22003"].includes(error.code ?? "")) {
    throw new HubError(400, "INVALID_FINANCE_INPUT", "Check the amounts and dates. Installments must end by 2100 and every required field must be completed.");
  }
  throw new HubError(503, "FINANCE_DATABASE_UNAVAILABLE", "Your finance data could not be loaded or saved. Please try again shortly.");
}

function inputError(error: unknown): never {
  if (error instanceof FinanceInputError) throw new HubError(error.status, error.code, error.message);
  throw error;
}

export async function requireFinanceContext(): Promise<HubContext> {
  const context = await getHubContext();
  if (context.staff.role !== "owner") throw new HubError(403, "FINANCE_ACCESS_REQUIRED", "This finance workspace is available only to its approved owner.");
  const { data, error } = await getHubService().from("finance_access").select("user_id").eq("user_id", context.user.id).eq("active", true).maybeSingle();
  if (error) financeDatabaseError(error);
  if (!data) throw new HubError(403, "FINANCE_ACCESS_REQUIRED", "This finance workspace is available only to its approved owner.");
  return context;
}

export async function loadFinanceData(context: HubContext, requestedMonth: string): Promise<FinanceData> {
  let month: string;
  try { month = financeMonth(requestedMonth); } catch (error) { return inputError(error); }
  const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).format(new Date());
  const through = financeForecastThrough(month, currentMonth);
  // The service-only RPC rechecks the verified owner and allowlist, filters every
  // record by the server-authenticated user, and returns an atomic ledger snapshot.
  const { data, error } = await getHubService().rpc("finance_snapshot", { p_actor: context.user.id, p_through: through });
  if (error) financeDatabaseError(error);
  if (!data || typeof data !== "object" || !["entries", "payments", "vendors", "accounts", "balance_updates", "transfers", "goals", "goal_history"].every(key => Array.isArray(data[key]))) {
    throw new HubError(503, "FINANCE_DATABASE_UNAVAILABLE", "Your finance records could not be read. Please refresh the page.");
  }
  return { ...data, user: { id: context.user.id, display_name: context.staff.displayName } } as FinanceData;
}

export async function mutateFinance(context: HubContext, action: unknown, payload: unknown): Promise<Record<string, unknown>> {
  let mutation: ReturnType<typeof validateFinanceMutation>;
  try { mutation = validateFinanceMutation(action, payload); } catch (error) { return inputError(error); }
  const { data, error } = await getHubService().rpc("finance_mutate", { p_actor: context.user.id, p_action: mutation.action, p_payload: mutation.payload });
  if (error) financeDatabaseError(error);
  return data as Record<string, unknown>;
}
