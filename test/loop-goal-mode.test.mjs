import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createBuiltInLoopStopConditions } from "../dist/loops/stopping.js";
import { createPiboSession } from "../dist/sessions/store.js";

test("new loops default to goal while legacy rows load as ralph", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-migration-"));
	const path = join(dir, "loops.sqlite");
	const db = new DatabaseSync(path);
	db.exec(`CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, resource_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, resource_json TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE pibo_ralph_run_facts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, run_id TEXT, pibo_session_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
	const now = new Date().toISOString();
	db.prepare("INSERT INTO pibo_ralph_jobs (id, name, enabled, target_json, profile, prompt, state_json, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)").run("ralph_legacy", "Legacy", JSON.stringify({ kind: "default-chat" }), "base", "legacy task", JSON.stringify({ completedIterations: 0 }), now, now);
	db.close();

	const store = new PiboLoopStore({ path });
	try {
		assert.equal(store.getJob("ralph_legacy")?.mode, "ralph");
		const created = store.createJob({ target: { kind: "default-chat" }, profile: "base", prompt: "new objective" });
		assert.equal(created.mode, "goal");
		assert.match(created.id, /^loop_/);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("legacy Goal counters remain total and new runs inherit the legacy basis", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-legacy-accounting-"));
	const path = join(dir, "loops.sqlite");
	const seededStore = new PiboLoopStore({ path });
	const seededJob = seededStore.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Continue legacy accounting.", maxIterations: 2, tokenBudget: 100 });
	const seededRun = seededStore.reserveRun(seededJob.id);
	assert.ok(seededRun);
	seededStore.recordGoalTurnUsage(seededJob.id, seededRun.run.id, 10);
	seededStore.completeRun({ jobId: seededJob.id, runId: seededRun.run.id, status: "ok", goalStatus: "active", stopAfterRun: true });
	seededStore.close();

	const db = new DatabaseSync(path);
	const stateRow = db.prepare("SELECT state_json FROM pibo_ralph_jobs WHERE id = ?").get(seededJob.id);
	const legacyState = JSON.parse(stateRow.state_json);
	delete legacyState.tokenAccounting;
	legacyState.goalStatus = "paused";
	db.prepare("UPDATE pibo_ralph_jobs SET enabled = 0, state_json = ? WHERE id = ?").run(JSON.stringify(legacyState), seededJob.id);
	const accountingRow = db.prepare("SELECT accounting_json FROM pibo_ralph_runs WHERE id = ?").get(seededRun.run.id);
	const legacyRunAccounting = JSON.parse(accountingRow.accounting_json);
	delete legacyRunAccounting.tokenAccounting;
	db.prepare("UPDATE pibo_ralph_runs SET accounting_json = ? WHERE id = ?").run(JSON.stringify(legacyRunAccounting), seededRun.run.id);
	db.close();

	const store = new PiboLoopStore({ path });
	assert.deepEqual(store.getJob(seededJob.id)?.state.tokenAccounting, { version: 1, basis: "total" });
	assert.equal(store.getJob(seededJob.id)?.state.tokensUsed, 10);
	assert.deepEqual(store.getRun(seededRun.run.id)?.accounting?.tokenAccounting, { version: 1, basis: "total" });
	assert.equal(store.getRun(seededRun.run.id)?.accounting?.tokensUsed, 10);

	const listeners = new Set();
	const sessions = new Map();
	let prompt = "";
	const context = {
		async emit(event) {
			if (event.type === "message") {
				prompt = event.text;
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, inputTokens: 12, outputTokens: 8, cacheReadTokens: 3, cacheWriteTokens: 2, totalTokens: 25 });
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "legacy progress" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { const session = createPiboSession({ ...input, id: "ps_legacy_accounting" }); sessions.set(session.id, session); return session; },
		getSession(id) { return sessions.get(id); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
	let service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 10, runTimeoutMs: 5_000 });
	try {
		service.start();
		const run = await service.startJob(seededJob.id);
		assert.ok(run);
		assert.deepEqual(run.accounting?.tokenAccounting, { version: 1, basis: "total" });
		await waitFor(() => store.getJob(seededJob.id)?.state.completedIterations === 2);
		const saved = store.getJob(seededJob.id);
		const latestRun = store.listRuns({ jobId: seededJob.id })[0];
		assert.equal(saved?.state.tokensUsed, 35);
		assert.deepEqual(saved?.state.tokenAccounting, { version: 1, basis: "total" });
		assert.equal(latestRun.accounting?.tokensUsed, 25);
		assert.deepEqual(latestRun.accounting?.tokenAccounting, { version: 1, basis: "total" });
		assert.match(prompt, /Accounting basis: total tokens \(version 1\)/);
		assert.match(prompt, /Legacy compatibility: cache-read and cache-write tokens remain included/);
		service.stop();
		service = undefined;
		const reloaded = new PiboLoopStore({ path });
		try {
			assert.equal(reloaded.getJob(seededJob.id)?.state.tokensUsed, 35);
			assert.deepEqual(reloaded.getJob(seededJob.id)?.state.tokenAccounting, { version: 1, basis: "total" });
			assert.deepEqual(reloaded.listRuns({ jobId: seededJob.id })[0]?.accounting?.tokenAccounting, { version: 1, basis: "total" });
		} finally {
			reloaded.close();
		}
	} finally {
		service?.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Goal accounting sums and persists uncached usage reported after update_goal completes the active run", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-completion-usage-"));
	const path = join(dir, "loops.sqlite");
	const store = new PiboLoopStore({ path });
	const listeners = new Set();
	const sessions = new Map();
	let jobId;
	const context = {
		async emit(event) {
			if (event.type === "message") {
				queueMicrotask(() => {
					store.updateGoalStatus(jobId, "complete");
					for (const listener of listeners) {
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, inputTokens: 4, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2, totalTokens: 14 });
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, inputTokens: 2, outputTokens: 1, cacheReadTokens: 4, cacheWriteTokens: 1, totalTokens: 8 });
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "done" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { const session = createPiboSession({ ...input, id: "ps_completion_usage" }); sessions.set(session.id, session); return session; },
		getSession(id) { return sessions.get(id); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 10, runTimeoutMs: 5_000 });
	try {
		service.start();
		const job = store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Complete this goal." });
		jobId = job.id;
		assert.ok(await service.startJob(job.id));
		await waitFor(() => store.getJob(job.id)?.state.completedIterations === 1);
		const saved = store.getJob(job.id);
		assert.equal(saved?.state.goalStatus, "complete");
		assert.deepEqual(saved?.state.tokenAccounting, { version: 1, basis: "uncached" });
		assert.equal(saved?.state.tokensUsed, 10);
		assert.deepEqual(store.listRuns({ jobId: job.id })[0]?.accounting?.tokenAccounting, { version: 1, basis: "uncached" });
		assert.equal(store.listRuns({ jobId: job.id })[0]?.accounting?.tokensUsed, 10);
		const reloaded = new PiboLoopStore({ path });
		try {
			assert.equal(reloaded.getJob(job.id)?.state.tokensUsed, 10);
			assert.deepEqual(reloaded.getJob(job.id)?.state.tokenAccounting, { version: 1, basis: "uncached" });
			assert.equal(reloaded.listRuns({ jobId: job.id })[0]?.accounting?.tokensUsed, 10);
			assert.deepEqual(reloaded.listRuns({ jobId: job.id })[0]?.accounting?.tokenAccounting, { version: 1, basis: "uncached" });
		} finally {
			reloaded.close();
		}
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Goal records a final turn that exceeds remaining soft budget", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-budget-overshoot-"));
	const store = new PiboLoopStore({ path: ":memory:" });
	const listeners = new Set();
	const sessions = new Map();
	let prompt = "";
	const context = {
		async emit(event) {
			if (event.type === "message") {
				prompt = event.text;
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, inputTokens: 40, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 4, totalTokens: 59 });
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "final progress" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { const session = createPiboSession({ ...input, id: "ps_budget_overshoot" }); sessions.set(session.id, session); return session; },
		getSession(id) { return sessions.get(id); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 10, runTimeoutMs: 5_000 });
	try {
		service.start();
		const job = store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "Use the final allowed turn.", tokenBudget: 100, tokenReserve: 10 });
		store.recordGoalProgress(job.id, { tokens: 80 });
		const run = await service.startJob(job.id);
		assert.ok(run);
		await waitFor(() => store.getJob(job.id)?.state.completedIterations === 1);
		const saved = store.getJob(job.id);
		const completedRun = store.listRuns({ jobId: job.id })[0];
		assert.equal(saved.state.goalStatus, "budget_limited");
		assert.equal(saved.state.tokensUsed, 130);
		assert.equal(saved.enabled, false);
		assert.match(prompt, /Reported uncached tokens remaining before this turn: 20/);
		assert.deepEqual(completedRun.accounting.tokenAccounting, { version: 1, basis: "uncached" });
		assert.equal(completedRun.accounting.tokensUsedBefore, 80);
		assert.equal(completedRun.accounting.remainingTokensBefore, 20);
		assert.equal(completedRun.accounting.tokensUsed, 50);
		assert.equal(completedRun.accounting.overshootTokens, 30);
		assert.equal(typeof completedRun.accounting.activeTimeSeconds, "number");
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("goal mode reuses one Pibo Session while Ralph mode creates fresh sessions", async () => {
	const goal = await runTwoIterations("goal");
	assert.equal(goal.createdSessionIds.length, 1);
	assert.equal(new Set(goal.runSessionIds).size, 1);
	assert.match(goal.prompts[0], /Start working toward the active Pibo loop goal/);
	assert.match(goal.prompts[1], /Continue working toward the active Pibo loop goal/);
	assert.match(goal.prompts[1], /Completion audit:/);
	assert.equal(goal.tokensUsed, 20);

	const ralph = await runTwoIterations("ralph");
	assert.equal(ralph.createdSessionIds.length, 2);
	assert.equal(new Set(ralph.runSessionIds).size, 2);
	assert.match(ralph.prompts[0], /legacy Pibo Ralph loop/);
});

async function runTwoIterations(mode) {
	const dir = await mkdtemp(join(tmpdir(), `pibo-loop-${mode}-`));
	const store = new PiboLoopStore({ path: ":memory:" });
	const listeners = new Set();
	const sessions = new Map();
	const createdSessionIds = [];
	const prompts = [];
	const context = {
		async emit(event) {
			if (event.type === "message") {
				prompts.push(event.text);
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, totalTokens: 10 });
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: `progress ${prompts.length}` });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) {
			const id = `ps_${mode}_${createdSessionIds.length + 1}`;
			const session = createPiboSession({ ...input, id });
			sessions.set(id, session);
			createdSessionIds.push(id);
			return session;
		},
		getSession(id) { return sessions.get(id); },
		updateSession(id, patch) { const current = sessions.get(id); if (!current) return undefined; const next = { ...current, ...patch, metadata: patch.metadata ?? current.metadata }; sessions.set(id, next); return next; },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return createBuiltInLoopStopConditions(); },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 10, runTimeoutMs: 5_000 });
	try {
		service.start();
		const job = store.createJob({ mode, target: { kind: "default-chat" }, profile: "base", prompt: "Deliver the complete requested result.", maxIterations: 2 });
		const firstRun = await service.startJob(job.id);
		assert.ok(firstRun);
		await waitFor(() => store.getJob(job.id)?.state.completedIterations === 2);
		const saved = store.getJob(job.id);
		assert.equal(saved?.enabled, false);
		const runSessionIds = store.listRuns({ jobId: job.id }).map((run) => run.piboSessionId);
		return { createdSessionIds, prompts, runSessionIds, tokensUsed: saved?.state.tokensUsed ?? 0 };
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
}

async function waitFor(predicate, timeoutMs = 2_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for loop iterations");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
