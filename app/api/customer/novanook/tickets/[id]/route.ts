import { getCustomerTicket } from "@/lib/customer/data";
import { assertCustomerOrigin, customerError, customerJson, customerPreflight } from "@/lib/customer/http";
import { getCustomerContext } from "@/lib/customer/server";
import { decodeCustomerCursor } from "@/lib/customer/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = customerPreflight;

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertCustomerOrigin(request);
    const cursor = decodeCustomerCursor(new URL(request.url).searchParams.get("messagesBefore"));
    return customerJson(request, await getCustomerTicket(await getCustomerContext(request), (await route.params).id, cursor));
  } catch (error) { return customerError(request, error); }
}
