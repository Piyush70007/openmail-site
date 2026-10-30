const { json, method, readJson, requireSameOrigin, fail } = require("../server/http");
const { signedIn, ownedRow, requireConfirmedEmail, requireQuota } = require("../server/account");
const { database, readiness } = require("../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (req.method === "GET") {
      const rows = await database(`mailboxes?select=id,domain_id,address,local_part,status,created_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc`);
      return json(res, 200, { mailboxes: rows || [] });
    }
    if (!requireSameOrigin(req, res)) return;
    if (!readiness().mailReady) return json(res, 503, { error: "Email services are not connected yet." });
    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const localPart = String(body.localPart || "").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(localPart) || localPart.includes("..")) {
      return json(res, 400, { error: "Use 1–64 letters, numbers, dots, plus signs, underscores, or hyphens." });
    }
    const domain = await ownedRow("domains", body.domainId, user.id, "id,domain_name,status");
    if (!domain) return json(res, 404, { error: "Choose a domain connected to your account." });
    if (domain.status !== "verified") return json(res, 409, { error: "Verify your domain before creating mailboxes." });
    if (!await requireQuota(user.id, "mailbox_create", res)) return;
    const address = `${localPart}@${domain.domain_name}`;
    const saved = await database("mailboxes", {
      method: "POST",
      body: { owner_id: user.id, domain_id: domain.id, local_part: localPart, address, status: "active" },
      prefer: "return=representation"
    });
    json(res, 201, { mailbox: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) {
    if (error.status === 409 || error.status === 23505) return json(res, 409, { error: "That address already exists. Choose another name." });
    fail(res, error);
  }
};
