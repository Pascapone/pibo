import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows, renderableTerminalValue, terminalTextValue } from "../dist/session-ui/index.js";

const sessionId = "pibo:test-session";

function traceNode(type, id, overrides = {}) {
	return {
		id,
		piboSessionId: sessionId,
		type,
		title: overrides.title ?? defaultTitle(type),
		status: overrides.status ?? "done",
		startedAt: overrides.startedAt ?? `2026-05-16T10:00:${String(overrides.order ?? 0).padStart(2, "0")}.000Z`,
		children: overrides.children ?? [],
		...overrides,
	};
}

function defaultTitle(type) {
	return ({
		"user.message": "User Message",
		"assistant.message": "Agent Message",
		"tool.call": "read",
		"tool.result": "read",
		"yielded.run": "Yielded Run",
		error: "Error",
	})[type] ?? type;
}

function traceView(nodes) {
	return {
		piboSessionId: sessionId,
		piSessionId: "pi:test-session",
		title: "Fixture session",
		version: "test",
		nodes,
		rawEvents: [],
	};
}

function rowText(row) {
	return row.lines.flatMap((line) => line.tokens.map((token) => token.text)).join("");
}

test("compact row generation covers core terminal row kinds deterministically", () => {
	const rows = buildCompactTerminalRows(traceView([
		traceNode("user.message", "node-user", { order: 1, output: "Investigate issue" }),
		traceNode("assistant.message", "node-assistant", { order: 2, output: "I will check." }),
		traceNode("tool.call", "node-tool-call", { order: 3, title: "read", input: { path: "src/index.ts" }, output: "line one\nline two" }),
		traceNode("tool.result", "node-tool-result", { order: 4, title: "read", output: { ok: true, value: [1, 2] } }),
		traceNode("yielded.run", "node-run", { order: 5, status: "running", summary: "typecheck", output: "npm run typecheck" }),
		traceNode("error", "node-error", { order: 6, status: "error", error: "boom" }),
	]), { showThinking: false });

	assert.deepEqual(rows.map((row) => [row.id, row.kind, row.status]), [
		["node-user", "message.user", "done"],
		["node-assistant", "message.assistant", "done"],
		["node-tool-call", "tool.call", "done"],
		["node-tool-result", "tool.call", "done"],
		["node-run", "yielded.run", "running"],
		["node-error", "error", "error"],
	]);
	assert.equal(rows[0].lines[0].prefix, "prompt");
	assert.equal(rows[0].output, "Investigate issue");
	assert.equal(rows[1].output, "I will check.");
	assert.match(rowText(rows[2]), /Called/);
	assert.match(rowText(rows[2]), /line one/);
	assert.match(rowText(rows[3]), /Returned read/);
	assert.match(rowText(rows[3]), /"ok": true/);
	assert.equal(rows[4].runId, undefined);
	assert.match(rowText(rows[4]), /Waiting on runs typecheck/);
	assert.equal(rows[5].errorKind, "system");
	assert.match(rowText(rows[5]), /Error boom/);
});

test("compact row generation preserves streaming order metadata and running state", () => {
	const rows = buildCompactTerminalRows(traceView([
		traceNode("user.message", "node-user", { order: 1, status: "done", output: "Start work", orderKey: { streamId: 1, streamFrameIndex: 0 }, source: "event-log", eventId: "evt-user" }),
		traceNode("model.reasoning", "node-thinking", { order: 2, status: "running", output: "Considering next step", orderKey: { streamId: 1, streamFrameIndex: 1 }, source: "stream", eventId: "evt-thinking" }),
		traceNode("tool.call", "node-tool-running", { order: 3, status: "running", title: "read", input: { path: "src/index.ts" }, output: "opening file", orderKey: { streamId: 1, streamFrameIndex: 2 }, source: "stream", eventId: "evt-tool" }),
		traceNode("assistant.message", "node-assistant-running", { order: 4, status: "running", output: "Partial answer", orderKey: { streamId: 1, streamFrameIndex: 3 }, source: "stream", eventId: "evt-assistant" }),
		traceNode("execution.command", "node-status", { order: 5, status: "done", title: "status", output: { processing: true, streaming: true, queuedMessages: 1, contextUsage: { tokens: 25, contextWindow: 100, percent: 25 } }, orderKey: { streamId: 1, streamFrameIndex: 4 }, source: "local-ui", eventId: "evt-status" }),
	]), { showThinking: true });

	assert.deepEqual(rows.map((row) => [row.id, row.kind, row.status, row.orderSource, row.orderStreamId, row.orderStreamFrameIndex]), [
		["node-user", "message.user", "done", "event-log", 1, 0],
		["node-thinking", "reasoning", "running", "stream", 1, 1],
		["node-tool-running", "tool.call", "running", "stream", 1, 2],
		["node-assistant-running", "message.assistant", "running", "stream", 1, 3],
		["node-status", "tool.status", "done", "local-ui", 1, 4],
	]);
	assert.match(rowText(rows[1]), /Thinking/);
	assert.match(rowText(rows[2]), /Calling/);
	assert.equal(rows[3].output, "Partial answer");
	assert.equal(rows[4].output.processing, true);
});

test("compact row previews handle long text, JSON-like values, empty values, and missing fields", () => {
	const longLine = "x".repeat(240);
	const rows = buildCompactTerminalRows(traceView([
		traceNode("tool.call", "node-empty", { order: 1, title: "custom_tool" }),
		traceNode("tool.result", "node-long", { order: 2, title: "custom_tool", output: `${longLine}\nsecond\nthird\nfourth\nfifth\nsixth` }),
		traceNode("tool.result", "node-json", { order: 3, title: "custom_tool", output: { nested: { value: 42 }, empty: null } }),
	]), { showThinking: false });

	assert.equal(rows[0].lines.length, 1, "empty/missing optional fields should produce only the call line");
	assert.equal(rows[0].expandable, false);

	const longPreviewToken = rows[1].lines[1].tokens[0];
	assert.equal(longPreviewToken.text.length, 240);
	assert.equal(longPreviewToken.text, longLine);
	assert.doesNotMatch(rowText(rows[1]), /truncated/);
	assert.match(rowText(rows[1]), /\+1 more lines/);
	assert.doesNotMatch(rowText(rows[1]), /sixth/);

	assert.match(rowText(rows[2]), /"nested": \{/);
	assert.deepEqual(renderableTerminalValue(undefined), { kind: "empty" });
	assert.deepEqual(renderableTerminalValue({ value: 1 }), { kind: "json", value: { value: 1 } });
	assert.equal(terminalTextValue({ content: [{ type: "text", text: "joined" }] }), "joined");
});

test("shared terminal view-model source stays renderer-neutral", () => {
	const sourceDir = path.resolve("src/session-ui");
	const files = ["index.ts", "terminalRows.ts", "terminalValue.ts"];
	for (const file of files) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|react-dom|react-virtuoso|lucide-react|ink)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /\.(?:css|scss|sass)["']/i, `${file} must not import stylesheets`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|Tailwind/i, `${file} must not use browser or styling APIs`);
	}
});
