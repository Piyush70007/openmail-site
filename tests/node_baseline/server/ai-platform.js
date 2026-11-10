const crypto = require("node:crypto");
const { json, method, readJson, requireSameOrigin, fail } = require("./http");
const { signedIn, requireConfirmedEmail, ownedRow } = require("./account");
const { config, database, consumeAIDraftQuota } = require("./services");
const { generateAutomaticDecision, AUTO_REPLY_MIN_CONFIDENCE, isTestOnlyPricingMaterial } = require("./ai");

const UUID = /^[0-9a-f-]{36}$/i;
const WORKFLOW_ACTIONS = new Set(["route_to_rep", "create_draft", "verified_reply", "human_review"]);
const FEEDBACK = new Set(["correct", "correction", "resolved", "escalated"]);
const MAX_TEST_NAME = 100;

function clean(value, max) { return String(value || "").trim().slice(0, max); }
function normalized(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(); }
function row(result) { return Array.isArray(result) ? result[0] || null : result || null; }

async function ensureRepresentatives(ownerId, db = database) {
  const result = await db("rpc/ensure_openmail_ai_representatives", { method: "POST", body: { p_owner: ownerId } });
  return Array.isArray(result) ? result : [];
}

async function getOwnedRepresentative(ownerId, representativeId, { db = database, requireEnabled = false } = {}) {
  if (!UUID.test(String(representativeId || ""))) return null;
  const rows = await db(`ai_representatives?select=id,owner_id,kind,display_name,enabled&id=eq.${encodeURIComponent(representativeId)}&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`);
  const representative = row(rows);
  return representative && representative.owner_id === ownerId && (!requireEnabled || representative.enabled) ? representative : null;
}

function scopedSourcesQuery(ownerId, representativeId) {
  return new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    or: `(representative_id.is.null,representative_id.eq.${representativeId})`,
    order: "created_at.desc",
    limit: "100"
  });
}

async function approvedContext(ownerId, representativeId, db = database) {
  const settings = config();
  if (!settings.groqKey) throw Object.assign(new Error("Groq is not connected yet."), { status: 503 });
  const representativeRows = await ensureRepresentatives(ownerId, db);
  let representative = representativeRows.find((item) => item.id === representativeId) || null;
  if (!representative && !representativeId) representative = representativeRows.find((item) => item.kind === "support") || null;
  if (!representative || representative.owner_id !== ownerId) throw Object.assign(new Error("Choose one of your AI representatives."), { status: 404 });
  if (!representative.enabled) throw Object.assign(new Error("Enable this AI representative before running a test."), { status: 409 });
  const profiles = await db(`ai_profiles?select=company_name,company_description,products_services,pricing,business_hours,policies,enabled&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`);
  const profile = row(profiles);
  if (!profile || !profile.enabled || !String(profile.company_name || "").trim()) {
    throw Object.assign(new Error("Save and enable your company profile before running a test."), { status: 409 });
  }
  const scoped = scopedSourcesQuery(ownerId, representative.id);
  const [notes, documents] = await Promise.all([
    db(`ai_knowledge_entries?select=id,title,entry_type,content&${scoped}`),
    db(`ai_knowledge_documents?select=id,file_name,mime_type,extracted_text&${scoped}`)
  ]);
  const sources = [];
  for (const key of ["company_name", "company_description", "products_services", "pricing", "business_hours"]) {
    const text = clean(profile[key], key === "company_name" ? 120 : 1800);
    if (text) sources.push({ id: `profile:${key}`, kind: "company_profile", title: key.replaceAll("_", " "), text });
  }
  for (const item of notes || []) {
    const text = clean(item.content, 2500);
    if (isTestOnlyPricingMaterial(item.title, text)) continue;
    if (text) sources.push({ id: `note:${item.id}`, kind: clean(item.entry_type, 24), title: clean(item.title, 120), text });
  }
  for (const item of documents || []) {
    const text = clean(item.extracted_text, 5000);
    if (isTestOnlyPricingMaterial(item.file_name, text)) continue;
    if (text) sources.push({ id: `document:${item.id}`, kind: "approved_document", title: clean(item.file_name, 160), text });
  }
  let budget = 22000;
  const boundedSources = [];
  for (const source of sources) {
    if (budget <= 0) break;
    const text = source.text.slice(0, budget);
    if (text) boundedSources.push({ ...source, text });
    budget -= text.length;
  }
  return { settings, profile, representative, sources: boundedSources, operationalPolicies: clean(profile.policies, 5000) };
}

