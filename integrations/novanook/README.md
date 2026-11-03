# NovaNook integration

This bridge reads NovaNook's existing Supabase data from the Geofox server. It also supports the same bounded moderation actions as the NovaNook moderation page. It does not copy the customer database into Geofox, change subscriptions, delete accounts, or grant staff membership.

The source contract was inspected in `dendy989-sudo/Booknook`, `main` commit `8a6cb3ce3ba5d0de8c36a08fcccf61761699e995`. That establishes the checked code schema, not which migrations have actually been applied to a live Supabase project.

## Install

1. In the **NovaNook** Supabase project, verify that the existing migration sequence through `202611020005_billing_sync_limits.sql` is applied. Follow NovaNook's rollout guide if it is not. Do not replay old migrations over a newer schema.
2. Review and run `202611020006_geofox_bridge.sql` in that project's SQL Editor. It adds two private tables, two indexes, and service-only RPCs. Existing customer data is not rewritten. A missing prerequisite fails the whole transaction.
3. Set the **server-only** NovaNook Supabase URL and service-role secret in Geofox's deployment environment using the names in Geofox's `.env.example`. These are the NovaNook project credentials; Geofox's own authentication and ticket database use separate credentials. Never give the NovaNook secret a `NEXT_PUBLIC_` prefix or send it to a browser.
4. Redeploy Geofox and check its Integrations page. A successful RPC proves that the database bridge responds; it does not prove all NovaNook APIs, subscriptions, or alerts are healthy.
5. For moderation writes, verify your Geofox staff account has the required moderation capability and your separate NovaNook account is already an active, eligible moderator. Fill in the two account UUIDs in `link-moderator.sql` and run it in **NovaNook**. The link grants no membership. Queue viewing works before a link is created; actions fail with `moderator_link_required` until it exists.

The migration is stored here for review and installation. Merely deploying this GitHub repository does **not** execute it in Supabase.

## RPC contract

Only `service_role` can execute the public RPCs. Each also checks the JWT role internally. Every Geofox endpoint must independently authenticate staff, read current staff membership and app scope from the Geofox database, and check its capability before calling the bridge. A browser-supplied role, app label, actor UUID, or user metadata must never authorize access.

| RPC | Arguments | Important return fields |
| --- | --- | --- |
| `booknook_geofox_overview` | `p_days`: integer 1–90, default 30 | `appId`, `capturedAt`, `periodStart`, `periodEnd`, `users`, `usage`, `billing`, `operations`, `dailySignups`, `availability` |
| `booknook_geofox_customer` | `p_user_id`: NovaNook Auth UUID | `found`, `customer`, `usage`, `history`, `payments`, `paymentsReason`, `errorsAvailability`, `moderation`, `deletion`, `notes` |
| `booknook_geofox_moderation` | `p_status`: `open`, `reviewing`, `resolved`, `unresolved`, or `all`; `p_limit`: 1–100 | `reports`, `total`, `pendingReports`, `undeliveredAlerts` |
| `booknook_geofox_moderate` | `p_report_id`: bigint; `p_action`: action below; `p_note`: 1–1000 characters; `p_actor_id`: verified **Geofox** Auth UUID; `p_expected_version`: version from the latest report row | `ok`, `appId`, `reportId`, `status`, `action`, `auditId` |

Every response is labeled `appId: "novanook"`. Report IDs are returned as strings to avoid JavaScript bigint precision loss. A missing or deleted customer returns `found: false`; this is not a directory search endpoint. Queue rows include `reportedUserId`, `reporterId`, `targetType`, `contentId`, `category`, `reason`, recorded text `context`, `status`, `createdAt`, `resolution`, `resolvedAt`, `urgent`, `hasReportedImage`, and an optimistic `version`.

The server should render context as escaped text, not HTML. Images are not returned through this bridge. For explicit inspection of a reported image, open NovaNook's existing moderator page; its RPC verifies the image still matches the original reported fingerprint. Do not fetch arbitrary URLs from report context or send report contents to external AI services automatically.

### Overview data

```ts
type NovaNookOverview = {
  version: 1;
  appId: "novanook";
  capturedAt: string;
  periodDays: number;
  periodStart: string; // UTC date, inclusive
  periodEnd: string; // UTC date, today
  timezone: "UTC";
  users: {
    total: number; free: number; pro: number;
    adultFree: number; adultPro: number;
    teenFree: number; teenPro: number;
    unknownAgeFree: number; unknownAgePro: number;
    newInPeriod: number; activeInPeriod: number;
  };
  usage: {
    libraryBooks: number;
    searchReservationsAllTime: number;
    searchReservationsMonth: number;
    isbnReservationsToday: number;
    searchMonthStart: string;
    isbnDay: string;
  };
  billing: { revenue: null; currency: null; reason: string };
  operations: {
    openReports: number; reviewingReports: number;
    childSafetyReports: number; pendingAlerts: number;
    failedAlerts: number; pendingDeletions: number;
    blockedUntil: string | null;
  };
  dailySignups: { date: string; count: number }[];
  availability: Record<string, string>;
};
```

### What the figures actually mean

