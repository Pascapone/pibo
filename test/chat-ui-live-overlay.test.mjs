import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runLiveOverlayScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { trimLiveOverlayForBaseTrace } = await import("./src/apps/chat-ui/src/tracing/live-overlay.ts");

		const traceNode = (id, type, extra = {}) => ({
			id,
			piboSessionId: "ps-test",
			parentId: undefined,
			type,
			title: type,
			status: "done",
			output: "",
			children: [],
			...extra,
		});
		const event = (id, type, extra = {}) => ({
			id,
			piboSessionId: "ps-test",
			createdAt: "2026-05-27T10:00:00.000Z",
			eventSequence: Number(id.replace(/\\D/g, "")) || 0,
			type,
			payload: {},
			...extra,
		});

		const baseTrace = {
			piboSessionId: "ps-test",
			latestStreamId: 10,
			rawEvents: [event("base-raw", "assistant_delta", { payload: { eventId: "raw-confirmed", piboSessionId: "ps-test" } })],
			nodes: [
				traceNode("transcript-user", "user.message", { source: "transcript", entryId: "entry-confirmed", output: "already sent" }),
				traceNode("event:message_queued:node-confirmed", "user.message"),
				traceNode("assistant", "assistant.message", { eventId: "assistant-confirmed" }),
				traceNode("reasoning", "model.reasoning", { eventId: "reasoning-confirmed" }),
				traceNode("parent", "section", { children: [traceNode("nested-user", "user.message", { source: "transcript", output: { text: "nested sent" } })] }),
			],
		};

		const keep = event("keep", "assistant_delta", { streamId: 11, payload: { eventId: "new-live", piboSessionId: "ps-test" } });
		const overlay = {
			piboSessionId: "ps-test",
			events: [
				keep,
				event("old-stream", "assistant_delta", { streamId: 10, payload: { eventId: "old-live", piboSessionId: "ps-test" } }),
				event("raw-confirmed", "assistant_delta", { streamId: 11, payload: { eventId: "raw-confirmed", piboSessionId: "ps-test" } }),
				event("assistant-confirmed", "assistant_message", { streamId: 11, payload: { eventId: "assistant-confirmed", piboSessionId: "ps-test" } }),
				event("reasoning-confirmed", "thinking_finished", { streamId: 11, payload: { eventId: "reasoning-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-id", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "different", eventId: "entry-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-node-id", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "other", eventId: "node-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-text", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "already sent" } }),
				event("nested-queued-by-text", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "nested sent" } }),
			],
		};

		const trimmed = trimLiveOverlayForBaseTrace(overlay, baseTrace);
		assert.deepEqual(trimmed?.events.map((item) => item.id), ["keep", "old-stream"]);
		assert.notEqual(trimmed, overlay);
		assert.equal(trimmed.events[0], keep);
		assert.equal(trimmed.events[1], overlay.events[1]);

		const mismatched = { piboSessionId: "other-session", events: overlay.events };
		assert.equal(trimLiveOverlayForBaseTrace(mismatched, baseTrace), mismatched);
		assert.equal(trimLiveOverlayForBaseTrace({ piboSessionId: "ps-test", events: overlay.events.slice(2) }, baseTrace), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("live overlay trimming preserves bounded-page omissions until exact confirmation", async () => {
	await assert.doesNotReject(runLiveOverlayScenario());
});

async function runPersistedAssistantReconciliationScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { patchTraceViewWithEvents, traceNodesFromEntries } = await import("./src/shared/trace-engine.ts");
		const { buildCompactTerminalRows } = await import("./src/session-ui/terminalRows.ts");

		const piboSessionId = "ps-test";
		const eventId = "queued-turn";
		const transcriptEntries = [
			{
				id: "entry-user",
				type: "message",
				timestamp: "2026-08-07T10:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "Queued request" }] },
			},
			{
				id: "entry-assistant-first",
				type: "message",
				timestamp: "2026-08-07T10:00:01.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "Same text" }], stopReason: "toolUse" },
			},
			{
				id: "entry-tool",
				type: "message",
				timestamp: "2026-08-07T10:00:02.000Z",
				message: { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: "ok", isError: false },
			},
			{
				id: "entry-assistant-final",
				type: "message",
				timestamp: "2026-08-07T10:00:03.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "Same text" }], stopReason: "stop" },
			},
		];
		const nodes = traceNodesFromEntries(piboSessionId, transcriptEntries, [{
			eventId,
			userText: "Queued request",
			startedAt: "2026-08-07T10:00:00.000Z",
			completedAt: "2026-08-07T10:00:04.000Z",
		}]);
		const baseTrace = {
			piboSessionId,
			title: "Test session",
			version: 1,
			latestStreamId: 10,
			eventCount: 0,
			eventLimit: 100,
			hasOlderEvents: false,
			nextBeforeSequence: undefined,
			rawEvents: [],
			nodes,
		};
		const event = (id, eventSequence, type, payload) => ({
			id,
			piboSessionId,
			createdAt: \`2026-08-07T10:00:0\${eventSequence}.000Z\`,
			eventSequence,
			streamId: 10 + eventSequence,
			type,
			payload: { type, piboSessionId, eventId, ...payload },
		});
		const patched = patchTraceViewWithEvents(baseTrace, [
			event("assistant-0", 1, "assistant_message", { assistantIndex: 0, contentIndex: 4, text: "Same text" }),
			event("assistant-1", 2, "assistant_message", { assistantIndex: 1, contentIndex: 9, text: "Same text" }),
			event("assistant-live", 3, "assistant_delta", { assistantIndex: 2, contentIndex: 12, text: "Still streaming" }),
		], "running");

		const projectedAssistants = patched.nodes.filter((node) => node.type === "assistant.message");
		assert.equal(projectedAssistants.length, 5, "the refreshed transcript and live event projection intentionally coexist");
		const rows = buildCompactTerminalRows(patched, { showThinking: true });
		const assistants = rows.filter((row) => row.kind === "message.assistant");
		assert.equal(rows.filter((row) => row.kind === "tool.call").length, 1, "non-assistant rows must remain unchanged");
		assert.equal(assistants.length, 3, "only matching completed assistant projections should reconcile");
		assert.deepEqual(assistants.map((row) => row.id), [
			"terminal:assistant:queued-turn:assistant:0",
			"terminal:assistant:queued-turn:assistant:1",
			"terminal:assistant:queued-turn:assistant:2",
		]);
		assert.deepEqual([...assistants[0].sourceNodeIds].sort(), [
			"entry:entry-assistant-first:response",
			"event:assistant:queued-turn:assistant:0",
		]);
		assert.deepEqual([...assistants[1].sourceNodeIds].sort(), [
			"entry:entry-assistant-final:response",
			"event:assistant:queued-turn:assistant:1",
		]);
		assert.equal(assistants[2].status, "running", "event-only streaming output must remain visible");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Compact Terminal reconciles persisted assistants with completed event projections by assistant index", async () => {
	await assert.doesNotReject(runPersistedAssistantReconciliationScenario());
});
