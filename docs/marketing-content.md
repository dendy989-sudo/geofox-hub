# Marketing Content

Open `/admin#marketing/content`. Content stores private creative briefs, scripts, captions, files, and production notes separately from publishing posts. It uses the existing Marketing module and app/company access.

## Workflow

1. Create content or a reusable template. Copy a template into a separate draft.
2. Save a draft or work in progress; send the saved creative for review.
3. The owner approves an unchanged saved review. Approval identity and time are stamped by the server and database.
4. Prepare post creates one linked draft in Posts & drafts. Repeating the action returns the same post. Video/image formats require final media before handoff.
5. Set planned dates in the existing planner. Publishing is still a separate channel action; this feature does not enable automatic TikTok publishing, an AI worker, or a scheduling service.
6. Record publication through the linked post. Content shows Published and revisions start from a duplicate.

Editing approved creative clears approval. Internal feedback alone preserves it. Planner creative remains tied to its reviewed source; after reapproval, an unpublished draft can receive the updated creative. Source updates are blocked during delivery, and linked records are archived/cancelled rather than deleted.

## Deployment

Apply `supabase/migrations/20261118142513_marketing_content_library.sql` to the existing Geofox Hub database before deploying the frontend. It extends current private workspace RPCs; it does not introduce tables, grant browser access, or alter existing RLS. No content drafts or production media are committed to the public repository.

Checks: `npm run typecheck`, `npm run test:marketing`, `npm run test:workspace`, and `npm run build`. Focused SQL tests cover scoped permissions, owner approval, metadata spoofing, concurrent versions, private attachments, stale reviews, idempotent handoff, publication, and deletion guards.

## Rollback

Revert the UI/API commit and redeploy the prior version. Keep the additive RPC migration and saved content/media; earlier UI code ignores the new content kind. Do not drop records, remove storage objects, or restore older RPC definitions while a linked publishing attempt is in flight.
