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
4. [20261105184742_finance_accounts_balances_goals.sql](../supabase/migrations/20261105184742_finance_accounts_balances_goals.sql) adds bank/card accounts, dated balance updates, transfers, savings goals/history, account attribution, payment methods, and bill-reminder settings. Existing records and payments remain Unassigned; methods default to Manual. Existing bills receive a three-day reminder unless subsequently changed.
5. [20261105201038_finance_debt_household_people.sql](../supabase/migrations/20261105201038_finance_debt_household_people.sql) adds optional household names to credit and collection records, validates them, and keeps assignment changes in debt history. Existing debts begin with no names; balances, dates, status, offers, and prior history remain unchanged.
6. [20261106012309_finance_tags_quarterly_history.sql](../supabase/migrations/20261106012309_finance_tags_quarterly_history.sql) adds reusable owner-scoped tags, tag associations on entries/series/plans, quarterly schedules, and custom date lists that can start before the initially chosen date. Existing records remain untagged; original obligations and recorded payments are preserved.

Both `/finance` and `/api/finance` enforce owner access. Requests use the server-verified user ID, and database functions recheck the allowlist and ownership. All finance tables enable RLS and deny direct access to `anon` and `authenticated`; only the server role can use the finance functions. The browser cannot update `finance_access`. The page also requests no search indexing. Public availability will require an intentional access-model change, not just a navigation link.

### Database inventory

All seventeen app tables are in `public` with the `finance_` prefix. The migrations also define eighteen `finance_*` functions, including internal validation/calculation helpers; direct client roles cannot call these functions:

| Table | Purpose |
| --- | --- |
| `finance_access` | Explicit owner allowlist |
| `finance_vendors` | Reusable company names, payment websites, notes, and archive status |
| `finance_tags` | Reusable owner-specific labels, case-insensitive unique names, and archive status |
| `finance_months` | Explicit saved opening balance for the Unassigned bucket in each owner/month |
| `finance_accounts` | Checking, savings, cash, and credit-card accounts; signed openings, optional last four digits, and archive status |
| `finance_balance_updates` | Start-of-day balance corrections for an account or Unassigned bucket on a date |
| `finance_transfers` | Planned, completed, or cancelled transfers between two tracked accounts |
| `finance_savings_goals` | Targets, earmarked allocations, dates, and persistent milestones for savings accounts |
| `finance_goal_history` | Savings allocation changes, notes, and archive/restore history |
| `finance_series` | Repeating bill and income definitions, including inherited tags |
| `finance_plans` | Finite installment and payment-plan agreements, including default tags |
| `finance_entries` | Individual bills, income, generated occurrences/installments, and their direct tag associations |
| `finance_payments` | Actual payment/receipt ledger, immutable account/method snapshots, and retained reversed records |
| `finance_debts` | Credit-report and collection accounts, responsible household names, balances, offers, and source links |
| `finance_debt_history` | Debt changes, previous/current household names, and transfer/reversal history |
| `finance_spending` | Saved Live Money planning spending, scoped to an account or Unassigned |
| `finance_entry_history` | Database audit of entry edits, moves, and status changes |

## Daily workflows

Choose a month in the header and, on finance-ledger pages, choose **All accounts**, **Unassigned**, or a named account. Existing records stay Unassigned until deliberately assigned. All accounts combines named accounts, signed credit-card balances, and Unassigned money; it is a combined tracked balance, not a measure of cash alone.

Add accounts in **Banks & cards** with a balance at the start of their opening date. Named accounts carry recorded transactions across months automatically. They do not carry an earlier month's unpaid forecast as if that money had actually moved. Unassigned preserves the original workflow: set **Starting balance** separately for each month; an unset Unassigned month starts at zero.

**Continue from last month → Use this amount** copies the selected account's previous saved forecast ending balance, excluding Live Money scenarios, into the form. Review it and save explicitly. For a named account this creates a dated balance update; for Unassigned it saves the month's opening, or updates an existing first-day balance correction. Later changes to a prior projection do not silently change that saved amount. Avoid counting the same opening money in both Unassigned and a newly added account.

