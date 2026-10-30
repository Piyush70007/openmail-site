const { json, method, readJson, requireSameOrigin, fail } = require("../../server/http");
const { supabaseAuth, rememberAuthResponse } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) return json(res, 400, { error: "Enter your account email and password." });
    const auth = await supabaseAuth("/token?grant_type=password", { method: "POST", body: { email, password } });
    if (!rememberAuthResponse(res, auth)) return json(res, 401, { error: "Sign in could not be completed." });
    json(res, 200, { ok: true, user: { email: auth.user && auth.user.email } });
  } catch (error) { fail(res, error); }
};
