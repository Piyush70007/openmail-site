# OpenMail

OpenMail is a cinematic public site with a separate, server-backed mailbox app. A signed-in account owner can connect a domain, review the mail provider's DNS records, create addresses on a verified domain, and use an inbox in OpenMail.

## What is implemented

- Email and password account sign-up, sign-in, session refresh, and sign-out through Supabase Auth. Browser sessions use signed, HTTP-only cookies.
- Owner-scoped domains, mailboxes, and messages stored in Supabase. The included schema enables row-level security.
- Domain registration and DNS status checks through the Resend API. OpenMail displays the records; a person must add them at the DNS provider.
- Separate mailboxes such as `support@yourdomain.com`, once the domain is verified.
- Plain text outbound mail, inbound mail via a signed Resend webhook, and inbox, sent, archive, spam, and trash views.
- The actual app lives at `/app.html`. The landing page also contains a separate fictional category interface sample.

## Before using live mail

The code is in place, but this checkout has no provider credentials or configured database. The live app will not create accounts or send/receive mail until the services below are configured. No service has been purchased, no account has been created, and no DNS record has been changed as part of this build.

This version uses an API and webhook mail transport. OpenMail stores the inbox messages in Supabase; Resend handles email delivery and receives inbound messages. It is a web inbox, not a general-purpose IMAP/POP mailbox for Apple Mail, Outlook, or other mail clients. Attachments are recorded as metadata but cannot yet be downloaded or sent. Automated spam detection, category classification, mailbox quotas, billing, and production abuse controls are not implemented.

### Required services and configuration

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
2. In Supabase Auth, enable email/password sign-in, keep email confirmation enabled, add the production and local `/app.html` URLs to the redirect allowlist, and configure SMTP for confirmation mail.
3. Create a Resend account and an API key with domain, sending, and inbound email access. No paid plan is selected here.
4. In the Resend dashboard, add a webhook for `email.received` at `https://YOUR-VERCEL-DOMAIN/api/webhooks/resend`. Copy its signing secret.
5. Add the variables from [`.env.example`](.env.example) to the Vercel project. Set `OPENMAIL_PUBLIC_URL` to the deployed OpenMail origin. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET` server-only; never prefix them with `NEXT_PUBLIC_` or place them in browser code.
6. Deploy the project. Sign up at `/app.html`, confirm the account email, and sign in.
7. In the app, connect a domain you control. OpenMail asks Resend for the required records and shows them for review. Add records manually with the domain's DNS provider, then use **Check DNS records** in OpenMail. Creating a mailbox becomes available when the provider reports the domain as verified.
8. Create the address (for example, `support`) and use that mailbox in OpenMail.

**Check existing email first.** DNS changes can change where a domain's mail is delivered. In particular, changing its MX records may move delivery away from an existing mail provider. Review the complete records with the domain administrator before applying them. OpenMail never edits DNS automatically.

## Run locally

Use Node.js and the Vercel CLI because the account and mail APIs run as Vercel Functions. Create `.env.local` from [`.env.example`](.env.example), fill in development credentials, and allow `http://localhost:3000/app.html` in Supabase Auth redirects.

```sh
npx vercel dev
```

Open [http://localhost:3000](http://localhost:3000). Webhook delivery from Resend needs a publicly reachable HTTPS URL; use a deployed preview URL for inbound testing.

## Project structure

- `index.html`, `styles.css`, `app.js` — cinematic public site and the clearly labeled, fictional category interface sample.
- `app.html`, `app.css`, `app-ui.js` — signed-in mailbox app, domain onboarding, inbox, and compose flow.
- `api/` — Vercel Functions for authentication, domains, mailboxes, message actions, send, and inbound webhooks.
- `server/` — server-only session, provider, database, and ownership helpers.
- `supabase/schema.sql` — tables, indexes, and row-level security policies.
- `.env.example` — required server configuration names (no secrets).

## GitHub and Vercel

- GitHub repository: [Piyush70007/openmail-site](https://github.com/Piyush70007/openmail-site)
- Vercel site: [openmail-site.vercel.app](https://openmail-site.vercel.app/)

The repository is connected to Vercel and deploys from `main`. Add the services and environment variables above in Vercel before expecting the account app to accept sign-ups or handle mail. Configure a webhook against the final HTTPS deployment URL after the API routes are deployed.
