import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

async function withServer(fn) {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health and dynamic OpenAPI are available", async () => {
  process.env.GPT_ACTION_API_KEY = "test-secret";
  process.env.MOCK_MODE = "true";
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "remix-banger-gpt-action",
      mode: "mock",
    });

    const schema = await fetch(`${baseUrl}/openapi.yaml`);
    assert.equal(schema.status, 200);
    const text = await schema.text();
    assert.match(text, new RegExp(`url: ${baseUrl.replaceAll("/", "\\/")}`));
    assert.match(text, /operationId: startProfessionalRemix/);
  });
});

test("API key is required", async () => {
  process.env.GPT_ACTION_API_KEY = "test-secret";
  process.env.MOCK_MODE = "true";
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/remixes/unknown`);
    assert.equal(response.status, 401);
  });
});

test("mock remix starts and can be queried", async () => {
  process.env.GPT_ACTION_API_KEY = "test-secret";
  process.env.MOCK_MODE = "true";
  process.env.MOCK_DELAY_MS = "1000";
  process.env.ALLOW_ANY_FILE_URL = "true";

  await withServer(async (baseUrl) => {
    const start = await fetch(`${baseUrl}/v1/remixes/professional`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": "test-secret" },
      body: JSON.stringify({
        openaiFileIdRefs: [
          {
            name: "test.mp3",
            mime_type: "audio/mpeg",
            download_link: "https://example.com/test.mp3",
          },
        ],
        style: "afro house",
      }),
    });
    assert.equal(start.status, 202);
    const job = await start.json();
    assert.match(job.jobId, /^m_/);
    assert.equal(job.status, "processing");

    const status = await fetch(`${baseUrl}/v1/remixes/${encodeURIComponent(job.jobId)}`, {
      headers: { "X-API-Key": "test-secret" },
    });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).jobId, job.jobId);
  });
});
