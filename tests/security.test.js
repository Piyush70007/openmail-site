const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { json, readJson, requireSameOrigin, logSafeError } = require("../server/http");
const { timedFetch, cookieOptions, currentUser, forwardedAuthOptions, supabaseAuth } = require("../server/services");
const authHandler = require("../api/auth");
const authValidation = authHandler._test;
const authCallbackHandler = require("../api/auth/callback");
const webhook = require("../api/webhooks/resend")._test;
const vercel = require("../vercel.json");

test("JSON request parsing rejects malformed and oversized bodies", async () => {
  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"ok":true}') ])), { ok: true });
  await assert.rejects(readJson(Readable.from([Buffer.from("{")])), (error) => error.status === 400);
  await assert.rejects(readJson({ body: { value: "x".repeat(256 * 1024) } }), (error) => error.status === 413);
});

test("signed email webhook rejects payloads larger than its 1 MiB cap", async () => {
  await assert.rejects(webhook.rawBody(Readable.from([Buffer.alloc(1024 * 1024 + 1)])), (error) => error.status === 413);
});

test("mutating browser requests require an exact same-origin scheme and host", () => {
  const response = () => ({ headers: {}, statusCode: 0, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } });
  const good = { headers: { origin: "https://openmail.example", host: "openmail.example", "x-forwarded-proto": "https" } };
  assert.equal(requireSameOrigin(good), true);
  for (const headers of [
    { host: "openmail.example", "x-forwarded-proto": "https" },
    { origin: "https://attacker.example", host: "openmail.example", "x-forwarded-proto": "https" },
    { origin: "http://openmail.example", host: "openmail.example", "x-forwarded-proto": "https" },
    { origin: "https://openmail.example:444", host: "openmail.example", "x-forwarded-proto": "https" }
  ]) {
    const res = response();
    assert.equal(requireSameOrigin({ headers }, res), false);
    assert.equal(res.statusCode, 403);
  }
});

test("login and signup inputs have bounded email and password lengths", () => {
  assert.equal(authValidation.validEmail("person@example.com"), true);
  assert.equal(authValidation.validEmail(`${"a".repeat(250)}@example.com`), false);
  assert.equal(authValidation.validLoginPassword("a"), true);
  assert.equal(authValidation.validLoginPassword("a".repeat(129)), false);
  assert.equal(authValidation.validSignupPassword("a".repeat(11)), false);
  assert.equal(authValidation.validSignupPassword("a".repeat(12)), true);
  assert.equal(authValidation.validSignupPassword("a".repeat(129)), false);
});

