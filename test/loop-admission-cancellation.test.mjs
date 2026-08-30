import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createPiboSession } from "../dist/sessions/store.js";

for (const mode of ["goal", "ralph"]) {
	test(`${mode} cancellation during before-run evaluation remains authoritative after restart`, async () => {
		const harness = await createHarness(mode);
		let serviceStopped = false;
		try {
			const pendingStart = harness.service.startJob(harness.job.id);
			await harness.waitForEvaluations(1);

			const cancelled = await harness.service.cancelJob(harness.job.id);
			assert.equal(cancelled.enabled, false);
			assert.equal(Boolean(cancelled.state.cancelRequestedAt), true);
			if (mode === "goal") assert.equal(cancelled.state.goalStatus, "paused");

			harness.releaseEvaluation();
			const run = await pendingStart;
			if (run) {
				await waitFor(() => harness.messages.length === 1);
				harness.finishMessage(harness.messages[0], "unexpected stale admission");
				await waitFor(() => harness.store.getRun(run.id)?.status !== "running");
			}

			const beforeRestart = harness.store.getJob(harness.job.id);
			const runCount = harness.store.listRuns({ jobId: harness.job.id }).length;
			harness.service.stop();
			serviceStopped = true;

			const reopened = new PiboLoopStore({ path: harness.storePath });
			try {
				const persisted = reopened.getJob(harness.job.id);
				assert.equal(run, undefined);
				assert.equal(harness.messages.length, 0);
				assert.equal(runCount, 0);
				assert.equal(beforeRestart.enabled, false);
				assert.equal(Boolean(beforeRestart.state.cancelRequestedAt), true);
				assert.equal(persisted.enabled, false);
				assert.equal(Boolean(persisted.state.cancelRequestedAt), true);
				if (mode === "goal") assert.equal(persisted.state.goalStatus, "paused");
			} finally {
				reopened.close();
			}
		} finally {
			harness.releaseEvaluation();
			if (!serviceStopped) harness.service.stop();
			await harness.cleanup();
		}
	});
}

test("cancellation before scheduler evaluation suppresses evaluation and provider emission", async () => {
	const harness = await createHarness("goal", { enabled: true });
	try {
		await harness.service.cancelJob(harness.job.id);
		harness.service.start();
		await new Promise((resolve) => setTimeout(resolve, 350));

		const saved = harness.store.getJob(harness.job.id);
		assert.equal(harness.evaluations, 0);
		assert.equal(harness.messages.length, 0);
		assert.equal(harness.store.listRuns({ jobId: harness.job.id }).length, 0);
		assert.equal(saved.enabled, false);
		assert.equal(Boolean(saved.state.cancelRequestedAt), true);
	} finally {
		harness.releaseEvaluation();
		harness.service.stop();
		await harness.cleanup();
	}
});

test("allowed before-run evaluation reserves one queued provider turn", async () => {
	const harness = await createHarness("goal");
	try {
		const pendingStart = harness.service.startJob(harness.job.id);
		await harness.waitForEvaluations(1);
		harness.releaseEvaluation();
		const run = await pendingStart;
		assert.ok(run);
		await waitFor(() => harness.messages.length === 1);
		assert.equal(harness.store.getRun(run.id)?.messageState, "queued");

		harness.finishMessage(harness.messages[0], "allowed turn");
		await waitFor(() => harness.store.getRun(run.id)?.status === "ok");
		assert.equal(harness.executions.filter((event) => event.action === "abort").length, 0);
	} finally {
		harness.releaseEvaluation();
		harness.service.stop();
		await harness.cleanup();
	}
});

test("cancellation after admission aborts the queued provider turn", async () => {
	const harness = await createHarness("goal");
	try {
		const pendingStart = harness.service.startJob(harness.job.id);
		await harness.waitForEvaluations(1);
		harness.releaseEvaluation();
		const run = await pendingStart;
		assert.ok(run);
		await waitFor(() => harness.messages.length === 1);
		assert.equal(harness.store.getRun(run.id)?.messageState, "queued");

		const cancelled = await harness.service.cancelJob(harness.job.id);
		assert.equal(cancelled.enabled, false);
		assert.equal(Boolean(cancelled.state.cancelRequestedAt), true);
		assert.equal(harness.executions.filter((event) => event.action === "abort").length, 1);

		harness.finishMessage(harness.messages[0], "cancelled turn settled");
		await waitFor(() => harness.store.getRun(run.id)?.status === "cancelled");
		assert.equal(harness.store.getJob(harness.job.id).enabled, false);
		assert.equal(Boolean(harness.store.getJob(harness.job.id).state.cancelRequestedAt), true);
	} finally {
		harness.releaseEvaluation();
		harness.service.stop();
		await harness.cleanup();
	}
});

