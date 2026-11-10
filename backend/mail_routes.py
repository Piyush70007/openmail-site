"""Mail and domain handlers preserving OpenMail's existing browser API."""
import re
from urllib.parse import urlencode

import dns.asyncresolver
import dns.exception
import dns.resolver
import idna

from .core import (
    APIError, database, encode, iso_now, json_response, method, owned_row,
    read_json, readiness, require_confirmed_email, require_quota,
    require_same_origin, resend, signed_in,
    utf16_length as js_len,
)

UUID = re.compile(r"^[0-9a-f-]{36}$", re.I)
MESSAGE_FIELDS = (
    "id,direction,from_address,to_addresses,subject,preview,text_body,read_at,"
    "starred,folder,status,created_at,client_request_id,ai_auto_sent,"
    "ai_reply_to_message_id,ai_handoff_status,ai_handoff_reason,"
    "ai_representative_id,ai_workflow_id"
)


def text_value(value):
    """Match String(value || '') for browser-supplied textual fields."""
    if value is None or value is False or value == 0 or value == "":
        return ""
    if value is True:
        return "true"
    if isinstance(value, dict):
        return "[object Object]"
    if isinstance(value, list):
        return ",".join(text_value(item) for item in value)
    return str(value)


def preview_text(value):
    """Keep the existing 180-unit preview cap without emitting half an emoji."""
    return value.encode("utf-16-le", errors="surrogatepass")[:360].decode("utf-16-le", errors="ignore")


def _row(value):
    return (value[0] if value else None) if isinstance(value, list) else value


def _error(status, message):
    return json_response(status, {"error": message})


def address_list(value, lower=False):
    values = value if isinstance(value, list) else text_value(value).split(",")
    result = [text_value(item).strip() for item in values]
    return [item.lower() if lower else item for item in result if item]


def valid_address(value):
    return isinstance(value, str) and js_len(value) <= 254 and bool(
        re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", value)
    )


def normalize_domain(value):
    """Normalize IDNA names without URL-style numeric host alias coercion.

    This intentionally uses valid IDNA DNS labels rather than WHATWG URL-host
    coercion. It cannot silently rewrite a domain into an IPv4 address and does
    not provision non-IDNA emoji labels, which the former URL parser accepted.
    Ordinary ASCII and valid international domain names retain their spelling.
    """
    name = text_value(value).strip().removesuffix(".").lower()
    try:
        ascii_name = idna.encode(name, uts46=True).decode("ascii")
    except (idna.IDNAError, UnicodeError):
        return ""
    if not ascii_name or len(ascii_name) > 253 or "." not in ascii_name:
        return ""
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
           for part in ascii_name.split(".")):
        return ""
    return ascii_name


async def domains(request):
    method(request, ["GET", "POST"])
    user = await signed_in(request)
    if request.method == "GET":
        if request.query_params.get("check"):
            domain = normalize_domain(request.query_params["check"])
            if not domain:
                return _error(400, "Enter a valid domain name, such as example.com.")
            await require_quota(user["id"], "dns_check")
            try:
                answers = await dns.asyncresolver.resolve(domain, "MX")
                records = sorted(
                    [{"priority": int(item.preference), "host": str(item.exchange).removesuffix(".")}
                     for item in answers], key=lambda item: item["priority"]
                )
                return json_response(200, {
                    "domain": domain, "mxLookup": "found", "existingMailRoute": True, "mx": records,
                })
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                return json_response(200, {
                    "domain": domain, "mxLookup": "not-found", "existingMailRoute": False, "mx": [],
                })
            except Exception:
                return json_response(200, {
                    "domain": domain, "mxLookup": "unavailable", "existingMailRoute": None, "mx": [],
                })
        rows = await database(
            f"domains?select=id,domain_name,status,dns_records,created_at&owner_id=eq.{encode(user['id'])}&order=created_at.desc"
        )
        return json_response(200, {"domains": rows or []})

    require_same_origin(request)
    if not readiness()["mailReady"]:
        return _error(503, "Email services are not connected yet. Finish the setup listed in the project README.")
    require_confirmed_email(user)
    body = await read_json(request)
    domain_name = normalize_domain(body.get("domain"))
    if not domain_name:
        return _error(400, "Enter a valid domain name, such as example.com.")
    existing = await database(f"domains?select=id&domain_name=eq.{encode(domain_name)}&limit=1")
    if existing:
        return _error(409, "That domain is already connected to an OpenMail account.")
    await require_quota(user["id"], "domain_create")
    provider = await resend("/domains", {
        "method": "POST", "body": {
            "name": domain_name, "capabilities": {"sending": "enabled", "receiving": "enabled"},
        },
    })
    saved = await database("domains", {
        "method": "POST", "prefer": "return=representation", "body": {
            "owner_id": user["id"], "domain_name": domain_name,
            "provider_domain_id": provider.get("id"), "status": provider.get("status") or "pending",
            "dns_records": provider.get("records") or [],
        },
    })
    return json_response(201, {"domain": _row(saved)})


