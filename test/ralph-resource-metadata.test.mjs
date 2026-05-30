import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboRalphStore } from "../dist/ralph/store.js";

function createJob(store, ownerScope = "user:a") {
	return store.createJob({ ownerScope, target: { kind: "personal", principalId: ownerScope }, profile: "codex", prompt: "work", enabled: true });
}

test("Ralph store persists app-global job and run resource metadata", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "work",
			enabled: true,
			resources: { workerId: " worker-1 ", browserLeaseIds: ["lease-a", "lease-a", " "], cleanupState: "active" },
		});
		assert.equal(job.ownerScope, "shared:app");
		assert.deepEqual(job.target, { kind: "personal", principalId: "shared:app" });
		assert.deepEqual(job.resources, { workerId: "worker-1", browserLeaseIds: ["lease-a"], cleanupState: "active" });

		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const updated = store.updateJobResources("user:a", job.id, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" }, new Date("2026-05-17T12:00:00.000Z"));
		assert.equal(updated.updatedAt, "2026-05-17T12:00:00.000Z");
		assert.deepEqual(updated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" });
		const crossAccountUpdate = store.updateJobResources("user:b", job.id, { workerId: "worker-cross" });
		assert.equal(crossAccountUpdate.resources.workerId, "worker-cross");
		store.updateJobResources("user:a", job.id, updated.resources);

		const reserved = store.reserveRun("user:a", job.id, new Date("2026-05-17T12:01:00.000Z"));
		assert.ok(reserved);
		assert.deepEqual(reserved.run.resources, updated.resources);

		const runUpdated = store.updateRunResources({ ownerScope: "user:a", runId: reserved.run.id, resources: { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" } }, new Date("2026-05-17T12:02:00.000Z"));
		assert.deepEqual(runUpdated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" });
		assert.equal(runUpdated.updatedAt, "2026-05-17T12:02:00.000Z");
		const crossRunUpdate = store.updateRunResources({ ownerScope: "user:b", runId: reserved.run.id, resources: { workerId: "worker-run-cross" } });
		assert.equal(crossRunUpdate.resources.workerId, "worker-run-cross");
		store.updateRunResources({ ownerScope: "user:a", runId: reserved.run.id, resources: runUpdated.resources });

		assert.deepEqual(store.listJobs({ ownerScope: "user:a", includeDisabled: true })[0].resources, updated.resources);
		assert.deepEqual(store.listRuns({ ownerScope: "user:a" })[0].resources, runUpdated.resources);
		assert.deepEqual(store.listJobs({ ownerScope: "user:b", includeDisabled: true }).map((item) => item.id), [job.id]);
		assert.deepEqual(store.listRuns({ ownerScope: "user:b" }).map((item) => item.id), [reserved.run.id]);
	} finally { store.close(); }
});

test("Ralph resource metadata remains compatible with older store rows", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-resource-"));
	const dbPath = join(dir, "ralph.sqlite");
	const db = new DatabaseSync(dbPath);
	try {
		const createdAt = "2026-05-17T10:00:00.000Z";
		db.exec(`CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_scope TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
		db.prepare("INSERT INTO pibo_ralph_jobs (id, owner_scope, name, description, enabled, target_json, profile, prompt, max_iterations, runtime_options_json, stop_policy_json, state_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)").run("ralph_old", "user:a", "old", 1, JSON.stringify({ kind: "personal", principalId: "user:a" }), "codex", "work", JSON.stringify({ completedIterations: 0 }), createdAt, createdAt);
		db.prepare("INSERT INTO pibo_ralph_runs (id, job_id, owner_scope, pibo_session_id, status, reason, error, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?)").run("rrun_old", "ralph_old", "user:a", "running", createdAt, createdAt, createdAt);
	} finally { db.close(); }

	const store = new PiboRalphStore({ path: dbPath });
	try {
		const oldJob = store.getJob("ralph_old");
		assert.ok(oldJob);
		assert.equal(oldJob.resources, undefined);
		assert.equal(store.listRuns({ ownerScope: "user:a" })[0].resources, undefined);

		const updatedJob = store.updateJobResources("user:b", "ralph_old", { workerId: "worker-old", cleanupState: "active" });
		const updatedRun = store.updateRunResources({ ownerScope: "user:b", runId: "rrun_old", resources: { browserLeaseIds: ["lease-old"], cleanupState: "released" } });
		assert.deepEqual(updatedJob.resources, { workerId: "worker-old", cleanupState: "active" });
		assert.deepEqual(updatedRun.resources, { browserLeaseIds: ["lease-old"], cleanupState: "released" });
	} finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Ralph resource metadata validation rejects unsupported values", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = createJob(store);
		assert.throws(() => store.updateJobResources("user:a", job.id, { cleanupState: "ignored" }), /cleanupState/);
		assert.throws(() => store.updateRunResources({ ownerScope: "user:a", runId: "rrun_missing", resources: { browserLeaseIds: "lease" } }), /browserLeaseIds/);
	} finally { store.close(); }
});
