const { json, method, requireSameOrigin, fail } = require("../../../server/http");
const { signedIn, ownedRow, requireConfirmedEmail, requireQuota } = require("../../../server/account");
const { database, resend, readiness } = require("../../../server/services");

module.exports = async (req, res) => {
  if (!method(req, res, ["POST"]) || !requireSameOrigin(req, res)) return;
  try {
    const user = await signedIn(req, res);
    if (!user) return;
    if (!requireConfirmedEmail(user, res)) return;
    if (!readiness().mailReady) return json(res, 503, { error: "Email services are not connected yet." });
    const domain = await ownedRow("domains", req.query.id, user.id, "id,domain_name,provider_domain_id,status,dns_records");
    if (!domain) return json(res, 404, { error: "Domain not found." });
    if (!await requireQuota(user.id, "domain_verify", res)) return;
    try { await resend(`/domains/${encodeURIComponent(domain.provider_domain_id)}/verify`, { method: "POST" }); } catch (error) {
      if (error.status !== 400) throw error;
    }
    const provider = await resend(`/domains/${encodeURIComponent(domain.provider_domain_id)}`);
    const status = provider.status || domain.status;
    const records = provider.records || domain.dns_records || [];
    const updated = await database(`domains?id=eq.${encodeURIComponent(domain.id)}&owner_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH", body: { status, dns_records: records }, prefer: "return=representation"
    });
    json(res, 200, { domain: Array.isArray(updated) ? updated[0] : { ...domain, status, dns_records: records } });
  } catch (error) { fail(res, error); }
};
