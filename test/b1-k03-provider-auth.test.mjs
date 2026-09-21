import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	bindPiProviderApiKeyAccess,
	bindPiProviderOAuthAccess,
	deletePiCredential,
	deriveStoredOAuthAuthResult,
	writePiCredential,
} from "../dist/agent-runtimes/pi/credentials.js";
import { createOpenAiChatGptTranscriptionProvider } from "../dist/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../dist/transcription/openai.js";
import { PiboTranscriptionError } from "../dist/transcription/types.js";

const agentDir = mkdtempSync(join(tmpdir(), "pibo-b1-k03-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
	delete process.env[name];
}
test.after(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

const API_KEY_PROVIDER = "openai";
const API_KEY_FIXTURE = "b1-fixture-api-key";
const OAUTH_PROVIDER = "openai-codex";
const OAUTH_ACCESS_FIXTURE = "b1-fixture-oauth-access";
const OAUTH_ACCOUNT_FIXTURE = "b1-fixture-account";

function stubTranscriptFetch(text) {
	return async () => new Response(JSON.stringify({ text: `  ${text}  ` }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const audioInput = {
	audio: { bytes: new Uint8Array([1, 2, 3]), filename: "b1-k03.webm", mimeType: "audio/webm" },
};

test("b1-k03 api-key binding resolves owner credentials and reports configured state", async (t) => {
	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const access = bindPiProviderApiKeyAccess(API_KEY_PROVIDER);
	assert.equal(await access.getApiKey(), API_KEY_FIXTURE);
	assert.equal(await access.isConfigured(), true);
});

test("b1-k03 api-key binding is unconfigured without stored credentials", async () => {
	const access = bindPiProviderApiKeyAccess("anthropic");
	assert.equal(await access.getApiKey(), undefined);
	assert.equal(await access.isConfigured(), false);
});

test("b1-k03 credential bindings are scoped to their bound provider", async (t) => {
	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const access = bindPiProviderApiKeyAccess("anthropic");
	assert.equal(await access.getApiKey(), undefined);
	assert.equal(await access.isConfigured(), false);
});

test("b1-k03 access objects expose no credential enumeration", () => {
	assert.deepEqual(Object.keys(bindPiProviderApiKeyAccess(API_KEY_PROVIDER)).sort(), ["getApiKey", "isConfigured"]);
	assert.deepEqual(Object.keys(bindPiProviderOAuthAccess(OAUTH_PROVIDER)).sort(), ["getAuth", "isConfigured"]);
});

test("b1-k03 oauth binding resolves stored oauth access with account id", async (t) => {
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() + 3600_000,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const access = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	assert.deepEqual(await access.getAuth(), {
		accessToken: OAUTH_ACCESS_FIXTURE,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	assert.equal(await access.isConfigured(), true);
});

test("b1-k03 oauth binding is unconfigured for missing or non-oauth credentials", async (t) => {
	const missing = bindPiProviderOAuthAccess("b1-k03-oauth-missing");
	assert.equal(await missing.getAuth(), undefined);
	assert.equal(await missing.isConfigured(), false);

	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const apiKeyShaped = bindPiProviderOAuthAccess(API_KEY_PROVIDER);
	assert.equal(await apiKeyShaped.getAuth(), undefined);
	assert.equal(await apiKeyShaped.isConfigured(), false);
});

test("b1-k03 stored oauth derivation honors the refresh margin", () => {
	assert.deepEqual(
		deriveStoredOAuthAuthResult({ type: "oauth", access: OAUTH_ACCESS_FIXTURE, expires: Date.now() + 3600_000 }),
		{ auth: { apiKey: OAUTH_ACCESS_FIXTURE }, source: "OAuth" },
	);
	assert.equal(
		deriveStoredOAuthAuthResult({ type: "oauth", access: OAUTH_ACCESS_FIXTURE, expires: Date.now() + 60_000 }),
		undefined,
	);
	assert.equal(
		deriveStoredOAuthAuthResult({ type: "oauth", access: OAUTH_ACCESS_FIXTURE, expires: Date.now() - 1000 }),
		undefined,
	);
	assert.equal(deriveStoredOAuthAuthResult({ type: "oauth", access: "" }), undefined);
	assert.equal(deriveStoredOAuthAuthResult({ type: "api_key", key: API_KEY_FIXTURE }), undefined);
	assert.equal(deriveStoredOAuthAuthResult(undefined), undefined);
});

test("b1-k03 owner-bound api-key access drives the transcription seam", async (t) => {
	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const access = bindPiProviderApiKeyAccess(API_KEY_PROVIDER);
	const provider = createOpenAiTranscriptionProvider({
		getApiKey: access.getApiKey,
		isConfigured: access.isConfigured,
		fetch: stubTranscriptFetch("owner-bound transcript"),
	});
	assert.equal(await provider.isConfigured(), true);
	const result = await provider.transcribe(audioInput);
	assert.equal(result.text, "owner-bound transcript");
	assert.equal(result.model, "gpt-4o-mini-transcribe");
});

test("b1-k03 owner-bound oauth access drives the chatgpt transcription seam", async (t) => {
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() + 3600_000,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const access = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	let captured;
	const provider = createOpenAiChatGptTranscriptionProvider({
		getAuth: access.getAuth,
		isConfigured: access.isConfigured,
		fetch: async (url, init) => {
			captured = { url, init };
			return new Response(JSON.stringify({ text: "owner-bound chatgpt transcript" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});
	assert.equal(await provider.isConfigured(), true);
	const result = await provider.transcribe(audioInput);
	assert.equal(result.text, "owner-bound chatgpt transcript");
	assert.equal(captured.init.headers.Authorization, `Bearer ${OAUTH_ACCESS_FIXTURE}`);
	assert.equal(captured.init.headers["ChatGPT-Account-Id"], OAUTH_ACCOUNT_FIXTURE);
});

test("b1-k03 unconfigured bindings fail transcription as not configured without network", async () => {
	let requested = false;
	const failingFetch = async () => {
		requested = true;
		throw new Error("network must not run");
	};
	const apiKeyAccess = bindPiProviderApiKeyAccess("anthropic");
	const apiProvider = createOpenAiTranscriptionProvider({
		getApiKey: apiKeyAccess.getApiKey,
		isConfigured: apiKeyAccess.isConfigured,
		fetch: failingFetch,
	});
	await assert.rejects(
		apiProvider.transcribe(audioInput),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
	);
	const oauthAccess = bindPiProviderOAuthAccess("b1-k03-seam-missing-oauth");
	const oauthProvider = createOpenAiChatGptTranscriptionProvider({
		getAuth: oauthAccess.getAuth,
		isConfigured: oauthAccess.isConfigured,
		fetch: failingFetch,
	});
	await assert.rejects(
		oauthProvider.transcribe(audioInput),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
	);
	assert.equal(requested, false);
});
