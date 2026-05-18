import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { formatInkJson, formatStatusHeaderLines, InkSessionAppView, InkTerminalView, renderInkMarkdownLines, rowWindow } from "../dist/apps/cli-ui/index.js";
import { buildCanonicalTerminalRows, buildExpandableDetailFixtureRow, buildWebDerivedLongOutputRows, disposedStatusPayload, fullStatusPayload, highUsageStatusPayload, partialStatusPayload, unavailableStatusPayload } from "./fixtures/terminal-parity-fixtures.mjs";

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
	assert.match(output, /• Called read/);
	assert.match(output, /src\/index\.ts/);
	assert.match(output, /• Waiting on runs typecheck/);
	assert.match(output, /✕ • Error boom/);
	assert.doesNotMatch(output, /▣ (Tool|Yielded run|Error)/);
});

test("InkTerminalView renders rich shared card descriptors with Web-parity labels", () => {
	const rows = [
		{ id: "user", kind: "message.user", status: "done", lines: [{ prefix: "prompt", tokens: [{ text: "User prompt" }] }], sourceNodeIds: ["user"] },
		{ id: "assistant", kind: "message.assistant", status: "done", lines: [], output: "Assistant reply", sourceNodeIds: ["assistant"] },
		{ id: "reason", kind: "reasoning", status: "done", markdown: "Reasoned safely", lines: [{ prefix: "bullet", tokens: [{ text: "Thought", tone: "amber", weight: "semibold" }] }], sourceNodeIds: ["reason"] },
		{ id: "tool", kind: "tool.call", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "Called ", tone: "green", weight: "semibold" }], functionCall: { name: "read", input: { path: "src/index.ts" } } }], sourceNodeIds: ["tool"] },
		{ id: "status", kind: "tool.status", status: "done", lines: [], output: { piboSessionId: "ps_rich", queuedMessages: 0, processing: false, streaming: false, cwd: "/workspace", contextUsage: { tokens: 125, contextWindow: 1000, percent: 12.5 }, providerUsage: { provider: "openai", limits: [{ label: "requests", usedPercent: 25 }] } }, sourceNodeIds: ["status"] },
		{ id: "thinking", kind: "tool.thinking", status: "done", lines: [], output: { level: "high", availableLevels: ["low", "high"] }, sourceNodeIds: ["thinking"] },
		{ id: "model", kind: "tool.model", status: "done", lines: [], output: { providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-test", label: "GPT Test" }] }] }, sourceNodeIds: ["model"] },
		{ id: "login", kind: "tool.login", status: "done", lines: [], output: { providers: [{ id: "openai", name: "OpenAI", authMethods: ["api_key"] }] }, sourceNodeIds: ["login"] },
		{ id: "run", kind: "yielded.run", status: "running", lines: [{ prefix: "bullet", tokens: [{ text: "Waiting on runs typecheck" }] }], sourceNodeIds: ["run"] },
		{ id: "compact", kind: "execution.compaction", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "Compacted transcript" }] }], sourceNodeIds: ["compact"] },
		{ id: "command", kind: "execution.command", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "Ran /status" }] }], sourceNodeIds: ["command"] },
		{ id: "error", kind: "error", status: "error", lines: [], error: "TOKEN=secret-value failed", sourceNodeIds: ["error"] },
	];
	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 20, maxLineChars: 160 }));

	assert.match(output, /› User prompt/);
	assert.match(output, /Assistant reply/);
	assert.match(output, /Thought/);
	assert.match(output, /• Called read/);
	assert.doesNotMatch(output, /▣ Tool/);
	assert.match(output, /▣ Status — status · done/);
	assert.match(output, /Context: █/);
	assert.match(output, /openai requests:/);
	assert.match(output, /▣ Thinking — thinking · done/);
	assert.match(output, /Actions: .*low.*high/);
	assert.match(output, /▣ Model — model · done/);
	assert.match(output, /OpenAI \/ GPT Test/);
	assert.match(output, /▣ Login — login · done/);
	assert.match(output, /• Waiting on runs typecheck/);
	assert.match(output, /• Compacted transcript/);
	assert.match(output, /• Ran \/status/);
	assert.match(output, /✕ TOKEN=\[redacted\] failed/);
	assert.doesNotMatch(output, /▣ (Yielded run|Compaction|Command|Error)/);
	assert.match(output, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(output, /secret-value/);
});

