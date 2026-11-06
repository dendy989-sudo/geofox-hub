# Alfred — Geofox AI Chief of Staff

## Release scope

Alfred is an owner-only, approval-required operations assistant in `/admin#alfred/command`. It is not an unattended company operator. The UI includes Command center, Approvals, Activity, Knowledge, and Controls. Departments are purpose-specific prompts over a shared, scoped evidence collector—not independent background employees.

Implemented: bounded investigations of saved tickets/errors/workspace records; structured reports with evidence; immutable proposals; owner-approved task creation, marketing-draft creation and ticket replies; knowledge versions; private run history; conservative budget reservations; and an optional daily briefing. No arbitrary SQL, shell commands, repository access, production deployment, refund, payment, tax filing, social publication, or generated media tools are exposed to the model.

## Activate

1. Apply `supabase/migrations/20261106135856_alfred_operations.sql` to **geofox-hub**, not NovaNook. It is additive and replayable; existing Hub functions remain unchanged except the opt-in reply adapter in application code.
2. Deploy the commit to the Geofox Hub Vercel project. The AI SDK uses `openai/gpt-5.4-mini` through Vercel AI Gateway. Enable project OIDC, or configure a server-only `AI_GATEWAY_API_KEY`. Account eligibility/credits must be verified with an actual successful run. Never store these credentials in knowledge entries.
3. Set a unique sensitive production `CRON_SECRET`. `vercel.json` schedules `/api/alfred/cron` daily at 13:00 UTC (07:00 CST / 08:00 CDT). This schedule does nothing until the owner enables Alfred and the daily briefing. It produces a private briefing and pending proposals, never automatic customer replies.
4. Sign in as the verified active company owner. Open Alfred → Controls, review the data-processing notice and your customer privacy requirements, choose budgets, and activate. Defaults: paused, $5 daily model allowance, $25 monthly, scheduled briefing off.
5. Add current, approved business guidance in Knowledge. Run an investigation. Inspect evidence and limitations, then review a proposed action. A successful model response verifies access at that time.

## Connections not completed by this release

- GoDaddy incoming email is not imported. A separately authenticated forwarding/inbound integration must map messages to tickets and verify ownership; inbound mail must never be treated as authenticated account-change authority.
- Email replies need `RESEND_API_KEY` and a verified `SUPPORT_FROM_EMAIL`. In-app verified ticket replies work without email. Provider acceptance is not guaranteed inbox delivery; uncertain sends are not automatically repeated.
- Marketing uses saved metrics. Direct social accounts, live analytics, platform-specific publishing permissions, automatic scheduling, creative rendering and external market research remain separate work.
- Business accounting analysis uses a **bounded sample**, not a complete reconciled ledger. Banking/store payout feeds, tax decisions and payments are not connected. The private household Finance tables are never read by Alfred.
- Engineering analyzes received errors and creates approved investigation tasks. It does not access source code or fix production. ChatGPT's GitHub connector is not a runtime credential granted to this application.

## Security and execution

All Alfred tables have RLS enabled and no browser-role privileges. Only server-side service access is permitted. Every RPC independently requires an active owner with a verified, non-banned, non-deleted account. API requests also use the existing Hub session/MFA checks and same-origin enforcement. Preview pages never call Alfred APIs.

The model receives no executable tools. Customer messages, knowledge and logs are data, not authority. Identifiers/secrets are redacted and fields minimized; imperfect redaction is disclosed. Attachments, private household finances, full profiles and credentials are excluded. Owner-entered requests can still contain personal data, so avoid entering it. Customer support text can contain personal information, including from younger users. Provider terms, notices and retention need owner review before activation. Private evidence/output retention is currently indefinite; a retention/deletion workflow is not included.

Runs are idempotent by request UUID and payload hash. A settings-row lock serializes budget reservations and limits concurrency to two active runs, with ten starts per five minutes. Each generation reserves 25 cents. Model catalog pricing is checked against ceilings before a bounded 60KB prompt and a maximum 3,500 output tokens, with no automatic SDK retries. Completed requests use a conservative cent-rounded token estimate; failed/uncertain requests retain the reservation. These are request guardrails, not invoices or caps on database/hosting/provider fees. Usage windows are UTC. No unlimited agent loops.

Proposals expire after seven days and are never editable through approval requests. Approval claims are atomic and one-shot. For support replies, a database transaction locks the ticket and verifies the exact body, app and captured update timestamp before insertion. Delivery attempts reuse the existing idempotent ticket/provider mechanism. Changed tickets require a new investigation. A failure or interruption leaves `needs_review`/`executing`, never a blind automatic resend. Inspect the existing record/provider before manually taking further action.

Pause stops new model generations and action starts. It cannot recall already submitted provider calls or messages. Scheduled authorization is revalidated against the recorded owner each run. Daily IDs are deterministic, preventing duplicate scheduled generations on retry.

## Validation

`npm run typecheck`, `npm run build`, `npm test`, and `npm run test:alfred`. Alfred SQL tests use PGlite with the existing real Hub/workspace/support migrations: owner/access denial, RLS, idempotency, rate/budget bounds, stale runs, cross-app confinement, action kind allowlist, one-shot approvals, pause/rejection, expiration, knowledge versions, exact reply bodies and changed-ticket rejection. `scripts/verify-alfred-ui.cjs` (requires an external Playwright installation, optionally selected using `PLAYWRIGHT_MODULE`) exercises the public preview at desktop and phone widths and assert zero private API calls.

## Rollback

Pause Alfred in Controls first; retain tables and audit records. Roll back to the previous application deployment if necessary. The additive migration does not change ordinary ticket, accounting or customer interfaces. Do not delete the budget/history tables as a routine rollback, and do not remove cron authentication. Disabling daily briefings or pausing is sufficient to stop new automatic generations.

## Verified release checks

On November 6, 2026: production build, TypeScript and complete repository test command passed, including 15 Alfred database/authorization tests. Chromium preview smoke checks passed at 1440px, 430px and 375px widths across all five Alfred sections, with no client errors, horizontal overflow or private API calls from preview. These are not a signed-in production end-to-end test or a verified model generation.

