import assert from "node:assert/strict";
import test from "node:test";
import { PiboRunRegistry } from "../dist/runs/registry.js";
import { PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";
import { createRunToolDefinitions } from "../dist/runs/tools.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

function startRun(registry, options = {}) {
	return registry.startToolRun({
		controllerPiboSessionId: options.controllerPiboSessionId ?? "parent",
		toolName: options.toolName ?? "helper",
		completionPolicy: options.completionPolicy,
	});
}

function runSnapshot(run, options = {}) {
	return {
		runId: options.runId ?? "run_1",
		kind: "tool",
		controllerPiboSessionId: "parent",
		status: options.status ?? "running",
		completionPolicy: options.completionPolicy ?? "tracked",
		consumed: false,
		toolName: options.toolName ?? "helper",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...run,
	};
}

test("tracked runs create compact notifications until consumed", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);

	assert.equal(registry.hasPendingNotification("parent"), true);
	const running = registry.createNotification("parent");
	assert.equal(running.running.length, 1);
	assert.equal(running.running[0].runId, run.runId);
	assert.equal(registry.hasPendingNotification("parent"), false);

	registry.complete(run.runId, { text: "done" });

	assert.equal(registry.hasPendingNotification("parent"), true);
	const completed = registry.createNotification("parent");
	assert.equal(completed.completed.length, 1);
	assert.equal(completed.completed[0].runId, run.runId);

	const read = registry.read("parent", run.runId);
	assert.equal(read.status, "completed");
	assert.equal(read.result.text, "done");
	assert.equal(registry.hasPendingNotification("parent"), false);
});

test("detached runs are inspectable but do not notify", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry, { completionPolicy: "detached" });

	assert.equal(registry.hasPendingNotification("parent"), false);
	assert.deepEqual(registry.list("parent"), []);
	assert.equal(registry.list("parent", { includeDetached: true }).length, 1);

	registry.complete(run.runId, { text: "background done" });

	assert.equal(registry.hasPendingNotification("parent"), false);
	assert.equal(registry.status("parent", run.runId).status, "completed");
});

test("wait returns timeout as normal state and resolves on completion", async () => {
	const registry = new PiboRunRegistry();
	const timedOutRun = startRun(registry);

	const timedOut = await registry.wait("parent", timedOutRun.runId, 1);
	assert.equal(timedOut.status, "running");
	assert.equal(timedOut.timedOut, true);

	const completedRun = startRun(registry);
	const waited = registry.wait("parent", completedRun.runId, 1000);
	setTimeout(() => {
		registry.complete(completedRun.runId, { text: "finished" });
	}, 1);

	const completed = await waited;
	assert.equal(completed.status, "completed");
	assert.equal(completed.timedOut, false);
});

test("configured run timeout is persisted and classified separately from failure", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const registry = new PiboRunRegistry({ store });
		const run = registry.startToolRun({
			controllerPiboSessionId: "parent",
			toolName: "bash",
			completionPolicy: "tracked",
			timeoutMs: 21600000,
			serviceWarning: "foreground service warning",
		});
		assert.equal(run.timeoutMs, 21600000);
		assert.equal(typeof run.timeoutAt, "string");
		assert.equal(run.serviceWarning, "foreground service warning");

		const timedOut = registry.timeOut(run.runId, "Command timed out after 21600 seconds", "lifetime");
		assert.equal(timedOut.status, "timed_out");
		assert.equal(timedOut.timeoutPhase, "lifetime");
		assert.match(timedOut.summary, /started successfully/);
		assert.match(timedOut.summary, /21600s timeout/);
		const notification = registry.createNotification("parent");
		assert.equal(notification.timedOut[0].runId, run.runId);
		assert.equal(notification.failed.length, 0);

		const restored = new PiboRunRegistry({ store });
		const snapshot = restored.status("parent", run.runId);
		assert.equal(snapshot.status, "timed_out");
		assert.equal(snapshot.timeoutMs, 21600000);
		assert.equal(snapshot.timeoutPhase, "lifetime");
		assert.equal(snapshot.serviceWarning, "foreground service warning");
		const read = restored.read("parent", run.runId);
		assert.match(read.error, /timed out/);
	} finally {
		store.close();
	}
});

