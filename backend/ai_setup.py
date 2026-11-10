"""Account-owned company knowledge and automatic-reply settings."""
import hashlib
import re
from .core import (config, database, encode, iso_now, json_response, method,
                   read_json, readiness, require_confirmed_email, require_same_origin, signed_in)
from .ai_platform import ensure_representatives, get_owned_representative

PROFILE_FIELDS = ['company_name', 'company_description', 'products_services', 'pricing', 'business_hours', 'policies']
ENTRY_TYPES = {'faq', 'service', 'pricing', 'policy'}
UUID = re.compile(r'^[0-9a-f-]{36}$', re.I)
DOCUMENT_TYPES = {'.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.pdf': 'application/pdf',
                  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}


def clean_text(value, length):
    return str(value or '').strip()[:length]


def row(rows):
    return (rows[0] if rows else None) if isinstance(rows, list) else rows


async def profile(request):
    method(request, ['GET', 'PATCH'])
    if request.method == 'PATCH':
        require_same_origin(request)
    user = await signed_in(request)
    owner = encode(user['id'])
    if request.method == 'GET':
        rows = await database(f"ai_profiles?select={','.join(PROFILE_FIELDS)},enabled,reply_mode,updated_at&owner_id=eq.{owner}&limit=1")
        settings = config()
        return json_response(200, {'profile': row(rows), 'provider': {
            'name': 'Groq', 'configured': bool(settings['groqKey']), 'model': settings['groqModel'],
        }, 'mailReady': readiness()['mailReady']})
    require_confirmed_email(user)
    body = await read_json(request)
    value = {
        'owner_id': user['id'], 'company_name': clean_text(body.get('companyName'), 120),
        'company_description': clean_text(body.get('companyDescription'), 4000),
        'products_services': clean_text(body.get('productsServices'), 6000),
        'pricing': clean_text(body.get('pricing'), 4000), 'business_hours': clean_text(body.get('businessHours'), 1200),
        'policies': clean_text(body.get('policies'), 5000), 'enabled': body.get('enabled') is True,
        'reply_mode': 'draft', 'updated_at': iso_now(),
    }
    if not value['company_name']:
        return json_response(400, {'error': 'Add your company name before saving.'})
    if value['enabled'] and not config()['groqKey']:
        return json_response(503, {'error': 'Groq is not connected yet. Add GROQ_API_KEY as a server-only environment variable first.'})
    rows = await database('ai_profiles?on_conflict=owner_id', {
        'method': 'POST', 'body': value, 'prefer': 'resolution=merge-duplicates,return=representation'})
    if not value['enabled']:
        await database(f'ai_mailbox_settings?owner_id=eq.{owner}', {
            'method': 'PATCH', 'body': {'auto_reply_enabled': False, 'updated_at': iso_now()}})
    return json_response(200, {'profile': row(rows)})


