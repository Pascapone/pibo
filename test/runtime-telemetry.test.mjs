import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboProviderTelemetryRecorder } from "../dist/core/provider-telemetry.js";
import { PiboRuntimeTelemetryRecorder, turnIdForEvent } from "../dist/core/runtime-telemetry.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-runtime-telemetry-payloads-")) });
}

const session = {
	id: "ps_runtime_telemetry",
	piSessionId: "11111111-2222-4333-8444-555555555555",
	channel: "pibo.test",
	kind: "chat",
	profile: "test-profile",
	ownerScope: "user:test",
	metadata: { chatRoomId: "room_runtime_telemetry" },
	createdAt: "2026-05-16T00:00:00.000Z",
	updatedAt: "2026-05-16T00:00:00.000Z",
};

function status(queuedMessages = 0) {
	return {
		piboSessionId: session.id,
		queuedMessages,
		processing: queuedMessages > 0,
		streaming: false,
		activeTools: [],
		enabledTools: [],
		cwd: process.cwd(),
		disposed: false,
	};
}

function phaseByName(timeline, name) {
	return timeline.phases.find((phase) => phase.name === name);
}

function providerRecorder(store) {
	return new PiboProviderTelemetryRecorder({
		store: store.telemetry,
		session,
		model: { provider: "openai", id: "gpt-test", api: "openai-responses" },
	});
}

test("runtime telemetry records queued, started, and completed turn lifecycle", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_lifecycle";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 3, text: "hello", source: "ui" }, { session, status: status(3) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "hello", source: "ui" }, { session, status: status(2) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "ui" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.piboSessionId, session.id);
		assert.equal(timeline.turn.roomId, "room_runtime_telemetry");
		assert.equal(timeline.turn.source, "ui");
		assert.equal(timeline.turn.status, "ok");
		assert.equal(timeline.turn.queuedBehind, 2);
		assert.equal(timeline.turn.queueDepth, 0);
		assert.equal(timeline.turn.eventId, eventId);
		assert.deepEqual(timeline.phases.map((phase) => [phase.name, phase.status]), [
			["queued", "ok"],
			["message_started", "ok"],
			["finish", "ok"],
		]);
	} finally {
		store.close();
	}
});

test("runtime telemetry marks active turns errored from session errors", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_error";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "boom", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "boom", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "session_error", piboSessionId: session.id, eventId, error: "Provider failed with a safe summary" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "error");
		assert.equal(timeline.turn.currentPhase, "error");
		assert.equal(timeline.phases.at(-1).name, "error");
		assert.equal(timeline.phases.at(-1).status, "error");
		assert.equal(timeline.phases.at(-1).summary, "Provider failed with a safe summary");
	} finally {
		store.close();
	}
});

test("runtime telemetry marks active turns aborted from abort execution results", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_abort";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "stop", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "stop", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "execution_result", piboSessionId: session.id, action: "abort", result: { aborted: true } }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "aborted");
		assert.equal(timeline.turn.currentPhase, "abort");
		assert.equal(timeline.phases.at(-1).name, "abort");
		assert.equal(timeline.phases.at(-1).status, "aborted");
	} finally {
		store.close();
	}
});

test("runtime telemetry captures assistant and reasoning phase transitions from normalized events", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_assistant_phases";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "hello", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "hello", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_started", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0 }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_delta", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0, text: "hidden reasoning" }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_finished", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0 }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 1, text: "visible answer" }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_message", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 1, text: "visible answer" }, { session, status: status(0) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "ok");
		assert.equal(phaseByName(timeline, "message_started").status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "ok");
		assert.equal(phaseByName(timeline, "reasoning").status, "ok");
		assert.equal(phaseByName(timeline, "assistant_text").status, "ok");
		assert.equal(phaseByName(timeline, "finish").status, "ok");
	} finally {
		store.close();
	}
});

