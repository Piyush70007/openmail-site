# OpenMail

OpenMail combines a Python/FastAPI backend for custom-domain email and grounded AI representatives with an interactive browser interface. The Python backend is live in production; the [rollout record](docs/PYTHON_ROLLOUT_2026-11-10.md) documents the verified login, automatic-reply, human-handoff and replay checks. A signed-in account owner can connect a domain, review the mail provider's DNS records, create addresses on a verified domain, and use an inbox in OpenMail.

## What is implemented

- Email and password account sign-up, sign-in, session refresh, and sign-out through Supabase Auth. Browser sessions use signed, HTTP-only cookies.
- Owner-scoped domains, mailboxes, and messages stored in Supabase. The included schema enables row-level security.
- Domain registration and DNS status checks through the Resend API, with both sending and receiving enabled. Before setup, OpenMail checks for existing MX mail routes and warns when it finds one. The domain owner must approve any DNS change with their provider.
- Separate mailboxes such as `support@yourdomain.com`, once the domain is verified.
- Plain text outbound mail, inbound mail via a signed Resend webhook, plus inbox, sent, starred, drafts, archive, spam, and trash views. Drafts are stored in the signed-in user's account and can be reopened, edited, and sent.
- Message selection supports selecting visible messages and moving them to Archive, Spam, Trash, or back to Inbox. Archiving one message is also available in its detail view.
- Confirmed-email gating and atomic per-account limits: 30 DNS checks per hour, 2 domain registrations per day, 12 verification attempts per hour, 20 mailbox creations per day, and 10 outbound send requests per day.
- **My AI, Phases 1–5**: grounded editable drafts and opt-in automatic replies; a synthetic email simulator with verified citations, expected-answer evaluation, and a confidence gate; separate Support, Sales, Billing, and Careers representatives with scoped knowledge; a restricted mailbox workflow builder; and an owner-only trust dashboard with corrections, escalations, resolutions, and labeled accuracy.
- Automatic replies are off by default. An owner must explicitly enable them for each verified mailbox after enabling the AI profile; the UI asks for confirmation before saving. Candidate inbound text and approved company context may then go to Groq. Attachments and original uploaded files are never sent. Sensitive, automated, uncertain, or unsupported emails are held for review or ignored; eligible automatic replies must cite exact source passages and pass a high confidence threshold. The server constructs outbound content from those exact quotes and ignores the model's free-form reply, avoiding unsupported generated claims. Replies use the normal account send quota, have an idempotency key, and are capped at 10 AI requests per user and 25 per OpenMail project per UTC day. A 24-hour per-sender reply cooldown helps limit loops.
- Server-side AI safeguards: Groq and Supabase secret keys never reach the browser; profile, knowledge, documents, settings, message views, and handoffs are scoped to the signed-in owner. Database tables and the document RPC are restricted to `service_role`. Uploaded documents are extracted in the browser, bounded to 5 MB/50 PDF pages/40,000 characters, and stored as text only. Human-review and failed-send cases do not appear as AI Sent.
- The actual app lives at `/app.html`. The React homepage contains a labeled interactive product preview with fictional mail, representative setup, training, workflows and trust reporting. Preview interactions do not access real accounts or send mail.
- Custom address examples explain separate inboxes such as `support@yourdomain.com`, `sales@yourdomain.com` and a personal name. These are not forwarding aliases; creation and provider quotas still apply.
- The signed-in workspace uses the same dark visual style, readable controls and full-window layout. AI results include semicircle gauges and count bars. Reviewed accuracy counts only Correct/Needs correction feedback; AI confidence is a separate model estimate. Empty datasets display no data instead of a success percentage.

### My AI representative — Phase 1

Apply [`supabase/migrations/20261104_ai_representative_setup.sql`](supabase/migrations/20261104_ai_representative_setup.sql) and [`supabase/migrations/20261104_ai_representative_phase1.sql`](supabase/migrations/20261104_ai_representative_phase1.sql) in Supabase before using the AI setup. They create the profile/knowledge tables, atomic AI quota, owner-scoped document storage, per-mailbox opt-in settings, automatic-reply audit/idempotency records, and handoff metadata. Tables and the document RPC are restricted to `service_role`; browser requests are authenticated and owner-scoped by the server.

Create a free Groq API key in the Groq console, then add `GROQ_API_KEY` as a **server-only** Vercel Production environment variable and redeploy. `GROQ_MODEL` is optional; it defaults to `openai/gpt-oss-20b`. Do not put either variable in client-side code. The default app limits are 10 draft requests per account and 25 total per deployment per UTC day; Groq also applies organization-wide request and token limits, which may stop generation earlier. When a limit is reached, generation stops until it resets.

