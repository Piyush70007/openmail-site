const crypto = require("node:crypto");
const { database, readiness, consumeQuota, resend } = require("./services");
const { generateAutomaticDecision, generateReplyDraft, highRiskReason, messageAddress } = require("./ai");
const { workflowMatches } = require("./ai-platform");

const UUID = /^[0-9a-f-]{36}$/i;

function asRow(result) { return Array.isArray(result) ? result[0] || null : result || null; }

async function patchMessage(id, ownerId, updates, db = database) {
  await db(`messages?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}`, {
    method: "PATCH", body: updates
  });
}

async function patchJob(id, ownerId, updates, db = database) {
  await db(`ai_auto_reply_jobs?inbound_message_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(ownerId)}`, {
    method: "PATCH", body: { ...updates, updated_at: new Date().toISOString() }
  });
}

async function recordTrust(inbound, eventType, fields = {}, db = database) {
  try {
    await db("ai_trust_events?on_conflict=idempotency_key", {
      method: "POST",
      body: {
        owner_id: inbound.owner_id,
        mailbox_id: inbound.mailbox_id,
        message_id: inbound.id,
        representative_id: fields.representativeId || inbound.ai_representative_id || null,
        workflow_id: fields.workflowId || inbound.ai_workflow_id || null,
        event_type: eventType,
        confidence: Number.isFinite(fields.confidence) ? fields.confidence : null,
        evidence_source_ids: Array.isArray(fields.evidenceSourceIds) ? fields.evidenceSourceIds.slice(0, 4) : [],
        model: String(fields.model || "").slice(0, 120),
        idempotency_key: `${inbound.owner_id}:${inbound.id}:${eventType}`
      },
      prefer: "resolution=ignore-duplicates,return=minimal"
    });
  } catch (error) {
    // Metrics are best-effort and must never interrupt mail handling.
    console.error("Could not record OpenMail AI trust event:", error && error.message || error);
  }
}

async function handoff(inbound, reason, model = "", db = database, fields = {}) {
  const safeReason = String(reason || "A person should review this message.").slice(0, 300);
  await patchMessage(inbound.id, inbound.owner_id, {
    ai_handoff_status: "pending",
    ai_handoff_reason: safeReason
  }, db);
  await patchJob(inbound.id, inbound.owner_id, {
    status: "human_review", reason: safeReason, model,
    representative_id: fields.representativeId || inbound.ai_representative_id || null,
    workflow_id: fields.workflowId || inbound.ai_workflow_id || null,
    confidence: fields.confidence ?? null,
    evidence_source_ids: fields.evidenceSourceIds || []
  }, db);
  await recordTrust(inbound, "human_review", { ...fields, model }, db);
  return { status: "human_review", reason: safeReason };
}

async function ignore(inbound, reason, db = database, fields = {}) {
  await patchMessage(inbound.id, inbound.owner_id, { ai_handoff_status: null, ai_handoff_reason: null }, db);
  await patchJob(inbound.id, inbound.owner_id, {
    status: "ignored", reason: String(reason || "").slice(0, 300),
    representative_id: fields.representativeId || inbound.ai_representative_id || null,
    workflow_id: fields.workflowId || inbound.ai_workflow_id || null
  }, db);
  await recordTrust(inbound, "ignored", fields, db);
  return { status: "ignored" };
}

async function createWorkflowDraft(inbound, mailbox, representativeId, workflow, db, generateDraft) {
  const recipient = messageAddress(inbound.from_address);
  if (!recipient) return await handoff(inbound, "OpenMail could not identify a valid sender address for the draft.", "", db, { representativeId, workflowId: workflow.id });
  const result = await generateDraft(inbound.owner_id, mailbox.id, inbound.id);
  const subject = /^re\s*:/i.test(inbound.subject || "") ? String(inbound.subject).slice(0, 200) : `Re: ${String(inbound.subject || "").slice(0, 196)}`;
  const created = await db("messages", {
    method: "POST",
    body: {
      owner_id: inbound.owner_id,
      mailbox_id: mailbox.id,
      direction: "outbound",
      from_address: mailbox.address,
      to_addresses: [recipient],
      subject,
      preview: String(result.draft || "").slice(0, 180),
      text_body: String(result.draft || "").slice(0, 6000),
      folder: "drafts",
      status: "draft",
      client_request_id: crypto.randomUUID(),
      ai_auto_sent: false,
      ai_reply_to_message_id: inbound.id,
      ai_representative_id: representativeId,
      ai_workflow_id: workflow.id
    },
    prefer: "return=representation"
  });
  const draft = asRow(created);
  if (!draft) throw new Error("OpenMail could not save the generated workflow draft.");
  await patchMessage(inbound.id, inbound.owner_id, { ai_representative_id: representativeId, ai_workflow_id: workflow.id }, db);
  await patchJob(inbound.id, inbound.owner_id, {
    status: "draft_created", reason: "Workflow created a draft for human review.", model: result.model || "",
    representative_id: representativeId, workflow_id: workflow.id, reply_message_id: draft.id
  }, db);
  await recordTrust(inbound, "workflow_draft", { representativeId, workflowId: workflow.id, model: result.model }, db);
  return { status: "draft_created", draftId: draft.id };
}

