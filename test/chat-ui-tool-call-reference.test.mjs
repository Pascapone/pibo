import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runToolCallReferenceScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { buildCompactTerminalRows } from "./src/session-ui/terminalRows.ts";
		import { qualifiedToolNodeId } from "./src/shared/trace-tool-identity.ts";
		import { chatNavigationRequest, chatRouteFromLocation } from "./src/apps/chat-ui/src/app-routes.ts";
		import { TerminalDetails } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx";
		import { buildToolCallReferenceUrl, findToolCallReferenceRowIndex, formatToolCallReference } from "./src/apps/chat-ui/src/tool-call-reference.ts";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const { act, create } = TestRenderer;
		const piboSessionId = "ps_11111111-1111-4111-8111-111111111111";
		const eventId = "turn-reference";
		const toolCallId = "call_reference";
		const traceNodeId = qualifiedToolNodeId(toolCallId, eventId, 0);
		const reference = { traceNodeId, toolCallId, eventId, invocationOrdinal: 0 };

		const url = buildToolCallReferenceUrl(
			"https://chat.example/apps/chat/rooms/room-1/sessions/old?debug=true#stale",
			piboSessionId,
			reference,
		);
		const parsedUrl = new URL(url);
		assert.equal(parsedUrl.pathname, "/apps/chat/sessions/" + piboSessionId);
		assert.equal(parsedUrl.searchParams.get("view"), "terminal");
		assert.equal(parsedUrl.searchParams.get("toolCall"), traceNodeId);
		assert.equal(parsedUrl.searchParams.has("debug"), false);
		assert.equal(parsedUrl.hash, "");

		const copiedReference = formatToolCallReference(piboSessionId, reference, url);
		assert.match(copiedReference, /Pibo Tool Call Reference/);
		assert.match(copiedReference, new RegExp(piboSessionId));
		assert.match(copiedReference, new RegExp(toolCallId));
		assert.match(copiedReference, /pibo debug trace/);
		assert.match(copiedReference, /Link: https:\/\/chat\.example/);

		assert.deepEqual(
			chatRouteFromLocation("/apps/chat/sessions/" + piboSessionId, { view: "terminal", toolCall: "  " + traceNodeId + "  " }),
			{ area: "sessions", piboSessionId, sessionViewId: "terminal", toolCallNodeId: traceNodeId },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "sessions", piboSessionId, toolCallNodeId: traceNodeId }, false, "terminal"),
			{
				to: "/sessions/$piboSessionId",
				params: { piboSessionId },
				search: { view: "terminal", toolCall: traceNodeId },
				replace: false,
			},
		);

		const secondTraceNodeId = qualifiedToolNodeId("call_second", eventId, 0);
		const traceView = {
			piboSessionId,
			piSessionId: "pi-reference",
			title: "Reference",
			version: "v1",
			eventCount: 0,
			rawEvents: [],
			nodes: [{
				id: "event:message:" + eventId,
				piboSessionId,
				type: "agent.turn",
				title: "Turn",
				status: "done",
				children: [
					{ id: traceNodeId, parentId: "event:message:" + eventId, piboSessionId, toolCallId, type: "tool.call", title: "read", status: "done", children: [] },
					{ id: secondTraceNodeId, parentId: "event:message:" + eventId, piboSessionId, toolCallId: "call_second", type: "tool.call", title: "read", status: "done", input: { path: "README.md" }, children: [] },
				],
			}],
		};
		const rows = buildCompactTerminalRows(traceView, { showThinking: true });
		const referenceRows = rows.flatMap((row) => row.detailItems?.length ? row.detailItems.map((item) => ({ row, reference: item.toolCallReference })) : [{ row, reference: row.toolCallReference }]);
		assert.ok(referenceRows.some((entry) => entry.reference?.traceNodeId === traceNodeId));
		assert.ok(referenceRows.find((entry) => entry.reference?.traceNodeId === traceNodeId)?.row.expandable, "tool calls without payloads remain expandable for their reference");
		assert.ok(findToolCallReferenceRowIndex(rows, secondTraceNodeId) >= 0);

		let clipboardText = "";
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { location: { href: "https://chat.example/apps/chat/sessions/" + piboSessionId } },
		});
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { clipboard: { writeText: async (text) => { clipboardText = text; } } },
		});
		let renderer;
		await act(async () => {
			renderer = create(React.createElement(TerminalDetails, {
				row: {
					id: "terminal:" + traceNodeId,
					kind: "tool.call",
					status: "done",
					lines: [],
					sourceNodeIds: [traceNodeId],
					toolCallReference: reference,
				},
				piboSessionId,
				targetToolCallNodeId: traceNodeId,
				onOpenSession: () => {},
			}));
		});
		const copyButton = renderer.root.findByProps({ "aria-label": "Copy Tool Call Reference" });
		assert.equal(copyButton.props.title, "Copy Tool Call Reference");
		assert.equal(renderer.root.findAllByProps({ "data-pibo-tool-call-target": "true" }).length, 1);
		await act(async () => {
			copyButton.props.onClick();
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(clipboardText, copiedReference);
		assert.equal(renderer.root.findAllByProps({ "aria-label": "Copied Tool Call Reference" }).length, 1);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: { ...process.env, NODE_ENV: "development" },
	});
}

test("tool call references are shareable, routable, and copyable from expanded details", async () => {
	await assert.doesNotReject(runToolCallReferenceScenario());
});