| Page | Use it for |
| --- | --- |
| Overview | Original monthly commitments, account-scoped balances, overdue/upcoming bills and income, installments, savings, and collections |
| Live Money | A row for every day, daily income/bills/spending, and running ending balances; try changes and manage saved entries by date |
| Calendar | Monthly grid or daily list with income, bills, transfers, and ending balances; open a day to manage entries, transfers, or its starting balance |
| Bills | Category/tag totals, original/planned month views, monthly paid progress, payment-method filters, and overdue-day/moved/paid/cancelled/collection/archive status filters |
| Income | Expected income, recorded receipts, tag and income-method filters, overdue income, and recurring-income controls |
| Payments | Finite payment plans, installment progress and schedules, and individual bills classified as installments or payment-plan payments |
| Banks & cards | Account records, actual balances, month-end forecasts, dated balance history, archive controls, and account transfers |
| Savings | Savings-account balances, goal allocations and targets, earned milestones, allocation history, and archive/restore controls |
| Reminders | Upcoming and overdue planned bill dates, snooze controls, optional device alerts, and calendar reminder downloads |
| Vendors & tags | Reusable companies and payment websites, payment/receipt history, tag management, and grouped bill/income totals |
| Credit & collections | Original/current creditors, household person filters, shared debts, balances, offers, status, dates, notes, and change history |
| Reports | Saved cash-flow outlook, recorded receipts/payments, original commitments by category, plan progress, and exports |

### Original dates, planned dates, and actual payments

An entry retains its original due date and original amount after creation. **Move date** changes the planned payment date and adds a “Moved” indicator. Original-month totals continue to show what was originally owed, including obligations later cancelled or transferred. An active unpaid bill remains past due after its original due date even when postponed. Older outstanding bills remain visible in the overdue view; they enter a later month's forecast only when scheduled there.

Past-due bill labels show the number of whole calendar days since the **original due date**. A bill due today is zero days overdue; the following day is one day overdue. Partial payments, moving the planned date, and archiving do not reset this count. Fully paying, cancelling, or transferring the bill to collections stops its overdue-bill label. Counts use calendar dates, so daylight-saving changes do not add or remove a day.

Record a payment or receipt after it happens, using its actual date. Partial amounts are supported; future dates and overpayments are rejected. A fully paid bill triggers confetti. Reverse an incorrect payment from the entry's history; the original payment record is retained as reversed.

The saved daily forecast combines actual receipts/payments on their recorded dates with only the unpaid remainder on each active entry's planned date, account transfers, and dated balance resets. It therefore does not subtract a fully paid bill again on its old scheduled date. Calendar and reports use this same saved forecast. Actual payment history remains counted after cancellation, archiving, or transfer.

### Accounts, methods, and transaction history

In the bill/income editor, select a saved bank/card account or leave it Unassigned. Store only an account nickname, institution, and optional last four digits; a debit card belongs to its checking account. The method describes the expected transaction:

| Record | Available methods |
| --- | --- |
| Bill or installment | Manual, Autopay, Bank transfer, Debit card, Credit card, Cash, Check, Other |
| Income | Manual, Direct deposit, Bank transfer, Cash, Check, Card refund, Other |

Autopay and Direct deposit are descriptive labels. Finance does not initiate, synchronize, or automatically mark either transaction complete. When recording a payment/receipt, confirm the actual account and method, overriding the entry defaults if needed. The saved payment keeps its own immutable account/method snapshot. Later edits to the bill, recurring occurrence, or plan do not move historical payments between accounts. To correct a recorded payment, reverse it and enter the correct transaction.

Lists and unpaid forecasts follow each entry's assigned account. Actual receipt/payment totals follow transaction snapshots. Remaining debt and paid progress always consider every payment for the entry, including payments from other accounts. A plan card keeps its whole-agreement progress visible and labels its account-filtered monthly cash total and schedule. Choosing a payment/income method filters the records shown without redefining the account-wide summary metrics.

