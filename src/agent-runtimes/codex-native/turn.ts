import { normalizeSessionErrorDetails, runtimeSessionErrorDetails } from "../../core/session-errors.js";
import type { PiboJsonObject, PiboSessionErrorDetails } from "../../core/events.js";
import type { AgentRuntimeSemanticEvent, AgentRuntimeUsage } from "../../agent-runtime/events.js";
import {
	CodexAppServerClientError,
	type CodexAppServerClient,
	type CodexAppServerDiagnostic,
} from "./client.js";
import type { CodexNativeTurnModelOptions } from "./models.js";
import type {
	CodexAppServerThreadCompactStartParams,
	CodexAppServerThreadCompactStartResponse,
	CodexAppServerThreadItem,
	CodexAppServerThreadTokenUsage,
	CodexAppServerTurn,
	CodexAppServerTurnInterruptParams,
	CodexAppServerTurnInterruptResponse,
	CodexAppServerTurnStartParams,
	CodexAppServerTurnStartResponse,
	CodexAppServerTurnSteerParams,
	CodexAppServerTurnSteerResponse,
} from "./protocol-types.js";
import { redactCodexNativeSensitiveText, redactCodexNativeValue } from "./redaction.js";
import {
	CodexNativeThreadController,
	validateCodexAppServerThreadItem,
	validateCodexAppServerThreadStatus,
	validateCodexAppServerTurn,
} from "./thread.js";

const TOOL_ITEM_TYPES = new Set([
	"collabAgentToolCall",
	"commandExecution",
	"dynamicToolCall",
	"fileChange",
	"imageGeneration",
	"imageView",
	"mcpToolCall",
	"sleep",
	"webSearch",
]);

export class CodexNativeTurnProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexNativeTurnProtocolError";
	}
}

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
};

type ToolDescriptor = {
	name: string;
	args: unknown;
};

type PendingTurn = {
	kind: "turn" | "compaction";
	completion: Deferred<CodexAppServerTurn>;
	turnIdReady: Deferred<string | undefined>;
	turnIdReadySettled: boolean;
	turnId?: string;
	started: boolean;
	terminal: boolean;
	items: Map<string, CodexAppServerThreadItem>;
	itemOrder: string[];
	completedItems: Set<string>;
	assistantIndices: Map<string, number>;
	assistantBuffers: Map<string, string>;
	completedAssistantItems: Set<string>;
	nextAssistantIndex: number;
	reasoningStartedItems: Set<string>;
	reasoningSummaryParts: Map<string, Map<number, string>>;
	reasoningContentParts: Map<string, Map<number, string>>;
	completedReasoningItems: Set<string>;
	compactionStarted: boolean;
	compactionEnded: boolean;
	startedTools: Map<string, ToolDescriptor>;
	completedTools: Set<string>;
	usage?: AgentRuntimeUsage;
	lastError?: { message: string; details: PiboSessionErrorDetails };
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new CodexNativeTurnProtocolError(`Codex ${label} is invalid.`);
	return value;
}

function redactedObject(value: unknown): PiboJsonObject {
	const selected = redactCodexNativeValue(value);
	return isRecord(selected) ? selected as PiboJsonObject : {};
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value) throw new CodexNativeTurnProtocolError(`Codex ${label} is invalid.`);
	return value;
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== "string") throw new CodexNativeTurnProtocolError(`Codex ${label} is invalid.`);
	return value;
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new CodexNativeTurnProtocolError(`Codex ${label} is invalid.`);
	return Number(value);
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
	const selected = requiredInteger(value, label);
	if (selected < 0) throw new CodexNativeTurnProtocolError(`Codex ${label} is invalid.`);
	return selected;
}

function safeDiagnosticText(value: string): string {
	return redactCodexNativeSensitiveText(value)
		.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'<>|]+[\\/]){2,}[^\s"'<>|]*/g, "[redacted path]")
		.slice(0, 4_000);
}

function errorMessage(value: unknown): string {
	if (typeof value === "string" && value.trim()) return safeDiagnosticText(value);
	if (isRecord(value)) {
		for (const key of ["message", "additionalDetails", "details", "reason"]) {
			const candidate = value[key];
			if (typeof candidate === "string" && candidate.trim()) return safeDiagnosticText(candidate);
		}
	}
	return "Codex turn failed.";
}

function errorCode(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of ["code", "type", "kind"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);
		}
	}
	return undefined;
}

function providerErrorDetails(value: unknown, message: string, retryable?: boolean): PiboSessionErrorDetails {
	const providerCode = errorCode(value);
	return normalizeSessionErrorDetails(message, {
		api: "codex-app-server",
		provider: "openai-codex",
		providerType: "codex",
		...(providerCode ? { providerCode } : {}),
		providerMessage: message,
		origin: "provider",
		...(retryable !== undefined ? { retryable } : {}),
	});
}

