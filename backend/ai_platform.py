"""AI simulator, representative routing, workflows, and trust feedback."""
import asyncio
from datetime import datetime, timezone, timedelta
import re
import unicodedata
from urllib.parse import urlencode
from uuid import uuid4

from .core import (APIError, config, consume_ai_draft_quota, database, encode, iso_now,
                   json_response, method, owned_row, read_json, require_confirmed_email,
                   require_same_origin, signed_in)
from .ai import generate_automatic_decision, AUTO_REPLY_MIN_CONFIDENCE, is_test_only_pricing_material

UUID = re.compile(r'^[0-9a-f-]{36}$', re.I)
WORKFLOW_ACTIONS = {'route_to_rep', 'create_draft', 'verified_reply', 'human_review'}
FEEDBACK = {'correct', 'correction', 'resolved', 'escalated'}


def clean(value, maximum):
    return str(value or '').strip()[:maximum]


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).lower().split())


def row(result):
    return (result[0] if result else None) if isinstance(result, list) else (result or None)


async def ensure_representatives(owner_id, db=None):
    result = await (db or database)('rpc/ensure_openmail_ai_representatives', {'method': 'POST', 'body': {'p_owner': owner_id}})
    return result if isinstance(result, list) else []


async def get_owned_representative(owner_id, representative_id, require_enabled=False, db=None):
    if not UUID.fullmatch(str(representative_id or '')):
        return None
    rows = await (db or database)(f'ai_representatives?select=id,owner_id,kind,display_name,enabled&id=eq.{encode(representative_id)}&owner_id=eq.{encode(owner_id)}&limit=1')
    representative = row(rows)
    return representative if representative and representative.get('owner_id') == owner_id and (not require_enabled or representative.get('enabled')) else None


def scoped_sources_query(owner_id, representative_id):
    return urlencode({'owner_id': f'eq.{owner_id}',
                      'or': f'(representative_id.is.null,representative_id.eq.{representative_id})',
                      'order': 'created_at.desc', 'limit': '100'})


async def approved_context(owner_id, representative_id, db=None):
    db = db or database
    settings = config()
    if not settings['groqKey']:
        raise APIError(503, 'Groq is not connected yet.')
    reps = await ensure_representatives(owner_id, db)
    representative = next((item for item in reps if item.get('id') == representative_id), None)
    if not representative and not representative_id:
        representative = next((item for item in reps if item.get('kind') == 'support'), None)
    if not representative or representative.get('owner_id') != owner_id:
        raise APIError(404, 'Choose one of your AI representatives.')
    if not representative.get('enabled'):
        raise APIError(409, 'Enable this AI representative before running a test.')
    profile = row(await db(f'ai_profiles?select=company_name,company_description,products_services,pricing,business_hours,policies,enabled&owner_id=eq.{encode(owner_id)}&limit=1'))
    if not profile or not profile.get('enabled') or not str(profile.get('company_name') or '').strip():
        raise APIError(409, 'Save and enable your company profile before running a test.')
    scoped = scoped_sources_query(owner_id, representative['id'])
    notes, documents = await asyncio.gather(
        db(f'ai_knowledge_entries?select=id,title,entry_type,content&{scoped}'),
        db(f'ai_knowledge_documents?select=id,file_name,mime_type,extracted_text&{scoped}'))
    sources = []
    for key in ['company_name', 'company_description', 'products_services', 'pricing', 'business_hours']:
        text = clean(profile.get(key), 120 if key == 'company_name' else 1800)
        if text:
            sources.append({'id': f'profile:{key}', 'kind': 'company_profile', 'title': key.replace('_', ' '), 'text': text})
    for item in notes or []:
        text = clean(item.get('content'), 2500)
        if text and not is_test_only_pricing_material(item.get('title'), text):
            sources.append({'id': f"note:{item['id']}", 'kind': clean(item.get('entry_type'), 24), 'title': clean(item.get('title'), 120), 'text': text})
    for item in documents or []:
        text = clean(item.get('extracted_text'), 5000)
        if text and not is_test_only_pricing_material(item.get('file_name'), text):
            sources.append({'id': f"document:{item['id']}", 'kind': 'approved_document', 'title': clean(item.get('file_name'), 160), 'text': text})
    budget, bounded_sources = 22000, []
    for source in sources:
        if budget <= 0:
            break
        text = source['text'][:budget]
        if text:
            bounded_sources.append({**source, 'text': text})
        budget -= len(text)
    return {'settings': settings, 'profile': profile, 'representative': representative,
            'sources': bounded_sources, 'operationalPolicies': clean(profile.get('policies'), 5000)}


