import {
	CLI_ONLY_SLASH_COMMANDS,
	WEB_PARITY_SLASH_COMMANDS,
	buildCompactTerminalRows,
	buildTerminalCardDescriptors,
} from "../../dist/session-ui/index.js";

export const TERMINAL_PARITY_SESSION_ID = "ps_terminal_parity_fixture";
export const TERMINAL_PARITY_PI_SESSION_ID = "pi_terminal_parity_fixture";
export const TERMINAL_PARITY_SECRET = "OPENAI_API_KEY=sk_fixture_secret_123456789";
export const TERMINAL_PARITY_REDACTED = "[redacted]";

const BASE_TIME = "2026-05-17T12:00:";

const PHASE_RANK = {
	"user.message": 0,
	"execution.command": 1,
	"execution.compaction": 1,
	"agent.turn": 2,
	"model.reasoning": 3,
	"tool.call": 4,
	"agent.delegation": 4,
	"agent.async": 5,
	"tool.result": 6,
	"yielded.run": 7,
	"assistant.message": 8,
	error: 9,
};

const SOURCE_RANK = {
	transcript: 0,
	"event-log": 1,
	live: 2,
};

export function terminalParityTraceNode(type, id, sequence, overrides = {}) {
	const source = overrides.source ?? "event-log";
	const streamId = overrides.streamId ?? (source === "live" ? 7 : 3);
	const streamFrameIndex = overrides.streamFrameIndex ?? sequence;
	const eventSequence = overrides.eventSequence ?? sequence;
	return {
		id,
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		type,
		title: overrides.title ?? defaultTitle(type),
		status: overrides.status ?? "done",
		startedAt: overrides.startedAt ?? `${BASE_TIME}${String(sequence).padStart(2, "0")}.000Z`,
		children: overrides.children ?? [],
		eventId: overrides.eventId ?? `evt_terminal_${String(sequence).padStart(3, "0")}`,
		runId: overrides.runId,
		source,
		orderKey: overrides.orderKey ?? {
			sourceRank: SOURCE_RANK[source] ?? 9,
			turnSeq: eventSequence,
			eventSequence: source === "event-log" ? eventSequence : undefined,
			streamId,
			streamFrameIndex,
			phaseRank: PHASE_RANK[type] ?? 99,
		},
		...overrides,
	};
}