async def documents(request):
    method(request, ['GET', 'POST', 'DELETE'])
    if request.method != 'GET':
        require_same_origin(request)
    user = await signed_in(request)
    owner = encode(user['id'])
    if request.method == 'GET':
        rows = await database(f'ai_knowledge_documents?select=id,file_name,mime_type,representative_id,created_at&owner_id=eq.{owner}&order=created_at.desc&limit=10')
        return json_response(200, {'documents': rows or []})
    require_confirmed_email(user)
    if request.method == 'DELETE':
        document_id = str(request.query_params.get('id') or '')
        if not UUID.fullmatch(document_id):
            return json_response(404, {'error': 'Knowledge document not found.'})
        rows = await database(f'ai_knowledge_documents?id=eq.{encode(document_id)}&owner_id=eq.{owner}&select=id', {
            'method': 'DELETE', 'prefer': 'return=representation'})
        if not rows:
            return json_response(404, {'error': 'Knowledge document not found.'})
        return json_response(200, {'ok': True})
    body = await read_json(request)
    file_name = re.sub(r'[\\/\x00-\x1f]', '', str(body.get('fileName') or '').strip())[:160]
    extension = file_name[file_name.rfind('.'):].lower()
    mime_type = DOCUMENT_TYPES.get(extension)
    extracted_text = body.get('extractedText', '').strip() if isinstance(body.get('extractedText'), str) else ''
    if not file_name or not mime_type or body.get('mimeType') != mime_type:
        return json_response(400, {'error': 'Upload a PDF, DOCX, TXT, MD, or CSV file.'})
    if not extracted_text or len(extracted_text) > 40000:
        return json_response(400, {'error': 'The document must contain readable text up to 40,000 characters.'})
    representative_id = str(body.get('representativeId') or '')
    representative = await get_owned_representative(user['id'], representative_id, require_enabled=True) if representative_id else None
    if representative_id and not representative:
        return json_response(400, {'error': 'Choose one of your enabled AI representatives.'})
    saved_profile = row(await database(f'ai_profiles?select=enabled&owner_id=eq.{owner}&limit=1'))
    if not saved_profile or not saved_profile.get('enabled'):
        return json_response(409, {'error': 'Save and enable your AI representative before adding knowledge documents.'})
    arguments = {'p_owner': user['id'], 'p_file_name': file_name, 'p_mime_type': mime_type,
                 'p_content_hash': hashlib.sha256(extracted_text.encode('utf-8')).hexdigest(), 'p_extracted_text': extracted_text}
    if representative:
        arguments['p_representative'] = representative['id']
    try:
        document = await database('rpc/save_openmail_ai_document_for_rep' if representative else 'rpc/save_openmail_ai_document', {
            'method': 'POST', 'body': arguments})
        return json_response(201, {'document': document})
    except Exception as error:
        message = str(error)
        if 'already been uploaded' in message:
            return json_response(409, {'error': message})
        if 'up to 10' in message or 'invalid OpenMail AI document' in message:
            return json_response(400, {'error': message})
        raise


async def mailbox_settings(request):
    method(request, ['GET', 'PATCH'])
    if request.method == 'PATCH':
        require_same_origin(request)
    user = await signed_in(request)
    if request.method == 'PATCH':
        require_confirmed_email(user)
    body = await read_json(request) if request.method == 'PATCH' else {}
    mailbox_id = str((body.get('mailboxId') if request.method == 'PATCH' else request.query_params.get('mailboxId')) or '')
    if not UUID.fullmatch(mailbox_id):
        return json_response(400, {'error': 'Choose one of your active mailboxes.'})
    owner = encode(user['id'])
    mailbox = row(await database(f'mailboxes?select=id,address,status,domain_id,owner_id&id=eq.{encode(mailbox_id)}&owner_id=eq.{owner}&limit=1'))
    if not mailbox or mailbox.get('status') != 'active':
        return json_response(404, {'error': 'Active mailbox not found.'})
    current = row(await database(f"ai_mailbox_settings?select=mailbox_id,auto_reply_enabled,representative_id,updated_at&mailbox_id=eq.{encode(mailbox['id'])}&owner_id=eq.{owner}&limit=1")) or {}
    if request.method == 'GET':
        domain = row(await database(f"domains?select=status&id=eq.{encode(mailbox['domain_id'])}&owner_id=eq.{owner}&limit=1"))
        reps = await ensure_representatives(user['id'])
        default_rep = next((item for item in reps if item.get('kind') == 'support'), {})
        return json_response(200, {
            'mailbox': {'id': mailbox['id'], 'address': mailbox['address']},
            'settings': {'mailbox_id': mailbox['id'], 'auto_reply_enabled': False, **current,
                         'representative_id': current.get('representative_id') or default_rep.get('id') or None},
            'representatives': reps, 'domainVerified': bool(domain and domain.get('status') == 'verified'),
            'mailReady': readiness()['mailReady'], 'providerConfigured': bool(config()['groqKey']),
        })
    enabled = body.get('enabled') is True
    reps = await ensure_representatives(user['id'])
    default_rep = next((item for item in reps if item.get('kind') == 'support'), {})
    requested_rep = str(body.get('representativeId') or current.get('representative_id') or default_rep.get('id') or '')
    representative = await get_owned_representative(user['id'], requested_rep, require_enabled=True)
    if not representative:
        return json_response(400, {'error': 'Choose one of your enabled AI representatives for this mailbox.'})
    if enabled:
        if body.get('confirmAutomaticSending') is not True:
            return json_response(400, {'error': 'Confirm that OpenMail may automatically send supported replies for this mailbox.'})
        if not config()['groqKey'] or not readiness()['mailReady']:
            return json_response(503, {'error': 'AI and mail services must be connected before automatic replies can be enabled.'})
        saved_profile = row(await database(f'ai_profiles?select=company_name,enabled&owner_id=eq.{owner}&limit=1'))
        if not saved_profile or not saved_profile.get('enabled') or not str(saved_profile.get('company_name') or '').strip():
            return json_response(409, {'error': 'Save and enable your AI representative profile first.'})
        domain = row(await database(f"domains?select=status&id=eq.{encode(mailbox['domain_id'])}&owner_id=eq.{owner}&limit=1"))
        if not domain or domain.get('status') != 'verified':
            return json_response(409, {'error': 'Verify this mailbox’s sending domain before enabling automatic replies.'})
    settings = {'mailbox_id': mailbox['id'], 'owner_id': user['id'], 'representative_id': representative['id'],
                'auto_reply_enabled': enabled, 'updated_at': iso_now()}
    saved = await database('ai_mailbox_settings?on_conflict=mailbox_id', {
        'method': 'POST', 'body': settings, 'prefer': 'resolution=merge-duplicates,return=representation'})
    return json_response(200, {'settings': row(saved)})