def evaluate_simulation(expected_decision, decision):
    expected = str(expected_decision or '')
    decision = decision or {}
    actual = decision.get('decision')
    valid = actual in ('auto_reply', 'human_review')
    evidence_verified = actual != 'auto_reply' or bool(decision.get('evidenceValidated') and decision.get('citations'))
    try:
        confidence = float(decision.get('confidence') or 0)
    except (TypeError, ValueError):
        confidence = 0
    confidence_passed = actual != 'auto_reply' or confidence >= AUTO_REPLY_MIN_CONFIDENCE
    return {'expected': expected, 'actual': actual or 'human_review',
            'passed': valid and expected == actual and evidence_verified and confidence_passed,
            'evidenceVerified': evidence_verified, 'confidencePassed': confidence_passed,
            'minimumAutoReplyConfidence': AUTO_REPLY_MIN_CONFIDENCE,
            'modelConfidenceNote': 'The model-reported confidence is a self-estimate, not a calibrated probability.'}


def feedback_allowed(job_status, outcome):
    if job_status == 'ignored':
        return False
    if outcome in ('correct', 'correction'):
        return job_status in ('auto_sent', 'draft_created')
    return job_status in ('auto_sent', 'draft_created', 'human_review', 'failed', 'workflow_applied')


async def simulator(request):
    method(request, ['GET', 'POST'])
    if request.method == 'POST':
        require_same_origin(request)
    user = await signed_in(request)
    if request.method == 'GET':
        runs = await database(f"ai_simulation_runs?select=id,representative_id,test_name,expected_decision,actual_decision,passed,confidence,evidence_validated,model,created_at&owner_id=eq.{encode(user['id'])}&order=created_at.desc&limit=20")
        reps = await ensure_representatives(user['id'])
        return json_response(200, {'runs': runs or [], 'representatives': reps})
    require_confirmed_email(user)
    body = await read_json(request)
    test_name, subject = clean(body.get('testName'), 100), clean(body.get('subject'), 200)
    email_text = body['emailText'].strip() if isinstance(body.get('emailText'), str) else ''
    expected_decision = str(body.get('expectedDecision') or '')
    representative_id = str(body.get('representativeId') or '')
    if not test_name or not subject or not email_text or len(email_text) > 8000:
        return json_response(400, {'error': 'Add a test name, subject, and message up to 8,000 characters.'})
    if expected_decision not in ('auto_reply', 'human_review'):
        return json_response(400, {'error': 'Choose the expected result: answer from approved facts or send to human review.'})
    context = await approved_context(user['id'], representative_id)
    if not context['sources']:
        return json_response(409, {'error': 'Add approved company facts or representative-specific knowledge before testing.'})
    if not await consume_ai_draft_quota(user['id']):
        return json_response(429, {'error': 'The daily OpenMail AI limit has been reached. Try again after it resets.'})

    async def load_context(*args, **kwargs):
        return {**context, 'emailBody': email_text,
                'message': {'subject': subject, 'text_body': email_text, 'attachment_metadata': [], 'ai_auto_submitted': False}}

    async def already_consumed(*args, **kwargs):
        return True

    decision = await generate_automatic_decision(user['id'], 'simulator', 'simulator', {
        'loadReplyContext': load_context, 'consumeAIDraftQuota': already_consumed})
    evaluation = evaluate_simulation(expected_decision, decision)
    inserted = await database('ai_simulation_runs', {'method': 'POST', 'body': {
        'owner_id': user['id'], 'representative_id': context['representative']['id'], 'test_name': test_name,
        'expected_decision': evaluation['expected'], 'actual_decision': evaluation['actual'], 'passed': evaluation['passed'],
        'confidence': decision.get('confidence'), 'evidence_validated': evaluation['evidenceVerified'], 'model': clean(decision.get('model'), 120),
    }, 'prefer': 'return=representation'})
    run = row(inserted)
    result = {
        'run': {'id': run['id'], 'testName': run['test_name'], 'createdAt': run['created_at'], 'passed': run['passed']} if run else None,
        'representative': {'id': context['representative']['id'], 'name': context['representative']['display_name'], 'kind': context['representative']['kind']},
        'evaluation': {**evaluation, 'reason': clean(decision.get('reason'), 300), 'confidence': decision.get('confidence'), 'model': clean(decision.get('model'), 120)},
        'answer': decision.get('reply', '') if decision.get('decision') == 'auto_reply' else '',
        'citations': [{'sourceId': item['source_id'], 'title': clean(item.get('title'), 160), 'quote': clean(item.get('quote'), 1800)} for item in decision.get('citations', [])],
    }
    await database('ai_trust_events', {'method': 'POST', 'body': {
        'owner_id': user['id'], 'representative_id': context['representative']['id'], 'event_type': 'simulation',
        'confidence': decision.get('confidence'), 'evidence_source_ids': [item['source_id'] for item in decision.get('citations', [])],
        'model': clean(decision.get('model'), 120), 'idempotency_key': f"simulation:{run['id'] if run else uuid4()}",
    }, 'prefer': 'resolution=ignore-duplicates,return=minimal'})
    return json_response(200, result)


