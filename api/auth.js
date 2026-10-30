const { json, method, readJson, requireSameOrigin, fail } = require("../server/http");
const { supabaseAuth, rememberAuthResponse } = require("../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const body = await readJson(req);
    const action = String(body.action || "");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return json(res, 400, { error: "Enter a valid account email." });
    }

    if (action === "login") {
      if (!password) return json(res, 400, { error: "Enter your account email and password." });
      const auth = await supabaseAuth("/token?grant_type=password", { method: "POST", body: { email, password } });
      if (!rememberAuthResponse(res, auth)) return json(res, 401, { error: "Sign in could not be completed." });
      return json(res, 200, { ok: true, user: { email: auth.user && auth.user.email } });
    }

    if (action === "signup") {
      if (password.length < 12 || password.length > 128) {
        return json(res, 400, { error: "Enter a password with at least 12 characters." });
      }
      const protocol = (req.headers["x-forwarded-proto"] || (String(req.headers.host).startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
      const origin = process.env.OPENMAIL_PUBLIC_URL || `${protocol}://${req.headers.host}`;
      const auth = await supabaseAuth(`/signup?redirect_to=${encodeURIComponent(`${origin}/app.html`)}`, { method: "POST", body: { email, password } });
      const signedIn = rememberAuthResponse(res, auth);
      return json(res, 200, { ok: true, signedIn, message: signedIn ? "Your account is ready." : "Check your email to confirm your account, then sign in." });
    }

    json(res, 400, { error: "Choose sign in or create account." });
  } catch (error) { fail(res, error); }
};