async def knowledge(request):
    method(request, ['GET', 'POST', 'DELETE'])
    if request.method != 'GET':
        require_same_origin(request)
    user = await signed_in(request)
    owner = encode(user['id'])
    if request.method == 'GET':
        rows = await database(f'ai_knowledge_entries?select=id,title,entry_type,content,representative_id,created_at,updated_at&owner_id=eq.{owner}&order=created_at.desc&limit=100')
        return json_response(200, {'entries': rows or []})
    require_confirmed_email(user)
    if request.method == 'DELETE':
        entry_id = str(request.query_params.get('id') or '')
        if not UUID.fullmatch(entry_id):
            return json_response(404, {'error': 'Knowledge entry not found.'})
        rows = await database(f'ai_knowledge_entries?id=eq.{encode(entry_id)}&owner_id=eq.{owner}&select=id', {
            'method': 'DELETE', 'prefer': 'return=representation'})
        if not rows:
            return json_response(404, {'error': 'Knowledge entry not found.'})
        return json_response(200, {'ok': True})
    body = await read_json(request)
    title = str(body.get('title') or '').strip()
    content = str(body.get('content') or '').strip()
    entry_type = str(body.get('type') or 'faq')
    representative_id = str(body.get('representativeId') or '')
    if not title or len(title) > 120:
        return json_response(400, {'error': 'Enter a title up to 120 characters.'})
    if not content or len(content) > 8000:
        return json_response(400, {'error': 'Enter approved information up to 8,000 characters.'})
    if entry_type not in ENTRY_TYPES:
        return json_response(400, {'error': 'Choose a supported knowledge type.'})
    representative = await get_owned_representative(user['id'], representative_id, require_enabled=True) if representative_id else None
    if representative_id and not representative:
        return json_response(400, {'error': 'Choose one of your enabled AI representatives.'})
    arguments = {'p_owner': user['id'], 'p_title': title, 'p_entry_type': entry_type, 'p_content': content}
    if representative:
        arguments['p_representative'] = representative['id']
    try:
        entry = await database('rpc/save_openmail_ai_knowledge_for_rep' if representative else 'rpc/save_openmail_ai_knowledge', {
            'method': 'POST', 'body': arguments})
        return json_response(201, {'entry': entry})
    except Exception as error:
        if 'up to 100' in str(error):
            return json_response(400, {'error': str(error)})
        raise