function evaluateSimulation(expectedDecision, decision) {
  const expected = String(expectedDecision || "");
  const actual = decision && decision.decision;
  const decisionValid = ["auto_reply", "human_review"].includes(actual);
  const evidenceVerified = actual !== "auto_reply" || Boolean(decision.evidenceValidated && decision.citations && decision.citations.length);
  const confidencePassed = actual !== "auto_reply" || Number(decision.confidence) >= AUTO_REPLY_MIN_CONFIDENCE;
  return {
    expected,
    actual: actual || "human_review",
    passed: decisionValid && expected === actual && evidenceVerified && confidencePassed,
    evidenceVerified,
    confidencePassed,
    minimumAutoReplyConfidence: AUTO_REPLY_MIN_CONFIDENCE,
    modelConfidenceNote: "The model-reported confidence is a self-estimate, not a calibrated probability."
  };
}

function feedbackAllowed(jobStatus, outcome) {
  if (jobStatus === "ignored") return false;
  if (["correct", "correction"].includes(outcome)) return ["auto_sent", "draft_created"].includes(jobStatus);
  return ["auto_sent", "draft_created", "human_review", "failed", "workflow_applied"].includes(jobStatus);
}

async function simulator(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  if (req.method === "POST" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (req.method === "GET") {
      const runs = await database(`ai_simulation_runs?select=id,representative_id,test_name,expected_decision,actual_decision,passed,confidence,evidence_validated,model,created_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=20`);
      const representatives = await ensureRepresentatives(user.id);
      return json(res, 200, { runs: runs || [], representatives });
    }
    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const testName = clean(body.testName, MAX_TEST_NAME);
    const subject = clean(body.subject, 200);
    const emailText = typeof body.emailText === "string" ? body.emailText.trim() : "";
    const expectedDecision = String(body.expectedDecision || "");
    const representativeId = String(body.representativeId || "");
    if (!testName || !subject || !emailText || emailText.length > 8000) return json(res, 400, { error: "Add a test name, subject, and message up to 8,000 characters." });
    if (!["auto_reply", "human_review"].includes(expectedDecision)) return json(res, 400, { error: "Choose the expected result: answer from approved facts or send to human review." });
    const context = await approvedContext(user.id, representativeId);
    if (!context.sources.length) return json(res, 409, { error: "Add approved company facts or representative-specific knowledge before testing." });
    if (!await consumeAIDraftQuota(user.id)) return json(res, 429, { error: "The daily OpenMail AI limit has been reached. Try again after it resets." });
    const decision = await generateAutomaticDecision(user.id, "simulator", "simulator", {
      loadReplyContext: async () => ({
        ...context,
        emailBody: emailText,
        message: { subject, text_body: emailText, attachment_metadata: [], ai_auto_submitted: false }
      }),
      consumeAIDraftQuota: async () => true
    });
    const evaluation = evaluateSimulation(expectedDecision, decision);
    const inserted = await database("ai_simulation_runs", {
      method: "POST",
      body: {
        owner_id: user.id,
        representative_id: context.representative.id,
        test_name: testName,
        expected_decision: evaluation.expected,
        actual_decision: evaluation.actual,
        passed: evaluation.passed,
        confidence: decision.confidence,
        evidence_validated: evaluation.evidenceVerified,
        model: clean(decision.model, 120)
      },
      prefer: "return=representation"
    });
    const run = row(inserted);
    const result = {
      run: run && { id: run.id, testName: run.test_name, createdAt: run.created_at, passed: run.passed },
      representative: { id: context.representative.id, name: context.representative.display_name, kind: context.representative.kind },
      evaluation: { ...evaluation, reason: clean(decision.reason, 300), confidence: decision.confidence ?? null, model: clean(decision.model, 120) },
      answer: decision.decision === "auto_reply" ? decision.reply : "",
      citations: (decision.citations || []).map((item) => ({ sourceId: item.source_id, title: clean(item.title, 160), quote: clean(item.quote, 1800) }))
    };
    await database("ai_trust_events", {
      method: "POST",
      body: {
        owner_id: user.id,
        representative_id: context.representative.id,
        event_type: "simulation",
        confidence: decision.confidence ?? null,
        evidence_source_ids: (decision.citations || []).map((item) => item.source_id),
        model: clean(decision.model, 120),
        idempotency_key: `simulation:${run && run.id || crypto.randomUUID()}`
      },
      prefer: "resolution=ignore-duplicates,return=minimal"
    });
    return json(res, 200, result);
  } catch (error) { fail(res, error); }
}