async function processAutomaticReply(messageId, overrides = {}) {
  const db = overrides.database || database;
  const getReadiness = overrides.readiness || readiness;
  const useQuota = overrides.consumeQuota || consumeQuota;
  const sendMail = overrides.resend || resend;
  const decide = overrides.generateAutomaticDecision || generateAutomaticDecision;
  const generateDraft = overrides.generateReplyDraft || generateReplyDraft;
  if (!UUID.test(String(messageId || ""))) return { status: "ignored" };
  const rows = await db(`messages?select=id,owner_id,mailbox_id,direction,from_address,to_addresses,subject,text_body,folder,status,attachment_metadata,ai_auto_submitted,created_at,ai_representative_id,ai_workflow_id&id=eq.${encodeURIComponent(messageId)}&limit=1`);
  const inbound = asRow(rows);
  if (!inbound || inbound.direction !== "inbound" || inbound.folder !== "inbox") return { status: "ignored" };

  let providerSendAttempted = false;
  let decision = null;
  let representativeId = inbound.ai_representative_id || null;
  let matchedWorkflow = null;
  try {
    const settingsRows = await db(`ai_mailbox_settings?select=auto_reply_enabled,representative_id&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&mailbox_id=eq.${encodeURIComponent(inbound.mailbox_id)}&limit=1`);
    const settings = asRow(settingsRows) || { auto_reply_enabled: false, representative_id: null };
    const autoReplyEnabled = settings.auto_reply_enabled === true;
    const workflows = await db(`ai_workflows?select=id,name,trigger_mode,match_terms,action,representative_id,priority,enabled&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&mailbox_id=eq.${encodeURIComponent(inbound.mailbox_id)}&enabled=eq.true&order=priority.asc,created_at.asc&limit=20`);
    const activeWorkflows = Array.isArray(workflows) ? workflows : [];
    matchedWorkflow = activeWorkflows.find((workflow) => workflowMatches(workflow, inbound)) || null;
    if (activeWorkflows.length && !matchedWorkflow) return { status: "no_matching_workflow" };
    if (!matchedWorkflow && !autoReplyEnabled) return { status: "disabled" };

    representativeId = matchedWorkflow && matchedWorkflow.representative_id
      || representativeId
      || settings.representative_id
      || null;
    if (matchedWorkflow && matchedWorkflow.action !== "human_review" && !representativeId) {
      return { status: "failed", reason: "Workflow has no enabled AI representative." };
    }

    let job;
    try {
      job = await db("ai_auto_reply_jobs?on_conflict=inbound_message_id", {
        method: "POST",
        body: {
          owner_id: inbound.owner_id,
          mailbox_id: inbound.mailbox_id,
          inbound_message_id: inbound.id,
          recipient_email: messageAddress(inbound.from_address) || "unknown",
          representative_id: representativeId,
          workflow_id: matchedWorkflow && matchedWorkflow.id || null,
          status: "processing",
          reason: "",
          model: ""
        },
        prefer: "resolution=ignore-duplicates,return=representation"
      });
    } catch (error) {
      if (error && error.status === 409) return { status: "already_processed" };
      throw error;
    }
    if (!asRow(job)) return { status: "already_processed" };

    const mailboxRows = await db(`mailboxes?select=id,address,domain_id,status,owner_id&id=eq.${encodeURIComponent(inbound.mailbox_id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&limit=1`);
    const mailbox = asRow(mailboxRows);
    if (!mailbox || mailbox.status !== "active") return await handoff(inbound, "This mailbox is not active, so its AI workflow was stopped.", "", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    if (representativeId) await patchMessage(inbound.id, inbound.owner_id, { ai_representative_id: representativeId, ai_workflow_id: matchedWorkflow && matchedWorkflow.id || null }, db);
    if (matchedWorkflow) inbound.ai_workflow_id = matchedWorkflow.id;
    if (representativeId) inbound.ai_representative_id = representativeId;

    if (matchedWorkflow && matchedWorkflow.action === "human_review") {
      return await handoff(inbound, `Workflow “${String(matchedWorkflow.name || "").slice(0, 80)}” requires a person to review this message.`, "", db, { representativeId: null, workflowId: matchedWorkflow.id });
    }
    if (matchedWorkflow && matchedWorkflow.action === "create_draft") {
      const risk = highRiskReason(inbound);
      if (risk) return await handoff(inbound, risk, "", db, { representativeId, workflowId: matchedWorkflow.id });
      return await createWorkflowDraft(inbound, mailbox, representativeId, matchedWorkflow, db, generateDraft);
    }
    if (matchedWorkflow && matchedWorkflow.action === "route_to_rep") {
      await patchJob(inbound.id, inbound.owner_id, {
        status: "workflow_applied", reason: "Workflow routed this message to its selected representative.",
        representative_id: representativeId, workflow_id: matchedWorkflow.id
      }, db);
      await recordTrust(inbound, "workflow_routed", { representativeId, workflowId: matchedWorkflow.id }, db);
      return { status: "workflow_routed", representativeId };
    }
    if (matchedWorkflow && matchedWorkflow.action === "verified_reply" && !autoReplyEnabled) {
      return await handoff(inbound, "This workflow can send only after automatic replies are separately enabled for the mailbox.", "", db, { representativeId, workflowId: matchedWorkflow.id });
    }

    if (!getReadiness().mailReady) return await handoff(inbound, "The mail service is not ready; a person needs to reply.", "", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    const domainRows = await db(`domains?select=id,status&id=eq.${encodeURIComponent(mailbox.domain_id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&limit=1`);
    if (!domainRows || !domainRows[0] || domainRows[0].status !== "verified") {
      return await handoff(inbound, "The sending domain is not verified; a person needs to reply.", "", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    }

    const recipient = messageAddress(inbound.from_address);
    if (!recipient || recipient === mailbox.address.toLowerCase()) return await ignore(inbound, "The sender address is not eligible for an automatic reply.", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    if (/^(no-?reply|mailer-daemon|postmaster|notifications?|updates?)(?:[+._-].*)?$/i.test(recipient.split("@")[0])) {
      return await ignore(inbound, "No automatic reply was sent to a system or no-reply address.", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    }
    if (inbound.ai_auto_submitted) return await ignore(inbound, "Automated and mailing-list messages are not answered automatically.", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });
    const risk = highRiskReason(inbound);
    if (risk) return await handoff(inbound, risk, "", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });

    const recentRows = await db(`ai_auto_reply_jobs?select=id&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&recipient_email=eq.${encodeURIComponent(recipient)}&status=eq.auto_sent&created_at=gte.${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}&limit=1`);
    if (recentRows && recentRows.length) return await handoff(inbound, "OpenMail has already automatically replied to this address in the last 24 hours.", "", db, { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id });

    decision = await decide(inbound.owner_id, inbound.mailbox_id, inbound.id);
    representativeId = decision.representativeId || representativeId;
    const eventFields = {
      representativeId,
      workflowId: matchedWorkflow && matchedWorkflow.id,
      confidence: decision.confidence,
      model: decision.model,
      evidenceSourceIds: (decision.citations || []).map((item) => item.source_id)
    };
    if (decision.decision !== "auto_reply") return await handoff(inbound, decision.reason, decision.model, db, eventFields);

    const existingRows = await db(`messages?select=id,status,provider_email_id,subject&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&mailbox_id=eq.${encodeURIComponent(inbound.mailbox_id)}&ai_reply_to_message_id=eq.${encodeURIComponent(inbound.id)}&ai_auto_sent=eq.true&limit=1`);
    let outbound = asRow(existingRows);
    if (outbound && outbound.status === "sent") {
      await patchMessage(inbound.id, inbound.owner_id, { ai_handoff_status: null, ai_handoff_reason: null }, db);
      await patchJob(inbound.id, inbound.owner_id, { status: "auto_sent", reason: "", model: decision.model, reply_message_id: outbound.id, ...eventFields }, db);
      await recordTrust(inbound, "auto_sent", eventFields, db);
      return { status: "auto_sent", duplicate: true };
    }
    if (outbound && outbound.status === "failed") {
      return await handoff(inbound, "OpenMail could not verify the previous provider send. Check Sent before replying manually.", decision.model, db, eventFields);
    }
    if (!await useQuota(inbound.owner_id, "email_send")) {
      return await handoff(inbound, "The mailbox reached its daily sending limit; a person needs to reply.", decision.model, db, eventFields);
    }
    if (!outbound) {
      const subject = /^re\s*:/i.test(inbound.subject || "") ? String(inbound.subject).slice(0, 200) : `Re: ${String(inbound.subject || "").slice(0, 196)}`;
      const created = await db("messages", {
        method: "POST",
        body: {
          owner_id: inbound.owner_id,
          mailbox_id: mailbox.id,
          direction: "outbound",
          from_address: mailbox.address,
          to_addresses: [recipient],
          subject,
          preview: decision.reply.slice(0, 180),
          text_body: decision.reply,
          folder: "sent",
          status: "sending",
          client_request_id: inbound.id,
          ai_auto_sent: true,
          ai_reply_to_message_id: inbound.id,
          ai_representative_id: representativeId,
          ai_workflow_id: matchedWorkflow && matchedWorkflow.id || null
        },
        prefer: "return=representation"
      });
      outbound = asRow(created);
    }
    if (!outbound) throw new Error("Could not persist the automatic reply before sending.");
    let sent;
    try {
      providerSendAttempted = true;
      sent = await sendMail("/emails", {
        method: "POST",
        headers: { "Idempotency-Key": `openmail-ai-${inbound.id}` },
        body: {
          from: mailbox.address,
          to: [recipient],
          subject: outbound.subject,
          text: decision.reply,
          headers: {
            "Auto-Submitted": "auto-replied",
            "X-Auto-Response-Suppress": "All",
            "X-OpenMail-AI": "true"
          }
        }
      });
    } catch (error) {
      try {
        await db(`messages?id=eq.${encodeURIComponent(outbound.id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}`, {
          method: "PATCH", body: { status: "failed", folder: "drafts", ai_auto_sent: false }
        });
      } catch {}
      throw error;
    }
    const savedRows = await db(`messages?id=eq.${encodeURIComponent(outbound.id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}`, {
      method: "PATCH", body: { status: "sent", folder: "sent", provider_email_id: sent.id || null }, prefer: "return=representation"
    });
    const saved = asRow(savedRows) || outbound;
    await patchMessage(inbound.id, inbound.owner_id, { ai_handoff_status: null, ai_handoff_reason: null }, db);
    await patchJob(inbound.id, inbound.owner_id, { status: "auto_sent", reason: "", reply_message_id: saved.id, ...eventFields }, db);
    await recordTrust(inbound, "auto_sent", eventFields, db);
    return { status: "auto_sent", messageId: saved.id };
  } catch (error) {
    const reason = error && error.status === 429
      ? "The AI or sending limit was reached; a person needs to reply."
      : providerSendAttempted
        ? "OpenMail could not verify whether the provider accepted this reply. Check Sent before replying manually."
        : "OpenMail could not prepare a verified AI reply. No reply was sent; a person needs to review this message.";
    try { return await handoff(inbound, reason, decision && decision.model || "", db, {
      representativeId,
      workflowId: matchedWorkflow && matchedWorkflow.id,
      confidence: decision && decision.confidence,
      evidenceSourceIds: (decision && decision.citations || []).map((item) => item.source_id)
    }); }
    catch (saveError) {
      console.error("Could not record OpenMail AI handoff:", saveError && saveError.message || saveError);
      try { await patchJob(inbound.id, inbound.owner_id, { status: "failed", reason }, db); } catch {}
      await recordTrust(inbound, "automation_failed", { representativeId, workflowId: matchedWorkflow && matchedWorkflow.id }, db);
      return { status: "failed" };
    }
  }
}

module.exports = { processAutomaticReply, workflowMatches, recordTrust };
