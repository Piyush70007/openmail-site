const { json } = require("./http");
const { currentUser, database } = require("./services");

async function signedIn(req, res) {
  const user = await currentUser(req, res);
  if (!user) {
    json(res, 401, { error: "Sign in to continue." });
    return null;
  }
  return user;
}

function query(filters, select = "*") {
  const params = new URLSearchParams({ select, ...filters });
  return params.toString();
}

async function ownedRow(table, id, ownerId, select = "*") {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const rows = await database(`${table}?${query({ id: `eq.${id}`, owner_id: `eq.${ownerId}`, limit: "1" }, select)}`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

module.exports = { signedIn, query, ownedRow };
