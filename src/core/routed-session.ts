import { SessionManager, type AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type {
	PiboForkCandidate,
	PiboJsonObject,
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboPiSessionSnapshot,
	PiboSessionListItem,
	PiboSessionOperationResult,
	PiboSessionStatus,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboSessionTreeNode,
	PiboSessionTreeResult,
	PiboThinkingResult,
} from "./events.js";
import type { PiboThinkingLevel } from "./thinking.js";

type PiSessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

type PiboSessionOperationListener = (result: PiboSessionOperationResult) => void | Promise<void>;

type PiEventCandidate = {
	type?: unknown;
	message?: unknown;
	assistantMessageEvent?: {
		type?: unknown;
		contentIndex?: unknown;
		delta?: unknown;
		content?: unknown;
		toolCall?: { id?: unknown; name?: unknown; arguments?: unknown };
	};
	toolCallId?: unknown;
	toolName?: unknown;
	args?: unknown;
	partialResult?: unknown;
	result?: unknown;
	isError?: unknown;
};

type PiToolCall = { id: string; name: string; args: unknown };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function textFromMessage(message: unknown): string {
	if (!message || typeof message !== "object") return "";

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
		})
		.join("");
}

function toolCallFromMessage(message: unknown, contentIndex: unknown): PiToolCall | undefined {
	if (!message || typeof message !== "object" || typeof contentIndex !== "number") return undefined;

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;

	const candidate = content[contentIndex];
	if (!candidate || typeof candidate !== "object") return undefined;
	const toolCall = candidate as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
	if (toolCall.type !== "toolCall" || typeof toolCall.id !== "string" || typeof toolCall.name !== "string") {
		return undefined;
	}

	return { id: toolCall.id, name: toolCall.name, args: toolCall.arguments ?? {} };
}

function toolCallFromAssistantEvent(candidate: PiEventCandidate): PiToolCall | undefined {
	const eventToolCall = candidate.assistantMessageEvent?.toolCall;
	if (eventToolCall && typeof eventToolCall.id === "string" && typeof eventToolCall.name === "string") {
		return { id: eventToolCall.id, name: eventToolCall.name, args: eventToolCall.arguments ?? {} };
	}

	return toolCallFromMessage(candidate.message, candidate.assistantMessageEvent?.contentIndex);
}

function normalizeToolCallEvent(sessionKey: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (
		candidate.type === "message_update" &&
		(candidate.assistantMessageEvent?.type === "toolcall_start" ||
			candidate.assistantMessageEvent?.type === "toolcall_delta" ||
			candidate.assistantMessageEvent?.type === "toolcall_end")
	) {
		const toolCall = toolCallFromAssistantEvent(candidate);
		if (!toolCall) return undefined;

		return {
			type: "tool_call",
			sessionKey,
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.args,
			argsComplete: candidate.assistantMessageEvent.type === "toolcall_end",
		};
	}

	return undefined;
}

function normalizeToolExecutionEvent(sessionKey: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (typeof candidate.toolCallId !== "string" || typeof candidate.toolName !== "string") {
		return undefined;
	}

	if (candidate.type === "tool_execution_start") {
		return {
			type: "tool_execution_started",
			sessionKey,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
		};
	}

	if (candidate.type === "tool_execution_update") {
		return {
			type: "tool_execution_updated",
			sessionKey,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
			partialResult: candidate.partialResult,
		};
	}

	if (candidate.type === "tool_execution_end") {
		return {
			type: "tool_execution_finished",
			sessionKey,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			result: candidate.result,
			isError: candidate.isError === true,
		};
	}

	return undefined;
}

function normalizePiEvent(sessionKey: string, event: unknown): PiboOutputEvent | undefined {
	if (!event || typeof event !== "object") return undefined;

	const candidate = event as PiEventCandidate;

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "text_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return { type: "assistant_delta", sessionKey, text: candidate.assistantMessageEvent.delta };
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_start"
	) {
		return { type: "thinking_started", sessionKey };
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return { type: "thinking_delta", sessionKey, text: candidate.assistantMessageEvent.delta };
	}

	if (candidate.type === "message_update" && candidate.assistantMessageEvent?.type === "thinking_end") {
		const text =
			typeof candidate.assistantMessageEvent.content === "string" ? candidate.assistantMessageEvent.content : undefined;
		return text === undefined ? { type: "thinking_finished", sessionKey } : { type: "thinking_finished", sessionKey, text };
	}

	const toolCallEvent = normalizeToolCallEvent(sessionKey, candidate);
	if (toolCallEvent) return toolCallEvent;

	const toolExecutionEvent = normalizeToolExecutionEvent(sessionKey, candidate);
	if (toolExecutionEvent) return toolExecutionEvent;

	if (candidate.type === "message_end") {
		const message = candidate.message as
			| { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
			| undefined;
		const role = message?.role;
		if (role === "assistant") {
			if (message?.stopReason === "error" || typeof message?.errorMessage === "string") {
				return {
					type: "session_error",
					sessionKey,
					error:
						typeof message.errorMessage === "string" && message.errorMessage.length > 0
							? message.errorMessage
							: "Assistant message failed.",
				};
			}
			const text = textFromMessage(candidate.message);
			if (text) {
				return { type: "assistant_message", sessionKey, text };
			}
		}
	}

	return undefined;
}

