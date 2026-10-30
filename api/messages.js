const { json, method, requireSameOrigin, fail } = require("../server/http");
const { signedIn, ownedRow } = require("../server/account");
const { database } = require("../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["GET"])) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    const mailbox = await ownedRow("mailboxes", req.query.mailboxId, user.id, "id,address,status");
    if (!mailbox) return json(res, 404, { error: "Mailbox not found." });
    const view = String(req.query.view || "inbox");
    if (!["inbox", "sent", "archive", "spam", "trash"].includes(view)) return json(res, 400, { error: "Unknown mailbox view." });
    const params = new URLSearchParams({
      select: "id,direction,from_address,to_addresses,subject,preview,text_body,read_at,starred,folder,status,created_at",
      owner_id: `eq.${user.id}`,
      mailbox_id: `eq.${mailbox.id}`,
      folder: `eq.${view}`,
      order: "created_at.desc",
      limit: "100"
    });
    const messages = await database(`messages?${params}`);
    json(res, 200, { mailbox, messages: messages || [] });
  } catch (error) { fail(res, error); }
};
