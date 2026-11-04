# OpenMail

OpenMail is a cinematic public site with a separate, server-backed mailbox app. A signed-in account owner can connect a domain, review the mail provider's DNS records, create addresses on a verified domain, and use an inbox in OpenMail.

## What is implemented

- Email and password account sign-up, sign-in, session refresh, and sign-out through Supabase Auth. Browser sessions use signed, HTTP-only cookies.
- Owner-scoped domains, mailboxes, and messages stored in Supabase. The included schema enables row-level security.
- Domain registration and DNS status checks through the Resend API, with both sending and receiving enabled. Before setup, OpenMail checks for existing MX mail routes and warns when it finds one. The domain owner must approve any DNS change with their provider.
- Separate mailboxes such as `support@yourdomain.com`, once the domain is verified.
- Plain text outbound mail, inbound mail via a signed Resend webhook, plus inbox, sent, starred, drafts, archive, spam, and trash views. Drafts are stored in the signed-in user's account and can be reopened, edited, and sent.
- Message selection supports selecting visible messages and moving them to Archive, Spam, Trash, or back to Inbox. Archiving one message is also available in its detail view.
- Confirmed-email gating and atomic per-account limits: 30 DNS checks per hour, 2 domain registrations per day, 12 verification attempts per hour, 20 mailbox creations per day, and 10 outbound send requests per day.
- An optional **My AI representative, Phase 1**: save company facts and approved knowledge, then request a Groq reply draft from an opened inbound email. The email and saved AI context go to Groq only after the owner opts in and clicks **Generate AI draft**. The result opens in the existing editable compose window; only the user can send it.
- Server-side AI safeguards: Groq's key never reaches the browser; 10 generated drafts per account and 25 across OpenMail per UTC day; the inbound webhook and existing mail send path are unchanged.
- The actual app lives at `/app.html`. The landing page also contains a separate fictional category interface sample.

### My AI representative — Phase 1

Apply [`supabase/migrations/20261104_ai_representative_setup.sql`](supabase/migrations/20261104_ai_representative_setup.sql) in Supabase before using the AI setup or generating drafts. It creates owner-scoped company profile and knowledge tables plus an atomic per-user and project-wide daily draft quota. The SQL grants the quota RPC only to `service_role`.

Create a free Groq API key in the Groq console, then add `GROQ_API_KEY` as a **server-only** Vercel Production environment variable and redeploy. `GROQ_MODEL` is optional; it defaults to `openai/gpt-oss-20b`. Do not put either variable in client-side code. The default app limits are 10 draft requests per account and 25 total per deployment per UTC day; Groq also applies organization-wide request and token limits, which may stop generation earlier. When a limit is reached, generation stops until it resets.

