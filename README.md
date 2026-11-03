# Geofox Hub

The company website and private operations center for **GEOFOX APPS LLC**. NovaNook is the first registered app; ticket queues, staff access and review checklists are scoped by app from the start.

## What is implemented

| Area | Included |
| --- | --- |
| Public website | Geofox company identity, NovaNook showcase and app website links |
| Support | App-specific public requests, reference numbers, atomic rate limits, staff conversations, internal notes, priorities and status |
| Dashboard | All-app/per-app scope, real account/age/entitlement totals, retained books, current-month search reservations, today’s ISBNdb reservations, recorded payments and health checks |
| Customers | Exact NovaNook account UUID lookup, retained usage, subscription state, recorded account milestones, captured errors, tickets and received payment events |
| Errors | Redacted event grouping, per-customer occurrence history, triage state and a reviewable repair brief for ChatGPT |
| Moderation | Existing NovaNook reports, recorded report context, versioned decisions, content holds and social-sharing restrictions, with original source authorization and audit |
| Operations | Daily/weekly reviews, actual website/database/deployment checks, configuration visibility and staff audit history |
| Team | Explicit owner bootstrap; admin, support, moderator and analyst roles; assigned apps; password recovery; authenticator enrollment |

**Deploying the GitHub code does not apply SQL migrations or supply provider credentials.** Until those connections are installed, `/admin` explains the setup state, private APIs fail closed, and `/admin/preview` shows the interface with empty values. The preview makes no admin API calls and contains no customer data.

## First-time connection: six steps

Use **two separate Supabase projects**: Geofox holds staff/tickets/telemetry; NovaNook keeps its existing customer database. Do not run the Geofox migration in NovaNook.

### 1. Prepare the Geofox database

In the new **Geofox** Supabase project’s SQL Editor, run:

`supabase/migrations/202611030001_geofox_hub.sql`

It creates private `hub_*` tables and service-only functions, enables RLS, denies direct anonymous/authenticated browser access, and registers NovaNook. It does not create an owner automatically.

### 2. Add the Geofox keys to its Vercel project

Open Vercel → `geofox-hub` → Settings → Environment Variables. Set these for Production (and a separate development environment when needed):

| Variable | Which value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Geofox Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Geofox publishable key |
| `SUPABASE_SECRET_KEY` | Geofox server-only secret key; legacy `SUPABASE_SERVICE_ROLE_KEY` also works |
| `HUB_RATE_LIMIT_SALT` | Independent random secret of at least 32 characters |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Your real monitored support address, if you want it displayed publicly |

Never prefix a privileged key with `NEXT_PUBLIC_`. Do not put real keys in GitHub, a support message, or a chat. `.env.example` lists every supported variable without real credentials.

### 3. Create and authorize your owner account

In Geofox Supabase Auth:

1. Set **Site URL** to `https://www.geofoxapps.com`.
2. Allow exact redirect URLs `https://www.geofoxapps.com/auth/callback` and `https://www.geofoxapps.com/auth/callback?next=/admin/password`. Add equivalent local URLs only for local development. Avoid broad production wildcard redirects.
3. Configure your Auth email sender. Disable public signup; staff invitations are issued by the owner or Supabase administrator.
4. Create/invite your own company-email Auth user and verify that email. Set your password using the invitation or recovery flow. The callback supports default Supabase invitations as well as PKCE password-reset links.
5. Open `supabase/bootstrap_owner.sql`, replace its marked email placeholder with that exact verified company email, and run it in **Geofox**. This explicit step gives that existing account owner access. It rejects missing, unverified and banned accounts.
6. Redeploy Vercel after adding environment variables. Sign in at `/admin/login`, then open `/admin/security` to enroll your authenticator. After verifying the authenticator works, you can set `HUB_REQUIRE_MFA=true` and redeploy to require it for owners/admins.

Public signup and user-editable Auth metadata never grant staff roles. Existing verified staff accounts can be linked by their Geofox Auth UUID from Connections & team; new accounts can be invited there. Owner roles are deliberately not changed through the ordinary staff dialog.

### 4. Connect NovaNook’s existing account data

Follow `integrations/novanook/README.md`. In **NovaNook**, check the prerequisites, then run:

`integrations/novanook/202611020006_geofox_bridge.sql`

Set `NOVANOOK_SUPABASE_URL` and `NOVANOOK_SUPABASE_SECRET_KEY` (or the legacy `NOVANOOK_SUPABASE_SERVICE_ROLE_KEY`) in **Geofox’s Vercel environment**, then redeploy Geofox. Those are NovaNook’s credentials, not Geofox’s.

The bridge reads bounded summaries and exact customer records without copying the entire customer database. Moderation writes also require `integrations/novanook/link-moderator.sql`: map your Geofox staff UUID to your existing, eligible NovaNook moderator UUID in the NovaNook project. A mapping does not grant moderator membership. Source email/adult/moderator eligibility and self-review restrictions remain enforced.

### 5. Connect new errors, replies and deployment checks

These integrations are independent; missing ones stay visibly unavailable.

