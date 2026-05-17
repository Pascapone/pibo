import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	buildOwnerPickerDescriptor,
	buildRoomPickerDescriptor,
	buildSessionPickerDescriptor,
	buildSlashCommandCatalog,
	buildTerminalCardDescriptor,
	groupSlashCommandsForHelp,
	buildTerminalStatusViewModel,
	filterSlashCommands,
	normalizeCommandErrorDescriptor,
	normalizeCommandResultDescriptor,
	progressBarText,
} from "../dist/session-ui/index.js";

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
		owner: { label: "Web user", scope: "user:alpha" },
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

test("shared command catalog merges gateway capabilities and filters prefixes", () => {
	const catalog = buildSlashCommandCatalog([
		{ name: "custom.action", slashCommands: ["custom-action"], description: "Run TOKEN=secret_value action" },
		{ slash: "/browser-only", description: "Browser only", browserOnly: true, unsupportedReason: "Needs window.document" },
		{ name: "session_id", slashCommands: ["session"], description: "Gateway session id should not replace CLI room-first session navigation" },
	]);
	assert.ok(catalog.some((command) => command.slash === "/help"));
	assert.ok(catalog.some((command) => command.slash === "/owner"));
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
	assert.ok(grouped.navigation.some((command) => command.slash === "/owner"));
	assert.ok(grouped.unsupported.some((command) => command.slash === "/thinking-show"));
});

test("shared command result descriptors normalize menus status links unsupported and errors", () => {
	assert.deepEqual(normalizeCommandResultDescriptor("status", { queuedMessages: 0, contextUsage: { percent: 1 } }), { kind: "status", title: "Status", status: { queuedMessages: 0, contextUsage: { percent: 1 } } });
	assert.equal(normalizeCommandResultDescriptor("login", { action: "show_login_menu", providers: [{ id: "openai", name: "OpenAI", authMethods: ["device_code"] }] }).kind, "menu");
	const forkMenu = normalizeCommandResultDescriptor("fork-candidates", { messages: [{ entryId: "entry_one", text: "Fork from this user message" }] });
	assert.equal(forkMenu.kind, "menu");
	assert.equal(forkMenu.items[0].id, "entry_one");
	assert.match(forkMenu.items[0].label, /Fork from this user message/);
	assert.equal(normalizeCommandResultDescriptor("clone", { piboSessionId: "ps_clone", roomId: "room_a", title: "Clone" }).kind, "session-link");
	const unsupported = normalizeCommandResultDescriptor("download", { supported: false, unsupportedReason: "Browser API only" });
	assert.equal(unsupported.kind, "unsupported");
	assert.match(unsupported.reason, /Browser API only/);
	const error = normalizeCommandErrorDescriptor("fast", new Error("token=supersecretvalue failed"));
	assert.equal(error.kind, "error");
	assert.doesNotMatch(error.message, /supersecretvalue/);
});

test("shared owner room session picker descriptors include defaults empty rooms and create actions", () => {
	const owners = buildOwnerPickerDescriptor({
		activeOwnerScope: "user:beta",
		owners: [
			{ ownerScope: "user:alpha", label: "Web user alpha", kind: "web-user" },
			{ ownerScope: "user:beta", label: "Web user beta", kind: "web-user" },
			{ ownerScope: "local:root", label: "Root recovery", kind: "root-recovery", isFallback: true },
		],
	});
	assert.equal(owners.selectedIndex, 1);
	assert.ok(owners.items[2].markers.includes("root recovery"));

	const rooms = buildRoomPickerDescriptor({
		ownerLabel: "Web user beta",
		activeRoomId: "room_project",
		rooms: [
			{ id: "room_personal", title: "Personal Chat", isDefault: true },
			{ id: "room_project", title: "Project Room" },
		],
	});
	assert.equal(rooms.items[0].default, true);
	assert.equal(rooms.selectedIndex, 1);

	const emptySessions = buildSessionPickerDescriptor({ sessions: [], room: { id: "room_personal", title: "Personal Chat", ownerScope: "user:beta" } });
	assert.equal(emptySessions.items.length, 1);
	assert.equal(emptySessions.items[0].kind, "create-session");
	assert.match(emptySessions.emptyMessage, /No sessions in Personal Chat/);

	const sessions = buildSessionPickerDescriptor({
		activeSessionId: "ps_active",
		includeBackAction: true,
		room: { id: "room_project", title: "Project Room", ownerScope: "user:beta" },
		sessions: [{ id: "ps_active", title: "Active", profile: "pibo-agent", status: "idle", roomId: "room_project", ownerScope: "user:beta" }],
	});
	assert.equal(sessions.items[0].kind, "back");
	assert.ok(sessions.items[1].markers.includes("current"));
});

test("Web compact terminal status card consumes shared descriptors without crossing renderer boundaries", () => {
	const statusCardSource = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx"), "utf8");
	assert.match(statusCardSource, /buildTerminalCardDescriptor/, "Web status card should consume shared terminal card descriptors");
	assert.match(statusCardSource, /statusView/, "Web status card should render from the shared status view model");
	assert.match(statusCardSource, /data-shared-terminal-card/, "Web status card should expose a stable shared-descriptor hook for regression checks");

	const cliSourceDir = path.resolve("src/apps/cli-ui");
	const cliFiles = listSourceFiles(cliSourceDir);
	for (const file of cliFiles) {
		const source = fs.readFileSync(file, "utf8");
		assert.doesNotMatch(source, /src\/apps\/chat-ui|session-views\/compact-terminal|react-dom|\.module\.css|window\.|document\./, `${path.relative(process.cwd(), file)} must not import Web DOM components or browser APIs`);
	}
});

function listSourceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listSourceFiles(filePath);
		return /\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
	});
}

test("all shared session-ui view-model modules stay renderer-neutral", () => {
	const sourceDir = path.resolve("src/session-ui");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|react-dom|react-virtuoso|lucide-react|ink)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /\.(?:css|scss|sass)["']/i, `${file} must not import stylesheets`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|Tailwind/i, `${file} must not use browser or styling APIs`);
	}
});
