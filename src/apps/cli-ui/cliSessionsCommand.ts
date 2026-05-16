import { randomUUID } from "node:crypto";
import React from "react";
import { render } from "ink";
import { createCustomAgentProfileDefinition } from "../../apps/chat/agent-profiles.js";
import { createDefaultCustomAgentStore } from "../../apps/chat/agent-store.js";
import { createDefaultFakeCliSessionSource, LocalCliSessionSource, type CliSessionSource, type LocalCliSessionRouter } from "../../cli-session/index.js";
import type { PiboEventListener, PiboInputEvent, PiboOutputEvent, PiboSessionStatus } from "../../core/events.js";
import { PiboSessionRouter } from "../../core/session-router.js";
import { PiboDataStore } from "../../data/pibo-store.js";
import { createDefaultPiboPluginRegistry } from "../../plugins/builtin.js";
import { PiboDataSessionStore } from "../../sessions/pibo-data-store.js";
import { InkSessionApp } from "./InkSessionApp.js";

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
	const router = new DebugMockCliSessionRouter(options.assistantReply);
	return createLocalCliSessionSourceFromContext({ ...context, ownerScope: options.ownerScope, router, ownsRouter: true, statusMessage: "Debug PTY mocked local router" });
}

function createLocalCliSessionSourceContext(): { dataStore: PiboDataStore; sessionStore: PiboDataSessionStore; pluginRegistry: ReturnType<typeof createDefaultPiboPluginRegistry>; agentSummaries: { id: string; name: string; description?: string; profileName: string }[] } {
	const dataStore = new PiboDataStore();
	const sessionStore = new PiboDataSessionStore(dataStore);
	const pluginRegistry = createDefaultPiboPluginRegistry();
	const builtInAgentSummaries = pluginRegistry.getProfileInfos().map((profile) => ({ id: profile.name, name: profile.name, description: profile.description, profileName: profile.name }));
	const customAgentStore = createDefaultCustomAgentStore();
	const customAgents = customAgentStore.list();
	try {
		for (const agent of customAgents) pluginRegistry.upsertProfile(createCustomAgentProfileDefinition(agent));
	} finally {
		customAgentStore.close();
	}
	const agentSummaries = [
		...builtInAgentSummaries,
		...customAgents.map((agent) => ({ id: agent.profileName, name: agent.profileName, description: agent.description || agent.displayName, profileName: agent.profileName })),
	];
	return { dataStore, sessionStore, pluginRegistry, agentSummaries };
}

function createLocalCliSessionSourceFromContext(input: { ownerScope?: string; dataStore: PiboDataStore; sessionStore: PiboDataSessionStore; pluginRegistry: ReturnType<typeof createDefaultPiboPluginRegistry>; router: LocalCliSessionRouter; ownsRouter: boolean; agentSummaries: { id: string; name: string; description?: string; profileName: string }[]; statusMessage?: string }): LocalCliSessionSource {
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
			const result: PiboOutputEvent = { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { mocked: true } };
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

V1 commands inside the app:
  /help /new /session /agent /status /clear /exit /quit

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
