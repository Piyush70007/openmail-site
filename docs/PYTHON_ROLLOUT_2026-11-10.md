# Python production rollout — November 10, 2026

## Release identity and scope

| Item | Recorded value |
| --- | --- |
| Production website | https://freeopenmail.tech |
| Vercel project | `openmail-site` |
| Promoted Python commit | `955d605` |
| Candidate deployment reference | `F2z16Lckd` |
| Promotion time | 2026-11-10 21:57:40 UTC |
| Previous production deployment | `2cCQQHm8HD6KhmiUnLw2Eo652Xe7` |
| Previous Node commit | `611f128` |
| Repository rollout status | Final merge into `main` pending |

The production backend is Python 3.14/FastAPI. Browser assets, public API URLs,
database schema, DNS, environment variables, company knowledge and mailbox
automatic-reply settings were unchanged during the live checks. No provider keys
were copied into Preview. A staged Production deployment used the existing
Production configuration; its protection prevented direct webhook testing until
the production domain was promoted.

This record contains test identifiers and outcomes, not credentials, personal
email addresses, session tokens or message bodies. It is an engineering rollout
record, not a security certification or a guarantee of failure-free operation.

## Automated and deployment verification

- 151 Python tests and 328 subtests passed.
- All 50 retained Node tests passed, and GitHub Actions passed for the migration.
- The runtime dependency audit found no known vulnerabilities. `uv.lock` pins the
  Vercel runtime graph, with a regression check against the audited requirements.
- Vercel built one Python 3.14 function, approximately 15.7 MB, with a 60-second
  maximum invocation duration.
- All 14 browser assets remained byte-for-byte unchanged.
- Production status and session endpoints returned HTTP 200, with services ready.
- Private source and environment-file requests returned HTTP 404; origin-less
  logout returned HTTP 403; an unsigned webhook returned HTTP 401.
- The configured security headers were present.

The negative automation tests assert no send for disabled automation, sensitive
requests, attachments, system/self senders, unverified domains, sender cooldown,
quota exhaustion, inference failure and workflow opt-in failures. They also check
send deduplication and preservation of actual database column names. These are
mocked-provider regression tests; the following results supply separate live
evidence.

## Login and existing-session renewal

Normal owner login and reload succeeded on the staged Python deployment. After
promotion, the pre-existing production cookie restored the same owned mailbox
and its 11 messages.

Read-only inspection of Supabase `auth.sessions` recorded:

| Session | Created at (UTC) | Updated at (UTC) | Matching observed action |
| --- | --- | --- | --- |
| Pre-existing production session | 2026-10-31 22:50:04.877259 | 2026-11-10 21:58:02.852158 | Production reload after Python promotion restored the owned mailbox |
| Staged login session | 2026-11-10 20:34:20.1188 | 2026-11-10 21:56:50.4103 | Staged Python reload restored the owned mailbox |

The session updates, together with successful mailbox restoration, provide the
recorded evidence of renewal across both deployments. No access or refresh tokens
were read. The auth audit-log query returned no rows, so this result is not
attributed to an auth audit event or a captured token-exchange trace.

## Live automatic-reply test

Both OpenMail mailbox tabs were closed before the controlled test emails were
sent. The positive question requested a fact present in approved company
knowledge.

| Evidence | Value |
| --- | --- |
| Test tag | `OpenMail Python release check 20261110-A` |
| Inbound received | 2026-11-10 22:00:39 UTC |
| Inbound OpenMail message ID | `96fe0eeb-6b52-49a4-965a-7f6837788aea` |
| Inbound provider email ID | `549634ee-4461-4dde-a3f9-51e3fae7b935` |
| Automation completed | 2026-11-10 22:00:48.097 UTC |
| Job result | `auto_sent` |
| Model | `openai/gpt-oss-20b` |
| Confidence | `0.95` |
| Verified evidence source | `profile:company_description` |
| Outbound OpenMail message ID | `054c442e-8575-4463-ab7c-4eb1024a67f2` |
| Outbound provider email ID | `01a1c77a-5b83-7e47-bfeb-00863d331788` |
| Outbound count and state | Exactly one; marked sent |
| Recipient evidence | Reply observed in the owner's Gmail inbox; education facts matched the approved source |

The completed job and actual recipient delivery establish that the deployed
Python webhook/background path generated and sent this supported reply without
an open mailbox tab. They do not establish behavior under load or every provider
failure mode.

## Live human-handoff test

The second controlled message requested sensitive account information.

| Evidence | Value |
| --- | --- |
| Test tag | `OpenMail Python handover check 20261110-B` |
| Inbound received | 2026-11-10 22:02:39.944 UTC |
| Inbound OpenMail message ID | `a931e185-85d0-4680-baad-09bca7fa06d7` |
| Inbound provider email ID | `a02e7a5b-c6c4-4bcd-80c5-7214794bec0d` |
| Automation completed | 2026-11-10 22:02:42.891 UTC |
| Job result | `human_review` |
| Reason category | Sensitive account information |
| Inbox handoff state | Pending human review |
| Outbound replies | Zero |

The explicit human-review result and zero linked outbound records are the
negative-test evidence; absence of a visible reply alone would not establish it.

## Duplicate-delivery check and remaining work

The positive Resend event was manually replayed and the live duplicate-delivery
check passed:

| Evidence | Value |
| --- | --- |
| Resend event ID | `msg_3LvwqBAeb65SO1JH09HtgiOf5bz` |
| Delivery attempts | 2 |
| Replay response | HTTP 200, `{"ok":true}` |
| Linked outbound messages after replay | Exactly one |
| Successful automation job timestamp | Unchanged after replay |

These observations confirm that replaying this event did not generate or send a
second reply. They do not represent a concurrent-delivery stress test.

Before closing the rollout record:

1. Record the final merge commit and the production deployment serving it.
2. Recheck the production session/status and mailbox after the final deployment.

## Failure handling and rollback

Restore previous production deployment `2cCQQHm8HD6KhmiUnLw2Eo652Xe7` if the
cutover causes broken sessions, missing inbound persistence, duplicate sends or
failed automation. No schema rollback or data conversion is required.

An HTTP 200 webhook response is not proof that its background automation finished.
Inspect the matching job and provider record when a job remains `processing`
beyond the invocation window. Preserve the job claim, inbound ID and provider ID
while determining whether a send occurred. Replaying the webhook or restoring
the old deployment does not automatically reprocess an already-claimed job.
Do not clear those claims merely to force another attempt at an ambiguous send.
