const { json, method, readJson, requireSameOrigin, fail } = require("../server/http");
const { signedIn, ownedRow } = require("../server/account");
const { database } = require("../server/services");

const UUID = /^[0-9a-f-]{36}$/i;

function addressList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return values.map((address) => String(address).trim()).filter(Boolean);
}

module.exports = async (req, res) => {
  if (!method(req, res, ["GET", "POST", "PATCH"])) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const mailbox = await ownedRow("mailboxes", req.query.mailboxId, user.id, "id,address,status");
      if (!mailbox) return json(res, 404, { error: "Mailbox not found." });
      const view = String(req.query.view || "inbox");
      if (!["inbox", "sent", "archive", "spam", "trash", "drafts", "starred"].includes(view)) return json(res, 400, { error: "Unknown mailbox view." });
      const filters = {
        select: "id,direction,from_address,to_addresses,subject,preview,text_body,read_at,starred,folder,status,created_at,client_request_id",
        owner_id: `eq.${user.id}`,
        mailbox_id: `eq.${mailbox.id}`,
        order: "created_at.desc",
        limit: "100"
      };
      if (view === "starred") {
        filters.starred = "eq.true";
        filters.folder = "neq.trash";
      } else {
        filters.folder = `eq.${view}`;
      }
      const messages = await database(`messages?${new URLSearchParams(filters)}`);
      return json(res, 200, { mailbox, messages: messages || [] });
    }

    if (!requireSameOrigin(req, res)) return;
    const body = await readJson(req);

    if (req.method === "POST") {
      if (body.action !== "saveDraft") return json(res, 400, { error: "That message action is not supported." });
      const mailbox = await ownedRow("mailboxes", body.mailboxId, user.id, "id,address,status");
      if (!mailbox || mailbox.status !== "active") return json(res, 404, { error: "Active mailbox not found." });
      const to = addressList(body.to);
      const subject = String(body.subject || "");
      const text = String(body.text || "");
      const requestId = String(body.requestId || "");
      if (to.length > 10 || to.some((address) => address.length > 254)) return json(res, 400, { error: "A draft can contain up to 10 recipients." });
      if (subject.length > 200 || text.length > 100000 || !UUID.test(requestId)) return json(res, 400, { error: "This draft is too long or its compose session expired." });
      const draftRecord = {
        owner_id: user.id,
        mailbox_id: mailbox.id,
        direction: "outbound",
        from_address: mailbox.address,
        to_addresses: to,
        subject,
        preview: text.slice(0, 180),
        text_body: text,
        folder: "drafts",
        status: "draft",
        client_request_id: requestId
      };
      const existingQuery = new URLSearchParams({ select: "id,mailbox_id,folder", owner_id: `eq.${user.id}`, client_request_id: `eq.${requestId}`, limit: "1" });
      const existing = await database(`messages?${existingQuery}`);
      if (existing && existing.length) {
        if (existing[0].mailbox_id !== mailbox.id || existing[0].folder !== "drafts") return json(res, 409, { error: "This compose session is already in use. Start a new draft." });
        const updated = await database(`messages?id=eq.${encodeURIComponent(existing[0].id)}&owner_id=eq.${encodeURIComponent(user.id)}&folder=eq.drafts`, {
          method: "PATCH", body: draftRecord, prefer: "return=representation"
        });
        return json(res, 200, { ok: true, message: Array.isArray(updated) ? updated[0] : updated });
      }
      const inserted = await database("messages", { method: "POST", body: draftRecord, prefer: "return=representation" });
      const message = Array.isArray(inserted) ? inserted[0] : inserted;
      return json(res, 201, { ok: true, message });
    }

    if (req.method === "PATCH") {
      const mailbox = await ownedRow("mailboxes", body.mailboxId, user.id, "id,address,status");
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const action = String(body.action || "");
      if (!mailbox || !ids.length || ids.length > 100 || ids.some((id) => !UUID.test(id))) return json(res, 400, { error: "Select up to 100 messages in this mailbox." });
      if (!["inbox", "archive", "spam", "trash"].includes(action)) return json(res, 400, { error: "That bulk action is not supported." });
      const params = new URLSearchParams({
        id: `in.(${ids.join(",")})`,
        owner_id: `eq.${user.id}`,
        mailbox_id: `eq.${mailbox.id}`,
        select: "id,folder"
      });
      const updated = await database(`messages?${params}`, {
        method: "PATCH",
        body: { folder: action },
        prefer: "return=representation"
      });
      return json(res, 200, { ok: true, updated: Array.isArray(updated) ? updated.length : 0 });
    }
  } catch (error) { fail(res, error); }
};
