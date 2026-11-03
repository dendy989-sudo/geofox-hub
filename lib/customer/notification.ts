import "server-only";
import type { Ticket, TicketMessage } from "@/lib/hub/types";
import { supportEmailSettings } from "@/lib/integrations/email-config";

/** Optional notification only: the public message is already stored in-app. */
export async function sendInAppSupportNotification(ticket: Ticket, message: TicketMessage, verifiedEmail: string): Promise<boolean> {
  if (message.internal || ticket.source !== "app" || !ticket.customerOwnerId || !ticket.identityVerified) return false;
  const key = process.env.RESEND_API_KEY;
  const settings = supportEmailSettings();
  if (!key || !settings || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedEmail)) return false;
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "geofox-app-notification-" + message.id },
      body: JSON.stringify({
        from: settings.from, to: [verifiedEmail], reply_to: settings.replyTo,
        subject: "A new " + ticket.appName + " support reply is ready",
        text: "Your support request " + ticket.reference + " has a new reply.\n\nOpen My requests in NovaNook to read and reply securely:\nhttps://www.mynovanook.com/support.html\n\nThe conversation is available in the app even if this email arrives late. Reply inside the app to keep your conversation together.\n\nGEOFOX APPS LLC",
        tags: [{ name: "app", value: ticket.appSlug }, { name: "kind", value: "support-notification" }],
      }),
      signal: AbortSignal.timeout(12000), cache: "no-store",
    });
    if (!result.ok) return false;
    return typeof ((await result.json()) as { id?: unknown }).id === "string";
  } catch { return false; }
}
