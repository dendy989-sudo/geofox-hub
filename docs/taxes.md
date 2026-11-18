# Private Taxes workspace

Taxes lives at `/taxes`, alongside Finance in `/apps`. It uses the existing verified Hub-owner session and the explicit `finance_access` personal-workspace allowlist. It does not grant company staff access and does not share tax evidence with Alfred or company dashboards.

## Database and deployment

Apply `supabase/migrations/20261118163746_private_tax_workspace.sql` to the Geofox Hub project before serving the new routes. The migration is additive. It creates `tax_records`, an append-only `tax_audit`, owner-scoped service-only RPCs, indexes, and a private `tax-documents` bucket. Browser roles have no table or RPC access. A restrictive bucket policy prevents an unrelated permissive Storage policy from exposing tax originals. Existing Finance tables are not changed.

All server routes retain the existing authentication, active verified owner, personal allowlist and MFA checks. POST routes require the same origin, validate their data, and reserve rate-limit capacity. Every record change is version-checked and audited. Account, business, statement and rule references must belong to the same owner. Records are archived rather than physically deleted. Original statements supporting active transactions cannot be archived.

No personal names, balances, business records or filing claims are seeded by the migration. Years 2018 through 2026 are available in the UI; the database permits later years through 2100. Missing data remains unknown. User-provided business history can be privately entered after deployment.

## Core API

Responses use the existing `{ data: ... }` success / `{ error, code }` failure envelope, except the downloadable export.

- `GET /api/taxes?year=2020` returns all owner metadata, the complete selected year's transactions and adjustments, and the newest 100 audit summaries. The SQL snapshot is atomic and does not silently truncate ledger rows. Full original previews are omitted from dashboard snapshots.
- `POST /api/taxes` with `{action:"save",record:{id?,kind,tax_year,title,data,version?}}` creates or updates a validated record. A stable new UUID without version is idempotent for exactly the same payload. Existing edits require the current version. Source identities on imported transactions are preserved. Statement updates only expose notes/document type, not file provenance.
- `POST /api/taxes` with `{action:"archive",id,version}` archives a record while keeping its audit trail.
- `POST /api/taxes` with `{action:"apply_rule",ruleId,version,preview:true}` calculates eligible matches across every year/account without writing. It returns a count, year counts, skipped manual exceptions/conflicts, and a `preview_token`. Apply sends the same rule/version and token with `preview:false`; changed candidate records require a new preview. The batch is atomic.
- `POST /api/taxes` with `{action:"confirm_transactions",items:[{id,version}],deduction_percent?}` confirms up to 200 classifications at once. A separately supplied deduction percentage is allowed only for business expense categories and their reversals. Transfers, personal spending and income are not expense deductions.
- `GET /api/taxes/export?year=2020` downloads the complete selected-year evidence JSON, including full private audit before/after snapshots and source document hashes. It is not limited to the dashboard's recent history. Download original files separately for an offline evidence packet.

The shared typed model and editable fields are in `lib/taxes/types.ts` and `lib/taxes/validation.ts`.

## Statements and supporting documents

`POST /api/taxes/import` supports the following actions:

1. `prepare_upload`: `{year,account_id,file_name,mime_type,size_bytes,document_type?}`. Bank statements require an account. Other supported document types are return, notice, receipt, PPP, relief and other. The response contains a durable statement record and a signed upload URL. Upload the file directly with `PUT`, its content type and `x-upsert:false`. Originals never pass through the Vercel request body.
2. `verify_upload`: `{statement_id}`. Checks stored size and file signature, calculates the SHA-256 hash on the server, and marks the original uploaded. Files are limited to 20 MiB; supported formats are CSV, PDF, PNG, JPEG and WebP. The private path contains the authenticated owner and document UUID, not a supplied path.
3. `preview`: `{statement_id,ai_consent?,mapping?,force_mapping?}`. CSV is parsed deterministically. Mapping fields are `date`, `description`, and either a signed `amount` column or separate positive `debit`/`credit` columns. Optional `date_format` is `mdy`, `dmy` or `ymd`; `invert_amount` reverses the signed amount convention. `force_mapping:true` opens mapping even for recognized headers. Auto-detection failures offer mapping corrections. PDF/images require explicit AI consent and produce a saved review preview. Reopening a saved preview refreshes duplicate flags without another model call.
4. `commit`: `{statement_id,rows,acknowledge_unreconciled}`. The client returns the complete selected source rows. The server reconstructs them from its saved preview and rejects changed dates, descriptions or amounts. Empty selection is allowed only with explicit review acknowledgement, so an all-duplicate original can be retained without new transactions. The import and all audit entries commit atomically; retries with the same selection cannot create duplicates.
5. `download`: `{statement_id}` produces a private, short-lived signed original-file download.

Each original is hashed. Exact duplicate files for the same account are rejected before extraction. Transaction fingerprints include account, date, normalized description, exact signed amount and occurrence number; legitimate repeated same-day charges within a statement remain distinct. Possible overlaps with other originals are shown for review rather than silently removed. The commit rechecks overlaps while holding the owner transaction lock; a duplicate discovered after preview requires another review. An explicitly selected flagged repeat remains possible when the owner determines it is real.

