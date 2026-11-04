import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { publishMarketingPost } from "@/lib/workspace/marketing-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { sameOrigin(request); const context = await getHubContext(); return json(await publishMarketingPost(context, await readJson(request, 4000))); }
  catch (error) { return apiError(error); }
}
