const { json, method, readJson, requireSameOrigin, fail } = require("../server/http");
const { supabaseAuth, rememberAuthResponse } = require("../server/services");

function validEmail(email) {
  return email.length <= 254 && /^\S+@\S+\.\S+$/.test(email);
}

function validLoginPassword(password) {
  return password.length > 0 && password.length <= 128;
}

function validSignupPassword(password) {
  return password.length >= 12 && password.length <= 128;
}

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const body = await readJson(req);
    const action = String(body.action || "");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!validEmail(email)) {
      return json(res, 400, { error: "Enter a valid account email." });
    }

    if (action === "login") {
      if (!validLoginPassword(password)) return json(res, 400, { error: "Enter your account email and a password up to 128 characters." });
      const auth = await supabaseAuth("/token?grant_type=password", { method: "POST", body: { email, password } });
      if (!rememberAuthResponse(res, auth)) return json(res, 401, { error: "Sign in could not be completed." });
      return json(res, 200, { ok: true, user: { email: auth.user && auth.user.email } });
    }

    if (action === "signup") {
      if (!validSignupPassword(password)) {
        return json(res, 400, { error: "Enter a password with at least 12 characters." });
      }
      const protocol = (req.headers["x-forwarded-proto"] || (String(req.headers.host).startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
      const origin = process.env.OPENMAIL_PUBLIC_URL || `${protocol}://${req.headers.host}`;
      const auth = await supabaseAuth(`/signup?redirect_to=${encodeURIComponent(`${origin}/app.html`)}`, { method: "POST", body: { email, password } });
      const signedIn = rememberAuthResponse(res, auth);
      return json(res, 200, { ok: true, signedIn, message: signedIn ? "Your account is ready." : "Check your email to confirm your account, then sign in." });
    }

    json(res, 400, { error: "Choose sign in or create account." });
  } catch (error) {
    // Provider messages can reveal whether an account exists or expose internal
    // Auth details. Keep the public response generic for every Auth rejection.
    if (Number.isInteger(error && error.status) && error.status >= 400 && error.status < 500) {
      return json(res, error.status === 429 ? 429 : 400, { error: "That account request could not be completed. Check your details and try again." });
    }
    fail(res, error);
  }
};

module.exports._test = { validEmail, validLoginPassword, validSignupPassword };