function validateTurnStartResponse(value: unknown): CodexAppServerTurn {
	const record = requiredRecord(value, "turn/start response");
	if (!Object.hasOwn(record, "turn")) throw new CodexNativeTurnProtocolError("Codex turn/start response is missing its turn.");
	return validateCodexAppServerTurn(record.turn);
}

function validateTurnSteerResponse(value: unknown): string {
	return requiredString(requiredRecord(value, "turn/steer response").turnId, "steered turn id");
}

function tokenUsageBreakdown(value: unknown, label: string): AgentRuntimeUsage {
	const record = requiredRecord(value, label);
	return {
		inputTokens: requiredNonNegativeInteger(record.inputTokens, `${label} input token count`),
		outputTokens: requiredNonNegativeInteger(record.outputTokens, `${label} output token count`),
		cacheReadTokens: requiredNonNegativeInteger(record.cachedInputTokens, `${label} cached input token count`),
		cacheWriteTokens: record.cacheWriteInputTokens === undefined
			? 0
			: requiredNonNegativeInteger(record.cacheWriteInputTokens, `${label} cache-write input token count`),
		reasoningTokens: requiredNonNegativeInteger(record.reasoningOutputTokens, `${label} reasoning token count`),
		totalTokens: requiredNonNegativeInteger(record.totalTokens, `${label} total token count`),
	};
}

function validateTokenUsage(value: unknown): AgentRuntimeUsage {
	const record = requiredRecord(value, "thread token usage");
	const usage = tokenUsageBreakdown(record.last, "last turn usage");
	if (record.modelContextWindow !== undefined && record.modelContextWindow !== null) {
		usage.contextWindow = requiredNonNegativeInteger(record.modelContextWindow, "model context window");
	}
	return usage;
}

function textArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string")
		.map(redactCodexNativeSensitiveText);
}

function toolDescriptor(item: CodexAppServerThreadItem): ToolDescriptor | undefined {
	if (!TOOL_ITEM_TYPES.has(item.type)) return undefined;
	if (item.type === "commandExecution") {
		return {
			name: "codex_command",
			args: redactCodexNativeValue({
				command: item.command,
				commandActions: item.commandActions,
				source: item.source,
				pluginId: item.pluginId,
				scriptPath: item.scriptPath,
			}),
		};
	}
	if (item.type === "fileChange") {
		return { name: "codex_file_change", args: redactCodexNativeValue({ changes: item.changes }) };
	}
	if (item.type === "mcpToolCall") {
		const server = typeof item.server === "string" ? redactCodexNativeSensitiveText(item.server) : "mcp";
		const tool = typeof item.tool === "string" ? redactCodexNativeSensitiveText(item.tool) : "tool";
		return {
			name: `${server}/${tool}`,
			args: redactCodexNativeValue({ server, tool, arguments: item.arguments }),
		};
	}
	if (item.type === "dynamicToolCall") {
		const tool = typeof item.tool === "string" ? redactCodexNativeSensitiveText(item.tool) : "dynamic_tool";
		return { name: tool, args: redactCodexNativeValue({ tool, arguments: item.arguments }) };
	}
	if (item.type === "webSearch") {
		return { name: "codex_web_search", args: redactCodexNativeValue({ query: item.query, action: item.action }) };
	}
	if (item.type === "imageView") {
		return { name: "codex_image_view", args: { image: "[local image]" } };
	}
	if (item.type === "sleep") {
		return { name: "codex_sleep", args: redactCodexNativeValue({ durationMs: item.durationMs }) };
	}
	if (item.type === "imageGeneration") {
		return { name: "codex_image_generation", args: redactCodexNativeValue({ prompt: item.prompt }) };
	}
	const nativeTool = typeof item.tool === "string" ? item.tool : "agent_tool";
	return {
		name: `codex_${redactCodexNativeSensitiveText(nativeTool)}`,
		args: redactCodexNativeValue({ tool: item.tool, prompt: item.prompt, receiverThreadIds: item.receiverThreadIds }),
	};
}

