import { loadFinanceData, mutateFinance, requireFinanceContext } from "@/lib/finance/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFinanceContext();
    const month = new URL(request.url).searchParams.get("month") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
    return json(await loadFinanceData(context, month));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const context = await requireFinanceContext();
    const body = await readJson(request);
    return json(await mutateFinance(context, body.action, body.payload));
  } catch (error) { return apiError(error); }
}
