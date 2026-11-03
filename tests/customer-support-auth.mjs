import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  CustomerSupportError, customerCreateInput, customerReplyInput, customerLimit,
  encodeCustomerCursor, decodeCustomerCursor,
} from "../lib/customer/validation.ts";

// Compile the actual small modules in memory; no production dependency or
// secret-containing environment is needed to exercise the authentication gates.
const require = createRequire(import.meta.url);
const validationUrl = new URL("../lib/customer/validation.ts", import.meta.url).href;
const nextServerUrl = pathToFileURL(require.resolve("next/server")).href;
async function compiledModule(relative, imports) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [specifier, value] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(value));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const { authenticateCustomer } = await import(await compiledModule("../lib/customer/auth-core.ts", { "./validation": validationUrl }));
const sharedHttpUrl = await compiledModule("../lib/security/http.ts", { "next/server": nextServerUrl });
const { assertCustomerOrigin, customerPreflight, customerJson, customerError } = await import(await compiledModule("../lib/customer/http.ts", {
  "./validation": validationUrl, "next/server": nextServerUrl, "@/lib/security/http": sharedHttpUrl,
}));
const id = "10000000-0000-4000-8000-000000000001";
const session = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const issuer = "https://fixed-source.supabase.co/auth/v1";
const now = Date.parse("2026-11-03T00:00:00Z");
const claims = { sub: id, session_id: session, iss: issuer, aud: "authenticated", role: "authenticated", iat: now / 1000 - 10, exp: now / 1000 + 600 };
const token = patch => "eyJhbGciOiJSUzI1NiJ9." + Buffer.from(JSON.stringify({ ...claims, ...patch })).toString("base64url") + ".test-signature";
const verifiedUser = { id, email: "old@example.test", email_confirmed_at: "2026-01-01", is_anonymous: false };
function source({ user = verifiedUser, error = null, identity = { id, email: "current@example.test", emailVerified: true } } = {}) {
  const calls = [];
  return {
    calls,
    async getUser(accessToken) { calls.push(["verified", accessToken]); return { user, error }; },
    async currentIdentity(userId, sessionId) { calls.push(["session", userId, sessionId]); return identity; },
  };
}
const rejectCode = (action, code) => assert.rejects(action, error => error instanceof CustomerSupportError && error.code === code);

test("only source-verified tokens reach current session validation and current email wins", async () => {
  const auth = source();
  assert.deepEqual(await authenticateCustomer(token(), issuer, auth, now), { id, email: "current@example.test", emailVerified: true });
  assert.deepEqual(auth.calls.map(call => call[0]), ["verified", "session"]);
  assert.deepEqual(auth.calls[1], ["session", id, session]);
  const forged = source({ user: null, error: { status: 401 } });
  await rejectCode(() => authenticateCustomer(token(), issuer, forged, now), "AUTH_REQUIRED");
  assert.equal(forged.calls.length, 1);
});

test("verified but wrong-project, wrong-subject, privileged, anonymous or expired tokens fail closed", async () => {
  const invalid = [
    { iss: "https://other-project.supabase.co/auth/v1" }, { sub: session }, { role: "service_role" },
    { aud: "other" }, { session_id: null }, { session_id: "not-a-uuid" }, { exp: now / 1000 },
    { iat: now / 1000 + 31 }, { is_anonymous: true }, { exp: "99999999999" }, { iat: null },
  ];
  for (const patch of invalid) {
    const auth = source();
    await rejectCode(() => authenticateCustomer(token(patch), issuer, auth, now), "AUTH_REQUIRED");
    assert.equal(auth.calls.some(call => call[0] === "session"), false);
  }
});

