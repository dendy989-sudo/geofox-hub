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

## First connection check

Send one controlled test event from the trusted backend using a test account you control. Confirm HTTP 202, confirm the group in Errors, resend the same `eventId` to verify `duplicate:true`, then confirm a different body with the old signature is rejected. Collection starts at this point; the absence of earlier events is not a health guarantee. Keep signing keys out of logs and rotate them in both projects if exposed.