async def verify_domain(request):
    method(request, ["POST"])
    require_same_origin(request)
    user = await signed_in(request)
    require_confirmed_email(user)
    if not readiness()["mailReady"]:
        return _error(503, "Email services are not connected yet.")
    domain = await owned_row("domains", request.path_params.get("id"), user["id"],
                             "id,domain_name,provider_domain_id,status,dns_records")
    if not domain:
        return _error(404, "Domain not found.")
    await require_quota(user["id"], "domain_verify")
    provider_path = f"/domains/{encode(domain['provider_domain_id'])}"
    try:
        await resend(f"{provider_path}/verify", {"method": "POST"})
    except APIError as error:
        if error.status != 400:
            raise
    provider = await resend(provider_path)
    status = provider.get("status") or domain.get("status")
    records = provider.get("records")
    if not isinstance(records, list):
        records = domain.get("dns_records") or []
    updated = await database(f"domains?id=eq.{encode(domain['id'])}&owner_id=eq.{encode(user['id'])}", {
        "method": "PATCH", "body": {"status": status, "dns_records": records},
        "prefer": "return=representation",
    })
    return json_response(200, {"domain": _row(updated) if isinstance(updated, list)
                              else {**domain, "status": status, "dns_records": records}})


async def mailboxes(request):
    method(request, ["GET", "POST"])
    user = await signed_in(request)
    if request.method == "GET":
        rows = await database(
            f"mailboxes?select=id,domain_id,address,local_part,status,created_at&owner_id=eq.{encode(user['id'])}&order=created_at.desc"
        )
        return json_response(200, {"mailboxes": rows or []})
    require_same_origin(request)
    if not readiness()["mailReady"]:
        return _error(503, "Email services are not connected yet.")
    require_confirmed_email(user)
    body = await read_json(request)
    local_part = text_value(body.get("localPart")).strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?", local_part) or ".." in local_part:
        return _error(400, "Use 1–64 letters, numbers, dots, plus signs, underscores, or hyphens.")
    domain = await owned_row("domains", body.get("domainId"), user["id"], "id,domain_name,status")
    if not domain:
        return _error(404, "Choose a domain connected to your account.")
    if domain.get("status") != "verified":
        return _error(409, "Verify your domain before creating mailboxes.")
    await require_quota(user["id"], "mailbox_create")
    address = f"{local_part}@{domain['domain_name']}"
    try:
        saved = await database("mailboxes", {
            "method": "POST", "prefer": "return=representation", "body": {
                "owner_id": user["id"], "domain_id": domain["id"], "local_part": local_part,
                "address": address, "status": "active",
            },
        })
    except APIError as error:
        if error.status in (409, 23505):
            return _error(409, "That address already exists. Choose another name.")
        raise
    return json_response(201, {"mailbox": _row(saved)})


