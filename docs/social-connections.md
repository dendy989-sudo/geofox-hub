# Geofox marketing workspace

## What is usable now

The marketing workspace stores work in the Geofox database under the company or a particular app. Existing workspace permissions control read/write access; the owner can use every scope. The release does not include social credentials.

| Area | Available in this release | Source / limitation |
| --- | --- | --- |
| Posts | Draft, plan a date/time, cancel a plan, record publication, delete a Geofox record | Planned dates are calendar reminders inside Geofox, not automatic publishing or push notifications. Deleting a Geofox record does not delete a network post. |
| Calendar | Monthly calendar, timezone selection, per-post social icons, due-post list | Shows saved records only. |
| Composer | Caption, hashtags, textual mentions, campaign, media uploads, optional cover, size guidance | No automatic cropping/transcoding, network-specific mention lookup, or automatic thumbnail application. Check the native network preview when publishing. |
| Grid | Phone preview built from saved published and planned thumbnails for each scope/network | No live account synchronization. Import existing posts manually as published records if they should appear. |
| Statistics | Latest manual metric snapshot for each post/network; source and capture time; observed posting-hour, format and hashtag comparisons | No live analytics sync or historical metric series. Missing counts remain unknown. Rankings use snapshots with all four engagement counts and show sample size; they are descriptive, not causal recommendations. |
| Inbox | Manually log comments/messages, prepare/copy replies, open the native conversation, mark replied/resolved | No live comment/DM ingestion or in-app sending. |
| Flags | Record a network warning, its source link and whether it was resolved | No automatic moderation/flag detection. |
| Accounts | Organize network handles and profile links by company/app; inspect supported publishing availability | Saving a profile is not an authenticated connection. |
| Publish now | Optional text-only Facebook Page and X publishing after server configuration and confirmation | No credentials are included. Media publishing, Instagram publishing and TikTok publishing are not enabled. |

### First-use workflow

1. Choose a company/app scope and create a draft in **Marketing → Posts**.
2. Add media, a cover where useful, caption, hashtags and mentions. Uploads remain in private workspace storage. Browser previews use authorized expiring URLs.
3. Select a timezone and scheduled date to place the post in **Calendar**. Review **Grid** to compare saved thumbnails.
4. When due, open the post, copy the caption and publish using the network's native composer. Apply media, cover and tags there. Record the published link and actual publication time in Geofox.
5. Use **Record performance** to enter the latest available counts. Leave unavailable metrics blank instead of entering zero. Repeat as needed to replace the latest snapshot.
6. Log significant comments/messages in **Inbox**, draft a response, send it on the network and mark the record responded. Record any network warnings against the post.

## Optional text publishing configuration

An owner with deployment administration access can configure **one publishing account per network per company/app scope** using the server-only `MARKETING_SOCIAL_ACCOUNTS` environment variable. This is an optional adapter, not a browser OAuth connection flow. Never put the value in a `NEXT_PUBLIC_*` variable, source code, a public document or a marketing record.

The value is a JSON array. `appSlug: null` means the Geofox company scope. An app entry must use that app's exact registered slug. Connections never fall back from one app to the company or another app.

```json
[
  {
    "appSlug": null,
    "platform": "facebook",
    "accountId": "123456789",
    "handle": "Geofox Apps",
    "accessToken": "<PAGE_ACCESS_TOKEN>",
    "apiVersion": "<SUPPORTED_GRAPH_VERSION>"
  },
  {
    "appSlug": "novanook",
    "platform": "x",
    "accountId": "987654321",
    "handle": "@your_app_handle",
    "accessToken": "<USER_CONTEXT_ACCESS_TOKEN>"
  }
]
```

Replace every placeholder with authorized values. `apiVersion` must be an explicit supported Graph API version in `vNN.N` form; select the version from the Meta app's currently supported configuration. IDs and tokens in this example are illustrative. An empty array or missing variable leaves direct publishing disabled. Updating environment variables requires deployment so the server receives the new value.

### Facebook Page

Use a **Page access token** for the intended Page with the publishing permissions required by Meta, including `pages_manage_posts` and relevant Page read access. A personal Facebook profile is not a supported destination. Meta's app mode, review, business verification and access-level requirements depend on who uses the app and which accounts it serves; follow the developer dashboard's requirements for the intended account.

Before each outbound write the server calls `GET /{version}/me?fields=id,name` and compares the token subject ID to the configured Page ID. A readable but different Page is insufficient. Publishing uses `POST /{version}/{page-id}/feed` with `message` only.