| Integration | Setup |
| --- | --- |
| NovaNook errors | Set a random `NOVANOOK_HUB_INGEST_SECRET` in Geofox. In NovaNook’s server environment set `GEOFOX_HUB_INGEST_URL=https://www.geofoxapps.com/api/ingest/novanook` and matching `GEOFOX_HUB_INGEST_SECRET`. Deploy the reviewed server reporter. See `integrations/telemetry/README.md`. |
| Support replies | Configure a verified Resend sending domain; set `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, and a real monitored `SUPPORT_REPLY_TO_EMAIL` in Geofox. Sending is explicitly initiated by staff; internal notes stay private. |
| Vercel status | Set `VERCEL_ACCESS_TOKEN`, `VERCEL_TEAM_ID` when applicable, `HUB_VERCEL_PROJECT_ID`, and `NOVANOOK_VERCEL_PROJECT_ID`. The token is used only server-side for deployment reads. Use the narrowest permissions available. |
| Payments | A verified provider adapter must send production-only payment events with transaction IDs, exact minor units, currency, signed refund values, and the correct trusted customer ID. No revenue is estimated from Pro counts. No historical payments are fabricated or automatically imported. |

Every environment change requires a new deployment. Stored configuration is distinct from a successful live check. Health checks run when the owner opens/refreshes the dashboard; this is not yet a background uptime-alerting service.

### 6. Verify the live setup

- Signed out, `/admin` should lead to staff sign-in or a connection explanation. `/api/admin/customers` must not return data.
- Sign in as the explicit owner. Confirm NovaNook’s **database bridge** indicator succeeds, with a current checked time.
- Use a real test-account UUID for customer lookup and compare its figures with NovaNook.
- Submit one controlled support request, then verify the ticket reference in the staff inbox. A public customer ID is an unverified claim, so verify identity before sharing account information.
- Send a reply only to a test address you control. `Accepted by email provider` confirms the sending API accepted it; it is not an inbox-delivery guarantee. If sending is unconfirmed, check the provider before creating another reply.
- Test moderation using a suitable non-sensitive test report, an eligible linked moderator and a required reason. Confirm the original NovaNook report and audit change as expected.
- Send a controlled signed error event and verify its group, customer association and repair brief. Do not test with real secrets, customer text or payment data.

## What each number means

- **Pro access** is an unexpired verified entitlement, potentially including trials or promotions; tester previews are excluded.
- **Adults, teens and unknown age** are separate groups. Birthdates are not sent to the hub.
- **Books** means books currently retained in customer libraries.
- **Search reservations** are uncached quota attempts in the current UTC month, including attempts that later fail. They do not establish successful or cached searches.
- **ISBNdb reservations** are today’s UTC budget reservations, not confirmed completed provider responses.
- **Signup history** reflects current accounts’ creation dates, excluding accounts already deleted.
- **Revenue** is received, verified production payment events less recorded refunds in one currency. It is not complete lifetime revenue, store payouts, taxes or net proceeds. Missing/mixed amounts remain unavailable.
- **Errors** are captured occurrences after instrumentation. An empty queue does not establish that an app has never had errors.
- **All-app account totals** count accounts, not unique people. Missing selected account sources make those combined totals unavailable.

The detailed NovaNook source mappings are in `integrations/novanook/README.md`.

## Daily use and present limits

Start at Overview, review new support and moderation requests, triage captured errors, and complete the app-specific daily checks in Operations. Weekly tasks cover backups, access, costs and release review. Checklist periods use UTC; displayed timestamps are labeled in the interface.

The hub is not a complete mirror of Supabase/Vercel consoles. Provider invoices, backup restore controls, raw runtime logs, store financial statements, incoming support-mailbox replies, reported image inspection, account deletion execution, and subscription cancellation remain in their existing provider/source workflows. Operations includes direct links and review reminders. The hub never claims those areas are healthy because a database summary worked.

Support attachments and a customer-facing ticket-login portal are not included. Incoming email replies currently arrive in your configured support mailbox; they are not imported automatically. The public form shows only a receipt reference, never a customer record or private conversation.

Repair briefs are deterministic, redacted troubleshooting prompts. They omit raw error messages, stack traces, ticket/report text, identities and payment details. They do not call OpenAI or execute fixes. Review before sharing; ask ChatGPT to inspect source, explain a change, and provide verification/rollback steps.

## Local development and tests

Use Node.js 24:

```bash
git pull --ff-only origin main
npm ci
npm run dev
```

Copy `.env.example` to ignored `.env.local` when connecting a development project. Avoid using production customer data for local UI testing. Keep existing local work committed or stashed before pulling; use a fresh clone if your local directory has unrelated history.

```bash
npm run typecheck
npm test
npm run build
```

Tests use isolated PostgreSQL via the development dependency PGlite. They never connect to production Supabase. They cover RLS and RPC grants, roles/app scope, owner protections, ticket limits, transactional writes, customer-specific error aggregation, signed ingress, payment deduplication/refunds/currencies, and NovaNook moderation authority/version checks.

## Deployment and rollback

Vercel tracks `main`, uses the repository root, Node 24, `npm ci`, and `npm run build`. Preserve the existing email DNS records when changing website domains.

A code rollback is available through Vercel’s previous deployment. Database migrations are additive and do not drop source customer data; reverting code does not undo a migration. Review schema changes separately, use the correct project, and check provider backups before any future destructive migration. Do not run test fixtures in a hosted SQL Editor.
