import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writePiCredential, deletePiCredential } from "../dist/agent-runtimes/pi/credentials.js";
import { createOpenAiTranscriptionProvider } from "../dist/transcription/openai.js";

const audio = { audio: { bytes: new Uint8Array([1, 2, 3]), filename: "test.webm", mimeType: "audio/webm" } };

async function isolatedOwner(t) {
  const home = await mkdtemp(join(tmpdir(), "pibo-owner-integration-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousFetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = home;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Unexpected external request in owner integration test"); };
  t.after(async () => {
    globalThis.fetch = previousFetch;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(home, { recursive: true, force: true });
  });
  return () => networkAttempts;
}

function localProvider() {
  const requests = [];
  const provider = createOpenAiTranscriptionProvider({
    fetch: async (url, init) => {
      requests.push({ url: String(url), authorization: init.headers.Authorization });
      return new Response(JSON.stringify({ text: "local transcript" }), { status: 200 });
    },
  });
  return { provider, requests };
}

test("integrated API consumer obtains only its fixed provider credentials from the real owner", async (t) => {
  const attempts = await isolatedOwner(t);
  await writePiCredential("openai", { type: "api_key", key: "integration-openai-key" });
  await writePiCredential("anthropic", { type: "api_key", key: "integration-unrelated-key" });
  const { provider, requests } = localProvider();
  assert.equal(await provider.isConfigured(), true);
  assert.equal((await provider.transcribe(audio)).text, "local transcript");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, "Bearer integration-openai-key");
  assert.equal(attempts(), 0);
  await deletePiCredential("openai");
  assert.equal(await provider.isConfigured(), false);
  await assert.rejects(provider.transcribe(audio), (error) => error.code === "not_configured");
  assert.equal(requests.length, 1, "unrelated credentials must never be used as fallback");
  assert.equal(attempts(), 0);
});

test("integrated API owner failures are mapped safely without a transcription request", async (t) => {
  const attempts = await isolatedOwner(t);
  await writePiCredential("openai", { type: "api_key", key: "integration-private-key" });
  const cause = new Error("synthetic owner lookup failure");
  t.mock.method(ModelRuntime, "create", async () => { throw cause; });
  const { provider, requests } = localProvider();
  await assert.rejects(provider.transcribe(audio), (error) => {
    assert.equal(error.code, "provider_error");
    assert.equal(error.message, "OpenAI API authentication could not be loaded.");
    assert.equal(error.cause, cause);
    assert.ok(!error.message.includes("integration-private-key"));
    return true;
  });
  assert.equal(requests.length, 0);
  assert.equal(attempts(), 0);
});