async def representatives(request):
    method(request, ['GET', 'PATCH'])
    if request.method == 'PATCH':
        require_same_origin(request)
    user = await signed_in(request)
    reps = await ensure_representatives(user['id'])
    owner = encode(user['id'])
    if request.method == 'GET':
        mailbox_setting = None
        if request.query_params.get('mailboxId'):
            mailbox = await owned_row('mailboxes', request.query_params['mailboxId'], user['id'], 'id,address,status')
            if not mailbox:
                return json_response(404, {'error': 'Mailbox not found.'})
            mailbox_setting = row(await database(f"ai_mailbox_settings?select=mailbox_id,representative_id,auto_reply_enabled&owner_id=eq.{owner}&mailbox_id=eq.{encode(mailbox['id'])}&limit=1"))
        return json_response(200, {'representatives': reps, 'mailboxSetting': mailbox_setting})
    require_confirmed_email(user)
    body = await read_json(request)
    rep_id, display_name = str(body.get('id') or ''), clean(body.get('displayName'), 80)
    if not UUID.fullmatch(rep_id) or not display_name:
        return json_response(400, {'error': 'Choose an AI representative and enter a display name up to 80 characters.'})
    representative = next((item for item in reps if item.get('id') == rep_id), None)
    if not representative:
        return json_response(404, {'error': 'AI representative not found.'})
    enabled = body.get('enabled') is True
    if not enabled:
        auto_mailboxes, active_workflows = await asyncio.gather(
            database(f'ai_mailbox_settings?select=mailbox_id&owner_id=eq.{owner}&representative_id=eq.{encode(rep_id)}&auto_reply_enabled=eq.true&limit=50'),
            database(f'ai_workflows?select=id&owner_id=eq.{owner}&representative_id=eq.{encode(rep_id)}&enabled=eq.true&limit=50'))
        if auto_mailboxes:
            return json_response(409, {'error': 'Turn off automatic replies or assign another representative to every listed mailbox before disabling this one.'})
        if active_workflows:
            return json_response(409, {'error': 'Turn off or reassign active workflows that use this representative before disabling it.'})
    saved = await database(f'ai_representatives?id=eq.{encode(rep_id)}&owner_id=eq.{owner}&select=id,kind,display_name,enabled', {
        'method': 'PATCH', 'body': {'display_name': display_name, 'enabled': enabled, 'updated_at': iso_now()}, 'prefer': 'return=representation'})
    return json_response(200, {'representative': row(saved)})


def workflow_matches(workflow, message):
    if not workflow or not workflow.get('enabled'):
        return False
    if workflow.get('trigger_mode') == 'all_inbound':
        return True
    message = message or {}
    text = normalized(f"{message.get('subject') or ''}\n{message.get('text_body') or ''}")
    terms = workflow.get('match_terms') if isinstance(workflow.get('match_terms'), list) else []
    return any(normalized(term) and normalized(term) in text for term in terms)