One statement supports up to 2,000 transactions and a 3 MB structured preview. Oversized, malformed, mixed-year or incomplete extraction fails with an explanation; rows are not silently dropped. Credit-card reconciliation uses printed positive amounts owed: opening balance minus net money movement equals closing balance. Bank-account reconciliation uses opening plus net equals closing. Nonzero or unavailable balance checks require explicit review acknowledgement. A model claiming completeness is not a substitute for comparing the preview to the original.

## Remembered vendor rules

Rules are global to the private owner's accounts and years. Matching is case-normalized and uses whole-word phrases for contains matching; exact matching is also available. Manual overrides take precedence. Multiple matching rules create a review question instead of choosing arbitrarily.

A single approved rule can confirm a transaction's business/personal classification and category after the statement rows are reviewed. This is why a recurring league fee can go directly to the correct business across banks. Deduction eligibility is a separate decision; a rule does not approve a tax deduction across historical years. A suggested percentage may be remembered, but the deduction remains unconfirmed until reviewed.

## Reports and Schedule C

The book P&L includes reviewed business allocations. The Schedule C worksheet includes reviewed income and separately confirmed deductible expense amounts. Personal transactions, account transfers, loan principal, owner contributions/draws, IRS payments and relief records are excluded from ordinary business income/expenses. Expense refunds reduce the original category; returns and allowances reduce revenue rather than inflating expenses. Integer cents and symmetric percentage rounding make an exact refund cancel its original mixed allocation.

Categories have semantic keys with year-specific line mapping. In particular, Other expenses changes from line 27a in older forms to 27b in 2025/2026, and Other interest moves to 16c in 2026. Reports link to the relevant IRS form. The 2026 worksheet is marked for final-form review.

Business legal structure, reporting treatment, ownership share and per-year treatment overrides are tracked separately. Unknown ownership stays unknown. A jointly run spouse business is not automatically treated as one Schedule C. Partnership/corporate treatment and spouse allocation needs remain visible. Reports show the full business amount and do not automatically allocate schedules or calculate self-employment/income tax.

The year record also has per-business `schedule_c_details` for inventory/COGS inputs, vehicle mileage and evidence, participation, new-business and 1099 questions. These supporting fields do not automatically add expenses. A substantiated manual adjustment can record a reviewed calculation that is not already counted in transactions. The app does not calculate depreciation elections, vehicle deduction methods, home-office limits, credit eligibility, or final return liabilities.

IRS activity is a separate dated ledger. Opening balance snapshots replace older balance history without double-counting it. Only activity after the latest included snapshot changes that balance. Refunds, stimulus, advance child tax credits and PPP activity remain distinct. A payment by itself does not establish the complete IRS balance. Dependency information is recorded by tax year; it does not automatically claim a credit and no SSN field is present.

## AI assistant

The assistant uses the existing Vercel AI Gateway connection. `TAX_AI_MODEL` is an optional server-only override; the default `openai/gpt-6.2-sol` was verified in the live catalog during implementation. No new provider credentials are required when the project's Gateway OIDC authentication is available. Actual model readiness depends on the project's Gateway account and credits.

Both PDF/image extraction and chat require `ai_consent:true` on an authenticated request. A shared per-owner limit allows at most 6 model requests per minute and 60 per day. The assistant receives the selected year's records and reusable business/account/rule metadata, not other years' notes or company context. It sees at most 160 relevant transaction details per answer and explicitly reports that limit; full reviewed report totals and the selected year's IRS/relief ledger accompany them. Names/ages for saved dependents can be included; full dates of birth and bank identifiers are not necessary in the prompt. Original documents are only sent during a specifically requested extraction.

The model has no database, browsing, filing, payment or execution tools. It returns validated proposals for existing transaction classifications, vendor rules and explicitly stated year status/notes. It cannot change transaction amounts/dates, tax deductions, IRS money, ownership or dependent eligibility. New proposals receive stable UUIDs and existing proposals carry optimistic versions. Nothing is applied until the owner reviews it and invokes the normal save route. Messages and statements are treated as untrusted evidence; generated HTML is not executed. Chat history and proposals are private tax records.

## Verification and rollback

Meaningful regression coverage includes exact cent parsing, malformed CSV and dates, debit/credit conventions, legitimate repeats, year/owner separation, refunds and mixed allocations, version conflicts, storage restrictions, private grants, immutable audit, atomic import rollback, duplicate retry/overlap protection, selected-year AI scope and full audit export.

Run the project's `test:taxes`, typecheck and production build gates. Original statement/model tests require an actual owner session and an explicitly selected file; no real owner financial records are used as fixtures.

For an application rollback, redeploy the preceding app commit. Leave the additive private tables/bucket and originals intact, so no uploaded records are lost and the Taxes feature can be restored. Do not drop the tax tables as a routine rollback. The migration does not change existing company or Finance ledger records.
