import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { listWorkspaceRecords, saveWorkspaceRecord } from "@/lib/workspace/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return json(await listWorkspaceRecords(await getHubContext(), new URL(request.url).searchParams)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { sameOrigin(request); const context = await getHubContext(); return json(await saveWorkspaceRecord(context, await readJson(request, 100_000)), 201); }
  catch (error) { return apiError(error); }
}
