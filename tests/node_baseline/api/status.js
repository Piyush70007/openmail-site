const { json, method } = require("../server/http");
const { readiness } = require("../server/services");

module.exports = (req, res) => {
  if (!method(req, res, ["GET"])) return;
  json(res, 200, readiness());
};
