import "server-only";
import type { Ticket, TicketMessage } from "@/lib/hub/types";
import { HubError } from "@/lib/hub/server";

export function replyEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.SUPPORT_FROM_EMAIL && process.env.SUPPORT_REPLY_TO_EMAIL); }

/** Called only after an authorized staff member explicitly sends a customer reply. */
export async function sendCustomerReply(ticket: Ticket, message: TicketMessage): Promise<boolean> {
  if (message.internal) throw new HubError(400, "INTERNAL_NOTE", "Internal notes cannot be emailed to customers.");
  const key = process.env.RESEND_API_KEY;
  const from = process.env.SUPPORT_FROM_EMAIL;
  const replyTo = process.env.SUPPORT_REPLY_TO_EMAIL;
  if (!key || !from || !replyTo || /[\r\n]/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) return false;
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `geofox-reply-${message.id}` },
      body: JSON.stringify({ from, to: [ticket.email], reply_to: replyTo, subject: `[${ticket.reference}] ${ticket.appName} support: ${ticket.subject.replace(/[\r\n]/g, " ")}`, text: `${message.body}\n\n—\n${ticket.appName} support · GEOFOX APPS LLC\nTicket ${ticket.reference}\nReply to this email to reach our support mailbox.`, tags: [{ name: "app", value: ticket.appSlug }, { name: "kind", value: "support-reply" }] }),
      signal: AbortSignal.timeout(12_000), cache: "no-store",
    });
    if (!result.ok) return false;
    const receipt = await result.json() as { id?: unknown };
    return typeof receipt.id === "string";
  } catch { return false; }
}