function toolResult(item: CodexAppServerThreadItem): unknown {
	if (item.type === "commandExecution") {
		return redactCodexNativeValue({
			status: item.status,
			exitCode: item.exitCode,
			durationMs: item.durationMs,
			output: item.aggregatedOutput,
		});
	}
	if (item.type === "fileChange") return redactCodexNativeValue({ status: item.status, changes: item.changes });
	if (item.type === "mcpToolCall") return redactCodexNativeValue({ status: item.status, result: item.result, error: item.error });
	if (item.type === "dynamicToolCall") {
		return redactCodexNativeValue({ status: item.status, success: item.success, contentItems: item.contentItems });
	}
	if (item.type === "webSearch") return redactCodexNativeValue({ query: item.query, results: item.results });
	if (item.type === "imageView") return { status: item.status ?? "completed", image: "[local image]" };
	if (item.type === "sleep") return redactCodexNativeValue({ status: item.status, durationMs: item.durationMs });
	if (item.type === "imageGeneration") {
		return redactCodexNativeValue({ status: item.status, result: item.result, revisedPrompt: item.revisedPrompt });
	}
	return redactCodexNativeValue({ status: item.status, result: item.result, receiverThreadIds: item.receiverThreadIds });
}

function toolFailed(item: CodexAppServerThreadItem): boolean {
	if (item.success === false) return true;
	if (typeof item.status !== "string") return false;
	return ["declined", "failed", "error"].includes(item.status.toLowerCase());
}

function newPendingTurn(kind: PendingTurn["kind"] = "turn"): PendingTurn {
	const completion = deferred<CodexAppServerTurn>();
	const turnIdReady = deferred<string | undefined>();
	void completion.promise.catch(() => {});
	return {
		kind,
		completion,
		turnIdReady,
		turnIdReadySettled: false,
		started: false,
		terminal: false,
		items: new Map(),
		itemOrder: [],
		completedItems: new Set(),
		assistantIndices: new Map(),
		assistantBuffers: new Map(),
		completedAssistantItems: new Set(),
		nextAssistantIndex: 0,
		reasoningStartedItems: new Set(),
		reasoningSummaryParts: new Map(),
		reasoningContentParts: new Map(),
		completedReasoningItems: new Set(),
		compactionStarted: false,
		compactionEnded: false,
		startedTools: new Map(),
		completedTools: new Set(),
	};
}

export class CodexNativeTurnController {
	private pending?: PendingTurn;
	private disposed = false;
	private readonly unsubscribeNotifications: () => void;
	private readonly unsubscribeDiagnostics: () => void;

	constructor(
		private readonly client: CodexAppServerClient,
		private readonly threads: CodexNativeThreadController,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
	) {
		this.unsubscribeNotifications = client.subscribeNotifications((notification) => {
			if (this.disposed) return;
			try {
				this.handleNotification(notification.method, notification.params);
			} catch (error) {
				this.handleProtocolFailure(error);
			}
		});
		this.unsubscribeDiagnostics = client.subscribeDiagnostics((diagnostic) => this.handleDiagnostic(diagnostic));
	}

	get streaming(): boolean {
		return this.pending !== undefined;
	}

	get activeTurnId(): string | undefined {
		return this.pending?.turnId;
	}

	async start(text: string, clientUserMessageId: string | undefined, modelOptions: CodexNativeTurnModelOptions): Promise<void> {
		if (this.disposed) throw new Error("Codex native turn controller is disposed.");
		if (this.pending) throw new Error("Codex native session already has an active turn.");
		const pending = newPendingTurn();
		this.pending = pending;
		const params: CodexAppServerTurnStartParams = {
			threadId: this.threads.thread.id,
			input: [{ type: "text", text }],
			...(clientUserMessageId ? { clientUserMessageId } : {}),
			model: modelOptions.model,
			effort: modelOptions.effort,
			serviceTier: modelOptions.serviceTier,
			...(modelOptions.summary !== undefined ? { summary: modelOptions.summary } : {}),
			...(modelOptions.personality !== undefined ? { personality: modelOptions.personality } : {}),
		};
		try {
			const response = await this.client.request<CodexAppServerTurnStartResponse, CodexAppServerTurnStartParams>("turn/start", params);
			const turn = validateTurnStartResponse(response);
			this.assignTurnId(pending, turn.id);
			if (turn.status !== "inProgress") this.finishTurn(pending, turn);
			await pending.completion.promise;
		} catch (error) {
			if (!pending.terminal && this.pending === pending) {
				if (pending.started || pending.turnId) {
					const normalized = error instanceof Error ? error : new Error("Codex turn/start failed after the native turn began.");
					this.failActiveTurn(pending, normalized, runtimeSessionErrorDetails(safeDiagnosticText(normalized.message)));
				} else {
					this.pending = undefined;
					this.resolveTurnId(pending, undefined);
				}
			}
			throw error;
		}
	}

