import test from "node:test";
import assert from "node:assert/strict";
import { clearAcknowledgedReply, mergeLoadedReplyTarget, observeTicketReply } from "../components/admin/ticket-read-receipt.ts";

const ticketId = "10000000-0000-4000-8000-000000000001";
const replyId = "20000000-0000-4000-8000-000000000002";
const laterId = "20000000-0000-4000-8000-000000000003";
const replyAt = "2026-11-03T16:00:00.123456Z";
const snapshot = { ticketId, messageId: replyId };
const receipt = { ...snapshot, readThroughMessageId: replyId, readThroughCreatedAt: replyAt };
const unread = (overrides = {}) => ({ id: ticketId, customerReplyPending: true, customerReplyAt: replyAt, customerReplyMessageId: replyId, ...overrides });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// This fake browser drives the real observer and receipt merge logic; it never
// contacts production, renders private customer text, or sends a support reply.
function browser(options = {}) {
  const state = { visible: true, current: true, hidden: false, requests: [], acknowledgements: [], errors: [], observations: 0, disconnected: false };
  const listeners = new Set();
  const document = {
    visibilityState: options.visibilityState || "visible",
    addEventListener(name, listener) { assert.equal(name, "visibilitychange"); listeners.add(listener); },
    removeEventListener(name, listener) { assert.equal(name, "visibilitychange"); listeners.delete(listener); },
  };
  const target = { isConnected: true, ownerDocument: document, closest(selector) { assert.equal(selector, "[hidden]"); return state.hidden ? {} : null; } };
  let callback;
  const observer = {
    observe(element) { assert.equal(element, target); state.observations++; },
    unobserve(element) { assert.equal(element, target); },
    disconnect() { state.disconnected = true; },
  };
  const stop = observeTicketReply({
    target, snapshot,
    isVisible: () => state.visible,
    isCurrent: () => state.current,
    createObserver(handler) { callback = handler; return observer; },
    async acknowledge(read, signal) {
      state.requests.push({ read, signal });
      return options.acknowledge ? options.acknowledge(read, signal) : receipt;
    },
    onAcknowledged(read, saved) { state.acknowledgements.push({ read, saved }); options.onAcknowledged?.(read, saved); },
    onError(reason) { state.errors.push(reason); },
  });
  return {
    state, target, stop, listeners,
    intersect(overrides = {}) { callback([{ target, isIntersecting: true, intersectionRatio: 0.5, ...overrides }], observer); },
    visibility(value) { document.visibilityState = value; for (const listener of listeners) listener(); },
  };
}

test("opening a conversation alone does not acknowledge it; the actual message must intersect", async () => {
  const view = browser();
  await flush();
  assert.equal(view.state.requests.length, 0);
  view.intersect({ target: {} });
  view.intersect({ isIntersecting: false });
  view.intersect({ intersectionRatio: 0 });
  await flush();
  assert.equal(view.state.requests.length, 0);
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  assert.deepEqual(view.state.requests[0].read, snapshot);
  assert.equal(view.state.acknowledgements.length, 1);
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1, "one successful receipt per observed snapshot");
  view.stop();
});

test("a hidden document cannot mark a reply read and returning requires a fresh intersection", async () => {
  const view = browser({ visibilityState: "hidden" });
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 0);
  view.visibility("visible"); await flush();
  assert.equal(view.state.observations, 2);
  assert.equal(view.state.requests.length, 0, "a pre-hide intersection is not reused");
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  view.stop();
});

test("customer profile visibility, hidden ancestors and detached messages block acknowledgements", async () => {
  const view = browser();
  view.state.visible = false; view.intersect(); await flush();
  assert.equal(view.state.requests.length, 0);
  view.state.visible = true; view.state.hidden = true; view.intersect(); await flush();
  assert.equal(view.state.requests.length, 0, "a queued callback cannot read the hidden conversation");
  view.state.hidden = false; view.target.isConnected = false; view.intersect(); await flush();
  assert.equal(view.state.requests.length, 0);
  view.target.isConnected = true; view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  view.stop();
});

test("a callback for a superseded message snapshot cannot start a receipt", async () => {
  const view = browser();
  view.state.current = false;
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 0);
  view.stop();
});

test("leaving a conversation aborts pending work and ignores late responses and observer callbacks", async () => {
  const pending = deferred(), view = browser({ acknowledge: () => pending.promise });
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  view.stop();
  assert.equal(view.state.requests[0].signal.aborted, true);
  assert.equal(view.state.disconnected, true);
  assert.equal(view.listeners.size, 0);
  pending.resolve(receipt); view.intersect(); await flush();
  assert.equal(view.state.acknowledgements.length, 0);
  assert.equal(view.state.requests.length, 1);
});

