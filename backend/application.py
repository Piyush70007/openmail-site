"""FastAPI routing with the same URLs used by the existing browser app."""
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse

from . import auth, ai_platform, ai_setup, mail_routes, webhook
from .core import fail, json_response, method, readiness

ROOT = Path(__file__).resolve().parent.parent
SECURITY_HEADERS = {h['key']: h['value'] for h in json.loads((ROOT / 'vercel.json').read_text())['headers'][0]['headers']}
PUBLIC_FILES = frozenset(('index.html', 'app.html', 'styles.css', 'app.css', 'workspace.css', 'app.js', 'app-ui.js', 'app-ai-documents.js', 'favicon.svg', 'vendor/MAMMOTH-LICENSE.txt', 'vendor/PDFJS-LICENSE.txt', 'vendor/mammoth.browser.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'))
app = FastAPI(title='OpenMail', docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)


def secure_response(request, response):
    for name, value in SECURITY_HEADERS.items():
        if name == 'Content-Security-Policy' and os.getenv('VERCEL') != '1' and request.url.scheme == 'http':
            value = value.replace('; upgrade-insecure-requests', '')
        response.headers[name] = value
    cookie = getattr(request.state, 'session_cookie', None)
    if cookie:
        response.headers['Set-Cookie'] = cookie
    return response


def route(path, handler):
    async def endpoint(request: Request):
        try:
            response = await handler(request)
        except Exception as error:
            response = fail(error)
        return secure_response(request, response)
    app.add_api_route(path, endpoint, methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], name=handler.__name__)


async def status(request):
    method(request, ['GET'])
    return json_response(200, readiness())


AI_ROUTES = {'profile': ai_setup.profile, 'knowledge': ai_setup.knowledge,
             'documents': ai_setup.documents, 'mailbox-settings': ai_setup.mailbox_settings,
             'simulator': ai_platform.simulator, 'representatives': ai_platform.representatives,
             'workflows': ai_platform.workflows, 'trust': ai_platform.trust}


async def messages(request):
    resource = request.query_params.get('aiResource', '')
    if resource:
        handler = AI_ROUTES.get(resource)
        if not handler:
            return json_response(404, {'error': 'That OpenMail route was not found.'})
        return await handler(request)
    return await mail_routes.messages(request)


for path, handler in [('/api/status', status), ('/api/auth', auth.authenticate),
                      ('/api/auth/session', auth.session), ('/api/auth/logout', auth.logout),
                      ('/api/auth/callback', auth.callback), ('/api/domains', mail_routes.domains),
                      ('/api/domains/{id}/verify', mail_routes.verify_domain),
                      ('/api/mailboxes', mail_routes.mailboxes), ('/api/messages', messages),
                      ('/api/messages/send', mail_routes.send_message),
                      ('/api/messages/{id}', mail_routes.message_detail),
                      ('/api/webhooks/resend', webhook.receive)]:
    route(path, handler)
for resource, handler in AI_ROUTES.items():
    route('/api/ai/' + resource, handler)


@app.api_route('/{path:path}', methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
async def static_or_missing(request: Request, path: str):
    name = path or 'index.html'
    if name in PUBLIC_FILES and request.method in ('GET', 'HEAD'):
        response = FileResponse(ROOT / name)
    else:
        response = json_response(404, {'error': 'That OpenMail route was not found.'})
    return secure_response(request, response)
