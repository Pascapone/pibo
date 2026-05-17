import { randomUUID } from "node:crypto";
import React from "react";
import { render } from "ink";
import { createCustomAgentProfileDefinition } from "../../apps/chat/agent-profiles.js";
import { createDefaultCustomAgentStore } from "../../apps/chat/agent-store.js";
import { createDefaultFakeCliSessionSource, LocalCliSessionSource, type CliOwnerSummary, type CliRoomSummary, type CliSessionSource, type LocalCliSessionRouter } from "../../cli-session/index.js";
import type { PiboEventListener, PiboInputEvent, PiboOutputEvent, PiboSessionStatus } from "../../core/events.js";
import { PiboSessionRouter } from "../../core/session-router.js";
import { PiboDataStore } from "../../data/pibo-store.js";
import { createDefaultPiboPluginRegistry } from "../../plugins/builtin.js";
import { PiboDataSessionStore } from "../../sessions/pibo-data-store.js";
import { cliCommandSummaryText, InkSessionApp } from "./InkSessionApp.js";

export type RunCliSessionsUiOptions = {
	source?: CliSessionSource;
	useFakeSource?: boolean;
	initialSessionId?: string;
	ownerScope?: string;
	maxRows?: number;
	maxLineChars?: number;
	stdin?: NodeJS.ReadStream;
	stdout?: NodeJS.WriteStream;
	stderr?: NodeJS.WriteStream;
	allowNonTty?: boolean;
};

export async function runCliSessionsUi(options: RunCliSessionsUiOptions = {}): Promise<void> {
	const stdin = options.stdin ?? process.stdin;
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	if (options.allowNonTty !== true && (stdin.isTTY !== true || stdout.isTTY !== true)) {
		stderr.write("pibo tui:sessions requires interactive stdin and stdout TTYs. Re-run from a terminal, SSH session, or use --help for command usage.\n");
		process.exitCode = 1;
		return;
	}
	const debugPtyMockedSource = process.env.PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED === "1";
	const source = options.source ?? (options.useFakeSource
		? createDefaultFakeCliSessionSource()
		: debugPtyMockedSource
			? createDebugMockedLocalCliSessionSource({ ownerScope: options.ownerScope, assistantReply: process.env.PIBO_DEBUG_PTY_ASSISTANT_REPLY ?? "Mocked PTY assistant response" })
			: createDefaultLocalCliSessionSource({ ownerScope: options.ownerScope }));
	const instance = render(React.createElement(InkSessionApp, {
		initialSessionId: options.initialSessionId,
		skipOwnerPicker: options.ownerScope !== undefined,
		maxLineChars: options.maxLineChars ?? terminalLineLimitFromColumns(stdout.columns),
		maxRows: options.maxRows,
		source,
	}), {
		stdin,
		stdout,
		stderr,
	});
	await instance.waitUntilExit();
}

export function createDefaultLocalCliSessionSource(options: { ownerScope?: string } = {}): LocalCliSessionSource {
	const context = createLocalCliSessionSourceContext();
	const router = new PiboSessionRouter({ sessionStore: context.sessionStore, pluginRegistry: context.pluginRegistry });
	return createLocalCliSessionSourceFromContext({ ...context, ownerScope: options.ownerScope, router, ownsRouter: true });
}

function createDebugMockedLocalCliSessionSource(options: { ownerScope?: string; assistantReply: string }): LocalCliSessionSource {
	const context = createLocalCliSessionSourceContext();
	const debugOwners = debugOwnerSummariesFromEnv();
	const debugRooms = debugRoomSummariesFromEnv();
	const router = new DebugMockCliSessionRouter(options.assistantReply);
	return createLocalCliSessionSourceFromContext({
		...context,
		ownerScope: options.ownerScope,
		router,
		ownsRouter: true,
		ownerSummaries: debugOwners.length > 0 ? debugOwners : context.ownerSummaries,
		roomProvider: debugRooms.length > 0 ? { listRooms: ({ ownerScope } = {}) => debugRooms.filter((room) => room.ownerScope === undefined || room.ownerScope === ownerScope) } : undefined,
		statusMessage: "Debug PTY mocked local router",
	});
}

function debugRoomSummariesFromEnv(): CliRoomSummary[] {
	const raw = process.env.PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS;
	if (!raw) return [];
	const rooms: CliRoomSummary[] = [];
	for (const entry of raw.split(";").map((value) => value.trim()).filter(Boolean)) {
		const [ownerScope, id, title, description] = entry.split("|").map((part) => part?.trim());
		if (ownerScope && id && title) rooms.push({ ownerScope, id, title, description: description || "Debug PTY room fixture", isDefault: title === "Personal Chat" });
	}
	return rooms;
}