	async compact(): Promise<void> {
		if (this.disposed) throw new Error("Codex native turn controller is disposed.");
		if (this.pending) throw new Error("Codex native session already has an active turn.");
		const pending = newPendingTurn("compaction");
		this.pending = pending;
		this.ensureCompactionStarted(pending);
		try {
			await this.client.request<CodexAppServerThreadCompactStartResponse, CodexAppServerThreadCompactStartParams>(
				"thread/compact/start",
				{ threadId: this.threads.thread.id },
			);
			await pending.completion.promise;
		} catch (error) {
			if (!pending.terminal && this.pending === pending) {
				const normalized = error instanceof Error ? error : new Error("Codex compaction could not be completed.");
				if (pending.started || pending.turnId) {
					this.failActiveTurn(pending, normalized, runtimeSessionErrorDetails(safeDiagnosticText(normalized.message)));
				} else {
					this.finishCompaction(pending, {
						aborted: false,
						errorMessage: safeDiagnosticText(normalized.message),
					});
					this.pending = undefined;
					this.resolveTurnId(pending, undefined);
				}
			}
			throw error;
		}
	}

	async steer(text: string, clientUserMessageId?: string): Promise<void> {
		const pending = this.pending;
		if (!pending || pending.terminal) throw new Error("Codex native steering requires an active turn.");
		const turnId = pending.turnId ?? await pending.turnIdReady.promise;
		if (!turnId || pending.terminal || this.pending !== pending) throw new Error("Codex native steering requires an active turn.");
		const params: CodexAppServerTurnSteerParams = {
			threadId: this.threads.thread.id,
			expectedTurnId: turnId,
			input: [{ type: "text", text }],
			...(clientUserMessageId ? { clientUserMessageId } : {}),
		};
		const response = await this.client.request<CodexAppServerTurnSteerResponse, CodexAppServerTurnSteerParams>("turn/steer", params);
		const returnedTurnId = validateTurnSteerResponse(response);
		if (returnedTurnId !== turnId) throw new CodexNativeTurnProtocolError("Codex turn/steer returned a different turn id.");
	}

