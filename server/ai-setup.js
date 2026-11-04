const { json, method, readJson, requireSameOrigin, fail } = require("./http");
const { signedIn, requireConfirmedEmail } = require("./account");
const { config, database } = require("./services");

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
        provider: { name: "Groq", configured: Boolean(settings.groqKey), model: settings.groqModel }
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
    return json(res, 200, { profile: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) { fail(res, error); }
}

async function knowledge(req, res) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
  if (req.method !== "GET" && !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const rows = await database(`ai_knowledge_entries?select=id,title,entry_type,content,created_at,updated_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
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
    if (!title || title.length > 120) return json(res, 400, { error: "Enter a title up to 120 characters." });
    if (!content || content.length > 8000) return json(res, 400, { error: "Enter approved information up to 8,000 characters." });
    if (!ENTRY_TYPES.has(entryType)) return json(res, 400, { error: "Choose a supported knowledge type." });

    const rows = await database("ai_knowledge_entries", {
      method: "POST",
      body: { owner_id: user.id, title, entry_type: entryType, content },
      prefer: "return=representation"
    });
    return json(res, 201, { entry: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) { fail(res, error); }
}

module.exports = { profile, knowledge };