### X

Use a user-context access token for the exact account with the permissions needed to read the authenticated user and create a post. For OAuth 2.0 this includes `users.read`, `tweet.read` and `tweet.write`. The server verifies `GET /2/users/me`, then creates the text post with `POST /2/tweets`. X's API access and usage/billing requirements must already be satisfied by the owner's developer account. No billing setup or purchase is performed by Geofox.

This release does not implement token acquisition, refresh, revocation, media upload, analytics polling or DM endpoints. Tokens can expire; rotate or replace them through the authorized provider/deployment settings. Failed identity checks block publishing. The displayed handle is a configured label; the numeric account ID is checked against the provider.

### Publish confirmation and delivery safety

A publish button appears only for a configured account with the exact scope, a text-format post without media/cover, a selected supported network and marketing write access. The confirmation includes the platform, account handle/ID, scope and full caption. The request carries the account ID and record version; the server rejects stale versions, mismatched accounts or unauthorized scopes.

The server saves a `publishing` claim and the caption before making **one** external POST. Concurrent edits, deletion and repeated publishing are blocked while that claim is active. Successful responses store the provider's post ID, link and publication time. These verified fields remain protected while manually recorded performance counts can be updated. A definitive provider rejection is recorded as failed; an ambiguous timeout, network failure, 408, server error or unusable success response is recorded as uncertain and cannot be automatically retried.

If a process stops after the claim or the provider accepts a post but persistence fails, a record may remain `publishing` or `uncertain`. There is no automated reconciliation/recovery UI in this release. The owner must first verify the account's actual posts, then have a maintainer reconcile the stored delivery record with provider evidence. Do not create a duplicate as a recovery shortcut. Cancelled plans do not recall posts already sent.

## Provider capabilities and future integration

| Provider | Official capabilities relevant to a future integration | Constraints for Geofox |
| --- | --- | --- |
| Facebook | Page posts, media, insights, comments and Messenger APIs | Requires eligible Page assets, scopes, app configuration/review where applicable, webhook subscriptions and messaging-policy enforcement. This release implements text Page publishing only. |
| Instagram | Professional-account publishing, media/insights, comments and messaging through eligible Meta APIs | Account type/login product/scopes matter. Instagram Login and Facebook Login have different requirements and feature sets. Messaging has conversation/policy restrictions. No connector is implemented here. |
| TikTok | Content Posting API and approved display/video access | TikTok's Direct Post guidelines exclude utilities intended only to upload content to accounts owned/managed by the developer or their team. This internal company dashboard therefore uses native publishing; an approved scheduler partner would require its own supported integration and terms. Do not assume an audit will enable this use case. |
| X | User-context posts, media, metrics, replies and selected messaging APIs | Developer access, scopes, allowance/billing, API product availability and policies apply. This release implements text posting only. |

A later implementation should use a dedicated provider OAuth flow with state/PKCE where supported; encrypted server-side token storage and rotation; exact account-to-app assignments; media preparation per provider; verified webhooks with deduplication; a durable publish queue; and a delivery ledger with provider IDs and reconciliation. Scheduled writes must run through an authenticated worker and support cancellation before claiming the job. A cron endpoint or a browser timer alone is insufficient. Do not enable an automatic-publishing control until that worker, credentials and provider approvals are operational.

Analytics ingestion should retain metric definition, provider, capture time and per-post history. Recommendations need sufficient comparable samples and should distinguish organic from paid performance. Hashtag correlations alone do not establish audience fit. Live comments/messages must enforce provider reply windows and supported reply types. Automatic legal/policy monitoring and ad buying are outside this marketing release.

## Official references

These links describe provider APIs and policies, not a claim that Geofox has connected them:

- [Meta Pages API](https://developers.facebook.com/docs/pages-api/)
- [Meta Instagram API official collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta Messenger Platform official collection](https://www.postman.com/meta/messenger-platform-api/collection/iyp204x/messenger-platform-api)
- [TikTok content sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [TikTok Content Posting API](https://developers.tiktok.com/products/content-posting-api/)
- [X post creation](https://docs.x.com/x-api/posts/create-post)
- [X authenticated user lookup](https://docs.x.com/x-api/users/get-me)
- [X media upload](https://docs.x.com/x-api/media/upload-media)
- [X metrics](https://docs.x.com/x-api/fundamentals/metrics)
- [X direct messages](https://docs.x.com/x-api/direct-messages/manage/introduction)
- [X API pricing/access](https://docs.x.com/x-api/getting-started/pricing)
