import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runLiveOverlayScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { trimLiveOverlayForBaseTrace } = await import("./src/apps/chat-ui/src/tracing/live-overlay.ts");
		const { computeCurrentTraceView } = await import("./src/apps/chat-ui/src/tracing/current-trace-view.ts");

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
				traceNode("assistant", "assistant.message", { eventId: "assistant-confirmed", source: "transcript" }),
				traceNode("reasoning", "model.reasoning", { eventId: "reasoning-confirmed", source: "transcript" }),
				traceNode("assistant-indexed", "assistant.message", { eventId: "indexed-turn", stableKey: "assistant:indexed-turn:assistant:0", source: "transcript" }),
				traceNode("reasoning-indexed", "model.reasoning", { eventId: "indexed-turn", stableKey: "reasoning:indexed-turn:thinking:0", source: "transcript" }),
				traceNode("tool-indexed", "tool.call", { eventId: "indexed-turn", toolCallId: "tool-confirmed", stableKey: "tool:tool-confirmed", completedAt: "2026-05-27T10:00:01.000Z" }),
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
				event("assistant-turn-started", "message_started", { streamId: 11, payload: { eventId: "assistant-confirmed", piboSessionId: "ps-test" } }),
				event("assistant-turn-finished", "message_finished", { streamId: 11, payload: { eventId: "assistant-confirmed", piboSessionId: "ps-test" } }),
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
		const confirmedOnlyOverlay = { piboSessionId: "ps-test", events: overlay.events.slice(2) };
		assert.equal(trimLiveOverlayForBaseTrace(confirmedOnlyOverlay, baseTrace), null);
		assert.equal(computeCurrentTraceView({
			selectedPiboSessionId: "ps-test",
			reconciledBaseTraceView: baseTrace,
			liveTraceOverlay: confirmedOnlyOverlay,
			selectedSessionStatus: "idle",
			persistedUserMessageIndexForBaseTrace: new Map(),
		}).traceView, baseTrace);

		const repeatedCanonicalTrace = {
			...baseTrace,
			rawEvents: [],
			nodes: [
				traceNode("event:message_queued:turn-one", "user.message", {
					source: "transcript",
					entryId: "entry-one",
					stableKey: "event:message_queued:turn-one",
					output: "same prompt",
				}),
				traceNode("event:message_queued:turn-two", "user.message", {
					source: "transcript",
					entryId: "entry-two",
					stableKey: "event:message_queued:turn-two",
					output: "same prompt",
				}),
			],
		};
		const repeatedThird = event("repeated-third", "message_queued", {
			streamId: 11,
			payload: {
				type: "message_queued",
				eventId: "turn-three",
				piboSessionId: "ps-test",
				source: "user",
				text: "same prompt",
				queuedMessages: 1,
			},
		});
		const repeatedOverlay = { piboSessionId: "ps-test", events: [repeatedThird] };
		assert.deepEqual(trimLiveOverlayForBaseTrace(repeatedOverlay, repeatedCanonicalTrace)?.events, [repeatedThird]);
		const repeatedCurrent = computeCurrentTraceView({
			selectedPiboSessionId: "ps-test",
			reconciledBaseTraceView: repeatedCanonicalTrace,
			liveTraceOverlay: repeatedOverlay,
			selectedSessionStatus: "running",
			persistedUserMessageIndexForBaseTrace: new Map([["same prompt", ["entry-one", "entry-two"]]]),
		}).traceView;
		const repeatedUsers = [];
		const collectRepeatedUsers = (nodes) => {
			for (const node of nodes) {
				if (node.type === "user.message") repeatedUsers.push(node);
				collectRepeatedUsers(node.children);
			}
		};
		collectRepeatedUsers(repeatedCurrent.nodes);
		assert.deepEqual(repeatedUsers.map((node) => node.id).sort(), [
			"event:message_queued:turn-one",
			"event:message_queued:turn-three",
			"event:message_queued:turn-two",
		]);
		assert.equal(repeatedUsers.find((node) => node.id === "event:message_queued:turn-three")?.entryId, undefined);

		const indexedOverlay = {
			piboSessionId: "ps-test",
			events: [
				event("thinking-confirmed-index", "thinking_finished", { payload: { eventId: "indexed-turn", piboSessionId: "ps-test", thinkingIndex: 0 } }),
				event("thinking-sibling-index", "thinking_finished", { payload: { eventId: "indexed-turn", piboSessionId: "ps-test", thinkingIndex: 1 } }),
				event("assistant-confirmed-index", "assistant_message", { payload: { eventId: "indexed-turn", piboSessionId: "ps-test", assistantIndex: 0 } }),
				event("assistant-sibling-index", "assistant_message", { payload: { eventId: "indexed-turn", piboSessionId: "ps-test", assistantIndex: 1 } }),
				event("tool-confirmed-index", "tool_execution_finished", { payload: { eventId: "indexed-turn", piboSessionId: "ps-test", toolCallId: "tool-confirmed" } }),
			],
		};
		assert.deepEqual(trimLiveOverlayForBaseTrace(indexedOverlay, baseTrace)?.events.map((item) => item.id), [
			"thinking-sibling-index",
			"assistant-sibling-index",
		]);

		const inFlightToolTrace = {
			...baseTrace,
			rawEvents: [],
			nodes: [traceNode("tool-in-flight", "tool.call", {
				source: "transcript",
				toolCallId: "tool-in-flight",
				stableKey: "tool:tool-in-flight",
				output: undefined,
			})],
		};
		const inFlightToolOverlay = {
			piboSessionId: "ps-test",
			events: [
				event("tool-call", "tool_call", { payload: { piboSessionId: "ps-test", toolCallId: "tool-in-flight" } }),
				event("tool-started", "tool_execution_started", { payload: { piboSessionId: "ps-test", toolCallId: "tool-in-flight" } }),
				event("tool-updated", "tool_execution_updated", { payload: { piboSessionId: "ps-test", toolCallId: "tool-in-flight" } }),
				event("tool-finished", "tool_execution_finished", { payload: { piboSessionId: "ps-test", toolCallId: "tool-in-flight" } }),
			],
		};
		assert.deepEqual(trimLiveOverlayForBaseTrace(inFlightToolOverlay, inFlightToolTrace)?.events.map((item) => item.id), [
			"tool-started",
			"tool-updated",
			"tool-finished",
		]);

		const partialContentTrace = {
			...baseTrace,
			rawEvents: [],
			nodes: [
				traceNode("assistant-partial", "assistant.message", {
					eventId: "partial-turn",
					stableKey: "assistant:partial-turn:assistant:0",
					source: "event-log",
					status: "running",
				}),
				traceNode("reasoning-partial", "model.reasoning", {
					eventId: "partial-turn",
					stableKey: "reasoning:partial-turn:thinking:0",
					source: "event-log",
					status: "running",
				}),
			],
		};
		const finalContentOverlay = {
			piboSessionId: "ps-test",
			events: [
				event("assistant-final", "assistant_message", { payload: { eventId: "partial-turn", piboSessionId: "ps-test", assistantIndex: 0 } }),
				event("reasoning-final", "thinking_finished", { payload: { eventId: "partial-turn", piboSessionId: "ps-test", thinkingIndex: 0 } }),
			],
		};
		assert.deepEqual(trimLiveOverlayForBaseTrace(finalContentOverlay, partialContentTrace)?.events.map((item) => item.id), [
			"assistant-final",
			"reasoning-final",
		]);

		const coveredTail = {
			...baseTrace,
			firstEventSequence: 70,
			lastEventSequence: 80,
			eventCount: 80,
			rawEvents: [],
			nodes: [],
		};
		const coveredOverlay = {
			piboSessionId: "ps-test",
			events: [
				event("service-run", "message_queued", { eventSequence: 75, payload: { eventId: "service-run", piboSessionId: "ps-test", source: "service", text: '<pibo_run_notification>{"completed":[{"runId":"run-1"}]}</pibo_run_notification>' } }),
				event("older-omission", "assistant_message", { eventSequence: 69, payload: { eventId: "older-omission", piboSessionId: "ps-test", assistantIndex: 0, text: "older" } }),
			],
		};
		assert.deepEqual(trimLiveOverlayForBaseTrace(coveredOverlay, coveredTail)?.events.map((item) => item.id), ["older-omission"]);
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
		assert.equal(projectedAssistants.length, 3, "persisted and live assistant parts should share canonical identities");
		assert.deepEqual(projectedAssistants.map((node) => node.id), [
			"event:assistant:queued-turn:assistant:0",
			"event:assistant:queued-turn:assistant:1",
			"event:assistant:queued-turn:assistant:2",
		]);
		const rows = buildCompactTerminalRows(patched, { showThinking: true });
		const assistants = rows.filter((row) => row.kind === "message.assistant");
		assert.equal(rows.filter((row) => row.kind === "tool.call").length, 1, "non-assistant rows must remain unchanged");
		assert.equal(assistants.length, 3, "only matching completed assistant projections should reconcile");
		assert.deepEqual(assistants.map((row) => row.id), [
			"terminal:assistant:queued-turn:assistant:0",
			"terminal:assistant:queued-turn:assistant:1",
			"terminal:assistant:queued-turn:assistant:2",
		]);
		assert.deepEqual(assistants[0].sourceNodeIds, ["event:assistant:queued-turn:assistant:0"]);
		assert.deepEqual(assistants[1].sourceNodeIds, ["event:assistant:queued-turn:assistant:1"]);
		assert.equal(assistants[2].status, "running", "event-only streaming output must remain visible");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Compact Terminal reconciles persisted assistants with completed event projections by assistant index", async () => {
	await assert.doesNotReject(runPersistedAssistantReconciliationScenario());
});