export function buildCanonicalTerminalTraceView() {
	const realShapedUserEvent = {
		id: "event-log-user-message-001",
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		eventSequence: 1,
		eventId: "evt_terminal_001",
		streamId: 3,
		streamFrameIndex: 1,
		type: "message",
		createdAt: "2026-05-17T12:00:01.000Z",
		payload: {
			role: "user",
			parts: [{ type: "text", text: "Audit the compact terminal renderer." }],
		},
	};

	const agentTurn = terminalParityTraceNode("agent.turn", "node-turn-001", 2, {
		eventId: "evt_turn_001",
		children: [
			terminalParityTraceNode("model.reasoning", "node-reasoning", 3, {
				parentId: "node-turn-001",
				output: "Need to inspect rows, cards, and bounded detail previews.",
			}),
			terminalParityTraceNode("tool.call", "node-explore-read", 4, {
				parentId: "node-turn-001",
				title: "read",
				input: { path: "src/session-ui/terminalRows.ts" },
				output: "export type CompactTerminalRow = ...",
			}),
			terminalParityTraceNode("tool.call", "node-explore-list", 5, {
				parentId: "node-turn-001",
				title: "list",
				input: { path: "src/apps/cli-ui" },
				output: "InkTerminalRow.ts\nInkTerminalView.ts",
			}),
			terminalParityTraceNode("tool.call", "node-tool-call", 6, {
				parentId: "node-turn-001",
				title: "custom_tool",
				input: { command: "inspect", token: "token=fixture-secret-value" },
				output: "tool output line one\ntool output line two",
			}),
			terminalParityTraceNode("tool.result", "node-tool-result", 7, {
				parentId: "node-turn-001",
				title: "custom_tool",
				output: {
					ok: true,
					value: [1, 2, 3],
					secret: TERMINAL_PARITY_SECRET,
				},
			}),
			terminalParityTraceNode("agent.delegation", "node-agent-delegation", 8, {
				parentId: "node-turn-001",
				input: { subagentName: "explorer", arguments: { query: "terminal rows" } },
				linkedPiboSessionId: "ps_linked_explorer",
				output: "Explorer found renderer hooks.",
			}),
			terminalParityTraceNode("agent.async", "node-agent-async", 9, {
				parentId: "node-turn-001",
				title: "worker subagent",
				linkedPiboSessionId: "ps_async_worker",
				output: "Waiting for worker result.",
			}),
		],
	});

	const nodes = [
		terminalParityTraceNode("user.message", "node-user", 1, {
			output: realShapedUserEvent.payload.parts[0].text,
			entryId: "entry_user_001",
		}),
		agentTurn,
		terminalParityTraceNode("yielded.run", "node-yielded-run", 10, {
			status: "running",
			runId: "run_fixture_typecheck",
			summary: "typecheck",
			output: "npm run typecheck",
		}),
		terminalParityTraceNode("execution.compaction", "node-compaction", 11, {
			summary: "Compacted 42 messages",
			input: { reason: "manual" },
			output: { savedTokens: 4096 },
		}),
		terminalParityTraceNode("execution.command", "node-command-fast", 12, {
			title: "fast_mode",
			input: { command: "/fast" },
			output: { mode: "fast", changed: true, supported: true },
		}),
		terminalParityTraceNode("execution.command", "node-thinking-card", 13, {
			title: "thinking",
			input: { command: "/thinking" },
			output: { level: "high", supported: true, availableLevels: ["off", "low", "medium", "high"] },
		}),
		terminalParityTraceNode("execution.command", "node-model-card", 14, {
			title: "model",
			input: { command: "/model" },
			output: { action: "show_model_menu", providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-test", label: "GPT Test" }] }] },
		}),
		terminalParityTraceNode("execution.command", "node-login-card", 15, {
			title: "login",
			input: { command: "/login" },
			output: { action: "show_login_menu", providers: [{ id: "openai", name: "OpenAI", authMethods: ["device_code", "api_key"] }] },
		}),
		terminalParityTraceNode("execution.command", "node-status-result", 16, {
			title: "status",
			input: { command: "/status" },
			output: highUsageStatusPayload(),
		}),
		terminalParityTraceNode("error", "node-error", 17, {
			status: "error",
			error: `Provider failed with ${TERMINAL_PARITY_SECRET}`,
			output: { requestId: "req_terminal_fixture" },
		}),
		terminalParityTraceNode("assistant.message", "node-assistant", 18, {
			output: longMarkdownFixture(),
		}),
	];

	return {
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		piSessionId: TERMINAL_PARITY_PI_SESSION_ID,
		title: "Terminal parity fixture",
		version: "test-fixture-v1",
		latestStreamId: 7,
		eventCount: nodes.length,
		nodes,
		rawEvents: [realShapedUserEvent, realShapedStatusEvent()],
	};
}

export function buildCanonicalTerminalRows(options = {}) {
	const rows = buildCompactTerminalRows(buildCanonicalTerminalTraceView(), { showThinking: options.showThinking ?? true });
	return [...rows, ...buildLocalCommandResultRows()];
}

export function buildCanonicalTerminalCards() {
	return buildTerminalCardDescriptors(buildCanonicalTerminalRows());
}

export function buildStreamingTerminalRows() {
	const traceView = {
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		piSessionId: TERMINAL_PARITY_PI_SESSION_ID,
		title: "Streaming terminal parity fixture",
		version: "test-streaming-v1",
		latestStreamId: 44,
		rawEvents: [],
		nodes: [
			terminalParityTraceNode("user.message", "stream-user", 1, {
				output: "Run the parity smoke.",
				source: "event-log",
				streamId: 44,
				streamFrameIndex: 0,
			}),
			terminalParityTraceNode("tool.call", "stream-tool-running", 2, {
				status: "running",
				title: "custom_tool",
				input: { task: "render" },
				output: "rendering first frame",
				source: "live",
				streamId: 44,
				streamFrameIndex: 1,
			}),
			terminalParityTraceNode("assistant.message", "stream-assistant-running", 3, {
				status: "running",
				output: "Partial answer from the model",
				source: "live",
				streamId: 44,
				streamFrameIndex: 2,
			}),
		],
	};
	const rows = buildCompactTerminalRows(traceView, { showThinking: true });
	return [...rows, ...buildLocalCommandResultRows({ streamId: 44, startFrameIndex: 3 })];
}

export function buildLocalCommandResultRows({ streamId = 99, startFrameIndex = 0 } = {}) {
	return [
		{
			id: "local-command:status:001",
			kind: "execution.command",
			status: "done",
			lines: [{ prefix: "bullet", tokens: [{ text: "Command", tone: "yellow", weight: "semibold" }, { text: " /status", tone: "yellow" }] }],
			sourceNodeIds: ["local-command:status:001"],
			eventId: "local-event-status-command-001",
			orderSource: "local-ui",
			orderStreamId: streamId,
			orderStreamFrameIndex: startFrameIndex,
			input: { command: "/status" },
			expandable: true,
		},
		{
			id: "local-result:status:001",
			kind: "tool.status",
			status: "done",
			lines: [],
			sourceNodeIds: ["local-result:status:001"],
			eventId: "local-event-status-result-001",
			orderSource: "local-ui",
			orderStreamId: streamId,
			orderStreamFrameIndex: startFrameIndex + 1,
			output: unavailableStatusPayload(),
			expandable: false,
		},
		buildExpandableDetailFixtureRow({ streamId, frameIndex: startFrameIndex + 2 }),
	];
}

export function buildExpandableDetailFixtureRow({ streamId = 99, frameIndex = 2 } = {}) {
	return {
		id: "local-detail:tool-output:001",
		kind: "tool.call",
		status: "error",
		errorKind: "tool",
		lines: [
			{ prefix: "bullet", tokens: [{ text: "Call failed", tone: "red", weight: "semibold" }, { text: " detail_tool" }] },
			{ prefix: "detail", tokens: [{ text: "Large output preview preserved without dumping the full payload.", tone: "dim" }] },
		],
		sourceNodeIds: ["local-detail:tool-output:001"],
		eventId: "local-event-detail-001",
		orderSource: "local-ui",
		orderStreamId: streamId,
		orderStreamFrameIndex: frameIndex,
		input: { command: "/detail", args: { depth: 2, token: "token=detail-secret-value" } },
		output: {
			preview: "bounded output",
			longJson: longJsonFixture(),
			longMarkdown: longMarkdownFixture(),
			secret: TERMINAL_PARITY_SECRET,
		},
		error: "detail_tool failed with token=detail-secret-value",
		linkedPiboSessionId: "ps_linked_detail",
		expandable: true,
		detailItems: [
			{ id: "detail-input", label: "Input", status: "done", input: { command: "/detail", args: { depth: 2 } } },
			{ id: "detail-output", label: "Output", status: "done", output: { preview: "bounded output", longJson: longJsonFixture() } },
			{ id: "detail-error", label: "Error", status: "error", error: "detail_tool failed with token=[redacted]" },
			{ id: "detail-linked", label: "Linked session", status: "done", linkedPiboSessionId: "ps_linked_detail" },
			{ id: "detail-command-args", label: "Command args", status: "done", input: { command: "/detail", args: { depth: 2 } } },
			{ id: "detail-tool-preview", label: "Tool result preview", status: "done", output: "first line\nsecond line" },
			{ id: "detail-large-json", label: "Large JSON", status: "done", output: longJsonFixture() },
			{ id: "detail-long-markdown", label: "Long markdown", status: "done", output: longMarkdownFixture() },
		],
	};
}

export function highUsageStatusPayload() {
	return {
		activeAccountLabel: "Web account Fixture",
		activeAccountScope: "user:terminal-fixture",
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		sessionTitle: "Terminal parity fixture",
		profile: "base",
		activeModel: { provider: "openai", id: "gpt-test", label: "GPT Test" },
		connected: true,
		processing: true,
		streaming: true,
		queuedMessages: 0,
		cwd: "/workspace",
		contextUsage: { tokens: 920, contextWindow: 1000, percent: 92 },
		providerUsage: {
			provider: "openai",
			planType: "team",
			limits: [
				{ label: "requests", usedPercent: 0, remainingPercent: 100 },
				{ label: "tokens", usedPercent: 55, remainingPercent: 45, resetsAt: "2026-05-17T13:00:00.000Z" },
				{ label: "spend", usedPercent: 91, remainingPercent: 9 },
			],
			credits: { balance: "$42.00" },
		},
		activeTools: ["bash"],
		enabledTools: ["read", "edit", "bash"],
		thinkingLevel: "high",
		fastMode: true,
		warnings: [`quota warning for token=warning-secret-value`],
		errors: [`provider error for ${TERMINAL_PARITY_SECRET}`],
		message: `Status contains ${TERMINAL_PARITY_SECRET}`,
	};
}

export function fullStatusPayload() {
	return {
		...highUsageStatusPayload(),
		processing: false,
		streaming: false,
		queuedMessages: 3,
		contextUsage: { tokens: 720, contextWindow: 1000, percent: 72 },
		providerUsage: {
			provider: "anthropic",
			planType: "pro",
			limits: [{ label: "messages", usedPercent: 25, remainingPercent: 75, resetsAt: "2026-05-17T14:00:00.000Z" }],
			credits: { unlimited: true },
		},
	};
}

export function partialStatusPayload() {
	return {
		activeAccountLabel: "Partial fixture account",
		activeAccountScope: "user:partial-fixture",
		piboSessionId: "ps_partial_status",
		connected: true,
		queuedMessages: 1,
		processing: false,
		streaming: true,
		contextUsage: { percent: 12.5 },
		providerUsage: { provider: "local-ai", planType: "debug", limits: [{ label: "requests" }] },
	};
}

export function disposedStatusPayload() {
	return {
		...unavailableStatusPayload(),
		disposed: true,
		connected: false,
		message: "Runtime disposed",
	};
}

export function unavailableStatusPayload() {
	return {
		activeAccountLabel: "Fixture account",
		activeAccountScope: "user:fixture",
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		connected: false,
		processing: false,
		streaming: false,
		queuedMessages: 0,
		contextUsage: null,
		providerUsage: null,
		fastMode: false,
		message: "Provider/context usage unavailable",
	};
}

export function zeroUsageStatusPayload() {
	return {
		contextUsage: { tokens: 0, contextWindow: 1000, percent: 0 },
		providerUsage: { provider: "openai", limits: [{ label: "requests", usedPercent: 0, remainingPercent: 100 }] },
	};
}

export function longJsonFixture() {
	return {
		items: Array.from({ length: 24 }, (_, index) => ({ index, value: `fixture-value-${index}` })),
		metadata: { narrowLabel: "ps_short", deep: { nested: { value: true } } },
	};
}

export const WEB_DERIVED_LONG_OUTPUT_LINES = Array.from({ length: 12 }, (_, index) => `web-derived output line ${String(index + 1).padStart(2, "0")} -- ${"x".repeat(90)}`);

export function buildWebDerivedLongOutputTraceView() {
	const longOutput = WEB_DERIVED_LONG_OUTPUT_LINES.join("\n");
	const nodes = [
		terminalParityTraceNode("tool.call", "web-derived-tool-call-long-output", 1, {
			title: "custom_tool",
			input: { command: "produce-long-output", token: "token=long-output-secret" },
			output: longOutput,
		}),
		terminalParityTraceNode("tool.result", "web-derived-tool-result-long-output", 2, {
			title: "custom_tool",
			output: longOutput,
		}),
		terminalParityTraceNode("agent.async", "web-derived-async-long-output", 3, {
			title: "worker subagent",
			linkedPiboSessionId: "ps_web_derived_async_worker",
			output: longOutput,
		}),
		terminalParityTraceNode("yielded.run", "web-derived-yielded-long-output", 4, {
			runId: "run_web_derived_long_output",
			summary: "long output run",
			output: longOutput,
		}),
		terminalParityTraceNode("tool.call", "web-derived-shell-tool-long-output", 5, {
			title: "bash",
			input: { command: "printf 'web-derived output line %02d\\n' {1..12}" },
			output: longOutput,
		}),
		terminalParityTraceNode("execution.command", "web-derived-execution-command-long-output", 6, {
			title: "download",
			input: { command: "/download /tmp/long-output.txt" },
			output: longOutput,
		}),
	];
	return {
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		piSessionId: TERMINAL_PARITY_PI_SESSION_ID,
		title: "Web-derived long-output parity fixture",
		version: "web-derived-long-output-v1",
		latestStreamId: 3,
		eventCount: nodes.length,
		nodes,
		rawEvents: [],
	};
}

export function buildWebDerivedLongOutputRows() {
	return buildCompactTerminalRows(buildWebDerivedLongOutputTraceView(), { showThinking: true });
}

export function nestedJsonSyntaxFixture() {
	return {
		functionName: "search_files",
		semanticRoles: ["function", "key", "string", "number", "boolean", "null", "punctuation", "collection-open", "collection-collapsed"],
		input: {
			query: "terminal parity",
			paths: ["src/session-ui/terminalRows.ts", "src/apps/cli-ui/InkTerminalRow.ts"],
			filters: { language: "typescript", includeTests: true, archived: false, maxResults: 25 },
			longString: `This value is intentionally longer than one hundred and forty characters so inline JSON renderers must choose a disclosure strategy without leaking secrets or deleting characters. ${"z".repeat(32)}`,
			secret: TERMINAL_PARITY_SECRET,
		},
		detailText: `metadata before json\n${JSON.stringify({ ok: true, nested: { array: [1, false, null, { key: "value" }] }, secret: TERMINAL_PARITY_SECRET }, null, 2)}`,
	};
}

export function markdownSyntaxFixture() {
	return [
		"# Web-derived terminal markdown",
		"",
		"Paragraph with `inline code`, **bold text**, and a [link](https://example.invalid).",
		"",
		"> quoted operator note",
		"",
		"1. first numbered item",
		"2. second numbered item",
		"   - nested bullet",
		"",
		"| command | result |",
		"| --- | --- |",
		"| `/status` | compact row |",
		"",
		"```bash",
		"OPENAI_API_KEY=[redacted] pibo tui:sessions --room room_named_fixture | tee /tmp/out",
		"```",
		"",
		"```json",
		JSON.stringify({ ok: true, count: 3, nested: { ready: false } }),
		"```",
	].join("\n");
}

export function roomSessionNamingFixture() {
	return {
		activeRoomId: "room_named_fixture",
		rooms: [
			{ id: "room_named_fixture", title: "Named Web Room", isDefault: false, archived: false, primaryLabel: "Named Web Room", secondaryLabel: "room room_named_fixture" },
			{ id: "room_default_fixture", title: "Default", isDefault: true, archived: false, primaryLabel: "Default", secondaryLabel: "room room_default_fixture" },
			{ id: "room_archived_fixture", title: "Archived Research", isDefault: false, archived: true, primaryLabel: "Archived Research", secondaryLabel: "archived · room room_archived_fixture" },
			{ id: "room_missing_title_fixture", title: "", isDefault: false, archived: false, primaryLabel: "room_missing_title_fixture", secondaryLabel: "missing title fallback" },
		],
		sessions: [
			{ id: "ps_named_session", title: "Named session", roomId: "room_named_fixture", roomTitle: "Named Web Room", primaryLabel: "Named session", secondaryLabel: "Named Web Room · ps_named_session" },
			{ id: "ps_renamed_session", title: "Renamed from Web", roomId: "room_named_fixture", roomTitle: "Named Web Room", primaryLabel: "Renamed from Web", secondaryLabel: "Named Web Room · ps_renamed_session" },
			{ id: "ps_missing_room", title: "Missing room fallback", roomId: "room_unknown_fixture", roomTitle: undefined, primaryLabel: "Missing room fallback", secondaryLabel: "room room_unknown_fixture · ps_missing_room" },
		],
	};
}

export function slashCommandBehaviorFixture() {
	const cli = CLI_ONLY_SLASH_COMMANDS.map((command) => ({
		command: command.argumentHint ? `${command.slash} ${command.argumentHint}` : command.slash,
		id: command.id,
		family: command.group === "navigation" ? "cli-navigation" : "cli-only",
		palette: true,
		enterBehavior: cliEnterBehavior(command.id),
		result: cliResult(command.id),
		context: command.group === "navigation" ? "account-room-session" : "none",
		support: command.support,
		label: command.description,
	}));
	const parity = WEB_PARITY_SLASH_COMMANDS.map((command) => ({
		command: command.argumentHint ? `${command.slash} ${command.argumentHint}` : command.slash,
		id: command.id,
		family: command.support === "deferred" ? "browser-only-deferred" : command.support === "supported" ? "web-parity" : "terminal-adapted",
		palette: true,
		enterBehavior: parityEnterBehavior(command.id),
		result: parityResult(command.id),
		context: command.group,
		support: command.support,
		label: command.description,
	}));
	return [
		...cli,
		...parity,
		{ command: "/browser-open", id: "browser-open", family: "browser-only-deferred", palette: false, enterBehavior: "append-unsupported-result", result: "transcript", context: "web", support: "browser-only", label: "Browser-only fixture command." },
		{ command: "/gateway:fixture", id: "gateway:fixture", family: "dynamic-gateway", palette: true, enterBehavior: "dispatch-gateway-action", result: "transcript-or-overlay", context: "gateway", support: "supported", label: "Dynamic gateway fixture command." },
	];
}

function cliEnterBehavior(id) {
	if (["room", "session", "agent", "profile"].includes(id)) return `open-${id}-picker`;
	if (["exit", "quit"].includes(id)) return "exit-tui";
	if (id === "new") return "create-session-in-active-room";
	if (id === "repair-user-unknown") return "append-repair-result";
	return "append-transcript-help";
}

function cliResult(id) {
	if (["room", "session", "agent", "profile"].includes(id)) return "overlay";
	if (["exit", "quit"].includes(id)) return "exit";
	return "transcript";
}

function parityEnterBehavior(id) {
	if (["model", "login", "thinking"].includes(id)) return `open-${id}-picker-or-apply-argument`;
	if (id === "sessions") return "append-named-session-list";
	if (id === "session-current") return "append-current-session-summary";
	if (id === "fork-candidates") return "append-or-open-fork-candidates";
	if (["download", "upload"].includes(id)) return "append-terminal-file-instructions";
	if (id === "thinking-show") return "append-deferred-result";
	return "append-command-result-row";
}

function parityResult(id) {
	if (["model", "login", "thinking"].includes(id)) return "overlay-or-transcript";
	return "transcript";
}

export const WEB_DERIVED_TERMINAL_MATRIX_COVERAGE = [
	{ area: "header", fixture: "web-derived-room-session-slash", trace: "PRD10 US-004; PRD12 US-002/003" },
	{ area: "row-grammar", fixture: "canonical-terminal", trace: "PRD10 US-001/002" },
	{ area: "spacing", fixture: "canonical-terminal", trace: "PRD10 US-003/005" },
	{ area: "preview-expansion", fixture: "web-derived-long-output", trace: "PRD09 US-001/002/005" },
	{ area: "details", fixture: "expandable-detail", trace: "PRD09 US-003/004" },
	{ area: "json", fixture: "web-derived-json-markdown", trace: "PRD11 US-001/002" },
	{ area: "markdown-code", fixture: "web-derived-json-markdown", trace: "PRD11 US-003/004/005" },
	{ area: "status", fixture: "canonical-terminal", trace: "PRD10 US-004" },
	{ area: "streaming", fixture: "streaming-terminal", trace: "PRD13 US-002" },
	{ area: "slash-commands", fixture: "web-derived-room-session-slash", trace: "PRD12 US-001/005" },
	{ area: "pickers", fixture: "web-derived-room-session-slash", trace: "PRD12 US-004" },
	{ area: "room-session-names", fixture: "web-derived-room-session-slash", trace: "PRD12 US-002/003" },
	{ area: "no-color-narrow", fixture: "canonical-terminal; web-derived-json-markdown", trace: "PRD10; PRD11; PRD13" },
	{ area: "redaction", fixture: "all", trace: "PRD08-13" },
];

export function longMarkdownFixture() {
	return [
		"## Terminal parity fixture",
		"",
		"This markdown is intentionally long enough to exercise bounded previews and renderer wrapping.",
		"",
		"- user row",
		"- assistant row",
		"- reasoning row",
		"- tool row",
		"- command row",
		"- status row",
		"",
		"```json",
		JSON.stringify({ ok: true, secret: "OPENAI_API_KEY=[redacted]" }),
		"```",
	].join("\n");
}

function realShapedStatusEvent() {
	return {
		id: "event-log-status-001",
		piboSessionId: TERMINAL_PARITY_SESSION_ID,
		eventSequence: 16,
		eventId: "evt_terminal_016",
		streamId: 3,
		streamFrameIndex: 16,
		type: "gateway.action.result",
		createdAt: "2026-05-17T12:00:16.000Z",
		payload: {
			action: "status",
			result: highUsageStatusPayload(),
		},
	};
}

function defaultTitle(type) {
	return ({
		"user.message": "User Message",
		"assistant.message": "Agent Message",
		"model.reasoning": "Reasoning",
		"tool.call": "custom_tool",
		"tool.result": "custom_tool",
		"agent.delegation": "explorer",
		"agent.async": "worker",
		"yielded.run": "Yielded Run",
		"execution.command": "command",
		"execution.compaction": "Compaction",
		error: "Error",
	})[type] ?? type;
}
