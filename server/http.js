const MAX_BODY_BYTES = 256 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { error: "Method not allowed." });
  return false;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : (process.env.NODE_ENV === "production" ? "https" : "http");
  try { return new URL(origin).host === host && new URL(origin).protocol === `${protocol}:`; }
  catch { return false; }
}

function requireSameOrigin(req, res) {
  if (sameOrigin(req)) return true;
  json(res, 403, { error: "This request did not come from OpenMail." });
  return false;
}

function fail(res, error) {
  const status = Number.isInteger(error && error.status) ? error.status : 500;
  const message = status >= 500 ? "OpenMail could not complete that request." : error.message;
  if (status >= 500) console.error("OpenMail API error:", error && error.message ? error.message : error);
  json(res, status, { error: message });
}

module.exports = { json, method, readJson, requireSameOrigin, fail };
