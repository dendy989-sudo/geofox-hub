# Geofox Hub

The company website and support hub foundation for **GEOFOX APPS LLC**.

## Included in this first deployment

- A responsive public company page featuring NovaNook and linking to its website.
- A support directory at `/support` with an optional real company contact email.
- A closed `/admin` landing page with no customer data or administrative powers.
- A small `/api/health` endpoint, metadata, favicon, robots file, and sitemap.
- Optional Supabase browser/server client helpers and an environment example.
- A Vercel-ready Next.js build that works without Supabase keys.

Ticket submission, staff sign-in, roles, app metrics, and error-monitoring integrations are **not implemented yet**. No database tables or production app data are modified by this deployment.

## Run locally

Use Node.js 24 LTS, then:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.example` to `.env.local` only when you need to configure the optional integrations. Real environment files are ignored by Git.

## Vercel

- Connect this repository to the `geofox-hub` Vercel project.
- Use the repository root and the Next.js framework. `vercel.json` supplies the framework and build/install commands.
- Track `main` for production deployments.
- Add `geofoxapps.com` and `www.geofoxapps.com` in the project's Domains settings. Use the exact DNS records shown by Vercel while preserving existing email records.

Optional environment variables:

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the separate Geofox Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable key |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | A real, monitored company email to show on `/support` |

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted as a fallback by the helper. No Supabase secret/service-role key is required by this starter. Never put privileged keys in `NEXT_PUBLIC_*` variables.

Environment changes require a fresh deployment. Configure Supabase's Auth Site URL and exact redirect URLs when the staff login is implemented.

## Continue developing

```bash
git pull --ff-only origin main
npm ci
npm run dev
```

Keep local changes committed or stashed before pulling. If the local folder has unrelated Git history, use a fresh clone rather than overwriting it.

## Next implementation stages

1. Configure staff authentication, session refresh, invite handling, and server-side authorization. The current Supabase helpers alone are not a complete authentication system.
2. Define per-app staff membership and database row-level security. Roles must be assigned by authorized staff, never from user-editable profile metadata.
3. Add ticket submission, ticket ownership, attachments, email delivery, and staff audit events.
4. Connect NovaNook and future apps using authenticated server-side integrations for limited operational data and monitoring.

## Verification

```bash
npm run build
npm run typecheck
```

Confirm `/`, `/support`, `/admin`, `/api/health`, and an unknown route behave as intended. The staff landing page is intentionally closed even when Supabase variables are configured.
