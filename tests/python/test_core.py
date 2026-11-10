import asyncio
import json
import subprocess
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from starlette.requests import Request

from backend import auth, core


def request(body=b'', headers=None, method='POST'):
    sent = False
    async def receive():
        nonlocal sent
        chunk = body if not sent else b''
        sent = True
        return {'type': 'http.request', 'body': chunk, 'more_body': False}
    return Request({'type': 'http', 'method': method, 'path': '/', 'query_string': b'', 'scheme': 'https', 'headers': [(k.encode(), v.encode()) for k, v in {'host': 'openmail.test', 'origin': 'https://openmail.test', 'x-forwarded-proto': 'https', **(headers or {})}.items()]}, receive)


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    for key, value in {'SESSION_SECRET': 'synthetic-session-secret-' * 2, 'SUPABASE_URL': 'https://supabase.example.test', 'SUPABASE_PUBLISHABLE_KEY': 'test-public', 'SUPABASE_SECRET_KEY': 'sb_secret_test', 'RESEND_API_KEY': 'test-mail'}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.delenv('NODE_ENV', raising=False)


@pytest.mark.parametrize('raw,status', [(b'{', 400), (b'[]', 400), (b'null', 400), (b'x' * (256 * 1024 + 1), 413)])
async def test_json_rejects_bad_shape_or_size(raw, status):
    with pytest.raises(core.APIError) as e:
        await core.read_json(request(raw))
    assert e.value.status == status


async def test_json_valid_and_empty():
    assert await core.read_json(request(b'{"ok":true}')) == {'ok': True}
    assert await core.read_json(request()) == {}


@pytest.mark.parametrize('origin', ['', 'https://attacker.test', 'http://openmail.test', 'https://openmail.test:444'])
def test_cross_origin_rejected(origin):
    with pytest.raises(core.APIError) as e:
        core.require_same_origin(request(headers={'origin': origin}))
    assert e.value.status == 403


def test_same_origin_accepted():
    assert core.require_same_origin(request())


def test_cookie_is_compatible_in_both_languages():
    session = {'access_token': 'synthetic-access', 'refresh_token': 'synthetic-refresh', 'expires_at': 1999999999}
    token = core.sign_session(session)
    # Node represents the existing production cookie format. No real key or token
    # is read by this test or passed to this subprocess.
    script = "const c=require('node:crypto');const s=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const p=Buffer.from(JSON.stringify(s.session)).toString('base64url');process.stdout.write(p+'.'+c.createHmac('sha256',s.secret).update(p).digest('base64url'));"
    result = subprocess.run(['node', '-e', script], input=json.dumps({'session': session, 'secret': core.config()['sessionSecret']}), text=True, capture_output=True, check=True)
    assert token == result.stdout
    assert core.read_signed_session(request(headers={'cookie': 'openmail_session=' + result.stdout})) == session
    assert core.read_signed_session(request(headers={'cookie': 'openmail_session=x' + token})) is None


@pytest.mark.parametrize('value', ['', 'abc', 'a.b', '%%%%.%%', '..', '[]'])
def test_invalid_session_does_not_throw(value):
    assert core.read_signed_session(request(headers={'cookie': 'openmail_session=' + value})) is None


async def test_refresh_preserves_signed_in_session(monkeypatch):
    req = request(headers={'cookie': 'openmail_session=' + core.sign_session({'access_token': 'old', 'refresh_token': 'refresh', 'expires_at': int(time.time()) - 1})})
    provider = AsyncMock(side_effect=[{'access_token': 'new', 'refresh_token': 'new-refresh', 'expires_in': 3600}, {'id': 'owner', 'email': 'owner@example.test', 'email_confirmed_at': 'yes'}])
    monkeypatch.setattr(core, 'supabase_auth', provider)
    user = await core.current_user(req)
    assert user['accessToken'] == 'new'
    assert user['emailConfirmed'] is True
    assert 'HttpOnly' in req.state.session_cookie
    assert 'SameSite=Lax' in req.state.session_cookie


@pytest.mark.parametrize('ip,valid', [('203.0.113.3', True), ('2001:db8::1', True), ('1.2.3.4, 4.3.2.1', False), ('unknown', False), ('fe80::1%eth0', False)])
def test_forwarded_ip_requires_verified_single_value(monkeypatch, ip, valid):
    monkeypatch.setenv('VERCEL', '1')
    assert bool(core.forwarded_auth_options(request(headers={'x-forwarded-for': ip}))) is valid
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'legacy.jwt')
    assert not core.forwarded_auth_options(request(headers={'x-forwarded-for': ip}))