In **My AI**, save the company profile and approved notes, then explicitly enable Groq drafts. Each time the owner clicks **Generate AI draft** on an inbound message, OpenMail sends that message's subject and plain-text body plus the saved company context to Groq. Attachments are not sent; the draft uses the 20 newest notes, up to 5,000 characters total. The generated text is inserted into the normal compose window and is editable; the owner must choose whether to save or send it. No inbound webhook automation or automatic reply is connected. Groq documents that inference inputs and outputs are not retained by default, but may be retained for up to 30 days for reliability or abuse investigations; review [Groq's data policy](https://console.groq.com/docs/your-data).

The AI draft action reuses the existing authenticated message route, and the profile/knowledge URLs rewrite to the existing message function. This keeps the project at 12 Vercel Function files for Hobby deployments. It does not change inbound processing, normal compose, or mail sending. Document uploads, AI Sent, automatic classification, and automatic replies are not included in Phase 1.

## Before using live mail

The app is deployed, and its existing Supabase, authentication, and mail setup is in use. Phase 1 AI setup adds its own additive migration and Groq server key below. No service has been purchased and no DNS record has been changed.

This version uses an API and webhook mail transport. OpenMail stores the inbox messages in Supabase; Resend handles email delivery and receives inbound messages. It is a web inbox, not a general-purpose IMAP/POP mailbox for Apple Mail, Outlook, or other mail clients. Attachments are recorded as metadata but cannot yet be downloaded or sent. Automated spam detection, category classification, billing, and global abuse monitoring are not implemented. Per-account limits are only a first layer of abuse protection, not a guarantee against a compromised server or coordinated account abuse.

### Required services and configuration

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor, then run the additive [`supabase/security-quotas.sql`](supabase/security-quotas.sql) migration. For an existing project, also run [`supabase/migrations/20261031_mailbox_drafts.sql`](supabase/migrations/20261031_mailbox_drafts.sql) to enable account-backed drafts. Copy the project URL, publishable key, and secret key from the Supabase dashboard. The secret key bypasses row-level security and must stay server-side. OpenMail also accepts the legacy `anon` and `service_role` key variable names.
2. In Supabase Auth, enable email/password sign-in, keep email confirmation enabled, and allow `https://openmail-site.vercel.app/app.html` plus the local `/app.html` URL in the redirect list. Hosted Supabase's built-in email sender is limited to organization team addresses and two emails per hour; configure a [custom SMTP sender](https://supabase.com/docs/guides/auth/auth-smtp) for signup confirmations.
3. Create a Resend API key with **Full access**. Resend currently offers Full access or Sending access; domain creation, verification, and retrieving inbound message contents need Full access. Treat it like a master key for that Resend workspace: use a workspace dedicated to OpenMail, store the key only in Vercel's server-side Production variables, and never return it from an API or put it in browser code. Users can invoke only authenticated, owner-scoped OpenMail actions; they cannot read the key. The key remains available to the deployed server, so a server compromise could expose it. The [Resend Free tier](https://www.resend.com/pricing?product=transactional) has provider-level quotas; no paid plan is selected here.
4. For Supabase Auth email, configure custom SMTP with host `smtp.resend.com`, port `465`, username `resend`, and a domain-scoped Sending Access key as the password ([Resend SMTP details](https://resend.com/changelog/smtp-service)). Use a sender address on a verified sending domain. Keep this key separate from the Full Access key.
5. In Resend, add a webhook for `email.received` at `https://openmail-site.vercel.app/api/webhooks/resend`. Copy its signing secret.
6. Add the variables from [`.env.example`](.env.example) to the Vercel project's Production environment. Set `OPENMAIL_PUBLIC_URL` to `https://openmail-site.vercel.app`. Keep `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `GROQ_API_KEY` server-only; never prefix them with `NEXT_PUBLIC_` or place them in browser code. Vercel applies environment variable changes to new deployments, so redeploy after saving them.
7. Sign up at `/app.html`, confirm the account email, and sign in.
8. In the app, connect a domain you control. OpenMail checks whether it already has a mail route, then asks Resend for the records needed to send and receive. A domain owner must approve those records with the DNS provider; OpenMail does not make DNS changes. Use **Check DNS records** after approval. Creating a mailbox becomes available when the provider reports the domain as verified.
9. Create the address (for example, `support`) and use that mailbox in OpenMail.
10. For AI drafts, apply the AI migration, add the Groq key as a server-only Vercel variable, redeploy, then configure **My AI** and enable draft replies. No billing plan is required by this repository; Groq's free-tier limits still apply and are shared by the project key.

**Check existing email first.** The app checks whether the domain currently has MX records and warns before preparing setup. DNS tells other mail services where to deliver messages. Changing the main MX record can move new mail away from an existing provider. Review the complete changes with the domain administrator before applying them. OpenMail never edits DNS automatically. One-click DNS setup is not currently implemented; it requires onboarding OpenMail as a Domain Connect service and approval from supported DNS providers.

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
- `server/` — server-only session, provider, AI-draft, database, and ownership helpers.
- `supabase/schema.sql`, `supabase/security-quotas.sql`, `supabase/migrations/` — tables, indexes, row-level security policies, atomic per-account usage limits, and additive features.
- `.env.example` — required server configuration names (no secrets).

## GitHub and Vercel

- GitHub repository: [Piyush70007/openmail-site](https://github.com/Piyush70007/openmail-site)
- Vercel site: [openmail-site.vercel.app](https://openmail-site.vercel.app/)

The repository is connected to Vercel and deploys from `main`. Add the services and environment variables above in Vercel before expecting the account app to accept sign-ups or handle mail. Configure a webhook against the final HTTPS deployment URL after the API routes are deployed.
