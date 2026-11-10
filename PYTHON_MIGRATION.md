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
Standard international domain names remain supported. URL-only numeric host
coercions are not performed, and IDNA-invalid emoji labels are rejected.

## Verification and rollout

The production website is **https://freeopenmail.tech**. Its Vercel project is
`openmail-site`; the project name and preview hostname do not replace the custom
domain. Python commit `955d605` was promoted to this domain on November 10, 2026,
at 21:57:40 UTC. [Pull request #1](https://github.com/Piyush70007/openmail-site/pull/1)
was then merged as `5795eb6`; Vercel deployment `G5qHbiUrKUUURpgf8RFwH84mJ83p`
from `main` was confirmed Ready and serving the production domain. The detailed
[production rollout record](docs/PYTHON_ROLLOUT_2026-11-10.md) records the evidence.

The Python tests cover HTTP routes, private data access, CSRF, session compatibility
with Node, bounded inputs, signed webhook delivery, duplicate events, mail actions,
AI decisions and failure handling. Differential tests compare the original Node
and Python decision helpers on the same synthetic inputs. The original 50 Node
tests are retained as a reference under `tests/node_baseline/`; these files are
excluded from deployment and do not run the application.

Automated tests use synthetic data and mocked providers. They do not send real
email or consume production AI quotas. Separate controlled production checks
described below exercised real login, session renewal, mail delivery and Groq
automation; the local tests alone do not establish those live results.

Local verification on November 10, 2026: 151 Python tests and 328 subtests passed;
all 50 original Node tests passed; the runtime dependency audit found no known
vulnerabilities. The local Uvicorn server returned the mailbox page and session
API successfully. Git confirmed no changes to any browser asset.

The pushed migration commit also passed GitHub Actions. Vercel built its preview
successfully as one Python 3.14 function (15.7 MB, 60-second maximum). The preview
mailbox page and session API were checked in Chrome, and requesting backend
source returned the expected missing-route response. Preview account services are
intentionally unconfigured; no production secrets were copied into Preview.
The committed `uv.lock` pins Vercel's full dependency graph. A regression check
confirms its runtime packages match the audited `requirements.txt` exactly.

The staged Production deployment used the existing server-only Production
configuration. A normal owner login and reload restored the mailbox. After
promotion, the pre-existing production session also restored the same 11 messages.
Read-only Supabase session timestamps confirmed renewal of both sessions; no
tokens were read and no auth audit events were available for this check.

Both OpenMail mailbox tabs were closed before two controlled emails were sent.
The supported factual question produced one automatic reply, a completed
`auto_sent` job with confidence 0.95, and actual delivery to the owner's inbox.
The sensitive account request produced a pending human handoff and no outbound
reply. These results verify that the deployed Python automation continued without
the mailbox being open in a browser. DNS, database schema, environment variables,
company knowledge and automatic-reply settings were not changed for these tests.

Public checks returned ready status and session responses, blocked private source
and environment-file paths, rejected origin-less logout and unsigned webhooks,
and included the configured security headers. Resend showed two delivery attempts
for the positive webhook and confirmed its manual replay returned HTTP 200 and
`{"ok":true}`. The database still showed exactly one outbound reply
and an unchanged completed-job timestamp. The live replay check passed. The merge
build also passed GitHub Actions, and the live mailbox displayed the test reply in
AI Sent and the safety case in Needs human.

Rollback target: Vercel deployment `2cCQQHm8HD6KhmiUnLw2Eo652Xe7`, the previous
Node implementation at commit `611f128`. The schema and session format are
unchanged, so rollback requires no data conversion. Preserve automation job claims
and provider IDs when investigating a failed or ambiguous send; restoring a
deployment does not itself retry a job already claimed as `processing`.

Vercel's [FastAPI documentation](https://vercel.com/docs/frameworks/backend/fastapi)
describes its entry point, public asset directory and single-function deployment.
