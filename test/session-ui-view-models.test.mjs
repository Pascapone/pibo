import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	buildRoomPickerDescriptor,
	buildSessionPickerDescriptor,
	buildSlashCommandBehaviorMatrix,
	buildSlashCommandCatalog,
	buildTerminalCardDescriptor,
	buildTerminalCardDescriptors,
	CLI_ONLY_SLASH_COMMANDS,
	commandSupportLabel,
	groupSlashCommandsForHelp,
	buildTerminalStatusViewModel,
	filterSlashCommands,
	normalizeCommandErrorDescriptor,
	normalizeCommandResultDescriptor,
	progressBarText,
	WEB_PARITY_SLASH_COMMANDS,
} from "../dist/session-ui/index.js";
import { buildCanonicalTerminalRows } from "./fixtures/terminal-parity-fixtures.mjs";

function row(kind, overrides = {}) {
	return {
		id: overrides.id ?? `row-${kind}`,
		kind,
		status: overrides.status ?? "done",
		lines: overrides.lines ?? [{ tokens: [{ text: `${kind} line` }] }],
		sourceNodeIds: [overrides.id ?? `node-${kind}`],
		...overrides,
	};
}

test("shared terminal card descriptors cover rich terminal row kinds", () => {
	const statusCard = buildTerminalCardDescriptor(row("tool.status", {
		output: {
			piboSessionId: "ps_status",
			cwd: "/workspace",
			processing: true,
			contextUsage: { tokens: 500, contextWindow: 1000, percent: 50 },
			providerUsage: { provider: "openai", limits: [{ label: "requests", usedPercent: 25, remainingPercent: 75 }] },
		},
	}));
	assert.equal(statusCard.kind, "status");
	assert.equal(statusCard.statusView.progress.find((item) => item.id === "context").percent, 50);
	assert.equal(statusCard.statusView.progress.find((item) => item.id === "provider-0").label, "openai requests");

	const thinkingCard = buildTerminalCardDescriptor(row("tool.thinking", { output: { level: "high", supported: true, availableLevels: ["off", "high"] } }));
	assert.equal(thinkingCard.kind, "thinking");
	assert.deepEqual(thinkingCard.actions.map((action) => action.value), ["off", "high"]);

	const modelCard = buildTerminalCardDescriptor(row("tool.model", { output: { action: "show_model_menu", providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-4.1", label: "GPT 4.1" }] }] } }));
	assert.equal(modelCard.kind, "model");
	assert.equal(modelCard.actions[0].value, "openai/gpt-4.1");

	const loginCard = buildTerminalCardDescriptor(row("tool.login", { output: { action: "show_login_menu", providers: [{ id: "anthropic", name: "Anthropic", authMethods: ["api_key"] }] } }));
	assert.equal(loginCard.kind, "login");
	assert.equal(loginCard.actions[0].description, "api_key");

	assert.equal(buildTerminalCardDescriptor(row("tool.call")).kind, "tool");
	assert.equal(buildTerminalCardDescriptor(row("yielded.run", { status: "running" })).kind, "yielded-run");
	assert.equal(buildTerminalCardDescriptor(row("execution.compaction")).kind, "compaction");
	assert.equal(buildTerminalCardDescriptor(row("error", { status: "error", error: "boom" })).kind, "error");
});

test("shared status view model preserves unavailable usage and redacts secrets", () => {
	const unavailable = buildTerminalStatusViewModel({
		message: "OPENAI_API_KEY=sk_secret123456789 should hide",
	});
	assert.equal(unavailable.progress.find((item) => item.id === "context").state, "unavailable");
	assert.equal(unavailable.progress.find((item) => item.id === "provider").state, "unavailable");
	assert.match(unavailable.fields.find((item) => item.id === "message").value, /\[redacted\]/);
	assert.doesNotMatch(unavailable.fields.find((item) => item.id === "message").value, /sk_secret/);

	const zero = buildTerminalStatusViewModel({ contextUsage: { tokens: 0, contextWindow: 1000, percent: 0 } });
	const context = zero.progress.find((item) => item.id === "context");
	assert.equal(context.state, "available");
	assert.equal(context.percent, 0);
	assert.equal(progressBarText(context, 8), "░░░░░░░░ 0.0%");
});

test("shared terminal card descriptors cover required rich rows and redact before renderers", () => {
	const rows = [
		row("tool.status", { id: "status", output: { message: "OPENAI_API_KEY=sk_live_secret123456", contextUsage: { percent: 10 } } }),
		row("tool.thinking", { id: "thinking", output: { level: "high", availableLevels: ["low", "high"] } }),
		row("tool.model", { id: "model", output: { providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-test", label: "GPT Test" }] }] } }),
		row("tool.login", { id: "login", output: { providers: [{ id: "openai", name: "OpenAI", authMethods: ["api_key"] }] } }),
		row("tool.call", { id: "tool", lines: [{ tokens: [{ text: "Called TOKEN=secret-value" }] }] }),
		row("error", { id: "error", status: "error", error: "Authorization bearer_token=secret-value failed", lines: [] }),
	];
	const descriptors = buildTerminalCardDescriptors(rows);

	assert.deepEqual(descriptors.map((descriptor) => descriptor.kind), ["status", "thinking", "model", "login", "tool", "error"]);
	const serialized = JSON.stringify(descriptors);
	assert.match(serialized, /\[redacted\]/);
	assert.doesNotMatch(serialized, /sk_live_secret|secret-value/);
});

test("shared slash-command behavior matrix covers static and dynamic commands", () => {
	const catalog = buildSlashCommandCatalog([
		{ name: "custom.action", slashCommands: ["custom-action"], description: "Run custom action" },
		{ slash: "/browser-only", description: "Browser only", browserOnly: true, unsupportedReason: "Needs window.document" },
	]);
	const matrix = buildSlashCommandBehaviorMatrix(catalog);
	for (const command of catalog) {
		const entry = matrix.find((candidate) => candidate.slash === command.slash);
		assert.ok(entry, `matrix covers ${command.slash}`);
		assert.equal(entry.supportLabel, commandSupportLabel(command));
		assert.equal(entry.group, command.group);
		assert.equal(entry.palette, "shown");
		assert.ok(entry.enterBehavior.length > 0);
		assert.ok(entry.errorBehavior.length > 0);
	}
	for (const command of [...CLI_ONLY_SLASH_COMMANDS, ...WEB_PARITY_SLASH_COMMANDS]) {
		assert.ok(matrix.some((entry) => entry.id === command.id && entry.slash === command.slash), `matrix covers static ${command.slash}`);
	}
	assert.equal(matrix.find((entry) => entry.slash === "/room")?.resultPlacement, "overlay");
	assert.equal(matrix.find((entry) => entry.slash === "/session-current")?.contextRequirement, "active session when available; named room context preferred");
	assert.equal(matrix.find((entry) => entry.slash === "/browser-only")?.errorBehavior, "render compact unsupported result");
});

test("shared command catalog merges gateway capabilities and filters prefixes", () => {
	const catalog = buildSlashCommandCatalog([
		{ name: "custom.action", slashCommands: ["custom-action"], description: "Run TOKEN=secret_value action" },
		{ slash: "/browser-only", description: "Browser only", browserOnly: true, unsupportedReason: "Needs window.document" },
		{ name: "session_id", slashCommands: ["session"], description: "Gateway session id should not replace CLI room-first session navigation" },
	]);
	assert.ok(catalog.some((command) => command.slash === "/help"));
	assert.ok(!catalog.some((command) => command.id === "owner"));
	assert.ok(catalog.some((command) => command.slash === "/thinking" && command.terminalAdaptation));
	const custom = catalog.find((command) => command.slash === "/custom-action");
	assert.equal(custom.actionName, "custom.action");
	assert.match(custom.description, /\[redacted\]/);
	assert.match(catalog.find((command) => command.slash === "/session").description, /Select a room/);
	const unsupported = catalog.find((command) => command.slash === "/browser-only");
	assert.equal(unsupported.support, "browser-only");
	assert.equal(unsupported.group, "unsupported");
	assert.deepEqual(filterSlashCommands(catalog, "/th now").map((command) => command.slash), ["/thinking", "/thinking-show"]);
	const grouped = groupSlashCommandsForHelp(catalog);
	assert.ok(grouped.available.some((command) => command.slash === "/status"));
	assert.ok(grouped.available.some((command) => command.slash === "/download"));
	assert.ok(!grouped.navigation.some((command) => command.id === "owner"));
	assert.ok(grouped.unsupported.some((command) => command.slash === "/thinking-show"));
});

test("shared command result descriptors normalize menus status links unsupported and errors", () => {
	assert.deepEqual(normalizeCommandResultDescriptor("status", { queuedMessages: 0, contextUsage: { percent: 1 } }), { kind: "status", title: "Status", status: { queuedMessages: 0, contextUsage: { percent: 1 } } });
	assert.equal(normalizeCommandResultDescriptor("login", { action: "show_login_menu", providers: [{ id: "openai", name: "OpenAI", authMethods: ["device_code"] }] }).kind, "menu");
	const forkMenu = normalizeCommandResultDescriptor("fork-candidates", { messages: [{ entryId: "entry_one", text: "Fork from this user message" }] });
	assert.equal(forkMenu.kind, "menu");
	assert.equal(forkMenu.items[0].id, "entry_one");
	assert.match(forkMenu.items[0].label, /Fork from this user message/);
	const cloneLink = normalizeCommandResultDescriptor("clone", { piboSessionId: "ps_clone", roomId: "room_a", roomTitle: "Named Web Room", title: "Clone" });
	assert.equal(cloneLink.kind, "session-link");
	assert.equal(cloneLink.roomLabel, "Named Web Room");
	const unsupported = normalizeCommandResultDescriptor("download", { supported: false, unsupportedReason: "Browser API only" });
	assert.equal(unsupported.kind, "unsupported");
	assert.match(unsupported.reason, /Browser API only/);
	const error = normalizeCommandErrorDescriptor("fast", new Error("token=supersecretvalue failed"));
	assert.equal(error.kind, "error");
	assert.doesNotMatch(error.message, /supersecretvalue/);
});

test("shared app room session picker descriptors include defaults empty rooms and create actions", () => {

	const rooms = buildRoomPickerDescriptor({
		activeRoomId: "room_project",
		rooms: [
			{ id: "room_shared", title: "Shared Chat", isDefault: true },
			{ id: "room_project", title: "Project Room" },
		],
	});
	assert.equal(rooms.items[0].default, true);
	assert.equal(rooms.selectedIndex, 1);

	const emptySessions = buildSessionPickerDescriptor({ sessions: [], room: { id: "room_shared", title: "Shared Chat" } });
	assert.equal(emptySessions.items.length, 1);
	assert.equal(emptySessions.items[0].kind, "create-session");
	assert.match(emptySessions.emptyMessage, /No sessions in Shared Chat/);

	const sessions = buildSessionPickerDescriptor({
		activeSessionId: "ps_active",
		includeBackAction: true,
		room: { id: "room_project", title: "Project Room" },
		sessions: [{ id: "ps_active", title: "Active", profile: "base", status: "idle", roomId: "room_project" }],
	});
	assert.equal(sessions.items[0].kind, "back");
	assert.ok(sessions.items[1].markers.includes("current"));
});

test("Web and Ink rich terminal renderers consume shared descriptors without crossing boundaries", () => {
	const statusCardSource = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx"), "utf8");
	assert.match(statusCardSource, /buildTerminalCardDescriptor/, "Web status card should consume shared terminal card descriptors");
	assert.match(statusCardSource, /statusView/, "Web status card should render from the shared status view model");
	assert.match(statusCardSource, /data-shared-terminal-card/, "Web status card should expose a stable shared-descriptor hook for regression checks");
	assert.match(statusCardSource, /data-shared-status-field/, "Web status card should expose shared status field hooks");
	assert.match(statusCardSource, /data-shared-progress-state/, "Web status card should expose shared progress availability hooks");
	assert.match(statusCardSource, /data-shared-status-warning/, "Web status card should expose warning hooks");
	assert.match(statusCardSource, /data-shared-status-error/, "Web status card should expose error hooks");
	assert.doesNotMatch(statusCardSource, /OpenAI Codex quota/, "Web status card should use provider labels from descriptors instead of hardcoding OpenAI");

	const inkRowSource = fs.readFileSync(path.resolve("src/apps/cli-ui/InkTerminalRow.ts"), "utf8");
	assert.match(inkRowSource, /buildTerminalCardDescriptor\(row\)/, "Ink structured exceptions must pass through shared terminal card descriptors");
	assert.match(inkRowSource, /InkTerminalCard/, "Ink should render shared structured exceptions with terminal-native card primitives");
	assert.match(inkRowSource, /isStructuredCardException/, "Ink should explicitly limit card rendering to Web-equivalent structured exceptions");

	const cliSourceDir = path.resolve("src/apps/cli-ui");
	const cliFiles = listSourceFiles(cliSourceDir);
	for (const file of cliFiles) {
		const source = fs.readFileSync(file, "utf8");
		assert.doesNotMatch(source, /src\/apps\/chat-ui|session-views\/compact-terminal|react-dom|lucide-react|\.module\.css|window\.|document\.|HTMLElement|Tailwind|className=/, `${path.relative(process.cwd(), file)} must not import Web DOM components or browser APIs`);
	}
});

function listSourceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listSourceFiles(filePath);
		return /\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
	});
}

test("Web Compact Terminal source preserves shared flow ordering hooks and streaming semantics", () => {
	const fixtureRows = buildCanonicalTerminalRows();
	assert.ok(fixtureRows.some((row) => row.kind === "tool.status" && row.orderSource), "canonical shared fixture exercises Web row/card hooks");
	const compactSource = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"), "utf8");
	assert.match(compactSource, /buildCompactTerminalRows\(traceView, \{ showThinking \}\)/, "Web terminal must derive rows from shared row builder");
	assert.match(compactSource, /computeItemKey=\{\(_, row\) => row\.id\}/, "Web terminal should use shared row ids as stable render keys");
	assert.match(compactSource, /data-row-kind=\{row\.kind\}/, "Web terminal should expose shared row kind hooks");
	assert.match(compactSource, /data-row-status=\{row\.status\}/, "Web terminal should expose shared row status hooks");
	assert.match(compactSource, /data-order-source=\{row\.orderSource\}/, "Web terminal should expose shared ordering source hooks");
	assert.match(compactSource, /data-order-stream-id=\{row\.orderStreamId\}/, "Web terminal should expose stream id hooks");
	assert.match(compactSource, /data-order-frame-index=\{row\.orderStreamFrameIndex\}/, "Web terminal should expose stream frame hooks");
	assert.match(compactSource, /followOutput=\{stickyView\.followOutput\}/, "Web terminal should preserve sticky follow-output behavior for streaming");
	assert.match(compactSource, /selectedSessionStatus === "running"/, "Web terminal should treat running sessions as streaming");
	assert.match(compactSource, /runningCount > 0/, "Web terminal should treat running shared rows as streaming");
	assert.match(compactSource, /TerminalStreamingFooter/, "Web terminal should render a streaming footer while work is active");
});

test("all shared session-ui view-model modules stay renderer-neutral", () => {
	const sourceDir = path.resolve("src/session-ui");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|react-dom|react-virtuoso|lucide-react|ink|@uiw\/react-json-view|react-markdown|prismjs)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /\.(?:css|scss|sass)["']/i, `${file} must not import stylesheets`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|localStorage|navigator\.|Tailwind|className=/i, `${file} must not use browser or styling APIs`);
	}
});
