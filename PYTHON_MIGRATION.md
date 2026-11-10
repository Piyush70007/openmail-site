# OpenMail's Python backend

The migration replaces the server runtime with Python 3.14 and FastAPI. The
mailbox UI, landing page, CSS, browser document extraction and browser JavaScript
stay unchanged. This is a backend implementation change, not a redesign or a
new email provider.

## Runtime responsibilities

| Component | Implementation |
| --- | --- |
| HTTP routes and security headers | `backend/application.py` |
| Supabase sessions, account access and bounded provider requests | `backend/core.py`, `backend/auth.py` |
| Domain checks, mailbox actions, drafts and sending | `backend/mail_routes.py` |
| Grounded AI drafts, citation validation and decision thresholds | `backend/ai.py` |
| Opt-in automatic replies, workflow actions and duplicate protection | `backend/automation.py` |
| Knowledge, documents and representative settings | `backend/ai_setup.py` |
| Training simulator, representatives, workflow rules and trust reporting | `backend/ai_platform.py` |
| Signed inbound webhooks and background processing | `backend/webhook.py` |
| Vercel/Uvicorn entry point | `main.py` |

Python is responsible for the real AI and mail backend. JavaScript remains in
the browser because it handles the existing interactive interface. Renaming
`app.js` to `app.py` would stop those browser interactions from running.

## Compatibility contract

- The same `/api/...` URLs, JSON field names and status codes serve the frontend.
- Existing `openmail_session` HMAC cookies retain their format and signing key.
- The same Supabase tables, RPCs, environment variables and provider keys are used.
- No database migration, DNS change, key rotation or account recreation is needed.
- AI prompts, the 0.80 confidence gate, exact source evidence, opt-in checks,
  account quotas, human handover and Resend idempotency keys are retained.
- All 14 public browser assets are served byte-for-byte unchanged. A build script
  copies an explicit allowlist to `public/`; it never copies secrets or server code.
- Vercel runs one FastAPI function, avoiding the former 12-function deployment limit.

Two defensive corrections accompany the port: JSON request bodies must be objects,
and automatic-job metadata is mapped to actual SQL column names before saving.
The old implementation could send camelCase metadata names to PostgREST after
a reply was accepted, then incorrectly mark that successful reply for review.
Standard international domain names remain supported; URL-only numeric host
coercions and emoji host labels are rejected by the Python IDNA validation.

## Verification and rollout

The Python tests cover HTTP routes, private data access, CSRF, session compatibility
with Node, bounded inputs, signed webhook delivery, duplicate events, mail actions,
AI decisions and failure handling. Differential tests compare the original Node
and Python decision helpers on the same synthetic inputs. The original 50 Node
tests are retained as a reference under `tests/node_baseline/`; these files are
excluded from deployment and do not run the application.

Tests use synthetic data and mocked providers. They do not send real email or
consume production AI quotas. A passing local suite does not establish that
live provider credentials or Vercel background execution have been tested.

Local verification on November 10, 2026: 150 Python tests and 328 subtests passed;
all 50 original Node tests passed; the runtime dependency audit found no known
vulnerabilities. The local Uvicorn server returned the mailbox page and session
API successfully. Git confirmed no changes to any browser asset.

Before replacing the production backend:

1. Build the migration branch as a Vercel preview using the FastAPI preset.
2. Check the public pages, API routing, security headers and private-file blocking.
3. In an isolated service environment, verify login, existing-session refresh,
   a signed inbound event and its completed automatic-reply job. ASGI background
   work is awaited after the response, but the deployed runtime must be checked.
4. Merge only when those checks pass. The frontend and provider configuration
   should not need changes. Do not copy Production secrets into public previews.

Rollback is the previous production deployment or reverting the migration commit.
The schema and session format are unchanged, so rollback requires no data conversion.

Vercel's [FastAPI documentation](https://vercel.com/docs/frameworks/backend/fastapi)
describes its entry point, public asset directory and single-function deployment.
