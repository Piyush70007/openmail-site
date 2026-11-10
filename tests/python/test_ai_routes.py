"""Regression checks for the Python AI management and evaluation API."""
import hashlib
import json
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from starlette.requests import Request
from backend import ai_platform as platform, ai_setup as setup
from backend.core import APIError

OWNER = '11111111-1111-4111-8111-111111111111'
MAILBOX = '22222222-2222-4222-8222-222222222222'
MESSAGE = '33333333-3333-4333-8333-333333333333'
REP = '44444444-4444-4444-8444-444444444444'
OTHER = '55555555-5555-4555-8555-555555555555'
USER = {'id': OWNER, 'emailConfirmed': True}
REPRESENTATIVE = {'id': REP, 'owner_id': OWNER, 'kind': 'support', 'display_name': 'Support', 'enabled': True}
MAIL = {'id': MAILBOX, 'domain_id': OTHER, 'address': 'support@example.test', 'status': 'active', 'owner_id': OWNER}


def request(verb='GET', body=None, query='', origin='http://testserver'):
    headers = [(b'host', b'testserver'), (b'x-forwarded-proto', b'http')]
    if origin:
        headers.append((b'origin', origin.encode()))
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {'type': 'http.disconnect'}
        sent = True
        return {'type': 'http.request', 'body': json.dumps(body or {}).encode(), 'more_body': False}

    return Request({'type': 'http', 'method': verb, 'path': '/', 'query_string': query.encode(),
                    'headers': headers, 'scheme': 'http', 'server': ('testserver', 80)}, receive)


def payload(response):
    return json.loads(response.body)


class PureAIPlatformTests(unittest.TestCase):
    def test_simulator_requires_validated_evidence_and_threshold(self):
        answer = {'decision': 'auto_reply', 'evidenceValidated': True, 'citations': [{'source_id': 'facts'}], 'confidence': .8}
        self.assertTrue(platform.evaluate_simulation('auto_reply', answer)['passed'])
        for changes in ({'evidenceValidated': False}, {'citations': []}, {'confidence': .799}, {'confidence': 'not-a-number'}):
            self.assertFalse(platform.evaluate_simulation('auto_reply', {**answer, **changes})['passed'])
        self.assertTrue(platform.evaluate_simulation('human_review', {'decision': 'human_review'})['passed'])
        self.assertFalse(platform.evaluate_simulation('human_review', {})['passed'])

    def test_feedback_only_rates_generated_answers(self):
        self.assertTrue(platform.feedback_allowed('auto_sent', 'correct'))
        self.assertTrue(platform.feedback_allowed('draft_created', 'correction'))
        self.assertFalse(platform.feedback_allowed('human_review', 'correction'))
        self.assertTrue(platform.feedback_allowed('workflow_applied', 'resolved'))
        for outcome in platform.FEEDBACK:
            self.assertFalse(platform.feedback_allowed('ignored', outcome))

    def test_workflow_matching_keeps_normalization_and_opt_in(self):
        rule = {'enabled': True, 'trigger_mode': 'contains_any', 'match_terms': ['INVOICE']}
        self.assertTrue(platform.workflow_matches(rule, {'subject': 'An ＩＮＶＯＩＣＥ question'}))
        self.assertFalse(platform.workflow_matches(rule, {'subject': 'Opening hours'}))
        self.assertFalse(platform.workflow_matches({**rule, 'enabled': False}, {'subject': 'Invoice'}))
        self.assertTrue(platform.workflow_matches({**rule, 'trigger_mode': 'all_inbound'}, {}))


class AIRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_mutating_ai_routes_reject_missing_or_foreign_origin_before_auth(self):
        routes = [(setup.profile, 'PATCH'), (setup.knowledge, 'POST'), (setup.knowledge, 'DELETE'),
                  (setup.documents, 'POST'), (setup.documents, 'DELETE'), (setup.mailbox_settings, 'PATCH'),
                  (platform.simulator, 'POST'), (platform.representatives, 'PATCH'),
                  (platform.workflows, 'POST'), (platform.workflows, 'DELETE'), (platform.trust, 'POST')]
        with patch.object(setup, 'signed_in', new_callable=AsyncMock) as setup_auth, patch.object(platform, 'signed_in', new_callable=AsyncMock) as platform_auth:
            for handler, verb in routes:
                for origin in (None, 'https://attacker.test'):
                    with self.subTest(handler=handler.__name__, verb=verb, origin=origin):
                        with self.assertRaises(APIError) as error:
                            await handler(request(verb, origin=origin))
                        self.assertEqual(error.exception.status, 403)
            setup_auth.assert_not_awaited()
            platform_auth.assert_not_awaited()

    async def test_representative_lookup_filters_owner_and_rechecks_returned_owner(self):
        db = AsyncMock(return_value=[{**REPRESENTATIVE, 'owner_id': OTHER}])
        self.assertIsNone(await platform.get_owned_representative(OWNER, REP, db=db))
        self.assertIn(f'owner_id=eq.{OWNER}', db.call_args.args[0])
        db.return_value = [{**REPRESENTATIVE, 'enabled': False}]
        self.assertIsNone(await platform.get_owned_representative(OWNER, REP, require_enabled=True, db=db))
        self.assertIsNotNone(await platform.get_owned_representative(OWNER, REP, db=db))
        db.reset_mock()
        self.assertIsNone(await platform.get_owned_representative(OWNER, 'bad&id=other', db=db))
        db.assert_not_awaited()

    async def test_context_scopes_knowledge_and_excludes_test_pricing_and_policies(self):
        calls = []
        async def db(path, options=None):
            calls.append(path)
            if path.startswith('rpc/'):
                return [REPRESENTATIVE]
            if path.startswith('ai_profiles?'):
                return [{'enabled': True, 'company_name': 'Example', 'business_hours': 'Weekdays', 'policies': 'Ask for review if unsupported.'}]
            if path.startswith('ai_knowledge_entries?'):
                return [{'id': 'good', 'title': 'Hours', 'content': 'Weekdays 9–5'}, {'id': 'bad', 'title': 'Test pricing', 'content': 'Price $10'}]
            return [{'id': 'real', 'file_name': 'services.pdf', 'extracted_text': 'We build APIs.'}, {'id': 'fake', 'file_name': 'sample-price-list.pdf', 'extracted_text': 'Cost $100'}]
        with patch.object(platform, 'config', return_value={'groqKey': 'synthetic'}):
            context = await platform.approved_context(OWNER, REP, db)
        ids = {item['id'] for item in context['sources']}
        self.assertIn('note:good', ids)
        self.assertIn('document:real', ids)
        self.assertNotIn('note:bad', ids)
        self.assertNotIn('document:fake', ids)
        self.assertNotIn('profile:policies', ids)
        self.assertEqual(context['operationalPolicies'], 'Ask for review if unsupported.')
        for path in calls:
            if path.startswith(('ai_knowledge_entries?', 'ai_knowledge_documents?')):
                params = parse_qs(urlsplit(path).query)
                self.assertEqual(params['owner_id'], [f'eq.{OWNER}'])
                self.assertEqual(params['or'], [f'(representative_id.is.null,representative_id.eq.{REP})'])

    async def test_disabled_profile_disables_only_owners_automatic_mailboxes(self):
        with patch.object(setup, 'signed_in', AsyncMock(return_value=USER)), patch.object(setup, 'database', AsyncMock(return_value=[{'enabled': False}])) as db:
            response = await setup.profile(request('PATCH', {'companyName': 'Example', 'enabled': False}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.call_args_list[1].args[0], f'ai_mailbox_settings?owner_id=eq.{OWNER}')
        self.assertFalse(db.call_args_list[1].args[1]['body']['auto_reply_enabled'])
        self.assertEqual(db.call_args_list[0].args[1]['body']['reply_mode'], 'draft')

    async def test_document_upload_checks_rep_before_storage(self):
        body = {'fileName': 'notes.txt', 'mimeType': 'text/plain', 'extractedText': 'Approved facts', 'representativeId': OTHER}
        with patch.object(setup, 'signed_in', AsyncMock(return_value=USER)), patch.object(setup, 'get_owned_representative', AsyncMock(return_value=None)), patch.object(setup, 'database', new_callable=AsyncMock) as db:
            response = await setup.documents(request('POST', body))
        self.assertEqual(response.status_code, 400)
        db.assert_not_awaited()

    async def test_document_upload_hashes_text_and_uses_rep_specific_rpc(self):
        body = {'fileName': '../approved.pdf', 'mimeType': 'application/pdf', 'extractedText': ' Approved facts ', 'representativeId': REP}
        with patch.object(setup, 'signed_in', AsyncMock(return_value=USER)), patch.object(setup, 'get_owned_representative', AsyncMock(return_value=REPRESENTATIVE)), patch.object(setup, 'database', AsyncMock(side_effect=[[{'enabled': True}], {'id': MESSAGE}])) as db:
            response = await setup.documents(request('POST', body))
        self.assertEqual(response.status_code, 201)
        path, options = db.call_args.args
        self.assertEqual(path, 'rpc/save_openmail_ai_document_for_rep')
        self.assertEqual(options['body']['p_representative'], REP)
        self.assertEqual(options['body']['p_owner'], OWNER)
        self.assertEqual(options['body']['p_file_name'], '..approved.pdf')
        self.assertEqual(options['body']['p_content_hash'], hashlib.sha256(b'Approved facts').hexdigest())

    async def test_document_deletion_cannot_cross_accounts(self):
        with patch.object(setup, 'signed_in', AsyncMock(return_value=USER)), patch.object(setup, 'database', AsyncMock(return_value=[])) as db:
            response = await setup.documents(request('DELETE', query=f'id={MESSAGE}'))
        self.assertEqual(response.status_code, 404)
        self.assertIn(f'owner_id=eq.{OWNER}', db.call_args.args[0])

    async def test_automatic_mailbox_requires_explicit_confirmation(self):
        with patch.object(setup, 'signed_in', AsyncMock(return_value=USER)), patch.object(setup, 'database', AsyncMock(side_effect=[[MAIL], []])) as db, patch.object(setup, 'ensure_representatives', AsyncMock(return_value=[REPRESENTATIVE])), patch.object(setup, 'get_owned_representative', AsyncMock(return_value=REPRESENTATIVE)):
            response = await setup.mailbox_settings(request('PATCH', {'mailboxId': MAILBOX, 'enabled': True, 'representativeId': REP}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('Confirm', payload(response)['error'])
        self.assertEqual(db.await_count, 2)

    async def test_representative_cannot_disable_while_active_workflow_uses_it(self):
        with patch.object(platform, 'signed_in', AsyncMock(return_value=USER)), patch.object(platform, 'ensure_representatives', AsyncMock(return_value=[REPRESENTATIVE])), patch.object(platform, 'database', AsyncMock(side_effect=[[], [{'id': MESSAGE}]])) as db:
            response = await platform.representatives(request('PATCH', {'id': REP, 'displayName': 'Support', 'enabled': False}))
        self.assertEqual(response.status_code, 409)
        self.assertIn('workflows', payload(response)['error'])
        self.assertEqual(db.await_count, 2)

    async def test_workflow_keyword_validation_and_owner_scoped_save(self):
        base = {'mailboxId': MAILBOX, 'name': 'Review all', 'action': 'human_review', 'triggerMode': 'all_inbound', 'enabled': True}
        with patch.object(platform, 'signed_in', AsyncMock(return_value=USER)), patch.object(platform, 'owned_row', AsyncMock(return_value=MAIL)), patch.object(platform, 'database', AsyncMock(return_value=[])) as db:
            response = await platform.workflows(request('POST', {**base, 'matchTerms': ['hello']}))
            self.assertEqual(response.status_code, 400)
            db.assert_not_awaited()
            db.side_effect = [[], [{'id': MESSAGE}]]
            response = await platform.workflows(request('POST', {**base, 'priority': True}))
        self.assertEqual(response.status_code, 201)
        value = db.call_args.args[1]['body']
        self.assertEqual(value['owner_id'], OWNER)
        self.assertEqual(value['mailbox_id'], MAILBOX)
        self.assertEqual(value['priority'], 50)
        self.assertIsNone(value['representative_id'])

    async def test_feedback_is_idempotent_and_does_not_overwrite_previous_rating(self):
        job = {'mailbox_id': MAILBOX, 'status': 'auto_sent'}
        for prior_type, expected in [('feedback_correct', 200), ('feedback_correction', 409)]:
            with patch.object(platform, 'signed_in', AsyncMock(return_value=USER)), patch.object(platform, 'database', AsyncMock(side_effect=[[job], [{'id': MESSAGE}], [{'event_type': prior_type}]])) as db:
                response = await platform.trust(request('POST', {'messageId': MESSAGE, 'outcome': 'correct'}))
            self.assertEqual(response.status_code, expected)
            self.assertEqual(db.await_count, 3)
            for call in db.call_args_list:
                self.assertIn(f'owner_id=eq.{OWNER}', call.args[0])

    async def test_simulator_consumes_quota_once_and_never_sends(self):
        context = {'representative': REPRESENTATIVE, 'sources': [{'id': 'hours', 'text': 'Weekdays 9–5'}]}
        decision = {'decision': 'auto_reply', 'reply': 'Weekdays 9–5', 'confidence': .9, 'evidenceValidated': True,
                    'citations': [{'source_id': 'hours', 'title': 'Hours', 'quote': 'Weekdays 9–5'}], 'model': 'test-model'}
        async def generate(owner, mailbox, message, dependencies):
            self.assertEqual((owner, mailbox, message), (OWNER, 'simulator', 'simulator'))
            loaded = await dependencies['loadReplyContext']()
            self.assertEqual(loaded['message']['subject'], 'Hours?')
            self.assertTrue(await dependencies['consumeAIDraftQuota'](OWNER))
            return decision
        with patch.object(platform, 'signed_in', AsyncMock(return_value=USER)), patch.object(platform, 'approved_context', AsyncMock(return_value=context)), patch.object(platform, 'consume_ai_draft_quota', AsyncMock(return_value=True)) as quota, patch.object(platform, 'generate_automatic_decision', generate), patch.object(platform, 'database', AsyncMock(side_effect=[[{'id': MESSAGE, 'test_name': 'Hours test', 'created_at': '2026-11-10', 'passed': True}], None])) as db:
            response = await platform.simulator(request('POST', {'testName': 'Hours test', 'subject': 'Hours?', 'emailText': 'When open?', 'expectedDecision': 'auto_reply', 'representativeId': REP}))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload(response)['evaluation']['passed'])
        quota.assert_awaited_once_with(OWNER)
        self.assertEqual([call.args[0] for call in db.call_args_list], ['ai_simulation_runs', 'ai_trust_events'])
        self.assertEqual(db.call_args_list[1].args[1]['body']['idempotency_key'], f'simulation:{MESSAGE}')


if __name__ == '__main__':
    unittest.main()
