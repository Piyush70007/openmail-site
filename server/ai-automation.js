const { database, readiness, consumeQuota, resend } = require("./services");
const { generateAutomaticDecision, highRiskReason, messageAddress } = require("./ai");

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

async function handoff(inbound, reason, model = "", db = database) {
  const safeReason = String(reason || "A person should review this message.").slice(0, 300);
  await patchMessage(inbound.id, inbound.owner_id, {
    ai_handoff_status: "pending",
    ai_handoff_reason: safeReason
  }, db);
  await patchJob(inbound.id, inbound.owner_id, { status: "human_review", reason: safeReason, model }, db);
  return { status: "human_review", reason: safeReason };
}

async function ignore(inbound, reason, db = database) {
  await patchMessage(inbound.id, inbound.owner_id, { ai_handoff_status: null, ai_handoff_reason: null }, db);
  await patchJob(inbound.id, inbound.owner_id, { status: "ignored", reason: String(reason || "").slice(0, 300) }, db);
  return { status: "ignored" };
}

async function processAutomaticReply(messageId, overrides = {}) {
  const db = overrides.database || database;
  const getReadiness = overrides.readiness || readiness;
  const useQuota = overrides.consumeQuota || consumeQuota;
  const sendMail = overrides.resend || resend;
  const decide = overrides.generateAutomaticDecision || generateAutomaticDecision;
  if (!UUID.test(String(messageId || ""))) return { status: "ignored" };
  const rows = await db(`messages?select=id,owner_id,mailbox_id,direction,from_address,to_addresses,subject,text_body,folder,status,attachment_metadata,ai_auto_submitted,created_at&id=eq.${encodeURIComponent(messageId)}&limit=1`);
  const inbound = asRow(rows);
  if (!inbound || inbound.direction !== "inbound" || inbound.folder !== "inbox") return { status: "ignored" };

  const settingsRows = await db(`ai_mailbox_settings?select=auto_reply_enabled&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&mailbox_id=eq.${encodeURIComponent(inbound.mailbox_id)}&limit=1`);
  if (!settingsRows || !settingsRows[0] || settingsRows[0].auto_reply_enabled !== true) return { status: "disabled" };

  let job;
  let providerSendAttempted = false;
  try {
    job = await db("ai_auto_reply_jobs?on_conflict=inbound_message_id", {
      method: "POST",
      body: {
        owner_id: inbound.owner_id,
        mailbox_id: inbound.mailbox_id,
        inbound_message_id: inbound.id,
        recipient_email: messageAddress(inbound.from_address) || "unknown",
        status: "processing",
        reason: "",
        model: ""
      },
      prefer: "resolution=ignore-duplicates,return=representation"
    });
  } catch (error) {
    // A unique-key collision means this inbound has already entered the automation path.
    if (error && error.status === 409) return { status: "already_processed" };
    throw error;
  }
  job = asRow(job);
  if (!job) return { status: "already_processed" };

  try {
    const mailboxRows = await db(`mailboxes?select=id,address,domain_id,status,owner_id&id=eq.${encodeURIComponent(inbound.mailbox_id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&limit=1`);
    const mailbox = asRow(mailboxRows);
    if (!mailbox || mailbox.status !== "active") return await handoff(inbound, "This mailbox is not active, so automatic sending was stopped.", "", db);
    const domainRows = await db(`domains?select=id,status&id=eq.${encodeURIComponent(mailbox.domain_id)}&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&limit=1`);
    if (!domainRows || !domainRows[0] || domainRows[0].status !== "verified" || !getReadiness().mailReady) {
      return await handoff(inbound, "The sending domain or mail service is not ready; a person needs to reply.", "", db);
    }

    const recipient = messageAddress(inbound.from_address);
    if (!recipient || recipient === mailbox.address.toLowerCase()) return await ignore(inbound, "The sender address is not eligible for an automatic reply.", db);
    if (/^(no-?reply|mailer-daemon|postmaster|notifications?|updates?)(?:[+._-].*)?$/i.test(recipient.split("@")[0])) {
      return await ignore(inbound, "No automatic reply was sent to a system or no-reply address.", db);
    }
    if (inbound.ai_auto_submitted) return await ignore(inbound, "Automated and mailing-list messages are not answered automatically.", db);
    const risk = highRiskReason(inbound);
    if (risk) return await handoff(inbound, risk, "", db);

    const recentRows = await db(`ai_auto_reply_jobs?select=id&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&recipient_email=eq.${encodeURIComponent(recipient)}&status=eq.auto_sent&created_at=gte.${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}&limit=1`);
    if (recentRows && recentRows.length) return await handoff(inbound, "OpenMail has already automatically replied to this address in the last 24 hours.", "", db);

    const decision = await decide(inbound.owner_id, inbound.mailbox_id, inbound.id);
    if (decision.decision !== "auto_reply") return await handoff(inbound, decision.reason, decision.model, db);

    const existingRows = await db(`messages?select=id,status,provider_email_id,subject&owner_id=eq.${encodeURIComponent(inbound.owner_id)}&mailbox_id=eq.${encodeURIComponent(inbound.mailbox_id)}&ai_reply_to_message_id=eq.${encodeURIComponent(inbound.id)}&ai_auto_sent=eq.true&limit=1`);
    let outbound = asRow(existingRows);
    if (outbound && outbound.status === "sent") {
      await patchMessage(inbound.id, inbound.owner_id, { ai_handoff_status: null, ai_handoff_reason: null }, db);
      await patchJob(inbound.id, inbound.owner_id, { status: "auto_sent", reason: "", model: decision.model, reply_message_id: outbound.id }, db);
      return { status: "auto_sent", duplicate: true };
    }
    if (outbound && outbound.status === "failed") {
      return await handoff(inbound, "OpenMail could not verify the previous provider send. Check Sent before replying manually.", decision.model, db);
    }
    // Reserve the existing account send quota before creating a Sent item or contacting Resend.
    if (!await useQuota(inbound.owner_id, "email_send")) {
      return await handoff(inbound, "The mailbox reached its daily sending limit; a person needs to reply.", decision.model, db);
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
          ai_reply_to_message_id: inbound.id
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
      // Keep a failed attempt out of Sent and AI Sent. A human should check provider status before replying.
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
    await patchJob(inbound.id, inbound.owner_id, { status: "auto_sent", reason: "", model: decision.model, reply_message_id: saved.id }, db);
    return { status: "auto_sent", messageId: saved.id };
  } catch (error) {
    const reason = error && error.status === 429
      ? "The AI or sending limit was reached; a person needs to reply."
      : providerSendAttempted
        ? "OpenMail could not verify whether the provider accepted this reply. Check Sent before replying manually."
        : "OpenMail could not prepare a verified AI reply. No reply was sent; a person needs to review this message.";
    try { return await handoff(inbound, reason, "", db); }
    catch (saveError) {
      console.error("Could not record OpenMail AI handoff:", saveError && saveError.message || saveError);
      try { await patchJob(inbound.id, inbound.owner_id, { status: "failed", reason }, db); } catch {}
      return { status: "failed" };
    }
  }
}

module.exports = { processAutomaticReply };
