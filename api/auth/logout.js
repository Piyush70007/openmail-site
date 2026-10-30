const { json, method, requireSameOrigin } = require("../../server/http");
const { clearSession, currentUser, supabaseAuth } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  const user = await currentUser(req, res);
  if (user) await supabaseAuth("/logout", { method: "POST", accessToken: user.accessToken }).catch(() => {});
  clearSession(res);
  json(res, 200, { ok: true });
};