Changing an occurrence's account, method, or reminder affects only that occurrence. Changing a parent plan's corresponding default updates **active unpaid installments, including archived ones**. Paid, cancelled, and collection installments keep their prior defaults; unchanged parent fields preserve individual overrides. Account archiving prevents new assignments while retaining existing associations, forecasts, balances, and history. Archived accounts remain in All accounts totals.

Credit-card balances are signed: an amount owed is negative, while a positive balance is a credit. A bill paid on a tracked credit card reduces that card's balance. Moving money from checking to pay that card is an account transfer, so it does not count the same bill a second time. Credit limits are informational; they do not create spendable cash or fund savings goals.

### Dated balances and transfers

Use **Set balance** on a Live Money row, **Set starting balance** on a calendar day, or **Update balance** in Banks & cards. Choose the specific account and enter its balance **at the start of that day, before its listed transactions**. The amount replaces that account's running balance from that date; earlier days stay unchanged and subsequent days recalculate until the next balance update. It is not income or a bill. All accounts adds these independent account balances rather than overwriting a single combined total.

For example, a $1,000 starting balance followed by a $200 payment on the same date ends at $800. Entering a bank's $800 end-of-day balance as that day's starting balance would apply the payment again. Future-dated updates affect the forecast from their date and cannot fund today's savings goals. Reopen an update in balance history or the day's details to edit or remove it. Removing a correction restores the earlier balance calculation; the server protects transfer dates from falling before an account's tracking begins.

**Move money / Add transfer** records money between two distinct tracked accounts. Planned transfers affect forecasts; completed transfers affect recorded balances; cancelled transfers do neither. Transfers appear separately from income and bills and net to zero in All accounts. A future transfer cannot be marked completed. Recording a transfer does not instruct a bank to move money. Use an actual income receipt or a balance correction for funds arriving from outside the tracked accounts.

### Savings goals and milestones

Each goal belongs to a Savings account and has a target, allocated amount, start date, optional target date, and notes. An allocation earmarks existing savings; it does not make a deposit or increase the account's balance. Multiple active goals share the same account. Available funds are its **recorded balance through today minus the other active allocations**, with zero as the minimum budget for a new allocation. Planned income, planned transfers, scenarios, and future balance updates cannot fund a goal.

New or increased allocations and account changes must fit the available balance. A goal can start at zero even when the account is overallocated. If the recorded balance later falls, existing allocations remain visible with a warning; reducing or leaving an existing allocation unchanged stays possible. Reconcile the real balance, record an actual completed transfer, or reduce allocations to resolve the shortfall. Updating a bank balance does not automatically distribute money across goals.

Goal allocations can exceed their targets. Progress caps visually at 100%, while the full allocated amount remains reserved. Milestones at 25%, 50%, 75%, and 100% are saved when first reached and celebrated once. Lowering an allocation, raising the target, or archiving/restoring a goal does not erase earned milestones. The history retains allocation changes and notes.

A funded goal stays reserved until its allocation is reduced or it is archived. **Archive goal** releases the earmark without moving cash and keeps the goal's history; **Restore goal** rechecks the account type and available funds. Archived goals may be edited, but do not reserve money until restored. Start dates can be in the future; a target date must be on or after the start date. These dates are planning labels, not scheduled deposits.

### Spending and test changes

**Planning spending** is for everyday purchases and what-if amounts. It is saved separately and changes only Live Money's running balances. It does not create a bill, affect calendar/report totals, or become a recorded payment.

**Try a change** creates temporary bill/income scenarios that clear on reload. **Save across app** opens the full entry form; completing it creates the real bill/income and removes that test change. **Reset scenario** clears planning spending and temporary changes for the selected month and account scope. In All accounts it clears that month across accounts; in a named account or Unassigned it clears only that bucket. Saved bills, income, payments, transfers, and balance updates remain. Committing a scenario retains its selected account in the real-entry form.

### Repeating entries

