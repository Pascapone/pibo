import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PiboFileCredentialStore,
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

test("b1-k03 access objects keep a two-field shape (form regression, not a security boundary)", () => {
	// This pins the object shape only. It does not restrict store enumeration:
	// listPiCredentials stays available to importers by design.
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

test("b1-k03 type matrix documents best-effort isConfigured gaps", async (t) => {
	// NOTE: matrix cells use the real openai/openai-codex ids, because pi
	// only resolves registered provider ids. Synthetic ids stay unresolved.
	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const apiOnKey = bindPiProviderApiKeyAccess(API_KEY_PROVIDER);
	assert.equal(await apiOnKey.getApiKey(), API_KEY_FIXTURE);
	assert.equal(await apiOnKey.isConfigured(), true);
	const oauthOnKey = bindPiProviderOAuthAccess(API_KEY_PROVIDER);
	assert.equal(await oauthOnKey.getAuth(), undefined);
	assert.equal(await oauthOnKey.isConfigured(), false);
	await deletePiCredential(API_KEY_PROVIDER);

	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() + 3600_000,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const oauthOnOauth = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	assert.deepEqual(await oauthOnOauth.getAuth(), {
		accessToken: OAUTH_ACCESS_FIXTURE,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	assert.equal(await oauthOnOauth.isConfigured(), true);
	const apiOnOauth = bindPiProviderApiKeyAccess(OAUTH_PROVIDER);
	assert.equal(
		await apiOnOauth.getApiKey(),
		OAUTH_ACCESS_FIXTURE,
		"documents existing resolution: an oauth entry under the id resolves its access token",
	);
	assert.equal(await apiOnOauth.isConfigured(), true);
	await deletePiCredential(OAUTH_PROVIDER);

	const unknownApi = bindPiProviderApiKeyAccess("b1-k03-unknown-provider");
	assert.equal(await unknownApi.getApiKey(), undefined);
	assert.equal(await unknownApi.isConfigured(), false);
});

test("b1-k03 expired oauth reports configured without triggering a refresh", async (t) => {
	// isConfigured is read-only (no refresh). getAuth on this entry would
	// start a real OAuth refresh and is deliberately NOT called here.
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() - 1000,
		accountId: OAUTH_ACCOUNT_FIXTURE,
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const access = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	assert.equal(await access.isConfigured(), true);
});

test("b1-k03 unusable entries resolve to absence without throwing", async (t) => {
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		expires: Date.now() + 3600_000,
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const oauthAccess = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	assert.equal(await oauthAccess.getAuth(), undefined);
	assert.equal(await oauthAccess.isConfigured(), true);

	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: "" });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const apiAccess = bindPiProviderApiKeyAccess(API_KEY_PROVIDER);
	assert.equal(await apiAccess.getApiKey(), undefined);
	assert.equal(
		await apiAccess.isConfigured(),
		true,
		"documents existing gap: a stored but empty entry still reports configured",
	);
});

test("b1-k03 oauth binding passes stored accountId through trimmed and invents none", async (t) => {
	const jwtShapedAccess = "eyJiLXN5bnRoZXRpYy1maXh0dXJlLW5vLXNpZ25hdHVyZX0";
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: jwtShapedAccess,
		expires: Date.now() + 3600_000,
		refresh: "b1-fixture-refresh-token",
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	const access = bindPiProviderOAuthAccess(OAUTH_PROVIDER);
	assert.deepEqual(await access.getAuth(), { accessToken: jwtShapedAccess });
});

test("b1-k03 oauth binding trims stored accountId and omits blank values", async (t) => {
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() + 3600_000,
		accountId: "  padded-account  ",
	});
	t.after(() => deletePiCredential(OAUTH_PROVIDER));
	assert.deepEqual(await bindPiProviderOAuthAccess(OAUTH_PROVIDER).getAuth(), {
		accessToken: OAUTH_ACCESS_FIXTURE,
		accountId: "padded-account",
	});
	await writePiCredential(OAUTH_PROVIDER, {
		type: "oauth",
		access: OAUTH_ACCESS_FIXTURE,
		expires: Date.now() + 3600_000,
		accountId: "   ",
	});
	assert.deepEqual(await bindPiProviderOAuthAccess(OAUTH_PROVIDER).getAuth(), {
		accessToken: OAUTH_ACCESS_FIXTURE,
	});
});

test("b1-k03 owner-bound api-key access matches the BASE consumer plug shape (pre-integration)", async (t) => {
	// Pre-integration shape check only, not the joint B→I→C end-to-end proof.
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

test("b1-k03 owner-bound oauth access matches the BASE consumer plug shape (pre-integration)", async (t) => {
	// Pre-integration shape check only, not the joint B→I→C end-to-end proof.
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

test("b1-k03 unconfigured bindings fail BASE transcription as not configured without network", async () => {
	// Plug-shape compatibility with the BASE consumer in this worktree. The
	// joint B→I→C end-to-end proof (C provider_error mapping, injected-path
	// JWT derivation) stays blocked_on_integration and is NOT claimed here.
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

test("b1-k03 file store degrades malformed auth.json to absence without throwing", async (t) => {
	// Disk-fault remainder, concrete: the bundled file-backed store maps
	// unreadable state to absence, never to a throw or invented credential.
	// Direct store use keeps this deterministic (no pi snapshot cache).
	const dir = mkdtempSync(join(tmpdir(), "pibo-b1-k03-corrupt-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const authPath = join(dir, "auth.json");
	writeFileSync(authPath, "{not valid json", "utf8");
	const store = new PiboFileCredentialStore(authPath);
	assert.equal(await store.read(API_KEY_PROVIDER), undefined);
	assert.deepEqual(await store.list(), []);
});

test("b1-k03 file store degrades an unreadable auth path to absence without throwing", async (t) => {
	// EISDIR fails readFile for every user (chmod-based cases do not fail
	// for root), so this pins the no-throw absence mapping deterministically.
	const dir = mkdtempSync(join(tmpdir(), "pibo-b1-k03-eisdir-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const authPath = join(dir, "auth.json");
	mkdirSync(authPath);
	const store = new PiboFileCredentialStore(authPath);
	assert.equal(await store.read(API_KEY_PROVIDER), undefined);
	assert.deepEqual(await store.list(), []);
});

test("b1-k03 oauth binding never pairs another provider entry to the bound id", async (t) => {
	await writePiCredential(API_KEY_PROVIDER, { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential(API_KEY_PROVIDER));
	const access = bindPiProviderOAuthAccess("b1-k03-scope-oauth-other");
	assert.equal(await access.getAuth(), undefined);
	assert.equal(await access.isConfigured(), false);
});
