import { getHubContext } from "@/lib/hub/server";
import { apiError, json } from "@/lib/security/http";
import { marketingCapabilities } from "@/lib/workspace/marketing-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return json(marketingCapabilities(await getHubContext(), new URL(request.url).searchParams.get("app") || "all")); }
  catch (error) { return apiError(error); }
}
