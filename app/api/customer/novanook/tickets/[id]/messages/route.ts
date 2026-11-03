import { replyToCustomerTicket } from "@/lib/customer/data";
import { assertCustomerOrigin, customerError, customerJson, customerPreflight } from "@/lib/customer/http";
import { getCustomerContext } from "@/lib/customer/server";
import { readJson } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = customerPreflight;

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertCustomerOrigin(request);
    const input = await readJson(request, 56000);
    const result = await replyToCustomerTicket(await getCustomerContext(request), (await route.params).id, input);
    return customerJson(request, result, result.replayed ? 200 : 201);
  } catch (error) { return customerError(request, error); }
}