async function runPersistedContentIdentityScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { patchTraceViewWithEvents, traceNodesFromEntries } = await import("./src/shared/trace-engine.ts");

		const piboSessionId = "ps-test";
		const eventId = "turn-content-identity";
		const entries = [
			{ id: "user", type: "message", timestamp: "2026-08-09T04:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "work" }] } },
			{ id: "assistant-1", type: "message", timestamp: "2026-08-09T04:00:01.000Z", message: { role: "assistant", content: [
				{ type: "thinking", thinking: "first thought" },
				{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "one" } },
			], stopReason: "toolUse" } },
			{ id: "result-1", type: "message", timestamp: "2026-08-09T04:00:02.000Z", message: { role: "toolResult", toolCallId: "tool-1", toolName: "bash", content: "one", isError: false } },
			{ id: "assistant-2", type: "message", timestamp: "2026-08-09T04:00:03.000Z", message: { role: "assistant", content: [
				{ type: "thinking", thinking: "second thought" },
				{ type: "toolCall", id: "tool-2", name: "bash", arguments: { command: "two" } },
			], stopReason: "toolUse" } },
			{ id: "result-2", type: "message", timestamp: "2026-08-09T04:00:04.000Z", message: { role: "toolResult", toolCallId: "tool-2", toolName: "bash", content: "two", isError: false } },
			{ id: "assistant-final", type: "message", timestamp: "2026-08-09T04:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } },
		];
		const nodes = traceNodesFromEntries(piboSessionId, entries, [{
			eventId,
			userText: "work",
			startedAt: "2026-08-09T04:00:00.000Z",
			completedAt: "2026-08-09T04:00:06.000Z",
		}]);
		assert.deepEqual(nodes.filter((node) => node.type !== "user.message").map((node) => node.id), [
			"event:thinking:turn-content-identity:thinking:0",
			"tool:tool-1",
			"event:thinking:turn-content-identity:thinking:1",
			"tool:tool-2",
			"event:assistant:turn-content-identity:assistant:0",
		]);
		assert.deepEqual(nodes.filter((node) => node.type === "model.reasoning").map((node) => node.stableKey), [
			"reasoning:turn-content-identity:thinking:0",
			"reasoning:turn-content-identity:thinking:1",
		]);

		const baseTrace = {
			piboSessionId,
			title: "Test",
			version: "base",
			latestStreamId: 1,
			eventCount: 0,
			eventLimit: 100,
			hasOlderEvents: false,
			rawEvents: [],
			nodes,
		};
		const event = (id, eventSequence, type, payload) => ({
			id,
			piboSessionId,
			createdAt: \`2026-08-09T04:00:0\${eventSequence}.500Z\`,
			eventSequence,
			streamId: eventSequence,
			type,
			payload: { type, piboSessionId, eventId, ...payload },
		});
		const patched = patchTraceViewWithEvents(baseTrace, [
			event("thinking-0", 1, "thinking_finished", { thinkingIndex: 0, contentIndex: 0, text: "first thought" }),
			event("tool-1", 2, "tool_execution_finished", { toolCallId: "tool-1", toolName: "bash", result: "one", isError: false }),
			event("thinking-1", 3, "thinking_finished", { thinkingIndex: 1, contentIndex: 0, text: "second thought" }),
			event("tool-2", 4, "tool_execution_finished", { toolCallId: "tool-2", toolName: "bash", result: "two", isError: false }),
			event("assistant-0", 5, "assistant_message", { assistantIndex: 0, contentIndex: 0, text: "done" }),
		], "running");
		assert.deepEqual(patched.nodes.filter((node) => node.type !== "user.message").map((node) => node.id), [
			"event:thinking:turn-content-identity:thinking:0",
			"tool:tool-1",
			"event:thinking:turn-content-identity:thinking:1",
			"tool:tool-2",
			"event:assistant:turn-content-identity:assistant:0",
		]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("persisted reasoning, tools, and assistants keep live content identities", async () => {
	await assert.doesNotReject(runPersistedContentIdentityScenario());
});
