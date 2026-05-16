import { SessionManager, type AgentSessionRuntime, shouldCompact } from "@mariozechner/pi-coding-agent";
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
	PiboSessionErrorDetails,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboSessionTreeNode,
	PiboSessionTreeResult,
	PiboThinkingResult,
} from "./events.js";
import type { PiboThinkingLevel } from "./thinking.js";
import type { CompactionResult } from "@mariozechner/pi-coding-agent";
import type { ContextUsage } from "@mariozechner/pi-coding-agent";
import { getOpenAiCodexProviderUsageForActiveModel } from "../auth/openai-codex-usage.js";
import { expandInlineSkills } from "./skill-expansion.js";
import type { ModelProfile } from "./profiles.js";

type PiSessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

type ProviderRequestModel = {
	api?: unknown;
	provider?: unknown;
};

type ProviderRequestPayload = Record<string, unknown>;

const FAST_SERVICE_TIER = "priority";

function modelSupportsFastServiceTier(model: ProviderRequestModel | undefined): boolean {
	if (!model) return false;
	if (model.api === "openai-codex-responses") return true;
	return model.api === "openai-responses" && (model.provider === "openai" || model.provider === "openai-codex");
}

function withFastServiceTier(payload: unknown): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	return { ...(payload as ProviderRequestPayload), service_tier: FAST_SERVICE_TIER };
}

type PiboSessionOperationListener = (
	result: PiboSessionOperationResult,
	event: PiboExecutionEvent,
) => void | Promise<void>;

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

type AssistantErrorMessage = {
	role?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
	api?: unknown;
	provider?: unknown;
	model?: unknown;
	usage?: unknown;
};

type ErrorContext = { contextWindow?: number };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseEmbeddedProviderError(message: string): { providerType?: string; providerCode?: string; providerParam?: string; providerMessage?: string } | undefined {
	const jsonStart = message.indexOf("{");
	if (jsonStart === -1) return undefined;
	try {
		const parsed = JSON.parse(message.slice(jsonStart)) as { error?: { type?: unknown; code?: unknown; param?: unknown; message?: unknown } };
		const error = parsed.error;
		if (!error || typeof error !== "object") return undefined;
		return {
			providerType: stringValue(error.type),
			providerCode: stringValue(error.code),
			providerParam: stringValue(error.param),
			providerMessage: stringValue(error.message),
		};
	} catch {
		return undefined;
	}
}

function assistantErrorDetails(message: AssistantErrorMessage, context?: ErrorContext): PiboSessionErrorDetails | undefined {
	const rawError = typeof message.errorMessage === "string" ? message.errorMessage : "";
	const providerError = parseEmbeddedProviderError(rawError);
	const usage = message.usage && typeof message.usage === "object" ? (message.usage as { totalTokens?: unknown }) : undefined;
	const contextTokens = numberValue(usage?.totalTokens);
	const details: PiboSessionErrorDetails = {
		category: providerError?.providerCode === "context_length_exceeded" ? "context_overflow" : undefined,
		...providerError,
		api: stringValue(message.api),
		provider: stringValue(message.provider),
		model: stringValue(message.model),
		contextWindow: context?.contextWindow,
		contextTokens,
	};
	return Object.values(details).some((value) => value !== undefined) ? details : undefined;
}

function formatAssistantError(message: AssistantErrorMessage, context?: ErrorContext): string {
	const rawError = typeof message.errorMessage === "string" && message.errorMessage.length > 0 ? message.errorMessage : "Assistant message failed.";
	const details = assistantErrorDetails(message, context);
	if (details?.category !== "context_overflow") return rawError;

	const lines = ["Context window exceeded while sending the model request."];
	if (details.providerMessage) lines.push(`Provider message: ${details.providerMessage}`);
	if (details.providerCode) lines.push(`Provider code: ${details.providerCode}`);
	if (details.providerParam) lines.push(`Provider param: ${details.providerParam}`);
	if (details.api || details.provider || details.model) {
		lines.push(`Model: ${[details.api, details.provider, details.model].filter(Boolean).join(" / ")}`);
	}
	if (details.contextTokens !== undefined || details.contextWindow !== undefined) {
		const usage = details.contextWindow
			? `${details.contextTokens ?? "unknown"} / ${details.contextWindow} tokens`
			: `${details.contextTokens} tokens`;
		lines.push(`Context usage: ${usage}`);
	}
	lines.push("Automatic overflow compaction will be attempted if auto-compaction is enabled.");
	return lines.join("\n");
}