test("runtime telemetry keeps partial tool args open and links completed tool execution phases", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_tool_phases";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "use a tool", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "use a tool", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo" }, argsComplete: false }, { session, status: status(0) });

		let timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.currentPhase, "tool_args");
		assert.equal(phaseByName(timeline, "tool_args").status, "open");
		assert.equal(phaseByName(timeline, "tool_args").toolCallId, "call_runtime_1");

		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" }, argsComplete: true }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_started", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" } }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_updated", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" }, partialResult: "short" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_finished", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", result: "done", isError: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" }, { session, status: status(0) });

		timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "ok");
		assert.equal(phaseByName(timeline, "tool_args").status, "ok");
		assert.equal(phaseByName(timeline, "tool_execution").status, "ok");
		assert.equal(phaseByName(timeline, "tool_execution").toolCallId, "call_runtime_1");
	} finally {
		store.close();
	}
});

test("runtime telemetry captures tool-call argument progress metadata without storing args", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_tool_arg_metadata";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "tools", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "tools", source: "user" }, { session, status: status(0) });

		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_empty", toolName: "bash", args: "", argsComplete: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_partial", toolName: "bash", args: "{\"command\":", argsComplete: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_invalid", toolName: "bash", args: "{not json]", argsComplete: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_valid_incomplete", toolName: "bash", args: { command: "secret value" }, argsComplete: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_complete", toolName: "read", args: { path: "secret/path.txt" }, argsComplete: true }, { session, status: status(0) });

		assert.equal(store.telemetry.getToolCall("call_empty").status, "args_started");
		assert.equal(store.telemetry.getToolCall("call_empty").parseStatus, "empty");
		assert.equal(store.telemetry.getToolCall("call_partial").parseStatus, "partial");
		assert.equal(store.telemetry.getToolCall("call_invalid").parseStatus, "invalid");
		const incomplete = store.telemetry.getToolCall("call_valid_incomplete");
		assert.equal(incomplete.status, "args_partial");
		assert.equal(incomplete.parseStatus, "valid");
		assert.deepEqual(incomplete.safeArgKeys, ["command"]);
		assert.ok(incomplete.firstDeltaAt);
		assert.ok(incomplete.lastDeltaAt);
		const complete = store.telemetry.getToolCall("call_complete");
		assert.equal(complete.status, "args_complete");
		assert.equal(complete.parseStatus, "complete");
		assert.ok(complete.argsCompletedAt);
		assert.deepEqual(complete.safeArgKeys, ["path"]);
		assert.equal(JSON.stringify(store.telemetry.getTurnTimeline(turnIdForEvent(eventId))).includes("secret value"), false);
		assert.equal(JSON.stringify(complete).includes("secret/path.txt"), false);
	} finally {
		store.close();
	}
});

test("runtime telemetry captures tool execution lifecycle rows", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_tool_execution_rows";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "exec", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "exec", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_exec_ok", toolName: "bash", args: { command: "echo secret" }, argsComplete: true }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_started", piboSessionId: session.id, eventId, toolCallId: "call_exec_ok", toolName: "bash", args: { command: "echo secret" } }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_updated", piboSessionId: session.id, eventId, toolCallId: "call_exec_ok", toolName: "bash", args: { command: "echo secret" }, partialResult: "large stdout not persisted" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_finished", piboSessionId: session.id, eventId, toolCallId: "call_exec_ok", toolName: "bash", result: "full stdout not persisted", isError: false }, { session, status: status(0) });

		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_exec_error", toolName: "read", args: { path: "secret.txt" }, argsComplete: true }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_started", piboSessionId: session.id, eventId, toolCallId: "call_exec_error", toolName: "read", args: { path: "secret.txt" } }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_finished", piboSessionId: session.id, eventId, toolCallId: "call_exec_error", toolName: "read", result: { message: "permission denied", stdout: "large secret stdout" }, isError: true }, { session, status: status(0) });

		const ok = store.telemetry.getToolCall("call_exec_ok");
		assert.equal(ok.status, "ok");
		assert.ok(ok.executionStartedAt);
		assert.ok(ok.executionEndedAt);
		assert.equal(typeof ok.durationMs, "number");
		assert.equal(JSON.stringify(ok).includes("echo secret"), false);
		assert.equal(JSON.stringify(ok).includes("full stdout"), false);
		const failed = store.telemetry.getToolCall("call_exec_error");
		assert.equal(failed.status, "error");
		assert.equal(failed.errorCategory, "tool_error");
		assert.equal(failed.errorMessage, "permission denied");
		assert.equal(JSON.stringify(failed).includes("large secret stdout"), false);
	} finally {
		store.close();
	}
});

