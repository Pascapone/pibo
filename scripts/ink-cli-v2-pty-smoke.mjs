#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultArtifactRoot = resolve(repoRoot, ".tmp/ink-cli-v2-pty-smoke");

const options = parseArgs(process.argv.slice(2));

const scenarios = [
	{
		name: "room-session-message",
		description: "Room picker -> session creation -> mocked message send.",
		cols: 110,
		rows: 32,
		timeoutMs: 70_000,
		idleTimeoutMs: 15_000,
		env: {
			PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
			PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS: "room_alpha|Alpha Room;room_beta|Beta Room",
			PIBO_DEBUG_PTY_ASSISTANT_REPLY: "Smoke assistant reply",
		},
		steps: [
			["--wait-for", "select room"],
			["--expect", "Alpha Room"],
			["--expect", "Beta Room"],
			["--press", "Down"],
			["--press", "Enter"],
			["--wait-for", "New session"],
			["--press", "Enter"],
			["--wait-for", "Created session"],
			["--type", "Smoke message"],
			["--press", "Enter"],
			["--wait-for", "Smoke assistant reply"],
			["--expect", "Message sent"],
			["--press", "CtrlC"],
		],
		command: ["node", "dist/bin/pibo.js", "tui:sessions"],
	},
	{
		name: "slash-suggestions-status-thinking",
		description: "Slash suggestions, /status card, and /thinking keyboard picker.",
		cols: 120,
		rows: 40,
		timeoutMs: 80_000,
		idleTimeoutMs: 15_000,
		env: {
			PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
		},
		steps: [
			["--wait-for", "select room"],
			["--press", "Enter"],
			["--wait-for", "New session"],
			["--press", "Enter"],
			["--wait-for", "Created session"],
			["--type", "/"],
			["--wait-for", "slash commands"],
			["--expect", "/status"],
			["--expect", "› /"],
			["--press", "Escape"],
			["--press", "Enter"],
			["--wait-for", "Use /help for supported CLI commands"],
			["--type", "/st"],
			["--wait-for", "slash commands"],
			["--expect", "/status"],
			["--expect", "› /st"],
			["--press", "Enter"],
			["--wait-for", "› /status"],
			["--press", "Enter"],
			["--wait-for", "▣ Status — status · done"],
			["--expect", "Ran /status"],
			["--expect", "Identity: session"],
			["--expect", "Context:"],
			["--type", "/download"],
			["--press", "Enter"],
			["--wait-for", "Usage: /download <path>"],
			["--expect", "Ran /download"],
			["--type", "/thinking"],
			["--press", "Enter"],
			["--wait-for", "select thinking level"],
			["--expect", "xhigh"],
			["--press", "Down"],
			["--press", "Down"],
			["--press", "Down"],
			["--press", "Down"],
			["--press", "Down"],
			["--press", "Enter"],
			["--wait-for", "Thinking level set to high"],
			["--type", "/th"],
			["--wait-for", "slash commands"],
			["--expect", "/thinking"],
			["--expect", "› /th"],
			["--press", "CtrlC"],
		],
		command: ["node", "dist/bin/pibo.js", "tui:sessions"],
	},
	{
		name: "overlay-keyboard-model-login",
		description: "Picker overlays, nested model/login navigation, disabled rows, and /status while picker is open.",
		cols: 120,
		rows: 42,
		timeoutMs: 90_000,
		idleTimeoutMs: 15_000,
		env: {
			PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
		},
		steps: [
			["--wait-for", "select room"],
			["--press", "Enter"],
			["--wait-for", "New session"],
			["--press", "Enter"],
			["--wait-for", "Created session"],
			["--type", "/model"],
			["--press", "Enter"],
			["--wait-for", "select model provider"],
			["--expect", "× Offline Provider"],
			["--press", "Enter"],
			["--wait-for", "select model — OpenAI"],
			["--press", "Escape"],
			["--wait-for", "select model provider"],
			["--press", "Down"],
			["--press", "Enter"],
			["--wait-for", "Offline Provider: Unavailable in debug PTY"],
			["--press", "Escape"],
			["--type", "/login"],
			["--press", "Enter"],
			["--wait-for", "select login provider"],
			["--press", "Down"],
			["--press", "Enter"],
			["--wait-for", "select login method — OpenAI API"],
			["--expect", "API key"],
			["--press", "Enter"],
			["--wait-for", "requires secret input"],
			["--type", "/session"],
			["--press", "Enter"],
			["--wait-for", "select room — sessions"],
			["--type", "/status"],
			["--press", "Enter"],
			["--wait-for", "▣ Status — status · done"],
			["--expect", "Ran /status"],
			["--press", "CtrlC"],
		],
		command: ["node", "dist/bin/pibo.js", "tui:sessions"],
	},
	{
		name: "mixed-transcript-fixture",
		description: "Deterministic shared-fixture mixed transcript with row-first normal events, structured exceptions, ordering, and redaction.",
		cols: 120,
		rows: 42,
		timeoutMs: 20_000,
		idleTimeoutMs: 5_000,
		env: {},
		steps: [
			["--wait-for", "Audit the compact terminal renderer"],
			["--expect", "▣ Status — status · done"],
			["--expect", "▣ Thinking — thinking · done"],
			["--expect", "▣ Model — model · done"],
			["--expect", "▣ Login — login · done"],
			["--expect", "Call failed detail_tool"],
			["--reject", "▣ Tool"],
			["--expect", "token=[redacted]"],
			["--reject", "sk_fixture_secret"],
			["--reject", "detail-secret-value"],
		],
		command: fixtureRenderCommand("mixed-transcript"),
	},
	{
		name: "narrow-no-color-status",
		description: "Deterministic narrow NO_COLOR status card with ASCII progress and redaction checks.",
		cols: 64,
		rows: 24,
		timeoutMs: 20_000,
		idleTimeoutMs: 5_000,
		env: {
			NO_COLOR: "1",
			TERM: "dumb",
			PIBO_ASCII_PROGRESS: "1",
		},
		steps: [
			["--wait-for", "▣ Status — status · done"],
			["--expect", "Context: #"],
			["--expect", "openai spend:"],
			["--expect", "Provider: plan team"],
			["--reject", "█"],
			["--reject", "sk_fixture_secret"],
			["--reject", "warning-secret-value"],
		],
		command: fixtureRenderCommand("narrow-no-color"),
	},
	{
		name: "existing-session-hydration",
		description: "Open a prepared existing session with --session and assert transcript hydration.",
		cols: 100,
		rows: 28,
		timeoutMs: 60_000,
		idleTimeoutMs: 15_000,
		prepare: prepareExistingSessionFixture,
		env: {},
		steps: [
			["--wait-for", "Smoke existing user prompt"],
			["--expect", "Smoke existing assistant reply"],
			["--expect", "Smoke Existing"],
			["--press", "CtrlC"],
		],
		command: ["node", "dist/bin/pibo.js", "tui:sessions", "--session", "ps_smoke_history"],
	},
];

