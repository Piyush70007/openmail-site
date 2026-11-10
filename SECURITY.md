# OpenMail security review

**Review date:** 2026-11-10

**Scope:** Repository review and automated tests for the browser app, Vercel API routes, Supabase access patterns and migrations, Resend webhook, and Groq-assisted email handling.

This is an engineering review, not a certification or an independent penetration test. It covers repository controls and the provider settings that were read back in the Supabase and Vercel dashboards.

## Controls reviewed

| Area | Controls checked or added |
| --- | --- |
| Authentication and sessions | Email/password length bounds; generic provider rejection errors; signed HMAC session cookies with `HttpOnly`, `Secure` in production, `SameSite=Lax`, no `Domain`, and a root path; tampered session signatures rejected before an upstream request. |
| CSRF and HTTP | Mutating browser routes require an exact same-origin scheme and host; unsupported methods are rejected; JSON API responses use `Cache-Control: no-store`. |
| Authorization and data isolation | Mailbox, message, domain, AI profile, knowledge, and representative queries are scoped to the signed-in owner. AI notes/documents are scoped to the selected representative or shared entries. SQL migrations enable RLS and restrict server-only tables and RPCs to `service_role`; composite owner foreign keys protect mailbox, message, representative, and workflow relationships. Hosted RLS is enabled on the reviewed tables. Server-only tables without user policies deny access through normal client roles. |
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
- The hosted `public.rls_auto_enable()` SECURITY DEFINER event-trigger function was executable by `PUBLIC`, `anon`, and `authenticated`. Those grants were revoked while retaining the event trigger that enables RLS on newly created public tables. A repeatable migration records the privilege fix.

## Provider dashboard review

- **Supabase Auth:** `https://freeopenmail.tech/app.html` is in the redirect allowlist; the default Site URL remains `https://openmail-site.vercel.app`. Email confirmation is on, anonymous sign-ins are off, and email is the only enabled sign-in provider. TOTP MFA is enabled, with a 15-minute AAL1 session limit. Auth IP forwarding is enabled.
- **Supabase database:** Security Advisor reported zero errors. After the function privilege fix, its only remaining warning is that leaked-password protection is disabled; the nine informational findings concern RLS-enabled server tables that intentionally have no client policies. Health Advisor reported no errors, warnings, or suggestions. The app is on a Free-tier Supabase project; leaked-password protection requires Pro or higher, and CAPTCHA is not enabled. Supabase's current docs: [password security](https://supabase.com/docs/guides/auth/password-security) and [Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha).
- **Vercel:** The eight required environment variables are configured as Production-only secrets. Their values were not revealed. Preview/deployment protection is enabled at Standard Protection, while the production domain remains public; source-map protection is enabled. The account dashboard still prompts to enable account-level 2FA.
- **Forwarded-IP runtime caveat:** The Vercel project switch is on, and code forwards only one validated Vercel client IP when the server key uses the `sb_secret_` format. The masked environment-variable view did not confirm the key format, so this review does not claim per-client Supabase Auth rate limiting is active at runtime. Do not reveal or paste the key to check it; confirm the key type privately in Vercel.

## Checks still needed

- The local Supabase/Docker database stack was unavailable, so pgTAP and real two-account RLS isolation tests were not run. Hosted RLS state and the event-trigger function grants were read back, but this is not a substitute for exercising cross-account access with two real test identities.
- No external penetration test, browser-based DAST, or production mailbox send/receive test was performed. Automated question tests use synthetic data and mock the model/provider. Five synthetic prompts were run against the live Groq simulator: supported project/profile and short education facts returned verified citations; unsupported pricing/service requests and prompt injection went to human review. All five matched their expected outcomes, and the simulator sent no email.
- Enable Vercel account-level 2FA in the account settings. This requires the account owner to complete their authenticator setup; the setting was not changed during this review.

## References

- [OWASP ASVS 5.0](https://asvs.owasp.org/)
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/)
- [OWASP GenAI Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS policy testing](https://supabase.com/docs/guides/database/postgres/testing-row-level-security)
- [Supabase Auth rate limits and forwarded client IP](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase leaked-password protection](https://supabase.com/docs/guides/auth/password-security)
- [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