test("authentication provider errors do not reveal whether an account exists", async () => {
  const env = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"].map((key) => [key, process.env[key]]);
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  global.fetch = async () => new Response(JSON.stringify({ msg: "User already registered", code: "user_already_exists" }), { status: 422 });
  const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } };
  try {
    await authHandler({ method: "POST", headers: { origin: "https://openmail.example", host: "openmail.example", "x-forwarded-proto": "https" }, body: { action: "signup", email: "person@example.com", password: "a-long-enough-password" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, "That account request could not be completed. Check your details and try again.");
    assert.doesNotMatch(res.body, /already registered|user_already_exists/i);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of env) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("confirmation callback hides upstream token-validation details", async () => {
  const env = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"].map((key) => [key, process.env[key]]);
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  global.fetch = async () => new Response(JSON.stringify({ msg: "JWT expired", code: "bad_jwt" }), { status: 401 });
  const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } };
  try {
    await authCallbackHandler({ method: "POST", headers: { origin: "https://openmail.example", host: "openmail.example", "x-forwarded-proto": "https" }, body: { accessToken: "a".repeat(32), refreshToken: "r".repeat(32), expiresIn: 3600 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, "Email confirmation could not be completed. Sign in and try again.");
    assert.doesNotMatch(res.body, /JWT expired|bad_jwt/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of env) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("Supabase Auth forwarding trusts only Vercel's single validated client IP and a new secret key", () => {
  const oldVercel = process.env.VERCEL;
  const oldSecret = process.env.SUPABASE_SECRET_KEY;
  try {
    process.env.VERCEL = "1";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test-only";
    assert.deepEqual(forwardedAuthOptions({ headers: { "x-forwarded-for": "203.0.113.7" } }), {
      useSecretApiKey: true,
      forwardedClientIp: "203.0.113.7"
    });
    assert.deepEqual(forwardedAuthOptions({ headers: { "x-forwarded-for": "2001:db8::1" } }), {
      useSecretApiKey: true,
      forwardedClientIp: "2001:db8::1"
    });
    for (const value of ["203.0.113.7, 198.51.100.3", "not-an-ip", ""]) {
      assert.deepEqual(forwardedAuthOptions({ headers: { "x-forwarded-for": value } }), {});
    }
    process.env.SUPABASE_SECRET_KEY = "legacy-service-role-key";
    assert.deepEqual(forwardedAuthOptions({ headers: { "x-forwarded-for": "203.0.113.7" } }), {});
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test-only";
    process.env.VERCEL = "0";
    assert.deepEqual(forwardedAuthOptions({ headers: { "x-forwarded-for": "203.0.113.7" } }), {});
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    if (oldSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldSecret;
  }
});

test("Supabase Auth uses the new secret key and validated forwarded IP only when enabled", async () => {
  const keys = ["VERCEL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
  const previous = keys.map((key) => [key, process.env[key]]);
  const originalFetch = global.fetch;
  const calls = [];
  process.env.VERCEL = "1";
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test-only";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-only";
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: 200 });
  };
  try {
    const req = { headers: { "x-forwarded-for": "203.0.113.7" } };
    await supabaseAuth("/user", { ...forwardedAuthOptions(req), accessToken: "user-token" });
    assert.equal(calls[0].options.headers.apikey, "sb_secret_test-only");
    assert.equal(calls[0].options.headers["Sb-Forwarded-For"], "203.0.113.7");
    assert.equal(calls[0].options.headers.Authorization, "Bearer user-token");

    process.env.SUPABASE_SECRET_KEY = "legacy-service-role-key";
    await supabaseAuth("/user", { ...forwardedAuthOptions(req), accessToken: "user-token" });
    assert.equal(calls[1].options.headers.apikey, "sb_publishable_test-only");
    assert.equal(calls[1].options.headers["Sb-Forwarded-For"], undefined);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("production session cookies are Secure, HttpOnly, root-scoped, and SameSite Lax", () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldVercel = process.env.VERCEL;
  process.env.NODE_ENV = "production";
  process.env.VERCEL = "1";
  try {
    const cookie = cookieOptions(60);
    assert.match(cookie, /(?:^|; )Path=\//);
    assert.match(cookie, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(cookie, /(?:^|; )Secure(?:;|$)/);
    assert.match(cookie, /(?:^|; )SameSite=Lax(?:;|$)/);
    assert.doesNotMatch(cookie, /Domain=/i);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
  }
});

test("session signature tampering is rejected before any Supabase request", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const originalFetch = global.fetch;
  process.env.SESSION_SECRET = "unit-test-session-secret-that-is-long-enough";
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return new Response("{}", { status: 401 }); };
  try {
    const payload = Buffer.from(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    const changed = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const user = await currentUser({ headers: { cookie: `openmail_session=${encodeURIComponent(`${payload}.${changed}`)}` } }, { setHeader() {} });
    assert.equal(user, null);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
  }
});

test("upstream HTTP timeouts and network failures become bounded, sanitized errors", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      const rejectTimeout = () => { const error = new Error("timeout"); error.name = "TimeoutError"; reject(error); };
      if (signal.aborted) rejectTimeout();
      else signal.addEventListener("abort", rejectTimeout, { once: true });
    });
    await assert.rejects(timedFetch("https://service.example", {}, 1), (error) => error.status === 504 && error.code === "UPSTREAM_TIMEOUT");

    global.fetch = async () => { throw new Error("network details with user data"); };
    await assert.rejects(timedFetch("https://service.example"), (error) => error.status === 502 && error.code === "UPSTREAM_UNAVAILABLE");
  } finally { global.fetch = originalFetch; }
});

test("server error logs omit provider messages and request data", () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    logSafeError("test", { status: 502, code: "UPSTREAM_TIMEOUT", message: "private subject and access token" });
    assert.equal(JSON.stringify(logged).includes("private subject"), false);
    assert.equal(JSON.stringify(logged).includes("access token"), false);
    assert.match(JSON.stringify(logged), /UPSTREAM_TIMEOUT/);
  } finally { console.error = originalError; }
});

test("production security headers include HTTPS, framing, and same-origin form protections", () => {
  const headers = new Map(vercel.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(headers.get("strict-transport-security"), /max-age=31536000/);
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.match(headers.get("content-security-policy"), /form-action 'self'/);
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(headers.get("content-security-policy"), /object-src 'none'/);
});

test("JSON API responses are not cached", () => {
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value; } };
  json(res, 200, { ok: true });
  assert.equal(res.headers["Cache-Control"], "no-store");
});
