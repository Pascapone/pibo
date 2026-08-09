import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboLoopStore } from "../dist/loops/store.js";

function createJob(store, name) {
	return store.createJob({ mode: "goal", enabled: true, name, target: { kind: "default-chat" }, profile: "base", prompt: name });
}

test("remove atomically deletes completed and cancelled jobs with all runs and facts", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		for (const [name, status] of [["completed", "ok"], ["cancelled", "cancelled"]]) {
			const job = createJob(store, name);
			const run = store.reserveRun(job.id).run;
			store.appendRunFact({ jobId: job.id, runId: run.id, type: "proof", source: "pibo", payload: { name } });
			store.completeRun({ jobId: job.id, runId: run.id, status, reason: status });
			assert.equal(store.removeJob(job.id), true);
			assert.equal(store.getJob(job.id), undefined);
			assert.deepEqual(store.listRuns({ jobId: job.id }), []);
			assert.deepEqual(store.listRunFacts({ jobId: job.id }), []);
		}
	} finally {
		store.close();
	}
});

test("remove rejects a running job without deleting any parent or child record", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const job = createJob(store, "running");
		const run = store.reserveRun(job.id).run;
		store.appendRunFact({ jobId: job.id, runId: run.id, type: "proof", source: "pibo", payload: {} });
		assert.throws(() => store.removeJob(job.id), /cancel it before removal/);
		assert.ok(store.getJob(job.id));
		assert.equal(store.listRuns({ jobId: job.id }).length, 1);
		assert.equal(store.listRunFacts({ jobId: job.id }).length, 1);
	} finally {
		store.close();
	}
});

test("opening an existing database repairs orphan runs and facts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-orphan-repair-"));
	const path = join(dir, "loops.sqlite");
	const db = new DatabaseSync(path);
	const now = new Date().toISOString();
	db.exec(`CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, resource_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, resource_json TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE pibo_ralph_run_facts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, run_id TEXT, pibo_session_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
	db.prepare("INSERT INTO pibo_ralph_runs (id, job_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("lrun_orphan", "loop_missing", "cancelled", now, now);
	db.prepare("INSERT INTO pibo_ralph_run_facts (id, job_id, run_id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("fact_orphan", "loop_missing", "lrun_orphan", "proof", "pibo", "{}", now);
	db.close();

	const store = new PiboLoopStore({ path });
	try {
		assert.deepEqual(store.listRuns({ jobId: "loop_missing" }), []);
		assert.deepEqual(store.listRunFacts({ jobId: "loop_missing" }), []);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("fresh Loop schema declares cascading parent foreign keys", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-cascade-schema-"));
	const path = join(dir, "loops.sqlite");
	const store = new PiboLoopStore({ path });
	store.close();
	const db = new DatabaseSync(path);
	try {
		const runFk = db.prepare("PRAGMA foreign_key_list(pibo_ralph_runs)").all();
		const factFk = db.prepare("PRAGMA foreign_key_list(pibo_ralph_run_facts)").all();
		assert.equal(runFk.some((row) => row.table === "pibo_ralph_jobs" && row.on_delete === "CASCADE"), true);
		assert.equal(factFk.some((row) => row.table === "pibo_ralph_jobs" && row.on_delete === "CASCADE"), true);
	} finally {
		db.close();
		await rm(dir, { recursive: true, force: true });
	}
});
