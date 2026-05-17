import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { CliSourceError, createDefaultFakeCliSessionSource, FakeCliSessionSource } from "../dist/cli-session/index.js";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import {
	cliSessionsHelpText,
	cliSessionSlashHelpText,
	createCliSessionCleanup,
	formatCliSessionError,
	formatCliSessionStatus,
	handleCliSessionSubmittedInput,
	InkSessionAppView,
	parseCliSessionInput,
	reduceInkSessionInputState,
	runCliSessionsUi,
	terminalLineLimitFromColumns,
} from "../dist/apps/cli-ui/index.js";

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

function baseState() {
	const rows = buildCompactTerminalRows(traceView(), { showThinking: false });
	return {
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
	};
}

function stateHarness(initialState) {
	let state = initialState;
	const setState = (value) => {
		state = typeof value === "function" ? value(state) : value;
	};
	return {
		get state() {
			return state;
		},
		setState,
	};
}

function streamWithTty(isTTY, columns = 80) {
	const stream = new PassThrough();
	stream.isTTY = isTTY;
	stream.columns = columns;
	return stream;
}

async function openFakeSessionInto(source, harness, sessionId, message) {
	const opened = await source.openSession(sessionId);
	harness.setState((current) => ({
		...current,
		session: opened.session,
		status: opened.status,
		rows: buildCompactTerminalRows(opened.traceView, { showThinking: false }),
		mode: "transcript",
		picker: undefined,
		message,
		error: undefined,
	}));
	opened.subscribe((update) => {
		harness.setState((current) => ({
			...current,
			session: update.session ?? current.session,
			status: update.status ?? current.status,
			rows: update.traceView === undefined ? current.rows : buildCompactTerminalRows(update.traceView, { showThinking: false }),
			error: update.error?.message ?? current.error,
		}));
	});
}

test("InkSessionAppView renders status bar transcript viewport and input line", () => {
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: baseState(),
		maxRows: 20,
	}));

	assert.match(output, /Pibo CLI Sessions \| fake \| owner unknown \| CLI app shell fixture \| pibo-agent/);
	assert.match(output, /Commands: \/help \/new \/room \/session \/agent \/owner \/repair-user-unknown/);
	assert.match(output, /type \/ for suggestions, \/help for catalog/);
	assert.match(output, /› Show me status/);
	assert.match(output, /Status looks healthy\./);
	assert.match(output, /› \/status/);
});

test("InkSessionAppView renders slash suggestions", () => {
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: {
			...baseState(),
			input: "/th",
			slashSuggestions: {
				selectedIndex: 1,
				items: [
					{ id: "thinking", slash: "/thinking", actionName: "thinking", description: "Show or set model thinking level.", group: "runtime", support: "terminal-adapted" },
					{ id: "thinking-show", slash: "/thinking-show", actionName: "thinking", description: "Show thinking controls in Web.", group: "unsupported", support: "deferred", unsupportedReason: "Use /thinking in terminal." },
				],
			},
		},
	}));
	assert.match(output, /Slash commands/);
	assert.match(output, /\/thinking — Show or set model thinking level/);
	assert.match(output, /❯ \/thinking-show/);
	assert.match(output, /Use \/thinking in terminal/);
});

