"""Shared HTTP, account sessions and provider boundaries for OpenMail."""
import asyncio
import base64
import hmac
import ipaddress
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlencode, urlsplit

import httpx
from fastapi.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status, message, retry_after=None, code=None, headers=None):
        super().__init__(message)
        self.status, self.retry_after, self.code = status, retry_after, code
        self.headers = dict(headers or {})
        if retry_after is not None:
            self.headers['Retry-After'] = str(retry_after)


def utf16_length(value):
    return len(str(value).encode("utf-16-le", errors="surrogatepass")) // 2


def encode(value):
    return quote(str(value), safe="~()*!.'-")


def query(filters, select='*'):
    return urlencode({'select': select, **filters})


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def config():
    return {
        'supabaseUrl': os.getenv('SUPABASE_URL', '').rstrip('/'),
        'publishableKey': os.getenv('SUPABASE_PUBLISHABLE_KEY') or os.getenv('SUPABASE_ANON_KEY', ''),
        'secretKey': os.getenv('SUPABASE_SECRET_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''),
        'sessionSecret': os.getenv('SESSION_SECRET', ''),
        'resendKey': os.getenv('RESEND_API_KEY', ''),
        'resendWebhookSecret': os.getenv('RESEND_WEBHOOK_SECRET', ''),
        'groqKey': os.getenv('GROQ_API_KEY', ''),
        'groqModel': os.getenv('GROQ_MODEL') or 'openai/gpt-oss-20b',
    }


def readiness():
    c = config()
    auth = [name for key, name in [('supabaseUrl', 'SUPABASE_URL'), ('publishableKey', 'SUPABASE_PUBLISHABLE_KEY'), ('secretKey', 'SUPABASE_SECRET_KEY')] if not c[key]]
    if len(c['sessionSecret']) < 32:
        auth.append('SESSION_SECRET (32+ characters)')
    mail = [name for key, name in [('resendKey', 'RESEND_API_KEY'), ('resendWebhookSecret', 'RESEND_WEBHOOK_SECRET')] if not c[key]]
    return {'authReady': not auth, 'mailReady': not auth and not mail, 'authMissing': auth, 'mailMissing': mail}


def json_response(status, payload, headers=None):
    return JSONResponse(payload, status_code=status, headers={'Cache-Control': 'no-store', **(headers or {})})


def method(request, allowed):
    if request.method not in allowed:
        raise APIError(405, 'Method not allowed.', headers={'Allow': ', '.join(allowed)})


async def read_raw(request, limit=256 * 1024):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise APIError(413, 'Request body is too large.')
        chunks.append(chunk)
    return b''.join(chunks)


async def read_json(request):
    raw = await read_raw(request)
    try:
        data = json.loads(raw) if raw else {}
    except (ValueError, UnicodeDecodeError):
        raise APIError(400, 'Request body must be valid JSON.') from None
    if not isinstance(data, dict):
        raise APIError(400, 'Request body must be a JSON object.')
    return data


def same_origin(request):
    origin = request.headers.get('origin')
    if not origin:
        return False
    protocol = request.headers.get('x-forwarded-proto', 'https' if os.getenv('NODE_ENV') == 'production' or os.getenv('VERCEL') == '1' else 'http').split(',')[0].strip()
    try:
        parsed = urlsplit(origin)
        return parsed.netloc == request.headers.get('host') and parsed.scheme == protocol
    except ValueError:
        return False


def require_same_origin(request):
    if not same_origin(request):
        raise APIError(403, 'This request did not come from OpenMail.')
    return True


def log_safe_error(label, error):
    details = {}
    if isinstance(getattr(error, 'status', None), int):
        details['status'] = error.status
    code = getattr(error, 'code', None)
    if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', code):
        details['code'] = code
    logging.getLogger('openmail').error('%s %s', label, details)


def fail(error):
    status = getattr(error, 'status', 500)
    if not isinstance(status, int) or not 400 <= status <= 599:
        status = 500
    if status >= 500:
        log_safe_error('OpenMail API error', error)
    return json_response(status, {'error': 'OpenMail could not complete that request.' if status >= 500 else str(error)}, getattr(error, 'headers', None))


def valid_ip(value):
    if not isinstance(value, str) or '%' in value:
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def forwarded_auth_options(request):
    value = request.headers.get('x-forwarded-for', '').strip()
    if os.getenv('VERCEL') != '1' or not config()['secretKey'].startswith('sb_secret_') or not valid_ip(value):
        return {}
    return {'useSecretApiKey': True, 'forwardedClientIp': value}


async def timed_fetch(url, options=None, timeout_ms=10000):
    opts = dict(options or {})
    try:
        async with asyncio.timeout(timeout_ms / 1000):
            async with httpx.AsyncClient(timeout=timeout_ms / 1000, follow_redirects=False) as client:
                return await client.request(opts.get('method', 'GET'), url, headers=opts.get('headers'), content=opts.get('body'))
    except (httpx.TimeoutException, TimeoutError):
        raise APIError(504, 'Upstream service timed out.', code='UPSTREAM_TIMEOUT') from None
    except httpx.RequestError:
        raise APIError(502, 'Upstream service unavailable.', code='UPSTREAM_UNAVAILABLE') from None


def response_json(response, fallback=None):
    try:
        return response.json()
    except ValueError:
        return fallback


async def supabase_auth(path, options=None, **kwargs):
    opts = {**(options or {}), **kwargs}
    c = config()
    if not c['supabaseUrl'] or not c['publishableKey']:
        raise APIError(503, 'Account services are not configured yet.')
    use_secret = opts.get('useSecretApiKey') is True and c['secretKey'].startswith('sb_secret_')
    headers = {'apikey': c['secretKey'] if use_secret else c['publishableKey'], 'Content-Type': 'application/json'}
    if use_secret and valid_ip(opts.get('forwardedClientIp')):
        headers['Sb-Forwarded-For'] = opts['forwardedClientIp']
    if opts.get('accessToken'):
        headers['Authorization'] = 'Bearer ' + opts['accessToken']
    response = await timed_fetch(c['supabaseUrl'] + '/auth/v1' + path, {'method': opts.get('method', 'GET'), 'headers': headers, 'body': json.dumps(opts['body']) if 'body' in opts else None})
    data = response_json(response, {})
    if not response.is_success:
        raise APIError(response.status_code, next((data[k] for k in ('msg', 'message', 'error_description', 'error') if isinstance(data, dict) and data.get(k)), 'Account service request failed.'))
    return data


async def database(path, options=None, **kwargs):
    opts = {**(options or {}), **kwargs}
    c = config()
    if not c['supabaseUrl'] or not c['secretKey']:
        raise APIError(503, 'Secure storage is not configured yet.')
    headers = {'apikey': c['secretKey'], 'Content-Type': 'application/json'}
    if not c['secretKey'].startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + c['secretKey']
    if opts.get('prefer'):
        headers['Prefer'] = opts['prefer']
    headers.update(opts.get('headers', {}))
    response = await timed_fetch(c['supabaseUrl'] + '/rest/v1/' + path, {'method': opts.get('method', 'GET'), 'headers': headers, 'body': json.dumps(opts['body']) if 'body' in opts else None})
    data = response_json(response, response.text or None)
    if not response.is_success:
        raise APIError(response.status_code, next((data[k] for k in ('message', 'error_description', 'hint') if isinstance(data, dict) and data.get(k)), 'Secure storage request failed.'))
    return data


async def resend(path, options=None, **kwargs):
    opts = {**(options or {}), **kwargs}
    if not config()['resendKey']:
        raise APIError(503, 'Email transport is not configured yet.')
    headers = {'Authorization': 'Bearer ' + config()['resendKey'], **({'Content-Type': 'application/json'} if 'body' in opts else {}), **opts.get('headers', {})}
    response = await timed_fetch('https://api.resend.com' + path, {'method': opts.get('method', 'GET'), 'headers': headers, 'body': json.dumps(opts['body']) if 'body' in opts else None})
    data = response_json(response, {})
    if not response.is_success:
        raise APIError(400 if response.status_code < 500 else 502, data.get('message') or data.get('name') or 'Email provider request failed.')
    return data


async def consume_quota(owner, action):
    result = await database('rpc/consume_openmail_quota', method='POST', body={'p_owner': owner, 'p_action': action})
    if type(result) is not bool:
        raise RuntimeError('Usage limit service returned an invalid response.')
    return result


async def consume_ai_draft_quota(owner):
    result = await database('rpc/consume_openmail_ai_draft_quota', method='POST', body={'p_owner': owner, 'p_user_limit': 10, 'p_global_limit': 25})
    if type(result) is not bool:
        raise RuntimeError('AI usage limit service returned an invalid response.')
    return result


def cookie_options(max_age=2592000):
    secure = os.getenv('NODE_ENV') == 'production' or os.getenv('VERCEL') == '1'
    return f'Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}' + ('; Secure' if secure else '')


def b64url(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def b64decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def sign_session(session):
    secret = config()['sessionSecret']
    if len(secret) < 32:
        raise APIError(503, 'Session signing is not configured yet.')
    payload = b64url(json.dumps(session, ensure_ascii=False, separators=(',', ':')).encode())
    return payload + '.' + b64url(hmac.digest(secret.encode(), payload.encode(), 'sha256'))


def read_signed_session(request):
    secret = config()['sessionSecret']
    if len(secret) < 32:
        return None
    raw = next((part.strip()[len('openmail_session='):] for part in request.headers.get('cookie', '').split(';') if part.strip().startswith('openmail_session=')), '')
    try:
        payload, signature = unquote(raw).rsplit('.', 1)
        if not hmac.compare_digest(b64decode(signature), hmac.digest(secret.encode(), payload.encode(), 'sha256')):
            return None
        data = json.loads(b64decode(payload))
        return data if isinstance(data, dict) and data.get('refresh_token') else None
    except (ValueError, TypeError, UnicodeError):
        return None


def set_session(request, session):
    request.state.session_cookie = 'openmail_session=' + encode(sign_session(session)) + '; ' + cookie_options()


def clear_session(request):
    request.state.session_cookie = 'openmail_session=; ' + cookie_options(0)


def remember_auth_response(request, auth):
    if not auth.get('access_token') or not auth.get('refresh_token'):
        return False
    set_session(request, {'access_token': auth['access_token'], 'refresh_token': auth['refresh_token'], 'expires_at': int(time.time()) + (auth.get('expires_in') or 3600)})
    return True


async def current_user(request):
    session = read_signed_session(request)
    if not session:
        return None
    forwarding = forwarded_auth_options(request)
    try:
        if session.get('expires_at') and session['expires_at'] < int(time.time()) + 45:
            refreshed = await supabase_auth('/token?grant_type=refresh_token', {**forwarding, 'method': 'POST', 'body': {'refresh_token': session['refresh_token']}})
            session = {'access_token': refreshed['access_token'], 'refresh_token': refreshed['refresh_token'], 'expires_at': int(time.time()) + (refreshed.get('expires_in') or 3600)}
            set_session(request, session)
        if not session.get('access_token'):
            return None
        user = await supabase_auth('/user', {**forwarding, 'accessToken': session['access_token']})
        return {'id': user['id'], 'email': user.get('email'), 'emailConfirmed': bool(user.get('email_confirmed_at') or user.get('confirmed_at')), 'accessToken': session['access_token']}
    except Exception:
        return None


async def signed_in(request):
    user = await current_user(request)
    if not user:
        raise APIError(401, 'Sign in to continue.')
    return user


async def owned_row(table, id, owner, select='*'):
    if not re.fullmatch(r'[0-9a-f-]{36}', str(id or ''), re.I):
        return None
    rows = await database(f'{table}?' + query({'id': f'eq.{id}', 'owner_id': f'eq.{owner}', 'limit': '1'}, select))
    return rows[0] if isinstance(rows, list) and rows else None


def require_confirmed_email(user):
    if not user.get('emailConfirmed'):
        raise APIError(403, 'Confirm your account email before setting up or using a mailbox.')
    return True


async def require_quota(owner, action):
    if not await consume_quota(owner, action):
        window = 3600 if action in ('dns_check', 'domain_verify') else 86400
        raise APIError(429, 'You’ve reached this account’s current usage limit. Please try again later.', retry_after=window - int(time.time()) % window)
    return True
