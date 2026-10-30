const { json, method, readJson, requireSameOrigin, fail } = require("../../server/http");
const { supabaseAuth, rememberAuthResponse } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 128) {
      return json(res, 400, { error: "Enter a valid email and a password with at least 12 characters." });
    }
    const protocol = (req.headers["x-forwarded-proto"] || (String(req.headers.host).startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
    const origin = process.env.OPENMAIL_PUBLIC_URL || `${protocol}://${req.headers.host}`;
    const auth = await supabaseAuth(`/signup?redirect_to=${encodeURIComponent(`${origin}/app.html`)}`, { method: "POST", body: { email, password } });
    const signedIn = rememberAuthResponse(res, auth);
    json(res, 200, { ok: true, signedIn, message: signedIn ? "Your account is ready." : "Check your email to confirm your account, then sign in." });
  } catch (error) { fail(res, error); }
};
