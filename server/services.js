const crypto = require("node:crypto");

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  return {
    supabaseUrl: url,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
    secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    resendKey: process.env.RESEND_API_KEY || "",
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || ""
  };
}

function readiness() {
  const c = config();
  const authMissing = [];
  if (!c.supabaseUrl) authMissing.push("SUPABASE_URL");
  if (!c.publishableKey) authMissing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!c.secretKey) authMissing.push("SUPABASE_SECRET_KEY");
  if (c.sessionSecret.length < 32) authMissing.push("SESSION_SECRET (32+ characters)");
  const mailMissing = [];
  if (!c.resendKey) mailMissing.push("RESEND_API_KEY");
  if (!c.resendWebhookSecret) mailMissing.push("RESEND_WEBHOOK_SECRET");
  return { authReady: authMissing.length === 0, mailReady: authMissing.length === 0 && mailMissing.length === 0, authMissing, mailMissing };
}

async function supabaseAuth(path, options = {}) {
  const c = config();
  if (!c.supabaseUrl || !c.publishableKey) throw Object.assign(new Error("Account services are not configured yet."), { status: 503 });
  const response = await fetch(`${c.supabaseUrl}/auth/v1${path}`, {
    method: options.method || "GET",
    headers: { apikey: c.publishableKey, "Content-Type": "application/json", ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.msg || data.message || data.error_description || data.error || "Account service request failed."), { status: response.status });
  return data;
}

async function database(path, options = {}) {
  const c = config();
  if (!c.supabaseUrl || !c.secretKey) throw Object.assign(new Error("Secure storage is not configured yet."), { status: 503 });
  const headers = {
    apikey: c.secretKey,
    ...(c.secretKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${c.secretKey}` }),
    "Content-Type": "application/json",
    ...(options.prefer ? { Prefer: options.prefer } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data && (data.message || data.error_description || data.hint) || "Secure storage request failed.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function resend(path, options = {}) {
  const c = config();
  if (!c.resendKey) throw Object.assign(new Error("Email transport is not configured yet."), { status: 503 });
  const response = await fetch(`https://api.resend.com${path}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${c.resendKey}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || data.name || "Email provider request failed."), { status: response.status < 500 ? 400 : 502 });
  return data;
}

function cookieOptions(maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function signSession(session) {
  const c = config();
  if (c.sessionSecret.length < 32) throw Object.assign(new Error("Session signing is not configured yet."), { status: 503 });
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", c.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSignedSession(req) {
  const c = config();
  const cookieHeader = req.headers.cookie || "";
  const raw = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("openmail_session="));
  if (!raw || c.sessionSecret.length < 32) return null;
  let value;
  try { value = decodeURIComponent(raw.slice("openmail_session=".length)); } catch { return null; }
  const split = value.lastIndexOf(".");
  if (split < 1) return null;
  const payload = value.slice(0, split);
  const signature = value.slice(split + 1);
  const expected = crypto.createHmac("sha256", c.sessionSecret).update(payload).digest();
  let provided;
  try { provided = Buffer.from(signature, "base64url"); } catch { return null; }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session && session.refresh_token ? session : null;
  } catch { return null; }
}

function setSession(res, session) {
  const token = signSession(session);
  res.setHeader("Set-Cookie", `openmail_session=${encodeURIComponent(token)}; ${cookieOptions()}`);
}

function clearSession(res) {
  res.setHeader("Set-Cookie", `openmail_session=; ${cookieOptions(0)}`);
}

async function currentUser(req, res) {
  let session = readSignedSession(req);
  if (!session) return null;
  const c = config();
  if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 45) {
    try {
      const refreshed = await supabaseAuth("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } });
      session = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600) };
      setSession(res, session);
    } catch { return null; }
  }
  if (!session.access_token) return null;
  try {
    const user = await supabaseAuth("/user", { accessToken: session.access_token });
    return { id: user.id, email: user.email, accessToken: session.access_token };
  } catch { return null; }
}

function rememberAuthResponse(res, auth) {
  if (!auth.access_token || !auth.refresh_token) return false;
  setSession(res, { access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (auth.expires_in || 3600) });
  return true;
}

module.exports = { config, readiness, supabaseAuth, database, resend, cookieOptions, currentUser, rememberAuthResponse, clearSession };
