import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRoutedSession } from "../dist/agent-runtime/routed-session.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";

function waitFor(predicate, timeoutMs = 2_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (predicate()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting: ${timeoutMs}ms`));
			setTimeout(tick, 10);
		};
		tick();
	});
}

test("run-reminder turns keep the normal toolset and stop repeated identical tool loops via the bounded guard", async () => {
	const events = [];
	let listener;
	let aborts = 0;
	let promptCall;
	const runtimeSession = {
		getNativeCompatibilityHandle() { return this; },
		subscribe(next) { listener = next; return () => {}; },
		getStatus() { return { streaming: false }; },
		async prompt(input) {
			promptCall = input;
			for (let index = 0; index < 13; index += 1) {
				listener({ type: "tool_execution_started", toolCallId: `tool-${index}`, toolName: "pibo_run_status", args: { runId: "run-1" } });
			}
		},
		async abort() { aborts += 1; },
		async dispose() {},
	};
	const routed = new RuntimeRoutedSession(
		"ps_guard",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
	);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_guard",
		id: "reminder-guard",
		text: "<pibo_run_notification>{}</pibo_run_notification>",
		source: "service",
	});

	await waitFor(() => events.some((event) => event.type === "session_error" && event.errorDetails?.code === "run_reminder_limit_exceeded"));

	// Run reminders are NOT capability-scoped: the runtime prompt receives no run-reminder scope.
	assert.equal(promptCall?.capabilityScope, undefined);
	// The bounded guard stops runaway repeated identical tool calls and aborts the runtime.
	assert.equal(aborts, 1);
	assert.equal(events.some((event) => event.type === "message_finished" && event.eventId === "reminder-guard"), false);
	// No capability-scoping narrows the toolset on a reminder turn.
	assert.equal(events.some((event) => event.type === "session_error" && /capabil/i.test(String(event.error))), false);
	await routed.dispose();
});

test("run-reminder token guard excludes repeated provider cache reads", async () => {
	const events = [];
	let listener;
	let aborts = 0;
	const runtimeSession = {
		getNativeCompatibilityHandle() { return this; },
		subscribe(next) { listener = next; return () => {}; },
		getStatus() { return { streaming: false }; },
		async prompt() {
			for (let round = 0; round < 9; round += 1) {
				listener({
					type: "usage",
					usage: {
						inputTokens: 4_000,
						outputTokens: 1_000,
						cacheReadTokens: 245_000,
						totalTokens: 250_000,
					},
				});
			}
		},
		async abort() { aborts += 1; },
		async dispose() {},
	};
	const routed = new RuntimeRoutedSession(
		"ps_cache_guard",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
	);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_cache_guard",
		id: "cache-heavy-reminder",
		text: "<pibo_run_notification>{}</pibo_run_notification>",
		source: "service",
	});

	await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === "cache-heavy-reminder"));
	assert.equal(aborts, 0);
	assert.equal(events.some((event) => event.type === "session_error" && event.errorDetails?.code === "run_reminder_limit_exceeded"), false);
	await routed.dispose();
});

test("run-reminder token guard still stops excessive active token usage", async () => {
	const events = [];
	let listener;
	let aborts = 0;
	const runtimeSession = {
		getNativeCompatibilityHandle() { return this; },
		subscribe(next) { listener = next; return () => {}; },
		getStatus() { return { streaming: false }; },
		async prompt() {
			listener({
				type: "usage",
				usage: { inputTokens: 2_000_001, outputTokens: 0, cacheReadTokens: 0, totalTokens: 2_000_001 },
			});
		},
		async abort() { aborts += 1; },
		async dispose() {},
	};
	const routed = new RuntimeRoutedSession(
		"ps_active_guard",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
	);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_active_guard",
		id: "active-heavy-reminder",
		text: "<pibo_run_notification>{}</pibo_run_notification>",
		source: "service",
	});

	await waitFor(() => events.some((event) => event.type === "session_error" && event.errorDetails?.code === "run_reminder_limit_exceeded"));
	assert.equal(aborts, 1);
	assert.match(events.find((event) => event.type === "session_error")?.error ?? "", /active tokens/);
	await routed.dispose();
});

for (const terminalGroup of ["completed", "failed", "timedOut"]) {
	test(`${terminalGroup} run reminders enqueued while the previous drain settles are delivered exactly once`, async () => {
		const events = [];
		const prompts = [];
		const reminderText = `<pibo_run_notification>{"${terminalGroup}":[{"runId":"run-terminal","toolName":"helper"}]}</pibo_run_notification>`;
		let routed;
		const runtimeSession = {
			getNativeCompatibilityHandle() { return this; },
			subscribe() { return () => {}; },
			getStatus() { return { streaming: false }; },
			async prompt(input) { prompts.push(input.text); },
			async abort() {},
			async dispose() {},
		};
		const emit = (event) => {
			events.push(event);
			if (event.type !== "message_finished" || event.eventId !== "initial-message") return;
			// The nested microtask runs after drain() has observed an empty queue but before
			// drainPromise.finally() clears the settled drain ownership marker.
			queueMicrotask(() => {
				void Promise.resolve().then(() => {
					routed.enqueueMessage({
						type: "message",
						piboSessionId: "ps_reminder_race",
						id: `run-reminder-${terminalGroup}`,
						text: reminderText,
						source: "service",
					});
				});
			});
		};
		routed = new RuntimeRoutedSession(
			"ps_reminder_race",
			runtimeSession,
			emit,
			PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		);
		const reminderId = `run-reminder-${terminalGroup}`;

		routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_reminder_race",
			id: "initial-message",
			text: "start work",
			source: "actor",
		});

		await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === reminderId));
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(prompts, ["start work", reminderText]);
		for (const type of ["message_queued", "message_started", "message_finished"]) {
			assert.equal(
				events.filter((event) => event.type === type && event.eventId === reminderId).length,
				1,
				`${terminalGroup} reminder must emit exactly one ${type}`,
			);
		}
		await routed.dispose();
	});
}
