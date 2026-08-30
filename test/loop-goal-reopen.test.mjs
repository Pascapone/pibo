import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { PIBO_GOAL_TOOL_NAMES } from "../dist/loops/tools.js";
import { createPiboSession } from "../dist/sessions/store.js";

function createGoal(store, prompt = "Reopen objective") {
	return store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt, initialPiboSessionId: "ps_reopen" });
}

async function createHarness(options = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-goal-reopen-"));
	const store = options.store ?? new PiboLoopStore({ path: ":memory:" });
	const runtimeStatus = options.runtimeStatus;
	const controllerRuns = options.controllerRuns ?? [];
	const listeners = new Set();
	const messages = [];
	const session = createPiboSession({ id: "ps_reopen", channel: "pibo.chat-web", kind: "loop", profile: "base" });
	const context = {
		async emit(event) {
			if (event.type === "message") {
				messages.push(event);
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "fixture reply" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		getSession(id) { return id === session.id ? session : undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getSessionRuntimeStatus() { return runtimeStatus; },
		listRuns() { return controllerRuns; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60_000 });
	service.start();
	return { store, service, messages, async close() { await service.stop(); await rm(dir, { recursive: true, force: true }); } };
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

test("operator reopen preserves Goal identity, accounting, history, and writes an audit fact", async () => {
	const harness = await createHarness();
	try {
		const goal = createGoal(harness.store);
		harness.store.recordGoalProgress(goal.id, { tokens: 123, activeTimeSeconds: 9 });
		const terminal = harness.store.updateGoalStatus(goal.id, "complete", new Date("2026-08-08T10:00:00.000Z"));
		assert.throws(() => harness.store.updateJob(goal.id, { enabled: true }), /Terminal Goals cannot be restarted/);

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
	for (const [name, enabled] of [["active competing Goal", true], ["paused competing Goal", false]]) {
		await t.test(name, async () => {
			const harness = await createHarness();
			try {
				const goal = createGoal(harness.store, "Terminal");
				harness.store.updateGoalStatus(goal.id, "complete");
				harness.store.createJob({ mode: "goal", enabled, target: { kind: "default-chat" }, profile: "base", prompt: "Competitor", initialPiboSessionId: "ps_reopen" });
				assert.throws(() => harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }), /owns the Pibo Session/);
			} finally { await harness.close(); }
		});
	}
});

test("operator reopen rejects active, queued, draining, orphaned, or unconsumed controller work", async (t) => {
	for (const [name, runtimeStatus, controllerRuns, pattern] of [
		["processing", { processing: true, streaming: false, queuedMessages: 0, disposed: false }, [], /active, queued, draining, or disposing/],
		["streaming", { processing: false, streaming: true, queuedMessages: 0, disposed: false }, [], /active, queued, draining, or disposing/],
		["queued", { processing: false, streaming: false, queuedMessages: 2, disposed: false }, [], /active, queued, draining, or disposing/],
		["disposing", { processing: false, streaming: false, queuedMessages: 0, disposed: true }, [], /active, queued, draining, or disposing/],
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

test("generic start cannot bypass blocked Goal reopen safeguards", async (t) => {
	await t.test("busy and queued session", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pibo-goal-start-guard-"));
		const path = join(directory, "loops.sqlite");
		const harness = await createHarness({
			store: new PiboLoopStore({ path }),
			runtimeStatus: { processing: true, streaming: true, queuedMessages: 1, disposed: false },
			controllerRuns: [{ runId: "run_unconsumed", controllerPiboSessionId: "ps_reopen", status: "completed", consumed: false }],
		});
		const goal = createGoal(harness.store, "Busy blocked Goal");
		const terminal = harness.store.updateGoalStatus(goal.id, "blocked", new Date("2026-08-30T12:01:00.000Z"));
		try {
			assert.throws(
				() => harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" }),
				/active, queued, draining, or disposing/,
			);
			let startError;
			let unexpectedRun;
			try { unexpectedRun = await harness.service.startJob(goal.id); }
			catch (error) { startError = error instanceof Error ? error.message : String(error); }
			if (unexpectedRun) await waitFor(() => harness.store.getRun(unexpectedRun.id)?.status !== "running", "unexpected busy Goal run");
			assert.match(startError, /Terminal Goals cannot be restarted; use the confirmed Goal reopen operation/);
			const unchanged = harness.store.getJob(goal.id);
			assert.equal(unchanged.enabled, false);
			assert.equal(unchanged.state.goalStatus, "blocked");
			assert.equal(unchanged.state.goalEndedAt, terminal.state.goalEndedAt);
			assert.equal(harness.store.listRuns({ jobId: goal.id }).length, 0);
			assert.equal(harness.store.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" }).length, 0);
			assert.equal(harness.messages.length, 0);
		} finally {
			await harness.close();
		}
		const reopenedStore = new PiboLoopStore({ path });
		try {
			const reopened = reopenedStore.getJob(goal.id);
			assert.equal(reopened.enabled, false);
			assert.equal(reopened.state.goalStatus, "blocked");
			assert.equal(reopened.state.goalEndedAt, terminal.state.goalEndedAt);
			assert.equal(reopenedStore.listRuns({ jobId: goal.id }).length, 0);
			assert.equal(reopenedStore.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" }).length, 0);
		} finally {
			reopenedStore.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	await t.test("safe idle session", async () => {
		const harness = await createHarness({ runtimeStatus: { processing: false, streaming: false, queuedMessages: 0, disposed: false } });
		try {
			const goal = createGoal(harness.store, "Safe blocked Goal");
			harness.store.updateGoalStatus(goal.id, "blocked", new Date("2026-08-30T12:01:00.000Z"));
			let startError;
			let unexpectedRun;
			try { unexpectedRun = await harness.service.startJob(goal.id); }
			catch (error) { startError = error instanceof Error ? error.message : String(error); }
			if (unexpectedRun) await waitFor(() => harness.store.getRun(unexpectedRun.id)?.status !== "running", "unexpected safe-idle Goal run");
			assert.match(startError, /Terminal Goals cannot be restarted; use the confirmed Goal reopen operation/);
			assert.equal(harness.store.listRuns({ jobId: goal.id }).length, 0);
			assert.equal(harness.store.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" }).length, 0);

			const reopened = harness.service.reopenGoal(goal.id, { confirmed: true, actorId: "operator:test" });
			assert.equal(reopened.enabled, true);
			assert.equal(reopened.state.goalStatus, "active");
			const fact = harness.store.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" })[0];
			assert.equal(fact.payload.actorId, "operator:test");
			assert.equal(fact.payload.previousStatus, "blocked");
			const run = await harness.service.startJob(goal.id);
			assert.ok(run);
			await waitFor(() => harness.store.getRun(run.id)?.status === "ok", "audited reopened Goal run");
			assert.equal(harness.messages.length, 1);
		} finally {
			await harness.close();
		}
	});

	await t.test("paused nonterminal Goal", async () => {
		const harness = await createHarness();
		try {
			const goal = createGoal(harness.store, "Paused control");
			harness.store.requestStop(goal.id);
			const run = await harness.service.startJob(goal.id);
			assert.ok(run);
			await waitFor(() => harness.store.getRun(run.id)?.status === "ok", "paused Goal run");
			assert.equal(harness.store.getJob(goal.id).state.goalStatus, "active");
			assert.equal(harness.store.listRunFacts({ jobId: goal.id, type: "pibo.loop.goal-reopened" }).length, 0);
			assert.equal(harness.messages.length, 1);
		} finally {
			await harness.close();
		}
	});
});
