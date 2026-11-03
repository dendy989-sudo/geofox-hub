import "server-only";
import type { Ticket, TicketMessage } from "@/lib/hub/types";

/** Optional notification only: the public message is already stored in-app. */
export async function sendInAppSupportNotification(ticket: Ticket, message: TicketMessage, verifiedEmail: string): Promise<boolean> {
  if (message.internal || ticket.source !== "app" || !ticket.customerOwnerId || !ticket.identityVerified) return false;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.SUPPORT_FROM_EMAIL;
  const replyTo = process.env.SUPPORT_REPLY_TO_EMAIL;
  if (!key || !from || !replyTo || /[\r\n]/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedEmail)) return false;
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "geofox-app-notification-" + message.id },
      body: JSON.stringify({
        from, to: [verifiedEmail], reply_to: replyTo,
        subject: "A new " + ticket.appName + " support reply is ready",
        text: "Your support request " + ticket.reference + " has a new reply.\n\nOpen NovaNook, go to Help & Support, and choose My requests to read and reply securely.\nhttps://www.mynovanook.com/\n\nThe conversation is available in the app even if this email arrives late. Reply inside the app to keep your conversation together.\n\nGEOFOX APPS LLC",
        tags: [{ name: "app", value: ticket.appSlug }, { name: "kind", value: "support-notification" }],
      }),
      signal: AbortSignal.timeout(12000), cache: "no-store",
    });
    if (!result.ok) return false;
    return typeof ((await result.json()) as { id?: unknown }).id === "string";
  } catch { return false; }
}
