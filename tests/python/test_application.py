"""HTTP-level regressions against the URLs the existing frontend consumes."""
import base64
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend import core, webhook
from backend.application import PUBLIC_FILES, ROOT, app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('SESSION_SECRET', 'test-secret-with-at-least-32-characters')
    with TestClient(app, base_url='https://openmail.test') as client:
        yield client


@pytest.mark.parametrize('path', ['/api/domains', '/api/mailboxes', '/api/messages?mailboxId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '/api/ai/profile', '/api/ai/knowledge', '/api/ai/documents', '/api/ai/mailbox-settings', '/api/ai/simulator', '/api/ai/representatives', '/api/ai/workflows', '/api/ai/trust', '/api/messages?aiResource=profile'])
def test_private_routes_require_session(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json() == {'error': 'Sign in to continue.'}
    assert response.headers['cache-control'] == 'no-store'


@pytest.mark.parametrize('path', ['/api/auth', '/api/auth/callback', '/api/auth/logout', '/api/messages/send', '/api/messages/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '/api/ai/profile', '/api/ai/simulator', '/api/ai/representatives', '/api/ai/workflows', '/api/ai/trust'])
def test_mutations_reject_foreign_origin(client, path):
    verb = 'patch' if path.endswith(('/profile', '/representatives')) or '/messages/aaaa' in path else 'post'
    response = getattr(client, verb)(path, json={}, headers={'origin': 'https://attacker.test', 'x-forwarded-proto': 'https'})
    assert response.status_code == 403


def test_session_and_status_are_public_but_reveal_no_secrets(client):
    assert client.get('/api/auth/session').json() == {'signedIn': False, 'user': None}
    data = client.get('/api/status').json()
    assert set(data) == {'authReady', 'mailReady', 'authMissing', 'mailMissing'}


@pytest.mark.parametrize('path', ['/backend/core.py', '/.env', '/.env.local', '/pyproject.toml', '/vercel.json', '/tests/python/test_core.py', '/supabase/schema.sql', '/.git/config', '/docs', '/openapi.json'])
def test_only_public_assets_are_served(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.parametrize('name', sorted(PUBLIC_FILES))
def test_browser_assets_are_identical_bytes(client, name):
    response = client.get('/' + name)
    assert response.status_code == 200
    assert response.content == (ROOT / name).read_bytes()
    assert response.headers['x-frame-options'] == 'DENY'
    assert "form-action 'self'" in response.headers['content-security-policy']


def test_unexpected_methods_and_resources_keep_json_contract(client):
    response = client.post('/api/auth/session')
    assert response.status_code == 405
    assert response.headers['allow'] == 'GET'
    assert response.json() == {'error': 'Method not allowed.'}
    assert client.get('/api/messages?aiResource=unknown').status_code == 404


def signed_headers(body, secret, timestamp=None):
    timestamp = str(timestamp if timestamp is not None else int(time.time()))
    signature = base64.b64encode(hmac.digest(base64.b64decode(secret[6:]), b'test-id.' + timestamp.encode() + b'.' + body, 'sha256')).decode()
    return {'svix-id': 'test-id', 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature, 'content-type': 'application/json'}


def test_webhook_rejects_tampering_replay_and_oversize(client, monkeypatch):
    secret = 'whsec_' + base64.b64encode(b'test-secret').decode()
    monkeypatch.setenv('RESEND_WEBHOOK_SECRET', secret)
    body = b'{"type":"email.received","data":{"email_id":"test"}}'
    assert client.post('/api/webhooks/resend', content=body + b' ', headers=signed_headers(body, secret)).status_code == 401
    assert client.post('/api/webhooks/resend', content=body, headers=signed_headers(body, secret, int(time.time()) - 360)).status_code == 401
    assert client.post('/api/webhooks/resend', content=b'x' * (1024 * 1024 + 1)).status_code == 413


def test_signed_webhook_stores_mail_and_awaits_automatic_reply(client, monkeypatch):
    secret = 'whsec_' + base64.b64encode(b'test-secret').decode()
    monkeypatch.setenv('RESEND_WEBHOOK_SECRET', secret)
    provider = AsyncMock(return_value={'id': 'provider-id', 'to': ['help@example.test'], 'from': 'sender@example.test', 'subject': 'Hours?', 'text': 'When are you open?', 'headers': {}})
    db = AsyncMock(side_effect=[[{'id': 'mailbox', 'owner_id': 'owner'}], [{'id': 'message'}]])
    automation = AsyncMock()
    monkeypatch.setattr(webhook, 'resend', provider)
    monkeypatch.setattr(webhook, 'database', db)
    monkeypatch.setattr(webhook, 'process_automatic_reply', automation)
    body = b'{"type":"email.received","data":{"email_id":"test"}}'
    response = client.post('/api/webhooks/resend', content=body, headers=signed_headers(body, secret))
    assert response.json() == {'ok': True}
    assert db.call_args.kwargs['body']['owner_id'] == 'owner'
    assert db.call_args.kwargs['body']['ai_auto_submitted'] is False
    automation.assert_awaited_once_with('message')


def test_duplicate_delivery_uses_existing_message_job(client, monkeypatch):
    secret = 'whsec_' + base64.b64encode(b'test-secret').decode()
    monkeypatch.setenv('RESEND_WEBHOOK_SECRET', secret)
    monkeypatch.setattr(webhook, 'resend', AsyncMock(return_value={'id': 'provider-id', 'to': ['help@example.test'], 'from': 'sender@example.test', 'text': 'Hello'}))
    db = AsyncMock(side_effect=[[{'id': 'mailbox', 'owner_id': 'owner'}], core.APIError(409, 'duplicate'), [{'id': 'existing-message'}]])
    automation = AsyncMock()
    monkeypatch.setattr(webhook, 'database', db)
    monkeypatch.setattr(webhook, 'process_automatic_reply', automation)
    body = b'{"type":"email.received","data":{"email_id":"test"}}'
    response = client.post('/api/webhooks/resend', content=body, headers=signed_headers(body, secret))
    assert response.status_code == 200
    automation.assert_awaited_once_with('existing-message')
    assert 'mailbox_id=eq.mailbox' in db.call_args.args[0]


def test_auto_submitted_and_html_are_handled():
    assert webhook.is_auto_submitted([{'name': 'Auto-Submitted', 'value': 'auto-replied'}])
    assert webhook.is_auto_submitted({'Precedence': 'bulk'})
    assert not webhook.is_auto_submitted({'Auto-Submitted': 'no'})
    assert webhook.html_to_text('<script>private()</script><p>Hi &amp; hello</p>') == 'Hi & hello'