function messageContentIndex(candidate: PiEventCandidate): number | undefined {
	return typeof candidate.assistantMessageEvent?.contentIndex === "number"
		? candidate.assistantMessageEvent.contentIndex
		: undefined;
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function lastTextPartFromMessage(message: unknown): { text: string; contentIndex: number } | undefined {
	if (!message || typeof message !== "object") return undefined;

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;

	for (let index = content.length - 1; index >= 0; index -= 1) {
		const part = content[index];
		if (!part || typeof part !== "object") continue;
		const candidate = part as { type?: unknown; text?: unknown };
		if (candidate.type === "text" && typeof candidate.text === "string" && candidate.text.length > 0) {
			return { text: candidate.text, contentIndex: index };
		}
	}
	return undefined;
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

function normalizeToolCallEvent(piboSessionId: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (
		candidate.type === "message_update" &&
		(candidate.assistantMessageEvent?.type === "toolcall_start" ||
			candidate.assistantMessageEvent?.type === "toolcall_end")
	) {
		const toolCall = toolCallFromAssistantEvent(candidate);
		if (!toolCall) return undefined;

		return {
			type: "tool_call",
			piboSessionId,
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.args,
			argsComplete: candidate.assistantMessageEvent.type === "toolcall_end",
		};
	}

	return undefined;
}

function normalizeToolExecutionEvent(piboSessionId: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (typeof candidate.toolCallId !== "string" || typeof candidate.toolName !== "string") {
		return undefined;
	}

	if (candidate.type === "tool_execution_start") {
		return {
			type: "tool_execution_started",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
		};
	}

	if (candidate.type === "tool_execution_update") {
		return {
			type: "tool_execution_updated",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
			partialResult: candidate.partialResult,
		};
	}

	if (candidate.type === "tool_execution_end") {
		return {
			type: "tool_execution_finished",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			result: candidate.result,
			isError: candidate.isError === true,
		};
	}

	return undefined;
}

function normalizePiEvent(piboSessionId: string, event: unknown, context?: ErrorContext): PiboOutputEvent | undefined {
	if (!event || typeof event !== "object") return undefined;

	const candidate = event as PiEventCandidate;

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "text_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return {
			type: "assistant_delta",
			piboSessionId,
			contentIndex: messageContentIndex(candidate),
			text: candidate.assistantMessageEvent.delta,
		};
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_start"
	) {
		return { type: "thinking_started", piboSessionId, contentIndex: messageContentIndex(candidate) };
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return { type: "thinking_delta", piboSessionId, contentIndex: messageContentIndex(candidate), text: candidate.assistantMessageEvent.delta };
	}

	if (candidate.type === "message_update" && candidate.assistantMessageEvent?.type === "thinking_end") {
		const text =
			typeof candidate.assistantMessageEvent.content === "string" ? candidate.assistantMessageEvent.content : undefined;
		return text === undefined
			? { type: "thinking_finished", piboSessionId, contentIndex: messageContentIndex(candidate) }
			: { type: "thinking_finished", piboSessionId, contentIndex: messageContentIndex(candidate), text };
	}

	const toolCallEvent = normalizeToolCallEvent(piboSessionId, candidate);
	if (toolCallEvent) return toolCallEvent;

	const toolExecutionEvent = normalizeToolExecutionEvent(piboSessionId, candidate);
	if (toolExecutionEvent) return toolExecutionEvent;

	if (candidate.type === "message_end") {
		const message = candidate.message as AssistantErrorMessage | undefined;
		const role = message?.role;
		if (role === "assistant") {
			if (message?.stopReason === "error" || typeof message?.errorMessage === "string") {
				return {
					type: "session_error",
					piboSessionId,
					error: formatAssistantError(message, context),
					errorDetails: assistantErrorDetails(message, context),
				};
			}
			const textPart = lastTextPartFromMessage(candidate.message);
			if (textPart) {
				return {
					type: "assistant_message",
					piboSessionId,
					contentIndex: textPart.contentIndex,
					text: textPart.text,
				};
			}
		}
	}

	return undefined;
}

/**
 * Estimate context tokens from agent messages using a simple chars/4 heuristic.
 * This is a conservative fallback when getContextUsage() returns null because
 * no post-compaction assistant usage exists yet.
 */