async def workflows(request):
    method(request, ['GET', 'POST', 'DELETE'])
    if request.method != 'GET':
        require_same_origin(request)
    user = await signed_in(request)
    body = await read_json(request) if request.method == 'POST' else {}
    mailbox_id = str((body.get('mailboxId') if request.method == 'POST' else request.query_params.get('mailboxId')) or '')
    if not UUID.fullmatch(mailbox_id):
        return json_response(400, {'error': 'Choose one of your mailboxes.'})
    mailbox = await owned_row('mailboxes', mailbox_id, user['id'], 'id,address,status')
    if not mailbox or mailbox.get('status') != 'active':
        return json_response(404, {'error': 'Active mailbox not found.'})
    owner, mail = encode(user['id']), encode(mailbox['id'])
    if request.method == 'GET':
        rows = await database(f'ai_workflows?select=id,name,enabled,trigger_mode,match_terms,action,representative_id,priority,created_at,updated_at&owner_id=eq.{owner}&mailbox_id=eq.{mail}&order=priority.asc,created_at.asc&limit=20')
        return json_response(200, {'workflows': rows or [], 'mailbox': {'id': mailbox['id'], 'address': mailbox['address']}})
    require_confirmed_email(user)
    if request.method == 'DELETE':
        workflow_id = str(request.query_params.get('id') or '')
        if not UUID.fullmatch(workflow_id):
            return json_response(400, {'error': 'Choose a workflow to turn off.'})
        updated = await database(f'ai_workflows?id=eq.{encode(workflow_id)}&owner_id=eq.{owner}&mailbox_id=eq.{mail}&select=id', {
            'method': 'PATCH', 'body': {'enabled': False, 'updated_at': iso_now()}, 'prefer': 'return=representation'})
        if not updated:
            return json_response(404, {'error': 'Workflow not found.'})
        return json_response(200, {'ok': True})
    workflow_id, name = str(body.get('id') or ''), clean(body.get('name'), 100)
    trigger_mode, action = str(body.get('triggerMode') or ''), str(body.get('action') or '')
    priority = body.get('priority') if type(body.get('priority')) is int and 0 <= body['priority'] <= 100 else 50
    terms = list(dict.fromkeys(filter(None, (clean(term, 60) for term in body['matchTerms'])))) if isinstance(body.get('matchTerms'), list) else []
    representative_id = None if action == 'human_review' else str(body.get('representativeId') or '')
    if not name or trigger_mode not in ('all_inbound', 'contains_any') or action not in WORKFLOW_ACTIONS:
        return json_response(400, {'error': 'Add a workflow name and choose a supported trigger and action.'})
    if (trigger_mode == 'contains_any' and not 1 <= len(terms) <= 12) or (trigger_mode == 'all_inbound' and terms):
        return json_response(400, {'error': 'Keyword rules need 1–12 phrases; all-inbound rules cannot include keywords.'})
    if any(len(term) < 2 for term in terms):
        return json_response(400, {'error': 'Each keyword phrase must contain at least two characters.'})
    representative = None
    if representative_id:
        representative = await get_owned_representative(user['id'], representative_id, require_enabled=True)
        if not representative:
            return json_response(400, {'error': 'Choose one of your enabled AI representatives.'})
    if action != 'human_review' and not representative:
        return json_response(400, {'error': 'Choose the representative this workflow should use.'})
    if workflow_id:
        if not UUID.fullmatch(workflow_id):
            return json_response(400, {'error': 'Workflow identifier is invalid.'})
    else:
        existing = await database(f'ai_workflows?select=id&owner_id=eq.{owner}&mailbox_id=eq.{mail}&limit=20')
        if existing and len(existing) >= 20:
            return json_response(409, {'error': 'This mailbox can have up to 20 workflows.'})
    value = {'owner_id': user['id'], 'mailbox_id': mailbox['id'], 'name': name, 'enabled': body.get('enabled') is True,
             'trigger_mode': trigger_mode, 'match_terms': terms, 'action': action, 'representative_id': representative_id,
             'priority': priority, 'updated_at': iso_now()}
    saved = await database(f'ai_workflows?id=eq.{encode(workflow_id)}&owner_id=eq.{owner}&mailbox_id=eq.{mail}' if workflow_id else 'ai_workflows', {
        'method': 'PATCH' if workflow_id else 'POST', 'body': value, 'prefer': 'return=representation'})
    if workflow_id and not saved:
        return json_response(404, {'error': 'Workflow not found.'})
    return json_response(200 if workflow_id else 201, {'workflow': row(saved)})


def recent_enough(value, cutoff):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')) >= cutoff
    except (TypeError, ValueError):
        return False