test("InkSessionAppView renders owner room and create-session pickers", () => {
	const ownerOutput = renderToString(React.createElement(InkSessionAppView, {
		state: {
			...baseState(),
			mode: "picker",
			picker: {
				kind: "owner",
				title: "Select effective owner",
				items: [
					{ id: "user:alpha", kind: "owner", ownerScope: "user:alpha", label: "Web user alpha", description: "user:alpha" },
					{ id: "user:beta", kind: "owner", ownerScope: "user:beta", label: "Web user beta", description: "user:beta" },
				],
				selectedIndex: 1,
				emptyMessage: "No owners",
			},
			message: "Select the Web user or Root recovery owner to use in this CLI session.",
		},
	}));
	assert.match(ownerOutput, /Select effective owner/);
	assert.match(ownerOutput, /Web user alpha/);
	assert.match(ownerOutput, /❯ Web user beta/);

	const sessionOutput = renderToString(React.createElement(InkSessionAppView, {
		state: {
			...baseState(),
			mode: "session-picker",
			picker: {
				kind: "session",
				title: "Select session in Personal Chat",
				items: [{ id: "create:room_personal", kind: "create-session", roomId: "room_personal", ownerScope: "user:alpha", label: "+ New session in Personal Chat", description: "Create and open" }],
				selectedIndex: 0,
				emptyMessage: "No sessions",
				roomId: "room_personal",
				ownerScope: "user:alpha",
			},
		},
	}));
	assert.match(sessionOutput, /Select session in Personal Chat/);
	assert.match(sessionOutput, /New session in Personal Chat/);
});

test("Ink session input reducer captures text, enter, navigation, escape, and slash suggestions", () => {
	const base = { loading: false, rows: [], input: "", mode: "session-picker", picker: { kind: "session", title: "Pick", items: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], selectedIndex: 0, emptyMessage: "None" } };
	const typed = reduceInkSessionInputState(base, { type: "text", value: "hi" });
	assert.equal(typed.input, "hi");
	assert.equal(reduceInkSessionInputState(typed, { type: "backspace" }).input, "h");
	assert.equal(reduceInkSessionInputState(typed, { type: "down" }).picker.selectedIndex, 1);
	const entered = reduceInkSessionInputState(typed, { type: "enter" });
	assert.equal(entered.input, "");
	assert.equal(entered.message, undefined);
	const escaped = reduceInkSessionInputState(typed, { type: "escape" });
	assert.equal(escaped.input, "");
	assert.equal(escaped.mode, "transcript");
	assert.equal(escaped.picker, undefined);
	assert.equal(escaped.message, "Canceled.");

	const slashBase = { loading: false, rows: [], input: "", mode: "transcript" };
	const slash = reduceInkSessionInputState(slashBase, { type: "text", value: "/" });
	assert.ok(slash.slashSuggestions.items.some((command) => command.slash === "/status"));
	const filtered = reduceInkSessionInputState(slash, { type: "text", value: "th" });
	assert.deepEqual(filtered.slashSuggestions.items.map((command) => command.slash), ["/thinking", "/thinking-show"]);
	const moved = reduceInkSessionInputState(filtered, { type: "down" });
	assert.equal(moved.slashSuggestions.selectedIndex, 1);
	const closed = reduceInkSessionInputState(filtered, { type: "escape" });
	assert.equal(closed.input, "/th");
	assert.equal(closed.slashSuggestions, undefined);
});

test("Slash parser distinguishes messages, commands, and empty input", () => {
	assert.deepEqual(parseCliSessionInput("  hello agent  "), { type: "message", text: "hello agent" });
	assert.deepEqual(parseCliSessionInput(" /STATUS now "), { type: "command", command: { name: "status", args: "now", raw: "/STATUS now" } });
	assert.deepEqual(parseCliSessionInput("   "), { type: "empty" });
	assert.match(cliSessionSlashHelpText(), /Slash command catalog/);
	assert.match(cliSessionSlashHelpText(), /CLI navigation and recovery commands/);
	assert.match(cliSessionSlashHelpText(), /Unsupported or deferred terminal commands/);
	assert.match(cliSessionSlashHelpText(), /\/download/);
});

test("exit cleanup closes open session subscriptions and source idempotently", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");
	const unsubscribe = opened.subscribe(() => {});
	assert.equal(source.listenerCount("ps_fake_existing"), 1);

	let closeSessionCalls = 0;
	const cleanup = createCliSessionCleanup(() => {
		closeSessionCalls += 1;
		unsubscribe();
		void opened.close();
	}, () => source.close());

	cleanup();
	cleanup();
	assert.equal(closeSessionCalls, 1);
	assert.equal(source.listenerCount("ps_fake_existing"), 0);
	assert.throws(() => source.setStatus({ message: "after-close" }), /source is closed/);
});

