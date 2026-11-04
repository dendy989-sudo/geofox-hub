import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { completeWorkspaceTask } from "@/lib/workspace/server";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { sameOrigin(request); const context = await getHubContext(); const body = await readJson(request, 1024); return json(await completeWorkspaceTask(context, (await params).id, body.version)); }
  catch (error) { return apiError(error); }
}
