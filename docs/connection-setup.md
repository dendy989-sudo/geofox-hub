# Connect Geofox's optional services

Geofox staff sign-in, the support database and NovaNook's account bridge are separate from email, hosting monitoring and payment reporting. A gray **Not verified** service badge means the hub has no successful measurement for that service; it does not by itself establish an outage or a missing provider key. **Configured** checks environment settings, not provider acceptance.

## Where settings belong

In Vercel, select the **booknook-development** team, open **geofox-hub**, then **Settings → Environment Variables**. Select **Production**. Store API keys and tokens as sensitive/secret variables. Do not prefix server credentials with `NEXT_PUBLIC_` or commit them to Git.

Save all needed changes and deploy again. Vercel only applies changed environment variables to new deployments. The **booknook** project is the separate NovaNook application; only variables identified as NovaNook settings below belong there.

## 1. Customer email

NovaNook customers use their existing app account for support. Staff can publish replies into the app without an email provider. Email is a separate optional notification channel for those conversations and the response channel for the public Geofox form. Incoming mailbox replies are not automatically imported into tickets.

1. Use the monitored GoDaddy alias `support@geofoxapps.com` for public support contact. Personal staff login addresses are not support contact details. Merely choosing an address in Resend does not create an inbox.
2. In Resend, add and verify a domain you own. A dedicated sending subdomain such as `notify.geofoxapps.com` can keep automated email configuration separate from existing company mail.
3. Add exactly the DNS records Resend provides at your authoritative DNS host. Preserve the existing company mailbox's MX records; receiving email at the root domain is not required for sending through Resend.
4. Create a **Sending access** API key restricted to that verified sending domain.
5. Add these Geofox production variables:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | The private Resend sending key |
| `SUPPORT_FROM_EMAIL` | `Geofox Support <support@notify.geofoxapps.com>` after the sending subdomain is verified; `support@geofoxapps.com` is also accepted if the root domain is verified |
| `SUPPORT_REPLY_TO_EMAIL` | If retained in hosting settings, use `support@geofoxapps.com`; the app always uses this alias for reply-to |

The app normalizes outgoing mail to the Geofox Support display name and permits only the support mailbox on the root or `notify` subdomain. It never substitutes a staff email address. Customer support and privacy contact details use `support@geofoxapps.com`; the website does not display an arbitrary `NEXT_PUBLIC_SUPPORT_EMAIL` value.

After deployment, use a ticket you control to check delivery. A provider accepting an outgoing message does not prove that it reached the recipient's inbox. For in-app tickets, the optional notification contains a generic prompt to return to NovaNook; the conversation remains in the app. It resolves the current verified source email rather than trusting a public form's email or a stale ticket snapshot.

## 2. Vercel deployment checks

The ChatGPT Vercel connector lets the assistant manage your projects. The deployed Geofox application needs its own server credential to make deployment-status requests.

1. Open Vercel's personal **Account Settings → Tokens**.
2. Create a descriptive token such as `Geofox deployment monitor`, with the narrowest available scope covering the **booknook-development** team and an appropriate expiration.
3. Save it in Geofox's production settings as `VERCEL_ACCESS_TOKEN`.
4. Confirm these nonsecret IDs exist: `VERCEL_TEAM_ID`, `HUB_VERCEL_PROJECT_ID`, `NOVANOOK_VERCEL_PROJECT_ID`.
5. Redeploy and refresh **Operations**.

Geofox uses the token only for read requests. A team-scoped personal token should not be assumed to be a read-only credential; its actual permissions come from Vercel. Keep it server-only. This check covers the latest production deployment, not complete function logs, cloud costs, invoices or uptime history.

## 3. ISBNdb

NovaNook's server uses `BOOKNOOK_ISBNDB_API_KEY` in the **booknook** project. Do not copy this secret into Geofox or its browser bundle.

The current bridge reads quota reservations and stored provider cooldowns. A reservation can precede a failed lookup, so it is not a completed ISBNdb call. The hub does not perform chargeable synthetic book lookups and does not yet have successful-response telemetry. Adding another API key will not turn this service badge green. A passive success/failure collector would be additional application work.

## 4. Subscription access and payment reporting

The existing NovaNook server adapter uses RevenueCat's API v1 to verify the `pro` entitlement. It authenticates incoming RevenueCat webhooks and then rereads current subscription state. That is distinct from recording a transaction ledger in Geofox.

If RevenueCat is the chosen provider, complete the store/product/entitlement setup in that account. Configure these **booknook** production settings when ready:

| Name | Purpose |
| --- | --- |
| `BOOKNOOK_REVENUECAT_SECRET_KEY` | Private API v1 secret for subscription verification |
| `BOOKNOOK_REVENUECAT_WEBHOOK_AUTH` | A strong secret matching the entire Authorization header configured on the RevenueCat webhook |
| `BOOKNOOK_REVENUECAT_ALLOW_SANDBOX` | `false` for production |
| `BOOKNOOK_REVENUECAT_WEBHOOK_ENVIRONMENT` | `PRODUCTION` |
| `BOOKNOOK_REVENUECAT_IOS_PUBLIC_KEY` | Public iOS SDK key, also needed in the native build configuration |
| `BOOKNOOK_REVENUECAT_ANDROID_PUBLIC_KEY` | Public Android SDK key, when using Android, also needed in its native build configuration |

The existing webhook endpoint is `https://www.mynovanook.com/api/revenuecat-webhook`. Configure the NovaNook app and production events in RevenueCat; keep store tests in the isolated test setup. The current code validates the exact configured Authorization header. A dashboard TEST event confirms endpoint delivery only and does not grant a subscription or record revenue.

**Remaining application work for revenue:** a verified transaction adapter must supply stable provider event/transaction identifiers, production environment, currency, actual amount, occurrence time, customer association, and refund handling. It must deduplicate retries and account for transfers and out-of-order events. The existing signed ingest receiver is not itself that adapter. Do not substitute a Pro-user count multiplied by a subscription price for revenue. Store fees, taxes, net proceeds and payouts also require their own reconciliation data.

## 5. Application errors

The source server reporter covers selected catalog, subscription and safety-notification failures. It sends controlled, redacted error codes to the hub with an app-specific signature. It is best effort; it is not a durable log drain or a complete native/browser crash reporter.

Geofox production settings:

```text
NOVANOOK_HUB_INGEST_SECRET=<private shared signing secret>
```

NovaNook **booknook** production settings:

```text
GEOFOX_HUB_INGEST_URL=https://www.geofoxapps.com/api/ingest/novanook
GEOFOX_HUB_INGEST_SECRET=<same private shared signing secret>
```

Both deployments must contain their current settings. The first accepted real error proves that delivery occurred at that time. No error events means there is no such evidence yet; it does not mean the app is failing or that all errors are being observed. Do not create fake production errors to make a badge turn green. A reporter heartbeat and complete native crash collection would be separate additions.

## Safe details to share when finishing setup

- The company managing DNS for `geofoxapps.com`.
- The company hosting your business mailbox, and your chosen public support address.
- Whether Resend already exists and which sending domain it has verified.
- Whether RevenueCat already exists, whether stores/products are connected, and whether paid subscriptions are live yet.
- The names of settings you saved and the project/environment where you saved them, without their secret values.

## Provider references

- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend API key permissions](https://resend.com/changelog/new-api-key-permissions)
- [Vercel access tokens](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token)
- [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks)