async def trust(request):
    method(request, ['GET', 'POST'])
    if request.method == 'POST':
        require_same_origin(request)
    user = await signed_in(request)
    owner = encode(user['id'])
    if request.method == 'GET':
        parsed = re.match(r'^[+-]?\d+', str(request.query_params.get('days') or '30').lstrip())
        days = max(1, min(365, (int(parsed.group()) if parsed else 30) or 30))
        mailbox_id = str(request.query_params.get('mailboxId') or '')
        if mailbox_id and not await owned_row('mailboxes', mailbox_id, user['id'], 'id'):
            return json_response(404, {'error': 'Mailbox not found.'})
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        mail_filter = f'&mailbox_id=eq.{encode(mailbox_id)}' if mailbox_id else ''
        summary, jobs = await asyncio.gather(
            database('rpc/get_openmail_ai_trust_metrics', {'method': 'POST', 'body': {'p_owner': user['id'], 'p_days': days, 'p_mailbox': mailbox_id or None}}),
            database(f'ai_auto_reply_jobs?select=inbound_message_id,mailbox_id,status,reason,model,reply_message_id,representative_id,workflow_id,confidence,evidence_source_ids,created_at&owner_id=eq.{owner}{mail_filter}&order=created_at.desc&limit=30'))
        recent_jobs = [job for job in (jobs or []) if recent_enough(job.get('created_at'), cutoff)]
        ids = [job['inbound_message_id'] for job in recent_jobs if UUID.fullmatch(str(job.get('inbound_message_id') or ''))]
        message_rows, feedback_rows = [], []
        if ids:
            in_list = encode(f"({','.join(ids)})")
            message_rows, feedback_rows = await asyncio.gather(
                database(f'messages?select=id,subject,ai_handoff_status,ai_representative_id&id=in.{in_list}&owner_id=eq.{owner}&direction=eq.inbound'),
                database(f'ai_trust_events?select=message_id,event_type,correction_note,created_at&owner_id=eq.{owner}&message_id=in.{in_list}&event_type=in.(feedback_correct,feedback_correction,feedback_resolved,feedback_escalated)&order=created_at.desc&limit=120'))
        messages = {item['id']: item for item in (message_rows or [])}
        feedback = {}
        for item in feedback_rows or []:
            feedback.setdefault(item['message_id'], item)
        recent = []
        for job in recent_jobs:
            message_id = job.get('inbound_message_id')
            if message_id not in messages:
                continue
            recent.append({'messageId': message_id, 'subject': clean(messages[message_id].get('subject'), 200),
                           'status': job.get('status'), 'reason': clean(job.get('reason'), 300), 'model': clean(job.get('model'), 120),
                           'representativeId': job.get('representative_id') or messages[message_id].get('ai_representative_id') or None,
                           'workflowId': job.get('workflow_id') or None, 'confidence': job.get('confidence'),
                           'createdAt': job.get('created_at'), 'feedback': feedback.get(message_id)})
        return json_response(200, {'days': days, 'summary': summary, 'recent': recent})
    require_confirmed_email(user)
    body = await read_json(request)
    message_id, outcome = str(body.get('messageId') or ''), str(body.get('outcome') or '')
    correction_note = clean(body.get('correctionNote'), 2000)
    if not UUID.fullmatch(message_id) or outcome not in FEEDBACK:
        return json_response(400, {'error': 'Choose a valid AI result and feedback label.'})
    if outcome == 'correction' and not correction_note:
        return json_response(400, {'error': 'Add a short note describing the correction.'})
    message = encode(message_id)
    job = row(await database(f'ai_auto_reply_jobs?select=id,mailbox_id,representative_id,inbound_message_id,status,workflow_id&owner_id=eq.{owner}&inbound_message_id=eq.{message}&limit=1'))
    if not job:
        return json_response(404, {'error': 'AI result not found for this account.'})
    if not feedback_allowed(job.get('status'), outcome):
        return json_response(409, {'error': 'Ignored messages do not have an AI answer or handover to rate.' if job.get('status') == 'ignored' else 'Only an AI reply or generated draft can be marked correct or corrected.'})
    inbound = row(await database(f"messages?select=id,ai_representative_id&owner_id=eq.{owner}&id=eq.{message}&mailbox_id=eq.{encode(job['mailbox_id'])}&direction=eq.inbound&limit=1"))
    if not inbound:
        return json_response(404, {'error': 'Inbound message not found.'})
    event_type = f'feedback_{outcome}'
    prior = row(await database(f'ai_trust_events?select=event_type&owner_id=eq.{owner}&message_id=eq.{message}&event_type=in.(feedback_correct,feedback_correction,feedback_resolved,feedback_escalated)&limit=1'))
    if prior:
        if prior.get('event_type') == event_type:
            return json_response(200, {'ok': True, 'outcome': outcome, 'unchanged': True})
        return json_response(409, {'error': 'Feedback has already been recorded for this message.'})
    try:
        await database('ai_trust_events', {'method': 'POST', 'body': {
            'owner_id': user['id'], 'mailbox_id': job['mailbox_id'], 'message_id': message_id,
            'representative_id': job.get('representative_id') or inbound.get('ai_representative_id') or None,
            'workflow_id': job.get('workflow_id') or None, 'event_type': event_type,
            'correction_note': correction_note if outcome == 'correction' else '',
            'idempotency_key': f"feedback:{user['id']}:{message_id}:{outcome}",
        }, 'prefer': 'return=minimal'})
    except Exception as error:
        if getattr(error, 'status', None) == 409:
            return json_response(409, {'error': 'Feedback has already been recorded for this message.'})
        raise
    return json_response(200, {'ok': True, 'outcome': outcome})
