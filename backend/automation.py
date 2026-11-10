"""Idempotent inbox automation; sends only after mailbox opt-in and evidence checks."""
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from .core import database, readiness, consume_quota, resend, log_safe_error
from .ai import generate_automatic_decision, generate_reply_draft, high_risk_reason, message_address, enc, UUID, slice_text


def as_row(result):
    return (result[0] if result else None) if isinstance(result, list) else result or None


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def patch_message(message_id, owner_id, updates, db):
    await db(f"messages?id=eq.{enc(message_id)}&owner_id=eq.{enc(owner_id)}", {"method": "PATCH", "body": updates})


async def patch_job(message_id, owner_id, updates, db):
    # JSON response fields differ from Postgres columns; never send camelCase to PostgREST.
    names = {"representativeId": "representative_id", "workflowId": "workflow_id", "evidenceSourceIds": "evidence_source_ids"}
    columns = {names.get(key, key): value for key, value in updates.items()}
    await db(f"ai_auto_reply_jobs?inbound_message_id=eq.{enc(message_id)}&owner_id=eq.{enc(owner_id)}", {"method": "PATCH", "body": {**columns, "updated_at": iso_now()}})


async def record_trust(inbound, event_type, fields=None, db=None):
    fields, db = fields or {}, db or database
    confidence = fields.get("confidence")
    confidence = confidence if isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and math.isfinite(confidence) else None
    try:
        await db("ai_trust_events?on_conflict=idempotency_key", {"method": "POST", "body": {
            "owner_id": inbound["owner_id"], "mailbox_id": inbound["mailbox_id"], "message_id": inbound["id"],
            "representative_id": fields.get("representativeId") or inbound.get("ai_representative_id"),
            "workflow_id": fields.get("workflowId") or inbound.get("ai_workflow_id"),
            "event_type": event_type, "confidence": confidence,
            "evidence_source_ids": fields["evidenceSourceIds"][:4] if isinstance(fields.get("evidenceSourceIds"), list) else [],
            "model": slice_text(str(fields.get("model") or ""), 120),
            "idempotency_key": f"{inbound['owner_id']}:{inbound['id']}:{event_type}",
        }, "prefer": "resolution=ignore-duplicates,return=minimal"})
    except Exception as error:
        log_safe_error("Could not record OpenMail AI trust event", error)


async def handoff(inbound, reason, model="", db=None, fields=None):
    db, fields = db or database, fields or {}
    safe_reason = slice_text(str(reason or "A person should review this message."), 300)
    await patch_message(inbound["id"], inbound["owner_id"], {"ai_handoff_status": "pending", "ai_handoff_reason": safe_reason}, db)
    await patch_job(inbound["id"], inbound["owner_id"], {
        "status": "human_review", "reason": safe_reason, "model": model,
        "representative_id": fields.get("representativeId") or inbound.get("ai_representative_id"),
        "workflow_id": fields.get("workflowId") or inbound.get("ai_workflow_id"),
        "confidence": fields.get("confidence"), "evidence_source_ids": fields.get("evidenceSourceIds") or [],
    }, db)
    await record_trust(inbound, "human_review", {**fields, "model": model}, db)
    return {"status": "human_review", "reason": safe_reason}


async def ignore(inbound, reason, db=None, fields=None):
    db, fields = db or database, fields or {}
    await patch_message(inbound["id"], inbound["owner_id"], {"ai_handoff_status": None, "ai_handoff_reason": None}, db)
    await patch_job(inbound["id"], inbound["owner_id"], {"status": "ignored", "reason": slice_text(str(reason or ""), 300), "representative_id": fields.get("representativeId") or inbound.get("ai_representative_id"), "workflow_id": fields.get("workflowId") or inbound.get("ai_workflow_id")}, db)
    await record_trust(inbound, "ignored", fields, db)
    return {"status": "ignored"}


def reply_subject(inbound):
    subject = str(inbound.get("subject") or "")
    return slice_text(subject, 200) if re.match(r"re\s*:", subject, re.I) else "Re: " + slice_text(subject, 196)


