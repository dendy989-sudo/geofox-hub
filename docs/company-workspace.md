# Geofox company workspace

Geofox Hub keeps the existing admin tools and adds Marketing, Tasks, Legal, Accounting, and Profile. The icon rail remains visible while the adjacent sidebar changes to the selected workspace. Sign out is in the bottom of the icon rail.

## Getting started

1. Sign in at `/admin` with an existing verified staff account.
2. Use the icon rail to choose a workspace. The scope selector switches between the company, an assigned app, and all permitted records.
3. Add a task, prepare a marketing post, create an obligation, or record a transaction. Records are saved in the Geofox database and remain available across sessions.
4. Open Profile to review account information and effective permissions. The owner can assign workspace access under Profile → Workspace access; staff invitations and app assignments remain under Admin → Connections & team.

### Tasks

Use the board, list, planner calendar, or completed view. Tasks support a due date, priority, notes, and a checklist. Daily, weekly, and monthly recurring tasks create their next occurrence when completed. Completion and next-task creation are one database operation, and retries do not create duplicate occurrences. Month-end dates clamp to the final day of the next month. The next date is based on the completed occurrence's due date, so overdue recurring work can remain overdue until reviewed.

### Marketing

Prepare content for Instagram, Facebook, TikTok, and X. Save captions, mentions, hashtags, media, separate covers, campaigns, and planned publication dates. The calendar shows channel icons. Feed previews use the posts and thumbnails recorded in Geofox, and are labeled as planning previews. Statistics and conversation records can be entered manually; the insights show sample sizes and distinguish unknown counts from zero.

Scheduled dates in this release are reminders inside the workspace. They do not start an automatic publishing job. Replies prepared in Social inbox must be sent on the network. A saved account handle does not connect a provider. The connection screen reports available capabilities explicitly. See [social connections](social-connections.md) for supported direct-publishing setup and platform requirements.

### Legal

Track filing dates, internal reviews, fees, agencies, applicability, and supporting documents. The optional starter checklist links to official sources and leaves unconfirmed filing dates and fees blank. Completing a recurring obligation offers an optional next occurrence with a date for the owner to review. See [company compliance](company-compliance.md) for source notes and limits. The register does not monitor changes in law, submit filings, make payments, or send external reminders.

### Accounting

Keep a manual USD cashbook with categories and receipts. Income and expenses use exact integer cents; owner contributions, owner draws, and transfers stay separate from operating cash results. Pending and void entries do not inflate paid totals. Export the filtered records to CSV for review. This version does not connect banks, reconcile balances, or prepare tax returns.

## Access rules

| Staff role | Tasks by default | Marketing, Legal, Accounting by default | Company records |
| --- | --- | --- | --- |
| Owner | Manage all | Manage all | Full access |
| Admin, support, moderator | Manage assigned apps | No access | Requires explicit module permission |
| Analyst | View assigned apps | No access | Requires explicit module permission |

The owner can override each non-owner's module permission to no access, view only, or view and manage. Explicit access applies to company records plus the person's assigned apps. Role-default task access applies only to assigned apps. Owner access cannot be downgraded through this screen. Existing admin capabilities continue to follow the existing staff roles.

Permissions are enforced by server routes and database functions. Browser clients have no direct grants on workspace tables or functions. Every request uses the verified staff session; a browser cannot choose another actor ID. Updates require the current record version, and conflicting edits return a refresh message. Record changes, access changes, and profile-name changes are audited. Deletion removes a record from active views using a soft-delete timestamp.

## Files

Attachments use the private `hub-workspace` bucket. Supported files are JPG, PNG, WebP, GIF, PDF, and marketing MP4/MOV media, up to 50 MB per file. Uploads are prepared for a specific module and company/app scope, then verified against storage metadata. A record cannot reuse a file from a different module or scope. Download and preview links expire after five minutes; access is checked before each new link is issued. Uploaded files are not exposed through a public bucket.

## Deployment

Apply `supabase/migrations/20261104151508_company_workspace.sql` to the **Geofox Hub** Supabase project before deploying the matching application code. This is additive and keeps the existing support and NovaNook bridge tables unchanged. Existing Geofox Supabase environment variables are reused. Social provider tokens are optional and must stay server-side; see the separate connection guide.

Run `npm test`, `npm run typecheck`, and `npm run build` before deployment. The workspace fixtures check permissions, app isolation, conflicts, recurrence, private attachments, and input validation. The public `/admin/preview` page contains no account or company records; it is only an interface preview. Authenticated APIs require the existing allowlisted staff account and existing MFA rules.
