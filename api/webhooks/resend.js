const crypto = require("node:crypto");
const { json, method } = require("../../server/http");
const { config, database, resend } = require("../../server/services");

function verifySignature(raw, headers, secret) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatures = headers["svix-signature"];
  if (!id || !timestamp || !signatures || !secret.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signatures.split(" ").some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Math.min(0x10ffff, Number(number))))
    .replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Webhook payload is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"])) return;
  try {
    const secret = config().resendWebhookSecret;
    if (!secret) return json(res, 503, { error: "Webhook signing is not configured." });
    const raw = await rawBody(req);
    if (!verifySignature(raw, req.headers, secret)) return json(res, 401, { error: "Invalid webhook signature." });
    const event = JSON.parse(raw);
    if (!event || event.type !== "email.received" || !event.data || !event.data.email_id) return json(res, 200, { ok: true, ignored: true });
    const detail = await resend(`/emails/receiving/${encodeURIComponent(event.data.email_id)}`);
    const candidates = [...(detail.to || event.data.to || []), ...(detail.received_for || [])]
      .map((address) => String(address).trim().toLowerCase()).filter((address) => /^[^\s@]+@[^\s@]+$/.test(address));
    const addresses = [...new Set(candidates)];
    for (const address of addresses) {
      const mailboxes = await database(`mailboxes?select=id,owner_id,address,status&address=eq.${encodeURIComponent(address)}&status=eq.active&limit=1`);
      const mailbox = mailboxes && mailboxes[0];
      if (!mailbox) continue;
      const text = String(detail.text || htmlToText(detail.html || "")).slice(0, 100000);
      const subject = String(detail.subject || "(no subject)").slice(0, 200);
      await database("messages", {
        method: "POST",
        body: {
          owner_id: mailbox.owner_id, mailbox_id: mailbox.id, direction: "inbound", from_address: String(detail.from || "").slice(0, 320),
          to_addresses: [address], subject, preview: text.slice(0, 180), text_body: text, folder: "inbox", status: "received",
          provider_email_id: detail.id || event.data.email_id,
          attachment_metadata: (detail.attachments || []).map((item) => ({ id: item.id, filename: item.filename, content_type: item.content_type, size: item.size }))
        },
        prefer: "return=minimal"
      }).catch((error) => {
        if (error.status !== 409) throw error;
      });
    }
    json(res, 200, { ok: true });
  } catch (error) {
    console.error("OpenMail inbound webhook error:", error && error.message ? error.message : error);
    json(res, 500, { error: "OpenMail could not store this incoming message." });
  }
};

module.exports.config = { api: { bodyParser: false } };