| Display | Existing source and exact definition | Limit |
| --- | --- | --- |
| Total users | Nondeleted `auth.users` rows | Current stored accounts; excludes accounts already deleted |
| Free / verified Pro | `booknook_entitlements.plan = 'pro'` with absent or future `pro_expires_at`; all other current accounts are Free | A verified entitlement is not proof of revenue; trial, promotion or other provider access may exist |
| Adult / teen / unknown | `booknook_age_eligibility`, evaluated with existing `booknook_is_adult(user_id)` | Uses the app's declared eligibility, including birthday transitions; unknown age remains a separate bucket |
| Tester preview | `booknook_plan_testers.preview`, shown separately in a customer record | Never counted as a verified Pro entitlement |
| Current saved books | Count of `booknook_library_books` | Not lifetime books added; deleting a book/account reduces it |
| Search reservations | Sum of `booknook_search_usage.used`, optionally for the current UTC calendar month | Uncached quota reservations, including an attempt that may later fail; excludes cached searches; not a daily or arbitrary-period series; deleted users lose their rows |
| ISBNdb reservations today | `isbndb_request_budget` row with `budget_key = 'provider'`, `daily_count` only if its `day` equals today in UTC | Budget reservations occur before the external call; no stored historical daily series or quota limit is available |
| Recent sign-ins | Current accounts with `auth.users.last_sign_in_at` inside the UTC period | Last Auth sign-in is not in-app activity, sessions, or daily active users |
| Daily signups | Current accounts grouped by Auth creation date, with zero-filled UTC days | It is not a complete historical signup ledger after account deletion |
| Reading sessions / minutes | Valid `booknook_library_books.data.readingLog` entries; uses saved integer seconds where available and otherwise rounded minutes × 60 | Current saved library only; manual logs included; no private titles, notes or logs are returned; extreme unsafe numeric totals return null |
| Outstanding moderation | `booknook_safety_reports.status` and category | An unresolved report is not a confirmed violation; child-safety category receives urgent sorting |
| Pending / failed safety alerts | Undelivered rows of `booknook_safety_alert_outbox`; failed subset has `last_error` | Pending is not automatically failure; internal delivery errors are not exposed verbatim |
| Deletion work | `booknook_deletion_requests.status` | Read-only progress; no deletion or evidence-purge action is included |
| Revenue / payment history | **Unavailable in the current source schema** | Existing `api/revenuecat-webhook.js` reconciles current entitlements and does not persist transactions. Null must not be displayed as $0 |
| Customer error history | **Not instrumented in the existing database** | The bridge returns an empty list with `errorsAvailability: 'not_instrumented'`; that does not mean no errors occurred |

The six adult/teen/unknown × Free/Pro buckets partition the total user count. Customer responses expose only `adult`, `teen`, or `unknown`, never birthdates or exact ages. Account history is a bounded list of recorded creation, latest sign-in, policy acceptances, latest subscription verification, and deletion request milestones. It is not a fabricated action history or payment timeline.

The UI must keep current-month search reservations separate from its selected 7/30/90-day signup chart. It must not interpolate missing search/revenue/error histories as zero or invent an uptime percentage from a successful database request.

## Moderation behavior and authority

| Action | Actual effect |
| --- | --- |
| `review` | Sets report to `reviewing`; saves the required note |
| `resolve` | Sets report to `resolved`; saves the required note |
| `hide` | Activates the hold for the reported target, then resolves the report |
| `restore` | Releases the hold for the reported target, then resolves the report |
| `restrict` | Activates a **profile social-content hold**, then resolves the report |
| `unrestrict` | Releases that profile hold, then resolves the report |

Label the final two actions **Restrict social access** and **Restore social access**. They do not ban sign-in, delete an account, cancel billing, or edit the customer's private library. When a report targets a profile, `hide`/`restore` also operate on its profile hold. For an avatar/cover image, a hold is tied to the exact reported image hash and does not silently apply to a replacement image.

The service checks the linked NovaNook account's current active moderator membership, verified email, adult eligibility, and absence of a deletion request. It rejects self-review using that linked account ID. Revoking NovaNook moderator membership immediately blocks future Geofox moderation writes even if the hub role still permits them.

Actions lock the report, compare a version containing its status/resolution and latest existing moderation action, update the existing holds/reports, and insert both the original NovaNook audit and a Geofox attribution row in one transaction. A stale version fails with SQLSTATE `40001` and changes nothing. The server must derive `p_actor_id` from its authenticated session; it must not accept an actor ID from a client request body. No Auth JWT claims are impersonated to call a user-scoped RPC.

Include `booknook_geofox_audit` in the company's operational-record retention review alongside NovaNook's existing moderation audit. Account deletion clears its NovaNook foreign-key identity where applicable; the bridge does not silently purge staff decisions or evidence.

## Local verification

`verify-bridge.mjs` runs the migration against an isolated in-memory PostgreSQL fixture using `@electric-sql/pglite`. It requires no Supabase URL, network connection, or real customer records. Install that test package outside the application and run:

```sh
PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite node integrations/novanook/verify-bridge.mjs
```

Checks cover anonymous/authenticated denial, internal-helper denial, current entitlement/age partitions, tester exclusion, deleted-user handling, UTC budget resets, null unavailable metrics, reading-session validation, exclusion of private content, moderator identity/eligibility/self-review checks, stale decisions, exact-image holds/restores, timezone-independent versions, immediate membership revocation, and atomic audit attribution. This fixture validates the bridge contract; it does not establish the state of a live project's migration ledger or external services.

## Next integrations

Use Geofox's authenticated/signed event ingress for new application errors and operational events. Instrument NovaNook at actual catch/failure points, preserve the customer UUID when known, and redact access tokens, email addresses, private reading text and request bodies before sending. Historical errors cannot be recovered from an empty telemetry table.

For revenue and a payment timeline, add a separately reviewed billing adapter that authenticates provider webhooks, deduplicates event IDs, distinguishes production from sandbox, verifies currency and monetary units, handles refunds/cancellations/transfers, and reconciles with provider financial records. A plan price multiplied by Pro accounts is not revenue. Provider events also are not automatically store payouts or net proceeds.

Provider health, Vercel deployment state, actual error telemetry, delivery failures and billing configuration should each retain their own evidence and last-checked time. A functioning bridge by itself should never turn every service indicator green.