async def messages(request):
    method(request, ["GET", "POST", "PATCH"])
    user = await signed_in(request)
    if request.method == "GET":
        mailbox = await owned_row("mailboxes", request.query_params.get("mailboxId"), user["id"], "id,address,status")
        if not mailbox:
            return _error(404, "Mailbox not found.")
        view = request.query_params.get("view") or "inbox"
        if view not in ("inbox", "sent", "archive", "spam", "trash", "drafts", "starred", "ai_sent", "needs_review"):
            return _error(400, "Unknown mailbox view.")
        filters = {
            "select": MESSAGE_FIELDS, "owner_id": f"eq.{user['id']}",
            "mailbox_id": f"eq.{mailbox['id']}", "order": "created_at.desc", "limit": "100",
        }
        if view == "starred":
            filters.update(starred="eq.true", folder="neq.trash")
        elif view == "ai_sent":
            filters.update(direction="eq.outbound", folder="eq.sent", status="eq.sent", ai_auto_sent="eq.true")
        elif view == "needs_review":
            filters.update(direction="eq.inbound", folder="neq.trash", ai_handoff_status="eq.pending")
        else:
            filters["folder"] = f"eq.{view}"
        rows = await database(f"messages?{urlencode(filters)}")
        return json_response(200, {"mailbox": mailbox, "messages": rows or []})

    require_same_origin(request)
    body = await read_json(request)
    if request.method == "POST":
        if body.get("action") != "saveDraft":
            return _error(400, "That message action is not supported.")
        mailbox = await owned_row("mailboxes", body.get("mailboxId"), user["id"], "id,address,status")
        if not mailbox or mailbox.get("status") != "active":
            return _error(404, "Active mailbox not found.")
        to = address_list(body.get("to"))
        subject, text = text_value(body.get("subject")), text_value(body.get("text"))
        request_id = text_value(body.get("requestId"))
        if len(to) > 10 or any(js_len(address) > 254 for address in to):
            return _error(400, "A draft can contain up to 10 recipients.")
        if js_len(subject) > 200 or js_len(text) > 100000 or not UUID.fullmatch(request_id):
            return _error(400, "This draft is too long or its compose session expired.")
        record = {
            "owner_id": user["id"], "mailbox_id": mailbox["id"], "direction": "outbound",
            "from_address": mailbox["address"], "to_addresses": to, "subject": subject,
            "preview": preview_text(text), "text_body": text, "folder": "drafts", "status": "draft",
            "client_request_id": request_id,
        }
        filters = {"select": "id,mailbox_id,folder", "owner_id": f"eq.{user['id']}",
                   "client_request_id": f"eq.{request_id}", "limit": "1"}
        existing = await database(f"messages?{urlencode(filters)}")
        if existing:
            if existing[0].get("mailbox_id") != mailbox["id"] or existing[0].get("folder") != "drafts":
                return _error(409, "This compose session is already in use. Start a new draft.")
            updated = await database(
                f"messages?id=eq.{encode(existing[0]['id'])}&owner_id=eq.{encode(user['id'])}&folder=eq.drafts",
                {"method": "PATCH", "body": record, "prefer": "return=representation"},
            )
            return json_response(200, {"ok": True, "message": _row(updated)})
        inserted = await database("messages", {"method": "POST", "body": record, "prefer": "return=representation"})
        return json_response(201, {"ok": True, "message": _row(inserted)})

    mailbox = await owned_row("mailboxes", body.get("mailboxId"), user["id"], "id,address,status")
    ids = [text_value(item) for item in body["ids"]] if isinstance(body.get("ids"), list) else []
    action = text_value(body.get("action"))
    if not mailbox or not ids or len(ids) > 100 or any(not UUID.fullmatch(item) for item in ids):
        return _error(400, "Select up to 100 messages in this mailbox.")
    if action not in ("inbox", "archive", "spam", "trash"):
        return _error(400, "That bulk action is not supported.")
    filters = {"id": f"in.({','.join(ids)})", "owner_id": f"eq.{user['id']}",
               "mailbox_id": f"eq.{mailbox['id']}", "select": "id,folder"}
    updated = await database(f"messages?{urlencode(filters)}", {
        "method": "PATCH", "body": {"folder": action}, "prefer": "return=representation",
    })
    return json_response(200, {"ok": True, "updated": len(updated) if isinstance(updated, list) else 0})


async def message_detail(request):
    method(request, ["PATCH"])
    require_same_origin(request)
    user = await signed_in(request)
    message_id = text_value(request.path_params.get("id"))
    if not UUID.fullmatch(message_id):
        return _error(404, "Message not found.")
    body = await read_json(request)
    action = body.get("action")
    if action == "aiDraft":
        from .ai import generate_reply_draft
        require_confirmed_email(user)
        result = await generate_reply_draft(user["id"], body.get("mailboxId"), message_id)
        return json_response(200, result)
    if action == "resolveHandoff":
        resolved = await database(
            f"messages?id=eq.{encode(message_id)}&owner_id=eq.{encode(user['id'])}&direction=eq.inbound&ai_handoff_status=eq.pending&select=id,ai_handoff_status,ai_handoff_reason",
            {"method": "PATCH", "body": {"ai_handoff_status": "resolved"}, "prefer": "return=representation"},
        )
        if not resolved:
            return _error(404, "Open human handoff not found.")
        return json_response(200, {"ok": True, "message": resolved[0]})
    if action == "read":
        updates = {"read_at": iso_now()}
    elif action == "unread":
        updates = {"read_at": None}
    elif action in ("inbox", "archive", "spam", "trash"):
        updates = {"folder": action}
    elif action == "star":
        starred = body.get("starred")
        updates = {"starred": True if isinstance(starred, (list, dict)) else bool(starred)}
    elif action == "draft":
        to = address_list(body.get("to"))
        subject, text = text_value(body.get("subject")), text_value(body.get("text"))
        if len(to) > 10 or any(js_len(address) > 254 for address in to) or js_len(subject) > 200 or js_len(text) > 100000:
            return _error(400, "This draft is too long. Check the recipients, subject and message.")
        updates = {"to_addresses": to, "subject": subject, "preview": preview_text(text),
                   "text_body": text, "folder": "drafts", "status": "draft"}
    else:
        return _error(400, "That message action is not supported.")
    filters = {"id": f"eq.{message_id}", "owner_id": f"eq.{user['id']}",
               "select": "id,read_at,starred,folder,status,client_request_id"}
    if action == "draft":
        filters["folder"] = "eq.drafts"
    updated = await database(f"messages?{urlencode(filters)}", {
        "method": "PATCH", "body": updates, "prefer": "return=representation",
    })
    if not updated:
        return _error(404, "Message not found.")
    return json_response(200, {"message": updated[0]})


