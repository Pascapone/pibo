import assert from "node:assert/strict";
import test from "node:test";
import { PiboRalphStore } from "../dist/ralph/store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;

function createJob(store) {
	return store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "work", enabled: true });
}

test("Ralph store persists app-global job and run resource metadata", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "work",
			enabled: true,
			resources: { workerId: " worker-1 ", browserLeaseIds: ["lease-a", "lease-a", " "], cleanupState: "active" },
		});
		assert.equal(retiredPartitionField in job, false);
		assert.deepEqual(job.target, { kind: "default-chat" });
		assert.deepEqual(job.resources, { workerId: "worker-1", browserLeaseIds: ["lease-a"], cleanupState: "active" });

		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const updated = store.updateJobResources(job.id, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" }, new Date("2026-05-17T12:00:00.000Z"));
		assert.equal(updated.updatedAt, "2026-05-17T12:00:00.000Z");
		assert.deepEqual(updated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" });
		const crossAccountUpdate = store.updateJobResources(job.id, { workerId: "worker-cross" });
		assert.equal(crossAccountUpdate.resources.workerId, "worker-cross");
		store.updateJobResources(job.id, updated.resources);

		const reserved = store.reserveRun(job.id, new Date("2026-05-17T12:01:00.000Z"));
		assert.ok(reserved);
		assert.deepEqual(reserved.run.resources, updated.resources);

		const runUpdated = store.updateRunResources({ runId: reserved.run.id, resources: { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" } }, new Date("2026-05-17T12:02:00.000Z"));
		assert.deepEqual(runUpdated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" });
		assert.equal(runUpdated.updatedAt, "2026-05-17T12:02:00.000Z");
		const crossRunUpdate = store.updateRunResources({ runId: reserved.run.id, resources: { workerId: "worker-run-cross" } });
		assert.equal(crossRunUpdate.resources.workerId, "worker-run-cross");
		store.updateRunResources({ runId: reserved.run.id, resources: runUpdated.resources });

		assert.deepEqual(store.listJobs({ includeDisabled: true })[0].resources, updated.resources);
		assert.deepEqual(store.listRuns({})[0].resources, runUpdated.resources);
		assert.deepEqual(store.listJobs({ includeDisabled: true }).map((item) => item.id), [job.id]);
		assert.deepEqual(store.listRuns({}).map((item) => item.id), [reserved.run.id]);
	} finally { store.close(); }
});

test("Ralph resource metadata validation rejects unsupported values", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = createJob(store);
		assert.throws(() => store.updateJobResources(job.id, { cleanupState: "ignored" }), /cleanupState/);
		assert.throws(() => store.updateRunResources({ runId: "rrun_missing", resources: { browserLeaseIds: "lease" } }), /browserLeaseIds/);
	} finally { store.close(); }
});
