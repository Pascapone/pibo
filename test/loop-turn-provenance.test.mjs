import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { PiboLoopService } from "../dist/loops/service.js";
import { createLoopMessagePreflight, PiboLoopStore } from "../dist/loops/store.js";
import { createPiboGoalToolDefinitions } from "../dist/loops/tools.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

function toolsByName(store, getActiveMessage) {
	return Object.fromEntries(createPiboGoalToolDefinitions({ piboSessionId: "ps_goal", piboRoomId: "room_goal", profileName: "goal-agent", getActiveMessage }, { store }).map((tool) => [tool.name, tool]));
}

function details(result) {
	assert.equal(result.isError, undefined, result.content?.[0]?.text);
	return result.details;
}

test("RoutedSession revalidates queued Loop authority before message_started", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-loop-preflight-route-"));
	const profile = new InitialSessionContextBuilder("loop-preflight-test").createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: false, profile });
	const events = [];
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("ps_goal", runtime, (event) => events.push(event), registry, false, undefined, false, undefined, undefined, undefined, undefined, () => ({ allowed: false, code: "loop_continuation_invalidated", reason: "Goal is complete" }));
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_goal", id: "loop_msg_stale", source: "service", text: "Continue working toward the active Pibo loop goal.", provenance: { kind: "loop-run", jobId: "loop_old", runId: "lrun_old" } });
		await waitFor(() => events.some((event) => event.type === "session_error"));
		assert.equal(events.some((event) => event.type === "message_started"), false);
		const error = events.find((event) => event.type === "session_error");
		assert.equal(error.errorDetails.code, "loop_continuation_invalidated");
		assert.deepEqual(error.provenance, { kind: "loop-run", jobId: "loop_old", runId: "lrun_old" });
	} finally {
		await routed.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("Pi routed requests remain cancellable during asynchronous message preflight", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-loop-preflight-cancel-"));
	const profile = new InitialSessionContextBuilder("loop-preflight-cancel-test").createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: false, profile });
	let promptCalls = 0;
	runtime.session.prompt = async () => { promptCalls += 1; };
	let markPreflightStarted;
	let releasePreflight;
	const preflightStarted = new Promise((resolve) => { markPreflightStarted = resolve; });
	const preflightGate = new Promise((resolve) => { releasePreflight = resolve; });
	const events = [];
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("ps_goal", runtime, (event) => events.push(event), registry, false, undefined, false, undefined, undefined, undefined, undefined, async () => {
		markPreflightStarted();
		await preflightGate;
		return { allowed: true };
	});
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_goal", id: "loop_msg_preflight_cancelled", source: "service", text: "Do not prompt" });
		await preflightStarted;
		let settled = false;
		const cancellation = routed.cancelMessage("loop_msg_preflight_cancelled").finally(() => { settled = true; });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false);
		assert.equal(promptCalls, 0);

		releasePreflight();
		assert.equal(await cancellation, true);
		assert.equal(promptCalls, 0);
		assert.equal(events.some((event) => event.type === "message_started" && event.eventId === "loop_msg_preflight_cancelled"), false);
	} finally {
		releasePreflight();
		await routed.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("RoutedSession contains preflight exceptions and continues draining queued messages", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-loop-preflight-error-"));
	const profile = new InitialSessionContextBuilder("loop-preflight-error-test").createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: false, profile });
	const events = [];
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	let preflightCalls = 0;
	const routed = new RoutedSession("ps_goal", runtime, (event) => events.push(event), registry, false, undefined, false, undefined, undefined, undefined, undefined, () => {
		preflightCalls += 1;
		if (preflightCalls === 1) throw new Error("custom Loop store unavailable");
		return { allowed: false, code: "loop_continuation_invalidated", reason: "Goal is complete" };
	});
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_goal", id: "loop_msg_store_error", source: "service", text: "Continue", provenance: { kind: "loop-run", jobId: "loop_one", runId: "lrun_one" } });
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_goal", id: "loop_msg_after_error", source: "service", text: "Continue", provenance: { kind: "loop-run", jobId: "loop_two", runId: "lrun_two" } });
		await waitFor(() => events.filter((event) => event.type === "session_error").length === 2);
		assert.equal(events.some((event) => event.type === "message_started"), false);
		const errors = events.filter((event) => event.type === "session_error");
		assert.deepEqual(errors.map((event) => event.eventId), ["loop_msg_store_error", "loop_msg_after_error"]);
		assert.match(errors[0].error, /custom Loop store unavailable/);
		assert.equal(errors[1].errorDetails.code, "loop_continuation_invalidated");
	} finally {
		await routed.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("gateway preflight reads the configured custom Loop store", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-gateway-store-"));
	const path = join(dir, "custom-loops.sqlite");
	const store = new PiboLoopStore({ path });
	const server = new PiboGatewayServer({ host: "127.0.0.1", port: 0, startChannels: false, persistSession: false, sessionDbPath: join(dir, "sessions.sqlite"), loopStorePath: path });
	try {
		const job = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Objective", initialPiboSessionId: "ps_custom_store" });
		const reserved = store.reserveRun(job.id);
		store.attachRunSession(job.id, reserved.run.id, "ps_custom_store");
		store.attachRunMessage(job.id, reserved.run.id, "loop_msg_custom_store");
		const event = { type: "message", piboSessionId: "ps_custom_store", id: "loop_msg_custom_store", source: "service", text: "Continue", provenance: { kind: "loop-run", jobId: job.id, runId: reserved.run.id } };

		await server.start();
		const preflight = server.router.options.messagePreflight;
		assert.equal((await preflight(event)).allowed, true);
	} finally {
		await server.stop();
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Loop message provenance survives queue, start, and finish events", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-loop-provenance-route-"));
	const profile = new InitialSessionContextBuilder("loop-provenance-test").createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: false, profile });
	runtime.session.prompt = async () => {};
	const events = [];
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("ps_goal", runtime, (event) => events.push(event), registry, false, undefined, false, undefined, undefined, undefined, undefined, () => ({ allowed: true }));
	const provenance = { kind: "loop-run", jobId: "loop_origin", runId: "lrun_origin" };
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_goal", id: "loop_msg_origin", source: "service", text: "Continue", provenance });
		await waitFor(() => events.some((event) => event.type === "message_finished"));
		for (const type of ["message_queued", "message_started", "message_finished"]) {
			assert.deepEqual(events.find((event) => event.type === type).provenance, provenance);
		}
	} finally {
		await routed.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("stop, cancel, complete, blocked, and budget-limited transitions invalidate queued continuations", async (t) => {
	for (const transition of ["stop", "cancel", "complete", "blocked", "budget_limited"]) {
		await t.test(transition, async () => {
			const dir = await mkdtemp(join(tmpdir(), `pibo-loop-${transition}-`));
			const path = join(dir, "loops.sqlite");
			const store = new PiboLoopStore({ path });
			try {
				const job = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Objective", tokenBudget: transition === "budget_limited" ? 10 : undefined, initialPiboSessionId: "ps_goal" });
				const reserved = store.reserveRun(job.id);
				store.attachRunSession(job.id, reserved.run.id, "ps_goal");
				store.attachRunMessage(job.id, reserved.run.id, `loop_msg_${transition}`);
				const event = { type: "message", piboSessionId: "ps_goal", id: `loop_msg_${transition}`, source: "service", text: "Continue", provenance: { kind: "loop-run", jobId: job.id, runId: reserved.run.id } };
				assert.equal(createLoopMessagePreflight({ path })(event).allowed, true);
				if (transition === "stop") store.requestStop(job.id);
				else if (transition === "cancel") store.requestCancel(job.id);
				else if (transition === "complete" || transition === "blocked") store.updateGoalStatus(job.id, transition);
				else store.recordGoalProgress(job.id, { tokens: 10 });
				const result = createLoopMessagePreflight({ path })(event);
				assert.equal(result.allowed, false);
				assert.equal(result.code, "loop_continuation_invalidated");
			} finally {
				store.close();
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
});

test("Goal creation authority is explicit and exclusive while a completed Goal run is still in flight", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const explicitTools = toolsByName(store, () => ({ id: "user_msg", source: "user" }));
		const first = details(await explicitTools.create_goal.execute("create_first", { objective: "First objective" })).goal;
		const reserved = store.reserveRun(first.goalId);
		store.attachRunSession(first.goalId, reserved.run.id, "ps_goal");
		store.attachRunMessage(first.goalId, reserved.run.id, "loop_msg_first");
		store.updateGoalStatus(first.goalId, "complete", new Date("2026-08-08T10:00:00.000Z"));

		const automaticTools = toolsByName(store, () => ({ id: "loop_msg_first", source: "service", provenance: { kind: "loop-run", jobId: first.goalId, runId: reserved.run.id } }));
		const automaticCreate = await automaticTools.create_goal.execute("create_stale", { objective: "Replacement" });
		assert.equal(automaticCreate.isError, true);
		assert.match(automaticCreate.content[0].text, /automatic Loop continuations/);

		const overlappingCreate = await explicitTools.create_goal.execute("create_overlap", { objective: "Replacement" });
		assert.equal(overlappingCreate.isError, true);
		assert.match(overlappingCreate.content[0].text, /unfinished goal or in-flight run/);

		store.completeRun({ jobId: first.goalId, runId: reserved.run.id, status: "ok", reason: "goal-complete" });
		const replacement = details(await explicitTools.create_goal.execute("create_replacement", { objective: "Replacement" })).goal;
		assert.notEqual(replacement.goalId, first.goalId);
	} finally {
		store.close();
	}
});

test("stale provenance cannot retarget an older Goal after its originating Goal is deleted", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const explicitTools = toolsByName(store, () => ({ id: "user_msg", source: "user" }));
		const older = details(await explicitTools.create_goal.execute("create_old", { objective: "Older" })).goal;
		store.updateGoalStatus(older.goalId, "complete", new Date("2026-08-08T11:00:00.000Z"));
		const olderBefore = store.getJob(older.goalId);

		const newer = details(await explicitTools.create_goal.execute("create_new", { objective: "Newer" })).goal;
		const run = store.reserveRun(newer.goalId).run;
		store.attachRunSession(newer.goalId, run.id, "ps_goal");
		store.attachRunMessage(newer.goalId, run.id, "loop_msg_newer");
		store.completeRun({ jobId: newer.goalId, runId: run.id, status: "cancelled", reason: "test cleanup" });
		store.removeJob(newer.goalId);

		const staleTools = toolsByName(store, () => ({ id: "loop_msg_newer", source: "service", provenance: { kind: "loop-run", jobId: newer.goalId, runId: run.id } }));
		const staleUpdate = await staleTools.update_goal.execute("stale_update", { status: "blocked" });
		assert.equal(staleUpdate.isError, true);
		assert.match(staleUpdate.content[0].text, /stale or invalid Loop provenance|originating Goal no longer exists/);
		const olderAfter = store.getJob(older.goalId);
		assert.equal(olderAfter.state.goalStatus, "complete");
		assert.equal(olderAfter.state.goalEndedAt, olderBefore.state.goalEndedAt);
		assert.equal(olderAfter.updatedAt, olderBefore.updatedAt);
	} finally {
		store.close();
	}
});

test("terminal Goal transitions are immutable and idempotent", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const complete = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Complete" });
		const first = store.updateGoalStatus(complete.id, "complete", new Date("2026-08-08T12:00:00.000Z"));
		const repeated = store.updateGoalStatus(complete.id, "complete", new Date("2026-08-08T13:00:00.000Z"));
		assert.equal(repeated.state.goalEndedAt, first.state.goalEndedAt);
		assert.equal(repeated.updatedAt, first.updatedAt);
		assert.throws(() => store.updateGoalStatus(complete.id, "blocked"), /Cannot change terminal goal status/);

		const blocked = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Blocked" });
		store.updateGoalStatus(blocked.id, "blocked");
		assert.throws(() => store.updateGoalStatus(blocked.id, "complete"), /Cannot change terminal goal status/);
	} finally {
		store.close();
	}
});

