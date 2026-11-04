import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { updateWorkspaceProfile, workspaceProfile } from "@/lib/workspace/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return json(await workspaceProfile(await getHubContext())); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { sameOrigin(request); const context = await getHubContext(); return json(await updateWorkspaceProfile(context, await readJson(request, 2048))); }
  catch (error) { return apiError(error); }
}