async function representatives(req, res) {
  if (!method(req, res, ["GET", "PATCH"])) return;
  if (req.method === "PATCH" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    const list = await ensureRepresentatives(user.id);
    if (req.method === "GET") {
      let mailboxSetting = null;
      if (req.query.mailboxId) {
        const mailbox = await ownedRow("mailboxes", req.query.mailboxId, user.id, "id,address,status");
        if (!mailbox) return json(res, 404, { error: "Mailbox not found." });
        const rows = await database(`ai_mailbox_settings?select=mailbox_id,representative_id,auto_reply_enabled&owner_id=eq.${encodeURIComponent(user.id)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&limit=1`);
        mailboxSetting = rows && rows[0] || null;
      }
      return json(res, 200, { representatives: list, mailboxSetting });
    }
    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const id = String(body.id || "");
    const displayName = clean(body.displayName, 80);
    if (!UUID.test(id) || !displayName) return json(res, 400, { error: "Choose an AI representative and enter a display name up to 80 characters." });
    const representative = list.find((item) => item.id === id);
    if (!representative) return json(res, 404, { error: "AI representative not found." });
    const enabled = body.enabled === true;
    if (!enabled) {
      const owner = encodeURIComponent(user.id);
      const rep = encodeURIComponent(id);
      const [automaticMailboxes, activeWorkflows] = await Promise.all([
        database("ai_mailbox_settings?select=mailbox_id&owner_id=eq." + owner + "&representative_id=eq." + rep + "&auto_reply_enabled=eq.true&limit=50"),
        database("ai_workflows?select=id&owner_id=eq." + owner + "&representative_id=eq." + rep + "&enabled=eq.true&limit=50")
      ]);
      if (automaticMailboxes && automaticMailboxes.length) return json(res, 409, { error: "Turn off automatic replies or assign another representative to every listed mailbox before disabling this one." });
      if (activeWorkflows && activeWorkflows.length) return json(res, 409, { error: "Turn off or reassign active workflows that use this representative before disabling it." });
    }
    const saved = await database(`ai_representatives?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id,kind,display_name,enabled`, {
      method: "PATCH",
      body: { display_name: displayName, enabled, updated_at: new Date().toISOString() },
      prefer: "return=representation"
    });
    return json(res, 200, { representative: row(saved) });
  } catch (error) { fail(res, error); }
}

function workflowMatches(workflow, message) {
  if (!workflow || !workflow.enabled) return false;
  if (workflow.trigger_mode === "all_inbound") return true;
  const text = normalized(`${message && message.subject || ""}\n${message && message.text_body || ""}`);
  const terms = Array.isArray(workflow.match_terms) ? workflow.match_terms : [];
  return terms.some((term) => {
    const needle = normalized(term);
    return needle && text.includes(needle);
  });
}

