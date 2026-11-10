const { json, method, readJson, requireSameOrigin, fail } = require("./http");
const { signedIn, requireConfirmedEmail } = require("./account");
const { config, database, readiness } = require("./services");
const { ensureRepresentatives, getOwnedRepresentative } = require("./ai-platform");

const PROFILE_FIELDS = [
  "company_name",
  "company_description",
  "products_services",
  "pricing",
  "business_hours",
  "policies"
];
const ENTRY_TYPES = new Set(["faq", "service", "pricing", "policy"]);
const UUID = /^[0-9a-f-]{36}$/i;
const DOCUMENT_TYPES = new Map([
  [".txt", "text/plain"], [".md", "text/markdown"], [".csv", "text/csv"],
  [".pdf", "application/pdf"], [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
]);

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function profile(req, res) {
  if (!method(req, res, ["GET", "PATCH"])) return;
  if (req.method === "PATCH" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const rows = await database(`ai_profiles?select=${PROFILE_FIELDS.join(",")},enabled,reply_mode,updated_at&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      const settings = config();
      return json(res, 200, {
        profile: rows && rows[0] || null,
        provider: { name: "Groq", configured: Boolean(settings.groqKey), model: settings.groqModel },
        mailReady: readiness().mailReady
      });
    }

    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const value = {
      owner_id: user.id,
      company_name: cleanText(body.companyName, 120),
      company_description: cleanText(body.companyDescription, 4000),
      products_services: cleanText(body.productsServices, 6000),
      pricing: cleanText(body.pricing, 4000),
      business_hours: cleanText(body.businessHours, 1200),
      policies: cleanText(body.policies, 5000),
      enabled: body.enabled === true,
      reply_mode: "draft",
      updated_at: new Date().toISOString()
    };
    if (!value.company_name) return json(res, 400, { error: "Add your company name before saving." });
    if (value.enabled && !config().groqKey) return json(res, 503, { error: "Groq is not connected yet. Add GROQ_API_KEY as a server-only environment variable first." });

    const rows = await database("ai_profiles?on_conflict=owner_id", {
      method: "POST",
      body: value,
      prefer: "resolution=merge-duplicates,return=representation"
    });
    if (!value.enabled) {
      await database(`ai_mailbox_settings?owner_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH", body: { auto_reply_enabled: false, updated_at: new Date().toISOString() }
      });
    }
    return json(res, 200, { profile: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) { fail(res, error); }
}

async function documents(req, res) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  if (req.method !== "GET" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const rows = await database(`ai_knowledge_documents?select=id,file_name,mime_type,representative_id,created_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=10`);
      return json(res, 200, { documents: rows || [] });
    }

    if (!requireConfirmedEmail(user, res)) return;
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!UUID.test(id)) return json(res, 404, { error: "Knowledge document not found." });
      const rows = await database(`ai_knowledge_documents?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id`, {
        method: "DELETE", prefer: "return=representation"
      });
      if (!rows || !rows.length) return json(res, 404, { error: "Knowledge document not found." });
      return json(res, 200, { ok: true });
    }

    const body = await readJson(req);
    const fileName = String(body.fileName || "").trim().replace(/[\\/\u0000-\u001f]/g, "").slice(0, 160);
    const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const mimeType = DOCUMENT_TYPES.get(extension);
    const extractedText = typeof body.extractedText === "string" ? body.extractedText.trim() : "";
    if (!fileName || !mimeType || body.mimeType !== mimeType) {
      return json(res, 400, { error: "Upload a PDF, DOCX, TXT, MD, or CSV file." });
    }
    if (!extractedText || extractedText.length > 40000) {
      return json(res, 400, { error: "The document must contain readable text up to 40,000 characters." });
    }
    const representativeId = String(body.representativeId || "");
    const representative = representativeId ? await getOwnedRepresentative(user.id, representativeId, { requireEnabled: true }) : null;
    if (representativeId && !representative) return json(res, 400, { error: "Choose one of your enabled AI representatives." });
    const profileRows = await database(`ai_profiles?select=enabled&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (!profileRows || !profileRows[0] || !profileRows[0].enabled) {
      return json(res, 409, { error: "Save and enable your AI representative before adding knowledge documents." });
    }
    const crypto = require("node:crypto");
    const contentHash = crypto.createHash("sha256").update(extractedText, "utf8").digest("hex");
    try {
      const document = await database(representative
        ? "rpc/save_openmail_ai_document_for_rep"
        : "rpc/save_openmail_ai_document", {
        method: "POST",
        body: representative ? {
          p_owner: user.id,
          p_representative: representative.id,
          p_file_name: fileName,
          p_mime_type: mimeType,
          p_content_hash: contentHash,
          p_extracted_text: extractedText
        } : {
          p_owner: user.id,
          p_file_name: fileName,
          p_mime_type: mimeType,
          p_content_hash: contentHash,
          p_extracted_text: extractedText
        }
      });
      return json(res, 201, { document });
    } catch (error) {
      const message = String(error && error.message || "");
      if (message.includes("already been uploaded")) return json(res, 409, { error: message });
      if (message.includes("up to 10") || message.includes("invalid OpenMail AI document")) return json(res, 400, { error: message });
      throw error;
    }
  } catch (error) { fail(res, error); }
}

async function mailboxSettings(req, res) {
  if (!method(req, res, ["GET", "PATCH"])) return;
  if (req.method === "PATCH" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (req.method === "PATCH" && !requireConfirmedEmail(user, res)) return;

    const body = req.method === "PATCH" ? await readJson(req) : {};
    const mailboxId = String(req.method === "PATCH" ? body.mailboxId : req.query.mailboxId || "");
    if (!UUID.test(mailboxId)) return json(res, 400, { error: "Choose one of your active mailboxes." });
    const mailboxRows = await database(`mailboxes?select=id,address,status,domain_id,owner_id&id=eq.${encodeURIComponent(mailboxId)}&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    const mailbox = mailboxRows && mailboxRows[0];
    if (!mailbox || mailbox.status !== "active") return json(res, 404, { error: "Active mailbox not found." });

    const currentRows = await database(`ai_mailbox_settings?select=mailbox_id,auto_reply_enabled,representative_id,updated_at&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (req.method === "GET") {
      const domainRows = await database(`domains?select=status&id=eq.${encodeURIComponent(mailbox.domain_id)}&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      const representatives = await ensureRepresentatives(user.id);
      const defaultRep = representatives.find((item) => item.kind === "support");
      return json(res, 200, {
        mailbox: { id: mailbox.id, address: mailbox.address },
        settings: { mailbox_id: mailbox.id, auto_reply_enabled: false, ...(currentRows && currentRows[0] || {}), representative_id: currentRows && currentRows[0] && currentRows[0].representative_id || defaultRep && defaultRep.id || null },
        representatives,
        domainVerified: Boolean(domainRows && domainRows[0] && domainRows[0].status === "verified"),
        mailReady: readiness().mailReady,
        providerConfigured: Boolean(config().groqKey)
      });
    }

    const enabled = body.enabled === true;
    const representatives = await ensureRepresentatives(user.id);
    const requestedRepresentativeId = String(body.representativeId || currentRows && currentRows[0] && currentRows[0].representative_id || (representatives.find((item) => item.kind === "support") || {}).id || "");
    const representative = await getOwnedRepresentative(user.id, requestedRepresentativeId, { requireEnabled: true });
    if (!representative) return json(res, 400, { error: "Choose one of your enabled AI representatives for this mailbox." });
    if (enabled) {
      if (body.confirmAutomaticSending !== true) return json(res, 400, { error: "Confirm that OpenMail may automatically send supported replies for this mailbox." });
      if (!config().groqKey || !readiness().mailReady) return json(res, 503, { error: "AI and mail services must be connected before automatic replies can be enabled." });
      const profileRows = await database(`ai_profiles?select=company_name,enabled&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      const profile = profileRows && profileRows[0];
      if (!profile || !profile.enabled || !String(profile.company_name || "").trim()) return json(res, 409, { error: "Save and enable your AI representative profile first." });
      const domainRows = await database(`domains?select=status&id=eq.${encodeURIComponent(mailbox.domain_id)}&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      if (!domainRows || !domainRows[0] || domainRows[0].status !== "verified") return json(res, 409, { error: "Verify this mailbox’s sending domain before enabling automatic replies." });
    }

    const settings = {
      mailbox_id: mailbox.id,
      owner_id: user.id,
      representative_id: representative.id,
      auto_reply_enabled: enabled,
      updated_at: new Date().toISOString()
    };
    const saved = await database("ai_mailbox_settings?on_conflict=mailbox_id", {
      method: "POST", body: settings, prefer: "resolution=merge-duplicates,return=representation"
    });
    return json(res, 200, { settings: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) { fail(res, error); }
}

async function knowledge(req, res) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  if (req.method !== "GET" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const rows = await database(`ai_knowledge_entries?select=id,title,entry_type,content,representative_id,created_at,updated_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
      return json(res, 200, { entries: rows || [] });
    }

    if (!requireConfirmedEmail(user, res)) return;
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!UUID.test(id)) return json(res, 404, { error: "Knowledge entry not found." });
      const rows = await database(`ai_knowledge_entries?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id`, {
        method: "DELETE",
        prefer: "return=representation"
      });
      if (!rows || !rows.length) return json(res, 404, { error: "Knowledge entry not found." });
      return json(res, 200, { ok: true });
    }

    const body = await readJson(req);
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    const entryType = String(body.type || "faq");
    const representativeId = String(body.representativeId || "");
    if (!title || title.length > 120) return json(res, 400, { error: "Enter a title up to 120 characters." });
    if (!content || content.length > 8000) return json(res, 400, { error: "Enter approved information up to 8,000 characters." });
    if (!ENTRY_TYPES.has(entryType)) return json(res, 400, { error: "Choose a supported knowledge type." });
    const representative = representativeId ? await getOwnedRepresentative(user.id, representativeId, { requireEnabled: true }) : null;
    if (representativeId && !representative) return json(res, 400, { error: "Choose one of your enabled AI representatives." });

    try {
      const entry = await database(representative ? "rpc/save_openmail_ai_knowledge_for_rep" : "rpc/save_openmail_ai_knowledge", {
        method: "POST",
        body: representative
          ? { p_owner: user.id, p_representative: representative.id, p_title: title, p_entry_type: entryType, p_content: content }
          : { p_owner: user.id, p_title: title, p_entry_type: entryType, p_content: content }
      });
      return json(res, 201, { entry });
    } catch (error) {
      if (String(error && error.message || "").includes("up to 100")) return json(res, 400, { error: error.message });
      throw error;
    }
  } catch (error) { fail(res, error); }
}

module.exports = { profile, knowledge, documents, mailboxSettings };