Bills and income can repeat weekly, every two weeks, monthly, quarterly, yearly, or with **Custom dates**, with an optional end date. Quarterly means every three months from the original first date. Loading finance materializes occurrences through at least the current month plus five months, or through a later selected month. Month-end dates clamp to valid calendar days. Each occurrence is anchored to the original date: a quarterly schedule starting January 31 produces April 30, July 31, and October 31 without drifting permanently to the 30th.

Custom dates has two modes. **Choose days each month** selects any days 1–31, such as the 1st and 15th. Days beyond a shorter month's length use its final day, and overlapping dates create only one occurrence. The original due date must match a selected day after this month-end adjustment. **Choose specific calendar dates** creates a finite list of up to 240 dates. Dates may be in the past or earlier than the first date initially chosen; the earliest selected date becomes the new schedule's first occurrence. Dates must stay between 2000 and 2100 and no later than an optional end date. Duplicate dates are removed. Reopen an occurrence to inspect its saved pattern or expand the full date list; editing an existing occurrence does not rewrite its original due date or repeating pattern.

Adding an earlier historical schedule creates the corresponding expected bills or income. It does not invent historical payments or receipts. Record any amounts that actually happened, or cancel occurrences that no longer apply, so past obligations and current forecasts remain accurate.

Editing, moving, paying, cancelling, or archiving an occurrence affects that occurrence only. **Pause recurring series** stops new occurrence generation; already generated entries stay in place. Resuming fills missing occurrences from the original schedule through the forecast horizon. To change future recurring terms, pause the old series, create a new one, and separately cancel already generated future entries that should no longer apply.

### Vendors and payment websites

Choose an optional vendor in **Add bill**, **Add income**, or the payment-plan editor. Reuse an existing company or choose **Add a new vendor** to enter its name and optional website. A website without a scheme receives `https://`; links accept HTTP(S) and open in a new tab. Saving the entry also saves a newly entered vendor for reuse. Change an existing vendor's name, website, or notes on **Vendors & tags → Vendors**, where the change applies to its linked records.

Vendor details show linked bills/income and the payments or receipts manually recorded against those entries, with all-history and selected-month views. Reversed payments remain visible but do not inflate paid totals. A plan's “already paid” opening amount does not create dated payment history. Opening a payment website does not send or record a payment; pay there and then record the actual payment in Finance.

Changing the vendor on one recurring occurrence affects only that occurrence. Changing a plan's vendor updates all its installments, including the grouping of their recorded history. **Archive vendor** hides it from new choices while preserving existing links, repeating schedules, and history; restore it to use it on new records. Names are unique within the account, including archived vendors.

### Tags and grouped totals

Use tags to group bills and income across categories, vendors, and dates—for example, Household, Car, Medical, or a project name. Assign up to 20 tags in the bill, income, or plan editor. Tags are optional, and older records remain untagged. Tag names accept up to 60 characters; surrounding/repeated spaces are normalized, and names are unique without regard to case within the owner workspace, including archived tags. The explicit **Create tag** action saves the reusable tag immediately; selecting it on the current bill or income is saved with that form.

On **Bills** or **Income**, choose **All tags**, **Untagged**, or a saved tag. Tag selection applies to the page's grouped records and monthly totals; the account filter continues to apply independently. Remaining amounts always subtract every recorded payment on the entry, while actual paid/received totals follow each transaction's saved account. A record with several tags appears in each matching group at its full amount. All tags counts each record once. Do not add overlapping group totals together as a household total.

Open **Vendors & tags → Tags** to create, rename, archive, or restore tags and inspect their linked records. The tag manager covers all accounts. Its monthly summary separates original bill commitments, actual payments plus unpaid bills scheduled for the month, and actual receipts plus expected income scheduled for the month. Income minus bills is the group's monthly flow; it is not an account balance and excludes internal transfers and Live Money scenarios. Open and past-due bill totals are explicitly shown across all dates.

