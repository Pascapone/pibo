import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Fixture precondition, not an RPC retry or a relaxation of queue/execution budgets. */
export async function waitForAsyncStorageReady(storage) {
	const started = performance.now();
	const budget = storage.status().writer.limits.startupTimeoutMs;
	let status;
	while (performance.now() - started < budget) {
		status = storage.status();
		assert.equal(status.closed, false, "fixture storage closed during startup");
		assert.equal(status.restarts.writer, 0, "fixture must not hide a worker restart");
		if (status.writer.ready && !status.writer.closed) return;
		await delay(10);
	}
	assert.fail(`Fixture storage did not become ready in its existing startup budget: ${JSON.stringify(status)}`);
}