test("Goal session metadata is repaired so it cannot reference removed jobs or runs", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-metadata-repair-"));
	const sessions = new Map([["ps_goal", { id: "ps_goal", metadata: { loopMode: "goal", loopJobId: "loop_deleted", loopRunId: "lrun_deleted", keep: "value" } }]]);
	const context = {
		async emit(event) { return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} }; },
		subscribe() { return () => {}; },
		getSession(id) { return sessions.get(id); },
		listSessions() { return [...sessions.values()]; },
		updateSession(id, patch) { const current = sessions.get(id); const next = { ...current, ...patch, metadata: patch.metadata ?? current.metadata }; sessions.set(id, next); return next; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60_000 });
	try {
		service.start();
		assert.deepEqual(sessions.get("ps_goal").metadata, { loopMode: "goal", keep: "value" });
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("assistant usage is charged to the run bound to its eventId, not the newest Goal", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	const listeners = new Set();
	const context = {
		async emit(event) { return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} }; },
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-usage-provenance-"));
	const service = new PiboLoopService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), intervalMs: 60_000 });
	try {
		const oldJob = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "Old", initialPiboSessionId: "ps_shared" });
		const oldRun = store.reserveRun(oldJob.id).run;
		store.attachRunSession(oldJob.id, oldRun.id, "ps_shared");
		store.attachRunMessage(oldJob.id, oldRun.id, "loop_msg_old");
		const newJob = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "New", initialPiboSessionId: "ps_shared" });
		const newRun = store.reserveRun(newJob.id).run;
		store.attachRunSession(newJob.id, newRun.id, "ps_shared");
		store.attachRunMessage(newJob.id, newRun.id, "loop_msg_new");

		service.start();
		for (const listener of listeners) listener({ type: "assistant_usage", piboSessionId: "ps_shared", eventId: "loop_msg_old", totalTokens: 17 });
		assert.equal(store.getJob(oldJob.id).state.tokensUsed, 17);
		assert.equal(store.getJob(newJob.id).state.tokensUsed, 0);
		assert.equal(store.getRun(oldRun.id).accounting.tokensUsed, 17);
		assert.equal(store.getRun(newRun.id).accounting.tokensUsed, 0);
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor(predicate, timeoutMs = 2_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Loop provenance event");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
