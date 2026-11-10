const { json, method, readJson, requireSameOrigin, fail } = require("../../server/http");
const { supabaseAuth, rememberAuthResponse, forwardedAuthOptions } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const body = await readJson(req);
    const accessToken = String(body.accessToken || "");
    const refreshToken = String(body.refreshToken || "");
    if (accessToken.length < 20 || accessToken.length > 8192 || refreshToken.length < 20 || refreshToken.length > 2048) {
      return json(res, 400, { error: "The confirmation session is missing or expired. Sign in to continue." });
    }
    const user = await supabaseAuth("/user", { ...forwardedAuthOptions(req), accessToken });
    const expiresIn = Math.max(60, Math.min(86400, Number(body.expiresIn) || 3600));
    rememberAuthResponse(res, { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn });
    json(res, 200, { ok: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    if (Number.isInteger(error && error.status) && error.status >= 400 && error.status < 500) {
      return json(res, 400, { error: "Email confirmation could not be completed. Sign in and try again." });
    }
    fail(res, error);
  }
};
