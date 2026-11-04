# Geofox support email setup

Geofox already sends staff-written customer replies through Resend. GoDaddy / Microsoft 365 continues to receive mail addressed to `support@geofoxapps.com`.

## What this connection enables

- Public inquiries submitted at `/support` are saved in the Geofox support inbox. Submission displays a reference; it does not send an automatic receipt or staff-alert email.
- A staff member's **Customer reply** on a public inquiry is emailed to the submitter. Internal notes are never emailed.
- Replies to account-linked NovaNook tickets remain available in the app without email. An optional email notification links the customer back to their ticket page and does not include the conversation text.
- Customers who reply to an email reach the support mailbox. Incoming email is not imported into Geofox tickets and does not set the ticket's customer-reply indicator.

## 1. Confirm the receiving alias

In GoDaddy's **Email & Office Dashboard → Admin → Email aliases**, confirm that `support@geofoxapps.com` points to the mailbox that staff monitor. If the alias already exists, keep it. Send a message from another account you control and confirm it arrives.

Reference: [GoDaddy email aliases](https://www.godaddy.com/en-uk/help/what-is-an-email-alias-9019).

## 2. Verify a sending domain in Resend

In [Resend Domains](https://resend.com/domains), add `notify.geofoxapps.com` for **Sending**. Leave **Receiving** off. The sending subdomain separates application email from the existing Microsoft 365 mailbox. It does not require another mailbox purchase.

Add the exact DNS records shown in Resend's **Records** tab to GoDaddy's DNS settings for `geofoxapps.com`. Resend also offers **Auto Configure** for GoDaddy; review its requested changes before authorizing it.

For manual setup:

1. Open GoDaddy's DNS settings for `geofoxapps.com` and select **Add New Record**.
2. Copy each record's type, name, value, and priority (if present) from Resend.
3. In GoDaddy's **Name** field, omit the trailing `.geofoxapps.com`. For example, use `send.notify` only if Resend supplied `send.notify.geofoxapps.com`. Copy record values exactly.
4. Preserve the existing Microsoft 365 root-domain MX, SPF, and DKIM records, plus the website's records. Do not enable Resend Receiving or replace the root MX.
5. Return to Resend and check verification. Continue when the domain is verified for sending.

Do not assume a fixed list of three DNS records. Resend may supply CNAME sending records for newer domains instead of the older MX/TXT pair. Use the records issued to this domain. If a requested CNAME name already has records, select another return-path name in Resend rather than removing a record whose purpose is unknown.

References: [Resend GoDaddy setup](https://resend.com/docs/guides/dns/godaddy), [verified domains](https://resend.com/docs/dashboard/domains/introduction), [avoiding MX conflicts](https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records).

## 3. Create a sending API key

In [Resend API keys](https://resend.com/api-keys), create a key named `Geofox support production`. Choose **Sending access** and restrict it to `notify.geofoxapps.com`. Copy the key directly into Vercel; do not put it in a ticket, chat, source file, or screenshot.

Reference: [Resend API keys](https://resend.com/docs/create-an-api-key).

## 4. Configure the Geofox Vercel project

In Vercel, select team **booknook-development**, project **geofox-hub**, then **Environment Variables**. Set the following for **Production**:

| Name | Value | Storage |
| --- | --- | --- |
| `RESEND_API_KEY` | The private Resend sending key | Secret |
| `SUPPORT_FROM_EMAIL` | `support@notify.geofoxapps.com` | Config |

The settings belong to `geofox-hub`, not the separate `booknook` project. A GoDaddy or Microsoft 365 password is not used by this connection. Use separate test settings if a preview environment needs email.

Geofox forces the sender display name to **Geofox Support** and sets **Reply-To** to `support@geofoxapps.com`. Staff login addresses are not used in these headers. No reply-to variable is required.

If the exact root address is preferred as the sender, the existing code also accepts `SUPPORT_FROM_EMAIL=support@geofoxapps.com`; verify `geofoxapps.com` for Resend Sending in that case. Keep its existing receiving MX records.

## 5. Redeploy and verify delivery

Redeploy the current Geofox production release after saving the variables. Existing deployments do not pick up new environment settings.

1. Submit one public inquiry using another email account you control; keep the displayed reference.
2. Open that request in the Geofox admin support inbox.
3. Select **Customer reply** and send a brief test answer.
4. Confirm the answer arrives in the recipient inbox, with **Geofox Support** as the sender and the configured support sending address.
5. Use Reply in that inbox and confirm it targets `support@geofoxapps.com` and arrives in the monitored GoDaddy / Microsoft 365 mailbox.

The configuration badge checks setting presence and sender format. **Accepted by email provider** confirms Resend accepted the send request; it does not prove inbox delivery. Check Resend's email logs and the recipient mailbox when verifying. Incoming replies still remain in the mailbox rather than the ticket thread.

Reference: [Vercel environment variables and redeployment](https://vercel.com/docs/environment-variables/managing-environment-variables).

## Manual Outlook replies and personal-address privacy

Geofox-generated messages already use the support identity. When replying manually in Outlook, confirm **From** is `support@geofoxapps.com` before sending.

GoDaddy's documented setup is **Exchange admin center → Settings → Mail flow → Turn on sending from aliases**, followed by selecting the alias in Outlook on the web's **From** field. Test with an account you control before using manual replies with customers. Receiving a message through an alias does not by itself establish the identity used for a manual outgoing reply.

Reference: [GoDaddy: send from an alias in Outlook on the web](https://www.godaddy.com/en/help/send-email-from-an-alias-with-outlook-on-the-web-41100?Preview=true).