async def create_workflow_draft(inbound, mailbox, representative_id, workflow, db, generate_draft):
    recipient = message_address(inbound.get("from_address"))
    fields = {"representativeId": representative_id, "workflowId": workflow["id"]}
    if not recipient:
        return await handoff(inbound, "OpenMail could not identify a valid sender address for the draft.", "", db, fields)
    result = await generate_draft(inbound["owner_id"], mailbox["id"], inbound["id"])
    created = await db("messages", {"method": "POST", "body": {
        "owner_id": inbound["owner_id"], "mailbox_id": mailbox["id"], "direction": "outbound", "from_address": mailbox["address"],
        "to_addresses": [recipient], "subject": reply_subject(inbound), "preview": slice_text(str(result.get("draft") or ""), 180),
        "text_body": slice_text(str(result.get("draft") or ""), 6000), "folder": "drafts", "status": "draft", "client_request_id": str(uuid.uuid4()),
        "ai_auto_sent": False, "ai_reply_to_message_id": inbound["id"], "ai_representative_id": representative_id, "ai_workflow_id": workflow["id"],
    }, "prefer": "return=representation"})
    draft = as_row(created)
    if not draft:
        raise RuntimeError("OpenMail could not save the generated workflow draft.")
    await patch_message(inbound["id"], inbound["owner_id"], {"ai_representative_id": representative_id, "ai_workflow_id": workflow["id"]}, db)
    await patch_job(inbound["id"], inbound["owner_id"], {"status": "draft_created", "reason": "Workflow created a draft for human review.", "model": result.get("model") or "", "representative_id": representative_id, "workflow_id": workflow["id"], "reply_message_id": draft["id"]}, db)
    await record_trust(inbound, "workflow_draft", {**fields, "model": result.get("model")}, db)
    return {"status": "draft_created", "draftId": draft["id"]}


