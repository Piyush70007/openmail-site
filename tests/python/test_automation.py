"""Mail handling regressions with an in-memory provider/database boundary."""
import unittest
from backend.automation import process_automatic_reply
from backend.core import APIError

OWNER = "11111111-1111-4111-8111-111111111111"
MAILBOX = "22222222-2222-4222-8222-222222222222"
DOMAIN = "33333333-3333-4333-8333-333333333333"
INBOUND = "44444444-4444-4444-8444-444444444444"
OUTBOUND = "55555555-5555-4555-8555-555555555555"

class MockMail:
    def __init__(self, enabled=True, quota=True, send_error=None, decision_error=None, workflows=None, **inbound):
        self.enabled, self.quota, self.send_error, self.decision_error = enabled, quota, send_error, decision_error
        self.inbound = {"id": INBOUND, "owner_id": OWNER, "mailbox_id": MAILBOX, "direction": "inbound", "from_address": "customer@example.org", "to_addresses": ["help@example.test"], "subject": "Hours", "text_body": "What are your support hours?", "folder": "inbox", "status": "received", "attachment_metadata": [], "ai_auto_submitted": False, **inbound}
        self.mailbox = {"id": MAILBOX, "address": "help@example.test", "domain_id": DOMAIN, "status": "active", "owner_id": OWNER}
        self.domain = {"id": DOMAIN, "status": "verified"}
        self.workflows = workflows or []
        self.job_inserted = False
        self.job_updates, self.outbound, self.sent_options = None, None, None
        self.sends = self.ai_calls = self.draft_calls = self.quota_calls = 0
        self.recent = []
        self.trust_events, self.paths = [], []

    async def database(self, path, options=None):
        options = options or {}
        self.paths.append((path, options))
        if path.startswith("messages?select=id,owner_id,"): return [self.inbound]
        if path.startswith("ai_mailbox_settings?"): return [{"auto_reply_enabled": self.enabled}]
        if path.startswith("ai_workflows?"): return self.workflows
        if path.startswith("ai_trust_events?"):
            self.trust_events.append(options["body"]); return []
        if path.startswith("ai_auto_reply_jobs?on_conflict="):
            if self.job_inserted: return []
            self.job_inserted = True; return [{"id": "job"}]
        if path.startswith("mailboxes?"): return [self.mailbox]
        if path.startswith("domains?"): return [self.domain]
        if path.startswith("ai_auto_reply_jobs?select=id&"): return self.recent
        if path.startswith("messages?select=id,status,"): return [self.outbound] if self.outbound else []
        if path == "messages" and options.get("method") == "POST":
            self.outbound = {"id": OUTBOUND, **options["body"]}; return [self.outbound]
        if path.startswith("messages?id=eq."):
            row = self.inbound if INBOUND in path else self.outbound
            if row is None: return []
            row.update(options.get("body") or {}); return [row]
        if path.startswith("ai_auto_reply_jobs?inbound_message_id="):
            self.job_updates = options["body"]
            # PostgREST rejects unknown camelCase columns; enforce the real database shape.
            allowed = {"status", "reason", "model", "representative_id", "workflow_id", "confidence", "evidence_source_ids", "updated_at", "reply_message_id"}
            unknown = set(self.job_updates) - allowed
            if unknown: raise APIError(400, "Unknown database columns: " + str(unknown))
            return [self.job_updates]
        raise AssertionError(path)

    async def consume_quota(self, owner, action):
        self.quota_calls += 1
        assert owner == OWNER and action == "email_send"
        return self.quota

    async def decide(self, *args):
        self.ai_calls += 1
        if self.decision_error: raise self.decision_error
        return {"decision": "auto_reply", "reply": "Our support hours are Monday through Friday, 9 to 5 CET.", "model": "fake", "confidence": 0.98, "citations": [{"source_id": "hours"}], "representativeId": "rep"}

    async def draft(self, *args):
        self.draft_calls += 1
        return {"draft": "Thanks for writing. Our support hours are Monday through Friday.", "model": "fake"}

    async def send(self, path, options):
        self.sends += 1; self.sent_options = options
        if self.send_error: raise self.send_error
        return {"id": "provider-message"}

    def overrides(self):
        return {"database": self.database, "readiness": lambda: {"mailReady": True}, "consumeQuota": self.consume_quota, "generateAutomaticDecision": self.decide, "generateReplyDraft": self.draft, "resend": self.send}

    async def run(self):
        return await process_automatic_reply(INBOUND, self.overrides())


def workflow(action, trigger="all_inbound", terms=None):
    return {"id": "workflow", "name": "Support", "trigger_mode": trigger, "match_terms": terms or [], "action": action, "representative_id": "rep", "enabled": True}

