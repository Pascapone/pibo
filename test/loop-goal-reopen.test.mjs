import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { PIBO_GOAL_TOOL_NAMES } from "../dist/loops/tools.js";

function createGoal(store, prompt = "Reopen objective") {
	return store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt, initialPiboSessionId: "ps_reopen" });
}

async function createHarness(options = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-goal-reopen-"));
	const store = options.store ?? new PiboLoopStore({ path: ":memory:" });
	const runtimeStatus = options.runtimeStatus;
	const controllerRuns = options.controllerRuns ?? [];
	const context = {
		async emit(event) { return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} }; },
		subscribe() { return () => {}; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getSessionRuntimeStatus() { return runtimeStatus; },
		listRuns() { return controllerRuns; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60_000 });
	return { store, service, async close() { service.stop(); await rm(dir, { recursive: true, force: true }); } };
}

test("operator reopen preserves Goal identity, accounting, history, and writes an audit fact", async () => {
	const harness = await createHarness();
	try {
		const goal = createGoal(harness.store);
		harness.store.recordGoalProgress(goal.id, { tokens: 123, activeTimeSeconds: 9 });
		const terminal = harness.store.updateGoalStatus(goal.id, "complete", new Date("2026-08-08T10:00:00.000Z"));
		assert.throws(() => harness.store.updateJob(goal.id, { enabled: true }), /Completed goals cannot be restarted/);

		const reopened = harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" });
		assert.equal(reopened.id, goal.id);
		assert.equal(reopened.enabled, true);
		assert.equal(reopened.state.goalStatus, "active");
		assert.equal(reopened.state.goalEndedAt, undefined);
		assert.equal(reopened.state.tokensUsed, 123);
		assert.equal(reopened.state.activeTimeSeconds, 9);
		assert.equal(reopened.state.completedIterations, terminal.state.completedIterations);
		const fact = harness.store.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" })[0];
		assert.equal(fact.payload.actorId, "operator:test");
		assert.equal(fact.payload.previousStatus, "complete");
		assert.equal(fact.payload.previousGoalEndedAt, "2026-08-08T10:00:00.000Z");
		assert.equal(fact.payload.confirmation, "confirm-terminal-reopen");
	} finally {
		await harness.close();
	}
});

test("operator reopen requires explicit confirmation and a disabled terminal Goal", async () => {
	const harness = await createHarness();
	try {
		const active = createGoal(harness.store);
		assert.throws(() => harness.service.reopenGoal(active.id, { confirmed: false, actorId: "operator:test" }), /confirmation is required/);
		assert.throws(() => harness.service.reopenGoal(active.id, { confirmed: true, actorId: "operator:test" }), /disabled terminal Goal/);
	} finally {
		await harness.close();
	}
});

test("operator reopen rejects active or queued Loop runs and competing Goal ownership", async (t) => {
	await t.test("Loop run", async () => {
		const harness = await createHarness();
		try {
			const goal = createGoal(harness.store);
			const run = harness.store.reserveRun(goal.id);
			assert.ok(run);
			harness.store.updateGoalStatus(goal.id, "complete");
			assert.throws(() => harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }), /Loop run is active or queued/);
		} finally { await harness.close(); }
	});
	await t.test("competing Goal", async () => {
		const harness = await createHarness();
		try {
			const goal = createGoal(harness.store, "Terminal");
			harness.store.updateGoalStatus(goal.id, "complete");
			harness.store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Competitor", initialPiboSessionId: "ps_reopen" });
			assert.throws(() => harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }), /owns the Pibo Session/);
		} finally { await harness.close(); }
	});
});

test("operator reopen rejects active, queued, draining, orphaned, or unconsumed controller work", async (t) => {
	for (const [name, runtimeStatus, controllerRuns, pattern] of [
		["processing", { processing: true, queuedMessages: 0 }, [], /active, queued, or draining/],
		["queued", { processing: false, queuedMessages: 2 }, [], /active, queued, or draining/],
		["controller running", undefined, [{ runId: "run_live", controllerPiboSessionId: "ps_reopen", status: "running", consumed: false }], /active or unconsumed/],
		["controller terminal unconsumed", undefined, [{ runId: "run_unread", controllerPiboSessionId: "ps_reopen", status: "completed", consumed: false }], /active or unconsumed/],
	]) {
		await t.test(name, async () => {
			const harness = await createHarness({ runtimeStatus, controllerRuns });
			try {
				const goal = createGoal(harness.store);
				harness.store.updateGoalStatus(goal.id, "complete");
				assert.throws(() => harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }), pattern);
			} finally { await harness.close(); }
		});
	}
});

test("consumed terminal controller work does not block reopen and model tools expose no reopen operation", async () => {
	const harness = await createHarness({ controllerRuns: [{ runId: "run_done", controllerPiboSessionId: "ps_reopen", status: "completed", consumed: true }] });
	try {
		const goal = createGoal(harness.store);
		harness.store.updateGoalStatus(goal.id, "blocked");
		assert.equal(harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }).state.goalStatus, "active");
		assert.equal(PIBO_GOAL_TOOL_NAMES.includes("reopen_goal"), false);
	} finally {
		await harness.close();
	}
});