test("Ink renderer consumes the canonical shared parity fixture", () => {
	const rows = buildCanonicalTerminalRows();
	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 40, maxLineChars: 160 }));

	for (const kind of [
		"message.user",
		"message.assistant",
		"reasoning",
		"tool.call",
		"tool.status",
		"tool.thinking",
		"tool.model",
		"tool.login",
		"yielded.run",
		"execution.command",
		"execution.compaction",
		"error",
	]) {
		assert.ok(rows.some((row) => row.kind === kind), `fixture includes ${kind}`);
	}
	assert.match(output, /Audit the compact terminal renderer/);
	assert.match(output, /▣ Status — status · done/);
	assert.match(output, /▣ Thinking — thinking · done/);
	assert.match(output, /▣ Model — model · done/);
	assert.match(output, /▣ Login — login · done/);
	assert.match(output, /Provider quota: unavailable/);
	assert.doesNotMatch(output, /▣ (Tool|Yielded run|Compaction|Command|Error)/);
	assert.doesNotMatch(output, /sk_fixture_secret|detail-secret-value/);
});

function rowsForMarkerTest() {
	return [
		{ id: "user-marker", kind: "message.user", status: "done", lines: [{ prefix: "prompt", tokens: [{ text: "user marker" }] }], sourceNodeIds: ["user-marker"] },
		{ id: "assistant-marker", kind: "message.assistant", status: "done", lines: [{ prefix: "none", tokens: [{ text: "assistant marker" }] }], sourceNodeIds: ["assistant-marker"] },
	];
}

test("Ink normal rows are row-first and dense while structured exceptions remain card-like", () => {
	const rows = [
		{ id: "user", kind: "message.user", status: "done", lines: [{ prefix: "prompt", tokens: [{ text: "user row" }] }], sourceNodeIds: ["user"] },
		{ id: "assistant", kind: "message.assistant", status: "done", lines: [{ prefix: "none", tokens: [{ text: "assistant row" }] }], sourceNodeIds: ["assistant"] },
		{ id: "reason", kind: "reasoning", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "thinking row", tone: "amber" }] }], sourceNodeIds: ["reason"] },
		{ id: "tool", kind: "tool.call", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "Called read" }] }], sourceNodeIds: ["tool"], output: "preview" },
		{ id: "command", kind: "execution.command", status: "done", lines: [{ prefix: "bullet", tokens: [{ text: "Command /status" }] }], sourceNodeIds: ["command"] },
		{ id: "status", kind: "tool.status", status: "done", lines: [], output: unavailableStatusPayload(), sourceNodeIds: ["status"] },
		{ id: "error", kind: "error", status: "error", lines: [], error: "TOKEN=secret-value failed", sourceNodeIds: ["error"] },
	];
	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 20, maxLineChars: 120 }));

	assert.match(output, /› user row\n  assistant row\n✓ • thinking row\n✓ • Called read\n✓ • Command \/status\n✓ ▣ Status — status · done/);
	assert.match(output, /✕ TOKEN=\[redacted\] failed/);
	assert.doesNotMatch(output, /▣ (Tool|Command|Error)/);
	assert.doesNotMatch(output, /\n\n/);
	assert.doesNotMatch(output, /secret-value/);
});