export class RoutedSession {
	private readonly queue: PiboMessageEvent[] = [];
	private processing = false;
	private disposed = false;
	private activeMessage?: PiboMessageEvent;
	private unsubscribe?: () => void;

	constructor(
		private readonly sessionKey: string,
		private readonly runtime: AgentSessionRuntime,
		private readonly emit: PiboEventListener,
		private readonly pluginRegistry: PiboPluginRegistry,
		private readonly forwardPiEvents: boolean,
		private readonly onSessionOperation?: PiboSessionOperationListener,
	) {
		this.bindRuntimeSession();
		this.runtime.setRebindSession(async () => {
			this.bindRuntimeSession();
		});
	}

	private bindRuntimeSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.runtime.session.subscribe((event) => {
			const normalized = normalizePiEvent(this.sessionKey, event);
			if (normalized) {
				this.emit(this.withActiveMessage(normalized));
			}
			if (this.forwardPiEvents) {
				this.emit({ type: "pi_event", sessionKey: this.sessionKey, event });
			}
		});
	}

	enqueueMessage(event: PiboMessageEvent): PiboOutputEvent {
		this.assertActive();
		this.queue.push(event);

		const output: PiboOutputEvent = {
			type: "message_queued",
			sessionKey: this.sessionKey,
			eventId: event.id,
			queuedMessages: this.queue.length,
			text: event.text,
			source: event.source,
		};
		this.emit(output);
		void this.drain();
		return output;
	}

	async executeAction(event: PiboExecutionEvent): Promise<PiboOutputEvent> {
		this.assertActive();

		const result = await this.runAction(event);
		if (isSessionOperationResult(result)) await this.onSessionOperation?.(result);
		const output: PiboOutputEvent = {
			type: "execution_result",
			sessionKey: this.sessionKey,
			eventId: event.id,
			action: event.action,
			result,
		};
		this.emit(output);
		return output;
	}

	getStatus(): PiboSessionStatus {
		return {
			sessionKey: this.sessionKey,
			queuedMessages: this.queue.length,
			processing: this.processing,
			streaming: this.runtime.session.isStreaming,
			activeTools: this.runtime.session.getActiveToolNames(),
			cwd: this.runtime.cwd,
			disposed: this.disposed,
		};
	}

	getCurrentSession(): PiboPiSessionSnapshot {
		return this.createSessionSnapshot();
	}

	async listSessions(): Promise<PiboSessionListItem[]> {
		const manager = this.runtime.session.sessionManager;
		const sessions = await SessionManager.list(this.runtime.cwd, manager.getSessionDir());
		return sessions.map((session) => ({
			path: session.path,
			id: session.id,
			cwd: session.cwd,
			name: session.name,
			parentSessionPath: session.parentSessionPath,
			created: session.created.toISOString(),
			modified: session.modified.toISOString(),
			messageCount: session.messageCount,
			firstMessage: session.firstMessage,
		}));
	}

	getForkCandidates(): PiboForkCandidate[] {
		return this.runtime.session.getUserMessagesForForking();
	}

	async forkSession(entryId: string): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.fork(entryId);
		return {
			routeSessionKey: this.sessionKey,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
			selectedText: result.selectedText,
		};
	}

	async cloneSession(): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const leafId = this.runtime.session.sessionManager.getLeafId();
		if (!leafId) {
			throw new Error("Cannot clone session: no current entry selected");
		}
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.fork(leafId, { position: "at" });
		return {
			routeSessionKey: this.sessionKey,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
		};
	}

	getSessionTree(): PiboSessionTreeResult {
		this.assertActive();
		return {
			current: this.createSessionSnapshot(),
			tree: normalizeSessionTree(this.runtime.session.sessionManager.getTree()),
		};
	}

	async navigateSessionTree(params: PiboSessionTreeNavigateParams): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.session.navigateTree(params.entryId, {
			summarize: params.summarize,
			customInstructions: params.customInstructions,
			replaceInstructions: params.replaceInstructions,
			label: params.label,
		});
		return {
			routeSessionKey: this.sessionKey,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
			editorText: result.editorText,
			summaryEntryId: result.summaryEntry?.id,
		};
	}

	async switchSession(params: PiboSessionSwitchParams): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.switchSession(params.sessionFile, { cwdOverride: params.cwdOverride });
		return {
			routeSessionKey: this.sessionKey,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
		};
	}

	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult {
		this.assertActive();
		this.runtime.session.setThinkingLevel(level);
		return this.getThinkingResult();
	}

	cycleThinkingLevel(): PiboThinkingResult {
		this.assertActive();
		this.runtime.session.cycleThinkingLevel();
		return this.getThinkingResult();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;

		this.queue.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		await this.runtime.dispose();
	}

	async cancelMessage(eventId: string): Promise<boolean> {
		this.assertActive();

		const queuedIndex = this.queue.findIndex((event) => event.id === eventId);
		if (queuedIndex >= 0) {
			this.queue.splice(queuedIndex, 1);
			return true;
		}

		if (this.activeMessage?.id === eventId) {
			await this.runtime.session.abort();
			return true;
		}

		return false;
	}

	private async drain(): Promise<void> {
		if (this.processing || this.disposed) return;

		this.processing = true;
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const event = this.queue.shift()!;
				this.emit({
					type: "message_started",
					sessionKey: this.sessionKey,
					eventId: event.id,
					text: event.text,
					source: event.source,
				});

				try {
					this.activeMessage = event;
					await this.runtime.session.prompt(event.text, { source: promptSource(event.source) });
					this.emit({
						type: "message_finished",
						sessionKey: this.sessionKey,
						eventId: event.id,
						source: event.source,
					});
				} catch (error) {
					this.emit({
						type: "session_error",
						sessionKey: this.sessionKey,
						eventId: event.id,
						error: errorMessage(error),
					});
				} finally {
					this.activeMessage = undefined;
				}
			}
		} finally {
			this.processing = false;
		}
	}

	private async runAction(event: PiboExecutionEvent): Promise<unknown> {
		const action = event.action;
		const gatewayAction = this.pluginRegistry.getGatewayAction(action);
		if (!gatewayAction) {
			throw new Error(`Unknown execution action "${action}"`);
		}

		return await gatewayAction.execute(
			{
				sessionKey: this.sessionKey,
				getStatus: () => this.getStatus(),
				clearQueue: () => this.clearQueue(),
				abort: async () => {
					await this.runtime.session.abort();
				},
				dispose: () => this.dispose(),
				getCurrentSession: () => this.getCurrentSession(),
				listSessions: () => this.listSessions(),
				getForkCandidates: () => this.getForkCandidates(),
				forkSession: (entryId) => this.forkSession(entryId),
				cloneSession: () => this.cloneSession(),
				getSessionTree: () => this.getSessionTree(),
				navigateSessionTree: (params) => this.navigateSessionTree(params),
				switchSession: (params) => this.switchSession(params),
				setThinkingLevel: (level) => this.setThinkingLevel(level),
				cycleThinkingLevel: () => this.cycleThinkingLevel(),
			},
			event,
		);
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error(`Session "${this.sessionKey}" has been disposed`);
		}
	}

	private getThinkingResult(): PiboThinkingResult {
		return {
			level: this.runtime.session.thinkingLevel as PiboThinkingLevel,
			availableLevels: this.runtime.session.getAvailableThinkingLevels() as PiboThinkingLevel[],
			supported: this.runtime.session.supportsThinking(),
		};
	}

	private clearQueue(): number {
		const cleared = this.queue.length;
		this.queue.length = 0;
		return cleared;
	}

	private createSessionSnapshot(): PiboPiSessionSnapshot {
		const session = this.runtime.session;
		const manager = session.sessionManager;
		return {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			leafId: manager.getLeafId(),
			cwd: this.runtime.cwd,
			sessionName: session.sessionName,
			parentSessionFile: manager.getHeader()?.parentSession,
		};
	}

	private withActiveMessage(event: PiboOutputEvent): PiboOutputEvent {
		if (
			this.activeMessage?.id &&
			(event.type === "assistant_delta" ||
				event.type === "assistant_message" ||
				event.type === "thinking_started" ||
				event.type === "thinking_delta" ||
				event.type === "thinking_finished" ||
				event.type === "tool_call" ||
				event.type === "tool_execution_started" ||
				event.type === "tool_execution_updated" ||
				event.type === "tool_execution_finished" ||
				event.type === "session_error")
		) {
			return { ...event, eventId: this.activeMessage.id };
		}

		return event;
	}
}

function normalizeSessionTree(nodes: PiSessionTreeNode[]): PiboSessionTreeNode[] {
	return nodes.map((node) => ({
		entry: JSON.parse(JSON.stringify(node.entry)) as PiboJsonObject,
		children: normalizeSessionTree(node.children),
		label: node.label,
		labelTimestamp: node.labelTimestamp,
	}));
}

function isSessionOperationResult(value: unknown): value is PiboSessionOperationResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { routeSessionKey?: unknown; current?: { sessionId?: unknown } };
	return (
		typeof candidate.routeSessionKey === "string" &&
		Boolean(candidate.current) &&
		typeof candidate.current?.sessionId === "string"
	);
}