	async interrupt(): Promise<void> {
		const pending = this.pending;
		if (!pending || pending.terminal) return;
		const turnId = pending.turnId ?? await pending.turnIdReady.promise;
		if (!turnId || pending.terminal || this.pending !== pending) return;
		await this.client.request<CodexAppServerTurnInterruptResponse, CodexAppServerTurnInterruptParams>("turn/interrupt", {
			threadId: this.threads.thread.id,
			turnId,
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeNotifications();
		this.unsubscribeDiagnostics();
		const pending = this.pending;
		this.pending = undefined;
		if (pending && !pending.terminal) {
			if ((pending.kind === "compaction" || pending.compactionStarted) && !pending.compactionEnded) {
				this.finishCompaction(pending, {
					aborted: true,
					errorMessage: "Codex native compaction was interrupted because the session was disposed.",
				});
			}
			pending.terminal = true;
			this.resolveTurnId(pending, undefined);
			pending.completion.reject(new CodexAppServerClientError("closed", "Codex native turn controller was disposed"));
		}
	}

	private handleNotification(method: string, params: unknown): void {
		switch (method) {
			case "turn/started":
				this.handleTurnStarted(params);
				return;
			case "turn/completed":
				this.handleTurnCompleted(params);
				return;
			case "item/started":
				this.handleItemStarted(params);
				return;
			case "item/completed":
				this.handleItemCompleted(params);
				return;
			case "item/agentMessage/delta":
				this.handleAssistantDelta(params);
				return;
			case "item/reasoning/summaryPartAdded":
				this.handleReasoningPartAdded(params);
				return;
			case "item/reasoning/summaryTextDelta":
				this.handleReasoningDelta(params, "summaryIndex", true);
				return;
			case "item/reasoning/textDelta":
				this.handleReasoningDelta(params, "contentIndex", false);
				return;
			case "item/commandExecution/outputDelta":
			case "item/fileChange/outputDelta":
				this.handleToolDelta(params, "delta");
				return;
			case "item/commandExecution/terminalInteraction":
				this.handleTerminalInteraction(params);
				return;
			case "item/fileChange/patchUpdated":
				this.handleToolDelta(params, "changes");
				return;
			case "item/mcpToolCall/progress":
				this.handleToolDelta(params, "message");
				return;
			case "thread/tokenUsage/updated":
				this.handleUsage(params);
				return;
			case "thread/status/changed":
				this.handleThreadStatus(params);
				return;
			case "error":
				this.handleTurnError(params);
				return;
			case "warning":
			case "guardianWarning":
			case "deprecationNotice":
			case "configWarning":
				this.handleWarning(method, params);
				return;
			case "model/rerouted":
				this.handleModelRerouted(params);
				return;
			default:
				return;
		}
	}

	private handleTurnStarted(value: unknown): void {
		const params = requiredRecord(value, "turn/started notification");
		if (requiredString(params.threadId, "turn/started thread id") !== this.threads.thread.id) return;
		const pending = this.pending;
		if (!pending || pending.terminal) return;
		const turn = validateCodexAppServerTurn(params.turn);
		this.assignTurnId(pending, turn.id);
		this.ensureTurnStarted(pending, turn);
	}

	private handleTurnCompleted(value: unknown): void {
		const params = requiredRecord(value, "turn/completed notification");
		if (requiredString(params.threadId, "turn/completed thread id") !== this.threads.thread.id) return;
		const pending = this.pending;
		if (!pending || pending.terminal) return;
		const turn = validateCodexAppServerTurn(params.turn);
		this.assignTurnId(pending, turn.id);
		this.finishTurn(pending, turn);
	}

	private handleItemStarted(value: unknown): void {
		const params = this.scopedTurnParams(value, "item/started");
		if (!params) return;
		requiredInteger(params.record.startedAtMs, "item start timestamp");
		const item = validateCodexAppServerThreadItem(params.record.item);
		this.rememberItem(params.pending, item);
		this.startItem(params.pending, item);
	}

	private handleItemCompleted(value: unknown): void {
		const params = this.scopedTurnParams(value, "item/completed");
		if (!params) return;
		requiredInteger(params.record.completedAtMs, "item completion timestamp");
		const item = validateCodexAppServerThreadItem(params.record.item);
		this.completeItem(params.pending, item);
	}

	private handleAssistantDelta(value: unknown): void {
		const params = this.scopedTurnParams(value, "agent message delta");
		if (!params) return;
		const itemId = requiredString(params.record.itemId, "agent message item id");
		const delta = redactCodexNativeSensitiveText(requiredText(params.record.delta, "agent message delta"));
		this.ensureTurnStarted(params.pending);
		const text = `${params.pending.assistantBuffers.get(itemId) ?? ""}${delta}`;
		this.rememberItem(params.pending, { id: itemId, type: "agentMessage", text });
		const contentIndex = this.assistantIndex(params.pending, itemId);
		params.pending.assistantBuffers.set(itemId, text);
		this.emit({ type: "assistant_delta", text: delta, contentIndex });
	}

	private handleReasoningPartAdded(value: unknown): void {
		const params = this.scopedTurnParams(value, "reasoning summary part");
		if (!params) return;
		const itemId = requiredString(params.record.itemId, "reasoning item id");
		const index = requiredNonNegativeInteger(params.record.summaryIndex, "reasoning summary index");
		this.ensureReasoningStarted(params.pending, itemId);
		const parts = this.reasoningParts(params.pending.reasoningSummaryParts, itemId);
		if (!parts.has(index)) parts.set(index, "");
	}

	private handleReasoningDelta(value: unknown, indexKey: "summaryIndex" | "contentIndex", summary: boolean): void {
		const params = this.scopedTurnParams(value, "reasoning delta");
		if (!params) return;
		const itemId = requiredString(params.record.itemId, "reasoning item id");
		const contentIndex = requiredNonNegativeInteger(params.record[indexKey], `reasoning ${indexKey}`);
		const delta = redactCodexNativeSensitiveText(requiredText(params.record.delta, "reasoning delta"));
		this.ensureReasoningStarted(params.pending, itemId);
		const parts = this.reasoningParts(summary ? params.pending.reasoningSummaryParts : params.pending.reasoningContentParts, itemId);
		parts.set(contentIndex, `${parts.get(contentIndex) ?? ""}${delta}`);
		this.emit({ type: "reasoning_delta", text: delta, contentIndex });
	}

	private handleToolDelta(value: unknown, field: "delta" | "changes" | "message"): void {
		const params = this.scopedTurnParams(value, "tool update");
		if (!params) return;
		const itemId = requiredString(params.record.itemId, "tool item id");
		const item = params.pending.items.get(itemId);
		if (!item) return;
		const descriptor = this.ensureToolStarted(params.pending, item);
		if (!descriptor) return;
		const selected = params.record[field];
		if (field !== "changes") requiredText(selected, `tool ${field}`);
		else if (!Array.isArray(selected)) throw new CodexNativeTurnProtocolError("Codex file change patch update is invalid.");
		this.emit({
			type: "tool_execution_updated",
			toolCallId: itemId,
			toolName: descriptor.name,
			args: descriptor.args,
			partialResult: redactCodexNativeValue({ [field]: selected }),
		});
	}

	private handleTerminalInteraction(value: unknown): void {
		const params = this.scopedTurnParams(value, "terminal interaction");
		if (!params) return;
		const itemId = requiredString(params.record.itemId, "terminal interaction item id");
		requiredString(params.record.processId, "terminal interaction process id");
		const stdin = requiredText(params.record.stdin, "terminal interaction input");
		const item = params.pending.items.get(itemId);
		if (!item) return;
		const descriptor = this.ensureToolStarted(params.pending, item);
		if (!descriptor) return;
		this.emit({
			type: "tool_execution_updated",
			toolCallId: itemId,
			toolName: descriptor.name,
			args: descriptor.args,
			partialResult: { terminalInput: redactCodexNativeSensitiveText(stdin) },
		});
	}

	private handleUsage(value: unknown): void {
		const params = this.scopedTurnParams(value, "thread token usage");
		if (!params) return;
		params.pending.usage = validateTokenUsage(params.record.tokenUsage as CodexAppServerThreadTokenUsage);
	}

	private handleThreadStatus(value: unknown): void {
		const params = requiredRecord(value, "thread status notification");
		if (requiredString(params.threadId, "thread status thread id") !== this.threads.thread.id) return;
		this.threads.setStatus(validateCodexAppServerThreadStatus(params.status));
	}

	private handleTurnError(value: unknown): void {
		const params = this.scopedTurnParams(value, "turn error");
		if (!params) return;
		if (typeof params.record.willRetry !== "boolean") throw new CodexNativeTurnProtocolError("Codex turn retry state is invalid.");
		const message = errorMessage(params.record.error);
		const details = providerErrorDetails(params.record.error, message, params.record.willRetry);
		if (params.record.willRetry) {
			const warningDetails: PiboJsonObject = { willRetry: true };
			const code = details.providerCode ?? details.code;
			if (code) warningDetails.code = code;
			this.emit({ type: "warning", message, details: warningDetails });
			return;
		}
		params.pending.lastError = { message, details };
		this.emit({ type: "error", message, details });
	}

	private handleWarning(method: string, value: unknown): void {
		const params = requiredRecord(value, `${method} notification`);
		if (params.threadId !== undefined && params.threadId !== null) {
			if (requiredString(params.threadId, `${method} thread id`) !== this.threads.thread.id) return;
		}
		const messageValue = params.message ?? params.summary ?? params.details;
		if (typeof messageValue !== "string" || !messageValue.trim()) return;
		this.emit({
			type: "warning",
			message: safeDiagnosticText(messageValue),
			details: redactedObject({ method, summary: params.summary, details: params.details }),
		});
	}

	private handleModelRerouted(value: unknown): void {
		const params = this.scopedTurnParams(value, "model reroute");
		if (!params) return;
		const fromModel = requiredString(params.record.fromModel, "rerouted source model");
		const toModel = requiredString(params.record.toModel, "rerouted target model");
		this.emit({
			type: "warning",
			message: `Codex rerouted the active turn from ${safeDiagnosticText(fromModel)} to ${safeDiagnosticText(toModel)}.`,
			details: redactedObject({ reason: params.record.reason }),
		});
	}

	private scopedTurnParams(
		value: unknown,
		label: string,
	): { record: Record<string, unknown>; pending: PendingTurn } | undefined {
		const record = requiredRecord(value, `${label} notification`);
		if (requiredString(record.threadId, `${label} thread id`) !== this.threads.thread.id) return undefined;
		const pending = this.pending;
		if (!pending || pending.terminal) return undefined;
		const turnId = requiredString(record.turnId, `${label} turn id`);
		if (!pending.turnId || pending.turnId !== turnId) return undefined;
		return { record, pending };
	}

	private assignTurnId(pending: PendingTurn, turnId: string): void {
		if (pending.turnId && pending.turnId !== turnId) {
			throw new CodexNativeTurnProtocolError("Codex emitted events for a different active turn.");
		}
		pending.turnId = turnId;
		this.resolveTurnId(pending, turnId);
	}

	private resolveTurnId(pending: PendingTurn, turnId: string | undefined): void {
		if (pending.turnIdReadySettled) return;
		pending.turnIdReadySettled = true;
		pending.turnIdReady.resolve(turnId);
	}

	private ensureTurnStarted(pending: PendingTurn, turn?: CodexAppServerTurn): void {
		if (pending.started) return;
		pending.started = true;
		this.threads.setStatus({ type: "active", activeFlags: [] });
		this.emit({ type: "turn_started", turnId: pending.turnId ?? turn?.id });
	}

	private rememberItem(pending: PendingTurn, item: CodexAppServerThreadItem): void {
		if (!pending.items.has(item.id)) pending.itemOrder.push(item.id);
		pending.items.set(item.id, structuredClone(item));
	}

	private startItem(pending: PendingTurn, item: CodexAppServerThreadItem): void {
		this.ensureTurnStarted(pending);
		if (item.type === "reasoning") this.ensureReasoningStarted(pending, item.id);
		else if (item.type === "contextCompaction") {
			this.ensureCompactionStarted(pending);
		} else {
			this.ensureToolStarted(pending, item);
		}
	}

	private completeItem(pending: PendingTurn, item: CodexAppServerThreadItem): void {
		this.rememberItem(pending, item);
		if (pending.completedItems.has(item.id)) return;
		pending.completedItems.add(item.id);
		this.startItem(pending, item);
		if (item.type === "agentMessage" && typeof item.text === "string") {
			const text = redactCodexNativeSensitiveText(item.text);
			pending.assistantBuffers.set(item.id, text);
			pending.completedAssistantItems.add(item.id);
			this.emit({
				type: "assistant_message",
				text,
				contentIndex: this.assistantIndex(pending, item.id),
			});
			return;
		}
		if (item.type === "reasoning") {
			const summary = textArray(item.summary);
			const content = textArray(item.content);
			const assembled = summary.length > 0
				? summary.join("\n")
				: content.length > 0
					? content.join("\n")
					: this.assembledReasoning(pending, item.id);
			pending.completedReasoningItems.add(item.id);
			this.emit({ type: "reasoning_finished", text: assembled, contentIndex: 0 });
			return;
		}
		if (item.type === "contextCompaction") {
			this.finishCompaction(pending, {
				result: redactCodexNativeValue(item),
				aborted: false,
			});
			return;
		}
		const descriptor = this.ensureToolStarted(pending, item);
		if (!descriptor || pending.completedTools.has(item.id)) return;
		pending.completedTools.add(item.id);
		this.emit({
			type: "tool_execution_finished",
			toolCallId: item.id,
			toolName: descriptor.name,
			result: toolResult(item),
			isError: toolFailed(item),
		});
	}

	private ensureCompactionStarted(pending: PendingTurn): void {
		if (pending.compactionStarted) return;
		pending.compactionStarted = true;
		this.emit({ type: "compaction_start", reason: "codex_context_compaction" });
	}

	private finishCompaction(
		pending: PendingTurn,
		input: { result?: unknown; aborted: boolean; errorMessage?: string },
	): void {
		this.ensureCompactionStarted(pending);
		if (pending.compactionEnded) return;
		pending.compactionEnded = true;
		this.emit({
			type: "compaction_end",
			reason: "codex_context_compaction",
			...(input.result !== undefined ? { result: input.result } : {}),
			aborted: input.aborted,
			...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
		});
	}

	private assistantIndex(pending: PendingTurn, itemId: string): number {
		const existing = pending.assistantIndices.get(itemId);
		if (existing !== undefined) return existing;
		const selected = pending.nextAssistantIndex++;
		pending.assistantIndices.set(itemId, selected);
		return selected;
	}

	private ensureReasoningStarted(pending: PendingTurn, itemId: string): void {
		this.ensureTurnStarted(pending);
		this.rememberItem(pending, pending.items.get(itemId) ?? { id: itemId, type: "reasoning", summary: [], content: [] });
		if (pending.reasoningStartedItems.has(itemId)) return;
		pending.reasoningStartedItems.add(itemId);
		this.emit({ type: "reasoning_started", contentIndex: 0 });
	}

	private reasoningParts(store: Map<string, Map<number, string>>, itemId: string): Map<number, string> {
		let selected = store.get(itemId);
		if (!selected) {
			selected = new Map();
			store.set(itemId, selected);
		}
		return selected;
	}

	private assembledReasoning(pending: PendingTurn, itemId: string): string {
		const assemble = (parts: Map<number, string> | undefined): string => [...(parts?.entries() ?? [])]
			.sort(([left], [right]) => left - right)
			.map(([, text]) => text)
			.filter(Boolean)
			.join("\n");
		return assemble(pending.reasoningSummaryParts.get(itemId)) || assemble(pending.reasoningContentParts.get(itemId));
	}

	private ensureToolStarted(pending: PendingTurn, item: CodexAppServerThreadItem): ToolDescriptor | undefined {
		const descriptor = toolDescriptor(item);
		if (!descriptor) return undefined;
		const existing = pending.startedTools.get(item.id);
		if (existing) return existing;
		pending.startedTools.set(item.id, descriptor);
		this.emit({
			type: "tool_call",
			toolCallId: item.id,
			toolName: descriptor.name,
			args: descriptor.args,
			argsComplete: true,
		});
		this.emit({
			type: "tool_execution_started",
			toolCallId: item.id,
			toolName: descriptor.name,
			args: descriptor.args,
		});
		return descriptor;
	}

	private finishTurn(pending: PendingTurn, turn: CodexAppServerTurn): void {
		if (pending.terminal || this.pending !== pending) return;
		if (turn.status === "inProgress") throw new CodexNativeTurnProtocolError("Codex turn/completed reported an in-progress turn.");
		this.assignTurnId(pending, turn.id);
		this.ensureTurnStarted(pending, turn);
		for (const item of turn.items) this.completeItem(pending, item);
		this.finishIncompleteItems(pending, turn.status);
		if (pending.usage) this.emit({ type: "usage", usage: pending.usage });
		const persistedItems = pending.itemOrder
			.map((itemId) => pending.items.get(itemId))
			.filter((item): item is CodexAppServerThreadItem => item !== undefined);
		const persistedTurn: CodexAppServerTurn = {
			...turn,
			items: persistedItems,
			itemsView: "full",
		};
		this.threads.recordTurn(persistedTurn);
		pending.terminal = true;
		this.pending = undefined;
		if (turn.status === "failed") {
			const message = pending.lastError?.message ?? errorMessage(turn.error);
			const details = pending.lastError?.details ?? providerErrorDetails(turn.error, message, false);
			this.emit({ type: "turn_failed", message, details, turnId: turn.id });
		} else {
			this.emit({ type: "turn_completed", status: turn.status, turnId: turn.id });
		}
		pending.completion.resolve(persistedTurn);
	}

	private finishIncompleteItems(pending: PendingTurn, status: CodexAppServerTurn["status"]): void {
		if ((pending.kind === "compaction" || pending.compactionStarted) && !pending.compactionEnded) {
			this.finishCompaction(pending, {
				aborted: status === "interrupted",
				...(status === "failed" ? { errorMessage: "Codex compaction ended before item/completed." } : {}),
				result: { status },
			});
		}
		for (const [itemId, text] of pending.assistantBuffers) {
			if (pending.completedAssistantItems.has(itemId) || !text) continue;
			pending.completedAssistantItems.add(itemId);
			this.emit({ type: "assistant_message", text, contentIndex: this.assistantIndex(pending, itemId) });
		}
		for (const itemId of pending.reasoningStartedItems) {
			if (pending.completedReasoningItems.has(itemId)) continue;
			pending.completedReasoningItems.add(itemId);
			this.emit({
				type: "reasoning_finished",
				text: this.assembledReasoning(pending, itemId),
				contentIndex: 0,
			});
		}
		for (const [itemId, descriptor] of pending.startedTools) {
			if (pending.completedTools.has(itemId)) continue;
			pending.completedTools.add(itemId);
			this.emit({
				type: "tool_execution_finished",
				toolCallId: itemId,
				toolName: descriptor.name,
				result: { status, message: "Codex turn ended before item/completed." },
				isError: true,
			});
		}
	}

	private handleDiagnostic(diagnostic: CodexAppServerDiagnostic): void {
		if (this.disposed) return;
		const safeMessage = safeDiagnosticText(diagnostic.message);
		if (diagnostic.level === "warning") {
			if (this.pending) this.emit({ type: "warning", message: safeMessage, details: { code: diagnostic.code } });
			return;
		}
		const pending = this.pending;
		if (!pending || pending.terminal) return;
		this.failActiveTurn(pending, new CodexAppServerClientError("process_exited", safeMessage), runtimeSessionErrorDetails(safeMessage));
	}

	private handleProtocolFailure(error: unknown): void {
		const pending = this.pending;
		if (!pending || pending.terminal) return;
		const normalized = error instanceof Error ? error : new CodexNativeTurnProtocolError("Codex emitted an invalid turn notification.");
		const message = safeDiagnosticText(normalized.message);
		this.failActiveTurn(pending, normalized, runtimeSessionErrorDetails(message));
		void this.client.close().catch(() => {});
	}

	private failActiveTurn(pending: PendingTurn, error: Error, details: PiboSessionErrorDetails): void {
		if (pending.terminal || this.pending !== pending) return;
		pending.terminal = true;
		this.ensureTurnStarted(pending);
		this.finishIncompleteItems(pending, "failed");
		this.threads.setStatus({ type: "systemError" });
		this.pending = undefined;
		this.resolveTurnId(pending, undefined);
		const message = safeDiagnosticText(error.message || "Codex native turn failed.");
		this.emit({ type: "turn_failed", message, details, turnId: pending.turnId });
		pending.completion.reject(error);
	}
}
