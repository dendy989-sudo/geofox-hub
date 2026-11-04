# Signed operational events

The hub receives trusted server events at `POST /api/ingest/{app-slug}`. This is not a browser analytics endpoint. Do not expose a signing secret to an app bundle, `NEXT_PUBLIC_*` variable, browser, or mobile client.

## Signing

For `novanook`, configure `NOVANOOK_HUB_INGEST_SECRET` in the Geofox Vercel project. Use an independent random value of at least 32 characters. Configure the matching `GEOFOX_HUB_INGEST_SECRET` and `GEOFOX_HUB_INGEST_URL` in NovaNook’s server environment. Each future app uses its own `{UPPERCASE_SLUG}_HUB_INGEST_SECRET` in Geofox; hyphens become underscores.

The sender serializes the event exactly once to JSON. Send `Content-Type: application/json`, `x-geofox-timestamp` (Unix seconds), and `x-geofox-signature` (hex HMAC-SHA256 of `timestamp + '.' + exactRequestBytes`). The receiver checks a five-minute window and compares signatures in constant time. It rejects bodies above 64 KB. Retries reuse the same `eventId`; the database deduplicates per app. Never sign an untrusted client body without validating it.

## Event shape

```json
{
  "eventId": "unique-stable-event-identifier",
  "kind": "error",
  "occurredAt": "2026-11-02T12:00:00Z",
  "customerId": null,
  "payload": {
    "code": "CATALOG_PROVIDER_UNAVAILABLE",
    "title": "Book provider request failed",
    "message": "The server could not complete a catalog provider request.",
    "route": "/api/books",
    "severity": "error",
    "source": "novanook-server",
    "fingerprint": "catalog-provider-unavailable"
  }
}
```

An optional customer UUID must come from the source server’s verified session or verified provider event. Do not accept a client-supplied UUID as proof of identity. Use a controlled error vocabulary and static messages; omit request bodies, headers, provider responses, email addresses, search terms, book titles, reading logs and journal text. The receiver adds defensive redaction before storage.

### Other kinds

- `metric`: payload `{metric, value, provider?}`. Allowed metrics: `search`, `book_added`, `isbn_call`, `reading_session`, `reading_minutes`. Counters are non-negative and integers except reading minutes. These are captured events from instrumentation time onward; they do not recreate historical usage.
- `payment`: payload `{verified:true, environment:"production", provider, transactionId, status, amountMinor, currency, product?}`. The trusted source adapter must authenticate and verify the provider event first. Supported providers: `apple`, `google`, `stripe`, `manual_verified`; statuses: `paid`, `refunded`, `revoked`, `pending`, `failed`. Paid amounts are non-negative; refunds are non-positive. Use actual minor currency units, not floating-point major units. Unknown amounts are null. Sandbox/missing environment events are rejected. Conflicting retries for the same provider transaction/status are rejected.

Billing adapters still need provider-specific handling for taxes, fees, renewal, partial refunds, transfers, chargebacks, currency and reconciliation. A signed event establishes the identity of the source backend, not that arbitrary monetary data is true. The first NovaNook reporter sends operational errors only; it does not invent a payment ledger.

## NovaNook source hooks

The initial source integration reports selected server failures in book catalog requests, subscription reconciliation and safety-alert delivery. It uses a bounded request and preserves the original application result if reporting is unavailable. Missing configuration is a no-op. Authentication/input rejection and ordinary quota limits are not promoted to application-error alerts.

Browser/native UI crashes, every Supabase provider log and all Vercel runtime logs are **not** automatically captured by those server hooks. Add a separately reviewed reporter for each additional source. Browser reporting should pass through its own authenticated, validated, rate-limited source backend; it must never receive this HMAC secret.

## Connection checks without test incidents

Apply the `telemetry_connection_checks` migration, deploy the NovaNook source endpoint, then deploy Geofox. The existing matching private settings above are sufficient; no new monitoring account or secret is needed. Both check runtimes require `VERCEL_ENV=production`, and NovaNook also rejects `BOOKNOOK_STAGING=true`. Preview deployments never initiate or accept production connection checks.

Opening or refreshing the live Overview or Operations panel checks the reporter when the previous attempt is more than five minutes old. **Check connection** on the Application error collection card requests another check. Its staff API is `POST /api/admin/operations/error-collection/check` with `{app:"novanook"}` and requires the existing same-origin staff session, `operations:read` capability and assigned app scope. The database permits only one new check per app per minute, including concurrent staff sessions. A page left open expires its Connected label after five minutes; a pending check refreshes only within its bounded window.

Geofox creates a random UUID challenge in its private `hub_telemetry_checks` table and sends `{challengeId}` as exact JSON bytes with `Content-Type: application/octet-stream` to the fixed `https://www.mynovanook.com/api/geofox-telemetry-check` endpoint. `x-geofox-signature` is HMAC-SHA256 of `timestamp + '.geofox-telemetry-check.v1.' + exactBody`; this purpose differs from event ingestion. NovaNook verifies the 60-second timestamp window using its existing sender secret and returns a signed `heartbeat` to the canonical ingest URL. Its payload is only `{source:"novanook-server",environment:"production",protocol:1}`, and `eventId` equals the challenge UUID.

The receiver requires the matching unexpired 30-second nonce and records acceptance using its own database clock. It returns HTTP 202 with `{data:{accepted:true,duplicate:false,checkId}}`. A duplicate never refreshes the original acceptance time. Unsolicited, mismatched and expired heartbeats are rejected. The initiating check reads the persisted outcome through the finish RPC; an HTTP 200 without its matching receipt cannot produce Connected. Accepted receipts win over lost responses or late failure results, and old results cannot overwrite a newer check.

Connection receipts never enter `hub_ingest_events`, `hub_errors`, `hub_error_events`, usage or payment tables. The table retains one bounded state row per app, with its last successful receipt, latest attempt and safe failure code. It is RLS-enabled with no client policies; its three invoker RPCs and table privileges are restricted to the service role. No customer or credential data is stored.

**Connected** confirms a recent signed delivery between the deployed backends. **Needs attention** describes the latest failed check; **Check again** means the evidence is over five minutes old. The last real error is displayed separately. Checks allow five seconds for source-to-hub delivery and eight seconds for the outer request; regular error hooks retain their 750 ms fail-soft deadline. A successful check does not guarantee every future error will arrive within that shorter budget or prove the application has no defects.

Test actual error handling only in an isolated database or staging setup explicitly configured for that purpose. The ordinary check button never creates a fake production incident. Keep signing keys out of logs and rotate them in both projects if exposed.