test("removed sessions, ineligible users, mismatched RPC identities and source outages fail safely", async () => {
  for (const identity of [null, { id: session, email: "current@example.test", emailVerified: true }, { id, email: "bad", emailVerified: true }, { id, email: "current@example.test", emailVerified: false }]) {
    await rejectCode(() => authenticateCustomer(token(), issuer, source({ identity }), now), "AUTH_REQUIRED");
  }
  await rejectCode(() => authenticateCustomer(token(), issuer, source({ user: { ...verifiedUser, email_confirmed_at: null } }), now), "EMAIL_NOT_VERIFIED");
  await rejectCode(() => authenticateCustomer(token(), issuer, source({ user: { ...verifiedUser, banned_until: "2027-01-01" } }), now), "ACCESS_DISABLED");
  await rejectCode(() => authenticateCustomer(token(), issuer, source({ user: { ...verifiedUser, deleted_at: "2026-01-01" } }), now), "ACCESS_DISABLED");
  await rejectCode(() => authenticateCustomer(token(), issuer, source({ user: { ...verifiedUser, is_anonymous: true } }), now), "AUTH_REQUIRED");
  for (const status of [0, 503]) await rejectCode(() => authenticateCustomer(token(), issuer, source({ user: null, error: { status } }), now), "SUPPORT_UNAVAILABLE");
});

test("customer payloads reject ownership/staff fields and require retry identity and bounded text", () => {
  const base = { requestId, subject: "Help please", body: "Please help with my account.", category: "account" };
  assert.deepEqual(customerCreateInput(base), base);
  for (const field of ["customerId", "email", "appSlug", "identityVerified", "priority", "assigneeId", "internal"]) {
    assert.throws(() => customerCreateInput({ ...base, [field]: "spoof" }), error => error.code === "INVALID_INPUT");
  }
  for (const body of ["", "x".repeat(12001), "bad\u0000text"]) assert.throws(() => customerReplyInput({ requestId, body }));
  assert.throws(() => customerReplyInput({ body: "Reply without nonce" }));
  assert.throws(() => customerCreateInput({ ...base, subject: "Line\nbreak" }));
  assert.equal(customerReplyInput({ requestId, body: " A\r\nreply " }).body, "A\nreply");
  assert.equal(customerLimit(null), 20);
  for (const limit of ["0", "26", "1000", "1e1", "-1"]) assert.throws(() => customerLimit(limit));
});

test("keyset cursors preserve database microseconds and reject malformed or injected values", () => {
  const cursor = { id, createdAt: "2026-11-03T12:00:00.123456+00:00" };
  assert.deepEqual(decodeCustomerCursor(encodeCustomerCursor(cursor)), cursor);
  for (const value of ["bad!", "a".repeat(201), Buffer.from(JSON.stringify({ ...cursor, createdAt: "now(),private" })).toString("base64url"), Buffer.from(JSON.stringify({ ...cursor, other: "field" })).toString("base64url")]) {
    assert.throws(() => decodeCustomerCursor(value), error => error.code === "INVALID_CURSOR");
  }
});

test("CORS permits only observed NovaNook web/native origins and never enables credential cookies", async () => {
  for (const origin of ["https://mynovanook.com", "https://www.mynovanook.com", "capacitor://localhost", "https://localhost"]) {
    const request = new Request("https://www.geofoxapps.com/api/customer/novanook/tickets", {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    assert.doesNotThrow(() => assertCustomerOrigin(request));
    const preflight = customerPreflight(request);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    const response = customerJson(request, { safe: true });
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const origin of ["https://evil.example", "https://mynovanook.com.evil.example", "http://localhost", "http://localhost:3000", "https://preview.vercel.app", "null"]) {
    const request = new Request("https://www.geofoxapps.com/api/customer/novanook/tickets", { headers: { Origin: origin } });
    assert.throws(() => assertCustomerOrigin(request), error => error.code === "ORIGIN_REJECTED");
    assert.equal(customerPreflight(request).status, 403);
    assert.equal(customerPreflight(request).headers.get("access-control-allow-origin"), null);
  }
  assert.doesNotThrow(() => assertCustomerOrigin(new Request("https://www.geofoxapps.com/api/customer/novanook/tickets")));
  const safe = customerError(new Request("https://www.geofoxapps.com/api/customer/novanook/tickets"), new Error("provider secret should not escape"));
  assert.equal(safe.status, 503);
  assert.equal(JSON.stringify(await safe.json()).includes("provider secret"), false);
});
