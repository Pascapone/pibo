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