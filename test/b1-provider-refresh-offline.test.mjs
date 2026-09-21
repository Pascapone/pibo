import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelsError } from "@earendil-works/pi-ai";
import {
	bindPiProviderApiKeyAccess,
	bindPiProviderOAuthAccess,
	deletePiCredential,
	listPiCredentials,
	readPiCredential,
	writePiCredential,
} from "../dist/agent-runtimes/pi/credentials.js";
import {
	B1_CODEX_TOKEN_URL,
	createRefreshPeer,
	syntheticCodexAccessToken,
} from "./fixtures/b1-auth-refresh-peer.mjs";

// Real binding code, real pi resolve/refresh/rotation logic, real private
// temp store. Only two test-local seams: ModelRuntime.create throws a
// controlled synthetic failure (pure propagation proof), and the global
// fetch answers the token endpoint locally (offline refresh proof). The
// bindings under test are never stubbed. No network, no real tokens.
const agentDir = mkdtempSync(join(tmpdir(), "pibo-b1-refresh-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
	delete process.env[name];
}
test.after(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

const API_KEY_FIXTURE = "b1-fixture-api-key";
const OLD_ACCESS = "b1-fixture-access-old";
const OLD_REFRESH = "b1-fixture-refresh-old";
const OLD_ACCOUNT = "b1-fixture-acct-old";
const NEW_ACCOUNT = "b1-fixture-acct-new";
const NEW_REFRESH = "b1-fixture-refresh-new";

function installFetch(t, fetchImpl) {
	const original = globalThis.fetch;
	globalThis.fetch = fetchImpl;
	t.after(() => {
		globalThis.fetch = original;
	});
}

function expiredOauthEntry() {
	return { type: "oauth", access: OLD_ACCESS, refresh: OLD_REFRESH, expires: Date.now() - 1000, accountId: OLD_ACCOUNT };
}

test("b1-refresh api binding propagates a dependency throw with identity", async (t) => {
	await writePiCredential("openai", { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential("openai"));
	const failure = new ModelsError("auth", "synthetic resolve failure b1-r06");
	t.mock.method(ModelRuntime, "create", async () => {
		throw failure;
	});
	const access = bindPiProviderApiKeyAccess("openai");
	await assert.rejects(access.getApiKey(), (error) => error === failure);
	assert.equal(failure.code, "auth");
	assert.deepEqual(await readPiCredential("openai"), { type: "api_key", key: API_KEY_FIXTURE });
	assert.deepEqual((await listPiCredentials()).map((entry) => entry.providerId).sort(), ["openai"]);
});

test("b1-refresh oauth binding propagates dependency throws on an expired entry", async (t) => {
	const planted = expiredOauthEntry();
	await writePiCredential("openai-codex", planted);
	t.after(() => deletePiCredential("openai-codex"));
	const oauthFailure = new ModelsError("oauth", "synthetic refresh failure b1-r06");
	const createMock = t.mock.method(ModelRuntime, "create", async () => {
		throw oauthFailure;
	});
	const access = bindPiProviderOAuthAccess("openai-codex");
	await assert.rejects(access.getAuth(), (error) => error === oauthFailure);
	assert.equal(oauthFailure.code, "oauth");
	const plainFailure = new Error("synthetic harness failure b1-r06");
	createMock.mock.mockImplementation(async () => {
		throw plainFailure;
	});
	await assert.rejects(access.getAuth(), (error) => error === plainFailure);
	assert.deepEqual(await readPiCredential("openai-codex"), planted);
});

test("b1-refresh valid stored oauth still resolves when the harness fails unexpectedly", async (t) => {
	// Existing fallback semantics, pinned explicitly: a non-ModelsError
	// harness failure plus a still-valid stored token resolves the token
	// instead of throwing. ModelsError rethrows immediately (see above).
	await writePiCredential("openai-codex", {
		type: "oauth",
		access: OLD_ACCESS,
		refresh: OLD_REFRESH,
		expires: Date.now() + 3600_000,
		accountId: OLD_ACCOUNT,
	});
	t.after(() => deletePiCredential("openai-codex"));
	t.mock.method(ModelRuntime, "create", async () => {
		throw new Error("synthetic harness failure b1-r04");
	});
	const access = bindPiProviderOAuthAccess("openai-codex");
	assert.deepEqual(await access.getAuth(), { accessToken: OLD_ACCESS, accountId: OLD_ACCOUNT });
});

test("b1-refresh expired oauth performs a real intercepted refresh with rotation persist", async (t) => {
	const rotatedAccess = syntheticCodexAccessToken(NEW_ACCOUNT);
	const peer = createRefreshPeer({
		kind: "rotate",
		accessToken: rotatedAccess,
		refreshToken: NEW_REFRESH,
		expiresIn: 3600,
	});
	installFetch(t, peer.fetch);
	await writePiCredential("openai-codex", expiredOauthEntry());
	t.after(() => deletePiCredential("openai-codex"));
	const access = bindPiProviderOAuthAccess("openai-codex");
	const windowStart = Date.now();
	const auth = await access.getAuth();
	assert.equal(auth.accessToken, rotatedAccess);
	assert.equal(
		auth.accountId,
		OLD_ACCOUNT,
		"documents the double-read boundary: accountId comes from the pre-refresh read",
	);
	assert.equal(peer.requests.length, 1);
	assert.equal(peer.requests[0].href, B1_CODEX_TOKEN_URL);
	assert.equal(peer.requests[0].method, "POST");
	assert.equal(peer.requests[0].headers["Content-Type"], "application/x-www-form-urlencoded");
	assert.equal(peer.requests[0].params.grant_type, "refresh_token");
	assert.equal(peer.requests[0].params.refresh_token, OLD_REFRESH);
	assert.ok(typeof peer.requests[0].params.client_id === "string" && peer.requests[0].params.client_id.length > 0);
	const stored = await readPiCredential("openai-codex");
	assert.equal(stored.type, "oauth");
	assert.equal(stored.access, rotatedAccess);
	assert.equal(stored.refresh, NEW_REFRESH);
	assert.equal(stored.accountId, NEW_ACCOUNT);
	assert.ok(stored.expires >= windowStart + 3600_000 && stored.expires <= Date.now() + 3600_000);
	assert.deepEqual(await access.getAuth(), { accessToken: rotatedAccess, accountId: NEW_ACCOUNT });
	assert.equal(peer.requests.length, 1, "the rotated credential is reused without a second refresh");
});

test("b1-refresh http failure propagates as oauth error and preserves the stored credential", async (t) => {
	const peer = createRefreshPeer({ kind: "http-error", status: 401, body: "invalid_grant (fixture)" });
	installFetch(t, peer.fetch);
	const planted = expiredOauthEntry();
	await writePiCredential("openai-codex", planted);
	t.after(() => deletePiCredential("openai-codex"));
	const access = bindPiProviderOAuthAccess("openai-codex");
	await assert.rejects(
		access.getAuth(),
		(error) => {
			// Structural identity: pi-coding-agent ships a nested pi-ai copy,
			// so instanceof against the test's ModelsError import is invalid
			// across that boundary; name+code are the documented identity.
			assert.equal(error?.name, "ModelsError");
			assert.equal(error?.code, "oauth");
			assert.ok(error.message.includes("OAuth refresh failed"));
			assert.ok(error.message.includes("401"));
			assert.ok(!error.message.includes(OLD_ACCESS));
			assert.ok(!error.message.includes(OLD_REFRESH));
			return true;
		},
	);
	assert.deepEqual(await readPiCredential("openai-codex"), planted);
	assert.equal(await access.isConfigured(), true);
	assert.equal(peer.requests.length, 1);
});

test("b1-refresh transport failure propagates and preserves the stored credential", async (t) => {
	const peer = createRefreshPeer({ kind: "transport-error", message: "fixture transport down" });
	installFetch(t, peer.fetch);
	const planted = expiredOauthEntry();
	await writePiCredential("openai-codex", planted);
	t.after(() => deletePiCredential("openai-codex"));
	const access = bindPiProviderOAuthAccess("openai-codex");
	await assert.rejects(
		access.getAuth(),
		(error) => {
			assert.equal(error?.name, "ModelsError");
			assert.equal(error?.code, "oauth");
			assert.ok(error.message.includes("fixture transport down"));
			assert.ok(!error.message.includes(OLD_ACCESS));
			assert.ok(!error.message.includes(OLD_REFRESH));
			return true;
		},
	);
	assert.deepEqual(await readPiCredential("openai-codex"), planted);
	assert.equal(await access.isConfigured(), true);
});

test("b1-refresh malformed payload propagates and preserves the stored credential", async (t) => {
	const peer = createRefreshPeer({ kind: "malformed", payload: { unexpected: true } });
	installFetch(t, peer.fetch);
	const planted = expiredOauthEntry();
	await writePiCredential("openai-codex", planted);
	t.after(() => deletePiCredential("openai-codex"));
	const access = bindPiProviderOAuthAccess("openai-codex");
	await assert.rejects(
		access.getAuth(),
		(error) => {
			assert.equal(error?.name, "ModelsError");
			assert.equal(error?.code, "oauth");
			assert.ok(error.message.includes("missing fields"));
			assert.ok(!error.message.includes(OLD_ACCESS));
			assert.ok(!error.message.includes(OLD_REFRESH));
			return true;
		},
	);
	assert.deepEqual(await readPiCredential("openai-codex"), planted);
});

test("b1-refresh api-key resolution performs no token-endpoint traffic", async (t) => {
	installFetch(t, async () => {
		throw new Error("api path must not fetch");
	});
	await writePiCredential("openai", { type: "api_key", key: API_KEY_FIXTURE });
	t.after(() => deletePiCredential("openai"));
	const access = bindPiProviderApiKeyAccess("openai");
	assert.equal(await access.getApiKey(), API_KEY_FIXTURE);
});

test("b1-refresh rotation persist failure surfaces as auth error, then heals on retry", async (t) => {
	// Proven boundary: a callback/modify error BEFORE the physical write,
	// after the real rotation was computed (the intercepted refresh ran and
	// returned). This is NOT a disk-failure/crash-atomicity proof: no
	// partial write, no torn file and no lock contention are exercised.
	// AuthStorage offers no fault-injection seam, so the real store object
	// that ModelRuntime.create receives is wrapped test-locally; the
	// original create runs and the bindings are never stubbed.
	const rotatedAccess = syntheticCodexAccessToken(NEW_ACCOUNT);
	const peer = createRefreshPeer({
		kind: "rotate",
		accessToken: rotatedAccess,
		refreshToken: NEW_REFRESH,
		expiresIn: 3600,
	});
	installFetch(t, peer.fetch);
	const planted = expiredOauthEntry();
	await writePiCredential("openai-codex", planted);
	t.after(() => deletePiCredential("openai-codex"));

	const modifyFailure = new Error("synthetic store modify failure b1-r2-store");
	const computedRotations = [];
	let failModify = true;
	const originalCreate = ModelRuntime.create;
	t.mock.method(ModelRuntime, "create", async (options) => {
		if (!failModify) return originalCreate.call(ModelRuntime, options);
		const realStore = options.credentials;
		const writeFailingStore = Object.create(
			Object.getPrototypeOf(realStore),
			Object.getOwnPropertyDescriptors(realStore),
		);
		writeFailingStore.modify = async (providerId, fn) => {
			const current = await realStore.read(providerId);
			const next = await fn(current);
			computedRotations.push(next);
			throw modifyFailure;
		};
		return originalCreate.call(ModelRuntime, { ...options, credentials: writeFailingStore });
	});

	const access = bindPiProviderOAuthAccess("openai-codex");
	await assert.rejects(
		access.getAuth(),
		(error) => {
			assert.equal(error?.name, "ModelsError");
			assert.equal(error?.code, "auth");
			assert.ok(error.message.includes("modify failed"));
			assert.ok(!error.message.includes(OLD_ACCESS));
			assert.ok(!error.message.includes(OLD_REFRESH));
			return true;
		},
	);
	assert.equal(peer.requests.length, 1, "the refresh ran before the persist boundary failed");
	assert.equal(computedRotations.length, 1);
	assert.equal(computedRotations[0]?.access, rotatedAccess);
	assert.deepEqual(await readPiCredential("openai-codex"), planted);
	assert.equal(await access.isConfigured(), true);

	failModify = false;
	const healed = await access.getAuth();
	assert.equal(healed.accessToken, rotatedAccess);
	assert.equal(peer.requests.length, 2, "retry performs a second real refresh");
	const stored = await readPiCredential("openai-codex");
	assert.equal(stored.access, rotatedAccess);
	assert.equal(stored.refresh, NEW_REFRESH);
	assert.equal(stored.accountId, NEW_ACCOUNT);
	assert.deepEqual(await access.getAuth(), { accessToken: rotatedAccess, accountId: NEW_ACCOUNT });
	assert.equal(peer.requests.length, 2, "the healed rotation is reused without further refresh");
});