test("resource-limited runs persist cgroup peaks and expose them through status and notifications", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const registry = new PiboRunRegistry({ store });
		const resources = {
			isolationMode: "systemd",
			unitName: "pibo-yielded-test.service",
			policy: {
				mode: "systemd",
				memoryHighBytes: 100,
				memoryMaxBytes: 200,
				tasksMax: 8,
				cpuQuotaPercent: 100,
				ioWeight: 50,
				monitorIntervalMs: 100,
				minHostAvailableBytes: 50,
				maxMemoryFullPsiAvg10: 5,
				maxIoFullPsiAvg10: 10,
			},
			admission: {
				capturedAt: "2026-08-09T00:00:00.000Z",
				memoryFreeBytes: 1000,
				memoryAvailableBytes: 2000,
				memoryPressure: { fullAvg10: 0 },
				ioPressure: { fullAvg10: 0 },
			},
			minimumHostAvailableBytes: 40,
			peakMemoryFullPsiAvg10: 6,
			peakIoFullPsiAvg10: 3,
			limitReason: "host memory full PSI avg10 6 reached 5",
			cgroup: { unitName: "pibo-yielded-test.service", memoryPeakBytes: 199, memoryMaxBytes: 200, tasksPeak: 7, ioWriteBytes: 1234 },
		};
		const run = registry.startToolRun({ controllerPiboSessionId: "parent", toolName: "bash", completionPolicy: "tracked", resources });
		const limited = registry.resourceLimit(run.runId, `resource_limited: ${resources.limitReason}`, resources);
		assert.equal(limited.status, "failed");
		assert.match(limited.summary, /resource limits/);
		assert.equal(limited.resources.cgroup.memoryPeakBytes, 199);
		assert.equal(registry.createNotification("parent").failed[0].resources.limitReason, resources.limitReason);

		const restored = new PiboRunRegistry({ store }).status("parent", run.runId);
		assert.equal(restored.resources.unitName, "pibo-yielded-test.service");
		assert.equal(restored.resources.minimumHostAvailableBytes, 40);
		assert.equal(restored.resources.cgroup.ioWriteBytes, 1234);
	} finally {
		store.close();
	}
});

test("disposing a controller cancels running runs and resolves waiters", async () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);
	const waited = registry.wait("parent", run.runId, 1000);

	const cancelled = registry.cancelControllerRuns("parent", "test dispose");
	assert.equal(cancelled.length, 1);
	assert.equal(cancelled[0].status, "cancelled");

	const result = await waited;
	assert.equal(result.status, "cancelled");
	assert.equal(result.timedOut, false);
	assert.equal(registry.list("parent").length, 0);
	assert.equal(registry.list("parent", { includeConsumed: true }).length, 1);
});

test("cancel wins over a late complete", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);

	const cancelled = registry.cancel("parent", run.runId);
	assert.equal(cancelled.status, "cancelled");
	assert.equal(cancelled.consumed, true);

	assert.equal(registry.complete(run.runId, { text: "late result" }), undefined);
	const status = registry.status("parent", run.runId);
	assert.equal(status.status, "cancelled");
	assert.equal(status.consumed, true);
	assert.equal(registry.read("parent", run.runId).result, undefined);
});

test("registry restores consumed terminal runs from the reliability store", () => {
	const store = new PiboReliabilityStore(":memory:");
	try {
		const registry = new PiboRunRegistry({ store });
		const run = startRun(registry);

		assert.equal(registry.createNotification("parent").running[0].runId, run.runId);
		registry.complete(run.runId, { text: "stored result", details: { ok: true } });
		assert.equal(registry.createNotification("parent").completed[0].runId, run.runId);

		const consumed = registry.read("parent", run.runId);
		assert.equal(consumed.consumed, true);
		assert.deepEqual(consumed.result, { text: "stored result", details: { ok: true } });

		const restored = new PiboRunRegistry({ store });
		assert.deepEqual(restored.list("parent"), []);

		const [snapshot] = restored.list("parent", { includeConsumed: true });
		assert.equal(snapshot.runId, run.runId);
		assert.equal(snapshot.status, "completed");
		assert.equal(snapshot.consumed, true);
		assert.equal(restored.hasPendingNotification("parent"), false);
		assert.deepEqual(restored.read("parent", run.runId).result, { text: "stored result", details: { ok: true } });
	} finally {
		store.close();
	}
});

