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

		const secondPage = await readPiAgentRuntimeHistory("pi", { ...input, cursor: firstPage.nextCursor, limit: 10 });
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
