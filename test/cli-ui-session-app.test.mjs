import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { cliSessionsHelpText, InkSessionAppView, reduceInkSessionInputState } from "../dist/apps/cli-ui/index.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

function traceView() {
	return {
		piboSessionId: "ps_cli_app_shell",
		piSessionId: "pi_cli_app_shell",
		title: "CLI app shell fixture",
		version: "test",
		rawEvents: [],
		nodes: [
			{
				id: "node-user",
				piboSessionId: "ps_cli_app_shell",
				type: "user.message",
				title: "User Message",
				status: "done",
				startedAt: "2026-05-16T13:00:00.000Z",
				output: "Show me status",
				children: [],
			},
			{
				id: "node-assistant",
				piboSessionId: "ps_cli_app_shell",
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				startedAt: "2026-05-16T13:00:01.000Z",
				output: "Status looks healthy.",
				children: [],
			},
		],
	};
}

test("InkSessionAppView renders status bar transcript viewport and input line", () => {
	const rows = buildCompactTerminalRows(traceView(), { showThinking: false });
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: {
			loading: false,
			status: {
				source: "fake",
				mode: "fake",
				connected: true,
				rooms: "supported",
				sessions: "supported",
				agents: "supported",
				activeSessionId: "ps_cli_app_shell",
				activeAgentId: "pibo-agent",
				updatedAt: "2026-05-16T13:00:02.000Z",
			},
			session: {
				id: "ps_cli_app_shell",
				title: "CLI app shell fixture",
				profile: "pibo-agent",
				agentId: "pibo-agent",
				status: "idle",
			},
			rows,
			input: "/status",
			mode: "transcript",
		},
		maxRows: 20,
	}));

	assert.match(output, /Pibo CLI Sessions \| fake \| CLI app shell fixture \| pibo-agent/);
	assert.match(output, /Commands: \/help \/new \/session \/agent \/status \/clear \/exit \/quit/);
	assert.match(output, /› Show me status/);
	assert.match(output, /Status looks healthy\./);
	assert.match(output, /› \/status/);
});

test("Ink session input reducer captures text enter backspace and escape", () => {
	const base = { loading: false, rows: [], input: "", mode: "picker" };
	const typed = reduceInkSessionInputState(base, { type: "text", value: "hi" });
	assert.equal(typed.input, "hi");
	assert.equal(typed.message, undefined);
	assert.equal(reduceInkSessionInputState(typed, { type: "backspace" }).input, "h");
	const entered = reduceInkSessionInputState(typed, { type: "enter" });
	assert.equal(entered.input, "");
	assert.match(entered.message, /Input captured/);
	const escaped = reduceInkSessionInputState(typed, { type: "escape" });
	assert.equal(escaped.input, "");
	assert.equal(escaped.mode, "transcript");
	assert.equal(escaped.message, "Canceled.");
});

test("pibo tui:sessions command help and root discovery describe the new UI without hiding existing TUI commands", async () => {
	const help = cliSessionsHelpText();
	assert.match(help, /reduced Web Chat-derived session UI/);
	assert.match(help, /\/help \/new \/session \/agent \/status \/clear \/exit \/quit/);
	assert.match(help, /pibo tui\n/);
	assert.match(help, /pibo tui:routed/);

	const commandHelp = await execFileAsync("node", [cliPath, "tui:sessions", "--help"]);
	assert.match(commandHelp.stdout, /pibo tui:sessions/);
	assert.match(commandHelp.stdout, /--demo/);

	const rootHelp = await execFileAsync("node", [cliPath, "--help"]);
	assert.match(rootHelp.stdout, /tui\s+Start the direct Pi TUI/);
	assert.match(rootHelp.stdout, /tui:routed\s+Start the local routed Pibo TUI/);
	assert.match(rootHelp.stdout, /tui:sessions\s+Start the reduced Web Chat-derived session UI/);
});

test("pibo tui:sessions startup has a non-TTY smoke-test seam", async () => {
	await assert.rejects(
		() => execFileAsync("node", [cliPath, "tui:sessions", "--demo"]),
		(error) => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /requires an interactive TTY/);
			return true;
		},
	);
});
