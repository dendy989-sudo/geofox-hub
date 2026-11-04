import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { deleteWorkspaceRecord, getWorkspaceRecord, saveWorkspaceRecord } from "@/lib/workspace/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  try { return json(await getWorkspaceRecord(await getHubContext(), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: Params) {
  try { sameOrigin(request); const context = await getHubContext(); return json(await saveWorkspaceRecord(context, await readJson(request, 100_000), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Params) {
  try { sameOrigin(request); const context = await getHubContext(); const body = await readJson(request, 1024); return json(await deleteWorkspaceRecord(context, (await params).id, body.version)); }
  catch (error) { return apiError(error); }
}
