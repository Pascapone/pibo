import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { PiboRunRegistry } from "../dist/runs/registry.js";
import { isConfiguredTimeoutError, PiboRunCancelledError, PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";
import { createRunToolDefinitions } from "../dist/runs/tools.js";
import { updatePiboGatewaySettings } from "../dist/core/gateway-settings.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { RuntimeSessionRegistry } from "../dist/tools/runtime/registry.js";
import { createRuntimeToolDefinition } from "../dist/tools/runtime/tool.js";

function startRun(registry, options = {}) {
	return registry.startToolRun({
		controllerPiboSessionId: options.controllerPiboSessionId ?? "parent",
		toolName: options.toolName ?? "helper",
		completionPolicy: options.completionPolicy,
	});
}

const defaultPythonExecutable = process.platform === "win32" ? "python" : "python3";
const pythonAvailable = spawnSync(defaultPythonExecutable, ["--version"], { stdio: "ignore" }).status === 0;
const pythonTest = (name, run) => test(name, { skip: pythonAvailable ? false : `${defaultPythonExecutable} is unavailable` }, run);

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

test("tracked notifications preserve their causal origin and do not mix origins", () => {
	const registry = new PiboRunRegistry();
	const firstOrigin = {
		eventId: "loop_msg_first",
		provenance: { kind: "loop-run", jobId: "loop_first", runId: "lrun_first" },
	};
	const secondOrigin = {
		eventId: "loop_msg_second",
		provenance: { kind: "loop-run", jobId: "loop_second", runId: "lrun_second" },
	};
	const first = registry.startToolRun({ controllerPiboSessionId: "parent", toolName: "first", origin: firstOrigin });
	const second = registry.startToolRun({ controllerPiboSessionId: "parent", toolName: "second", origin: secondOrigin });

	const firstNotification = registry.createNotification("parent");
	assert.deepEqual(firstNotification.origin, firstOrigin);
	assert.deepEqual(firstNotification.running.map((run) => run.runId), [first.runId]);
	assert.equal(registry.hasPendingNotification("parent"), true);

	const secondNotification = registry.createNotification("parent");
	assert.deepEqual(secondNotification.origin, secondOrigin);
	assert.deepEqual(secondNotification.running.map((run) => run.runId), [second.runId]);
	assert.equal(registry.hasPendingNotification("parent"), false);
});

test("repeated acknowledgement of the same run state is a no-op", () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);
	let acknowledged = 0;
	registry.subscribe((event) => {
		if (event.type === "run_acknowledged") acknowledged += 1;
	});

	assert.equal(registry.ack("parent", run.runId).changed, true);
	assert.equal(registry.ack("parent", run.runId).changed, false);

	assert.equal(acknowledged, 1);
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
		const origin = {
			eventId: "loop_msg_origin",
			provenance: { kind: "loop-run", jobId: "loop_origin", runId: "lrun_origin" },
		};
		const run = registry.startToolRun({
			controllerPiboSessionId: "parent",
			toolName: "bash",
			completionPolicy: "tracked",
			timeoutMs: 21600000,
			serviceWarning: "foreground service warning",
			origin,
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
		assert.deepEqual(notification.origin, origin);
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

test("registry enumerates active controller runs and commits cancellation only when requested", async () => {
	const registry = new PiboRunRegistry();
	const run = startRun(registry);
	const waited = registry.wait("parent", run.runId, 1000);

	const active = registry.listActiveControllerRuns("parent");
	assert.deepEqual(active.map((candidate) => candidate.runId), [run.runId]);
	assert.equal(registry.status("parent", run.runId).status, "running");

	const cancelled = registry.cancel("parent", run.runId, "test dispose");
	assert.equal(cancelled.status, "cancelled");

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

test("failed notification delivery releases only the unchanged run states for retry", () => {
	const registry = new PiboRunRegistry();
	const retryable = startRun(registry);
	const changed = startRun(registry);
	const notification = registry.createNotification("parent");

	registry.complete(changed.runId, { text: "done" });
	const released = registry.releaseNotification("parent", notification);

	assert.deepEqual(released.map((run) => run.runId), [retryable.runId]);
	assert.equal(registry.hasPendingNotification("parent"), true);
	const retried = registry.createNotification("parent");
	assert.deepEqual(retried.running.map((run) => run.runId), [retryable.runId]);
	assert.deepEqual(retried.completed.map((run) => run.runId), [changed.runId]);
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

test("run cancellation fails visibly and stays non-cancelled when execution does not settle within 15 seconds", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const router = new PiboSessionRouter({ persistSession: false });
	let markExecutionStarted;
	let finishExecution;
	const executionStarted = new Promise((resolve) => { markExecutionStarted = resolve; });
	const executionFinished = new Promise((resolve) => { finishExecution = resolve; });
	const tools = Object.fromEntries(createRunToolDefinitions([{
		name: "helper",
		async execute() {
			markExecutionStarted();
			await executionFinished;
			return { content: [{ type: "text", text: "eventually completed" }] };
		},
	}], router.createRunToolController("parent")).map((tool) => [tool.name, tool]));

	try {
		const started = await tools.pibo_run_start.execute("start-stuck-cancel", {
			toolName: "helper",
			arguments: {},
			completionPolicy: "detached",
		});
		await executionStarted;
		const cancellation = tools.pibo_run_cancel.execute("cancel-stuck-run", { runId: started.details.runId });
		const rejection = assert.rejects(cancellation, (error) => (
			error instanceof AggregateError
			&& error.errors.some((failure) => failure instanceof Error && /did not settle within 15000ms/.test(failure.message))
		));
		await Promise.resolve();
		t.mock.timers.tick(15_000);
		await rejection;
		assert.equal(router.runRegistry.status("parent", started.details.runId).status, "running");

		finishExecution();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent", started.details.runId).status, "completed");
	} finally {
		await router.disposeAll();
	}
});

test("configured timeout detection accepts terminal timeout variants without matching ordinary failure reports", () => {
	assert.equal(isConfiguredTimeoutError("Command timed out after 2 seconds"), true);
	assert.equal(isConfiguredTimeoutError("output\nError: Command timed out after 2 seconds"), true);
	assert.equal(isConfiguredTimeoutError("Timed out after 10ms"), true);
	assert.equal(isConfiguredTimeoutError("Error: Timed out after 10ms."), true);
	assert.equal(isConfiguredTimeoutError("Timeout after 20 seconds"), true);
	assert.equal(isConfiguredTimeoutError("AssertionError: Timed out waiting for condition\nCommand exited with code 1"), false);
	assert.equal(isConfiguredTimeoutError("Timeout option is not supported"), false);
	assert.equal(isConfiguredTimeoutError("Timeout configuration is invalid"), false);
	assert.equal(isConfiguredTimeoutError("Error: timeout value must be an integer"), false);
});

test("generic terminal configured-timeout errors become timed_out runs", async () => {
	const router = new PiboSessionRouter({ persistSession: false });
	const tools = Object.fromEntries(createRunToolDefinitions([{
		name: "helper",
		async execute() { throw new Error("Timed out after 10ms"); },
	}], router.createRunToolController("parent")).map((tool) => [tool.name, tool]));
	try {
		const started = await tools.pibo_run_start.execute("start-generic-timeout", {
			toolName: "helper",
			arguments: { timeoutMs: 10 },
			completionPolicy: "tracked",
		});
		const waited = await tools.pibo_run_wait.execute("wait-generic-timeout", { runId: started.details.runId, timeoutMs: 1000 });
		assert.equal(waited.details.status, "timed_out");
		assert.equal(waited.details.timeoutMs, 10);
		assert.equal(waited.details.timeoutPhase, "startup");
	} finally {
		await router.disposeAll();
	}
});

async function assertRealRuntimeTimeout(runtime) {
	const cwd = mkdtempSync(join(tmpdir(), `pibo-yielded-${runtime}-timeout-`));
	const runtimeRegistry = new RuntimeSessionRegistry({ cwd });
	const router = new PiboSessionRouter({ persistSession: false });
	const runtimeTool = createRuntimeToolDefinition(runtimeRegistry.createController("parent"));
	const runtimeArguments = {
		action: "exec",
		runtime,
		code: runtime === "node" ? "new Promise(() => {})" : "import time\ntime.sleep(2)",
		timeoutMs: 1_000,
		...(runtime === "node" ? { mode: "eval" } : {}),
	};
	const runtimeProxy = {
		name: "runtime-proxy",
		execute(toolCallId, _params, signal, onUpdate, context) {
			return runtimeTool.execute(toolCallId, runtimeArguments, signal, onUpdate, context);
		},
	};
	const tools = Object.fromEntries(createRunToolDefinitions(
		[runtimeProxy],
		router.createRunToolController("parent"),
	).map((tool) => [tool.name, tool]));
	try {
		const started = await tools.pibo_run_start.execute(`start-${runtime}-runtime-timeout`, {
			toolName: "runtime-proxy",
			arguments: {},
			completionPolicy: "tracked",
		});
		const waited = await tools.pibo_run_wait.execute(`wait-${runtime}-runtime-timeout`, {
			runId: started.details.runId,
			timeoutMs: 5_000,
		});
		assert.equal(waited.details.status, "timed_out");
		assert.equal(waited.details.timeoutMs, undefined);
		assert.equal(waited.details.timeoutPhase, "startup");
		const read = await tools.pibo_run_read.execute(`read-${runtime}-runtime-timeout`, { runId: started.details.runId });
		assert.match(read.details.error, /status: timeout/);
		assert.match(read.details.error, /Runtime request exec timed out/);
	} finally {
		await runtimeRegistry.closeAll({ force: true });
		await router.disposeAll();
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("real Node runtime expiry becomes a timed_out yielded run through the structured tool result", async () => {
	await assertRealRuntimeTimeout("node");
});

pythonTest("real Python runtime expiry becomes a timed_out yielded run through the structured tool result", async () => {
	await assertRealRuntimeTimeout("python");
});

test("structured runtime timeout configuration failures remain failed yielded runs", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-yielded-runtime-config-failure-"));
	const runtimeRegistry = new RuntimeSessionRegistry({ cwd });
	const router = new PiboSessionRouter({ persistSession: false });
	const runtimeTool = createRuntimeToolDefinition(runtimeRegistry.createController("parent"));
	const runtimeProxy = {
		name: "runtime-config-proxy",
		execute(toolCallId, _params, signal, onUpdate, context) {
			return runtimeTool.execute(toolCallId, {
				action: "exec",
				runtime: "node",
				code: "1 + 1",
				timeoutMs: 20,
				target: { type: "unsupported" },
			}, signal, onUpdate, context);
		},
	};
	const tools = Object.fromEntries(createRunToolDefinitions(
		[runtimeProxy],
		router.createRunToolController("parent"),
	).map((tool) => [tool.name, tool]));
	try {
		const started = await tools.pibo_run_start.execute("start-runtime-config-failure", {
			toolName: "runtime-config-proxy",
			arguments: {},
			completionPolicy: "tracked",
		});
		const waited = await tools.pibo_run_wait.execute("wait-runtime-config-failure", { runId: started.details.runId, timeoutMs: 5_000 });
		assert.equal(waited.details.status, "failed");
		assert.equal(waited.details.timeoutPhase, undefined);
		const read = await tools.pibo_run_read.execute("read-runtime-config-failure", { runId: started.details.runId });
		assert.match(read.details.error, /runtime\.target\.type must be local, docker, or ssh/);
	} finally {
		await runtimeRegistry.closeAll({ force: true });
		await router.disposeAll();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("timeout configuration failures remain failed runs", async () => {
	const router = new PiboSessionRouter({ persistSession: false });
	const tools = Object.fromEntries(createRunToolDefinitions([{
		name: "helper",
		async execute() { throw new Error("Timeout option is not supported"); },
	}], router.createRunToolController("parent")).map((tool) => [tool.name, tool]));
	try {
		const started = await tools.pibo_run_start.execute("start-timeout-option-failure", {
			toolName: "helper",
			arguments: { timeoutMs: 10 },
			completionPolicy: "tracked",
		});
		const waited = await tools.pibo_run_wait.execute("wait-timeout-option-failure", { runId: started.details.runId, timeoutMs: 1000 });
		assert.equal(waited.details.status, "failed");
		assert.equal(waited.details.timeoutPhase, undefined);
		const read = await tools.pibo_run_read.execute("read-timeout-option-failure", { runId: started.details.runId });
		assert.equal(read.details.error, "Timeout option is not supported");
		assert.equal(read.details.timeoutPhase, undefined);
	} finally {
		await router.disposeAll();
	}
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

test("run ack tool reports changed and unchanged acknowledgements", async () => {
	let calls = 0;
	const tools = createRunToolsWithController({
		ackRun(runId) {
			calls += 1;
			return runSnapshot({ status: "completed", consumed: true, changed: calls === 1 }, { runId });
		},
	});

	const changed = await tools.pibo_run_ack.execute("tool-call-1", { runId: "run_1" });
	const unchanged = await tools.pibo_run_ack.execute("tool-call-2", { runId: "run_1" });

	assert.match(changed.content[0].text, /Acknowledged run run_1/);
	assert.equal(changed.details.changed, true);
	assert.match(unchanged.content[0].text, /already acknowledged/);
	assert.equal(unchanged.details.changed, false);
	assert.equal(unchanged.details.runId, "run_1");
	assert.equal(unchanged.details.status, "completed");
	assert.equal(unchanged.details.consumed, true);
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
	const origin = {
		id: "loop_msg_origin",
		source: "service",
		provenance: { kind: "loop-run", jobId: "loop_origin", runId: "lrun_origin" },
	};
	const session = {
		getActiveMessage() { return origin; },
		removeQueuedMessages() { return 0; },
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
	};
	router.sessions.set("parent", session);
	router.getOrCreateSession = async () => session;

	const controller = router.createRunToolController("parent");
	const run = controller.startToolRun({
		toolName: "helper",
		async execute() {
			return { text: "done" };
		},
	});
	const waited = controller.waitForRun(run.runId, 1_000);
	await new Promise((resolve) => setImmediate(resolve));

	const terminal = await waited;
	assert.equal(terminal.status, "completed");
	assert.equal(terminal.timedOut, false);
	assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].piboSessionId, "parent");
	assert.equal(messages[0].source, "service");
	assert.equal(Object.hasOwn(messages[0], "capabilityScope"), false);
	assert.deepEqual(messages[0].provenance, {
		kind: "loop-run",
		jobId: "loop_origin",
		runId: "lrun_origin",
		cause: "run-reminder",
		rootEventId: "loop_msg_origin",
	});
	assert.match(messages[0].text, /<pibo_run_notification>/);
	assert.match(messages[0].text, /"completed"/);
	assert.match(messages[0].text, /"toolName":"helper"/);
	assert.match(messages[0].text, new RegExp(`"runId":"${run.runId}"`));

	assert.equal(controller.readRun(run.runId).consumed, true);
	router.emitOutput({
		type: "message_finished",
		piboSessionId: "parent",
		eventId: "later-parent-turn",
		source: "user",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(messages.length, 1, "a consumed terminal run must not produce a duplicate reminder");
	assert.equal(router.runRegistry.hasPendingNotification("parent", { includeAlreadyNotified: true }), false);
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
			/Active yielded runs 1 reached the configured gateway limit 1/,
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

test("router enforces yielded-run concurrency per controlling session", async () => {
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousFree = process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
	const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
	const previousGatewayMax = process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
	const previousSessionMax = process.env.PIBO_SESSION_CONCURRENT_YIELDED_RUNS;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = "0";
	process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
	process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = "3";
	process.env.PIBO_SESSION_CONCURRENT_YIELDED_RUNS = "1";
	try {
		const router = new PiboSessionRouter({ persistSession: false });
		let finishFirst;
		const firstFinished = new Promise((resolve) => {
			finishFirst = resolve;
		});
		const firstController = router.createRunToolController("parent-a");
		firstController.startToolRun({
			toolName: "subagent",
			completionPolicy: "detached",
			async execute() {
				await firstFinished;
				return { text: "first done" };
			},
		});
		assert.throws(
			() => firstController.startToolRun({ toolName: "subagent", async execute() { return { text: "must not start" }; } }),
			/parent-a .*configured session limit 1/,
		);

		const otherController = router.createRunToolController("parent-b");
		const other = otherController.startToolRun({
			toolName: "subagent",
			completionPolicy: "detached",
			async execute() {
				return { text: "other done" };
			},
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent-b", other.runId).status, "completed");

		finishFirst();
		await new Promise((resolve) => setImmediate(resolve));
		const next = firstController.startToolRun({
			toolName: "subagent",
			completionPolicy: "detached",
			async execute() {
				return { text: "next done" };
			},
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent-a", next.runId).status, "completed");
	} finally {
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousFree === undefined) delete process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
		else process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = previousFree;
		if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
		if (previousGatewayMax === undefined) delete process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
		else process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = previousGatewayMax;
		if (previousSessionMax === undefined) delete process.env.PIBO_SESSION_CONCURRENT_YIELDED_RUNS;
		else process.env.PIBO_SESSION_CONCURRENT_YIELDED_RUNS = previousSessionMax;
	}
});

test("router applies persisted concurrency changes without restart", async () => {
	const originalPiboHome = process.env.PIBO_HOME;
	const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
	const previousFree = process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
	const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
	const dir = mkdtempSync(join(tmpdir(), "pibo-run-concurrency-live-settings-"));
	process.env.PIBO_HOME = dir;
	process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
	process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = "0";
	process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
	try {
		updatePiboGatewaySettings({ maxConcurrentYieldedRuns: 3, sessionConcurrentYieldedRuns: 1 });
		const router = new PiboSessionRouter({ persistSession: false });
		let finishFirst;
		let finishSecond;
		const firstFinished = new Promise((resolve) => {
			finishFirst = resolve;
		});
		const secondFinished = new Promise((resolve) => {
			finishSecond = resolve;
		});
		const controller = router.createRunToolController("parent");
		controller.startToolRun({
			toolName: "subagent",
			completionPolicy: "detached",
			async execute() {
				await firstFinished;
				return { text: "first done" };
			},
		});
		assert.throws(
			() => controller.startToolRun({ toolName: "subagent", async execute() { return { text: "blocked" }; } }),
			/configured session limit 1/,
		);

		updatePiboGatewaySettings({ sessionConcurrentYieldedRuns: 2 });
		const second = controller.startToolRun({
			toolName: "subagent",
			completionPolicy: "detached",
			async execute() {
				await secondFinished;
				return { text: "second done" };
			},
		});
		assert.equal(router.runRegistry.status("parent", second.runId).status, "running");
		finishFirst();
		finishSecond();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(router.runRegistry.status("parent", second.runId).status, "completed");
	} finally {
		if (originalPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = originalPiboHome;
		if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
		if (previousFree === undefined) delete process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES;
		else process.env.PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES = previousFree;
		if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
		rmSync(dir, { recursive: true, force: true });
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
		const waited = router.runRegistry.wait("parent", started.details.runId, 1_000);
		await new Promise((resolve) => setImmediate(resolve));
		const cancelled = await tools.pibo_run_cancel.execute("cancel-active", { runId: started.details.runId });
		assert.equal(cancelled.details.status, "cancelled");
		assert.equal(activeSignal.aborted, true);
		const terminal = await waited;
		assert.equal(terminal.status, "cancelled");
		assert.equal(terminal.timedOut, false);
		assert.equal(router.runRegistry.hasPendingNotification("parent", { includeAlreadyNotified: true }), false);
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);

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

const bulkTeardownScenarios = [
	{
		name: "killSession",
		prepare(router) {
			router.sessions.set("parent", {
				async kill() { return "parent"; },
				async dispose() {},
				forceDispose() {},
				removeQueuedMessages() { return 0; },
			});
		},
		invoke(router) { return router.killSession("parent", { includeRuns: true }); },
	},
	{
		name: "subtree disposal",
		prepare() {},
		invoke(router) { return router.disposeSession("parent", "test subtree disposal"); },
	},
	{
		name: "router disposal",
		prepare() {},
		invoke(router) { return router.disposeAll(); },
	},
];

function startBulkTeardownRun(router, mode) {
	let markCancellationStarted;
	const cancellationStarted = new Promise((resolve) => { markCancellationStarted = resolve; });
	let releaseCancellation;
	const cancellationGate = new Promise((resolve) => { releaseCancellation = resolve; });
	let resolveExecution;
	let rejectExecution;
	const execution = new Promise((resolve, reject) => {
		resolveExecution = resolve;
		rejectExecution = reject;
	});
	const run = router.createRunToolController("parent").startToolRun({
		toolName: "helper",
		completionPolicy: "tracked",
		async cancel() {
			markCancellationStarted();
			if (mode === "rejected") throw new Error("cancellation rejected");
			if (mode === "nonsettling") return await new Promise(() => {});
			await cancellationGate;
			rejectExecution(new PiboRunCancelledError("controlled cancellation settled"));
		},
		async execute() {
			return await execution;
		},
	});
	return {
		run,
		cancellationStarted,
		releaseCancellation,
		finishExecution: () => resolveExecution({ text: "late completion" }),
	};
}

async function cleanupBulkTeardownFixture(router, store, scenario) {
	if (scenario.name !== "router disposal") await router.disposeAll();
	store.close();
}

for (const scenario of bulkTeardownScenarios) {
	test(`${scenario.name} publishes cancelled only after confirmed settlement`, async () => {
		const store = new PiboReliabilityStore(":memory:");
		const router = new PiboSessionRouter({ persistSession: false, reliabilityStore: store });
		scenario.prepare(router);
		const changed = [];
		router.runRegistry.subscribe((event) => {
			if (event.type === "run_changed") changed.push(event.run.status);
		});
		const controlled = startBulkTeardownRun(router, "confirmed");
		let waiterSettled = false;
		const waiter = router.runRegistry.wait("parent", controlled.run.runId, 100_000).then((result) => {
			waiterSettled = true;
			return result;
		});
		const teardown = scenario.invoke(router);
		await controlled.cancellationStarted;

		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "running");
		assert.equal(store.getRun(controlled.run.runId).status, "running");
		assert.equal(waiterSettled, false);
		assert.equal(changed.includes("cancelled"), false);
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 1);

		controlled.releaseCancellation();
		await teardown;
		const waited = await waiter;
		assert.equal(waited.status, "cancelled");
		assert.equal(waited.timedOut, false);
		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "cancelled");
		assert.equal(store.getRun(controlled.run.runId).status, "cancelled");
		assert.deepEqual(changed.filter((status) => status === "cancelled"), ["cancelled"]);
		assert.equal(router.runRegistry.hasPendingNotification("parent"), false);
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
		await cleanupBulkTeardownFixture(router, store, scenario);
	});

	test(`${scenario.name} leaves rejected cancellation non-cancelled and admitted until execution settles`, async () => {
		const store = new PiboReliabilityStore(":memory:");
		const router = new PiboSessionRouter({ persistSession: false, reliabilityStore: store });
		scenario.prepare(router);
		const changed = [];
		router.runRegistry.subscribe((event) => {
			if (event.type === "run_changed") changed.push(event.run.status);
		});
		const controlled = startBulkTeardownRun(router, "rejected");
		let waiterSettled = false;
		const waiter = router.runRegistry.wait("parent", controlled.run.runId, 100_000).then((result) => {
			waiterSettled = true;
			return result;
		});
		await assert.rejects(scenario.invoke(router), /cancellation rejected|Failed to/);
		await controlled.cancellationStarted;

		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "running");
		assert.equal(store.getRun(controlled.run.runId).status, "running");
		assert.equal(waiterSettled, false);
		assert.equal(changed.includes("cancelled"), false);
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 1);

		controlled.finishExecution();
		const waited = await waiter;
		assert.equal(waited.status, "completed");
		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "completed");
		assert.equal(store.getRun(controlled.run.runId).status, "completed");
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
		await cleanupBulkTeardownFixture(router, store, scenario);
	});

	test(`${scenario.name} bounds non-settling cancellation without a false cancelled state`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const store = new PiboReliabilityStore(":memory:");
		const router = new PiboSessionRouter({ persistSession: false, reliabilityStore: store });
		scenario.prepare(router);
		const changed = [];
		router.runRegistry.subscribe((event) => {
			if (event.type === "run_changed") changed.push(event.run.status);
		});
		const controlled = startBulkTeardownRun(router, "nonsettling");
		let waiterSettled = false;
		const waiter = router.runRegistry.wait("parent", controlled.run.runId, 100_000).then((result) => {
			waiterSettled = true;
			return result;
		});
		const teardown = scenario.invoke(router);
		await controlled.cancellationStarted;
		await Promise.resolve();
		t.mock.timers.tick(15_000);
		await assert.rejects(teardown, /did not settle within 15000ms|Failed to/);

		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "running");
		assert.equal(store.getRun(controlled.run.runId).status, "running");
		assert.equal(waiterSettled, false);
		assert.equal(changed.includes("cancelled"), false);
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 1);

		controlled.finishExecution();
		const waited = await waiter;
		assert.equal(waited.status, "completed");
		assert.equal(router.runRegistry.status("parent", controlled.run.runId).status, "completed");
		assert.equal(store.getRun(controlled.run.runId).status, "completed");
		assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
		await cleanupBulkTeardownFixture(router, store, scenario);
	});
}

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
	const waited = controller.waitForRun(run.runId, 1_000);
	await new Promise((resolve) => setImmediate(resolve));

	const terminal = await waited;
	assert.equal(terminal.status, "failed");
	assert.equal(terminal.timedOut, false);
	assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
	assert.equal(router.runRegistry.status("parent", run.runId).status, "failed");
	assert.equal(messages.length, 1);
	assert.equal(messages[0].piboSessionId, "parent");
	assert.match(messages[0].text, /"failed"/);
	assert.match(messages[0].text, new RegExp(`"runId":"${run.runId}"`));
	assert.equal(controller.readRun(run.runId).consumed, true);
	router.emitOutput({ type: "message_finished", piboSessionId: "parent", eventId: "later-failed-turn", source: "user" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(messages.length, 1, "a consumed failed run must not produce a duplicate reminder");
	assert.equal(router.runRegistry.hasPendingNotification("parent", { includeAlreadyNotified: true }), false);
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
	const waited = controller.waitForRun(run.runId, 1_000);
	await new Promise((resolve) => setImmediate(resolve));

	const terminal = await waited;
	assert.equal(terminal.status, "timed_out");
	assert.equal(terminal.timedOut, false);
	assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
	const status = router.runRegistry.status("parent", run.runId);
	assert.equal(status.status, "timed_out");
	assert.equal(status.timeoutPhase, "lifetime");
	assert.match(messages[0].text, /"timedOut"/);
	assert.match(messages[0].text, /"status":"timed_out"/);
	assert.match(messages[0].text, /"timeoutPhase":"lifetime"/);
	assert.equal(controller.readRun(run.runId).consumed, true);
	router.emitOutput({ type: "message_finished", piboSessionId: "parent", eventId: "later-timeout-turn", source: "user" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(messages.length, 1, "a consumed timed-out run must not produce a duplicate reminder");
	assert.equal(router.runRegistry.hasPendingNotification("parent", { includeAlreadyNotified: true }), false);
});

if (process.platform === "win32") {
	test("pibo_run_cancel terminates a native Windows Bash process tree and releases admission", async (t) => {
		const root = mkdtempSync(join(tmpdir(), "pibo-windows-yielded-tree-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const pidPath = join(root, "child.pid");
		const heartbeatPath = join(root, "heartbeat.txt");
		const readyPath = join(root, "ready.txt");
		const previousIsolation = process.env.PIBO_YIELDED_RUN_ISOLATION;
		const previousMode = process.env.PIBO_GATEWAY_RESOURCE_GUARD;
		const previousReservation = process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
		const previousMax = process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
		process.env.PIBO_YIELDED_RUN_ISOLATION = "windows-process-tree";
		process.env.PIBO_GATEWAY_RESOURCE_GUARD = "block";
		process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = "0";
		process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = "1";
		let childPid;
		const router = new PiboSessionRouter({ persistSession: false });
		try {
			const bash = createBashTool(process.cwd());
			const tools = Object.fromEntries(createRunToolDefinitions(
				[bash],
				router.createRunToolController("parent"),
			).map((tool) => [tool.name, tool]));
			const childScript = [
				'const fs=require("node:fs");',
				'fs.writeFileSync(process.argv[1],String(process.pid));',
				'setInterval(()=>fs.appendFileSync(process.argv[2],"."),40);',
			].join("");
			const command = [
				`node -e ${bashQuote(childScript)} ${bashQuote(windowsPathForBash(pidPath))} ${bashQuote(windowsPathForBash(heartbeatPath))} &`,
				"child=$!",
				`printf ready > ${bashQuote(windowsPathForBash(readyPath))}`,
				'wait "$child"',
			].join("\n");
			const started = await tools.pibo_run_start.execute("start-windows-tree", {
				toolName: "bash",
				arguments: { command },
				completionPolicy: "tracked",
			});
			await waitFor(() => existsSync(readyPath) && existsSync(pidPath), 10_000);
			childPid = Number(readFileSync(pidPath, "utf8"));
			assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
			assert.equal(isProcessAlive(childPid), true);
			await waitFor(() => existsSync(heartbeatPath) && readFileSync(heartbeatPath).length > 0, 5_000);

			const cancelled = await tools.pibo_run_cancel.execute("cancel-windows-tree", { runId: started.details.runId });
			assert.equal(cancelled.details.status, "cancelled");
			assert.equal(cancelled.details.resources.isolationMode, "windows-process-tree");
			await waitFor(() => !isProcessAlive(childPid), 10_000);
			const heartbeatBytes = readFileSync(heartbeatPath).length;
			await new Promise((resolve) => setTimeout(resolve, 250));
			assert.equal(readFileSync(heartbeatPath).length, heartbeatBytes, "cancelled child must stop writing");

			const replacement = await tools.pibo_run_start.execute("start-windows-replacement", {
				toolName: "bash",
				arguments: { command: "printf replacement" },
				completionPolicy: "tracked",
			});
			const settled = await tools.pibo_run_wait.execute("wait-windows-replacement", {
				runId: replacement.details.runId,
				timeoutMs: 10_000,
			});
			assert.equal(settled.details.status, "completed");
			const read = await tools.pibo_run_read.execute("read-windows-replacement", { runId: replacement.details.runId });
			assert.match(read.content[0].text, /replacement/);
		} finally {
			if (childPid && isProcessAlive(childPid)) {
				try { process.kill(childPid, "SIGKILL"); } catch {}
			}
			await router.disposeAll();
			if (previousIsolation === undefined) delete process.env.PIBO_YIELDED_RUN_ISOLATION;
			else process.env.PIBO_YIELDED_RUN_ISOLATION = previousIsolation;
			if (previousMode === undefined) delete process.env.PIBO_GATEWAY_RESOURCE_GUARD;
			else process.env.PIBO_GATEWAY_RESOURCE_GUARD = previousMode;
			if (previousReservation === undefined) delete process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES;
			else process.env.PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES = previousReservation;
			if (previousMax === undefined) delete process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS;
			else process.env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS = previousMax;
		}
	});
}

function windowsPathForBash(path) {
	return path.replaceAll("\\", "/");
}

function bashQuote(value) {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail(`Condition did not become true within ${timeoutMs}ms`);
}

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