function debugOwnerSummariesFromEnv(): CliOwnerSummary[] {
	const raw = process.env.PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS;
	if (!raw) return [];
	return raw.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((ownerScope) => ({
			ownerScope,
			label: ownerScope.startsWith("user:") ? `Web user ${ownerScope.slice("user:".length)}` : ownerScope,
			description: "Debug PTY owner fixture",
			kind: ownerScope.startsWith("user:") ? "web-user" as const : "local" as const,
		}));
}

function createLocalCliSessionSourceContext(): { dataStore: PiboDataStore; sessionStore: PiboDataSessionStore; pluginRegistry: ReturnType<typeof createDefaultPiboPluginRegistry>; agentSummaries: { id: string; name: string; description?: string; profileName: string }[]; ownerSummaries: CliOwnerSummary[] } {
	const dataStore = new PiboDataStore();
	const sessionStore = new PiboDataSessionStore(dataStore);
	const pluginRegistry = createDefaultPiboPluginRegistry();
	const builtInAgentSummaries = pluginRegistry.getProfileInfos().map((profile) => ({ id: profile.name, name: profile.name, description: profile.description, profileName: profile.name }));
	const customAgentStore = createDefaultCustomAgentStore();
	const customAgents = customAgentStore.list();
	try {
		for (const agent of customAgents) pluginRegistry.upsertProfile(createCustomAgentProfileDefinition(agent, { missingReferenceMode: "silent" }));
	} finally {
		customAgentStore.close();
	}
	const agentSummaries = [
		...builtInAgentSummaries,
		...customAgents.map((agent) => ({ id: agent.profileName, name: agent.profileName, description: agent.description || agent.displayName, profileName: agent.profileName })),
	];
	const ownerSummaries = Array.from(new Set(customAgents.map((agent) => agent.ownerScope))).map((ownerScope) => ({
		ownerScope,
		label: ownerScope.startsWith("user:") ? `Web user ${ownerScope.slice("user:".length)}` : ownerScope,
		description: "Discovered from custom agents",
		kind: ownerScope.startsWith("user:") ? "web-user" as const : "local" as const,
	}));
	return { dataStore, sessionStore, pluginRegistry, agentSummaries, ownerSummaries };
}

function createLocalCliSessionSourceFromContext(input: { ownerScope?: string; dataStore: PiboDataStore; sessionStore: PiboDataSessionStore; pluginRegistry: ReturnType<typeof createDefaultPiboPluginRegistry>; router: LocalCliSessionRouter; ownsRouter: boolean; agentSummaries: { id: string; name: string; description?: string; profileName: string }[]; ownerSummaries: CliOwnerSummary[]; roomProvider?: { listRooms(input?: { ownerScope?: string }): Promise<readonly CliRoomSummary[]> | readonly CliRoomSummary[] }; statusMessage?: string }): LocalCliSessionSource {
	return new LocalCliSessionSource({
		ownerScope: input.ownerScope,
		sessionStore: input.sessionStore,
		ownsSessionStore: true,
		pluginRegistry: input.pluginRegistry,
		router: input.router,
		ownsRouter: input.ownsRouter,
		dataStore: input.dataStore,
		ownsDataStore: true,
		agentSummaries: input.agentSummaries,
		ownerSummaries: input.ownerSummaries,
		roomProvider: input.roomProvider,
		statusMessage: input.statusMessage,
	});
}

class DebugMockCliSessionRouter implements LocalCliSessionRouter {
	private readonly listeners = new Set<PiboEventListener>();
	private readonly statuses = new Map<string, PiboSessionStatus>();

