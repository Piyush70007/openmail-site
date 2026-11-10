const { json } = require("./http");
const { currentUser, database, consumeQuota } = require("./services");

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

function requireConfirmedEmail(user, res) {
  if (user.emailConfirmed) return true;
  json(res, 403, { error: "Confirm your account email before setting up or using a mailbox." });
  return false;
}

async function requireQuota(ownerId, action, res) {
  if (await consumeQuota(ownerId, action)) return true;
  const windowSeconds = action === "dns_check" || action === "domain_verify" ? 3600 : 86400;
  const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  res.setHeader("Retry-After", String(retryAfter));
  json(res, 429, { error: "You’ve reached this account’s current usage limit. Please try again later." });
  return false;
}

module.exports = { signedIn, query, ownedRow, requireConfirmedEmail, requireQuota };
