import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveStoredOAuthAuthResult, PiboFileCredentialStore } from "../dist/agent-runtimes/pi/credentials.js";

async function tempStore(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-pi-credentials-"));
	t.after(async () => {
		const { rm } = await import("node:fs/promises");
		await rm(root, { recursive: true, force: true });
	});
	return new PiboFileCredentialStore(join(root, "agent", "auth.json"));
}

test("Pi file credential store round-trips credentials with private file mode", async (t) => {
	const store = await tempStore(t);
	assert.equal(await store.read("openai-codex"), undefined);
	assert.deepEqual(await store.list(), []);
	const written = await store.modify("openai-codex", async () => ({ type: "oauth", access: "a", refresh: "r", expires: 1 }));
	assert.equal(written?.type, "oauth");
	assert.equal((await store.read("openai-codex"))?.type, "oauth");
	assert.deepEqual(await store.list(), [{ providerId: "openai-codex", type: "oauth" }]);
	const mode = (await stat(store.authPath)).mode & 0o777;
	assert.equal(mode, 0o600);
	// modify returning undefined is a no-op returning the current value.
	const kept = await store.modify("openai-codex", async () => undefined);
	assert.equal(kept?.type, "oauth");
	await store.delete("openai-codex");
	assert.equal(await store.read("openai-codex"), undefined);
	const raw = JSON.parse(await readFile(store.authPath, "utf8"));
	assert.deepEqual(raw, {});
});

test("Pi file credential store resolves api_key env templates without shell execution", async (t) => {
	const store = await tempStore(t);
	process.env.PIBO_TEST_PI_KEY = "live-key";
	t.after(() => {
		delete process.env.PIBO_TEST_PI_KEY;
	});
	await store.modify("openai-api", async () => ({ type: "api_key", key: "prefix-${PIBO_TEST_PI_KEY}-$$-suffix" }));
	assert.equal((await store.read("openai-api"))?.key, "prefix-live-key-$-suffix");
	await store.modify("openai-api", async () => ({ type: "api_key", key: "!touch /tmp/pibo-pi-command-marker" }));
	assert.equal((await store.read("openai-api"))?.key, "!touch /tmp/pibo-pi-command-marker");
	const { access } = await import("node:fs/promises");
	await assert.rejects(() => access("/tmp/pibo-pi-command-marker"));
});

test("Pi OAuth fallback derives request auth from a still-valid stored token", () => {
	assert.deepEqual(
		deriveStoredOAuthAuthResult({ type: "oauth", access: "live-access", refresh: "r", expires: Date.now() + 3600_000 }),
		{ auth: { apiKey: "live-access" }, source: "OAuth" },
	);
	// Missing expiry behaves like pi: no refresh is due, derive directly.
	assert.deepEqual(
		deriveStoredOAuthAuthResult({ type: "oauth", access: "live-access", refresh: "r" }),
		{ auth: { apiKey: "live-access" }, source: "OAuth" },
	);
	// Expired or nearly-expired tokens must go through the real refresh flow.
	assert.equal(
		deriveStoredOAuthAuthResult({ type: "oauth", access: "stale-access", refresh: "r", expires: Date.now() - 1000 }),
		undefined,
	);
	assert.equal(
		deriveStoredOAuthAuthResult({ type: "oauth", access: "soon-access", refresh: "r", expires: Date.now() + 60_000 }),
		undefined,
	);
	assert.equal(deriveStoredOAuthAuthResult({ type: "api_key", key: "k" }), undefined);
	assert.equal(deriveStoredOAuthAuthResult(undefined), undefined);
});
