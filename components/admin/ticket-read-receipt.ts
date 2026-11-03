import type { TicketReadReceipt } from "@/lib/hub/types";

export interface TicketReplySnapshot { ticketId: string; messageId: string; }
interface ReplyReadState {
  id: string;
  customerReplyPending: boolean;
  customerReplyAt: string | null;
  customerReplyMessageId: string | null;
}

function acknowledges(snapshot: TicketReplySnapshot, receipt: TicketReadReceipt) {
  return receipt.ticketId === snapshot.ticketId && receipt.messageId === snapshot.messageId
    && Boolean(receipt.readThroughMessageId) && Boolean(receipt.readThroughCreatedAt);
}

/** A receipt for an earlier reply must never clear a newer reply or change workflow state. */
export function clearAcknowledgedReply<T extends ReplyReadState>(ticket: T, snapshot: TicketReplySnapshot, receipt: TicketReadReceipt): T {
  if (!acknowledges(snapshot, receipt) || ticket.id !== snapshot.ticketId || !ticket.customerReplyPending
    || ticket.customerReplyMessageId !== snapshot.messageId) return ticket;
  return { ...ticket, customerReplyPending: false, customerReplyAt: null, customerReplyMessageId: null };
}

/** Older pages can reveal the unread message; metadata alone is never enough to mark it read. */
export function mergeLoadedReplyTarget<T extends ReplyReadState>(ticket: T, page: ReplyReadState & { messages: { id: string; internal: boolean }[] }, requestSnapshot?: T): T {
  if ((requestSnapshot && ticket !== requestSnapshot) || ticket.id !== page.id || !ticket.customerReplyPending || !page.customerReplyPending
    || !ticket.customerReplyAt || ticket.customerReplyAt !== page.customerReplyAt || !page.customerReplyMessageId
    || (ticket.customerReplyMessageId && ticket.customerReplyMessageId !== page.customerReplyMessageId)
    || !page.messages.some(message => message.id === page.customerReplyMessageId && !message.internal)) return ticket;
  return ticket.customerReplyMessageId === page.customerReplyMessageId ? ticket : { ...ticket, customerReplyMessageId: page.customerReplyMessageId };
}

type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
type ReplyObserver = Pick<IntersectionObserver, "observe" | "unobserve" | "disconnect">;
interface ReplyObservation {
  target: HTMLElement;
  snapshot: TicketReplySnapshot;
  isCurrent: () => boolean;
  isVisible: () => boolean;
  acknowledge: (snapshot: TicketReplySnapshot, signal: AbortSignal) => Promise<TicketReadReceipt>;
  onAcknowledged: (snapshot: TicketReplySnapshot, receipt: TicketReadReceipt) => void;
  onError?: (reason: unknown) => void;
  visibilityDocument?: VisibilityDocument;
  createObserver?: (callback: IntersectionObserverCallback) => ReplyObserver;
}

/** Observe the loaded message body, not the ticket header or a hidden customer-profile view. */
export function observeTicketReply(options: ReplyObservation): () => void {
  const { target, snapshot } = options;
  const visibilityDocument = options.visibilityDocument ?? target.ownerDocument;
  const createObserver = options.createObserver ?? (typeof IntersectionObserver === "undefined" ? null
    : (callback: IntersectionObserverCallback) => new IntersectionObserver(callback, { threshold: 0.01 }));
  // If visibility cannot be established, keep the unread marker.
  if (!createObserver) return () => {};
  const controller = new AbortController();
  let stopped = false, intersecting = false, pending = false, complete = false, failed = false;

  async function acknowledgeVisibleReply() {
    if (stopped || pending || complete || failed || !intersecting || visibilityDocument.visibilityState !== "visible"
      || !options.isVisible() || !options.isCurrent() || !target.isConnected || target.closest("[hidden]")) return;
    pending = true;
    try {
      const receipt = await options.acknowledge(snapshot, controller.signal);
      if (stopped || controller.signal.aborted) return;
      if (!acknowledges(snapshot, receipt)) throw new Error("The read receipt did not match this reply.");
      complete = true;
      options.onAcknowledged(snapshot, receipt);
    } catch (reason) {
      if (!stopped && !controller.signal.aborted) { failed = true; options.onError?.(reason); }
    } finally { pending = false; }
  }

  const observer = createObserver(entries => {
    if (stopped) return;
    const entry = entries.findLast(item => item.target === target);
    if (!entry) return;
    intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
    void acknowledgeVisibleReply();
  });
  function visibilityChanged() {
    // Require a fresh intersection after returning to the tab, not a stale pre-hide observation.
    intersecting = false;
    if (!stopped && !complete && visibilityDocument.visibilityState === "visible") {
      failed = false;
      observer.unobserve(target);
      observer.observe(target);
    }
  }
  visibilityDocument.addEventListener("visibilitychange", visibilityChanged);
  observer.observe(target);
  return () => {
    stopped = true;
    controller.abort();
    observer.disconnect();
    visibilityDocument.removeEventListener("visibilitychange", visibilityChanged);
  };
}
