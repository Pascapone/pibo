import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	inspectPiAgentRuntimeHistory,
	readPiAgentRuntimeHistory,
	readPiTranscriptHistoryPage,
} from "../dist/agent-runtimes/pi/history.js";
import { readOmpHistory } from "../dist/agent-runtimes/omp/history.js";
import { buildTraceViewFromEvents, flattenTraceNodes } from "../dist/shared/trace-engine.js";
import { traceTimelinePageFromView } from "../dist/apps/chat/trace-v2.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";

function binding(nativeSessionId, locator) {
	return {
		piboSessionId: "ps_history",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		nativeSessionId,
		state: "bound",
		protocol: "pi-sdk",
		locator,
		revision: 1,
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
	};
}

function message(id, role, content, timestamp, extra = {}) {
	return {
		type: "message",
		id,
		timestamp,
		message: { role, content, ...extra },
	};
}

test("Pi history provider resolves, paginates, and normalizes native JSONL behind the adapter", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-pi-history-"));
	const workspace = join(root, "workspace");
	const agentDir = join(root, "agent");
	const nativeSessionId = "pi_history_fixture";
	const safePath = `--${workspace.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	const path = join(sessionDir, `20260815_${nativeSessionId}.jsonl`);
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(path, [
		JSON.stringify({ type: "session", id: nativeSessionId, timestamp: "2026-08-15T00:00:00.000Z", cwd: workspace }),
		JSON.stringify({ type: "session_info", id: "info", timestamp: "2026-08-15T00:00:00.100Z", name: "History fixture" }),
		JSON.stringify(message("user-1", "user", [{ type: "text", text: "first" }], "2026-08-15T00:00:01.000Z")),
		JSON.stringify(message("assistant-1", "assistant", [
			{ type: "thinking", thinking: "consider" },
			{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
		], "2026-08-15T00:00:02.000Z", { stopReason: "toolUse" })),
		JSON.stringify(message("tool-1-result", "toolResult", "ok", "2026-08-15T00:00:03.000Z", { toolCallId: "tool-1", toolName: "read", isError: false })),
		JSON.stringify(message("assistant-2", "assistant", [{ type: "text", text: "done" }], "2026-08-15T00:00:04.000Z", { stopReason: "stop" })),
	].join("\n") + "\n", "utf8");

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const input = { binding: binding(nativeSessionId, { kind: "local-file", value: path }), workspace };
		const inspection = await inspectPiAgentRuntimeHistory("pi", input);
		assert.equal(inspection.available, true);
		assert.equal(inspection.adapterId, "pi");
		assert.equal(inspection.runtimeInstanceId, "pi");
		assert.equal(inspection.locator.value, path);
		assert.equal(inspection.title, "History fixture");
		assert.equal(inspection.firstMessage, "first");
		assert.ok(inspection.sizeBytes > 0);
		assert.equal(typeof inspection.version, "string");

		const firstPage = await readPiAgentRuntimeHistory("pi", { ...input, limit: 2 });
		assert.equal(firstPage.source, "native");
		assert.equal(firstPage.entries.length, 2);
		assert.equal(firstPage.entries[0].type, "message");
		assert.equal(firstPage.entries[0].role, "tool");
		assert.equal(firstPage.entries[0].toolCallId, "tool-1");
		assert.equal(firstPage.entries[1].role, "assistant");
		assert.equal(firstPage.entries[1].content[0].text, "done");
		assert.equal(firstPage.hasMore, true);
		assert.equal(typeof firstPage.nextCursor, "string");
		assert.equal(typeof firstPage.orderOffset, "number");
		assert.equal(firstPage.reconciliationProof.complete, true);
		assert.equal(firstPage.reconciliationProof.entries.length, 5);
		assert.ok(firstPage.entries.every((entry) => typeof entry.historyPosition === "string"));
		assert.ok(firstPage.entries.every((entry) => firstPage.reconciliationProof.entries.some((proofEntry) =>
			proofEntry.historyPosition === entry.historyPosition
		)));
		const firstView = buildTraceViewFromEvents({
			session: { id: "ps_history", piSessionId: nativeSessionId },
			events: [],
			historyEntries: firstPage.entries,
			historyReconciliationProof: firstPage.reconciliationProof,
			turnTimings: [{ eventId: "stable-pi-history", userText: "first", startedAt: "2026-08-15T00:00:01.000Z", completedAt: "2026-08-15T00:00:04.000Z" }],
		});
		assert.ok(flattenTraceNodes(firstView.nodes)
			.filter((node) => node.type === "assistant.message" || node.toolCallId === "tool-1")
			.every((node) => node.eventId === "stable-pi-history"));

		const secondPage = await readPiAgentRuntimeHistory("pi", { ...input, cursor: firstPage.nextCursor, limit: 10 });
		assert.deepEqual(secondPage.reconciliationProof, firstPage.reconciliationProof);
		assert.ok(secondPage.entries.some((entry) => entry.type === "session_info" && entry.name === "History fixture"));
		assert.ok(secondPage.entries.some((entry) => entry.type === "message" && entry.role === "user" && entry.nativeEntryId === "user-1"));
		const assistant = secondPage.entries.find((entry) => entry.type === "message" && entry.nativeEntryId === "assistant-1");
		assert.deepEqual(assistant.content, [
			{ type: "reasoning", text: "consider" },
			{ type: "tool_call", toolCallId: "tool-1", toolName: "read", input: { path: "README.md" } },
		]);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
});

test("Pi history pagination preserves JSONL records that cross scan blocks", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-pi-history-blocks-"));
	const path = join(root, "history.jsonl");
	const nativeSessionId = "pi_history_blocks";
	writeFileSync(path, [
		JSON.stringify({ type: "session", id: nativeSessionId, timestamp: "2026-08-15T00:00:00.000Z", cwd: root }),
		JSON.stringify(message("user-large", "user", [{ type: "text", text: `large:${"ü".repeat(3_000)}` }], "2026-08-15T00:00:01.000Z")),
		JSON.stringify(message("assistant-final", "assistant", [{ type: "text", text: "complete" }], "2026-08-15T00:00:02.000Z", { stopReason: "stop" })),
	].join("\n"), "utf8");

	const page = readPiTranscriptHistoryPage(path, { limit: 2, pageBytes: 1_024, maxScanBytes: 32 * 1_024 });
	assert.deepEqual(page.entries.map((entry) => entry.id), ["user-large", "assistant-final"]);
	assert.equal(page.hasOlder, true);
	assert.ok(page.scannedBytes > 1_024);
});

test("partial native history suppresses only covered event echoes and preserves uncovered tool parents", () => {
	const piboSessionId = "ps_partial_native_history";
	const historyEntries = [
		{ id: "pi:user-covered", type: "message", source: "native", createdAt: "2026-08-15T00:01:00.000Z", nativeEntryId: "user-covered", nativeTurnId: "user-covered", role: "user", content: "covered prompt" },
		{ id: "pi:assistant-covered", type: "message", source: "native", createdAt: "2026-08-15T00:01:01.000Z", nativeEntryId: "assistant-covered", nativeTurnId: "user-covered", role: "assistant", content: [
			{ type: "tool_call", toolCallId: "covered-tool", toolName: "read", input: { path: "covered.txt" } },
			{ type: "text", text: "covered answer" },
		], status: "complete" },
		{ id: "pi:tool-covered", type: "message", source: "native", createdAt: "2026-08-15T00:01:01.500Z", nativeEntryId: "tool-covered", nativeTurnId: "user-covered", role: "tool", content: "covered result", toolCallId: "covered-tool", toolName: "read", result: { content: "covered result" }, status: "complete" },
	];
	const stored = (eventSequence, createdAt, payload) => ({
		id: String(eventSequence), piboSessionId, eventSequence, eventId: payload.eventId, type: payload.type, createdAt, payload,
	});
	const events = [
		stored(1, "2026-08-15T00:00:00.000Z", { type: "message_started", piboSessionId, eventId: "old-turn", text: "old prompt", source: "user" }),
		stored(2, "2026-08-15T00:00:00.100Z", { type: "tool_execution_started", piboSessionId, eventId: "old-turn", toolCallId: "old-tool", toolName: "bash", args: { command: "echo old" } }),
		stored(3, "2026-08-15T00:00:00.200Z", { type: "tool_execution_finished", piboSessionId, eventId: "old-turn", toolCallId: "old-tool", toolName: "bash", result: { output: "old" }, isError: false }),
		stored(4, "2026-08-15T00:00:00.300Z", { type: "message_finished", piboSessionId, eventId: "old-turn", source: "user" }),
		stored(5, "2026-08-15T00:01:00.000Z", { type: "message_started", piboSessionId, eventId: "covered-turn", text: "covered prompt", source: "user" }),
		stored(6, "2026-08-15T00:01:00.100Z", { type: "tool_execution_started", piboSessionId, eventId: "covered-turn", toolCallId: "covered-tool", toolName: "read", args: { path: "covered.txt" } }),
		stored(7, "2026-08-15T00:01:00.200Z", { type: "tool_execution_finished", piboSessionId, eventId: "covered-turn", toolCallId: "covered-tool", toolName: "read", result: { content: "covered result" }, isError: false }),
		stored(8, "2026-08-15T00:01:01.000Z", { type: "assistant_message", piboSessionId, eventId: "covered-turn", assistantIndex: 0, contentIndex: 0, text: "covered answer" }),
		stored(9, "2026-08-15T00:01:01.100Z", { type: "message_finished", piboSessionId, eventId: "covered-turn", source: "user" }),
	];
	const view = buildTraceViewFromEvents({
		session: { id: piboSessionId, piSessionId: "pi-partial-native" },
		events,
		historyEntries,
		status: "idle",
	});
	const nodes = flattenTraceNodes(view.nodes);
	const ids = new Set(nodes.map((node) => node.id));
	assert.ok(nodes.some((node) => node.id === "event:message:old-turn" && node.type === "agent.turn"));
	assert.ok(nodes.some((node) => node.toolCallId === "old-tool" && node.parentId === "event:message:old-turn"));
	assert.equal(nodes.filter((node) => node.toolCallId === "covered-tool").length, 1);
	assert.ok(nodes.some((node) => node.toolCallId === "covered-tool" && node.source === "transcript"));
	assert.deepEqual(nodes.filter((node) => node.parentId && !ids.has(node.parentId)), []);
});

test("Pi history provider reports a missing native transcript without creating a replacement", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "pibo-pi-history-missing-"));
	const result = await readPiAgentRuntimeHistory("pi", {
		binding: binding("pi_missing_history"),
		workspace,
		limit: 20,
	});
	assert.deepEqual(result.entries, []);
	assert.equal(result.hasMore, false);
	assert.equal(result.inspection.available, false);
	assert.equal(result.inspection.diagnostics[0].code, "pi_history_not_found");
});

function ompClientFromNewestPages(pages) {
	return {
		async request(command) {
			const pageIndex = command.cursor ? Number(command.cursor.slice("provider-page:".length)) : 0;
			const messages = pages[pageIndex] ?? [];
			return {
				data: {
					messages,
					totalMessages: pages.reduce((total, page) => total + page.length, 0),
					...(pageIndex + 1 < pages.length ? { nextCursor: `provider-page:${pageIndex + 1}` } : {}),
				},
			};
		},
	};
}

function ompBinding(nativeSessionId = "omp-history") {
	return {
		piboSessionId: "ps_history",
		runtimeInstanceId: "omp",
		adapterId: "omp",
		nativeSessionId,
		state: "bound",
		revision: 1,
	};
}

function messageProjectionIds(page) {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_history", piSessionId: "" },
		events: [],
		historyEntries: page.entries,
		historyReconciliationProof: page.reconciliationProof,
	});
	const legacy = flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message")
		.map((node) => node.id);
	const v2 = traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 }).nodes
		.filter((node) => node.type === "user.message" || node.type === "assistant.message")
		.map((node) => node.nodeId);
	const terminal = buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant")
		.map((row) => row.id);
	return { view, legacy, v2, terminal };
}

test("OMP bounded full-history proof keeps missing and repeated provider IDs distinct across Pibo cursor pages", async () => {
	for (const repeatedProviderId of [false, true]) {
		const raw = [
			{ role: "user", content: "old prompt", timestamp: "2026-01-01T00:00:00Z" },
			{ role: "assistant", content: "old answer", timestamp: "2026-01-01T00:00:01Z" },
			{ role: "user", content: "new prompt", timestamp: "2026-01-01T00:01:00Z" },
			{ role: "assistant", content: "new answer", timestamp: "2026-01-01T00:01:01Z" },
		].map((message) => repeatedProviderId ? { ...message, entryId: "repeated-provider-id" } : message);
		const client = ompClientFromNewestPages([raw.slice(2), raw.slice(0, 2)]);
		const binding = ompBinding(repeatedProviderId ? "omp-repeated" : "omp-missing");
		const newest = await readOmpHistory(client, { binding, workspace: "/workspace", limit: 2 }, "omp", binding);
		const oldest = await readOmpHistory(client, { binding, workspace: "/workspace", limit: 3, cursor: newest.nextCursor }, "omp", binding);
		const repeatNewest = await readOmpHistory(client, { binding, workspace: "/workspace", limit: 2 }, "omp", binding);
		assert.equal(newest.reconciliationProof.complete, true);
		assert.equal(newest.reconciliationProof.entries.length, 4);
		assert.deepEqual(repeatNewest.entries.map((entry) => entry.historyPosition), newest.entries.map((entry) => entry.historyPosition));
		const projections = [messageProjectionIds(oldest), messageProjectionIds(newest)];
		for (const key of ["legacy", "v2", "terminal"]) {
			const ids = projections.flatMap((projection) => projection[key]);
			assert.equal(ids.length, 4);
			assert.equal(new Set(ids).size, 4);
		}
		assert.equal(new Set([...oldest.entries, ...newest.entries].map((entry) => entry.historyPosition)).size, 4);
		if (repeatedProviderId) {
			assert.ok([...oldest.entries, ...newest.entries].every((entry) => entry.nativeEntryId === "repeated-provider-id"));
		}
	}
});

test("OMP tool-only history remains visible with a stable structural correlation", async () => {
	const binding = ompBinding("omp-tool-only");
	const client = ompClientFromNewestPages([[
		{ role: "tool", content: "tool output", timestamp: "2026-01-01T00:00:00Z" },
	]]);
	const first = await readOmpHistory(client, { binding, workspace: "/workspace" }, "omp", binding);
	const second = await readOmpHistory(client, { binding, workspace: "/workspace" }, "omp", binding);
	const firstTool = flattenTraceNodes(messageProjectionIds(first).view.nodes).find((node) => node.type === "tool.result");
	const secondTool = flattenTraceNodes(messageProjectionIds(second).view.nodes).find((node) => node.type === "tool.result");
	assert.equal(firstTool?.toolCallId, "omp-tool:omp-tool-only:0");
	assert.equal(firstTool?.id, secondTool?.id);
	assert.equal(firstTool?.eventId, "native-history-group:omp:omp-tool-only:message:0");
});

test("OMP explicitly rejects histories whose declared total exceeds the shared proof bound", async () => {
	const binding = ompBinding("omp-overflow");
	const client = {
		async request() {
			return { data: { messages: [], totalMessages: 501, nextCursor: "older" } };
		},
	};
	await assert.rejects(
		readOmpHistory(client, { binding, workspace: "/workspace" }, "omp", binding),
		/exceeds the 500-entry proof bound/,
	);
});

test("OMP bounded pagination accepts advancing empty pages and rejects contradictory progress", async () => {
	const binding = ompBinding("omp-empty-intermediate");
	const messages = [
		{ role: "assistant", content: "newest", timestamp: "2026-01-01T00:01:00Z" },
		{ role: "user", content: "oldest", timestamp: "2026-01-01T00:00:00Z" },
	];
	const pages = [
		{ messages: [messages[0]], totalMessages: 2, nextCursor: "provider-page:1" },
		{ messages: [], totalMessages: 2, nextCursor: "provider-page:2" },
		{ messages: [messages[1]], totalMessages: 2 },
	];
	let requests = 0;
	const client = {
		async request(command) {
			requests += 1;
			const index = command.cursor ? Number(command.cursor.slice("provider-page:".length)) : 0;
			return { data: pages[index] };
		},
	};
	const page = await readOmpHistory(client, { binding, workspace: "/workspace" }, "omp", binding);
	assert.equal(requests, 3);
	assert.deepEqual(page.entries.map((entry) => entry.content), ["oldest", "newest"]);
	assert.equal(page.reconciliationProof.complete, true);
	assert.equal(page.reconciliationProof.fullScope.entryCount, 2);

	const malformedCases = [
		[
			{ messages: [messages[0]], totalMessages: 2, nextCursor: "repeat" },
			{ messages: [], totalMessages: 2, nextCursor: "repeat" },
		],
		[
			{ messages: [messages[0]], totalMessages: 2, nextCursor: "next" },
			{ messages: [messages[1]], totalMessages: 3 },
		],
		[{ messages: [], totalMessages: 1 }],
		[{ messages, totalMessages: 2, nextCursor: "beyond-exact" }],
	];
	for (const malformedPages of malformedCases) {
		let index = 0;
		await assert.rejects(readOmpHistory({
			async request() { return { data: malformedPages[index++] ?? malformedPages.at(-1) }; },
		}, { binding, workspace: "/workspace" }, "omp", binding), /OMP native history/);
	}
});

test("Pi complete reconciliation proof accepts 500 entries and fails closed at 501", async () => {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		for (const entryCount of [500, 501]) {
			const root = mkdtempSync(join(tmpdir(), `pibo-pi-proof-cap-${entryCount}-`));
			const workspace = join(root, "workspace");
			const agentDir = join(root, "agent");
			const nativeSessionId = `pi_proof_cap_${entryCount}`;
			const safePath = `--${workspace.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
			const sessionDir = join(agentDir, "sessions", safePath);
			const path = join(sessionDir, `20260827_${nativeSessionId}.jsonl`);
			mkdirSync(sessionDir, { recursive: true });
			const lines = [
				JSON.stringify({ type: "session", id: nativeSessionId, timestamp: "2026-08-27T00:00:00Z", cwd: workspace }),
				...Array.from({ length: entryCount }, (_, index) => JSON.stringify(message(
					`user-${index}`,
					"user",
					[{ type: "text", text: `prompt ${index}` }],
					"2026-08-27T00:00:01Z",
				))),
			];
			writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
			process.env.PI_CODING_AGENT_DIR = agentDir;
			const input = { binding: binding(nativeSessionId, { kind: "local-file", value: path }), workspace };
			const page = await readPiAgentRuntimeHistory("pi", { ...input, limit: 1 });
			assert.equal(page.reconciliationProof.complete, entryCount === 500);
			assert.equal(page.reconciliationProof.entries.length, entryCount === 500 ? 500 : 1);
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
});
