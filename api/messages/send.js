const { json, method, readJson, requireSameOrigin, fail } = require("../../server/http");
const { signedIn, ownedRow } = require("../../server/account");
const { database, resend, readiness } = require("../../server/services");

function validAddress(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!readiness().mailReady) return json(res, 503, { error: "Email services are not connected yet." });
    const body = await readJson(req);
    const mailbox = await ownedRow("mailboxes", body.mailboxId, user.id, "id,address,domain_id,status");
    if (!mailbox || mailbox.status !== "active") return json(res, 404, { error: "Active mailbox not found." });
    const domain = await ownedRow("domains", mailbox.domain_id, user.id, "id,status");
    if (!domain || domain.status !== "verified") return json(res, 409, { error: "Verify the sending domain before sending mail." });
    const to = (Array.isArray(body.to) ? body.to : String(body.to || "").split(",")).map((address) => String(address).trim().toLowerCase()).filter(Boolean);
    const subject = String(body.subject || "").trim();
    const text = String(body.text || "").trim();
    const requestId = String(body.requestId || "");
    if (!to.length || to.length > 10 || to.some((address) => !validAddress(address))) return json(res, 400, { error: "Enter between 1 and 10 valid recipient email addresses." });
    if (!subject || subject.length > 200 || !text || text.length > 100000) return json(res, 400, { error: "Add a subject and message (up to 100,000 characters)." });
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json(res, 400, { error: "Refresh the compose window and try again." });

    const existingQuery = new URLSearchParams({ select: "id,status,provider_email_id,created_at", owner_id: `eq.${user.id}`, client_request_id: `eq.${requestId}`, limit: "1" });
    let rows = await database(`messages?${existingQuery}`);
    let message = rows && rows[0];
    if (message && message.status === "sent") return json(res, 200, { ok: true, message });
    if (message && message.status === "sending") return json(res, 409, { error: "This message is already being sent." });
    if (!message) {
      const inserted = await database("messages", {
        method: "POST",
        body: {
          owner_id: user.id, mailbox_id: mailbox.id, direction: "outbound", from_address: mailbox.address,
          to_addresses: to, subject, preview: text.slice(0, 180), text_body: text, status: "sending",
          folder: "sent", client_request_id: requestId
        },
        prefer: "return=representation"
      });
      message = Array.isArray(inserted) ? inserted[0] : inserted;
    } else {
      await database(`messages?id=eq.${encodeURIComponent(message.id)}&owner_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: { status: "sending" } });
    }

    try {
      const sent = await resend("/emails", {
        method: "POST",
        headers: { "Idempotency-Key": requestId },
        body: { from: mailbox.address, to, subject, text }
      });
      const updated = await database(`messages?id=eq.${encodeURIComponent(message.id)}&owner_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH", body: { status: "sent", provider_email_id: sent.id || null }, prefer: "return=representation"
      });
      json(res, 200, { ok: true, message: Array.isArray(updated) ? updated[0] : message });
    } catch (error) {
      await database(`messages?id=eq.${encodeURIComponent(message.id)}&owner_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: { status: "failed" } }).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error.status === 409) return json(res, 409, { error: "That send request is already in progress. Refresh Sent in a moment." });
    fail(res, error);
  }
};