async function workflows(req, res) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  if (req.method !== "GET" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    const mailboxId = String(req.method === "DELETE" ? req.query.mailboxId || "" : req.method === "GET" ? req.query.mailboxId || "" : "");
    const body = req.method === "POST" ? await readJson(req) : {};
    const requestedMailboxId = req.method === "POST" ? String(body.mailboxId || "") : mailboxId;
    if (!UUID.test(requestedMailboxId)) return json(res, 400, { error: "Choose one of your mailboxes." });
    const mailbox = await ownedRow("mailboxes", requestedMailboxId, user.id, "id,address,status");
    if (!mailbox || mailbox.status !== "active") return json(res, 404, { error: "Active mailbox not found." });
    if (req.method === "GET") {
      const rows = await database(`ai_workflows?select=id,name,enabled,trigger_mode,match_terms,action,representative_id,priority,created_at,updated_at&owner_id=eq.${encodeURIComponent(user.id)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&order=priority.asc,created_at.asc&limit=20`);
      return json(res, 200, { workflows: rows || [], mailbox: { id: mailbox.id, address: mailbox.address } });
    }
    if (!requireConfirmedEmail(user, res)) return;
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!UUID.test(id)) return json(res, 400, { error: "Choose a workflow to turn off." });
      const updated = await database(`ai_workflows?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&select=id`, {
        method: "PATCH", body: { enabled: false, updated_at: new Date().toISOString() }, prefer: "return=representation"
      });
      if (!updated || !updated.length) return json(res, 404, { error: "Workflow not found." });
      return json(res, 200, { ok: true });
    }
    const id = String(body.id || "");
    const name = clean(body.name, 100);
    const triggerMode = String(body.triggerMode || "");
    const action = String(body.action || "");
    const priority = Number.isInteger(body.priority) && body.priority >= 0 && body.priority <= 100 ? body.priority : 50;
    const terms = Array.isArray(body.matchTerms) ? [...new Set(body.matchTerms.map((term) => clean(term, 60)).filter(Boolean))] : [];
    const representativeId = action === "human_review" ? null : String(body.representativeId || "");
    if (!name || !["all_inbound", "contains_any"].includes(triggerMode) || !WORKFLOW_ACTIONS.has(action)) {
      return json(res, 400, { error: "Add a workflow name and choose a supported trigger and action." });
    }
    if ((triggerMode === "contains_any" && (terms.length < 1 || terms.length > 12)) || (triggerMode === "all_inbound" && terms.length)) {
      return json(res, 400, { error: "Keyword rules need 1–12 phrases; all-inbound rules cannot include keywords." });
    }
    if (terms.some((term) => term.length < 2)) return json(res, 400, { error: "Each keyword phrase must contain at least two characters." });
    let representative = null;
    if (representativeId) {
      representative = await getOwnedRepresentative(user.id, representativeId, { requireEnabled: true });
      if (!representative) return json(res, 400, { error: "Choose one of your enabled AI representatives." });
    }
    if (action !== "human_review" && !representative) return json(res, 400, { error: "Choose the representative this workflow should use." });
    if (id) {
      if (!UUID.test(id)) return json(res, 400, { error: "Workflow identifier is invalid." });
    } else {
      const existing = await database(`ai_workflows?select=id&owner_id=eq.${encodeURIComponent(user.id)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&limit=20`);
      if (existing && existing.length >= 20) return json(res, 409, { error: "This mailbox can have up to 20 workflows." });
    }
    const value = {
      owner_id: user.id,
      mailbox_id: mailbox.id,
      name,
      enabled: body.enabled === true,
      trigger_mode: triggerMode,
      match_terms: terms,
      action,
      representative_id: representativeId,
      priority,
      updated_at: new Date().toISOString()
    };
    const saved = id
      ? await database(`ai_workflows?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}`, {
        method: "PATCH", body: value, prefer: "return=representation"
      })
      : await database("ai_workflows", { method: "POST", body: value, prefer: "return=representation" });
    if (id && (!saved || !saved.length)) return json(res, 404, { error: "Workflow not found." });
    return json(res, id ? 200 : 201, { workflow: row(saved) });
  } catch (error) { fail(res, error); }
}

