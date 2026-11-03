import "server-only";
import { getHubService } from "@/lib/hub/server";
import { customerDbError, customerRateKey } from "./server";
import type { CustomerContext, CustomerCursor, CustomerReplyResult, CustomerTicketDetail, CustomerTicketList } from "./types";
import { customerCreateInput, customerReplyInput, encodeCustomerCursor, requireCustomerUuid } from "./validation";

function detailResult(data: Omit<CustomerTicketDetail, "nextMessagesCursor"> & { nextMessagesCursor: CustomerCursor | null }): CustomerTicketDetail {
  return { ...data, nextMessagesCursor: encodeCustomerCursor(data.nextMessagesCursor) };
}
export async function listCustomerTickets(context: CustomerContext, limit: number, cursor: CustomerCursor | null): Promise<CustomerTicketList> {
  const { data, error } = await getHubService().rpc("hub_customer_list_tickets", {
    p_app: context.appSlug, p_customer: context.id, p_limit: limit,
    p_before_created: cursor?.createdAt || null, p_before_id: cursor?.id || null,
  });
  if (error || !data) customerDbError(error);
  return { items: data.items, nextCursor: encodeCustomerCursor(data.nextCursor) };
}
export async function getCustomerTicket(context: CustomerContext, id: string, cursor: CustomerCursor | null = null): Promise<CustomerTicketDetail> {
  const { data, error } = await getHubService().rpc("hub_customer_ticket_detail", {
    p_app: context.appSlug, p_customer: context.id, p_ticket: requireCustomerUuid(id),
    p_before_created: cursor?.createdAt || null, p_before_id: cursor?.id || null,
  });
  if (error || !data) customerDbError(error);
  return detailResult(data);
}
export async function createCustomerTicket(context: CustomerContext, raw: Record<string, unknown>): Promise<CustomerTicketDetail & { replayed: boolean }> {
  const input = customerCreateInput(raw);
  const { data, error } = await getHubService().rpc("hub_customer_create_ticket", {
    p_app: context.appSlug, p_customer: context.id, p_email: context.email, p_subject: input.subject,
    p_body: input.body, p_category: input.category, p_request: input.requestId,
    p_account_key: customerRateKey("create", context.accountKey), p_ip_key: customerRateKey("create", context.ipKey),
  });
  if (error || !data) customerDbError(error);
  return { ...detailResult(data), replayed: data.replayed === true };
}
export async function replyToCustomerTicket(context: CustomerContext, id: string, raw: Record<string, unknown>): Promise<CustomerReplyResult> {
  const input = customerReplyInput(raw);
  const { data, error } = await getHubService().rpc("hub_customer_reply", {
    p_app: context.appSlug, p_customer: context.id, p_ticket: requireCustomerUuid(id),
    p_body: input.body, p_request: input.requestId,
    p_account_key: customerRateKey("reply", context.accountKey), p_ip_key: customerRateKey("reply", context.ipKey),
  });
  if (error || !data) customerDbError(error);
  return data as CustomerReplyResult;
}