Tag details include paid, cancelled, archived, and collection-source records. Month view includes records with an original date, planned date, or recorded payment in that month. **All generated dates** expands the record list while the summary stays on the selected month. Actual unreversed payments remain in the totals after cancellation or transfer; inactive remaining amounts do not become forecast bills again. Renaming a tag changes its label everywhere. Changing an entry's tags changes how its history is grouped, without changing recorded money or dates.

An archived tag remains on existing records and stays available in filters while associated records exist. Restore it before assigning it to another record. Existing repeating schedules continue to pass their retained tags to newly generated occurrences, including an archived tag. Clearing the tags on one occurrence affects only that occurrence and does not restore tags from its parent schedule.

Changing a plan's tag set updates installments that still match the plan's previous tag set, including paid, cancelled, collection, and archived records. Installments with their own different tag selection keep that selection. Saving a plan without changing its tags does not overwrite individual choices. These label changes can regroup historical totals, but never change payment amounts, dates, accounts, or methods.

### Plans, debt, and collections

Creating a plan on **Payments** generates a finite schedule of up to 240 installments, with a smaller final installment when necessary. Plans can run weekly, every two weeks, monthly, or quarterly. “Already paid” contributes to agreement progress without inventing historical cash transactions. Original plan amounts/frequency remain fixed; edit its details or manage individual payment dates and payments. Simply choosing “Installment” or “Payment plan” in **Add bill** classifies that individual entry and makes it visible in Payments; it does not create a finite parent plan.

Plan progress counts actual payments plus the entered opening paid amount. Cancelled or transferred amounts do not count as paid. Cards distinguish the unpaid original agreement from the amount still actively scheduled. Cancelling a plan cancels its unpaid active installments; restoring it restores those cancelled by the plan, preserving individually cancelled items.

**Move to collections** requires a collector and confirmation. It transfers the unpaid amount, retains the source/payment history, and removes that amount from active bill forecasts. Transferring a plan excludes installments already transferred individually. This records the account's situation in the app; it does not contact a collector.

Debt offers are proposals: unexpired settlement offers show a potential reduced total, and monthly offers show potential commitments. They do not create payments or reduce the saved balance. When accepting an offer, create a repayment plan if useful and update the debt's current balance with a note as payments occur. These new plans and debt balances are not automatically linked. The source-transfer relationship does handle reversals: reversing a payment on a transferred source restores that amount to its debt.

`Closed`, `Charged off`, and a removal date do not erase a balance. Set the actual current balance explicitly; `Paid` requires zero. These are tracking statuses, not confirmation from a credit bureau or creditor.

### Household names and shared debts

In **Add credit or collection item**, **Manage debt**, or **Move to collections**, add one or more people responsible for the item. Choose a previously used name or enter a new one. Each debt accepts up to 20 distinct names, with up to 100 characters per name. Surrounding and repeated spaces are normalized; case-only duplicates become one name. A comma remains part of the name, so `Last, First` is one person. Remove every name to leave the debt unassigned. Names are organizational labels inside the private workspace; they do not create accounts or grant anyone access.

Use the **Person** menu on Credit & collections to show **All people**, **Unassigned debts**, or one saved name. Matching uses the complete name without regard to case; `Ann` does not also select `Anna`. Existing debt records without names remain in Unassigned debts. A shared item displays all assigned names and a Shared badge. Its full balance appears in each responsible person's view, while All people counts that debt only once. No balance is split into individual shares, and separate person totals should not be added together to find the household total.

The top summary describes every debt assigned to the selected person across dates, locations, and statuses. Location, status, and search filters refine the list and its displayed totals. Household views are independent of bank/card account selection. Editing names preserves the debt's original balance and records both previous and updated assignments in its change history. Bills or plans moved to collections carry the names entered in the transfer form; retrying the same transfer preserves the saved assignment and does not create another debt.

### Bill reminders, printing, and mobile use

Bills and plans default to a reminder three days before the planned payment date. Choose Off, the date itself, or a lead time in the editor. Income does not create bill reminders. Reminders use the **planned date**, while the original due date remains visible for a moved bill. Unpaid active archived bills still qualify; fully paid, cancelled, and collection items do not. Snoozing delays the reminder only and does not reschedule the bill.