test("Ink long-output rows collapse to five lines and expand full details", () => {
	const row = buildWebDerivedLongOutputRows().find((item) => item.id === "web-derived-tool-call-long-output");
	assert.ok(row, "fixture row exists");
	const collapsed = renderToString(React.createElement(InkTerminalView, { rows: [row], selectedRowId: row.id, maxRows: 5, maxLineChars: 220 }));
	assert.match(collapsed, /web-derived output line 05/);
	assert.doesNotMatch(collapsed, /web-derived output line 06/);
	assert.match(collapsed, /\+7 more lines/);
	assert.match(collapsed, /details available/);

	const expanded = renderToString(React.createElement(InkTerminalView, { rows: [row], selectedRowId: row.id, expandedRowIds: [row.id], maxRows: 5, maxLineChars: 220 }));
	assert.match(expanded, /Output:.*web-derived output line 01/s);
	assert.match(expanded, /web-derived output line 12/);
	assert.match(expanded, /7 hidden while collapsed/);
	assert.doesNotMatch(expanded, /long-output-secret/);
});

test("Ink renderer gives user and assistant rows distinct terminal markers", () => {
	const output = renderToString(React.createElement(InkTerminalView, { rows: rowsForMarkerTest(), maxRows: 5, maxLineChars: 80 }));
	assert.match(output, /› user marker/);
	assert.match(output, /  assistant marker/);
	assert.doesNotMatch(output, /› assistant marker/);
});

test("Ink renderer renders selected detail affordance collapsed and inline detail sections when expanded", () => {
	const row = buildExpandableDetailFixtureRow();
	const collapsed = renderToString(React.createElement(InkTerminalView, { rows: [row], selectedRowId: row.id, maxRows: 5, maxLineChars: 120 }));
	assert.match(collapsed, /details available · press d or enter/);
	assert.doesNotMatch(collapsed, /Command args:/);

	const output = renderToString(React.createElement(InkTerminalView, { rows: [row], selectedRowId: row.id, expandedRowIds: [row.id], maxRows: 5, maxLineChars: 120 }));
	assert.match(output, /└ Details/);
	for (const label of ["Input", "Output", "Error", "Linked session", "Command args", "Tool result preview", "Large JSON", "Long markdown"]) {
		assert.match(output, new RegExp(`${label}:`));
	}
	assert.match(output, /Call failed detail_tool/);
	assert.match(output, /more items|fixture-value-0/);
	assert.match(output, /token=\[redacted\]/);
	assert.doesNotMatch(output, /detail-secret-value|sk_fixture_secret/);
	assert.ok(output.length < 8000, "detail rendering stays bounded");
});

test("Ink status card renders compact runtime fields bars unavailable states tools credits and provider labels", () => {
	const rows = [
		{ id: "status-full", kind: "tool.status", status: "done", lines: [], output: fullStatusPayload(), sourceNodeIds: ["status-full"] },
		{ id: "status-partial", kind: "tool.status", status: "done", lines: [], output: partialStatusPayload(), sourceNodeIds: ["status-partial"] },
		{ id: "status-unavailable", kind: "tool.status", status: "done", lines: [], output: unavailableStatusPayload(), sourceNodeIds: ["status-unavailable"] },
		{ id: "status-disposed", kind: "tool.status", status: "done", lines: [], output: disposedStatusPayload(), sourceNodeIds: ["status-disposed"] },
	];
	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 10, maxLineChars: 180 }));

	assert.match(output, /Status — status · done · idle · session Terminal parity fixture/);
	assert.match(output, /model GPT\s*Test · owner Web user Fixture/);
	assert.match(output, /Identity: owner Web user Fixture · session Terminal parity fixture · profile\s*pibo-agent · model GPT\s*Test/);
	assert.match(output, /Runtime: idle · queue 3/);
	assert.match(output, /Provider: plan pro · credits unlimited/);
	assert.match(output, /Tools: enabled 3 folded · active bash · names in details/);
	assert.doesNotMatch(output, /Enabled tools: 3 \(read, edit, bash\)/);
	assert.doesNotMatch(output, /Processing: no|Streaming: no|Disposed: no|Fast mode: off/);
	assert.match(output, /Runtime: streaming · queue 1 · streaming yes/);
	assert.match(output, /Runtime: idle\n ↳ Message: Provider\/context usage unavailable/);
	assert.match(output, /Runtime: disposed · disposed yes/);
	assert.match(output, /anthropic messages: .*75\.0%/);
	assert.match(output, /anthropic messages: .*75\.0% remaining/);
	assert.match(output, /local-ai requests: unavailable · [░-]+/);
	assert.match(output, /Provider quota: unavailable · [░-]+/);
	assert.match(output, /Context: unavailable · [░-]+/);
	assert.doesNotMatch(output, /sk_fixture_secret|warning-secret-value/);
});