async function trust(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  if (req.method === "POST" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (req.method === "GET") {
      const days = Math.max(1, Math.min(365, Number.parseInt(String(req.query.days || "30"), 10) || 30));
      const mailboxId = String(req.query.mailboxId || "");
      if (mailboxId && !await ownedRow("mailboxes", mailboxId, user.id, "id")) return json(res, 404, { error: "Mailbox not found." });
      const fromTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const [summary, jobs] = await Promise.all([
        database("rpc/get_openmail_ai_trust_metrics", { method: "POST", body: { p_owner: user.id, p_days: days, p_mailbox: mailboxId || null } }),
        database(`ai_auto_reply_jobs?select=inbound_message_id,mailbox_id,status,reason,model,reply_message_id,representative_id,workflow_id,confidence,evidence_source_ids,created_at&owner_id=eq.${encodeURIComponent(user.id)}${mailboxId ? `&mailbox_id=eq.${encodeURIComponent(mailboxId)}` : ""}&order=created_at.desc&limit=30`)
      ]);
      const recentJobs = (jobs || []).filter((job) => Date.parse(job.created_at) >= fromTime);
      const ids = recentJobs.map((job) => job.inbound_message_id).filter((id) => UUID.test(String(id)));
      let messageRows = [];
      let feedbackRows = [];
      if (ids.length) {
        const inList = `(${ids.join(",")})`;
        [messageRows, feedbackRows] = await Promise.all([
          database(`messages?select=id,subject,ai_handoff_status,ai_representative_id&id=in.${encodeURIComponent(inList)}&owner_id=eq.${encodeURIComponent(user.id)}&direction=eq.inbound`),
          database(`ai_trust_events?select=message_id,event_type,correction_note,created_at&owner_id=eq.${encodeURIComponent(user.id)}&message_id=in.${encodeURIComponent(inList)}&event_type=in.(feedback_correct,feedback_correction,feedback_resolved,feedback_escalated)&order=created_at.desc&limit=120`)
        ]);
      }
      const messages = new Map((messageRows || []).map((item) => [item.id, item]));
      const feedback = new Map();
      for (const item of feedbackRows || []) if (!feedback.has(item.message_id)) feedback.set(item.message_id, item);
      const recent = recentJobs.filter((job) => messages.has(job.inbound_message_id)).map((job) => ({
        messageId: job.inbound_message_id,
        subject: clean(messages.get(job.inbound_message_id).subject, 200),
        status: job.status,
        reason: clean(job.reason, 300),
        model: clean(job.model, 120),
        representativeId: job.representative_id || messages.get(job.inbound_message_id).ai_representative_id || null,
        workflowId: job.workflow_id || null,
        confidence: job.confidence,
        createdAt: job.created_at,
        feedback: feedback.get(job.inbound_message_id) || null
      }));
      return json(res, 200, { days, summary, recent });
    }
    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const messageId = String(body.messageId || "");
    const outcome = String(body.outcome || "");
    const correctionNote = clean(body.correctionNote, 2000);
    if (!UUID.test(messageId) || !FEEDBACK.has(outcome)) return json(res, 400, { error: "Choose a valid AI result and feedback label." });
    if (outcome === "correction" && !correctionNote) return json(res, 400, { error: "Add a short note describing the correction." });
    const jobRows = await database(`ai_auto_reply_jobs?select=id,mailbox_id,representative_id,inbound_message_id,status,workflow_id&owner_id=eq.${encodeURIComponent(user.id)}&inbound_message_id=eq.${encodeURIComponent(messageId)}&limit=1`);
    const job = row(jobRows);
    if (!job) return json(res, 404, { error: "AI result not found for this account." });
    if (!feedbackAllowed(job.status, outcome)) {
      return json(res, 409, { error: job.status === "ignored"
        ? "Ignored messages do not have an AI answer or handover to rate."
        : "Only an AI reply or generated draft can be marked correct or corrected." });
    }
    const messageRows = await database(`messages?select=id,ai_representative_id&owner_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(messageId)}&mailbox_id=eq.${encodeURIComponent(job.mailbox_id)}&direction=eq.inbound&limit=1`);
    const inbound = row(messageRows);
    if (!inbound) return json(res, 404, { error: "Inbound message not found." });
    const eventType = `feedback_${outcome}`;
    const priorRows = await database(`ai_trust_events?select=event_type&owner_id=eq.${encodeURIComponent(user.id)}&message_id=eq.${encodeURIComponent(messageId)}&event_type=in.(feedback_correct,feedback_correction,feedback_resolved,feedback_escalated)&limit=1`);
    const prior = row(priorRows);
    if (prior) {
      if (prior.event_type === eventType) return json(res, 200, { ok: true, outcome, unchanged: true });
      return json(res, 409, { error: "Feedback has already been recorded for this message." });
    }
    const idempotencyKey = `feedback:${user.id}:${messageId}:${outcome}`;
    try {
      await database("ai_trust_events", {
        method: "POST",
        body: {
          owner_id: user.id,
          mailbox_id: job.mailbox_id,
          message_id: messageId,
          representative_id: job.representative_id || inbound.ai_representative_id || null,
          workflow_id: job.workflow_id || null,
          event_type: eventType,
          correction_note: outcome === "correction" ? correctionNote : "",
          idempotency_key: idempotencyKey
        },
        prefer: "return=minimal"
      });
    } catch (error) {
      if (error && error.status === 409) return json(res, 409, { error: "Feedback has already been recorded for this message." });
      throw error;
    }
    return json(res, 200, { ok: true, outcome });
  } catch (error) { fail(res, error); }
}

module.exports = { simulator, representatives, workflows, trust, workflowMatches, evaluateSimulation, feedbackAllowed, approvedContext, ensureRepresentatives, getOwnedRepresentative };