	constructor(private readonly assistantReply: string) {}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		if (event.type !== "message") {
			const result: PiboOutputEvent = { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: this.executionResult(event) };
			this.publish(result);
			return result;
		}
		const eventId = event.id ?? randomUUID();
		this.statuses.set(event.piboSessionId, this.status(event.piboSessionId, { processing: true, queuedMessages: 1 }));
		this.publish({ type: "message_queued", piboSessionId: event.piboSessionId, eventId, queuedMessages: 1, text: event.text, source: event.source });
		this.statuses.set(event.piboSessionId, this.status(event.piboSessionId, { processing: true, queuedMessages: 0 }));
		this.publish({ type: "message_started", piboSessionId: event.piboSessionId, eventId, text: event.text, source: event.source });
		const assistant: PiboOutputEvent = { type: "assistant_message", piboSessionId: event.piboSessionId, eventId, assistantIndex: 0, contentIndex: 0, text: this.assistantReply };
		this.publish(assistant);
		const finished: PiboOutputEvent = { type: "message_finished", piboSessionId: event.piboSessionId, eventId, source: event.source };
		this.statuses.set(event.piboSessionId, this.status(event.piboSessionId, { processing: false, queuedMessages: 0 }));
		this.publish(finished);
		return assistant;
	}

	getSessionRuntimeStatus(piboSessionId: string): PiboSessionStatus {
		return this.statuses.get(piboSessionId) ?? this.status(piboSessionId);
	}

	async disposeAll(): Promise<void> {
		this.listeners.clear();
		this.statuses.clear();
	}

	private publish(event: PiboOutputEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private executionResult(event: Extract<PiboInputEvent, { type: "execution" }>): unknown {
		const params = "params" in event && event.params && typeof event.params === "object" && !Array.isArray(event.params) ? event.params as Record<string, unknown> : {};
		if (event.action === "fast_mode") return { mode: "fast", supported: true, changed: true };
		if (event.action === "thinking") {
			const level = typeof params.level === "string" ? params.level : undefined;
			if (level) return { message: `Thinking level set to ${level}`, level, supported: true, changed: true };
			return { action: "show_thinking_menu", items: ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ id: value, label: value })) };
		}
		if (event.action === "model") {
			const model = typeof params.model === "string" ? params.model : undefined;
			const provider = typeof params.provider === "string" ? params.provider : "openai";
			if (model) return { message: `Model set to ${provider}/${model}`, provider, model, supported: true, changed: true };
			return { action: "show_model_menu", providers: [{ id: "openai", label: "OpenAI", description: "Debug PTY provider", models: [{ id: "gpt-pty-large", label: "GPT PTY Large" }, { id: "gpt-pty-mini", label: "GPT PTY Mini" }] }, { id: "offline", label: "Offline Provider", description: "Unavailable in debug PTY", disabled: true, reason: "Debug provider has no credentials", models: [{ id: "offline-model", label: "Offline Model", disabled: true, reason: "Provider unavailable" }] }] };
		}
		if (event.action === "login") {
			return { action: "show_login_menu", providers: [{ id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)", authMethods: ["device_code"], configured: false }, { id: "openai", name: "OpenAI API", authMethods: ["api_key"], configured: false }] };
		}
		if (event.action === "login.start") return { message: `Open ${params.provider ?? "provider"} login URL https://example.test/device and enter code PTY-1234. Complete sign-in in a browser, then return to the terminal.`, url: "https://example.test/device", userCode: "PTY-1234" };
		if (event.action === "session.fork_candidates") return { action: "show_fork_candidates", messages: [{ entryId: "entry_pty_1", text: "Fork from PTY prompt one" }, { entryId: "entry_pty_2", text: "Fork from PTY prompt two" }] };
		if (event.action === "session.fork") return { supported: false, unsupportedReason: "Debug PTY mocked router cannot fork Pi session state; live routed sessions return a visible fork when supported." };
		if (event.action === "compact") return { queued: true, queuedMessages: 1 };
		if (event.action === "clear_queue") return { cleared: 0 };
		if (event.action === "abort") return { aborted: true };
		if (event.action === "kill") return { killed: [event.piboSessionId], cancelledRuns: [] };
		if (event.action === "kill_all") return { killed: [event.piboSessionId], cancelledRuns: [] };
		if (event.action === "session.clone") return { supported: false, unsupportedReason: "Debug PTY mocked router cannot clone Pi session state; live routed sessions return a derived session id when clone succeeds." };
		return { mocked: true, action: event.action };
	}

	private status(piboSessionId: string, overrides: Partial<PiboSessionStatus> = {}): PiboSessionStatus {
		return {
			piboSessionId,
			queuedMessages: 0,
			processing: false,
			streaming: false,
			activeTools: [],
			enabledTools: [],
			cwd: process.cwd(),
			disposed: false,
			thinkingLevel: "high",
			fastMode: false,
			contextUsage: { tokens: 128, contextWindow: 1024, percent: 12.5 },
			providerUsage: { provider: "openai", planType: "debug", limits: [{ label: "requests", usedPercent: 25 }] },
			warnings: ["Debug PTY status fixture redacts TOKEN=secret-value"],
			...overrides,
		};
	}
}

export function terminalLineLimitFromColumns(columns: number | undefined): number | undefined {
	if (columns === undefined || !Number.isFinite(columns) || columns <= 0) return undefined;
	return Math.max(20, Math.floor(columns) - 4);
}

export function cliSessionsHelpText(): string {
	return `pibo tui:sessions - reduced Web Chat-derived session UI for terminals

Usage:
  pibo tui:sessions [options]

Options:
  --session <id>       Open a specific Pibo session id
  --owner-scope <id>   Limit local/direct discovery to one owner scope
  --max-rows <count>   Limit rendered transcript rows (default: 20)
  --demo               Use deterministic fake session data for smoke testing
  -h, --help           Show this help

V2 commands inside the app:
  ${cliCommandSummaryText()}

Scope:
  CLI Sessions is a reduced session/chat UI for SSH, bootstrap, recovery, and quick local work.
  It starts only when stdin and stdout are interactive TTYs; pipes fail with a clear error.
  Transcript rendering uses a bounded default tail window of 20 rows and truncates narrow terminal lines.
  Web Chat remains the full control center for projects, workflows, Cron, Ralph, Agent Designer, settings, and context management.

Related existing commands:
  pibo tui
  pibo tui:routed
`;
}