test("registry prunes detached terminal and consumed tracked runs only", () => {
	const registry = new PiboRunRegistry({
		consumedTerminalTtlMs: 0,
		detachedTerminalTtlMs: 0,
	});
	const tracked = startRun(registry);
	const detached = startRun(registry, { completionPolicy: "detached" });
	const consumed = startRun(registry);
	const timedOut = startRun(registry, { completionPolicy: "detached" });

	registry.complete(tracked.runId, { text: "tracked result" });
	registry.complete(detached.runId, { text: "detached result" });
	registry.complete(consumed.runId, { text: "consumed result" });
	registry.timeOut(timedOut.runId, "Command timed out", "startup");
	registry.read("parent", consumed.runId);

	assert.equal(registry.prune(), 3);
	assert.equal(registry.status("parent", tracked.runId).status, "completed");
	assert.throws(() => registry.status("parent", detached.runId), /Unknown run/);
	assert.throws(() => registry.status("parent", consumed.runId), /Unknown run/);
	assert.throws(() => registry.status("parent", timedOut.runId), /Unknown run/);
});

test("ack suppresses current-state reminders and terminal ack consumes", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);

	registry.ack("parent", run.runId);
	assert.equal(registry.hasPendingNotification("parent"), false);

	registry.complete(run.runId, { text: "done" });
	assert.equal(registry.hasPendingNotification("parent"), true);

	const acked = registry.ack("parent", run.runId);
	assert.equal(acked.status, "completed");
	assert.equal(acked.consumed, true);
	assert.equal(registry.hasPendingNotification("parent"), false);
});

test("turn-end reminders can repeat until a tracked run is acknowledged", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);

	const first = registry.createNotification("parent");
	assert.equal(first.running[0].runId, run.runId);
	assert.equal(registry.hasPendingNotification("parent"), false);
	assert.equal(registry.hasPendingNotification("parent", { includeAlreadyNotified: true }), true);

	registry.ack("parent", run.runId);
	assert.equal(registry.hasPendingNotification("parent", { includeAlreadyNotified: true }), false);

	registry.complete(run.runId, { text: "done" });
	assert.equal(registry.hasPendingNotification("parent"), true);
});