test("Ink status progress bars use readable ASCII fallback when color or glyph support is limited", () => {
	const previousNoColor = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const rows = [{ id: "status-ascii", kind: "tool.status", status: "done", lines: [], output: highUsageStatusPayload(), sourceNodeIds: ["status-ascii"] }];
		const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 5, maxLineChars: 160 }));
		assert.match(output, /Context: #################-/);
		assert.match(output, /openai requests: ################## 100\.0%/);
		assert.match(output, /openai spend: ##---------------- 9\.0%/);
		assert.doesNotMatch(output, /█|░|sk_fixture_secret|warning-secret-value/);
	} finally {
		if (previousNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previousNoColor;
	}
});

test("Ink Session app keeps owner, session, error, and command state readable at narrow widths", () => {
	const state = {
		loading: false,
		status: {
			source: "local/direct",
			mode: "local",
			connected: true,
			activeOwnerLabel: "Web user narrow",
			activeOwnerScope: "user:narrow",
			activeRoomId: "room_narrow",
			activeAgentId: "pibo-agent",
			activeModel: { provider: "openai", id: "gpt-test", label: "GPT Test" },
		},
		activeRoom: { id: "room_narrow", title: "Narrow Room", ownerScope: "user:narrow" },
		session: { id: "ps_narrow", title: "Narrow Session", roomId: "room_narrow", ownerScope: "user:narrow", profile: "pibo-agent", status: "idle" },
		rows: [
			{ id: "err", kind: "error", status: "error", lines: [], error: "Provider TOKEN=secret-value failed in a narrow terminal", sourceNodeIds: ["err"] },
		],
		input: "/status",
		mode: "transcript",
		error: "Action failed but remains visible",
		message: "Status card remains readable.",
	};
	const headerLines = formatStatusHeaderLines(state, 60);
	assert.ok(headerLines.some((line) => line.includes("owner Web user narrow") && line.includes("room Narrow Room")), "narrow header includes owner and room names");
	assert.ok(headerLines.some((line) => line.includes("session Narrow Session")), "narrow header includes a session line");
	const output = renderToString(React.createElement(InkSessionAppView, { state, maxRows: 5, maxLineChars: 60 }));

	assert.match(output, /owner Web user narrow · room Narrow Room/);
	assert.match(output, /session Narrow Session/);
	assert.match(output, /Error:/);
	assert.match(output, /Status card remains readable/);
	assert.match(output, /› \/status/);
	assert.match(output, /✕ Provider TOKEN=\[redacted\] failed/);
	assert.doesNotMatch(output, /▣ Error/);
	assert.match(output, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(output, /secret-value/);
});

test("Ink renderer no-color output remains readable through text markers", () => {
	const previousNoColor = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const output = renderToString(React.createElement(InkTerminalView, { rows: fixtureRows(), maxRows: 20, maxLineChars: 80 }));
		assert.match(output, /› Investigate issue/);
		assert.match(output, /• Called read/);
		assert.match(output, /✕ • Error boom/);
		assert.doesNotMatch(output, /▣ (Tool|Error)/);
		assert.doesNotMatch(output, /\u001b\[/);
	} finally {
		if (previousNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previousNoColor;
	}
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
	assert.doesNotMatch(charBounded, /truncated/);
	assert.match(charBounded, new RegExp(`x{${500}}`));
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
