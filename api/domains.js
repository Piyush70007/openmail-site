const { json, method, readJson, requireSameOrigin, fail } = require("../server/http");
const { signedIn, requireConfirmedEmail, requireQuota } = require("../server/account");
const { database, resend, readiness } = require("../server/services");
const { domainToASCII } = require("node:url");
const dns = require("node:dns/promises");

function normalizeDomain(value) {
  const ascii = domainToASCII(String(value || "").trim().replace(/\.$/, "").toLowerCase());
  if (!ascii || ascii.length > 253 || !ascii.includes(".") || ascii.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return "";
  return ascii;
}

module.exports = async (req, res) => {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (req.method === "GET") {
      if (req.query && req.query.check) {
        const domain = normalizeDomain(req.query.check);
        if (!domain) return json(res, 400, { error: "Enter a valid domain name, such as example.com." });
        if (!await requireQuota(user.id, "dns_check", res)) return;
        try {
          const mx = await dns.resolveMx(domain);
          return json(res, 200, {
            domain,
            mxLookup: "found",
            existingMailRoute: true,
            mx: mx.sort((a, b) => a.priority - b.priority).map((item) => ({ priority: item.priority, host: item.exchange }))
          });
        } catch (error) {
          if (error.code === "ENODATA" || error.code === "ENOTFOUND") {
            return json(res, 200, { domain, mxLookup: "not-found", existingMailRoute: false, mx: [] });
          }
          return json(res, 200, { domain, mxLookup: "unavailable", existingMailRoute: null, mx: [] });
        }
      }
      const rows = await database(`domains?select=id,domain_name,status,dns_records,created_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc`);
      return json(res, 200, { domains: rows || [] });
    }
    if (!requireSameOrigin(req, res)) return;
    if (!readiness().mailReady) return json(res, 503, { error: "Email services are not connected yet. Finish the setup listed in the project README." });
    if (!requireConfirmedEmail(user, res)) return;
    const body = await readJson(req);
    const ascii = normalizeDomain(body.domain);
    if (!ascii) return json(res, 400, { error: "Enter a valid domain name, such as example.com." });
    const existing = await database(`domains?select=id&domain_name=eq.${encodeURIComponent(ascii)}&limit=1`);
    if (existing && existing.length) return json(res, 409, { error: "That domain is already connected to an OpenMail account." });
    if (!await requireQuota(user.id, "domain_create", res)) return;
    const provider = await resend("/domains", {
      method: "POST",
      body: { name: ascii, capabilities: { sending: "enabled", receiving: "enabled" } }
    });
    const row = {
      owner_id: user.id,
      domain_name: ascii,
      provider_domain_id: provider.id,
      status: provider.status || "pending",
      dns_records: provider.records || []
    };
    const saved = await database("domains", { method: "POST", body: row, prefer: "return=representation" });
    json(res, 201, { domain: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) { fail(res, error); }
};