async def test_new_supabase_secret_never_used_as_bearer(monkeypatch):
    fetch = AsyncMock(return_value=httpx.Response(200, json=[]))
    monkeypatch.setattr(core, 'timed_fetch', fetch)
    await core.database('messages?owner_id=eq.owner')
    headers = fetch.call_args.args[1]['headers']
    assert 'Authorization' not in headers
    assert headers['apikey'] == 'sb_secret_test'


async def test_auth_ip_forwarding_uses_secret_only_when_requested(monkeypatch):
    fetch = AsyncMock(return_value=httpx.Response(200, json={}))
    monkeypatch.setattr(core, 'timed_fetch', fetch)
    await core.supabase_auth('/user', {'forwardedClientIp': '203.0.113.3'})
    assert fetch.call_args.args[1]['headers']['apikey'] == 'test-public'
    assert 'Sb-Forwarded-For' not in fetch.call_args.args[1]['headers']
    await core.supabase_auth('/user', {'useSecretApiKey': True, 'forwardedClientIp': '203.0.113.3'})
    assert fetch.call_args.args[1]['headers']['Sb-Forwarded-For'] == '203.0.113.3'


async def test_owner_query_cannot_read_foreign_row(monkeypatch):
    db = AsyncMock(return_value=[])
    monkeypatch.setattr(core, 'database', db)
    assert await core.owned_row('messages', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner-b') is None
    assert 'owner_id=eq.owner-b' in db.call_args.args[0]
    db.reset_mock()
    assert await core.owned_row('messages', 'bad&owner_id=neq.x', 'owner-b') is None
    db.assert_not_called()


async def test_quota_denial_has_retry_header(monkeypatch):
    monkeypatch.setattr(core, 'consume_quota', AsyncMock(return_value=False))
    with pytest.raises(core.APIError) as e:
        await core.require_quota('owner', 'email_send')
    assert e.value.status == 429
    assert 1 <= int(e.value.headers['Retry-After']) <= 86400


def test_server_errors_and_logs_hide_private_details(caplog):
    error = core.APIError(500, 'private email and secret token', code='SAFE_CODE')
    response = core.fail(error)
    assert b'private' not in response.body
    assert 'private' not in caplog.text
    assert 'SAFE_CODE' in caplog.text


@pytest.mark.parametrize('handler,payload,message', [
    (auth.authenticate, {'action': 'signup', 'email': 'a@example.test', 'password': 'long-enough-password'}, 'That account request could not be completed. Check your details and try again.'),
    (auth.callback, {'accessToken': 'a' * 32, 'refreshToken': 'r' * 32}, 'Email confirmation could not be completed. Sign in and try again.'),
])
async def test_auth_does_not_reveal_provider_details(monkeypatch, handler, payload, message):
    monkeypatch.setattr(auth, 'supabase_auth', AsyncMock(side_effect=core.APIError(422, 'User already registered: private details')))
    response = await handler(request(json.dumps(payload).encode()))
    assert response.status_code == 400
    assert json.loads(response.body) == {'error': message}


async def test_log_out_clears_cookie_when_provider_unavailable(monkeypatch):
    monkeypatch.setattr(auth, 'current_user', AsyncMock(return_value={'accessToken': 'test'}))
    monkeypatch.setattr(auth, 'supabase_auth', AsyncMock(side_effect=RuntimeError('provider down')))
    req = request()
    response = await auth.logout(req)
    assert response.status_code == 200
    assert 'Max-Age=0' in req.state.session_cookie


async def test_provider_has_absolute_deadline(monkeypatch):
    class SlowClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def request(self, *args, **kwargs):
            # Simulates a provider continuously trickling data: an inactivity
            # timeout alone would never stop this request.
            while True:
                await asyncio.sleep(0.001)
    monkeypatch.setattr(core.httpx, 'AsyncClient', SlowClient)
    with pytest.raises(core.APIError) as e:
        await core.timed_fetch('https://provider.example.test', timeout_ms=10)
    assert e.value.status == 504
    assert e.value.code == 'UPSTREAM_TIMEOUT'


async def test_signup_retains_utf16_password_boundary(monkeypatch):
    provider = AsyncMock(return_value={})
    monkeypatch.setattr(auth, 'supabase_auth', provider)
    payload = {'action': 'signup', 'email': 'person@example.test', 'password': '😀' * 6}
    response = await auth.authenticate(request(json.dumps(payload).encode()))
    assert response.status_code == 200
    provider.assert_awaited_once()
