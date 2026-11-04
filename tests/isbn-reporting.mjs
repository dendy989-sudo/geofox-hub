import test from "node:test";
import assert from "node:assert/strict";
import { ISBN_HEALTH_MAX_AGE_MS, isbnCallsToday, isbnServiceStatus, normalizeIsbnReport } from "../lib/integrations/isbn-reporting.ts";

const now = Date.parse("2026-11-04T18:00:00Z");
const ago = milliseconds => new Date(now - milliseconds).toISOString();
const observation = overrides => ({ observedAt: ago(1000), operation: "detail", outcome: "success", httpStatus: 200, latencyMs: 213, ...overrides });
const counts = overrides => ({ date: "2026-11-04", requests: 0, successes: 0, notFound: 0, failures: 0, rateLimited: 0, avgLatencyMs: null, ...overrides });
function report(overrides = {}) {
  return { version: 1, appId: "novanook", provider: "isbndb", capturedAt: new Date(now).toISOString(), timezone: "UTC", collectedSince: ago(60_000), today: counts(), lastObservation: null, lastSuccessAt: null, lastFailure: null, daily: [counts()], ...overrides };
}
const health = (value, blockedUntil = null, at = now) => isbnServiceStatus("novanook", value, blockedUntil, "Reporting unavailable", at);

test("a connected collector without requests shows zero recorded usage and unknown provider health", () => {
  const data = normalizeIsbnReport(report());
  assert.ok(data);
  assert.equal(isbnCallsToday([data], now), 0);
  assert.equal(health(data).status, "unknown");
  assert.match(health(data).detail, /Waiting for the first/);
  assert.equal(health(data).checkedAt, null);
});

test("a missing report is unknown and does not become a misleading zero", () => {
  assert.equal(health(null).status, "unknown");
  assert.equal(isbnCallsToday([null], now), null);
  assert.equal(isbnCallsToday([], now), null);
  assert.equal(isbnCallsToday([report(), null], now), null);
});

test("successful and no-match responses both establish recent reachability with separate counters", () => {
  for (const [outcome, httpStatus] of [["success", 200], ["not_found", 404]]) {
    const latest = observation({ outcome, httpStatus });
    const data = normalizeIsbnReport(report({ today: counts({ requests: 1, successes: outcome === "success" ? 1 : 0, notFound: outcome === "not_found" ? 1 : 0, avgLatencyMs: 213 }), lastObservation: latest, lastSuccessAt: latest.observedAt }));
    assert.ok(data);
    const state = health(data);
    assert.equal(state.status, "healthy");
    assert.equal(state.checkedAt, latest.observedAt);
    assert.equal(state.latencyMs, 213);
    assert.equal(isbnCallsToday([data], now), 1);
  }
});

test("latest authentication, rate-limit, invalid response and transport failures are degraded", () => {
  for (const [outcome, httpStatus] of [["authentication", 401], ["authentication", 403], ["rate_limited", 429], ["unavailable", 503], ["invalid_response", 200], ["timeout", null], ["network_error", null]]) {
    const latest = observation({ outcome, httpStatus });
    const data = normalizeIsbnReport(report({ lastObservation: latest, lastFailure: latest, lastSuccessAt: ago(5000) }));
    assert.ok(data);
    assert.equal(health(data).status, "degraded", outcome);
    assert.equal(health(data).checkedAt, latest.observedAt);
  }
});

test("a later recovery is healthy while the last error stays visible", () => {
  const oldFailure = observation({ outcome: "unavailable", httpStatus: 503, observedAt: ago(5000) });
  const latest = observation();
  const data = normalizeIsbnReport(report({ lastObservation: latest, lastFailure: oldFailure, lastSuccessAt: latest.observedAt }));
  const state = health(data);
  assert.equal(state.status, "healthy");
  assert.deepEqual(state.isbn.lastFailure, oldFailure);
});

test("refreshing the dashboard cannot turn an old observation into a new health check", () => {
  const latest = observation({ observedAt: ago(ISBN_HEALTH_MAX_AGE_MS + 1) });
  const data = normalizeIsbnReport(report({ collectedSince: ago(ISBN_HEALTH_MAX_AGE_MS * 2), lastObservation: latest, lastSuccessAt: latest.observedAt }));
  const state = health(data);
  assert.equal(state.status, "unknown");
  assert.equal(state.checkedAt, latest.observedAt);
  assert.match(state.detail, /24 hours/);
  assert.equal(health({ ...data, capturedAt: new Date(now + 1000).toISOString() }).status, "unknown");
});

test("an active cooldown overrides observed health but an expired cooldown does not", () => {
  const latest = observation();
  const data = normalizeIsbnReport(report({ lastObservation: latest, lastSuccessAt: latest.observedAt }));
  assert.equal(health(data, ago(-60_000)).status, "degraded");
  assert.equal(health(null, ago(-60_000)).status, "degraded");
  assert.equal(health(data, ago(1000)).status, "healthy");
  assert.equal(health(data, "invalid").status, "healthy");
});

test("a future observation cannot establish healthy status", () => {
  const latest = observation({ observedAt: ago(-3600_000) });
  assert.equal(health(normalizeIsbnReport(report({ lastObservation: latest, lastSuccessAt: latest.observedAt }))).status, "unknown");
});

test("malformed summaries and inconsistent counters are rejected", () => {
  for (const value of [null, {}, report({ version: 2 }), report({ appId: "other" }), report({ provider: "google" }), report({ timezone: "local" }), report({ capturedAt: "invalid" }), report({ collectedSince: null }), report({ today: counts({ requests: 1 }) }), report({ today: counts({ requests: -1 }) }), report({ today: counts({ rateLimited: 1 }) }), report({ today: counts({ successes: 0.2 }) }), report({ today: counts({ date: "2026-11-03" }) }), report({ lastObservation: observation({ outcome: "success", httpStatus: 500 }) }), report({ lastObservation: observation({ outcome: "secret text" }) }), report({ lastObservation: observation({ latencyMs: 400_000 }) }), report({ lastFailure: observation() })]) {
    assert.equal(normalizeIsbnReport(value), null);
  }
});

test("only documented operational fields leave the normalizer", () => {
  const latest = observation({ isbn: "private", query: "private", headers: { Authorization: "private" } });
  const data = normalizeIsbnReport(report({ lastObservation: latest, lastSuccessAt: latest.observedAt, userId: "private", apiKey: "private", today: { ...counts(), extra: "private" } }));
  assert.ok(data);
  assert.doesNotMatch(JSON.stringify(data), /private|Authorization|apiKey|userId|query/);
});

test("daily history before collection started is not presented as known zero usage", () => {
  const data = normalizeIsbnReport(report({ daily: [counts({ date: "2026-11-03" }), counts()] }));
  assert.deepEqual(data.daily.map(day => day.date), ["2026-11-04"]);
});

test("today counts stop being current at the UTC date boundary", () => {
  const value = report();
  assert.equal(isbnCallsToday([value], now), 0);
  assert.equal(isbnCallsToday([value], Date.parse("2026-11-05T00:00:00Z")), null);
});