if (options.list) {
	for (const scenario of scenarios) console.log(`${scenario.name}\t${scenario.description}`);
	process.exit(0);
}

const selected = options.scenario ? scenarios.filter((scenario) => scenario.name === options.scenario) : scenarios;
if (selected.length === 0) {
	console.error(`Unknown scenario "${options.scenario}". Use --list.`);
	process.exit(2);
}

for (const scenario of selected) {
	const artifactDir = resolve(options.artifactRoot ?? defaultArtifactRoot, scenario.name);
	const homeDir = resolve(options.artifactRoot ?? defaultArtifactRoot, `${scenario.name}-home`);
	const env = { PIBO_HOME: homeDir, ...scenario.env };
	const args = debugPtyArgs(scenario, artifactDir, env);
	console.log(`\n# ${scenario.name}`);
	console.log(`artifacts: ${artifactDir}`);
	console.log(`home: ${homeDir}`);
	console.log(`command: node ${args.join(" ")}`);
	if (options.dryRun) continue;
	rmSync(artifactDir, { recursive: true, force: true });
	rmSync(homeDir, { recursive: true, force: true });
	mkdirSync(artifactDir, { recursive: true });
	mkdirSync(homeDir, { recursive: true });
	if (scenario.prepare) await scenario.prepare({ homeDir });
	const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: "inherit", env: process.env });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function fixtureRenderCommand(kind) {
	const source = kind === "narrow-no-color"
		? `import React from "react";
import { renderToString } from "ink";
import { InkTerminalView } from "./dist/apps/cli-ui/index.js";
import { highUsageStatusPayload } from "./test/fixtures/terminal-parity-fixtures.mjs";
const rows = [{ id: "status-narrow-no-color", kind: "tool.status", status: "done", lines: [], output: highUsageStatusPayload(), sourceNodeIds: ["status-narrow-no-color"] }];
console.log(renderToString(React.createElement(InkTerminalView, { rows, maxRows: 8, maxLineChars: 62 })));`
		: `import React from "react";
import { renderToString } from "ink";
import { InkTerminalView } from "./dist/apps/cli-ui/index.js";
import { buildCanonicalTerminalRows } from "./test/fixtures/terminal-parity-fixtures.mjs";
const rows = buildCanonicalTerminalRows();
console.log(renderToString(React.createElement(InkTerminalView, { rows, maxRows: 40, maxLineChars: 120 })));`;
	return ["node", "--input-type=module", "-e", source];
}

