import { createCustomerTicket, listCustomerTickets } from "@/lib/customer/data";
import { assertCustomerOrigin, customerError, customerJson, customerPreflight } from "@/lib/customer/http";
import { getCustomerContext } from "@/lib/customer/server";
import { customerLimit, decodeCustomerCursor } from "@/lib/customer/validation";
import { readJson } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = customerPreflight;

export async function GET(request: Request) {
  try {
    assertCustomerOrigin(request);
    const query = new URL(request.url).searchParams;
    const limit = customerLimit(query.get("limit"));
    const cursor = decodeCustomerCursor(query.get("cursor"));
    return customerJson(request, await listCustomerTickets(await getCustomerContext(request), limit, cursor));
  } catch (error) { return customerError(request, error); }
}
export async function POST(request: Request) {
  try {
    assertCustomerOrigin(request);
    const input = await readJson(request, 56000);
    const result = await createCustomerTicket(await getCustomerContext(request), input);
    return customerJson(request, result, result.replayed ? 200 : 201);
  } catch (error) { return customerError(request, error); }
}