async def send_message(request):
    method(request, ["POST"])
    require_same_origin(request)
    user = await signed_in(request)
    require_confirmed_email(user)
    if not readiness()["mailReady"]:
        return _error(503, "Email services are not connected yet.")
    body = await read_json(request)
    mailbox = await owned_row("mailboxes", body.get("mailboxId"), user["id"], "id,address,domain_id,status")
    if not mailbox or mailbox.get("status") != "active":
        return _error(404, "Active mailbox not found.")
    domain = await owned_row("domains", mailbox["domain_id"], user["id"], "id,status")
    if not domain or domain.get("status") != "verified":
        return _error(409, "Verify the sending domain before sending mail.")
    to = address_list(body.get("to"), lower=True)
    subject, text = text_value(body.get("subject")).strip(), text_value(body.get("text")).strip()
    request_id, draft_id = text_value(body.get("requestId")), text_value(body.get("draftId"))
    if not to or len(to) > 10 or any(not valid_address(address) for address in to):
        return _error(400, "Enter between 1 and 10 valid recipient email addresses.")
    if not subject or js_len(subject) > 200 or not text or js_len(text) > 100000:
        return _error(400, "Add a subject and message (up to 100,000 characters).")
    if not UUID.fullmatch(request_id):
        return _error(400, "Refresh the compose window and try again.")
    if draft_id and not UUID.fullmatch(draft_id):
        return _error(404, "Draft not found.")
    try:
        filters = {"select": "id,status,provider_email_id,created_at", "owner_id": f"eq.{user['id']}",
                   "client_request_id": f"eq.{request_id}", "limit": "1"}
        rows = await database(f"messages?{urlencode(filters)}")
        message = _row(rows)
        if draft_id:
            filters = {"select": "id,status,provider_email_id,created_at", "id": f"eq.{draft_id}",
                       "owner_id": f"eq.{user['id']}", "mailbox_id": f"eq.{mailbox['id']}",
                       "folder": "eq.drafts", "limit": "1"}
            drafts = await database(f"messages?{urlencode(filters)}")
            if not drafts:
                if message and message.get("id") == draft_id and message.get("status") == "sent":
                    return json_response(200, {"ok": True, "message": message})
                return _error(404, "Draft not found in this mailbox.")
            message = drafts[0]
        if message and message.get("status") == "sent":
            return json_response(200, {"ok": True, "message": message})
        if message and message.get("status") == "sending":
            return _error(409, "This message is already being sent.")
        await require_quota(user["id"], "email_send")
        if not message:
            inserted = await database("messages", {
                "method": "POST", "prefer": "return=representation", "body": {
                    "owner_id": user["id"], "mailbox_id": mailbox["id"], "direction": "outbound",
                    "from_address": mailbox["address"], "to_addresses": to, "subject": subject,
                    "preview": preview_text(text), "text_body": text, "status": "sending",
                    "folder": "sent", "client_request_id": request_id,
                },
            })
            message = _row(inserted)
        else:
            updates = {"status": "sending"}
            if draft_id:
                updates.update(to_addresses=to, subject=subject, preview=preview_text(text),
                               text_body=text, client_request_id=request_id)
            await database(f"messages?id=eq.{encode(message['id'])}&owner_id=eq.{encode(user['id'])}",
                           {"method": "PATCH", "body": updates})
        message_path = f"messages?id=eq.{encode(message['id'])}&owner_id=eq.{encode(user['id'])}"
        try:
            sent = await resend("/emails", {
                "method": "POST", "headers": {"Idempotency-Key": request_id},
                "body": {"from": mailbox["address"], "to": to, "subject": subject, "text": text},
            })
            updated = await database(message_path, {
                "method": "PATCH", "body": {"status": "sent", "folder": "sent", "provider_email_id": sent.get("id") or None},
                "prefer": "return=representation",
            })
            return json_response(200, {"ok": True, "message": _row(updated) if isinstance(updated, list) else message})
        except Exception:
            try:
                await database(message_path, {
                    "method": "PATCH", "body": {"status": "draft", "folder": "drafts"} if draft_id else {"status": "failed"},
                })
            except Exception:
                pass
            raise
    except APIError as error:
        if error.status == 409:
            return _error(409, "That send request is already in progress. Refresh Sent in a moment.")
        raise
