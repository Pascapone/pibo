import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { formatInkJson, InkTerminalView, renderInkMarkdownLines, rowWindow } from "../dist/apps/cli-ui/index.js";

const sessionId = "pibo:ink-renderer-test";

function traceNode(type, id, overrides = {}) {
	return {
		id,
		piboSessionId: sessionId,
		type,
		title: overrides.title ?? defaultTitle(type),
		status: overrides.status ?? "done",
		startedAt: overrides.startedAt ?? `2026-05-16T11:00:${String(overrides.order ?? 0).padStart(2, "0")}.000Z`,
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
		piSessionId: "pi:ink-renderer-test",
		title: "Ink renderer fixture",
		version: "test",
		nodes,
		rawEvents: [],
	};
}

function fixtureRows() {
	return buildCompactTerminalRows(traceView([
		traceNode("user.message", "node-user", { order: 1, output: "Investigate issue" }),
		traceNode("assistant.message", "node-assistant", { order: 2, output: "I will check.\n\n- first\n- second" }),
		traceNode("tool.call", "node-tool-call", { order: 3, title: "read", input: { path: "src/index.ts" }, output: "line one" }),
		traceNode("yielded.run", "node-run", { order: 4, status: "running", summary: "typecheck", output: "npm run typecheck" }),
		traceNode("error", "node-error", { order: 5, status: "error", error: "boom" }),
	]), { showThinking: false });
}

test("InkTerminalView renders representative compact rows to terminal text", () => {
	const output = renderToString(React.createElement(InkTerminalView, { rows: fixtureRows(), maxRows: 20, maxLineChars: 120 }));

	assert.match(output, /› Investigate issue/);
	assert.match(output, /I will check\./);
	assert.match(output, /- first/);
	assert.match(output, /✓ • Called read/);
	assert.match(output, /src\/index\.ts/);
	assert.match(output, /… • Waiting on runs typecheck/);
	assert.match(output, /✕ • Error boom/);
});

test("InkTerminalView bounds large row lists to a tail window", () => {
	const rows = Array.from({ length: 6 }, (_, index) => ({
		id: `row-${index}`,
		kind: "message.user",
		status: "done",
		lines: [{ prefix: "prompt", tokens: [{ text: `message ${index}` }] }],
		sourceNodeIds: [`node-${index}`],
	}));

	assert.deepEqual(rowWindow(rows, 2).map((row) => row.id), ["row-4", "row-5"]);
	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 2 }));
	assert.match(output, /… 4 earlier rows omitted/);
	assert.doesNotMatch(output, /message 0/);
	assert.match(output, /message 4/);
	assert.match(output, /message 5/);
});

test("terminal markdown helper renders plain lists, links, and code fences", () => {
	const lines = renderInkMarkdownLines("# Title\n\nSee [docs](https://example.test).\n\n- item\n\n```ts\nconst ok = true;\n```", { maxLines: 20 });
	assert.deepEqual(lines, ["Title", "", "See docs (https://example.test).", "", "- item", "", "    const ok = true;"]);
});

test("terminal JSON helper pretty-prints and marks bounded truncation", () => {
	const text = formatInkJson({ ok: true, nested: { values: Array.from({ length: 50 }, (_, index) => index) } }, { maxChars: 160, maxArrayItems: 5 });
	assert.match(text, /"ok": true/);
	assert.match(text, /… 45 more items/);

	const charBounded = formatInkJson({ ok: true, value: "x".repeat(500) }, { maxChars: 120 });
	assert.match(charBounded, /… truncated/);
});

test("Ink renderer source avoids Web-only presentation dependencies", () => {
	const sourceDir = path.resolve("src/apps/cli-ui");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react-dom|react-virtuoso|lucide-react|@uiw\/react-json-view|react-markdown|prismjs)["']/i, `${file} must not import Web-only renderer dependencies`);
		assert.doesNotMatch(source, /\.(?:css|scss|sass)["']/i, `${file} must not import stylesheets`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|Tailwind|className=/i, `${file} must not use browser or Tailwind APIs`);
	}
});