In **My AI**, save the company profile and approved notes. Documents are parsed locally in the browser; only extracted text is stored, and files over 40,000 extracted characters must be split. When the owner enables the AI profile and clicks **Generate AI draft**, the opened inbound email and approved context go to Groq; the result appears in the normal editable compose window and the owner decides whether to send. To enable automatic replies, the owner must separately confirm the selected verified mailbox. Eligible inbound messages are then processed by Groq; rule-matched sensitive/automated messages are filtered or sent to **Needs human**, and uncertain or unsupported answers are held for review. The AI must provide exact evidence quotes from approved sources and meet the confidence threshold. Attachments are never passed to the model. Groq says inference inputs and outputs are not retained by default, but may be retained up to 30 days for reliability or abuse investigations; review [Groq's data policy](https://console.groq.com/docs/your-data).

The Python backend serves the existing API routes through one FastAPI application and one Vercel Function. Automatic replies run as a signed-webhook background task and continue to respect the existing account send limits. Mailbox selection, Sent, and draft behavior remain within the existing app.

## Before using live mail

The site has a live deployment. The Phases 2–5 code in this repository requires its additive database migration and a successful deployment before those controls work live. This implementation does not apply the migration or change live service configuration. No service has been purchased and no DNS record has been changed.

This version uses an API and webhook mail transport. OpenMail stores the inbox messages in Supabase; Resend handles email delivery and receives inbound messages. It is a web inbox, not a general-purpose IMAP/POP mailbox for Apple Mail, Outlook, or other mail clients. Attachments are recorded as metadata but cannot yet be downloaded or sent. Automated spam detection, category classification, billing, and global abuse monitoring are not implemented. Per-account limits are only a first layer of abuse protection, not a guarantee against a compromised server or coordinated account abuse.

### Required services and configuration

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor, then run [`supabase/security-quotas.sql`](supabase/security-quotas.sql). For an existing project, also apply the additive migrations for drafts and AI: [`supabase/migrations/20261031_mailbox_drafts.sql`](supabase/migrations/20261031_mailbox_drafts.sql), [`supabase/migrations/20261104_ai_representative_setup.sql`](supabase/migrations/20261104_ai_representative_setup.sql), and [`supabase/migrations/20261104_ai_representative_phase1.sql`](supabase/migrations/20261104_ai_representative_phase1.sql). Copy the project URL, publishable key, and secret key from the Supabase dashboard. The secret key bypasses row-level security and must stay server-side. OpenMail also accepts the legacy `anon` and `service_role` key variable names.
2. In Supabase Auth, enable email/password sign-in, keep email confirmation enabled, and allow `https://freeopenmail.tech/app.html` and keep any existing Vercel redirect used by the deployment, plus the local `/app.html` URL in the redirect list. Hosted Supabase's built-in email sender is limited to organization team addresses and two emails per hour; configure a [custom SMTP sender](https://supabase.com/docs/guides/auth/auth-smtp) for signup confirmations.
3. Create a Resend API key with **Full access**. Resend currently offers Full access or Sending access; domain creation, verification, and retrieving inbound message contents need Full access. Treat it like a master key for that Resend workspace: use a workspace dedicated to OpenMail, store the key only in Vercel's server-side Production variables, and never return it from an API or put it in browser code. Users can invoke only authenticated, owner-scoped OpenMail actions; they cannot read the key. The key remains available to the deployed server, so a server compromise could expose it. The [Resend Free tier](https://www.resend.com/pricing?product=transactional) has provider-level quotas; no paid plan is selected here.
4. For Supabase Auth email, configure custom SMTP with host `smtp.resend.com`, port `465`, username `resend`, and a domain-scoped Sending Access key as the password ([Resend SMTP details](https://resend.com/changelog/smtp-service)). Use a sender address on a verified sending domain. Keep this key separate from the Full Access key.
5. In Resend, add a webhook for `email.received` at `https://freeopenmail.tech/api/webhooks/resend`. Copy its signing secret.
6. Add the variables from [`.env.example`](.env.example) to the Vercel project's Production environment. Set `OPENMAIL_PUBLIC_URL` to `https://freeopenmail.tech`. Keep `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `GROQ_API_KEY` server-only; never prefix them with `NEXT_PUBLIC_` or place them in browser code. Vercel applies environment variable changes to new deployments, so redeploy after saving them.
7. Sign up at `/app.html`, confirm the account email, and sign in.
8. In the app, connect a domain you control. OpenMail checks whether it already has a mail route, then asks Resend for the records needed to send and receive. A domain owner must approve those records with the DNS provider; OpenMail does not make DNS changes. Use **Check DNS records** after approval. Creating a mailbox becomes available when the provider reports the domain as verified.
9. Create the address (for example, `support`) and use that mailbox in OpenMail.
10. For AI, add the Groq key as a server-only Vercel variable and redeploy. In **My AI**, set up approved company information and enable the AI profile. Draft generation is owner-initiated. Automatic sending remains disabled until the owner separately enables and confirms it for a specific verified mailbox; automatic replies consume the same account email and AI quotas. Groq's current organization limits still apply to the shared project key.

**Check existing email first.** The app checks whether the domain currently has MX records and warns before preparing setup. DNS tells other mail services where to deliver messages. Changing the main MX record can move new mail away from an existing provider. Review the complete changes with the domain administrator before applying them. OpenMail never edits DNS automatically. One-click DNS setup is not currently implemented; it requires onboarding OpenMail as a Domain Connect service and approval from supported DNS providers.

### Phases 2–5 rollout

For an existing Supabase project, apply the additive migration files in this order: 20261031_mailbox_drafts.sql, 20261104_ai_representative_setup.sql, 20261104_ai_representative_phase1.sql, then 20261105_ai_representatives_workflows_trust.sql. The last migration is at supabase/migrations/20261105_ai_representatives_workflows_trust.sql. Apply and verify it before deploying this code because runtime selects its new representative and workflow columns. The migration enables owner-level row security, grants access only to service_role, and keeps simulation message text out of the database.

Before deploying, revoke and replace any Groq key previously exposed in this workspace. Store the replacement only as a server-side Vercel Production variable; this repository cannot rotate provider keys.

Use My AI → Training simulator to run synthetic cases and inspect safe decisions and verified citations. In Representatives, name and enable the needed agents, add representative-scoped notes/documents, and assign each mailbox. Create mailbox-specific rules under Workflows. Mark outcomes in Trust dashboard; feedback is recorded for reporting and does not silently retrain the model. Tests mock database/provider calls; they do not send mail, contact Groq, or exercise a live Supabase project.

Run npm test for the automated security and workflow checks.

## Run locally

Use Python 3.14 and Node 24. Create `.env.local` from [`.env.example`](.env.example) using development credentials. Allow `http://localhost:3000/app.html` in the development Supabase Auth redirects.

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
npm run build
.venv/bin/python -m pytest -q
npm test
npm run dev:api
```

Open [localhost:3000](http://localhost:3000) to use the compiled React homepage and the mailbox through Python. `npm run build` compiles the homepage into `landing-dist/` and packages it with the explicit mailbox assets into `public/`. The old root `index.html` is retained as a reference and is never used as a deployment fallback. A missing homepage build fails packaging and returns HTTP 503 locally instead of showing stale content.

For homepage development with live updates, keep `npm run dev:api` running in the first terminal and run `npm run dev` in a second terminal. Open [127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies `/api`, `/app.html` and the mailbox assets to Python on port 3000, preserving the browser origin for CSRF checks. Add `http://127.0.0.1:5173/app.html` to the **development** Supabase redirect allowlist if testing email confirmation through Vite. Use development credentials for these local flows.

For a runtime-only Python installation, use `requirements.txt` instead of `requirements-dev.txt`. Node is required to build the homepage, while the deployed backend still runs in Python. Resend webhook delivery needs a public HTTPS endpoint.

## Project structure

- `backend/` — Python authentication, mail APIs, AI reasoning and citation validation, workflow processing, simulator and trust reporting.
- `main.py` — FastAPI entry point for Uvicorn and Vercel.
- `frontend/` — React homepage, styling and interactions, built by Vite.
- `vite.config.mjs` — homepage output and local proxy to Python; no public directory or source maps are copied into the build.
- `index.html`, `app.js` — retained legacy homepage references, excluded from deployment.
- `styles.css` — shared base stylesheet used by the mailbox.
- `app.html`, `app.css`, `workspace.css`, `app-ui.js`, `insights.css` — real mailbox, AI setup and saved-results charts. The interface keeps its browser JavaScript handlers and Python APIs.
- `app-ai-documents.js`, `vendor/` — local browser document extraction.
- `supabase/` — unchanged tables, access policies, quotas and migration history.
- `tests/python/` — Python API, security, AI and compatibility tests.
- `tests/node_baseline/` — historical Node backend used only for regression comparisons; excluded from deployment.
- `scripts/build_static.py`, `backend/static_assets.py` — package and serve only compiled homepage files and approved mailbox assets.
- `scripts/prepare_frontend.mjs` — installs locked Node build dependencies on Vercel without replacing its Python dependency installation.
- `requirements.txt`, `requirements-dev.txt` — pinned runtime and verification dependencies.

The tests use synthetic data and mocked providers; they do not send email, call Groq or access production Supabase. [PYTHON_MIGRATION.md](PYTHON_MIGRATION.md) explains the architecture and preserved contracts. The [production rollout record](docs/PYTHON_ROLLOUT_2026-11-10.md) documents separate live login, automatic-reply, human-handoff and replay checks.

## GitHub and Vercel

- GitHub repository: [Piyush70007/openmail-site](https://github.com/Piyush70007/openmail-site)
- Production website: [freeopenmail.tech](https://freeopenmail.tech/)
- Vercel project: `openmail-site` (the hosting project name remains unchanged)

The repository is connected to Vercel and deploys from `main`. The framework remains FastAPI and the build command is `npm run build`. Vercel installs the locked Python environment first; the Vercel-only `prebuild` hook then installs the locked Node build tools. Do not replace the install command with only `npm ci`, because that would skip Python dependency installation. Add the services and environment variables above in Vercel before expecting the account app to accept sign-ups or handle mail. Configure a webhook against the final HTTPS deployment URL after the API routes are deployed.