async def process_automatic_reply(message_id, overrides=None):
    from .ai_platform import workflow_matches
    overrides = overrides or {}
    db = overrides.get("database") or database
    get_readiness = overrides.get("readiness") or readiness
    use_quota = overrides.get("consumeQuota") or overrides.get("consume_quota") or consume_quota
    send_mail = overrides.get("resend") or resend
    decide = overrides.get("generateAutomaticDecision") or overrides.get("generate_automatic_decision") or generate_automatic_decision
    generate_draft = overrides.get("generateReplyDraft") or overrides.get("generate_reply_draft") or generate_reply_draft
    if not UUID.fullmatch(str(message_id or "")):
        return {"status": "ignored"}
    rows = await db(f"messages?select=id,owner_id,mailbox_id,direction,from_address,to_addresses,subject,text_body,folder,status,attachment_metadata,ai_auto_submitted,created_at,ai_representative_id,ai_workflow_id&id=eq.{enc(message_id)}&limit=1")
    inbound = as_row(rows)
    if not inbound or inbound.get("direction") != "inbound" or inbound.get("folder") != "inbox":
        return {"status": "ignored"}
    attempted, decision, matched = False, None, None
    representative_id = inbound.get("ai_representative_id")
    try:
        rows = await db(f"ai_mailbox_settings?select=auto_reply_enabled,representative_id&owner_id=eq.{enc(inbound['owner_id'])}&mailbox_id=eq.{enc(inbound['mailbox_id'])}&limit=1")
        settings = as_row(rows) or {"auto_reply_enabled": False, "representative_id": None}
        enabled = settings.get("auto_reply_enabled") is True
        workflows = await db(f"ai_workflows?select=id,name,trigger_mode,match_terms,action,representative_id,priority,enabled&owner_id=eq.{enc(inbound['owner_id'])}&mailbox_id=eq.{enc(inbound['mailbox_id'])}&enabled=eq.true&order=priority.asc,created_at.asc&limit=20")
        active = workflows if isinstance(workflows, list) else []
        matched = next((workflow for workflow in active if workflow_matches(workflow, inbound)), None)
        if active and not matched:
            return {"status": "no_matching_workflow"}
        if not matched and not enabled:
            return {"status": "disabled"}
        representative_id = (matched or {}).get("representative_id") or representative_id or settings.get("representative_id")
        if matched and matched.get("action") != "human_review" and not representative_id:
            return {"status": "failed", "reason": "Workflow has no enabled AI representative."}
        fields = {"representativeId": representative_id, "workflowId": (matched or {}).get("id")}
        try:
            job = await db("ai_auto_reply_jobs?on_conflict=inbound_message_id", {"method": "POST", "body": {
                "owner_id": inbound["owner_id"], "mailbox_id": inbound["mailbox_id"], "inbound_message_id": inbound["id"],
                "recipient_email": message_address(inbound.get("from_address")) or "unknown", "representative_id": representative_id,
                "workflow_id": (matched or {}).get("id"), "status": "processing", "reason": "", "model": "",
            }, "prefer": "resolution=ignore-duplicates,return=representation"})
        except Exception as error:
            if getattr(error, "status", None) == 409:
                return {"status": "already_processed"}
            raise
        if not as_row(job):
            return {"status": "already_processed"}
        rows = await db(f"mailboxes?select=id,address,domain_id,status,owner_id&id=eq.{enc(inbound['mailbox_id'])}&owner_id=eq.{enc(inbound['owner_id'])}&limit=1")
        mailbox = as_row(rows)
        if not mailbox or mailbox.get("status") != "active":
            return await handoff(inbound, "This mailbox is not active, so its AI workflow was stopped.", "", db, fields)
        if representative_id:
            await patch_message(inbound["id"], inbound["owner_id"], {"ai_representative_id": representative_id, "ai_workflow_id": (matched or {}).get("id")}, db)
        if matched: inbound["ai_workflow_id"] = matched["id"]
        if representative_id: inbound["ai_representative_id"] = representative_id
        if matched and matched.get("action") == "human_review":
            return await handoff(inbound, f"Workflow “{str(matched.get('name') or '')[:80]}” requires a person to review this message.", "", db, {"representativeId": None, "workflowId": matched["id"]})
        if matched and matched.get("action") == "create_draft":
            risk = high_risk_reason(inbound)
            if risk: return await handoff(inbound, risk, "", db, fields)
            return await create_workflow_draft(inbound, mailbox, representative_id, matched, db, generate_draft)
        if matched and matched.get("action") == "route_to_rep":
            await patch_job(inbound["id"], inbound["owner_id"], {"status": "workflow_applied", "reason": "Workflow routed this message to its selected representative.", "representative_id": representative_id, "workflow_id": matched["id"]}, db)
            await record_trust(inbound, "workflow_routed", fields, db)
            return {"status": "workflow_routed", "representativeId": representative_id}
        if matched and matched.get("action") == "verified_reply" and not enabled:
            return await handoff(inbound, "This workflow can send only after automatic replies are separately enabled for the mailbox.", "", db, fields)
        if not get_readiness()["mailReady"]:
            return await handoff(inbound, "The mail service is not ready; a person needs to reply.", "", db, fields)
        rows = await db(f"domains?select=id,status&id=eq.{enc(mailbox['domain_id'])}&owner_id=eq.{enc(inbound['owner_id'])}&limit=1")
        if not rows or rows[0].get("status") != "verified":
            return await handoff(inbound, "The sending domain is not verified; a person needs to reply.", "", db, fields)
        recipient = message_address(inbound.get("from_address"))
        if not recipient or recipient == mailbox["address"].lower():
            return await ignore(inbound, "The sender address is not eligible for an automatic reply.", db, fields)
        if re.fullmatch(r"(no-?reply|mailer-daemon|postmaster|notifications?|updates?)(?:[+._-].*)?", recipient.split("@")[0], re.I):
            return await ignore(inbound, "No automatic reply was sent to a system or no-reply address.", db, fields)
        if inbound.get("ai_auto_submitted"):
            return await ignore(inbound, "Automated and mailing-list messages are not answered automatically.", db, fields)
        risk = high_risk_reason(inbound)
        if risk: return await handoff(inbound, risk, "", db, fields)
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        recent = await db(f"ai_auto_reply_jobs?select=id&mailbox_id=eq.{enc(mailbox['id'])}&recipient_email=eq.{enc(recipient)}&status=eq.auto_sent&created_at=gte.{enc(since)}&limit=1")
        if recent:
            return await handoff(inbound, "OpenMail has already automatically replied to this address in the last 24 hours.", "", db, fields)
        decision = await decide(inbound["owner_id"], inbound["mailbox_id"], inbound["id"])
        representative_id = decision.get("representativeId") or representative_id
        fields = {"representativeId": representative_id, "workflowId": (matched or {}).get("id"), "confidence": decision.get("confidence"), "model": decision.get("model"), "evidenceSourceIds": [item.get("source_id") for item in decision.get("citations") or []]}
        if decision.get("decision") != "auto_reply":
            return await handoff(inbound, decision.get("reason"), decision.get("model"), db, fields)
        rows = await db(f"messages?select=id,status,provider_email_id,subject&owner_id=eq.{enc(inbound['owner_id'])}&mailbox_id=eq.{enc(inbound['mailbox_id'])}&ai_reply_to_message_id=eq.{enc(inbound['id'])}&ai_auto_sent=eq.true&limit=1")
        outbound = as_row(rows)
        if outbound and outbound.get("status") == "sent":
            await patch_message(inbound["id"], inbound["owner_id"], {"ai_handoff_status": None, "ai_handoff_reason": None}, db)
            await patch_job(inbound["id"], inbound["owner_id"], {"status": "auto_sent", "reason": "", "model": decision.get("model"), "reply_message_id": outbound["id"], **fields}, db)
            await record_trust(inbound, "auto_sent", fields, db)
            return {"status": "auto_sent", "duplicate": True}
        if outbound and outbound.get("status") == "failed":
            return await handoff(inbound, "OpenMail could not verify the previous provider send. Check Sent before replying manually.", decision.get("model"), db, fields)
        if not await use_quota(inbound["owner_id"], "email_send"):
            return await handoff(inbound, "The mailbox reached its daily sending limit; a person needs to reply.", decision.get("model"), db, fields)
        if not outbound:
            rows = await db("messages", {"method": "POST", "body": {
                "owner_id": inbound["owner_id"], "mailbox_id": mailbox["id"], "direction": "outbound", "from_address": mailbox["address"],
                "to_addresses": [recipient], "subject": reply_subject(inbound), "preview": slice_text(decision["reply"], 180), "text_body": decision["reply"],
                "folder": "sent", "status": "sending", "client_request_id": inbound["id"], "ai_auto_sent": True,
                "ai_reply_to_message_id": inbound["id"], "ai_representative_id": representative_id, "ai_workflow_id": (matched or {}).get("id"),
            }, "prefer": "return=representation"})
            outbound = as_row(rows)
        if not outbound:
            raise RuntimeError("Could not persist the automatic reply before sending.")
        try:
            attempted = True
            sent = await send_mail("/emails", {"method": "POST", "headers": {"Idempotency-Key": f"openmail-ai-{inbound['id']}"}, "body": {
                "from": mailbox["address"], "to": [recipient], "subject": outbound["subject"], "text": decision["reply"],
                "headers": {"Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", "X-OpenMail-AI": "true"},
            }})
        except Exception:
            try:
                await db(f"messages?id=eq.{enc(outbound['id'])}&owner_id=eq.{enc(inbound['owner_id'])}", {"method": "PATCH", "body": {"status": "failed", "folder": "drafts", "ai_auto_sent": False}})
            except Exception: pass
            raise
        rows = await db(f"messages?id=eq.{enc(outbound['id'])}&owner_id=eq.{enc(inbound['owner_id'])}", {"method": "PATCH", "body": {"status": "sent", "folder": "sent", "provider_email_id": sent.get("id")}, "prefer": "return=representation"})
        saved = as_row(rows) or outbound
        await patch_message(inbound["id"], inbound["owner_id"], {"ai_handoff_status": None, "ai_handoff_reason": None}, db)
        await patch_job(inbound["id"], inbound["owner_id"], {"status": "auto_sent", "reason": "", "reply_message_id": saved["id"], **fields}, db)
        await record_trust(inbound, "auto_sent", fields, db)
        return {"status": "auto_sent", "messageId": saved["id"]}
    except Exception as error:
        reason = ("The AI or sending limit was reached; a person needs to reply." if getattr(error, "status", None) == 429 else
            "OpenMail could not verify whether the provider accepted this reply. Check Sent before replying manually." if attempted else
            "OpenMail could not prepare a verified AI reply. No reply was sent; a person needs to review this message.")
        fields = {"representativeId": representative_id, "workflowId": (matched or {}).get("id"), "confidence": (decision or {}).get("confidence"), "evidenceSourceIds": [item.get("source_id") for item in (decision or {}).get("citations") or []]}
        try:
            return await handoff(inbound, reason, (decision or {}).get("model") or "", db, fields)
        except Exception as save_error:
            log_safe_error("Could not record OpenMail AI handoff", save_error)
            try: await patch_job(inbound["id"], inbound["owner_id"], {"status": "failed", "reason": reason}, db)
            except Exception: pass
            await record_trust(inbound, "automation_failed", fields, db)
            return {"status": "failed"}
