import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { errorCollectionStatus, errorCollectionLabel, currentErrorCollectionStatus } from "../lib/integrations/error-collection-status.ts";
import { checkTelemetryConnection, sendTelemetryChallenge, TELEMETRY_CHECK_URL } from "../lib/integrations/telemetry-check.ts";

const now = Date.parse("2026-11-04T18:00:00Z");
const id = "10000000-0000-4000-8000-000000000001";
const secret = "isolated-test-only-0123456789abcdef-0123456789abcdef";
const at = offset => new Date(now + offset).toISOString();
const row = overrides => ({ app_slug: "novanook", challenge_id: id, outcome: "connected", started_at: at(-2000), expires_at: at(28000), accepted_at: at(-1000), last_success_at: at(-1000), latency_ms: 1000, ...overrides });
const status = (check, errorAt = null, options = {}) => errorCollectionStatus("novanook", check, errorAt, { now, ...options });

test("a recent accepted receipt is Connected with zero actual errors", () => {
  const value = status(row());
  assert.equal(value.status, "healthy");
  assert.equal(errorCollectionLabel(value.errorCollection.state), "Connected");
  assert.equal(value.checkedAt, at(-1000));
  assert.equal(value.errorCollection.lastErrorAt, null);
  assert.match(value.detail, /No application errors have been received/);
});

test("real errors remain independent from connection health", () => {
  const value = status(row(), at(-5000));
  assert.equal(value.status, "healthy");
  assert.equal(value.errorCollection.lastErrorAt, at(-5000));
  assert.equal(status(null, at(-5000)).status, "unknown", "a past error does not substitute for a current check");
});

test("configuration, an old receipt, or a future receipt never manufactures current health", () => {
  assert.equal(status(null).status, "unknown");
  for (const accepted_at of [at(-300001), at(1000)]) {
    const value = status(row({ accepted_at }));
    assert.equal(value.status, "unknown");
    assert.equal(value.checkedAt, accepted_at);
  }
  for (const options of [{ configured: false }, { production: false }, { unavailable: true }]) {
    assert.notEqual(status(row(), null, options).status, "healthy");
  }
  assert.equal(status(row(), null, { production: false }).errorCollection.canCheck, false);
});

test("pending and expired checks cannot remain silently healthy", () => {
  const pending = row({ outcome: "pending", accepted_at: null });
  assert.equal(status(pending).errorCollection.state, "checking");
  assert.equal(status({ ...pending, expires_at: at(-1) }).errorCollection.state, "needs_attention");
});

test("an open tab expires Connected and pending labels without inventing a new check", () => {
  const connected = status(row());
  const stale = currentErrorCollectionStatus(connected, now + 300000);
  assert.equal(stale.status, "unknown");
  assert.equal(stale.errorCollection.state, "stale");
  assert.equal(stale.checkedAt, connected.checkedAt);
  const pending = status(row({ outcome: "pending", accepted_at: null }));
  assert.equal(currentErrorCollectionStatus(pending, now + 30000).errorCollection.state, "needs_attention");
});

test("every failure is actionable, preserves last success, and has no remote diagnostic text", () => {
  for (const outcome of ["authentication", "source_not_configured", "source_unavailable", "delivery_failed", "invalid_response", "timeout"]) {
    const value = status(row({ outcome, accepted_at: null, last_success_at: at(-3600000) }));
    assert.equal(value.status, "degraded", outcome);
    assert.equal(value.errorCollection.state, "needs_attention");
    assert.equal(value.errorCollection.lastSuccessAt, at(-3600000));
    assert.ok(value.detail.length > 30);
  }
});

test("unsupported app adapters do not send checks or pretend connected", () => {
  const value = errorCollectionStatus("otherapp", row(), null, { now });
  assert.equal(value.status, "unknown");
  assert.equal(value.errorCollection.canCheck, false);
});

test("challenge authentication covers exact bytes, purpose, timestamp and fixed destination", async () => {
  let calls = 0;
  const result = await sendTelemetryChallenge({ secret, challengeId: id, now: () => now, fetcher: async (url, init) => {
    calls++;
    assert.equal(url, TELEMETRY_CHECK_URL);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["content-type"], "application/octet-stream");
    assert.deepEqual(JSON.parse(init.body), { challengeId: id });
    const timestamp = String(now / 1000);
    assert.equal(init.headers["x-geofox-timestamp"], timestamp);
    assert.equal(init.headers["x-geofox-signature"], createHmac("sha256", secret).update(`${timestamp}.geofox-telemetry-check.v1.${init.body}`).digest("hex"));
    return Response.json({ ok: true, challengeId: id });
  } });
  assert.equal(calls, 1);
  assert.equal(result, "delivery_failed", "HTTP success requires a separate persisted matching receipt");
});

test("source status and bounded safe response codes explain failures without exposing response text", async () => {
  for (const [http, body, expected] of [
    [401, { secret }, "authentication"], [403, {}, "authentication"], [404, {}, "source_unavailable"],
    [503, { code: "NOT_CONFIGURED", secret }, "source_not_configured"],
    [503, { code: "DELIVERY_FAILED", secret }, "delivery_failed"],
    [200, { ok: true, challengeId: "another-id", secret }, "invalid_response"],
  ]) {
    const result = await sendTelemetryChallenge({ secret, challengeId: id, fetcher: async () => Response.json(body, { status: http }) });
    assert.equal(result, expected);
    assert.equal(result.includes(secret), false);
  }
});

test("deadline includes uncooperative network and response-body reads", async () => {
  for (const fetcher of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const start = Date.now();
    assert.equal(await sendTelemetryChallenge({ secret, challengeId: id, fetcher, timeoutMs: 15 }), "timeout");
    assert.ok(Date.now() - start < 1000);
  }
});

test("oversized or malformed receipts cannot succeed", async () => {
  for (const response of [new Response("x".repeat(1025)), new Response("<html>not a receipt</html>")]) {
    assert.notEqual(await sendTelemetryChallenge({ secret, challengeId: id, fetcher: async () => response }), "connected");
  }
});

test("automatic checks reuse recent evidence without altering its timestamp", async () => {
  const saved = row();
  const result = await checkTelemetryConnection({ store: { read: async () => saved, begin: async () => { throw Error("should not begin"); } }, uuid: () => id, now: () => now, challenge: async () => { throw Error("should not send"); } });
  assert.equal(result, saved);
  assert.equal(result.accepted_at, at(-1000));
});

test("manual checks still honor the database cooldown and concurrent claim", async () => {
  const saved = row({ outcome: "pending", accepted_at: null });
  const result = await checkTelemetryConnection({ force: true, store: { read: async () => saved, begin: async () => ({ started: false, check: saved }) }, uuid: () => id, now: () => now, challenge: async () => { throw Error("should not send"); } });
  assert.equal(result, saved);
});

test("a source response cannot establish success without receiver evidence; real receipt wins a lost response", async () => {
  for (const delivered of [false, true]) {
    const result = await checkTelemetryConnection({
      force: true, now: () => now, uuid: () => id, challenge: async () => "timeout",
      store: {
        read: async () => null,
        begin: async challengeId => { assert.equal(challengeId, id); return { started: true, check: row({ outcome: "pending", accepted_at: null }) }; },
        finish: async (challengeId, outcome, latency) => {
          assert.equal(challengeId, id); assert.equal(outcome, "timeout"); assert.ok(latency >= 0 && latency <= 10000);
          return delivered ? row() : row({ outcome, accepted_at: null });
        },
      },
    });
    assert.equal(status(result).status, delivered ? "healthy" : "degraded");
  }
});