type RoutedQueueItem =
	| { kind: "message"; event: PiboMessageEvent }
	| { kind: "compact"; event: PiboExecutionEvent };

function estimateContextTokens(messages: unknown[]): number {
	let chars = 0;
	for (const msg of messages) {
		if (!msg || typeof msg !== "object") continue;
		const message = msg as { role?: unknown; content?: unknown };
		if (message.role === "user") {
			const content = message.content;
			if (typeof content === "string") {
				chars += content.length;
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
						chars += block.text.length;
					}
				}
			}
		} else if (message.role === "assistant") {
			const content = (message as { content?: unknown[] }).content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (!block || typeof block !== "object") continue;
					if ("type" in block) {
						if (block.type === "text" && "text" in block && typeof block.text === "string") chars += block.text.length;
						if (block.type === "thinking" && "thinking" in block && typeof block.thinking === "string") chars += block.thinking.length;
						if (block.type === "toolCall" && "name" in block && "arguments" in block) {
							chars += String(block.name).length + JSON.stringify(block.arguments).length;
						}
					}
				}
			}
		} else if (message.role === "toolResult" || message.role === "custom") {
			const content = message.content;
			if (typeof content === "string") {
				chars += content.length;
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
						chars += block.text.length;
					}
					if (block && typeof block === "object" && "type" in block && block.type === "image") {
						chars += 4800; // approximate image size
					}
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

export class RoutedSession {
	private readonly queue: RoutedQueueItem[] = [];
	private processing = false;
	private disposed = false;
	private fastMode = false;
	private readonly fastModePatchedAgents = new WeakSet<object>();
	private activeMessage?: PiboMessageEvent;
	private activeAssistantIndex?: number;
	private nextAssistantIndex = 0;
	private activeThinkingIndex?: number;
	private nextThinkingIndex = 0;
	private unsubscribe?: () => void;
	private isContinuePatched = false;

	constructor(
		private readonly piboSessionId: string,
		private readonly runtime: AgentSessionRuntime,
		private readonly emit: PiboEventListener,
		private readonly pluginRegistry: PiboPluginRegistry,
		private readonly forwardPiEvents: boolean,
		private readonly onPiEventTelemetry: ((piboSessionId: string, event: unknown, context: { status?: PiboSessionStatus; activeEventId?: string }) => void) | undefined,
		initialFastMode: boolean,
		private readonly onSessionOperation?: PiboSessionOperationListener,
		private readonly onKillChildren?: (piboSessionId: string, options?: { includeRuns?: boolean }) => Promise<{ killed: string[]; cancelledRuns: string[] }>,
		private readonly onStateChange?: (state: { processing: boolean; queuedMessages: number; disposed: boolean }) => void,
	) {
		this.fastMode = initialFastMode && this.fastModeSupported();
		this.bindRuntimeSession();
		this.patchFastModeProviderRequest();
		this.patchAgentContinue();
		this.runtime.setRebindSession(async () => {
			this.bindRuntimeSession();
			this.patchFastModeProviderRequest();
			this.patchAgentContinue();
		});
	}

	private patchFastModeProviderRequest(): void {
		const agent = this.runtime.session.agent;
		if (!agent || typeof agent !== "object") return;
		if (this.fastModePatchedAgents.has(agent)) return;
		this.fastModePatchedAgents.add(agent);

		const originalOnPayload = agent.onPayload?.bind(agent);
		agent.onPayload = async (payload, model) => {
			const nextPayload = originalOnPayload ? await originalOnPayload(payload, model) : payload;
			if (this.getFastModeResult().mode !== "fast") return nextPayload;
			if (!modelSupportsFastServiceTier(model)) return nextPayload;
			return withFastServiceTier(nextPayload);
		};
	}

	private patchAgentContinue(): void {
		if (this.isContinuePatched) return;
		this.isContinuePatched = true;

		const agent = this.runtime.session.agent;
		if (!agent) return;
		const originalContinue = agent.continue.bind(agent);
		const session = this.runtime.session;

		agent.continue = async () => {
			const model = session.model;
			if (!model) return originalContinue();

			const contextWindow = model.contextWindow ?? 0;
			const settings = session.settingsManager.getCompactionSettings();
			if (!settings.enabled) return originalContinue();

			let contextTokens: number | null = null;
			const contextUsage = session.getContextUsage();
			if (contextUsage && contextUsage.tokens !== null) {
				contextTokens = contextUsage.tokens;
			} else {
				// Fallback: estimate tokens from current messages when no post-compaction
				// assistant usage is available yet. This prevents context overflow between
				// tool calls after a compaction.
				contextTokens = estimateContextTokens(session.messages);
			}
			if (contextTokens === null) return originalContinue();

			if (shouldCompact(contextTokens, contextWindow, settings)) {
				await session.compact();
			}

			return originalContinue();
		};
	}

	private bindRuntimeSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.runtime.session.subscribe((event) => {
			this.onPiEventTelemetry?.(this.piboSessionId, event, { status: this.getStatus(), activeEventId: this.activeMessage?.id });
			const model = this.runtime.session.model as { contextWindow?: unknown } | undefined;
			const normalized = normalizePiEvent(this.piboSessionId, event, { contextWindow: numberValue(model?.contextWindow) });
			if (normalized) {
				this.emit(this.withActiveMessage(normalized));
			}
			if (this.forwardPiEvents) {
				this.emit({ type: "pi_event", piboSessionId: this.piboSessionId, event });
			}
			this.handleCompactionEvent(event);
		});
	}

	private handleCompactionEvent(event: unknown): void {
		if (!event || typeof event !== "object") return;
		const candidate = event as { type?: unknown; reason?: unknown; result?: unknown; aborted?: unknown; errorMessage?: unknown };
		if (candidate.type === "compaction_start") {
			this.emit({
				type: "compaction_start",
				piboSessionId: this.piboSessionId,
				reason: typeof candidate.reason === "string" ? candidate.reason : "unknown",
			});
		}
		if (candidate.type === "compaction_end") {
			if (candidate.result && candidate.aborted !== true) {
				// Reset assistant message indices so the next assistant response starts
				// fresh after compaction, matching the reduced agent context.
				this.activeAssistantIndex = undefined;
				this.nextAssistantIndex = 0;
				this.activeThinkingIndex = undefined;
				this.nextThinkingIndex = 0;
			}
			this.emit({
				type: "compaction_end",
				piboSessionId: this.piboSessionId,
				reason: typeof candidate.reason === "string" ? candidate.reason : "unknown",
				result: candidate.result,
				aborted: candidate.aborted === true,
				errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
			});
		}
	}

	enqueueMessage(event: PiboMessageEvent): PiboOutputEvent {
		this.assertActive();
		this.queue.push({ kind: "message", event });

		const output: PiboOutputEvent = {
			type: "message_queued",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			queuedMessages: this.queue.length,
			text: event.text,
			source: event.source,
		};
		this.emit(output);
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		void this.drain();
		return output;
	}

	async executeAction(event: PiboExecutionEvent): Promise<PiboOutputEvent> {
		this.assertActive();

		if (event.action === "compact") {
			return this.enqueueCompactAction(event);
		}

		const result = await this.runAction(event);
		if (isSessionOperationResult(result)) await this.onSessionOperation?.(result, event);
		const output: PiboOutputEvent = {
			type: "execution_result",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			action: event.action,
			result,
		};
		this.emit(output);
		return output;
	}

	getStatus(): PiboSessionStatus {
		const enabledTools = this.runtime.session.getActiveToolNames();
		const thinkingLevel = this.runtime.session.thinkingLevel as PiboThinkingLevel;
		return {
			piboSessionId: this.piboSessionId,
			queuedMessages: this.queue.length,
			processing: this.processing,
			streaming: this.runtime.session.isStreaming,
			activeTools: enabledTools,
			enabledTools,
			cwd: this.runtime.cwd,
			disposed: this.disposed,
			thinkingLevel,
			fastMode: this.getFastModeResult().mode === "fast",
		};
	}

	getContextUsage(): ContextUsage | undefined {
		return this.runtime.session.getContextUsage();
	}

	getActiveModel(): { provider: string; id: string } | undefined {
		const model = this.runtime.session.model;
		return model ? { provider: model.provider, id: model.id } : undefined;
	}

	async getProviderUsage() {
		try {
			return await getOpenAiCodexProviderUsageForActiveModel(this.getActiveModel());
		} catch {
			return undefined;
		}
	}

	removeQueuedMessages(predicate: (event: PiboMessageEvent) => boolean): number {
		this.assertActive();

		let removed = 0;
		for (let index = this.queue.length - 1; index >= 0; index -= 1) {
			const item = this.queue[index];
			if (item.kind !== "message" || !predicate(item.event)) continue;
			this.queue.splice(index, 1);
			removed += 1;
		}
		return removed;
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
			piboSessionId: this.piboSessionId,
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
			piboSessionId: this.piboSessionId,
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
			piboSessionId: this.piboSessionId,
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
			piboSessionId: this.piboSessionId,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
		};
	}

	async setModel(model: ModelProfile): Promise<ModelProfile> {
		this.assertActive();
		const resolved = this.runtime.session.modelRegistry.find(model.provider, model.id);
		if (!resolved) throw new Error(`Unknown model ${model.provider}/${model.id}`);
		await this.runtime.session.setModel(resolved);
		return { provider: resolved.provider, id: resolved.id };
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

	getFastMode(): { mode: "fast" | "normal"; supported: boolean } {
		this.assertActive();
		return this.getFastModeResult();
	}

	setFastMode(enabled: boolean): { mode: "fast" | "normal"; supported: boolean; changed: boolean } {
		this.assertActive();
		const before = this.getFastModeResult().mode;
		if (this.fastModeSupported()) this.fastMode = enabled;
		const current = this.getFastModeResult();
		return { ...current, changed: before !== current.mode };
	}

	async compact(customInstructions?: string): Promise<CompactionResult> {
		this.assertActive();
		return await this.runtime.session.compact(customInstructions);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;

		this.queue.length = 0;
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: true });
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		await this.runtime.dispose();
	}

	async kill(): Promise<string> {
		this.queue.length = 0;
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		await this.runtime.session.abort();
		return this.piboSessionId;
	}

	async cancelMessage(eventId: string): Promise<boolean> {
		this.assertActive();

		const queuedIndex = this.queue.findIndex((item) => item.event.id === eventId);
		if (queuedIndex >= 0) {
			this.queue.splice(queuedIndex, 1);
			this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
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
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const item = this.queue.shift()!;
				this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
				if (item.kind === "compact") {
					await this.processQueuedCompact(item.event);
				} else {
					await this.processQueuedMessage(item.event);
				}
			}
		} finally {
			this.processing = false;
			this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		}
	}

	private async processQueuedMessage(event: PiboMessageEvent): Promise<void> {
		this.emit({
			type: "message_started",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			text: event.text,
			source: event.source,
		});

		try {
			this.activeMessage = event;
			this.activeAssistantIndex = undefined;
			this.nextAssistantIndex = 0;
			this.activeThinkingIndex = undefined;
			this.nextThinkingIndex = 0;
			const expandedText = expandInlineSkills(
				event.text,
				this.runtime.session.resourceLoader.getSkills().skills,
			);
			await this.runtime.session.prompt(expandedText, { source: promptSource(event.source) });
			this.emit({
				type: "message_finished",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				source: event.source,
			});
		} catch (error) {
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				error: errorMessage(error),
			});
		} finally {
			this.activeMessage = undefined;
			this.activeAssistantIndex = undefined;
			this.nextAssistantIndex = 0;
			this.activeThinkingIndex = undefined;
			this.nextThinkingIndex = 0;
		}
	}

	private async processQueuedCompact(event: PiboExecutionEvent): Promise<void> {
		try {
			const result = await this.runAction(event);
			this.emit({
				type: "execution_result",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				action: event.action,
				result,
			});
		} catch (error) {
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				error: errorMessage(error),
			});
		}
	}

	private enqueueCompactAction(event: PiboExecutionEvent): PiboOutputEvent {
		this.queue.push({ kind: "compact", event });
		const output: PiboOutputEvent = {
			type: "execution_result",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			action: event.action,
			result: { queued: true, queuedMessages: this.queue.length },
		};
		this.emit(output);
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		void this.drain();
		return output;
	}

	private async runAction(event: PiboExecutionEvent): Promise<unknown> {
		const action = event.action;
		const gatewayAction = this.pluginRegistry.getGatewayAction(action);
		if (!gatewayAction) {
			throw new Error(`Unknown execution action "${action}"`);
		}

		return await gatewayAction.execute(
			{
				piboSessionId: this.piboSessionId,
				getStatus: () => this.getStatus(),
				getContextUsage: () => this.getContextUsage(),
				getActiveModel: () => this.getActiveModel(),
				getProviderUsage: () => this.getProviderUsage(),
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
				getThinkingLevel: () => this.getThinkingResult(),
				setThinkingLevel: (level) => this.setThinkingLevel(level),
				cycleThinkingLevel: () => this.cycleThinkingLevel(),
				getFastMode: () => this.getFastMode(),
				setFastMode: (enabled) => this.setFastMode(enabled),
				setModel: (model) => this.setModel(model),
				compact: (customInstructions) => this.compact(customInstructions),
				kill: async () => {
					const killed = [await this.kill()];
					let cancelledRuns: string[] = [];
					if (this.onKillChildren) {
						const children = await this.onKillChildren(this.piboSessionId);
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
				killAll: async () => {
					const killed = [await this.kill()];
					let cancelledRuns: string[] = [];
					if (this.onKillChildren) {
						const children = await this.onKillChildren(this.piboSessionId, { includeRuns: true });
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
			},
			event,
		);
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error(`Session "${this.piboSessionId}" has been disposed`);
		}
	}

	private getThinkingResult(): PiboThinkingResult {
		return {
			level: this.runtime.session.thinkingLevel as PiboThinkingLevel,
			availableLevels: this.runtime.session.getAvailableThinkingLevels() as PiboThinkingLevel[],
			supported: this.runtime.session.supportsThinking(),
		};
	}

	private getFastModeResult(): { mode: "fast" | "normal"; supported: boolean } {
		const supported = this.fastModeSupported();
		return { mode: supported && this.fastMode ? "fast" : "normal", supported };
	}

	private fastModeSupported(): boolean {
		return this.runtime.session.supportsThinking() && modelSupportsFastServiceTier(this.runtime.session.model);
	}

	private clearQueue(): number {
		const cleared = this.queue.length;
		this.queue.length = 0;
		this.onStateChange?.({ processing: this.processing, queuedMessages: this.queue.length, disposed: this.disposed });
		return cleared;
	}

	private createSessionSnapshot(): PiboPiSessionSnapshot {
		const session = this.runtime.session;
		const manager = session.sessionManager;
		return {
			piSessionId: session.sessionId,
			sessionFile: session.sessionFile,
			leafId: manager.getLeafId(),
			cwd: this.runtime.cwd,
			sessionName: session.sessionName,
			parentSessionFile: manager.getHeader()?.parentSession,
		};
	}

	private withActiveMessage(event: PiboOutputEvent): PiboOutputEvent {
		if (this.activeMessage?.id && event.type === "assistant_delta") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) {
				this.nextAssistantIndex += 1;
				this.activeAssistantIndex = assistantIndex;
			}
			return { ...event, eventId: this.activeMessage.id, assistantIndex };
		}

		if (this.activeMessage?.id && event.type === "assistant_message") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) {
				this.nextAssistantIndex += 1;
			}
			this.activeAssistantIndex = undefined;
			return { ...event, eventId: this.activeMessage.id, assistantIndex };
		}

		if (this.activeMessage?.id && event.type === "thinking_started") {
			const thinkingIndex = this.nextThinkingIndex;
			this.nextThinkingIndex += 1;
			this.activeThinkingIndex = thinkingIndex;
			return { ...event, eventId: this.activeMessage.id, thinkingIndex };
		}

		if (this.activeMessage?.id && (event.type === "thinking_delta" || event.type === "thinking_finished")) {
			const thinkingIndex = this.activeThinkingIndex ?? this.nextThinkingIndex;
			if (this.activeThinkingIndex === undefined) {
				this.nextThinkingIndex += 1;
				this.activeThinkingIndex = thinkingIndex;
			}
			const output = { ...event, eventId: this.activeMessage.id, thinkingIndex };
			if (event.type === "thinking_finished") this.activeThinkingIndex = undefined;
			return output;
		}

		if (
			this.activeMessage?.id &&
			(event.type === "tool_call" ||
				event.type === "tool_execution_started" ||
				event.type === "tool_execution_updated" ||
				event.type === "tool_execution_finished" ||
				event.type === "session_error" ||
				event.type === "execution_result")
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
	const candidate = value as { piboSessionId?: unknown; current?: { piSessionId?: unknown } };
	return (
		typeof candidate.piboSessionId === "string" &&
		Boolean(candidate.current) &&
		typeof candidate.current?.piSessionId === "string"
	);
}
