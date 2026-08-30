import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { createPiboSession } from "../dist/sessions/store.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const piboBin = join(projectRoot, "dist", "bin", "pibo.js");
const customStopPolicy = { mode: "any", conditions: [{ id: "promise", type: "pibo.ralph.promise-complete" }] };

function createLoopJob(store, input = {}) {
	return store.createJob({
		mode: "ralph",
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Continue until complete.",
		...input,
	});
}

function createRuntimeContext(counters = { sessions: 0, messages: 0 }) {
	const listeners = new Set();
	const sessions = new Map();
	return {
		counters,
		async emit(event) {
			if (event.type === "message") {
				counters.messages += 1;
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "still working" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) {
			counters.sessions += 1;
			const session = createPiboSession({ ...input, id: `ps_max_iterations_${counters.sessions}` });
			sessions.set(session.id, session);
			return session;
		},
		getSession(id) { return sessions.get(id); },
		listSessions() { return [...sessions.values()]; },
		findSessions() { return [...sessions.values()]; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
}

function complete(store, jobId, reserved, now = new Date("2026-08-30T10:00:01.000Z")) {
	store.completeRun({ jobId, runId: reserved.run.id, status: "completed" }, now);
}

function startWithCli(storePath, jobId) {
	const result = spawnSync(process.execPath, [piboBin, "ralph", "--store", storePath, "start", jobId, "--json"], {
		cwd: projectRoot,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function runAutomaticStartup({ dir, storePath, jobId, cycle, context }) {
	const store = new PiboLoopStore({ path: storePath });
	const service = new PiboLoopService({
		store,
		context,
		dataStorePath: join(dir, `data-${cycle}.sqlite`),
		dataPayloadRootDir: join(dir, `payloads-${cycle}`),
		intervalMs: 60_000,
		runTimeoutMs: 5_000,
	});
	service.start();
	try {
		await new Promise((resolve) => setTimeout(resolve, 400));
		return { job: store.getJob(jobId), runs: store.listRuns({ jobId }) };
	} finally {
		await service.stop();
	}
}

test("maxIterations validates zero while one and higher limits retain their exact admission boundaries", async () => {
	for (const Store of [PiboLoopStore, PiboRalphStore]) {
		const store = new Store({ path: ":memory:" });
		try {
			assert.throws(() => store.createJob({ target: { kind: "default-chat" }, profile: "base", prompt: "invalid", maxIterations: 0 }), /positive integer/);
		} finally {
			store.close();
		}
	}

	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-max-boundary-"));
	const storePath = join(dir, "loops.sqlite");
	try {
		let store = new PiboLoopStore({ path: storePath });
		const bounded = createLoopJob(store, { enabled: true, maxIterations: 2, stopPolicy: customStopPolicy });
		const first = store.reserveRun(bounded.id, new Date("2026-08-30T10:00:00.000Z"));
		assert.ok(first);
		complete(store, bounded.id, first);
		assert.equal(store.getJob(bounded.id).state.completedIterations, 1);
		assert.equal(store.getJob(bounded.id).enabled, true);
		store.close();

		store = new PiboLoopStore({ path: storePath });
		const second = store.reserveRun(bounded.id, new Date("2026-08-30T10:01:00.000Z"));
		assert.ok(second);
		complete(store, bounded.id, second, new Date("2026-08-30T10:01:01.000Z"));
		assert.equal(store.getJob(bounded.id).state.completedIterations, 2);
		store.close();

		store = new PiboLoopStore({ path: storePath });
		const overLimit = store.reserveRun(bounded.id, new Date("2026-08-30T10:02:00.000Z"));
		assert.equal(overLimit, undefined);
		assert.equal(store.getJob(bounded.id).enabled, false);
		assert.equal(store.listRuns({ jobId: bounded.id }).length, 2);

		const unbounded = createLoopJob(store, { enabled: true, stopPolicy: customStopPolicy });
		const unboundedFirst = store.reserveRun(unbounded.id);
		assert.ok(unboundedFirst);
		complete(store, unbounded.id, unboundedFirst);
		assert.ok(store.reserveRun(unbounded.id));
		store.close();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("legacy Ralph admission enforces a custom-policy limit after SQLite reopen", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-max-reopen-"));
	const storePath = join(dir, "ralph.sqlite");
	try {
		let store = new PiboRalphStore({ path: storePath });
		const job = store.createJob({ enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "work", maxIterations: 1, stopPolicy: customStopPolicy });
		const first = store.reserveRun(job.id);
		assert.ok(first);
		complete(store, job.id, first);
		store.updateJob(job.id, { enabled: true });
		store.close();

		store = new PiboRalphStore({ path: storePath });
		assert.deepEqual(store.reserveDueRuns(1), []);
		assert.equal(store.getJob(job.id).enabled, false);
		assert.equal(store.getJob(job.id).state.completedIterations, 1);
		assert.equal(store.listRuns({ jobId: job.id }).length, 1);
		store.close();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("manual start cannot admit an already-reached custom-policy Ralph job", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-max-manual-"));
	const store = new PiboLoopStore({ path: join(dir, "loops.sqlite") });
	const context = createRuntimeContext();
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), runTimeoutMs: 5_000 });
	service.start();
	try {
		const job = createLoopJob(store, { enabled: true, maxIterations: 1, stopPolicy: customStopPolicy });
		const first = store.reserveRun(job.id);
		assert.ok(first);
		complete(store, job.id, first);
		const run = await service.startJob(job.id);
		if (run) await waitFor(() => store.getJob(job.id).state.completedIterations > 1);
		assert.equal(run, undefined);
		assert.equal(context.counters.messages, 0);
		assert.equal(store.getJob(job.id).enabled, false);
		assert.equal(store.getJob(job.id).state.completedIterations, 1);
	} finally {
		await service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("default max-iterations policy remains the before-run control", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-max-default-"));
	const store = new PiboLoopStore({ path: join(dir, "loops.sqlite") });
	const context = createRuntimeContext();
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads") });
	service.start();
	try {
		const job = createLoopJob(store, { enabled: true, maxIterations: 1 });
		const first = store.reserveRun(job.id);
		assert.ok(first);
		complete(store, job.id, first);
		const run = await service.startJob(job.id);
		assert.equal(run, undefined);
		assert.equal(context.counters.messages, 0);
		assert.equal(store.getJob(job.id).enabled, false);
		assert.equal(store.getJob(job.id).state.lastStopEvaluation.reason, "max-iterations");
	} finally {
		await service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI starts and automatic service restarts cannot exceed a persisted custom-policy cap", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-max-auto-"));
	const storePath = join(dir, "loops.sqlite");
	const context = createRuntimeContext();
	try {
		let store = new PiboLoopStore({ path: storePath });
		const job = createLoopJob(store, { enabled: true, maxIterations: 1, stopPolicy: customStopPolicy });
		const first = store.reserveRun(job.id);
		assert.ok(first);
		complete(store, job.id, first);
		store.close();

		for (const cycle of [1, 2]) {
			startWithCli(storePath, job.id);
			const snapshot = await runAutomaticStartup({ dir, storePath, jobId: job.id, cycle, context });
			assert.equal(snapshot.job.enabled, false);
			assert.equal(snapshot.job.state.completedIterations, 1);
			assert.equal(snapshot.runs.length, 1);
		}
		assert.deepEqual(context.counters, { sessions: 0, messages: 0 });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
