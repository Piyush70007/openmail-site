const crypto = require("node:crypto");
const { json, method, logSafeError } = require("../../server/http");
const { config, database, resend } = require("../../server/services");
const { waitUntil } = require("@vercel/functions");
const { processAutomaticReply } = require("../../server/ai-automation");

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

function headerValue(headers, wanted) {
  const target = String(wanted || "").toLowerCase();
  if (Array.isArray(headers)) {
    const item = headers.find((entry) => String(entry && (entry.name || entry.key) || "").toLowerCase() === target);
    return String(item && item.value || "");
  }
  if (headers && typeof headers === "object") {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === target);
    return String(key ? headers[key] : "");
  }
  return "";
}

function isAutoSubmitted(headers) {
  const autoSubmitted = headerValue(headers, "auto-submitted").toLowerCase();
  const precedence = headerValue(headers, "precedence").toLowerCase();
  return (autoSubmitted && autoSubmitted !== "no") || /\b(bulk|list|junk)\b/.test(precedence)
    || Boolean(headerValue(headers, "list-id"))
    || Boolean(headerValue(headers, "x-auto-response-suppress"));
}

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error("Webhook payload is too large."), { status: 413 });
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
    const backgroundTasks = [];
    for (const address of addresses) {
      const mailboxes = await database(`mailboxes?select=id,owner_id,address,status&address=eq.${encodeURIComponent(address)}&status=eq.active&limit=1`);
      const mailbox = mailboxes && mailboxes[0];
      if (!mailbox) continue;
      const text = String(detail.text || htmlToText(detail.html || "")).slice(0, 100000);
      const subject = String(detail.subject || "(no subject)").slice(0, 200);
      const providerEmailId = detail.id || event.data.email_id;
      let stored;
      try {
        stored = await database("messages", {
          method: "POST",
          body: {
            owner_id: mailbox.owner_id, mailbox_id: mailbox.id, direction: "inbound", from_address: String(detail.from || "").slice(0, 320),
            to_addresses: [address], subject, preview: text.slice(0, 180), text_body: text, folder: "inbox", status: "received",
            provider_email_id: providerEmailId,
            attachment_metadata: (detail.attachments || []).map((item) => ({ id: item.id, filename: item.filename, content_type: item.content_type, size: item.size })),
            ai_auto_submitted: isAutoSubmitted(detail.headers)
          },
          prefer: "return=representation"
        });
      } catch (error) {
        if (!error || error.status !== 409) throw error;
      }
      let message = Array.isArray(stored) ? stored[0] : stored;
      if (!message || !message.id) {
        const existing = await database(`messages?select=id,folder&provider_email_id=eq.${encodeURIComponent(providerEmailId)}&mailbox_id=eq.${encodeURIComponent(mailbox.id)}&direction=eq.inbound&limit=1`);
        message = existing && existing[0];
      }
      if (message && message.id) backgroundTasks.push(processAutomaticReply(message.id));
    }
    const settledTasks = backgroundTasks.map((task) => task.catch((error) => {
      logSafeError("OpenMail AI automation failed safely", error);
    }));
    if (process.env.VERCEL === "1") settledTasks.forEach((task) => waitUntil(task));
    else await Promise.all(settledTasks);
    json(res, 200, { ok: true });
  } catch (error) {
    logSafeError("OpenMail inbound webhook error", error);
    json(res, error && error.status === 413 ? 413 : 500, { error: error && error.status === 413 ? "Webhook payload is too large." : "OpenMail could not store this incoming message." });
  }
};

module.exports.config = { api: { bodyParser: false } };

module.exports._test = { verifySignature, headerValue, isAutoSubmitted, htmlToText, rawBody };
