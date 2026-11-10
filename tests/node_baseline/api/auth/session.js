const { json, method } = require("../../server/http");
const { currentUser } = require("../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["GET"])) return;
  const user = await currentUser(req, res);
  json(res, 200, { signedIn: Boolean(user), user: user ? { id: user.id, email: user.email } : null });
};