test("concurrent manual triggers reserve and emit only one turn", async () => {
	const harness = await createHarness("goal");
	try {
		const starts = [harness.service.startJob(harness.job.id), harness.service.startJob(harness.job.id)];
		await harness.waitForEvaluations(2);
		harness.releaseEvaluation();
		const runs = await Promise.all(starts);
		const admitted = runs.filter(Boolean);
		assert.equal(admitted.length, 1);
		await waitFor(() => harness.messages.length === 1);
		assert.equal(harness.store.listRuns({ jobId: harness.job.id }).length, 1);

		harness.finishMessage(harness.messages[0], "single concurrent turn");
		await waitFor(() => harness.store.getRun(admitted[0].id)?.status === "ok");
	} finally {
		harness.releaseEvaluation();
		harness.service.stop();
		await harness.cleanup();
	}
});

async function createHarness(mode, input = {}) {
	const root = await mkdtemp(join(tmpdir(), `pibo-${mode}-admission-`));
	const storePath = join(root, "loops.sqlite");
	const store = new PiboLoopStore({ path: storePath });
	const listeners = new Set();
	const messages = [];
	const executions = [];
	const sessions = new Map();
	let evaluations = 0;
	let releaseEvaluation;
	const evaluationGate = new Promise((resolve) => { releaseEvaluation = resolve; });
	const evaluationWaiters = new Set();
	const condition = {
		type: "test.delayed-admission",
		name: "Delayed admission",
		phases: ["before-run", "after-run"],
		async evaluate(context) {
			if (context.phase === "before-run") {
				evaluations += 1;
				for (const waiter of evaluationWaiters) waiter();
				await evaluationGate;
				return { action: "continue" };
			}
			return { action: "stop-after-run", reason: "fixture-finished" };
		},
	};
	const context = {
		async emit(event) {
			if (event.type === "message") messages.push(event);
			if (event.type === "execution") executions.push(event);
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "fixture-event", action: event.action ?? "fixture", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(sessionInput) {
			const session = createPiboSession({ ...sessionInput, id: `ps_admission_${sessions.size + 1}` });
			sessions.set(session.id, session);
			return session;
		},
		getSession(id) { return sessions.get(id); },
		listSessions() { return [...sessions.values()]; },
		findSessions() { return []; },
		updateSession(id, patch) {
			const current = sessions.get(id);
			if (!current) return undefined;
			const next = { ...current, ...patch };
			sessions.set(id, next);
			return next;
		},
		getGatewayActions() { return []; },
		getWebApps() { return []; },
		getLoopStopConditionDefinitions() { return [condition]; },
	};
	const service = new PiboLoopService({
		store,
		context,
		dataStorePath: join(root, "data.sqlite"),
		dataPayloadRootDir: join(root, "payloads"),
		intervalMs: 60_000,
		runTimeoutMs: 5_000,
	});
	const job = store.createJob({
		mode,
		name: `${mode} admission fixture`,
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Run only after current admission.",
		enabled: input.enabled ?? false,
		stopPolicy: { mode: "any", conditions: [{ id: "delayed", type: condition.type }] },
	});
	return {
		root,
		storePath,
		store,
		service,
		job,
		messages,
		executions,
		get evaluations() { return evaluations; },
		releaseEvaluation,
		async waitForEvaluations(count) {
			if (evaluations >= count) return;
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => { evaluationWaiters.delete(onEvaluation); reject(new Error(`Timed out waiting for ${count} evaluations`)); }, 1_000);
				const onEvaluation = () => {
					if (evaluations < count) return;
					clearTimeout(timeout);
					evaluationWaiters.delete(onEvaluation);
					resolve();
				};
				evaluationWaiters.add(onEvaluation);
			});
		},
		finishMessage(message, text) {
			for (const listener of listeners) {
				listener({ type: "assistant_message", piboSessionId: message.piboSessionId, eventId: message.id, text });
				listener({ type: "message_finished", piboSessionId: message.piboSessionId, eventId: message.id });
			}
		},
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setImmediate(resolve));
	}
}