function createRunToolsWithController(overrides = {}) {
	const controller = {
		startToolRun() {
			throw new Error("not used");
		},
		listRuns() {
			throw new Error("not used");
		},
		getRunStatus() {
			throw new Error("not used");
		},
		waitForRun() {
			throw new Error("not used");
		},
		readRun() {
			throw new Error("not used");
		},
		cancelRun() {
			throw new Error("not used");
		},
		ackRun() {
			throw new Error("not used");
		},
		...overrides,
	};
	const tools = createRunToolDefinitions([], controller);
	return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

test("run tools start yieldable tools with explicit completion policy", async () => {
	let observed;
	const [startTool] = createRunToolDefinitions(
		[
			{
				name: "helper",
				async execute(_toolCallId, params) {
					observed = params;
					return {
						content: [{ type: "text", text: "helper result" }],
						details: { ok: true },
					};
				},
			},
		],
		{
			startToolRun(input) {
				observed = input;
				return runSnapshot(undefined, {
					toolName: input.toolName,
					completionPolicy: input.completionPolicy,
				});
			},
			listRuns() {
				return [];
			},
			getRunStatus() {
				throw new Error("not used");
			},
			waitForRun() {
				throw new Error("not used");
			},
			readRun() {
				throw new Error("not used");
			},
			cancelRun() {
				throw new Error("not used");
			},
			ackRun() {
				throw new Error("not used");
			},
		},
	);

	const result = await startTool.execute("tool-call-1", {
		toolName: "helper",
		arguments: { message: "do background work" },
		completionPolicy: "detached",
	});

	assert.equal(observed.toolName, "helper");
	assert.deepEqual(observed.params, { message: "do background work" });
	assert.equal(observed.completionPolicy, "detached");
	assert.equal(result.details.runId, "run_1");
});

test("run start cancellation aborts the yieldable tool execution", async () => {
	let started;
	let observedSignal;
	const [startTool] = createRunToolDefinitions(
		[{
			name: "helper",
			async execute(_toolCallId, _params, signal) {
				observedSignal = signal;
				return await new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		}],
		{
			startToolRun(input) { started = input; return runSnapshot(undefined, { toolName: input.toolName }); },
			listRuns() { return []; },
			getRunStatus() { throw new Error("not used"); },
			waitForRun() { throw new Error("not used"); },
			readRun() { throw new Error("not used"); },
			cancelRun() { throw new Error("not used"); },
			ackRun() { throw new Error("not used"); },
		},
	);

	await startTool.execute("tool-call-cancel", { toolName: "helper", arguments: {} });
	const execution = started.execute();
	await new Promise((resolve) => setImmediate(resolve));
	await started.cancel();
	await assert.rejects(execution, /Yielded run was cancelled/);
	assert.equal(observedSignal.aborted, true);
});

test("run start records inferred Bash timeout, warns for foreground services, and classifies lifetime expiry", async () => {
	let started;
	const [startTool] = createRunToolDefinitions(
		[
			{
				name: "bash",
				async execute(_toolCallId, _params, _signal, onUpdate) {
					onUpdate({ content: [{ type: "text", text: "gateway listening on 4788" }] });
					throw new Error("Command timed out after 2 seconds");
				},
			},
		],
		{
			startToolRun(input) {
				started = input;
				return runSnapshot({ timeoutMs: input.timeoutMs, serviceWarning: input.serviceWarning }, { toolName: input.toolName });
			},
			listRuns() { return []; },
			getRunStatus() { throw new Error("not used"); },
			waitForRun() { throw new Error("not used"); },
			readRun() { throw new Error("not used"); },
			cancelRun() { throw new Error("not used"); },
			ackRun() { throw new Error("not used"); },
		},
	);

	const result = await startTool.execute("tool-call-service", {
		toolName: "bash",
		arguments: { command: "pibo gateway:web", timeout: 2 },
		completionPolicy: "tracked",
	});
	assert.equal(started.timeoutMs, 2000);
	assert.match(started.serviceWarning, /Known long-lived service command/);
	assert.match(result.content[0].text, /Warning:/);
	await assert.rejects(started.execute(), (error) => error instanceof PiboRunExecutionTimeoutError && error.timeoutPhase === "lifetime");
});

test("run timeout without output is classified as startup expiry", async () => {
	let started;
	const [startTool] = createRunToolDefinitions(
		[{ name: "bash", async execute() { throw new Error("Command timed out"); } }],
		{
			startToolRun(input) { started = input; return runSnapshot({ timeoutMs: input.timeoutMs }, { toolName: input.toolName }); },
			listRuns() { return []; },
			getRunStatus() { throw new Error("not used"); },
			waitForRun() { throw new Error("not used"); },
			readRun() { throw new Error("not used"); },
			cancelRun() { throw new Error("not used"); },
			ackRun() { throw new Error("not used"); },
		},
	);
	await startTool.execute("tool-call-startup", { toolName: "bash", arguments: { command: "pibo gateway:web", timeout: 1 } });
	await assert.rejects(started.execute(), (error) => error instanceof PiboRunExecutionTimeoutError && error.timeoutPhase === "startup");
});

test("run start tool rejects unknown yieldable tool names", async () => {
	const [startTool] = createRunToolDefinitions([], {
		startToolRun() {
			throw new Error("not used");
		},
		listRuns() {
			return [];
		},
		getRunStatus() {
			throw new Error("not used");
		},
		waitForRun() {
			throw new Error("not used");
		},
		readRun() {
			throw new Error("not used");
		},
		cancelRun() {
			throw new Error("not used");
		},
		ackRun() {
			throw new Error("not used");
		},
	});

	await assert.rejects(
		startTool.execute("tool-call-1", { toolName: "missing", arguments: {} }),
		/Unknown or non-yieldable tool "missing"/,
	);
});

test("run start tool turns yieldable error results into failed run exceptions", async () => {
	let started;
	const [startTool] = createRunToolDefinitions(
		[
			{
				name: "helper",
				async execute() {
					return {
						isError: true,
						content: [{ type: "text", text: "helper failed" }],
					};
				},
			},
		],
		{
			startToolRun(input) {
				started = input;
				return runSnapshot(undefined, { toolName: input.toolName });
			},
			listRuns() {
				return [];
			},
			getRunStatus() {
				throw new Error("not used");
			},
			waitForRun() {
				throw new Error("not used");
			},
			readRun() {
				throw new Error("not used");
			},
			cancelRun() {
				throw new Error("not used");
			},
			ackRun() {
				throw new Error("not used");
			},
		},
	);

	await startTool.execute("tool-call-1", { toolName: "helper", arguments: { ok: false } });

	assert.equal(started.toolName, "helper");
	await assert.rejects(started.execute(), /helper failed/);
});

test("run read tool returns terminal text and full details", async () => {
	const tools = createRunToolsWithController({
		readRun(runId) {
			return runSnapshot(
				{ status: "completed", consumed: true, result: { text: "done", details: { ok: true } } },
				{ runId },
			);
		},
	});

	const result = await tools.pibo_run_read.execute("tool-call-1", { runId: "run_1" });

	assert.equal(result.content[0].text, "done");
	assert.equal(result.details.runId, "run_1");
	assert.equal(result.details.status, "completed");
	assert.deepEqual(result.details.result.details, { ok: true });
});

test("run wait tool reports timeout as non-error state", async () => {
	const tools = createRunToolsWithController({
		waitForRun(runId, timeoutMs) {
			assert.equal(timeoutMs, 5);
			return Promise.resolve(runSnapshot({ timedOut: true }, { runId }));
		},
	});

	const result = await tools.pibo_run_wait.execute("tool-call-1", { runId: "run_1", timeoutMs: 5 });

	assert.match(result.content[0].text, /wait timed out/);
	assert.equal(result.details.runId, "run_1");
	assert.equal(result.details.status, "running");
	assert.equal(result.details.timedOut, true);
});

test("run wait tool uses the documented default timeout", async () => {
	const tools = createRunToolsWithController({
		waitForRun(runId, timeoutMs) {
			assert.equal(runId, "run_1");
			assert.equal(timeoutMs, 30000);
			return Promise.resolve(runSnapshot({ status: "completed", timedOut: false }, { runId }));
		},
	});

	const result = await tools.pibo_run_wait.execute("tool-call-1", { runId: "run_1" });

	assert.match(result.content[0].text, /Run run_1 reached completed/);
	assert.equal(result.details.status, "completed");
	assert.equal(result.details.timedOut, false);
});

test("run ack tool returns acknowledged snapshot details", async () => {
	const tools = createRunToolsWithController({
		ackRun(runId) {
			return runSnapshot({ status: "completed", consumed: true }, { runId });
		},
	});

	const result = await tools.pibo_run_ack.execute("tool-call-1", { runId: "run_1" });

	assert.match(result.content[0].text, /Acknowledged run run_1/);
	assert.equal(result.details.runId, "run_1");
	assert.equal(result.details.status, "completed");
	assert.equal(result.details.consumed, true);
});

test("run list status and cancel tools expose snapshots", async () => {
	const tools = createRunToolsWithController({
		listRuns(options) {
			assert.deepEqual(options, { includeConsumed: true, includeDetached: true });
			return [runSnapshot(undefined, { runId: "run_1" })];
		},
		getRunStatus(runId) {
			return runSnapshot({ status: "running" }, { runId });
		},
		cancelRun(runId) {
			return Promise.resolve(runSnapshot({ status: "cancelled", consumed: true }, { runId }));
		},
	});

	const listed = await tools.pibo_run_list.execute("tool-call-1", {
		includeConsumed: true,
		includeDetached: true,
	});
	assert.match(listed.content[0].text, /Runs:/);
	assert.equal(listed.details.runs.length, 1);
	assert.equal(listed.details.runs[0].runId, "run_1");

	const status = await tools.pibo_run_status.execute("tool-call-2", { runId: "run_1" });
	assert.match(status.content[0].text, /Run run_1 status: running/);
	assert.equal(status.details.runId, "run_1");
	assert.equal(status.details.status, "running");

	const cancelled = await tools.pibo_run_cancel.execute("tool-call-3", { runId: "run_1" });
	assert.match(cancelled.content[0].text, /Cancelled run run_1/);
	assert.equal(cancelled.details.runId, "run_1");
	assert.equal(cancelled.details.status, "cancelled");
	assert.equal(cancelled.details.consumed, true);
});

test("router coalesces generic run completion into a compact parent notification", async () => {
	const router = new PiboSessionRouter({ persistSession: false });
	const messages = [];
	router.getOrCreateSession = async () => ({
		enqueueMessage(event) {
			messages.push(event);
			return {
				type: "message_queued",
				piboSessionId: event.piboSessionId,
				eventId: event.id,
				queuedMessages: 1,
				text: event.text,
				source: event.source,
			};
		},
	});

	const controller = router.createRunToolController("parent");
	controller.startToolRun({
		toolName: "helper",
		async execute() {
			return { text: "done" };
		},
	});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(messages.length, 1);
	assert.equal(messages[0].piboSessionId, "parent");
	assert.equal(messages[0].source, "service");
	assert.match(messages[0].text, /<pibo_run_notification>/);
	assert.match(messages[0].text, /"completed"/);
	assert.match(messages[0].text, /"toolName":"helper"/);
	assert.match(messages[0].text, /"runId":"run_/);
});

test("router rejects yielded runs when gateway resource block threshold is crossed", async () => {
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousFree = process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = "999999999999999";
	try {
		const router = new PiboSessionRouter({ persistSession: false });
		const controller = router.createRunToolController("parent");
		assert.throws(
			() => controller.startToolRun({ toolName: "helper", async execute() { return { text: "should not start" }; } }),
			/Gateway resource guard blocked yielded run helper before starting/,
		);
		assert.deepEqual(router.runRegistry.list("parent", { includeConsumed: true, includeDetached: true }), []);
	} finally {
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousFree === undefined) delete process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
		else process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = previousFree;
	}
});

test("router rejects concurrent yielded runs until the active execution settles", async () => {
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousFree = process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
	const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
	const previousMax = process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = "0";
	process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
	process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = "1";
	try {
		const router = new PiboSessionRouter({ persistSession: false });
		let finishFirst;
		const firstFinished = new Promise((resolve) => {
			finishFirst = resolve;
		});
		const controller = router.createRunToolController("parent");
		controller.startToolRun({
			toolName: "bash",
			completionPolicy: "detached",
			async execute() {
				await firstFinished;
				return { text: "first done" };
			},
		});
		assert.throws(
			() => controller.startToolRun({ toolName: "bash", async execute() { return { text: "must not start" }; } }),
			/Active yielded runs 1 reached the configured limit 1/,
		);

		finishFirst();
		await new Promise((resolve) => setImmediate(resolve));
		const next = controller.startToolRun({
			toolName: "bash",
			completionPolicy: "detached",
			async execute() {
				return { text: "next done" };
			},
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent", next.runId).status, "completed");
	} finally {
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousFree === undefined) delete process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
		else process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = previousFree;
		if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
		if (previousMax === undefined) delete process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
		else process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = previousMax;
	}
});

test("pibo_run_cancel aborts the active tool and releases admission before returning", async () => {
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousFree = process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
	const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
	const previousMax = process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = "0";
	process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
	process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = "1";
	try {
		const router = new PiboSessionRouter({ persistSession: false });
		let activeSignal;
		const tools = Object.fromEntries(createRunToolDefinitions([{
			name: "helper",
			async execute(_toolCallId, params, signal) {
				if (!params.wait) return { content: [{ type: "text", text: "done" }] };
				activeSignal = signal;
				return await new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		}], router.createRunToolController("parent")).map((tool) => [tool.name, tool]));

		const started = await tools.pibo_run_start.execute("start-cancelled", {
			toolName: "helper",
			arguments: { wait: true },
			completionPolicy: "tracked",
		});
		await new Promise((resolve) => setImmediate(resolve));
		const cancelled = await tools.pibo_run_cancel.execute("cancel-active", { runId: started.details.runId });
		assert.equal(cancelled.details.status, "cancelled");
		assert.equal(activeSignal.aborted, true);

		const next = await tools.pibo_run_start.execute("start-next", {
			toolName: "helper",
			arguments: { wait: false },
			completionPolicy: "detached",
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent", next.details.runId).status, "completed");
	} finally {
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousFree === undefined) delete process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
		else process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = previousFree;
		if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
		if (previousMax === undefined) delete process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
		else process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = previousMax;
	}
});

test("router converts yielded tool errors into failed run notifications", async () => {
	const router = new PiboSessionRouter({ persistSession: false });
	const messages = [];
	router.getOrCreateSession = async () => ({
		enqueueMessage(event) {
			messages.push(event);
			return {
				type: "message_queued",
				piboSessionId: event.piboSessionId,
				eventId: event.id,
				queuedMessages: 1,
				text: event.text,
				source: event.source,
			};
		},
	});

	const controller = router.createRunToolController("parent");
	const run = controller.startToolRun({
		toolName: "helper",
		async execute() {
			throw new Error("tool failed");
		},
	});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(router.runRegistry.status("parent", run.runId).status, "failed");
	assert.equal(messages.length, 1);
	assert.equal(messages[0].piboSessionId, "parent");
	assert.match(messages[0].text, /"failed"/);
	assert.match(messages[0].text, /"runId":"run_/);
});

test("router emits a distinct timed_out run notification", async () => {
	const router = new PiboSessionRouter({ persistSession: false });
	const messages = [];
	router.getOrCreateSession = async () => ({
		enqueueMessage(event) {
			messages.push(event);
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 1, text: event.text, source: event.source };
		},
	});
	const controller = router.createRunToolController("parent");
	const run = controller.startToolRun({
		toolName: "bash",
		timeoutMs: 1000,
		async execute() { throw new PiboRunExecutionTimeoutError("Command timed out after startup", "lifetime"); },
	});
	await new Promise((resolve) => setImmediate(resolve));

	const status = router.runRegistry.status("parent", run.runId);
	assert.equal(status.status, "timed_out");
	assert.equal(status.timeoutPhase, "lifetime");
	assert.match(messages[0].text, /"timedOut"/);
	assert.match(messages[0].text, /"status":"timed_out"/);
	assert.match(messages[0].text, /"timeoutPhase":"lifetime"/);
});

test("router invalidates stale queued run notifications after read", async () => {
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
	const previousMax = process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
	process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = "2";
	try {
		const router = new PiboSessionRouter({ persistSession: false });
		const messages = [];
		const session = {
			enqueueMessage(event) {
				messages.push(event);
				return {
					type: "message_queued",
					piboSessionId: event.piboSessionId,
					eventId: event.id,
					queuedMessages: messages.length,
					text: event.text,
					source: event.source,
				};
			},
			removeQueuedMessages(predicate) {
				let removed = 0;
				for (let index = messages.length - 1; index >= 0; index -= 1) {
					if (!predicate(messages[index])) continue;
					messages.splice(index, 1);
					removed += 1;
				}
				return removed;
			},
		};
		router.getOrCreateSession = async () => session;
		router.sessions.set("parent", session);

		const controller = router.createRunToolController("parent");
		const consumedRun = controller.startToolRun({
			toolName: "first",
			async execute() {
				return { text: "first done" };
			},
		});
		const pendingRun = controller.startToolRun({
			toolName: "second",
			async execute() {
				return { text: "second done" };
			},
		});
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(messages.length, 1);
		assert.match(messages[0].text, new RegExp(consumedRun.runId));
		assert.match(messages[0].text, new RegExp(pendingRun.runId));

		const read = controller.readRun(consumedRun.runId);
		assert.equal(read.status, "completed");
		assert.equal(read.consumed, true);
		assert.equal(messages.length, 0);

		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(messages.length, 1);
		assert.doesNotMatch(messages[0].text, new RegExp(consumedRun.runId));
		assert.match(messages[0].text, new RegExp(pendingRun.runId));
	} finally {
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
		if (previousMax === undefined) delete process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
		else process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = previousMax;
	}
});