test("runtime telemetry marks started tool execution aborted when the turn aborts", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_tool_execution_abort";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "abort exec", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "abort exec", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_abort_exec", toolName: "bash", args: { command: "sleep 10" }, argsComplete: true }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_started", piboSessionId: session.id, eventId, toolCallId: "call_abort_exec", toolName: "bash", args: { command: "sleep 10" } }, { session, status: status(0) });
		recorder.recordOutput({ type: "execution_result", piboSessionId: session.id, action: "abort", result: { aborted: true } }, { session, status: status(0) });

		const aborted = store.telemetry.getToolCall("call_abort_exec");
		assert.equal(aborted.status, "aborted");
		assert.equal(aborted.errorCategory, "runtime_aborted");
		assert.ok(aborted.executionEndedAt);
	} finally {
		store.close();
	}
});

test("runtime telemetry marks open normalized phases errored when the turn errors", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_phase_error";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "fail", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "fail", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 0, text: "partial" }, { session, status: status(0) });
		recorder.recordOutput({ type: "session_error", piboSessionId: session.id, eventId, error: "stream parser failed safely" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "error");
		assert.equal(phaseByName(timeline, "provider_stream").status, "error");
		assert.equal(phaseByName(timeline, "assistant_text").status, "error");
		assert.equal(phaseByName(timeline, "error").status, "error");
	} finally {
		store.close();
	}
});

test("provider telemetry records completed request lifecycle from provider hooks and normalized events", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_complete";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "hello", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "hello", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test", service_tier: "priority", input: "not persisted" }, { at: "2026-05-16T00:00:01.000Z" });
		provider.recordResponse({ status: 200, headers: { authorization: "Bearer not-persisted" }, at: "2026-05-16T00:00:02.000Z" });
		runtime.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 0, text: "partial answer" }, { session, status: status(0) });
		runtime.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.providerRequests.length, 1);
		const request = timeline.providerRequests[0];
		assert.equal(request.provider, "openai");
		assert.equal(request.api, "openai-responses");
		assert.equal(request.model, "gpt-test");
		assert.equal(request.serviceTier, "priority");
		assert.equal(request.status, "completed");
		assert.equal(request.httpStatus, 200);
		assert.equal(request.firstByteAt, "2026-05-16T00:00:02.000Z");
		assert.ok(request.lastNormalizedEventAt);
		assert.equal(request.normalizedEventCount, 1);
		assert.equal(request.rawEventCount, 0);
		assert.equal(request.captureMode, "metadata_only");
		assert.equal(phaseByName(timeline, "provider_request").status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").providerRequestId, request.providerRequestId);
	} finally {
		store.close();
	}
});

