"""Signed inbound mail events; persisted messages feed the AI reply worker."""
import asyncio
import base64
import hmac
import json
import math
import re
import time

from starlette.background import BackgroundTask

from .core import APIError, config, database, encode, json_response, log_safe_error, method, read_raw, resend
from .automation import process_automatic_reply


def verify_signature(raw, headers, secret):
    id, timestamp, signatures = (headers.get(k) for k in ('svix-id', 'svix-timestamp', 'svix-signature'))
    if not id or not timestamp or not signatures or not secret.startswith('whsec_'):
        return False
    try:
        seconds = float(timestamp)
        if not math.isfinite(seconds) or abs(time.time() - seconds) > 300:
            return False
        key = base64.b64decode(secret[6:], validate=True)
        body = raw if isinstance(raw, bytes) else raw.encode()
        expected = base64.b64encode(hmac.digest(key, f'{id}.{timestamp}.'.encode() + body, 'sha256')).decode()
        return any(part.startswith('v1,') and hmac.compare_digest(part[3:].encode(), expected.encode()) for part in signatures.split(' '))
    except (ValueError, TypeError):
        return False


def html_to_text(value):
    value = re.sub(r'<\s*(script|style)[^>]*>[\s\S]*?</\s*\1\s*>', ' ', str(value or ''), flags=re.I)
    value = re.sub(r'<br\s*/?\s*>|</(?:p|div|li|tr|h[1-6])\s*>', '\n', value, flags=re.I)
    value = re.sub(r'<[^>]*>', ' ', value)
    for pattern, replacement in [(r'&nbsp;', ' '), (r'&amp;', '&'), (r'&lt;', '<'), (r'&gt;', '>'), (r'&quot;', '"'), (r'&#39;|&apos;', "'")]:
        value = re.sub(pattern, replacement, value, flags=re.I)
    value = re.sub(r'&#(\d+);', lambda m: chr(min(0x10ffff, int(m[1]))), value)
    return re.sub(r'\n{3,}', '\n\n', re.sub(r'[\t ]+\n', '\n', value)).strip()


def header_value(headers, wanted):
    if isinstance(headers, list):
        return next((str(item.get('value') or '') for item in headers if isinstance(item, dict) and str(item.get('name') or item.get('key') or '').lower() == wanted.lower()), '')
    if isinstance(headers, dict):
        return next((str(value or '') for name, value in headers.items() if name.lower() == wanted.lower()), '')
    return ''


def is_auto_submitted(headers):
    auto = header_value(headers, 'auto-submitted').lower()
    return bool((auto and auto != 'no') or re.search(r'\b(bulk|list|junk)\b', header_value(headers, 'precedence').lower()) or header_value(headers, 'list-id') or header_value(headers, 'x-auto-response-suppress'))


async def run_automation(message_ids):
    async def safe_process(id):
        try:
            await process_automatic_reply(id)
        except Exception as error:
            log_safe_error('OpenMail AI automation failed safely', error)
    await asyncio.gather(*(safe_process(id) for id in message_ids))


async def receive(request):
    method(request, ['POST'])
    try:
        secret = config()['resendWebhookSecret']
        if not secret:
            return json_response(503, {'error': 'Webhook signing is not configured.'})
        raw = await read_raw(request, 1024 * 1024)
        if not verify_signature(raw, request.headers, secret):
            return json_response(401, {'error': 'Invalid webhook signature.'})
        event = json.loads(raw)
        if not isinstance(event, dict) or event.get('type') != 'email.received' or not (event.get('data') or {}).get('email_id'):
            return json_response(200, {'ok': True, 'ignored': True})
        detail = await resend('/emails/receiving/' + encode(event['data']['email_id']))
        candidates = [*(detail.get('to') or event['data'].get('to') or []), *(detail.get('received_for') or [])]
        addresses = list(dict.fromkeys(str(a).strip().lower() for a in candidates if re.fullmatch(r'[^\s@]+@[^\s@]+', str(a).strip())))
        jobs = []
        for address in addresses:
            rows = await database('mailboxes?select=id,owner_id,address,status&address=eq.' + encode(address) + '&status=eq.active&limit=1')
            mailbox = rows[0] if rows else None
            if not mailbox:
                continue
            text = str(detail.get('text') or html_to_text(detail.get('html')))[:100000]
            provider_id = detail.get('id') or event['data']['email_id']
            stored = None
            try:
                stored = await database('messages', method='POST', body={
                    'owner_id': mailbox['owner_id'], 'mailbox_id': mailbox['id'], 'direction': 'inbound',
                    'from_address': str(detail.get('from') or '')[:320], 'to_addresses': [address],
                    'subject': str(detail.get('subject') or '(no subject)')[:200], 'preview': text[:180],
                    'text_body': text, 'folder': 'inbox', 'status': 'received', 'provider_email_id': provider_id,
                    'attachment_metadata': [{k: item.get(k) for k in ('id', 'filename', 'content_type', 'size')} for item in (detail.get('attachments') or [])],
                    'ai_auto_submitted': is_auto_submitted(detail.get('headers')),
                }, prefer='return=representation')
            except APIError as error:
                if error.status != 409:
                    raise
            message = (stored[0] if stored else None) if isinstance(stored, list) else stored
            if not message or not message.get('id'):
                existing = await database('messages?select=id,folder&provider_email_id=eq.' + encode(provider_id) + '&mailbox_id=eq.' + encode(mailbox['id']) + '&direction=eq.inbound&limit=1')
                message = existing[0] if existing else None
            if message and message.get('id'):
                jobs.append(message['id'])
        response = json_response(200, {'ok': True})
        # ASGI awaits this work after flushing the response. Never detach a task
        # from the invocation; the database claim and provider key deduplicate retries.
        response.background = BackgroundTask(run_automation, jobs)
        return response
    except Exception as error:
        log_safe_error('OpenMail inbound webhook error', error)
        too_large = getattr(error, 'status', None) == 413
        return json_response(413 if too_large else 500, {'error': 'Webhook payload is too large.' if too_large else 'OpenMail could not store this incoming message.'})