function debugPtyArgs(scenario, artifactDir, env) {
	const args = [
		"dist/bin/pibo.js",
		"debug",
		"pty",
		"run",
		"--artifact",
		"--artifact-dir",
		artifactDir,
		"--timeout-ms",
		String(scenario.timeoutMs),
		"--idle-timeout-ms",
		String(scenario.idleTimeoutMs),
		"--cols",
		String(scenario.cols),
		"--rows",
		String(scenario.rows),
		"--name",
		scenario.name,
	];
	for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
	for (const step of scenario.steps) args.push(...step);
	args.push("--", ...scenario.command);
	return args;
}

async function prepareExistingSessionFixture({ homeDir }) {
	const [{ PiboDataStore }, { ChatRoomService }, { PiboDataSessionStore }] = await Promise.all([
		import("../dist/data/pibo-store.js"),
		import("../dist/apps/chat/data/room-service.js"),
		import("../dist/sessions/pibo-data-store.js"),
	]);
	const dataStore = new PiboDataStore(resolve(homeDir, "pibo.sqlite"));
	try {
		const rooms = new ChatRoomService(dataStore);
		const sessionStore = new PiboDataSessionStore(dataStore);
		const now = "2026-05-17T00:00:00.000Z";
		const room = rooms.ensureDefaultRoom({ name: "Shared Chat" });
		const session = sessionStore.create({
			id: "ps_smoke_history",
			piSessionId: "pi_smoke_history",
			channel: "chat-web",
			kind: "chat",
			profile: "pibo-agent",
			title: "Smoke Existing Session",
			metadata: { chatRoomId: room.id, chatRoomName: "Shared Chat", status: "idle" },
		});
		dataStore.sessions.upsertSession({ session, roomId: room.id, status: "idle", firstMessagePreview: "Smoke existing user prompt", lastActivityAt: now });
		dataStore.navigation.upsertSession({ roomId: room.id, sessionId: session.id, rootSessionId: session.id, title: "Smoke Existing Session", profile: "pibo-agent", status: "idle", lastActivityAt: now, lastMessagePreview: "Smoke existing assistant reply", sortKey: now, updatedAt: now });
		dataStore.eventLog.appendEvent({ sessionId: session.id, sessionSequence: 1, roomId: room.id, topic: "chat", type: "user.message.accepted", source: "pty-smoke", actorType: "user", actorId: "cli-user", eventId: "evt_smoke_user", retentionClass: "chat_message", previewText: "Smoke existing user prompt", attributes: { inlineText: "Smoke existing user prompt", clientTxnId: "txn_smoke_user" }, createdAt: now });
		dataStore.eventLog.appendEvent({ sessionId: session.id, sessionSequence: 2, roomId: room.id, topic: "chat", type: "assistant_message", source: "pty-smoke", actorType: "assistant", actorId: "pibo-agent", eventId: "evt_smoke_assistant", retentionClass: "chat_message", previewText: "Smoke existing assistant reply", createdAt: now });
	} finally {
		dataStore.close();
	}
}

function parseArgs(args) {
	const parsed = { list: false, dryRun: false, scenario: undefined, artifactRoot: undefined };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--list") parsed.list = true;
		else if (arg === "--dry-run") parsed.dryRun = true;
		else if (arg === "--scenario") parsed.scenario = requireValue(args, ++index, arg);
		else if (arg === "--artifact-root") parsed.artifactRoot = resolve(repoRoot, requireValue(args, ++index, arg));
		else if (arg === "--help" || arg === "-h") {
			console.log(`Usage: node scripts/ink-cli-v2-pty-smoke.mjs [--list] [--dry-run] [--scenario <name>] [--artifact-root <dir>]\n\nRuns reusable pibo debug pty smoke scenarios for Ink CLI Session UI V2. Build first with npm run build.`);
			process.exit(0);
		} else {
			throw new Error(`Unknown option ${arg}`);
		}
	}
	return parsed;
}

function requireValue(args, index, option) {
	const value = args[index];
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
	return value;
}
