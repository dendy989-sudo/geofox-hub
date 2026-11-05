# Geofox Finance

`/finance` is a private owner workspace for manually entered finances, with the Geofox Hub layout. Amounts use USD integer cents; “today” uses `America/Chicago`. Recording a payment or receipt updates the ledger; it does not move money. There is no bank sync, credit-score lookup, credit-report import, or creditor integration.

## Access and setup

Finance uses the **existing Geofox Supabase project** and existing staff sign-in. It is separate from the company accounting module in `/admin` and from NovaNook's database.

- Sign in at `/admin/login?next=/finance`. Access requires a verified, unbanned Auth user, an active `hub_staff` row with role `owner`, and an active `finance_access` row for the same user ID. Other staff roles and ordinary customer accounts do not qualify.
- Existing MFA rules apply: enrolled factors require a verified session, and `HUB_REQUIRE_MFA=true` requires owner enrollment. See the [Hub setup guide](../README.md#3-create-and-authorize-your-owner-account).
- The server reuses `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY`. The existing legacy anon/service-role alternatives are supported. There are no additional finance-specific credentials.

Apply the finance migrations after the existing Hub migrations, in this order:

1. [20261105164728_private_finance_dashboard.sql](../supabase/migrations/20261105164728_private_finance_dashboard.sql) creates the finance schema. Its allowlist bootstrap selects the already verified, active owner `janna@geofoxapps.com`; it does not create an Auth account, grant a Hub role, or admit every owner automatically.
2. [20261105170745_finance_access_service_readonly.sql](../supabase/migrations/20261105170745_finance_access_service_readonly.sql) removes inherited Supabase default privileges and grants `service_role` only `SELECT` on `finance_access`. Allowlist changes are administered through database migrations, not app writes.
3. [20261105175613_finance_custom_dates_vendors.sql](../supabase/migrations/20261105175613_finance_custom_dates_vendors.sql) adds custom repeating schedules, reusable vendors, optional vendor links on entries/series/plans, and the corresponding private API operations.

Both `/finance` and `/api/finance` enforce owner access. Requests use the server-verified user ID, and database functions recheck the allowlist and ownership. All finance tables enable RLS and deny direct access to `anon` and `authenticated`; only the server role can use the finance functions. The browser cannot update `finance_access`. The page also requests no search indexing. Public availability will require an intentional access-model change, not just a navigation link.

### Database inventory

All eleven app tables are in `public` with the `finance_` prefix:

| Table | Purpose |
| --- | --- |
| `finance_access` | Explicit owner allowlist |
| `finance_vendors` | Reusable company names, payment websites, notes, and archive status |
| `finance_months` | Saved opening balance for each owner/month |
| `finance_series` | Repeating bill and income definitions |
| `finance_plans` | Finite installment and payment-plan agreements |
| `finance_entries` | Individual bills, income, and generated occurrences/installments |
| `finance_payments` | Actual payment/receipt ledger, including reversed records |
| `finance_debts` | Credit-report and collection accounts, balances, offers, and source links |
| `finance_debt_history` | Debt changes and transfer/reversal history |
| `finance_spending` | Saved Live Money planning spending |
| `finance_entry_history` | Database audit of entry edits, moves, and status changes |

## Daily workflows

Choose a month in the header. Start by setting its **Starting balance** to the money available before the first day's transactions. An unset month starts at zero. **Continue from last month → Use this amount** copies the previous month's saved forecast ending balance, excluding Live Money scenarios; review it and save explicitly. Later edits to the previous month do not silently change an already saved opening balance.

| Page | Use it for |
| --- | --- |
| Overview | Original monthly commitments, projected balances, overdue bills, upcoming bills/income, installment balances, and collections |
| Live Money | A row for every day, daily income/bills/spending, and running ending balances; try changes and manage saved entries by date |
| Calendar | Bordered monthly schedule with income, bills, net, and ending balances; open a day to add, edit, move, or record an entry |
| Bills | Category totals, original-month versus planned-date views, monthly paid progress, and overdue/moved/paid/cancelled/collection/archive filters |
| Income | Expected income, recorded receipts, overdue income, and recurring-income controls |
| Payments | Finite payment plans, installment progress and schedules, and individual bills classified as installments or payment-plan payments |
| Vendors | Reusable companies, payment websites, linked bills/income, and manually recorded payment/receipt history |
| Credit & collections | Original/current creditors, current debt balances, offers, status, dates, notes, and change history |
| Reports | Saved cash-flow outlook, recorded receipts/payments, original commitments by category, plan progress, and exports |

### Original dates, planned dates, and actual payments

An entry retains its original due date and original amount after creation. **Move date** changes the planned payment date and adds a “Moved” indicator. Original-month totals continue to show what was originally owed, including obligations later cancelled or transferred. An active unpaid bill remains past due after its original due date even when postponed. Older outstanding bills remain visible in the overdue view; they enter a later month's forecast only when scheduled there.

Record a payment or receipt after it happens, using its actual date. Partial amounts are supported; future dates and overpayments are rejected. A fully paid bill triggers confetti. Reverse an incorrect payment from the entry's history; the original payment record is retained as reversed.

The saved daily forecast combines actual receipts/payments on their recorded dates with only the unpaid remainder on each active entry's planned date. It therefore does not subtract a fully paid bill again on its old scheduled date. Calendar and reports use this same saved forecast. Actual payment history remains counted after cancellation, archiving, or transfer.

### Spending and test changes

**Planning spending** is for everyday purchases and what-if amounts. It is saved separately and changes only Live Money's running balances. It does not create a bill, affect calendar/report totals, or become a recorded payment.

**Try a change** creates temporary bill/income scenarios that clear on reload. **Save across app** opens the full entry form; completing it creates the real bill/income and removes that test change. **Reset scenario** clears the selected month's planning spending and temporary changes while retaining saved bills, income, payments, and opening balance.

### Repeating entries

Bills and income can repeat weekly, every two weeks, monthly, yearly, or with **Custom dates**, with an optional end date. Loading finance materializes occurrences through at least the current month plus five months, or through a later selected month. Month-end dates clamp to valid calendar days.

Custom dates has two modes. **Choose days each month** selects any days 1–31, such as the 1st and 15th. Days beyond a shorter month's length use its final day, and overlapping dates create only one occurrence. The original due date must match a selected day after this month-end adjustment. **Choose specific calendar dates** creates a finite list of up to 240 dates. The original due date is automatically included as the first occurrence; additional dates must be on or after it and no later than an optional end date. Duplicate dates are removed. Reopen an occurrence to inspect its saved pattern or expand the full date list; editing an occurrence does not rewrite that pattern.

Editing, moving, paying, cancelling, or archiving an occurrence affects that occurrence only. **Pause recurring series** stops new occurrence generation; already generated entries stay in place. Resuming fills missing occurrences from the original schedule through the forecast horizon. To change future recurring terms, pause the old series, create a new one, and separately cancel already generated future entries that should no longer apply.

### Vendors and payment websites

Choose an optional vendor in **Add bill**, **Add income**, or the payment-plan editor. Reuse an existing company or choose **Add a new vendor** to enter its name and optional website. A website without a scheme receives `https://`; links accept HTTP(S) and open in a new tab. Saving the entry also saves a newly entered vendor for reuse. Change an existing vendor's name, website, or notes on **Vendors**, where the change applies to its linked records.

Vendor details show linked bills/income and the payments or receipts manually recorded against those entries, with all-history and selected-month views. Reversed payments remain visible but do not inflate paid totals. A plan's “already paid” opening amount does not create dated payment history. Opening a payment website does not send or record a payment; pay there and then record the actual payment in Finance.

Changing the vendor on one recurring occurrence affects only that occurrence. Changing a plan's vendor updates all its installments, including the grouping of their recorded history. **Archive vendor** hides it from new choices while preserving existing links, repeating schedules, and history; restore it to use it on new records. Names are unique within the account, including archived vendors.

### Plans, debt, and collections

Creating a plan on **Payments** generates a finite schedule of up to 240 installments, with a smaller final installment when necessary. “Already paid” contributes to agreement progress without inventing historical cash transactions. Original plan amounts/frequency remain fixed; edit its details or manage individual payment dates and payments. Simply choosing “Installment” or “Payment plan” in **Add bill** classifies that individual entry and makes it visible in Payments; it does not create a finite parent plan.

Plan progress counts actual payments plus the entered opening paid amount. Cancelled or transferred amounts do not count as paid. Cards distinguish the unpaid original agreement from the amount still actively scheduled. Cancelling a plan cancels its unpaid active installments; restoring it restores those cancelled by the plan, preserving individually cancelled items.

**Move to collections** requires a collector and confirmation. It transfers the unpaid amount, retains the source/payment history, and removes that amount from active bill forecasts. Transferring a plan excludes installments already transferred individually. This records the account's situation in the app; it does not contact a collector.

Debt offers are proposals: unexpired settlement offers show a potential reduced total, and monthly offers show potential commitments. They do not create payments or reduce the saved balance. When accepting an offer, create a repayment plan if useful and update the debt's current balance with a note as payments occur. These new plans and debt balances are not automatically linked. The source-transfer relationship does handle reversals: reversing a payment on a transferred source restores that amount to its debt.

`Closed`, `Charged off`, and a removal date do not erase a balance. Set the actual current balance explicitly; `Paid` requires zero. These are tracking statuses, not confirmation from a credit bureau or creditor.

### Archive versus cancel

**Archive** hides an entry from ordinary lists but preserves its financial effect, including any active unpaid forecast. **Cancel** removes its unpaid remainder from the active forecast, preserving original obligations and recorded payments. Restore cancelled entries when they should become payable again. Use the archive/status filters to find retained records.

## Exports and a future project move

Reports offers **Export month CSV** for the selected month's saved daily forecast and **Export all records** for a JSON snapshot of the app's materialized records, recurring definitions and custom dates, vendors, plans, debt/history, opening balances, and saved planning spending. Temporary test changes are excluded. JSON uses `schema_version: 2` and includes an export time; there is currently no import UI. It does not include Auth users, `finance_access`, or `finance_entry_history`, so use a database backup/export for a complete migration.

For a separate Supabase project, migrate all eleven tables, preserve IDs/relationships, cents, original dates, custom schedules, and history, and recreate the `finance_*` functions, indexes, constraints, RLS, and grants from all three migrations. Preserve or explicitly remap every `user_id` to the destination Auth account. The current authorization also depends on `hub_staff`, `hub_actor_can`, and the shared Hub session/context; those dependencies need an equivalent authorization design in a standalone app. The current Supabase environment variables are shared with the Hub, so moving finance alone also requires separating its connection/auth integration. Verify owner isolation and ledger totals before switching traffic.

## Development checks

Use Node.js 24 and install the locked dependencies with `npm ci`. See the [repository setup](../README.md#local-development-and-tests) for development environment configuration. Run:

```bash
npm run typecheck
npm run test:finance
npm test
npm run build
```

`npm run test:finance` runs `tests/finance-calculations.mjs`, `tests/finance-vendors.mjs`, and `supabase/tests/finance.test.mjs`; it is also included in `npm test`. These cover calculations, original/planned/paid distinctions, custom recurrence, vendor links/history and URL validation, partial payments and reversals, plan/collection accounting, actor isolation, table/RPC grants, and RLS. Database tests use isolated PGlite fixtures and do not connect to hosted Supabase. The existing `tests/workspace-finance.mjs` covers the separate company accounting module.
