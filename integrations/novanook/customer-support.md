# NovaNook support using the existing app account

Customers sign in to NovaNook as usual and use Help & Support / My requests.
Geofox staff use their separate staff account. No Geofox customer account, shared
customer password, new signing secret, or customer database copy is introduced.

## Activation order

1. Apply `supabase/migrations/20261103134124_customer_app_support.sql` in
   **Geofox**, after its earlier central migrations. Existing public tickets and
   staff notes are preserved; public tickets are never assigned to a customer.
2. Apply `integrations/novanook/20261103134054_geofox_hub_customer_identity.sql`
   in **NovaNook**. It checks the required Auth schema before creating its private
   identity RPC. It is independent of the reporting/moderation bridge and needs
   neither moderator membership nor a paid subscription.
3. Geofox needs its existing central credentials plus
   `NOVANOOK_SUPABASE_URL` and `NOVANOOK_SUPABASE_SECRET_KEY` (or
   `NOVANOOK_SUPABASE_SERVICE_ROLE_KEY`). Source keys remain server-only.
   No additional support secret or public environment variable is needed.
4. Deploy Geofox's customer API and staff inbox. Deploy NovaNook's support UI
   after the API is available. Native apps using bundled web assets need the
   corresponding app build/release to receive the UI.
5. With two controlled accounts, create and reply to a request in NovaNook,
   respond from the staff inbox, and verify the response appears only for the
   originating account. Check that private notes never appear in the app.

These are deployment requirements; committing this document does not establish
that any production migration, release, or email service is active.

## Identity and separation

The API accepts NovaNook's current access token in `Authorization: Bearer …`.
It verifies the exact token against the fixed source Auth service before reading
its claims. It checks issuer, subject, authenticated role/audience, expiry and
session UUID, then calls `geofox_hub_customer_identity` on every request.
That RPC requires a confirmed, nonanonymous, nondeleted, unbanned source account
and a retained session belonging to it, with no expired explicit `not_after`
deadline. Identity authorization is not cached.

Supabase can retain session rows while project-wide inactivity, time-box and
single-session settings await refresh/cleanup. This RPC does not guess those
settings. Session removal and explicit deadlines are checked at request time.
Source validation and the later Geofox write occur in different projects; a
sign-out racing with an already-authorized request cannot be made atomic here.

Ownership is **app slug plus verified source Auth UUID**. The immutable
`customer_owner_id` is never inferred from public-form IDs, emails or receipt
references. Customer message authors have a separate external identity field;
their UUIDs are not Geofox Auth users.

Central tables remain private with RLS and no anonymous/authenticated browser
grants. The server calls scoped service-only functions. Customer responses omit
contact addresses, staff names/IDs, private notes, assignment details, audit and
diagnostic data. Private notes and email attempts do not update customer-visible
activity timestamps.

## API contract

Base URL: `https://www.geofoxapps.com/api/customer/novanook/tickets`

Success: `{ "data": ... }`. Error:
`{ "error": "Friendly message", "code": "CODE" }`.
Use bearer authorization and `credentials: "omit"`. Staff cookies never
authorize these endpoints. Responses are private and not cached.

| Request | Input | Response data |
| --- | --- | --- |
| GET base | Optional limit 1–25 (default 20), cursor | items, nextCursor |
| POST base | subject, body, category, requestId | Ticket detail plus replayed |
| GET /:id | Optional messagesBefore cursor | Detail with latest 50 public messages, chronological |
| POST /:id/messages | body, requestId | message, ticketStatus, updatedAt, replayed |

A ticket contains `id`, `reference`, `appSlug`, `appName`, `subject`,
`category`, `status`, `createdAt`, and `updatedAt`. Detail adds
`messages` and `nextMessagesCursor`. A public message contains only `id`,
`body`, `author` (`customer` or `support`), and `createdAt`.

Use cursors exactly as returned; they preserve database microseconds. Lists use
creation time, newest first, so replies do not move rows between list pages.
Conversation pages are chronological; the cursor loads earlier messages.
Staff also receive the latest bounded page and can load earlier history.

Subjects: 3–180 characters on one line. Opening body: 10–12,000 characters.
Replies: 1–12,000 characters. Text only; no HTML or attachments.
Categories: general, account, billing, bug, safety, feedback.
Statuses: open, in_progress, waiting_customer, resolved, closed.
Customer replies reopen resolved/waiting_customer requests to open, preserve
in_progress, and reject closed requests with `TICKET_CLOSED`. A customer can
create a new request when an older request is closed.

Every create/reply requires a UUID `requestId`. Keep it for an unchanged retry
after a timeout. Change it for a different submission. An identical retry returns
the existing result with `replayed: true`, HTTP 200; a new write returns 201.
Changed content, operation or target with the same ID returns 409
`IDEMPOTENCY_CONFLICT`. Staff publication also has a retry UUID; replaying it
never automatically resends an email after an ambiguous provider result.

Submitted ownership/email/app/staff/priority/internal-note fields are rejected.
Missing, not-owned and wrong-app ticket lookups return the same 404
`TICKET_NOT_FOUND`.

Atomic limits allow five new tickets/account/hour and twenty/IP/15 minutes;
sixty replies/account/hour and 120/IP/15 minutes. Access checks have additional
120/account/minute and 180/IP/minute limits. Only keyed hashes of trusted
Vercel-supplied IPs are stored. Write replays do not consume another write budget.

CORS allows only `https://mynovanook.com`, `https://www.mynovanook.com`,
`capacitor://localhost`, and `https://localhost`. No wildcard preview domains,
arbitrary local ports, or cookie credentials are allowed. Native HTTP without
Origin still needs the same verified bearer identity.

## Replies, email and public fallback

**Publish reply in NovaNook** saves the public message without requiring email.
The optional notification checkbox uses a configured verified sender and the
source account's current confirmed email. It includes neither conversation text
nor the ticket subject. Delivery status is separate from message publication.

The public Geofox form remains available for lost access, account appeals,
deleted accounts and people without an account. It returns a receipt only.
These tickets remain email-assisted; matching an email or UUID does not import
them into My requests. Public email replies require a configured sender.
Incoming mailbox replies are not automatically imported. Attachments, live chat,
push notifications and public-ticket claiming are outside this release.

Review support-record retention with company privacy obligations. Source account
deletion prevents access once current validation fails, but does not
automatically purge the central support history. Reusing an email in a newly
created account does not inherit that history.

## Verification

`npm test` includes source identity eligibility/privilege checks, customer
Auth/CORS/input checks, and central ownership, public-claim isolation, private
message/timestamp, retry, rollback/rate-limit, status and pagination fixtures.
Upgrade coverage includes staff notes retained after staff Auth deletion.

PGlite uses one PostgreSQL connection. Retry fixtures check committed replay
results and atomic failures; they do not simulate independent concurrent
production connections. Advisory/row locks and unique constraints supply the
serialization mechanism. Complete a live smoke test with controlled source
and staff accounts after activation.
