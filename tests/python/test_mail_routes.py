"""Mail API regression tests. All providers are mocked; no email is sent."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlencode

import dns.exception
import dns.resolver
from starlette.requests import Request

from backend import mail_routes as routes
from backend.core import APIError

OWNER = "11111111-1111-4111-8111-111111111111"
MAILBOX = "22222222-2222-4222-8222-222222222222"
DOMAIN = "33333333-3333-4333-8333-333333333333"
MESSAGE = "44444444-4444-4444-8444-444444444444"
REQUEST_ID = "55555555-5555-4555-8555-555555555555"
USER = {"id": OWNER, "email": "owner@example.test", "emailConfirmed": True}
MAILBOX_ROW = {"id": MAILBOX, "domain_id": DOMAIN, "address": "support@example.test", "status": "active"}
DOMAIN_ROW = {"id": DOMAIN, "domain_name": "example.test", "status": "verified", "provider_domain_id": "provider-domain"}


def request(method="GET", body=None, query=None, item_id=MESSAGE, origin="https://openmail.example"):
    raw = json.dumps(body or {}).encode()
    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}
    headers = [(b"host", b"openmail.example"), (b"x-forwarded-proto", b"https")]
    if origin:
        headers.append((b"origin", origin.encode()))
    return Request({"type": "http", "http_version": "1.1", "method": method,
                    "scheme": "https", "path": "/api/messages", "query_string": urlencode(query or {}).encode(),
                    "headers": headers, "path_params": {"id": item_id}}, receive)


def payload(response):
    return json.loads(response.body)


def filters(path):
    return {key: values[0] for key, values in parse_qs(path.split("?", 1)[1]).items()}


class MailRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.auth = self.enterContext(patch.object(routes, "signed_in", AsyncMock(return_value=USER)))
        self.ready = self.enterContext(patch.object(routes, "readiness", return_value={"mailReady": True}))
        self.db = self.enterContext(patch.object(routes, "database", AsyncMock(return_value=[])))
        self.provider = self.enterContext(patch.object(routes, "resend", AsyncMock(return_value={"id": "provider-email"})))
        self.quota = self.enterContext(patch.object(routes, "require_quota", AsyncMock()))
        async def owned(table, row_id, owner, select="*"):
            if owner != OWNER:
                return None
            if table == "mailboxes" and row_id == MAILBOX:
                return MAILBOX_ROW
            if table == "domains" and row_id == DOMAIN:
                return DOMAIN_ROW
            return None
        self.owned = self.enterContext(patch.object(routes, "owned_row", AsyncMock(side_effect=owned)))

    def send_body(self, **updates):
        return {"mailboxId": MAILBOX, "to": "Recipient@Example.test", "subject": " Subject ",
                "text": " Message ", "requestId": REQUEST_ID, **updates}

    async def test_foreign_mailbox_does_not_query_messages_or_send(self):
        foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        response = await routes.messages(request(query={"mailboxId": foreign}))
        self.assertEqual(response.status_code, 404)
        self.db.assert_not_awaited()
        response = await routes.send_message(request("POST", self.send_body(mailboxId=foreign)))
        self.assertEqual(response.status_code, 404)
        self.provider.assert_not_awaited()

    async def test_all_views_keep_owner_and_mailbox_filters(self):
        expectations = {
            "inbox": {"folder": "eq.inbox"}, "sent": {"folder": "eq.sent"},
            "archive": {"folder": "eq.archive"}, "spam": {"folder": "eq.spam"},
            "trash": {"folder": "eq.trash"}, "drafts": {"folder": "eq.drafts"},
            "starred": {"starred": "eq.true", "folder": "neq.trash"},
            "ai_sent": {"direction": "eq.outbound", "folder": "eq.sent", "status": "eq.sent", "ai_auto_sent": "eq.true"},
            "needs_review": {"direction": "eq.inbound", "folder": "neq.trash", "ai_handoff_status": "eq.pending"},
        }
        for view, expected in expectations.items():
            response = await routes.messages(request(query={"mailboxId": MAILBOX, "view": view}))
            self.assertEqual(response.status_code, 200)
            actual = filters(self.db.await_args.args[0])
            self.assertEqual(actual["owner_id"], f"eq.{OWNER}")
            self.assertEqual(actual["mailbox_id"], f"eq.{MAILBOX}")
            self.assertEqual(actual["limit"], "100")
            for key, value in expected.items():
                self.assertEqual(actual[key], value)

    async def test_browser_mutations_require_same_origin(self):
        cases = [(routes.messages, "POST"), (routes.message_detail, "PATCH"),
                 (routes.send_message, "POST"), (routes.domains, "POST"),
                 (routes.verify_domain, "POST"), (routes.mailboxes, "POST")]
        for handler, verb in cases:
            for origin in (None, "https://attacker.example", "http://openmail.example"):
                with self.assertRaises(APIError) as caught:
                    await handler(request(verb, self.send_body(), origin=origin))
                self.assertEqual(caught.exception.status, 403)
        self.db.assert_not_awaited()
        self.provider.assert_not_awaited()

    async def test_new_draft_preserves_payload_and_ownership(self):
        self.db.side_effect = [[], [{"id": MESSAGE, "folder": "drafts"}]]
        response = await routes.messages(request("POST", {"action": "saveDraft", **self.send_body()}))
        self.assertEqual(response.status_code, 201)
        record = self.db.await_args.args[1]["body"]
        self.assertEqual(record["owner_id"], OWNER)
        self.assertEqual(record["mailbox_id"], MAILBOX)
        self.assertEqual(record["subject"], " Subject ")
        self.assertEqual(record["text_body"], " Message ")
        self.assertEqual(record["folder"], "drafts")
        self.provider.assert_not_awaited()

    async def test_reusing_draft_request_in_another_mailbox_is_rejected(self):
        self.db.return_value = [{"id": MESSAGE, "mailbox_id": DOMAIN, "folder": "drafts"}]
        response = await routes.messages(request("POST", {"action": "saveDraft", **self.send_body()}))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.db.await_count, 1)

    async def test_existing_draft_update_is_limited_to_owner_and_draft_folder(self):
        self.db.side_effect = [[{"id": MESSAGE, "mailbox_id": MAILBOX, "folder": "drafts"}], [{"id": MESSAGE}]]
        response = await routes.messages(request("POST", {"action": "saveDraft", **self.send_body()}))
        self.assertEqual(response.status_code, 200)
        actual = filters(self.db.await_args.args[0])
        self.assertEqual(actual, {"id": f"eq.{MESSAGE}", "owner_id": f"eq.{OWNER}", "folder": "eq.drafts"})

    async def test_bulk_archive_scopes_every_update(self):
        self.db.return_value = [{"id": MESSAGE, "folder": "archive"}]
        response = await routes.messages(request("PATCH", {"mailboxId": MAILBOX, "ids": [MESSAGE], "action": "archive"}))
        self.assertEqual(payload(response), {"ok": True, "updated": 1})
        actual = filters(self.db.await_args.args[0])
        self.assertEqual(actual["owner_id"], f"eq.{OWNER}")
        self.assertEqual(actual["mailbox_id"], f"eq.{MAILBOX}")
        self.assertEqual(self.db.await_args.args[1]["body"], {"folder": "archive"})

    async def test_bulk_rejects_invalid_ids_and_more_than_100(self):
        for ids in ([], ["1),owner_id.neq.null"], [MESSAGE] * 101):
            response = await routes.messages(request("PATCH", {"mailboxId": MAILBOX, "ids": ids, "action": "trash"}))
            self.assertEqual(response.status_code, 400)
        self.db.assert_not_awaited()

    async def test_star_read_archive_and_handoff_updates_are_owner_scoped(self):
        self.db.return_value = [{"id": MESSAGE}]
        for action in ("star", "read", "unread", "archive", "spam", "trash", "inbox", "resolveHandoff"):
            response = await routes.message_detail(request("PATCH", {"action": action, "starred": True}))
            self.assertEqual(response.status_code, 200)
            actual = filters(self.db.await_args.args[0])
            self.assertEqual(actual["owner_id"], f"eq.{OWNER}")
            self.assertEqual(actual["id"], f"eq.{MESSAGE}")
            if action == "resolveHandoff":
                self.assertEqual(actual["direction"], "eq.inbound")
                self.assertEqual(actual["ai_handoff_status"], "eq.pending")

    async def test_draft_edit_cannot_rewrite_received_or_sent_message(self):
        response = await routes.message_detail(request("PATCH", {"action": "draft", "text": "new"}))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(filters(self.db.await_args.args[0])["folder"], "eq.drafts")

    async def test_duplicate_send_is_returned_without_provider_or_quota(self):
        sent = {"id": MESSAGE, "status": "sent", "provider_email_id": "provider-email"}
        self.db.return_value = [sent]
        response = await routes.send_message(request("POST", self.send_body()))
        self.assertEqual(payload(response), {"ok": True, "message": sent})
        self.provider.assert_not_awaited()
        self.quota.assert_not_awaited()

    async def test_in_progress_send_does_not_send_again(self):
        self.db.return_value = [{"id": MESSAGE, "status": "sending"}]
        response = await routes.send_message(request("POST", self.send_body()))
        self.assertEqual(response.status_code, 409)
        self.provider.assert_not_awaited()

    async def test_send_persists_before_provider_and_keeps_idempotency_key(self):
        events = []
        async def db(path, options=None):
            if options and options.get("method") == "POST":
                events.append("saved")
                self.assertEqual(options["body"]["status"], "sending")
                return [{"id": MESSAGE, "status": "sending"}]
            if options and options.get("method") == "PATCH":
                events.append("marked-sent")
                self.assertEqual(filters(path)["owner_id"], f"eq.{OWNER}")
                return [{"id": MESSAGE, "status": "sent"}]
            return []
        async def provider(path, options=None):
            events.append("provider")
            self.assertEqual(options["headers"]["Idempotency-Key"], REQUEST_ID)
            self.assertEqual(options["body"], {"from": "support@example.test", "to": ["recipient@example.test"],
                                               "subject": "Subject", "text": "Message"})
            return {"id": "provider-email"}
        self.db.side_effect, self.provider.side_effect = db, provider
        response = await routes.send_message(request("POST", self.send_body()))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events, ["saved", "provider", "marked-sent"])
        self.quota.assert_awaited_once_with(OWNER, "email_send")

    async def test_draft_send_failure_restores_draft(self):
        self.db.side_effect = [[], [{"id": MESSAGE, "status": "draft"}], None, None]
        self.provider.side_effect = APIError(502, "provider unavailable")
        with self.assertRaises(APIError):
            await routes.send_message(request("POST", self.send_body(draftId=MESSAGE)))
        self.assertEqual(self.db.await_args.args[1]["body"], {"status": "draft", "folder": "drafts"})
        draft_query = filters(self.db.await_args_list[1].args[0])
        self.assertEqual(draft_query["owner_id"], f"eq.{OWNER}")
        self.assertEqual(draft_query["mailbox_id"], f"eq.{MAILBOX}")

    async def test_send_validation_rejects_header_injection(self):
        for to in ("bad\nBcc: victim@example.test", "x@example.test>evil", "invalid", ["a@example.test"] * 11):
            response = await routes.send_message(request("POST", self.send_body(to=to)))
            self.assertEqual(response.status_code, 400)
        self.provider.assert_not_awaited()
        self.db.assert_not_awaited()

    async def test_subject_limits_count_utf16_units_like_browser(self):
        for handler, body in (
            (routes.send_message, self.send_body(subject="😀" * 101)),
            (routes.messages, {"action": "saveDraft", **self.send_body(subject="😀" * 101)}),
            (routes.message_detail, {"action": "draft", "subject": "😀" * 101}),
        ):
            verb = "PATCH" if handler is routes.message_detail else "POST"
            response = await handler(request(verb, body))
            self.assertEqual(response.status_code, 400)
        self.db.assert_not_awaited()
        self.provider.assert_not_awaited()

    async def test_unicode_recipient_limits_match_previous_backend(self):
        # 126 supplementary characters plus '@a.test' exceed 254 UTF-16 units.
        recipient = "😀" * 126 + "@a.test"
        self.assertFalse(routes.valid_address(recipient))
        for handler, body in (
            (routes.send_message, self.send_body(to=recipient)),
            (routes.messages, {"action": "saveDraft", **self.send_body(to=recipient)}),
            (routes.message_detail, {"action": "draft", "to": recipient}),
        ):
            verb = "PATCH" if handler is routes.message_detail else "POST"
            response = await handler(request(verb, body))
            self.assertEqual(response.status_code, 400)
        self.db.assert_not_awaited()

    def test_preview_clipping_keeps_valid_unicode_within_existing_limit(self):
        self.assertEqual(routes.js_len("😀" * 100), 200)
        self.assertEqual(routes.preview_text("😀" * 100), "😀" * 90)
        self.assertEqual(routes.preview_text("a" * 179 + "😀"), "a" * 179)
        self.assertEqual(routes.preview_text("a" * 181), "a" * 180)

    async def test_domain_and_mailbox_lists_scope_current_owner(self):
        for handler in (routes.domains, routes.mailboxes):
            response = await handler(request())
            self.assertEqual(response.status_code, 200)
            self.assertEqual(filters(self.db.await_args.args[0])["owner_id"], f"eq.{OWNER}")

    async def test_domain_creation_does_not_duplicate_provider_resource(self):
        self.db.return_value = [{"id": DOMAIN}]
        response = await routes.domains(request("POST", {"domain": "EXAMPLE.test."}))
        self.assertEqual(response.status_code, 409)
        self.provider.assert_not_awaited()

    async def test_domain_verification_checks_ownership_first(self):
        response = await routes.verify_domain(request("POST", item_id=MESSAGE))
        self.assertEqual(response.status_code, 404)
        self.provider.assert_not_awaited()

    async def test_domain_verification_refreshes_after_provider_already_verifying(self):
        self.owned.side_effect = None
        self.owned.return_value = {**DOMAIN_ROW, "dns_records": [{"type": "MX"}]}
        self.provider.side_effect = [APIError(400, "Already verifying"), {"status": "verified"}]
        self.db.return_value = [{**DOMAIN_ROW, "dns_records": [{"type": "MX"}]}]
        response = await routes.verify_domain(request("POST", item_id=DOMAIN))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.provider.await_count, 2)
        self.assertEqual(self.db.await_args.args[1]["body"], {"status": "verified", "dns_records": [{"type": "MX"}]})
        self.assertEqual(filters(self.db.await_args.args[0])["owner_id"], f"eq.{OWNER}")

    async def test_unconfirmed_user_cannot_create_mail_resources_or_send(self):
        self.auth.return_value = {**USER, "emailConfirmed": False}
        for handler in (routes.domains, routes.mailboxes, routes.verify_domain, routes.send_message):
            with self.assertRaises(APIError) as caught:
                await handler(request("POST", self.send_body(), item_id=DOMAIN))
            self.assertEqual(caught.exception.status, 403)
        self.provider.assert_not_awaited()
        self.db.assert_not_awaited()

    async def test_unsupported_methods_do_not_reach_providers(self):
        for handler in (routes.domains, routes.mailboxes, routes.verify_domain,
                        routes.messages, routes.message_detail, routes.send_message):
            with self.assertRaises(APIError) as caught:
                await handler(request("DELETE"))
            self.assertEqual(caught.exception.status, 405)
        self.db.assert_not_awaited()
        self.provider.assert_not_awaited()

    async def test_verified_domain_can_create_mailbox(self):
        self.db.return_value = [{"id": MAILBOX}]
        response = await routes.mailboxes(request("POST", {"domainId": DOMAIN, "localPart": "Support"}))
        self.assertEqual(response.status_code, 201)
        self.quota.assert_awaited_once_with(OWNER, "mailbox_create")
        body = self.db.await_args.args[1]["body"]
        self.assertEqual(body["owner_id"], OWNER)
        self.assertEqual(body["address"], "support@example.test")

    async def test_mailbox_creation_requires_owned_verified_domain(self):
        self.owned.return_value = None
        self.owned.side_effect = None
        response = await routes.mailboxes(request("POST", {"domainId": DOMAIN, "localPart": "support"}))
        self.assertEqual(response.status_code, 404)
        self.owned.return_value = {**DOMAIN_ROW, "status": "pending"}
        response = await routes.mailboxes(request("POST", {"domainId": DOMAIN, "localPart": "support"}))
        self.assertEqual(response.status_code, 409)
        self.db.assert_not_awaited()

    async def test_mx_lookup_returns_found_missing_and_unavailable_states(self):
        with patch.object(routes.dns.asyncresolver, "resolve", AsyncMock()) as resolve:
            resolve.return_value = [SimpleNamespace(preference=20, exchange="backup.example.test."),
                                    SimpleNamespace(preference=10, exchange="mail.example.test.")]
            response = await routes.domains(request(query={"check": "EXAMPLE.test."}))
            data = payload(response)
            self.assertEqual(data["mxLookup"], "found")
            self.assertEqual(data["mx"][0], {"priority": 10, "host": "mail.example.test"})
            resolve.assert_awaited_with("example.test", "MX")
            for error, expected, existing in ((dns.resolver.NXDOMAIN(), "not-found", False),
                                               (dns.resolver.NoAnswer(), "not-found", False),
                                               (dns.exception.Timeout(), "unavailable", None)):
                resolve.side_effect = error
                response = await routes.domains(request(query={"check": "example.test"}))
                self.assertEqual(payload(response)["mxLookup"], expected)
                self.assertEqual(payload(response)["existingMailRoute"], existing)

    def test_domain_validation_handles_international_names_and_invalid_labels(self):
        self.assertEqual(routes.normalize_domain(" BÜCHER.example. "), "xn--bcher-kva.example")
        self.assertEqual(routes.normalize_domain("faß.example"), "xn--fa-hia.example")
        for value in ("localhost", "https://example.com", "-bad.example", "bad_.example", "a..example", "a" * 64 + ".com"):
            self.assertEqual(routes.normalize_domain(value), "")


if __name__ == "__main__":
    unittest.main()
