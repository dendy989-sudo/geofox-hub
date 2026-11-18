import { getHubContext } from "@/lib/hub/server";
import { apiError, json, readJson, sameOrigin } from "@/lib/security/http";
import { createMarketingContentPost } from "@/lib/workspace/marketing-content-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    sameOrigin(request);
    const context = await getHubContext();
    const body = await readJson(request, 1024);
    return json(await createMarketingContentPost(context, (await params).id, body.version));
  } catch (error) { return apiError(error); }
}