class AutomationTests(unittest.IsolatedAsyncioTestCase):
    async def test_optin_is_required_without_any_provider_call(self):
        mock = MockMail(enabled=False)
        self.assertEqual((await mock.run())["status"], "disabled")
        self.assertEqual((mock.sends, mock.ai_calls, mock.job_inserted), (0, 0, False))

    async def test_send_once_and_persist_actual_database_columns(self):
        mock = MockMail()
        result = await mock.run()
        self.assertEqual(result["status"], "auto_sent")
        self.assertEqual((mock.sends, mock.quota_calls), (1, 1))
        self.assertEqual(mock.outbound["status"], "sent")
        self.assertTrue(mock.outbound["ai_auto_sent"])
        self.assertEqual(mock.job_updates["status"], "auto_sent")
        self.assertEqual(mock.job_updates["representative_id"], "rep")
        self.assertEqual(mock.job_updates["evidence_source_ids"], ["hours"])
        self.assertEqual(mock.sent_options["headers"]["Idempotency-Key"], "openmail-ai-" + INBOUND)
        self.assertEqual(mock.sent_options["body"]["headers"]["Auto-Submitted"], "auto-replied")
        self.assertEqual((await mock.run())["status"], "already_processed")
        self.assertEqual(mock.sends, 1)
        for path, options in mock.paths:
            if options.get("method") == "PATCH": self.assertIn("owner_id=eq." + OWNER, path)

    async def test_unsafe_or_unverified_messages_never_reach_ai_or_sender(self):
        for fields, expected in [({"text_body": "Please refund my payment."}, "human_review"), ({"ai_auto_submitted": True}, "ignored"), ({"from_address": "no-reply@example.org"}, "ignored"), ({"from_address": "help@example.test"}, "ignored"), ({"attachment_metadata": [{}]}, "human_review")]:
            mock = MockMail(**fields)
            self.assertEqual((await mock.run())["status"], expected)
            self.assertEqual((mock.sends, mock.ai_calls), (0, 0))
        mock = MockMail(); mock.domain["status"] = "pending"
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertEqual((mock.sends, mock.ai_calls), (0, 0))

    async def test_rate_limit_recent_reply_and_send_quota(self):
        mock = MockMail(); mock.recent = [{"id": "recent"}]
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertEqual((mock.sends, mock.ai_calls), (0, 0))
        mock = MockMail(quota=False)
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertIsNone(mock.outbound)
        self.assertEqual(mock.sends, 0)

    async def test_failed_provider_send_does_not_show_as_sent(self):
        mock = MockMail(send_error=APIError(502, "synthetic timeout"))
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertEqual(mock.outbound["status"], "failed")
        self.assertEqual(mock.outbound["folder"], "drafts")
        self.assertFalse(mock.outbound["ai_auto_sent"])
        self.assertIn("Check Sent", mock.inbound["ai_handoff_reason"])
        self.assertEqual((await mock.run())["status"], "already_processed")
        self.assertEqual(mock.sends, 1)

    async def test_failed_inference_never_calls_send(self):
        mock = MockMail(decision_error=APIError(502, "synthetic inference failure"))
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertIn("No reply was sent", mock.inbound["ai_handoff_reason"])
        self.assertEqual(mock.sends, 0)
        self.assertIsNone(mock.outbound)

    async def test_workflow_routing_and_draft_never_send(self):
        mock = MockMail(workflows=[workflow("route_to_rep")])
        self.assertEqual((await mock.run())["status"], "workflow_routed")
        self.assertEqual(mock.inbound["ai_representative_id"], "rep")
        self.assertEqual((mock.sends, mock.ai_calls), (0, 0))
        mock = MockMail(workflows=[workflow("create_draft")])
        self.assertEqual((await mock.run())["status"], "draft_created")
        self.assertEqual(mock.outbound["folder"], "drafts")
        self.assertFalse(mock.outbound["ai_auto_sent"])
        self.assertEqual((mock.sends, mock.draft_calls), (0, 1))

    async def test_workflows_cannot_bypass_optin_or_safety_or_match(self):
        mock = MockMail(enabled=False, workflows=[workflow("verified_reply")])
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertIn("separately enabled", mock.inbound["ai_handoff_reason"])
        self.assertEqual((mock.sends, mock.ai_calls), (0, 0))
        mock = MockMail(workflows=[workflow("create_draft")], text_body="Please refund my payment")
        self.assertEqual((await mock.run())["status"], "human_review")
        self.assertEqual((mock.sends, mock.draft_calls), (0, 0))
        mock = MockMail(workflows=[workflow("route_to_rep", "contains_any", ["invoice"])])
        self.assertEqual((await mock.run())["status"], "no_matching_workflow")
        self.assertEqual((mock.sends, mock.ai_calls), (0, 0))

    async def test_previously_sent_reply_is_never_resent(self):
        mock = MockMail(); mock.outbound = {"id": OUTBOUND, "status": "sent", "subject": "Re: Hours"}
        self.assertEqual(await mock.run(), {"status": "auto_sent", "duplicate": True})
        self.assertEqual(mock.sends, 0)
