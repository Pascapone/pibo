import assert from "node:assert/strict";
import test from "node:test";
import { SettledTtlCache } from "../dist/agent-runtime/settled-ttl-cache.js";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

test("resolved TTL starts at completion and a slow or hanging load remains deduplicated", async () => {
	let now = 1_000;
	let calls = 0;
	const first = deferred();
	const cache = new SettledTtlCache(5_000, () => now);
	const load = () => {
		calls += 1;
		return first.promise;
	};
	const pending = cache.load(load);
	await Promise.resolve();
	now = 11_000;
	assert.equal(cache.load(load), pending, "a load exceeding the TTL window still has one owner");
	assert.equal(calls, 1);
	first.resolve({ id: "catalog" });
	assert.deepEqual(await pending, { id: "catalog" });
	await Promise.resolve();
	assert.deepEqual(cache.peek(), { id: "catalog" }, "successful data remains fresh after a slow discovery completes");
	now = 15_999;
	assert.deepEqual(cache.peek(), { id: "catalog" });
	now = 16_000;
	assert.equal(cache.peek(), undefined, "the settled result expires five seconds after completion");
});

test("failed loads release the single-flight owner for a later bounded retry", async () => {
	let calls = 0;
	const cache = new SettledTtlCache(5_000, () => 0);
	await assert.rejects(cache.load(async () => { calls += 1; throw new Error("failed"); }), /failed/);
	assert.equal(await cache.load(async () => { calls += 1; return "recovered"; }), "recovered");
	assert.equal(calls, 2);
});
