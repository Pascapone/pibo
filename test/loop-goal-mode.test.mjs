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

test("Goal accounting excludes cached usage reported after update_goal completes the active run", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-completion-usage-"));
	const store = new PiboLoopStore({ path: ":memory:" });
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
		assert.equal(saved?.state.tokensUsed, 7);
		assert.equal(store.listRuns({ jobId: job.id })[0]?.accounting?.tokensUsed, 7);
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
						listener({ type: "assistant_usage", piboSessionId: event.piboSessionId, eventId: event.id, totalTokens: 50 });
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