An eligible reminder also shows days past the original due date. This label does not change the configured lead time, alert count, or snooze: moving an overdue bill well into the future may place it outside its reminder window until the new lead date. Use **Bills → Past due · all months** to see every currently overdue bill regardless of its future planned date or reminder setting.

The Reminders page and header badge cover all accounts and months relative to today. Optional browser alerts require an explicit device opt-in and browser permission. They run **while Finance is open**, use a general message without bill names or amounts, and are not background push or email delivery. To receive reminders when the app is closed, download the selected month's `.ics` file and import it into a calendar that allows its alerts. Events use 9 a.m. in the calendar's local time and each bill's lead time. This file is a snapshot: after paying or moving bills, update the imported events or replace the old import.

The print button opens the browser's print dialog for the current page, with page/month/account context and controls removed. Choose a printer or Save as PDF; expand schedule/history details first if they should appear. Hub pages also have a print action. On narrow screens, Live Money uses daily cards, Calendar offers a daily list, and record tables adapt or scroll within their panels. Navigation closes with Escape and retains keyboard focus within the open mobile menu.

### Archive versus cancel

**Archive** hides an entry from ordinary lists but preserves its financial effect, including any active unpaid forecast. **Cancel** removes its unpaid remainder from the active forecast, preserving original obligations and recorded payments. Restore cancelled entries when they should become payable again. Use the archive/status filters to find retained records.

## Exports and a future project move

Reports offers **Export month CSV** for the selected month/account saved daily forecast, including starting balances, dated adjustments, and transfer movement. **Export all accounts (JSON)** always includes all accounts and the app's materialized entries, payment snapshots, recurring/custom/quarterly definitions, vendors, tags and their entry/series/plan associations, plans, debt/history with responsible household names, openings and balance updates, transfers, savings goals/history/milestones, reminder settings, and saved planning spending. Temporary test changes and device-local notification preferences are excluded. JSON uses `schema_version: 3` and includes an export time; there is currently no import UI. It does not include Auth users, `finance_access`, or `finance_entry_history`, so use a database backup/export for a complete migration.

For a separate Supabase project, migrate all seventeen tables, preserve IDs/relationships, cents, signed account balances, original dates, custom/quarterly schedules, tag definitions and associations, payment account/method snapshots, household names, goal milestones, and history, and recreate the `finance_*` functions, indexes, constraints, RLS, and grants from all six migrations. Preserve or explicitly remap every `user_id` to the destination Auth account. The current authorization also depends on `hub_staff`, `hub_actor_can`, and the shared Hub session/context; those dependencies need an equivalent authorization design in a standalone app. The current Supabase environment variables are shared with the Hub, so moving finance alone also requires separating its connection/auth integration. Verify owner isolation and ledger totals before switching traffic.

## Development checks

Use Node.js 24 and install the locked dependencies with `npm ci`. See the [repository setup](../README.md#local-development-and-tests) for development environment configuration. Run:

```bash
npm run typecheck
npm run test:finance
npm test
npm run build
```

`npm run test:finance` runs `tests/finance-calculations.mjs`, `tests/finance-vendors.mjs`, `tests/finance-reminders.mjs`, `tests/finance-debt-people.mjs`, `tests/finance-tags.mjs`, and `supabase/tests/finance.test.mjs`; it is also included in `npm test`. These cover calculations and account-scoped forecasts, dated balance ordering, immutable payment attribution, transfer accounting, savings allocation limits and milestones, reminders/calendar exports, overdue-day arithmetic across leap years and daylight-saving boundaries, original/planned/paid distinctions, custom and quarterly recurrence, vendor links/history and URL validation, tag normalization and owner-scoped totals, household name validation and exact person filters, shared totals without double counting, partial payments and reversals, plan/collection accounting, actor isolation, table/RPC grants, and RLS. Database tests use isolated PGlite fixtures and do not connect to hosted Supabase. The existing `tests/workspace-finance.mjs` covers the separate company accounting module.