test("the marker clears only after a matching receipt succeeds, preserving workflow and draft data", async () => {
  const pending = deferred();
  let ticket = unread({ status: "closed", priority: "high", draft: "Keep my draft." });
  const view = browser({ acknowledge: () => pending.promise, onAcknowledged: (read, saved) => { ticket = clearAcknowledgedReply(ticket, read, saved); } });
  view.intersect(); view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  assert.equal(ticket.customerReplyPending, true);
  pending.resolve(receipt); await flush();
  assert.equal(ticket.customerReplyPending, false);
  assert.equal(ticket.customerReplyAt, null);
  assert.equal(ticket.customerReplyMessageId, null);
  assert.equal(ticket.status, "closed"); assert.equal(ticket.priority, "high"); assert.equal(ticket.draft, "Keep my draft.");
  view.stop();
});

test("a newer reply that arrives during an acknowledgement remains unread", async () => {
  const pending = deferred();
  let ticket = unread();
  const view = browser({ acknowledge: () => pending.promise, onAcknowledged: (read, saved) => { ticket = clearAcknowledgedReply(ticket, read, saved); } });
  view.intersect(); await flush();
  ticket = unread({ customerReplyMessageId: laterId, customerReplyAt: "2026-11-03T16:01:00Z" });
  const newer = ticket;
  pending.resolve(receipt); await flush();
  assert.equal(ticket, newer);
  assert.equal(ticket.customerReplyPending, true);
  view.stop();
});

test("failed receipts retain unread state without a scroll retry loop, and a fresh visibility attempt can retry", async () => {
  let attempts = 0, ticket = unread();
  const view = browser({
    acknowledge: async () => { if (++attempts === 1) throw new Error("Network unavailable"); return receipt; },
    onAcknowledged: (read, saved) => { ticket = clearAcknowledgedReply(ticket, read, saved); },
  });
  view.intersect(); await flush();
  assert.equal(ticket.customerReplyPending, true);
  assert.equal(view.state.errors.length, 1);
  view.intersect(); await flush();
  assert.equal(view.state.requests.length, 1);
  view.visibility("hidden"); view.visibility("visible"); view.intersect(); await flush();
  assert.equal(view.state.requests.length, 2);
  assert.equal(ticket.customerReplyPending, false);
  view.stop();
});

test("a mismatched response cannot clear a marker", async () => {
  const badReceipt = { ...receipt, messageId: laterId }, ticket = unread();
  assert.equal(clearAcknowledgedReply(ticket, snapshot, badReceipt), ticket);
  assert.equal(clearAcknowledgedReply(ticket, { ...snapshot, ticketId: "another-ticket" }, receipt), ticket);
  const view = browser({ acknowledge: async () => badReceipt });
  view.intersect(); await flush();
  assert.equal(view.state.acknowledgements.length, 0);
  assert.equal(view.state.errors.length, 1);
  view.stop();
});

test("an older page can reveal the unread target only when its public message is actually loaded", () => {
  const ticket = unread({ customerReplyMessageId: null });
  const page = { ...unread(), messages: [{ id: replyId, internal: false }] };
  assert.equal(mergeLoadedReplyTarget(ticket, { ...page, messages: [] }), ticket);
  assert.equal(mergeLoadedReplyTarget(ticket, { ...page, messages: [{ id: replyId, internal: true }] }), ticket);
  assert.equal(mergeLoadedReplyTarget(ticket, page, ticket).customerReplyMessageId, replyId);
  assert.equal(mergeLoadedReplyTarget(ticket, { ...page, id: "another-ticket" }), ticket);
});

test("older-page metadata cannot overwrite a refreshed snapshot or an already acknowledged reply", () => {
  const requested = unread({ customerReplyMessageId: null });
  const page = { ...unread(), messages: [{ id: replyId, internal: false }] };
  const refreshed = { ...requested };
  assert.equal(mergeLoadedReplyTarget(refreshed, page, requested), refreshed, "even equal timestamps cannot replace a newer response");
  const newer = unread({ customerReplyMessageId: laterId });
  assert.equal(mergeLoadedReplyTarget(newer, page), newer, "a different known target wins even at the same timestamp");
  const read = unread({ customerReplyPending: false, customerReplyAt: null, customerReplyMessageId: null });
  assert.equal(mergeLoadedReplyTarget(read, page), read);
});

test("refresh keeps an already loaded older target only for the same unread reply metadata", () => {
  const latest = unread({ customerReplyMessageId: null });
  const loaded = { ...unread(), messages: [{ id: replyId, internal: false }] };
  assert.equal(mergeLoadedReplyTarget(latest, loaded).customerReplyMessageId, replyId);
  const newer = unread({ customerReplyMessageId: null, customerReplyAt: "2026-11-03T16:01:00Z" });
  assert.equal(mergeLoadedReplyTarget(newer, loaded), newer);
  assert.equal(mergeLoadedReplyTarget(latest, { ...loaded, messages: [] }), latest, "dropped message pages cannot supply a read target");
});
