import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { buildTerminalCardDescriptors } from "../dist/session-ui/index.js";
import { InkSessionAppView, InkTerminalView } from "../dist/apps/cli-ui/index.js";
import { buildCanonicalTerminalRows, buildStreamingTerminalRows, highUsageStatusPayload } from "./fixtures/terminal-parity-fixtures.mjs";

const execFileAsync = promisify(execFile);

function normalizeScreen(value) {
	return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function baseAppState() {
	return {
		loading: false,
		status: {
			source: "debug/final",
			mode: "local",
			connected: true,
			activeOwnerLabel: "Web user final",
			activeOwnerScope: "user:final",
			activeRoomTitle: "Personal Chat",
			activeAgentId: "pibo-agent",
			activeModel: { provider: "openai", id: "gpt-test", label: "GPT Test" },
		},
		session: { id: "ps_final", title: "Final parity session", ownerScope: "user:final", profile: "pibo-agent", status: "idle" },
		activeRoom: { id: "room_final", title: "Personal Chat" },
		rows: buildStreamingTerminalRows(),
		input: "/status",
		mode: "transcript",
	};
}

test("final PTY smoke runner exposes rendering-parity scenarios with bounded assertions", async () => {
	const list = await execFileAsync("node", ["scripts/ink-cli-v2-pty-smoke.mjs", "--list"]);
	for (const name of [
		"owner-room-session-message",
		"slash-suggestions-status-thinking",
		"overlay-keyboard-model-login",
		"mixed-transcript-fixture",
		"narrow-no-color-status",
		"existing-session-hydration",
	]) {
		assert.match(list.stdout, new RegExp(`${name}\\t`));
	}

	const dryRun = await execFileAsync("node", ["scripts/ink-cli-v2-pty-smoke.mjs", "--scenario", "narrow-no-color-status", "--artifact-root", ".tmp/test-final-pty", "--dry-run"]);
	assert.match(dryRun.stdout, /--timeout-ms 20000/);
	assert.match(dryRun.stdout, /--idle-timeout-ms 5000/);
	assert.match(dryRun.stdout, /--cols 64/);
	assert.match(dryRun.stdout, /--env NO_COLOR=1/);
	assert.match(dryRun.stdout, /--reject █/);
	assert.match(dryRun.stdout, /--reject sk_fixture_secret/);
});

test("visual artifact generator writes a reviewable terminal HTML fallback", async () => {
	const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-pty-visual-"));
	fs.writeFileSync(path.join(artifactDir, "screen.txt"), "▣ Status — status · done\nContext: ########-- 80.0%\nTOKEN=[redacted]\n");
	fs.writeFileSync(path.join(artifactDir, "clean.txt"), "clean fallback");
	fs.writeFileSync(path.join(artifactDir, "raw.ansi.log"), "\u001b[32mStatus\u001b[0m");
	fs.writeFileSync(path.join(artifactDir, "metadata.json"), JSON.stringify({ rows: 24, cols: 80, classification: "test" }, null, 2));

	const result = await execFileAsync("node", ["scripts/render-pty-artifact-html.mjs", "--artifact-dir", artifactDir]);
	const htmlPath = result.stdout.trim();
	const html = fs.readFileSync(htmlPath, "utf8");
	assert.match(html, /PTY visual artifact/);
	assert.match(html, /▣ Status — status · done/);
	assert.match(html, /TOKEN=\[redacted\]/);
	assert.match(html, /Raw ANSI is available/);
	assert.doesNotMatch(html, /secret-value/);
});

test("golden terminal screens keep transcript-first slash picker and command placement", () => {
	const output = normalizeScreen(renderToString(React.createElement(InkSessionAppView, {
		state: {
			...baseAppState(),
			slashSuggestions: {
				selectedIndex: 0,
				items: [
					{ id: "status", slash: "/status", actionName: "status", description: "Show runtime status.", group: "runtime", support: "terminal" },
					{ id: "download", slash: "/download", actionName: "download", description: "Download a browser artifact.", group: "unsupported", support: "deferred", unsupportedReason: "Use Web downloads." },
				],
			},
		},
		maxRows: 20,
		maxLineChars: 110,
	})));

	assert.ok(output.indexOf("› Run the parity smoke.") < output.indexOf("Command /status"));
	assert.ok(output.indexOf("Command /status") < output.indexOf("▣ Status — status · done"));
	assert.ok(output.indexOf("▣ Status — status · done") < output.indexOf("slash commands"));
	assert.ok(output.indexOf("slash commands") < output.indexOf("› /status"));
	assert.match(output, /❯ \/status · Show runtime status/);
	assert.match(output, /× \/download · Download a browser artifact/);
	assert.doesNotMatch(output, /status payload|dashboard|state\.message/i);
});

test("golden mixed transcript status and NO_COLOR screens reject visual regressions", () => {
	const mixedRows = buildCanonicalTerminalRows();
	const mixed = normalizeScreen(renderToString(React.createElement(InkTerminalView, { rows: mixedRows, maxRows: 40, maxLineChars: 140 })));
	for (const snippet of ["› Audit the compact terminal renderer", "▣ Status — status · done", "▣ Thinking — thinking · done", "▣ Model — model · done", "▣ Login — login · done", "✕ • Error Provider failed"]) {
		assert.match(mixed, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	assert.doesNotMatch(mixed, /▣ (Tool|Yielded run|Compaction|Command|Error)/);
	assert.ok(mixed.indexOf("Audit the compact terminal renderer") < mixed.indexOf("▣ Status — status · done"));
	assert.match(mixed, /(?:TOKEN|token)=\[redacted\]/);
	assert.doesNotMatch(mixed, /sk_fixture_secret|detail-secret-value|warning-secret-value/);

	const previousNoColor = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const statusRows = [{ id: "status-no-color", kind: "tool.status", status: "done", lines: [], output: highUsageStatusPayload(), sourceNodeIds: ["status-no-color"] }];
		const noColor = normalizeScreen(renderToString(React.createElement(InkTerminalView, { rows: statusRows, maxRows: 8, maxLineChars: 72 })));
		assert.match(noColor, /Context: #/);
		assert.match(noColor, /openai spend: #/);
		assert.match(noColor, /Provider: plan team · credits \$42\.00/);
		assert.doesNotMatch(noColor, /█|sk_fixture_secret|warning-secret-value/);
	} finally {
		if (previousNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previousNoColor;
	}
});

test("Web compact terminal source keeps shared descriptor hooks for final parity fixtures", () => {
	const rows = buildCanonicalTerminalRows();
	const cards = buildTerminalCardDescriptors(rows);
	for (const kind of ["status", "thinking", "model", "login", "tool", "command", "error"]) {
		assert.ok(cards.some((card) => card.kind === kind), `fixture has ${kind} descriptor`);
	}

	const compactSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
	const statusSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx", "utf8");
	const thinkingSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/TerminalThinkingCard.tsx", "utf8");
	const modelSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/TerminalModelCard.tsx", "utf8");
	const loginSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/TerminalLoginCard.tsx", "utf8");

	for (const hook of ["data-pibo-terminal-row=\"true\"", "data-row-kind={row.kind}", "data-row-status={row.status}", "data-event-id={row.eventId}", "data-run-id={row.runId}", "data-order-source={row.orderSource}"]) {
		assert.match(compactSource, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	assert.match(statusSource, /buildTerminalCardDescriptor\(row\)/);
	assert.match(statusSource, /data-shared-terminal-card="status"/);
	assert.match(statusSource, /data-shared-status-field=\{field\.id\}/);
	assert.match(statusSource, /data-shared-progress=\{progress\.id\}/);
	assert.match(thinkingSource, /data-shared-terminal-card="thinking"/);
	assert.match(modelSource, /data-shared-terminal-card="model"/);
	assert.match(loginSource, /data-shared-terminal-card="login"/);
	assert.doesNotMatch(JSON.stringify(cards), /sk_fixture_secret|detail-secret-value|warning-secret-value/);
});
