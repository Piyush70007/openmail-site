"""Account routes with the existing session and browser response contracts."""
import math
import os
import re

from .core import (APIError, clear_session, current_user, encode, forwarded_auth_options,
                   json_response, method, read_json, remember_auth_response,
                   require_same_origin, supabase_auth, utf16_length)


def valid_email(email):
    return utf16_length(email) <= 254 and bool(re.fullmatch(r'\S+@\S+\.\S+', email))


async def authenticate(request):
    method(request, ['POST'])
    require_same_origin(request)
    try:
        body = await read_json(request)
        action = str(body.get('action') or '')
        email = str(body.get('email') or '').strip().lower()
        password = str(body.get('password') or '')
        if not valid_email(email):
            return json_response(400, {'error': 'Enter a valid account email.'})
        opts = {**forwarded_auth_options(request), 'method': 'POST', 'body': {'email': email, 'password': password}}
        if action == 'login':
            if not 0 < utf16_length(password) <= 128:
                return json_response(400, {'error': 'Enter your account email and a password up to 128 characters.'})
            auth = await supabase_auth('/token?grant_type=password', opts)
            if not remember_auth_response(request, auth):
                return json_response(401, {'error': 'Sign in could not be completed.'})
            return json_response(200, {'ok': True, 'user': {'email': (auth.get('user') or {}).get('email')}})
        if action == 'signup':
            if not 12 <= utf16_length(password) <= 128:
                return json_response(400, {'error': 'Enter a password with at least 12 characters.'})
            host = request.headers.get('host', '')
            protocol = request.headers.get('x-forwarded-proto', 'http' if host.startswith('localhost') else 'https').split(',')[0].strip()
            origin = os.getenv('OPENMAIL_PUBLIC_URL') or f'{protocol}://{host}'
            auth = await supabase_auth('/signup?redirect_to=' + encode(origin + '/app.html'), opts)
            signed_in = remember_auth_response(request, auth)
            return json_response(200, {'ok': True, 'signedIn': signed_in, 'message': 'Your account is ready.' if signed_in else 'Check your email to confirm your account, then sign in.'})
        return json_response(400, {'error': 'Choose sign in or create account.'})
    except APIError as error:
        if 400 <= error.status < 500:
            return json_response(429 if error.status == 429 else 400, {'error': 'That account request could not be completed. Check your details and try again.'})
        raise


async def session(request):
    method(request, ['GET'])
    user = await current_user(request)
    return json_response(200, {'signedIn': bool(user), 'user': {'id': user['id'], 'email': user.get('email')} if user else None})


async def logout(request):
    method(request, ['POST'])
    require_same_origin(request)
    user = await current_user(request)
    if user:
        try:
            await supabase_auth('/logout', {**forwarded_auth_options(request), 'method': 'POST', 'accessToken': user['accessToken']})
        except Exception:
            pass
    clear_session(request)
    return json_response(200, {'ok': True})


async def callback(request):
    method(request, ['POST'])
    require_same_origin(request)
    try:
        body = await read_json(request)
        access, refresh = str(body.get('accessToken') or ''), str(body.get('refreshToken') or '')
        if not 20 <= utf16_length(access) <= 8192 or not 20 <= utf16_length(refresh) <= 2048:
            return json_response(400, {'error': 'The confirmation session is missing or expired. Sign in to continue.'})
        user = await supabase_auth('/user', {**forwarded_auth_options(request), 'accessToken': access})
        try:
            expires = float(body.get('expiresIn') or 3600)
            expires = expires if math.isfinite(expires) else 3600
        except (ValueError, TypeError):
            expires = 3600
        remember_auth_response(request, {'access_token': access, 'refresh_token': refresh, 'expires_in': max(60, min(86400, expires))})
        return json_response(200, {'ok': True, 'user': {'id': user['id'], 'email': user.get('email')}})
    except APIError as error:
        if 400 <= error.status < 500:
            return json_response(400, {'error': 'Email confirmation could not be completed. Sign in and try again.'})
        raise
