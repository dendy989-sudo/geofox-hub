import { after } from "next/server";
import { syncCosts } from "@/lib/costs/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { alfredContext, dashboard, runAlfred, decideAction, configure, saveKnowledge } from "@/lib/alfred/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try { return json(await dashboard(await alfredContext(), new URL(request.url).searchParams.get("scope") ?? "all")); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request); const context = await alfredContext(); const input = await readJson(request, 20000);
    const { operation, ...payload } = input;
    switch (operation) {
      case "run": { const result = await runAlfred(context, payload); after(async () => { try { await syncCosts(context); } catch { console.warn("cost.monitor.failed", { stage: "after-alfred" }); } }); return json(result); }
      case "decide": return json(await decideAction(context, payload));
      case "configure": return json(await configure(context, payload));
      case "knowledge": return json(await saveKnowledge(context, payload));
      default: return json({ message: "Unknown Alfred operation." }, 400);
    }
  } catch (error) { return apiError(error); }
}
