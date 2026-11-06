# Company usage, credit and bills

Owner-only entry: `/admin#accounting/costs`. Household Finance is excluded. All costs APIs use the existing verified staff session and MFA checks, same-origin writes, owner authorization, strict inputs, bounded requests, and service-only private database tables. Read-only provider checks never generate text or purchase credits.

## Included

- Company/app-filtered full SQL aggregation of recorded USD paid and pending expenses for the chosen calendar month. No truncation to a 200-row page. Prepaid top-ups are cash payments, never added again to usage consumption.
- Service inventory: AI Gateway, Vercel, Supabase, GitHub, ISBNdb, Google Books, Resend, GoDaddy, Apple, Google Play and Codemagic; additional service/resource meters may be added. Inventory entries contain no assumed prices, limits, payments or renewals.
- AI Gateway live team-wide credit balance and cumulative consumption through existing project authentication. Provider cumulative deltas are labeled as observed since the first snapshot, not full-month invoices. No project allocation is invented.
- Existing NovaNook ISBNdb passive request telemetry. It excludes other usage of the provider account and requires the owner to enter the actual quota. No paid synthetic ISBN lookup.
- Other services remain manual until a provider adapter/credential or invoice import is implemented. Fresh dated readings, allowance and renewal fields are editable. Missing/stale data is explicit.
- Protected five-minute production cron and post-Alfred checks, with database lease and one-minute cooldown. No artificial successful monitor result is written when a complete check fails.
- Low-credit warning/critical/exhausted states, quota percentages, dated renewal alerts, seven-day runway warnings, and observed-spend thresholds. Defaults are configurable policies, not provider limits.
- Suggested refill amount based on at least 24 hours of comparable cumulative usage, using up to seven days. Suggested trigger covers seven days or the warning amount; suggested refill covers 30 days with a $25 minimum, rounded to $5. It is provisional, not a purchase or guarantee; confirm provider minimums and adjust for traffic growth.
- Hub-wide owner banner refreshes while the page is visible. Optional email digests use the existing verified Resend sender and the monitoring owner's verified email. A sender configuration flag is not delivery verification. Alert revisions are claimed once; uncertain sends are not automatically repeated. Provider acceptance is not inbox delivery.

## Activation

Apply the generated `company_cost_monitor` migration to Geofox Hub only. Enable `hub_cost_monitor` for a current verified owner after authorization. This is separate from Alfred's generation consent and emergency pause: cost observation should continue when AI generation is paused. `CRON_SECRET` is shared with the existing authenticated cron framework. No additional secret is exposed in the browser. Record user-confirmed financial transactions through the existing accounting RPC, never in public source migrations.

## Not a guarantee

Polling can be delayed or miss a very rapid spike. Provider dashboards and native spending alerts remain authoritative. If hosting itself stops, its cron cannot alert; the Hub displays a stale-monitor warning when opened. Email is unavailable until a verified sender is configured. Payments, bank feeds, complete provider invoices, automated tax accounting, social ad spend and app-store commissions are not automatically reconciled. Unconfigured sources are marked as gaps, not zero. Forecasts need history and may understate bursts. Snapshot storage adds modest database usage; no unlimited agent loop is involved.

## Tests and rollback

`npm run test:costs`, `npm run typecheck`, `npm test`, `npm run build`. Tests cover owner/RLS boundaries, scope isolation, non-duplicated cash totals, optimistic concurrency, lease/cooldown, alert mail claims, thresholds, stale snapshots, UTC quota periods, runway baselines and escaped report formatting. UI smoke checks verify desktop/phone layouts and scrollable navigation without visible scrollbars. Roll back application code if needed; keep additive tables and records. Disable the monitor row to stop native checks without altering provider billing.
