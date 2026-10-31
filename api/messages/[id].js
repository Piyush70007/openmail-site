const { json, method, readJson, requireSameOrigin, fail } = require("../../server/http");
const { signedIn } = require("../../server/account");
const { database } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["PATCH"]) || !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.id || ""))) return json(res, 404, { error: "Message not found." });
    const body = await readJson(req);
    const updates = {};
    if (body.action === "read") updates.read_at = new Date().toISOString();
    else if (body.action === "unread") updates.read_at = null;
    else if (["inbox", "archive", "spam", "trash"].includes(body.action)) updates.folder = body.action;
    else if (body.action === "star") updates.starred = Boolean(body.starred);
    else if (body.action === "draft") {
      const to = (Array.isArray(body.to) ? body.to : String(body.to || "").split(",")).map((address) => String(address).trim()).filter(Boolean);
      const subject = String(body.subject || "");
      const text = String(body.text || "");
      if (to.length > 10 || to.some((address) => address.length > 254) || subject.length > 200 || text.length > 100000) {
        return json(res, 400, { error: "This draft is too long. Check the recipients, subject and message." });
      }
      Object.assign(updates, {
        to_addresses: to,
        subject,
        preview: text.slice(0, 180),
        text_body: text,
        folder: "drafts",
        status: "draft"
      });
    }
    else return json(res, 400, { error: "That message action is not supported." });
    const filters = { id: `eq.${req.query.id}`, owner_id: `eq.${user.id}`, select: "id,read_at,starred,folder,status,client_request_id" };
    if (body.action === "draft") filters.folder = "eq.drafts";
    const params = new URLSearchParams(filters);
    const updated = await database(`messages?${params}`, { method: "PATCH", body: updates, prefer: "return=representation" });
    if (!updated || !updated.length) return json(res, 404, { error: "Message not found." });
    json(res, 200, { message: updated[0] });
  } catch (error) { fail(res, error); }
};
