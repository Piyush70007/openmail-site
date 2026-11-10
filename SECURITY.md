# OpenMail security review

**Review date:** 2026-11-10

**Scope:** Repository review and automated tests for the browser app, Vercel API routes, Supabase access patterns and migrations, Resend webhook, and Groq-assisted email handling.

This is an engineering review, not a certification or an independent penetration test. It covers the controls present in this repository. Provider dashboard settings and production database policies still need their own verification.

## Controls reviewed

| Area | Controls checked or added |
| --- | --- |
| Authentication and sessions | Email/password length bounds; generic provider rejection errors; signed HMAC session cookies with `HttpOnly`, `Secure` in production, `SameSite=Lax`, no `Domain`, and a root path; tampered session signatures rejected before an upstream request. |
| CSRF and HTTP | Mutating browser routes require an exact same-origin scheme and host; unsupported methods are rejected; JSON API responses use `Cache-Control: no-store`. |
| Authorization and data isolation | Mailbox, message, domain, AI profile, knowledge, and representative queries are scoped to the signed-in owner. AI notes/documents are scoped to the selected representative or shared entries. SQL migrations enable RLS and restrict server-only tables and RPCs to `service_role`; composite owner foreign keys protect mailbox, message, representative, and workflow relationships. |
| Webhook handling | Resend signatures are checked against the raw body with a five-minute timestamp window and constant-time comparison; payloads are capped at 1 MiB; automated/list mail is detected; duplicate inbound email is constrained by database uniqueness. |
| AI safety and privacy | Confidence floor is 0.80, with exact source-quote validation and a high-risk review gate still in force. Auto replies contain verified source text, not free-form model prose. Private routing notes are not citation sources. Explicitly test/demo/synthetic price-list documents are excluded. Citation validation rejects prompt-injection text and credential-shaped values. Attachments are not sent to Groq. |
| Resource limits and failures | JSON bodies are capped at 256 KiB, email webhook payloads at 1 MiB, document extraction at 40,000 characters, and upstream Supabase/Resend calls have 10-second timeouts. User/global AI quotas remain enforced. Provider errors and request data are excluded from server error logs. |
| Browser headers | HSTS, CSP, `X-Content-Type-Options`, frame denial, referrer policy, and restrictive permissions policy are configured in `vercel.json`. |
| Dependencies and secrets | `npm audit --omit=dev` reported zero vulnerabilities. No live provider keys were added to source files in this change. |

## Automated test cases

`npm test` currently passes **49 tests**. The suite includes:

- invalid/oversized JSON and oversized webhook bodies;
- missing, foreign, scheme-mismatched, and port-mismatched origins;
- malformed/oversized auth inputs, account-enumeration-safe provider errors, secure cookie flags, and tampered session signatures;
- forwarded-IP trust gates, new-secret-key enforcement, legacy-key fallback, and route-level login/signup forwarding for Supabase Auth;
- timeout/network failure handling and private-log redaction;
- webhook signature tampering/staleness and automated-message detection;
- exact citation matching, confidence boundaries, prompt injection, sensitive/account/payment/cancellation cases, test-price exclusion, and internal-policy separation;
- synthetic supported/unsupported question decisions, workflow opt-in, human handoff, quota exhaustion, and proof that failure paths do not send mail;
- production header policy and no-store API responses.

Additional checks run: `npm audit --omit=dev`, `git diff --check`, `vercel.json` JSON parsing, and JavaScript syntax checks.

## Findings fixed in this review

- Upstream fetches could wait indefinitely and provider errors could put raw details in logs. Calls now time out and logs keep only sanitized status/code data.
- Several generic words such as “login”, “billing”, and “availability” could force human review even when a routine direct fact was available. Those broad triggers were narrowed while individual account/payment actions, sensitive data, appointments, complaints, and prompt injection still route to review.
- The confidence threshold changed from 0.85 to 0.80. Confidence is a model estimate, not a calibrated probability; it is only one gate alongside exact citations and deterministic review rules.
- Private profile routing instructions and the clearly test-labeled price list could be treated as customer-citable evidence. They are now separated from approved source text or filtered from AI context.
- Auth provider error text could reveal whether an account existed. Provider rejections now return the same generic response.
- Exact source matching alone could have permitted an unsafe quote from an uploaded document. Credential-shaped strings and common prompt-injection instructions are now rejected as automatic evidence.

## Checks still needed outside this repository

- The local Supabase/Docker database stack was unavailable during this review, so pgTAP and real two-account RLS tests were not run. The SQL has been reviewed, but production grants/policies have not been read back from the hosted database in this run.
- No external penetration test, browser-based DAST, or production mailbox send/receive test was performed. Automated question tests use synthetic data and mock the model/provider. Three additional synthetic prompts were run against the live Groq simulator; all three decisions matched their expected auto-reply/human-review outcomes, and no email was sent.
- OpenMail proxies Supabase Auth through Vercel. The app forwards only a single valid IP from Vercel's `X-Forwarded-For` header, and only when `SUPABASE_SECRET_KEY` uses the new `sb_secret_` format. Supabase rejects this feature with publishable or legacy `anon`/`service_role` keys. Vercel documents that it overwrites `X-Forwarded-For` to prevent spoofing. The project-level IP-forwarding switch was enabled and read back as on in Supabase after deployment. The production readiness endpoint confirms required configuration is present but does not disclose the API-key type; verify that the production key begins with `sb_secret_` in Vercel without exposing its value before relying on per-client rate limiting.
- Confirm the Supabase Auth redirect allowlist, email confirmation, admin MFA, production-only server secrets, and Vercel deployment protection settings in their dashboards.

## References

- [OWASP ASVS 5.0](https://asvs.owasp.org/)
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/)
- [OWASP GenAI Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS policy testing](https://supabase.com/docs/guides/database/postgres/testing-row-level-security)
- [Supabase Auth rate limits and forwarded client IP](https://supabase.com/docs/guides/auth/rate-limits)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