test("runtime telemetry records bounded Pi provider event metadata without payload bodies", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_event_metadata";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "tool", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "tool", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test" }, { at: "2026-05-16T00:00:01.000Z" });
		provider.recordResponse({ status: 200, headers: {}, at: "2026-05-16T00:00:02.000Z" });
		runtime.recordPiEvent(session.id, {
			type: "message_update",
			assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command":"secret value"}' },
			message: {
				role: "assistant",
				responseId: "resp_provider_event_metadata",
				content: [{ type: "toolCall", id: "call_runtime_meta|item_runtime_meta", name: "bash", arguments: { command: "secret value" } }],
			},
		}, { session, status: status(0), activeEventId: eventId });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		const request = timeline.providerRequests[0];
		assert.equal(request.rawEventCount, 1);
		assert.equal(request.normalizedEventCount, 0);
		assert.equal(request.upstreamResponseId, "resp_provider_event_metadata");
		assert.ok(request.lastRawEventAt);
		assert.deepEqual(request.eventTypeCounts, { "pi.toolcall_delta": 1 });
		const events = store.telemetry.listProviderEvents(request.providerRequestId);
		assert.equal(events.length, 1);
		assert.equal(events[0].eventType, "pi.toolcall_delta");
		assert.equal(events[0].parseStatus, "ok");
		assert.equal(events[0].normalizedType, "tool_call");
		assert.equal(events[0].toolCallId, "call_runtime_meta|item_runtime_meta");
		assert.equal(events[0].itemId, "item_runtime_meta");
		assert.equal(events[0].safeFields.toolName, "bash");
		assert.equal(typeof events[0].safeFields.deltaBytes, "number");
		assert.equal(typeof events[0].safeFields.argsBytes, "number");
		assert.equal(JSON.stringify(events[0]).includes("secret value"), false);
	} finally {
		store.close();
	}
});

test("provider telemetry marks active provider requests aborted with no raw payload capture", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_abort";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "abort", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "abort", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test" }, { at: "2026-05-16T00:01:01.000Z" });
		provider.recordResponse({ status: 200, headers: {}, at: "2026-05-16T00:01:02.000Z" });
		runtime.recordOutput({ type: "execution_result", piboSessionId: session.id, action: "abort", result: { aborted: true } }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.providerRequests[0].status, "aborted");
		assert.equal(timeline.providerRequests[0].completedAt !== undefined, true);
		assert.equal(phaseByName(timeline, "provider_stream").status, "aborted");
	} finally {
		store.close();
	}
});

test("provider telemetry marks active provider requests errored safely", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_error";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "error", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "error", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test" }, { at: "2026-05-16T00:02:01.000Z" });
		runtime.recordOutput({ type: "session_error", piboSessionId: session.id, eventId, error: "Provider failed with compact safe message" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.providerRequests[0].status, "error");
		assert.equal(timeline.providerRequests[0].errorCategory, "runtime_error");
		assert.equal(timeline.providerRequests[0].errorMessage, "Provider failed with compact safe message");
		assert.equal(phaseByName(timeline, "provider_request").status, "error");
	} finally {
		store.close();
	}
});

test("provider telemetry keeps no-first-byte requests open", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_no_first_byte";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "wait", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "wait", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test" }, { at: "2026-05-16T00:03:01.000Z" });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.providerRequests[0].status, "started");
		assert.equal(timeline.providerRequests[0].firstByteAt, undefined);
		assert.equal(timeline.providerRequests[0].completedAt, undefined);
		assert.equal(phaseByName(timeline, "provider_request").status, "open");
	} finally {
		store.close();
	}
});

test("provider telemetry keeps partial streamed requests open", () => {
	const store = createStore();
	try {
		const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const provider = providerRecorder(store);
		const eventId = "evt_provider_partial";
		runtime.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "partial", source: "user" }, { session, status: status(1) });
		runtime.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "partial", source: "user" }, { session, status: status(0) });
		provider.recordRequestStart({ model: "gpt-test" }, { at: "2026-05-16T00:04:01.000Z" });
		provider.recordResponse({ status: 200, headers: {}, at: "2026-05-16T00:04:02.000Z" });
		runtime.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 0, text: "partial" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.providerRequests[0].status, "streaming");
		assert.equal(timeline.providerRequests[0].completedAt, undefined);
		assert.equal(timeline.providerRequests[0].normalizedEventCount, 1);
		assert.equal(phaseByName(timeline, "provider_request").status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "open");
	} finally {
		store.close();
	}
});
