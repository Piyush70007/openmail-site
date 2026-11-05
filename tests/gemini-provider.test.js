const test = require("node:test");
const assert = require("node:assert/strict");
const { config } = require("../server/services");
const { geminiCompletion, toGeminiSchema } = require("../server/ai");

test("Gemini is selected only for the configured test owner", () => {
  const original = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_TEST_OWNER_ID: process.env.GEMINI_TEST_OWNER_ID
  };
  process.env.GROQ_API_KEY = "groq-test-key";
  process.env.GEMINI_API_KEY = "gemini-test-key";
  process.env.GEMINI_TEST_OWNER_ID = "test-owner";
  try {
    assert.equal(config("test-owner").aiProvider, "gemini");
    assert.equal(config("test-owner").aiKey, "gemini-test-key");
    assert.equal(config("another-owner").aiProvider, "groq");
    assert.equal(config("another-owner").aiKey, "groq-test-key");
    assert.equal(config().aiProvider, "groq");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Gemini response schemas are converted to the provider's schema shape", () => {
  assert.deepEqual(toGeminiSchema({
    type: "object",
    required: ["decision"],
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["auto_reply", "human_review"] },
      evidence: { type: "array", items: { type: "object", properties: { quote: { type: "string" } } } }
    }
  }), {
    type: "OBJECT",
    required: ["decision"],
    properties: {
      decision: { type: "STRING", enum: ["auto_reply", "human_review"] },
      evidence: { type: "ARRAY", items: { type: "OBJECT", properties: { quote: { type: "STRING" } } } }
    }
  });
});

test("Gemini completion keeps the API key in a header and maps structured output", async () => {
  let request;
  const result = await geminiCompletion({ aiKey: "secret-test-value", aiModel: "gemini-3.8-flash" }, [
    { role: "system", content: "Only use the approved company facts." },
    { role: "user", content: "Can you answer this question?" }
  ], {
    maxTokens: 120,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] }
      }
    },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        status: 200,
        ok: true,
        json: async () => ({ modelVersion: "gemini-3.8-flash", candidates: [{ content: { parts: [{ text: '{"answer":"verified"}' }] } }] })
      };
    }
  });

  assert.equal(result.content, '{"answer":"verified"}');
  assert.equal(result.model, "gemini-3.8-flash");
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(request.options.headers["x-goog-api-key"], "secret-test-value");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.body.systemInstruction.parts[0].text, "Only use the approved company facts.");
  assert.deepEqual(request.body.contents, [{ role: "user", parts: [{ text: "Can you answer this question?" }] }]);
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.equal(request.body.generationConfig.maxOutputTokens, 120);
  assert.equal(request.body.generationConfig.responseSchema.type, "OBJECT");
  assert.equal("temperature" in request.body.generationConfig, false);
  assert.doesNotMatch(request.url, /secret-test-value/);
});

test("Gemini quota errors remain distinguishable from OpenMail's own quota", async () => {
  await assert.rejects(() => geminiCompletion({ aiKey: "key", aiModel: "gemini-2.5-flash" }, [
    { role: "user", content: "test" }
  ], {
    fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}) })
  }), (error) => error.status === 429 && /Gemini/.test(error.message));
});
