import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { downloadWorkspaceUpload, prepareWorkspaceUpload, verifyWorkspaceUpload } from "@/lib/workspace/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return json(await downloadWorkspaceUpload(await getHubContext(), new URL(request.url).searchParams.get("path"))); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { sameOrigin(request); const context = await getHubContext(); return json(await prepareWorkspaceUpload(context, await readJson(request, 2048)), 201); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { sameOrigin(request); const context = await getHubContext(); const body = await readJson(request, 1024); return json(await verifyWorkspaceUpload(context, body.path)); }
  catch (error) { return apiError(error); }
}