test("Slash /new uses selected owner and room from Ink state", async () => {
	const source = new FakeCliSessionSource({
		owners: [{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }],
		rooms: [{ id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" }],
		sessions: [],
	});
	const harness = stateHarness({ ...baseState(), session: undefined, activeOwner: { ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }, activeRoom: { id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" }, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);

	await handleCliSessionSubmittedInput("/new", source, harness.state, harness.setState, openSession, () => {});

	assert.match(harness.state.session.id, /^ps_fake_created_/);
	assert.equal(harness.state.session.ownerScope, "user:alpha");
	assert.equal(harness.state.session.roomId, "room_alpha");
	assert.match(harness.state.message, /Created session/);
});

test("Slash /new without an active room opens default-first room picker", async () => {
	const source = new FakeCliSessionSource({
		owners: [{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }],
		activeOwnerScope: "user:alpha",
		rooms: [
			{ id: "room_project", title: "Project Room", ownerScope: "user:alpha" },
			{ id: "room_personal", title: "Personal Chat", ownerScope: "user:alpha", isDefault: true },
		],
		sessions: [],
	});
	const harness = stateHarness({ ...baseState(), session: undefined, activeOwner: { ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }, activeRoom: undefined, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);

	await handleCliSessionSubmittedInput("/new", source, harness.state, harness.setState, openSession, () => {});

	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.equal(harness.state.picker.action, "create-session");
	assert.match(harness.state.picker.title, /Select room for new session for Alpha/);
	assert.equal(harness.state.picker.items[harness.state.picker.selectedIndex].roomId, "room_personal");
	assert.match(harness.state.message, /Select the room for the new session/);
});

test("Slash /owner opens owner picker and cross-owner sends are rejected", async () => {
	const source = new FakeCliSessionSource({
		owners: [
			{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" },
			{ ownerScope: "user:beta", label: "Beta", kind: "web-user" },
		],
		activeOwnerScope: "user:alpha",
		rooms: [
			{ id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" },
			{ id: "room_beta", title: "Beta Room", ownerScope: "user:beta" },
		],
		sessions: [
			{ id: "ps_alpha", title: "Alpha Session", roomId: "room_alpha", profile: "pibo-agent", ownerScope: "user:alpha", status: "idle" },
			{ id: "ps_beta", title: "Beta Session", roomId: "room_beta", profile: "pibo-agent", ownerScope: "user:beta", status: "idle" },
		],
	});
	const harness = stateHarness({ ...baseState(), activeOwner: { ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }, session: { id: "ps_alpha", title: "Alpha Session", profile: "pibo-agent", ownerScope: "user:alpha", status: "idle" }, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => {});

	await submit("/owner");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "owner");
	assert.match(harness.state.picker.title, /Select effective owner/);
	assert.deepEqual(harness.state.picker.items.map((item) => item.ownerScope), ["user:alpha", "user:beta"]);

	await source.setActiveOwner("user:beta");
	await submit("message should not cross owners");
	assert.match(harness.state.error, /belongs to user:alpha; active owner is user:beta/);
	assert.match(harness.state.error, /Recovery: use \/owner/);
});

test("Slash /session and /room open owner-scoped room-first pickers", async () => {
	const source = new FakeCliSessionSource({
		owners: [{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }],
		activeOwnerScope: "user:alpha",
		rooms: [
			{ id: "room_personal", title: "Personal Chat", ownerScope: "user:alpha", isDefault: true },
			{ id: "room_project", title: "Project Room", ownerScope: "user:alpha" },
		],
		sessions: [
			{ id: "ps_personal", title: "Personal Session", roomId: "room_personal", profile: "pibo-agent", ownerScope: "user:alpha", status: "idle", updatedAt: "2026-05-16T12:00:00.000Z" },
			{ id: "ps_project", title: "Project Session", roomId: "room_project", profile: "pibo-agent", ownerScope: "user:alpha", status: "idle", updatedAt: "2026-05-16T12:01:00.000Z" },
		],
	});
	const harness = stateHarness({ ...baseState(), activeOwner: { ownerScope: "user:alpha", label: "Alpha", kind: "web-user" }, activeRoom: { id: "room_project", title: "Project Room", ownerScope: "user:alpha" }, session: undefined, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => {});

	await submit("/session");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.match(harness.state.picker.title, /Select room for sessions for Alpha/);
	assert.equal(harness.state.picker.items[harness.state.picker.selectedIndex].roomId, "room_project");

	await submit("/room");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.match(harness.state.picker.title, /Select active room for Alpha/);
	assert.equal(harness.state.picker.items[harness.state.picker.selectedIndex].roomId, "room_project");
});

test("Slash /repair-user-unknown runs source repair for the active owner and room", async () => {
	const source = createDefaultFakeCliSessionSource();
	let repairInput;
	source.repairLegacyUserUnknownSessions = async (input) => {
		repairInput = input;
		return { ownerScope: input.ownerScope, roomId: input.roomId, scanned: 2, repaired: 1, skipped: 1, sessionIds: ["ps_legacy"] };
	};
	const harness = stateHarness({
		...baseState(),
		activeOwner: { ownerScope: "user:alpha", label: "Alpha", kind: "web-user" },
		activeRoom: { id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" },
	});
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);

	await handleCliSessionSubmittedInput("/repair-user-unknown", source, harness.state, harness.setState, openSession, () => {});

	assert.deepEqual(repairInput, { ownerScope: "user:alpha", roomId: "room_alpha" });
	assert.match(harness.state.message, /Repaired 1\/2 legacy user:unknown CLI sessions to Alpha \(user:alpha\) in room_alpha/);
	assert.equal(harness.state.error, undefined);
});

test("Slash commands handle help status clear pickers unknown exit and normal sends", async () => {
	const source = createDefaultFakeCliSessionSource();
	source.setStatus({ message: "TOKEN=secret-value" });
	const harness = stateHarness({ ...baseState(), session: { id: "ps_fake_existing", title: "Existing fake session", profile: "pibo-agent", agentId: "pibo-agent", status: "idle" } });
	let exited = false;
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => { exited = true; });

	await submit("/help");
	assert.match(harness.state.message, /Slash command catalog/);
	assert.match(harness.state.message, /\/new/);
	assert.match(harness.state.message, /\/download/);

	await submit("/status");
	assert.match(harness.state.message, /source=fake/);
	assert.match(harness.state.message, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(harness.state.message, /secret-value/);
	assert.match(formatCliSessionStatus(harness.state.status, harness.state.session), /connected=yes/);

	await submit("/clear");
	assert.equal(harness.state.rows.length, 0);
	assert.match(harness.state.message, /Session data was not deleted/);

	await submit("/session");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.match(harness.state.picker.title, /Select room for sessions/);
	assert.ok(harness.state.picker.items.length >= 1);

	await submit("/room");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.match(harness.state.picker.title, /Select active room/);

	await submit("/agent");
	assert.equal(harness.state.mode, "agent-picker");
	assert.equal(harness.state.picker.kind, "agent");
	assert.match(harness.state.picker.items[0].label, /Pibo Agent|pibo-agent/);

	harness.setState((current) => ({ ...current, activeRoom: { id: "room_fake_main", title: "Fake Room" }, mode: "transcript", picker: undefined }));
	await submit("/new");
	assert.match(harness.state.session.id, /^ps_fake_created_/);
	assert.match(harness.state.message, /Created session/);

	await submit("hello from test");
	assert.equal(harness.state.error, undefined);
	assert.equal(harness.state.message, "Message sent.");
	assert.ok(harness.state.rows.some((row) => String(row.output ?? "").includes("hello from test")));

	await submit("/unknown");
	assert.match(harness.state.error, /Unknown command \/unknown/);

	await submit("/quit");
	assert.equal(exited, true);
});

test("Slash Web action commands render shared results and open clone sessions", async () => {
	const source = createDefaultFakeCliSessionSource();
	const harness = stateHarness({ ...baseState(), activeOwner: { ownerScope: "user:fake", label: "Fake user", kind: "web-user" }, session: { id: "ps_fake_existing", title: "Existing fake session", profile: "pibo-agent", agentId: "pibo-agent", ownerScope: "user:fake", roomId: "room_fake_main", status: "idle" } });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => {});

	await submit("/fast");
	assert.match(harness.state.message, /mode/);
	assert.match(harness.state.message, /fast/);

	await submit("/session-current");
	assert.match(harness.state.message, /session-current: Existing fake session ps_fake_existing/);

	await submit("/sessions");
	assert.match(harness.state.message, /Existing fake session/);
	assert.match(harness.state.message, /ps_fake_existing/);

	await submit("/download");
	assert.match(harness.state.message, /Browser download APIs/);
	assert.equal(harness.state.error, undefined);

	await submit("/clone");
	assert.match(harness.state.session.id, /^ps_fake_clone_/);
	assert.match(harness.state.message, /clone: Existing fake session Clone/);
});

test("empty picker states and recovery errors are actionable and redacted", async () => {
	const source = new FakeCliSessionSource({ rooms: [], sessions: [], agents: [], status: { rooms: "unsupported", message: "TOKEN=secret-value" } });
	const harness = stateHarness({ ...baseState(), session: undefined, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => {});

	await submit("/session");
	assert.equal(harness.state.mode, "picker");
	assert.equal(harness.state.picker.kind, "room");
	assert.equal(harness.state.picker.items.length, 0);
	assert.match(harness.state.picker.emptyMessage, /No rooms are available/);

	await submit("/agent");
	assert.equal(harness.state.mode, "agent-picker");
	assert.equal(harness.state.picker.items.length, 0);
	assert.match(harness.state.picker.emptyMessage, /No existing agents\/profiles/);

	const formatted = formatCliSessionError(new CliSourceError("session_not_found", "missing TOKEN=secret-value"));
	assert.match(formatted, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(formatted, /secret-value/);
	assert.match(formatted, /Recovery: use \/session/);
});

test("default app viewport bounds large sessions and narrow terminal lines", () => {
	const rows = Array.from({ length: 30 }, (_, index) => ({
		id: `row-${index}`,
		kind: "message.user",
		status: "done",
		lines: [{ prefix: "prompt", tokens: [{ text: `message ${index} ${"x".repeat(80)}` }] }],
		sourceNodeIds: [`node-${index}`],
	}));
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: { ...baseState(), rows, input: "x".repeat(120) },
		maxLineChars: 32,
	}));

	assert.match(output, /… 10 earlier rows omitted/);
	assert.doesNotMatch(output, /message 0/);
	assert.match(output, /message 29/);
	assert.match(output, /truncated/);
	assert.equal(terminalLineLimitFromColumns(36), 32);
	assert.equal(terminalLineLimitFromColumns(10), 20);
});

test("runCliSessionsUi rejects non-interactive stdin or stdout before rendering", async () => {
	const previousExitCode = process.exitCode;
	const stderr = streamWithTty(false);
	let stderrText = "";
	stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
	process.exitCode = undefined;
	await runCliSessionsUi({ stdin: streamWithTty(false), stdout: streamWithTty(true), stderr, source: createDefaultFakeCliSessionSource() });
	assert.equal(process.exitCode, 1);
	assert.match(stderrText, /interactive stdin and stdout TTYs/);
	process.exitCode = previousExitCode;
});

test("pibo tui:sessions command help and root discovery describe the new UI without hiding existing TUI commands", async () => {
	const help = cliSessionsHelpText();
	assert.match(help, /reduced Web Chat-derived session UI/);
	assert.match(help, /Commands: \/help \/new \/room \/session \/agent \/owner \/repair-user-unknown/);
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
			assert.match(error.stderr, /requires interactive stdin and stdout TTYs/);
			return true;
		},
	);
});
