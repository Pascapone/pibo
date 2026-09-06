import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writePiCredential, deletePiCredential } from "../dist/agent-runtimes/pi/credentials.js";
import { getOpenAiCodexProviderUsageForActiveModel as getUsage } from "../dist/auth/openai-codex-usage.js";

const model = { provider: "openai-codex" };
const payload = (used = 20) => ({ rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18000 } } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function fixture(t, run) {
	const root = await mkdtemp(join(tmpdir(), "pibo-usage-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const credential = (accountId = root) => ({ type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: Date.now() + 3600000, accountId });
	await writePiCredential(model.provider, credential());
	try { await run(credential); }
	finally {
		t.mock.restoreAll();
		t.mock.timers.reset();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
}

test("provider quota reuses a fresh snapshot and coalesces concurrent session status requests", async (t) => fixture(t, async () => {
	const pending = deferred();
	const started = deferred();
	const fetch = t.mock.method(globalThis, "fetch", async () => { started.resolve(); await pending.promise; return Response.json(payload()); });
	const first = getUsage(model);
	await started.promise;
	const second = getUsage(model);
	pending.resolve();
	const results = await Promise.all([first, second]);
	assert.deepEqual(results[0], results[1]);
	assert.deepEqual(await getUsage(model), results[0]);
	assert.equal(fetch.mock.callCount(), 1);
	assert.equal(results[0].limits[0].remainingPercent, 80);
}));

test("stale quota returns immediately while one refresh updates its fetchedAt", async (t) => fixture(t, async () => {
	const now = Date.now();
	t.mock.timers.enable({ apis: ["Date"], now });
	const pending = deferred();
	const started = deferred();
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => {
		if (++calls === 1) return Response.json(payload());
		started.resolve(); await pending.promise;
		return Response.json(payload(30));
	});
	const first = await getUsage(model);
	t.mock.timers.tick(31000);
	const stale = await Promise.race([getUsage(model), new Promise((_, reject) => setTimeout(() => reject(Error("status waited for quota refresh")), 500).unref())]);
	assert.deepEqual(stale, first);
	await started.promise;
	assert.deepEqual(await getUsage(model), first);
	pending.resolve();
	let refreshed;
	for (let i = 0; i < 50; i++) {
		refreshed = await getUsage(model);
		if (refreshed?.limits[0].usedPercent === 30) break;
		await new Promise((r) => setTimeout(r, 5));
	}
	assert.equal(refreshed.limits[0].usedPercent, 30);
	assert.notEqual(refreshed.fetchedAt, first.fetchedAt);
	assert.equal(calls, 2);
}));

test("quota caches are invalidated by credential replacement and logout", async (t) => fixture(t, async (credential) => {
	const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(payload()));
	await getUsage(model);
	await writePiCredential(model.provider, credential("different-account"));
	await getUsage(model);
	assert.equal(fetch.mock.callCount(), 2);
	await deletePiCredential(model.provider);
	assert.equal(await getUsage(model), undefined);
	assert.equal(await getUsage({ provider: "other" }), undefined);
	assert.equal(fetch.mock.callCount(), 2);
}));

test("failed quota refresh preserves bounded stale data and backs off", async (t) => fixture(t, async () => {
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => {
		if (++calls === 1) return Response.json(payload());
		throw Error("quota unavailable");
	});
	const first = await getUsage(model);
	t.mock.timers.tick(31000);
	assert.deepEqual(await getUsage(model), first);
	await new Promise((r) => setTimeout(r, 30));
	assert.deepEqual(await getUsage(model), first);
	assert.equal(calls, 2);
	t.mock.timers.tick(300000);
	assert.equal(await getUsage(model), undefined, "do not present indefinitely stale quota");
	assert.equal(await getUsage(model), undefined);
	assert.equal(calls, 3);
}));

test("quota requests time out and failed cold requests do not stampede", async (t) => fixture(t, async () => {
	const fetch = t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
		assert.ok(signal, "external quota fetch must have an abort deadline");
		return await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
	});
	const keepAlive = setInterval(() => {}, 100);
	try {
		const start = performance.now();
		assert.equal(await getUsage(model), undefined);
		assert.ok(performance.now() - start < 3000);
		assert.equal(await getUsage(model), undefined);
		assert.equal(fetch.mock.callCount(), 1);
	} finally { clearInterval(keepAlive); }
}));
