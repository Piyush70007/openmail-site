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
    else return json(res, 400, { error: "That message action is not supported." });
    const params = new URLSearchParams({ id: `eq.${req.query.id}`, owner_id: `eq.${user.id}`, select: "id,read_at,starred,folder" });
    const updated = await database(`messages?${params}`, { method: "PATCH", body: updates, prefer: "return=representation" });
    if (!updated || !updated.length) return json(res, 404, { error: "Message not found." });
    json(res, 200, { message: updated[0] });
  } catch (error) { fail(res, error); }
};
