import type { ModelProfile } from "../core/profiles.js";
import {
	PiboSteeringUnavailableError,
	type PiboEventListener,
	type PiboEventSource,
	type PiboExecutionEvent,
	type PiboForkCandidate,
	type PiboJsonObject,
	type PiboMessageEvent,
	type PiboOutputEvent,
	type PiboPiSessionSnapshot,
	type PiboSessionListItem,
	type PiboSessionOperationResult,
	type PiboSessionStatus,
	type PiboSessionErrorDetails,
	type PiboSessionSwitchParams,
	type PiboSessionTreeNavigateParams,
	type PiboSessionTreeResult,
	type PiboThinkingResult,
} from "../core/events.js";
import { runtimeSessionErrorDetails } from "../core/session-errors.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../core/thinking.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type { PiboGatewayActionContext } from "../plugins/types.js";
import { AgentRuntimeCapabilityUnavailableError } from "./errors.js";
import type { AgentRuntimeSemanticEvent } from "./events.js";
import type {
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimeSession,
	AgentRuntimeSessionOperationResult,
	RuntimeSessionBinding,
} from "./types.js";

const RUN_REMINDER_CAPABILITY_TOOLS = new Set([
	"pibo_run_status",
	"pibo_run_wait",
	"pibo_run_read",
	"pibo_run_cancel",
	"pibo_run_ack",
]);

type RuntimeRoutedQueueItem =
	| { kind: "message"; event: PiboMessageEvent }
	| { kind: "compact"; event: PiboExecutionEvent };

type PiboSessionOperationListener = (
	result: PiboSessionOperationResult,
	event: PiboExecutionEvent,
) => void | Promise<void>;

type PiboMessageInterruptionListener = (messages: readonly PiboMessageEvent[], reason: string) => void;

export type PiboMessagePreflight = (
	event: PiboMessageEvent,
) => Promise<{ allowed: boolean; reason?: string; code?: string }> | { allowed: boolean; reason?: string; code?: string };

export type RuntimeRoutedSessionOptions = {
	forwardLegacyPiEvents?: boolean;
	onNativeEventTelemetry?: (
		piboSessionId: string,
		event: unknown,
		context: { status?: PiboSessionStatus; activeEventId?: string },
	) => void;
	onSessionOperation?: PiboSessionOperationListener;
	onKillChildren?: (
		piboSessionId: string,
		options?: { includeRuns?: boolean },
	) => Promise<{ killed: string[]; cancelledRuns: string[] }>;
	onStateChange?: (state: { processing: boolean; queuedMessages: number; disposed: boolean }) => void;
	onMessagesInterrupted?: PiboMessageInterruptionListener;
	messagePreflight?: PiboMessagePreflight;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function runtimeCapabilityError(session: AgentRuntimeSession, capability: string): AgentRuntimeCapabilityUnavailableError {
	return new AgentRuntimeCapabilityUnavailableError(
		capability,
		session.runtimeInstanceId,
		`Runtime instance "${session.runtimeInstanceId}" does not support ${capability}.`,
	);
}

function nativeSnapshotToPiCompatibility(
	session: AgentRuntimeSession,
	snapshot: AgentRuntimeNativeSessionSnapshot,
): PiboPiSessionSnapshot {
	const nativeSessionId = snapshot.nativeSessionId;
	if (!nativeSessionId) throw runtimeCapabilityError(session, "a native session identifier");
	return {
		piSessionId: nativeSessionId,
		sessionFile: snapshot.locator?.kind === "local-file" ? snapshot.locator.value : undefined,
		leafId: snapshot.leafId ?? null,
		cwd: snapshot.cwd,
		sessionName: snapshot.name,
		parentSessionFile: snapshot.parentLocator?.kind === "local-file"
			? snapshot.parentLocator.value
			: undefined,
	};
}

function nativeOperationToPiCompatibility(
	session: AgentRuntimeSession,
	piboSessionId: string,
	result: AgentRuntimeSessionOperationResult,
): PiboSessionOperationResult {
	return {
		piboSessionId,
		previous: nativeSnapshotToPiCompatibility(session, result.previous),
		current: nativeSnapshotToPiCompatibility(session, result.current),
		cancelled: result.cancelled,
		selectedText: result.selectedText,
		editorText: result.editorText,
		summaryEntryId: result.summaryEntryId,
	};
}

function nativeSessionInfoToPiCompatibility(
	session: AgentRuntimeSession,
	info: AgentRuntimeNativeSessionInfo,
): PiboSessionListItem {
	if (!info.nativeSessionId) throw runtimeCapabilityError(session, "native session listing identifiers");
	return {
		path: info.locator?.value ?? info.nativeSessionId,
		id: info.nativeSessionId,
		cwd: info.cwd,
		name: info.name,
		parentSessionPath: info.parentLocator?.value,
		created: info.createdAt ?? "",
		modified: info.updatedAt ?? info.createdAt ?? "",
		messageCount: info.messageCount ?? 0,
		firstMessage: info.firstMessage ?? "",
	};
}

function isSessionOperationResult(value: unknown): value is PiboSessionOperationResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { piboSessionId?: unknown; current?: { piSessionId?: unknown } };
	return typeof candidate.piboSessionId === "string"
		&& Boolean(candidate.current)
		&& typeof candidate.current?.piSessionId === "string";
}

export class RuntimeRoutedSession {
	/** @deprecated Pi compatibility handle for existing direct test/TUI consumers. */
	readonly runtime: unknown;
	private readonly queue: RuntimeRoutedQueueItem[] = [];
	private processing = false;
	private disposed = false;
	private disposePromise?: Promise<void>;
	private runtimeDisposePromise?: Promise<void>;
	private forceDisposalStarted = false;
	private drainPromise?: Promise<void>;
	private activeMessage?: PiboMessageEvent;
	private activeExecutionEvent?: PiboExecutionEvent;
	private activeMessageFailed = false;
	private activeAssistantIndex?: number;
	private nextAssistantIndex = 0;
	private activeThinkingIndex?: number;
	private nextThinkingIndex = 0;
	private unsubscribe?: () => void;

	constructor(
		private readonly piboSessionId: string,
		private readonly runtimeSession: AgentRuntimeSession,
		private readonly emit: PiboEventListener,
		private readonly pluginRegistry: PiboPluginRegistry,
		private readonly options: RuntimeRoutedSessionOptions = {},
	) {
		this.runtime = runtimeSession.getNativeCompatibilityHandle?.() ?? runtimeSession;
		this.unsubscribe = runtimeSession.subscribe((event) => this.handleRuntimeEvent(event));
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
			provenance: event.provenance,
		};
		this.emit(output);
		this.notifyState();
		this.startDrain();
		return output;
	}

	async steerMessage(event: PiboMessageEvent): Promise<PiboOutputEvent> {
		this.assertActive();
		const activeMessage = this.activeMessage;
		if (!activeMessage || !this.processing || !this.runtimeSession.getStatus().streaming || !this.runtimeSession.steer) {
			throw new PiboSteeringUnavailableError();
		}
		try {
			await this.runtimeSession.steer({
				text: event.text,
				source: promptSource(event.source),
				capabilityScope: event.capabilityScope,
			});
		} catch (error) {
			throw new PiboSteeringUnavailableError(
				`The active session could not accept steering: ${errorMessage(error)}`,
				{ cause: error },
			);
		}
		const output: PiboOutputEvent = {
			type: "message_steered",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			activeEventId: activeMessage.id,
			text: event.text,
			source: event.source,
		};
		this.emit(output);
		return output;
	}

	async executeAction(event: PiboExecutionEvent): Promise<PiboOutputEvent> {
		this.assertActive();
		if (event.action === "compact") return this.enqueueCompactAction(event);
		const result = await this.runAction(event);
		if (isSessionOperationResult(result)) await this.options.onSessionOperation?.(result, event);
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

	getActiveMessage(): Pick<PiboMessageEvent, "id" | "source" | "provenance"> | undefined {
		if (!this.activeMessage) return undefined;
		return {
			id: this.activeMessage.id,
			source: this.activeMessage.source,
			provenance: this.activeMessage.provenance,
		};
	}

	getStatus(): PiboSessionStatus {
		const status = this.runtimeSession.getStatus();
		const binding = this.runtimeSession.getBinding();
		const thinkingLevel = status.reasoning?.value && isPiboThinkingLevel(status.reasoning.value)
			? status.reasoning.value
			: undefined;
		return {
			piboSessionId: this.piboSessionId,
			runtimeBinding: {
				runtimeInstanceId: binding.runtimeInstanceId,
				adapterId: binding.adapterId,
				nativeSessionId: binding.nativeSessionId,
				state: binding.state,
				protocol: binding.protocol,
				protocolVersion: binding.protocolVersion,
				adapterVersion: binding.adapterVersion,
				revision: binding.revision,
			},
			queuedMessages: this.queue.length,
			processing: this.disposed ? false : this.processing,
			streaming: this.disposed ? false : status.streaming,
			activeTools: [...status.enabledTools],
			enabledTools: [...status.enabledTools],
			cwd: status.cwd,
			disposed: this.disposed,
			thinkingLevel,
			fastMode: status.fastMode?.mode === "fast",
			retry: status.retry as PiboSessionStatus["retry"],
			warnings: status.warnings,
			errors: status.errors,
		};
	}

	async getStatusSnapshot(): Promise<PiboSessionStatus> {
		const status = this.runtimeSession.getStatusSnapshot
			? await this.runtimeSession.getStatusSnapshot()
			: this.runtimeSession.getStatus();
		return {
			...this.getStatus(),
			activeModel: status.activeModel,
			contextUsage: status.contextUsage,
			providerUsage: status.providerUsage,
			warnings: status.warnings,
			errors: status.errors,
		};
	}

	getContextUsage(): PiboSessionStatus["contextUsage"] {
		return this.runtimeSession.getStatus().contextUsage;
	}

	getActiveModel(): ModelProfile | undefined {
		return this.runtimeSession.getStatus().activeModel;
	}

	getRuntimeBinding(): RuntimeSessionBinding {
		return this.runtimeSession.getBinding();
	}

	async getProviderUsage(): Promise<PiboSessionStatus["providerUsage"]> {
		const status = this.runtimeSession.getStatusSnapshot
			? await this.runtimeSession.getStatusSnapshot()
			: this.runtimeSession.getStatus();
		return status.providerUsage;
	}

	private getActionContextUsage(): ReturnType<PiboGatewayActionContext["getContextUsage"]> {
		const usage = this.getContextUsage();
		if (!usage) return undefined;
		return {
			tokens: usage.tokens ?? null,
			contextWindow: usage.contextWindow ?? null,
			percent: usage.percent ?? null,
		} as ReturnType<PiboGatewayActionContext["getContextUsage"]>;
	}

	private async getActionProviderUsage(): ReturnType<PiboGatewayActionContext["getProviderUsage"]> {
		const usage = await this.getProviderUsage();
		if (!usage || typeof (usage as { fetchedAt?: unknown }).fetchedAt !== "string") return undefined;
		return usage as Awaited<ReturnType<PiboGatewayActionContext["getProviderUsage"]>>;
	}

	removeQueuedMessages(predicate: (event: PiboMessageEvent) => boolean): number {
		this.assertActive();
		const removedMessages: PiboMessageEvent[] = [];
		for (let index = this.queue.length - 1; index >= 0; index -= 1) {
			const item = this.queue[index];
			if (item.kind !== "message" || !predicate(item.event)) continue;
			this.queue.splice(index, 1);
			removedMessages.push(item.event);
		}
		removedMessages.reverse();
		this.notifyMessagesInterrupted(removedMessages, "queued message removed");
		return removedMessages.length;
	}

	getCurrentSession(): PiboPiSessionSnapshot {
		const getCurrentSession = this.runtimeSession.controls?.getCurrentSession;
		if (!getCurrentSession) throw runtimeCapabilityError(this.runtimeSession, "native session inspection");
		return nativeSnapshotToPiCompatibility(this.runtimeSession, getCurrentSession());
	}

	async listSessions(): Promise<PiboSessionListItem[]> {
		const listSessions = this.runtimeSession.controls?.listSessions;
		if (!listSessions) throw runtimeCapabilityError(this.runtimeSession, "native session listing");
		return (await listSessions()).map((info) => nativeSessionInfoToPiCompatibility(this.runtimeSession, info));
	}

	getForkCandidates(): PiboForkCandidate[] {
		const getForkCandidates = this.runtimeSession.controls?.getForkCandidates;
		if (!getForkCandidates) throw runtimeCapabilityError(this.runtimeSession, "native session fork candidates");
		return getForkCandidates();
	}

	async forkSession(entryId: string): Promise<PiboSessionOperationResult> {
		const forkSession = this.runtimeSession.controls?.forkSession;
		if (!forkSession) throw runtimeCapabilityError(this.runtimeSession, "native session fork");
		return nativeOperationToPiCompatibility(this.runtimeSession, this.piboSessionId, await forkSession(entryId));
	}

	async cloneSession(): Promise<PiboSessionOperationResult> {
		const cloneSession = this.runtimeSession.controls?.cloneSession;
		if (!cloneSession) throw runtimeCapabilityError(this.runtimeSession, "native session clone");
		return nativeOperationToPiCompatibility(this.runtimeSession, this.piboSessionId, await cloneSession());
	}

	getSessionTree(): PiboSessionTreeResult {
		const getSessionTree = this.runtimeSession.controls?.getSessionTree;
		if (!getSessionTree) throw runtimeCapabilityError(this.runtimeSession, "native session tree");
		const result = getSessionTree();
		return {
			current: nativeSnapshotToPiCompatibility(this.runtimeSession, result.current),
			tree: result.tree,
		};
	}

	async navigateSessionTree(params: PiboSessionTreeNavigateParams): Promise<PiboSessionOperationResult> {
		const navigate = this.runtimeSession.controls?.navigateSessionTree;
		if (!navigate) throw runtimeCapabilityError(this.runtimeSession, "native session tree navigation");
		return nativeOperationToPiCompatibility(
			this.runtimeSession,
			this.piboSessionId,
			await navigate(params as unknown as PiboJsonObject),
		);
	}

	async switchSession(params: PiboSessionSwitchParams): Promise<PiboSessionOperationResult> {
		const switchSession = this.runtimeSession.controls?.switchSession;
		if (!switchSession) throw runtimeCapabilityError(this.runtimeSession, "native session switching");
		return nativeOperationToPiCompatibility(
			this.runtimeSession,
			this.piboSessionId,
			await switchSession(params as unknown as PiboJsonObject),
		);
	}

	async setModel(model: ModelProfile): Promise<ModelProfile> {
		const setModel = this.runtimeSession.controls?.setModel;
		if (!setModel) throw runtimeCapabilityError(this.runtimeSession, "in-session model switching");
		return await setModel(model);
	}

	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult {
		const setReasoning = this.runtimeSession.controls?.setReasoning;
		if (!setReasoning) throw runtimeCapabilityError(this.runtimeSession, "reasoning-level selection");
		const result = setReasoning(level);
		return {
			level: typeof result.value === "string" && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result.availableValues.filter(isPiboThinkingLevel),
			supported: result.supported,
		};
	}

	cycleThinkingLevel(): PiboThinkingResult {
		const cycleReasoning = this.runtimeSession.controls?.cycleReasoning;
		if (!cycleReasoning) throw runtimeCapabilityError(this.runtimeSession, "reasoning-level cycling");
		const result = cycleReasoning();
		return {
			level: typeof result.value === "string" && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result.availableValues.filter(isPiboThinkingLevel),
			supported: result.supported,
		};
	}

	getFastMode(): { mode: "fast" | "normal"; supported: boolean } {
		const getFastMode = this.runtimeSession.controls?.getFastMode;
		return getFastMode ? getFastMode() : { mode: "normal", supported: false };
	}

	setFastMode(enabled: boolean): { mode: "fast" | "normal"; supported: boolean; changed: boolean } {
		const setFastMode = this.runtimeSession.controls?.setFastMode;
		if (!setFastMode) return { mode: "normal", supported: false, changed: false };
		const result = setFastMode(enabled);
		return { ...result, changed: result.changed ?? false };
	}

	async compact(customInstructions?: string): ReturnType<PiboGatewayActionContext["compact"]> {
		const compact = this.runtimeSession.controls?.compact;
		if (!compact) throw runtimeCapabilityError(this.runtimeSession, "compaction");
		return await compact(customInstructions) as Awaited<ReturnType<PiboGatewayActionContext["compact"]>>;
	}

	async dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposePromise = this.disposeUnsafe();
		return this.disposePromise;
	}

	forceDispose(reason = "session disposal timed out"): void {
		this.transitionToDisposed(reason);
		if (this.forceDisposalStarted) return;
		this.forceDisposalStarted = true;
		void this.runtimeSession.abort().catch(() => {});
		void this.disposeRuntime().catch(() => {});
	}

	async kill(): Promise<string> {
		this.notifyMessagesInterrupted(this.activeAndQueuedMessages(), "session killed");
		this.queue.length = 0;
		this.notifyState();
		await this.runtimeSession.abort();
		return this.piboSessionId;
	}

	async cancelMessage(eventId: string): Promise<boolean> {
		this.assertActive();
		const queuedIndex = this.queue.findIndex((item) => item.event.id === eventId);
		if (queuedIndex >= 0) {
			const [removed] = this.queue.splice(queuedIndex, 1);
			if (removed?.kind === "message") this.notifyMessagesInterrupted([removed.event], "message cancelled");
			this.notifyState();
			return true;
		}
		if (this.activeMessage?.id === eventId) {
			this.notifyMessagesInterrupted([this.activeMessage], "message cancelled");
			await this.runtimeSession.abort();
			return true;
		}
		return false;
	}

	private handleRuntimeEvent(event: AgentRuntimeSemanticEvent): void {
		switch (event.type) {
			case "assistant_delta":
				this.emit(this.withActiveMessage({
					type: "assistant_delta",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "assistant_message":
				this.emit(this.withActiveMessage({
					type: "assistant_message",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_started":
				this.emit(this.withActiveMessage({
					type: "thinking_started",
					piboSessionId: this.piboSessionId,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_delta":
				this.emit(this.withActiveMessage({
					type: "thinking_delta",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "reasoning_finished":
				this.emit(this.withActiveMessage({
					type: "thinking_finished",
					piboSessionId: this.piboSessionId,
					text: event.text,
					contentIndex: event.contentIndex,
				}));
				return;
			case "tool_call":
				this.emit(this.withActiveMessage({ ...event, type: "tool_call", piboSessionId: this.piboSessionId }));
				return;
			case "tool_execution_started":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_started", piboSessionId: this.piboSessionId }));
				return;
			case "tool_execution_updated":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_updated", piboSessionId: this.piboSessionId }));
				return;
			case "tool_execution_finished":
				this.emit(this.withActiveMessage({ ...event, type: "tool_execution_finished", piboSessionId: this.piboSessionId }));
				return;
			case "usage":
				this.emit(this.withActiveMessage({
					type: "assistant_usage",
					piboSessionId: this.piboSessionId,
					inputTokens: event.usage.inputTokens,
					outputTokens: event.usage.outputTokens,
					cacheReadTokens: event.usage.cacheReadTokens,
					cacheWriteTokens: event.usage.cacheWriteTokens,
					totalTokens: event.usage.totalTokens,
				}));
				return;
			case "compaction_start":
				this.emit(this.withActiveMessage({
					type: "compaction_start",
					piboSessionId: this.piboSessionId,
					reason: event.reason,
				}));
				return;
			case "compaction_end":
				if (event.result && !event.aborted) this.resetContentIndices();
				this.emit(this.withActiveMessage({
					type: "compaction_end",
					piboSessionId: this.piboSessionId,
					reason: event.reason,
					result: event.result,
					aborted: event.aborted,
					errorMessage: event.errorMessage,
				}));
				return;
			case "error":
				this.emitRuntimeError(event.message, event.details);
				return;
			case "turn_failed":
				this.emitRuntimeError(event.message, event.details);
				return;
			case "native_event":
				this.options.onNativeEventTelemetry?.(this.piboSessionId, event.event, {
					status: this.getStatus(),
					activeEventId: this.activeMessage?.id ?? this.activeExecutionEvent?.id,
				});
				if (
					this.options.forwardLegacyPiEvents
					&& this.runtimeSession.compatibility?.productRawEventType === "pi_event"
				) {
					this.emit({ type: "pi_event", piboSessionId: this.piboSessionId, event: event.event });
				}
				return;
			default:
				return;
		}
	}

	private emitRuntimeError(message: string, details?: PiboSessionErrorDetails): void {
		if (this.activeMessageFailed) return;
		this.activeMessageFailed = true;
		this.emit(this.withActiveMessage({
			type: "session_error",
			piboSessionId: this.piboSessionId,
			error: message,
			errorDetails: details ?? runtimeSessionErrorDetails(message),
			provenance: this.activeMessage?.provenance,
		}));
	}

	private startDrain(): void {
		if (this.drainPromise) return;
		const drain = this.drain();
		this.drainPromise = drain;
		void drain.finally(() => {
			if (this.drainPromise === drain) this.drainPromise = undefined;
		});
	}

	private async drain(): Promise<void> {
		if (this.processing || this.disposed) return;
		this.processing = true;
		this.notifyState();
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const item = this.queue.shift()!;
				this.notifyState();
				if (item.kind === "compact") await this.processQueuedCompact(item.event);
				else await this.processQueuedMessage(item.event);
			}
		} finally {
			this.processing = false;
			this.notifyState();
		}
	}

	private async processQueuedMessage(event: PiboMessageEvent): Promise<void> {
		try {
			const preflight = await this.options.messagePreflight?.(event);
			if (this.disposed) return;
			if (preflight && !preflight.allowed) {
				this.emit({
					type: "session_error",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					error: preflight.reason ?? "Queued message is no longer authorized",
					errorDetails: {
						category: "loop_lifecycle",
						errorClass: "runtime_abort",
						code: preflight.code ?? "message_preflight_rejected",
						origin: "runtime",
						retryable: false,
					},
					provenance: event.provenance,
				});
				return;
			}
			this.emit({
				type: "message_started",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				text: event.text,
				source: event.source,
				provenance: event.provenance,
			});
			this.activeMessage = event;
			this.activeMessageFailed = false;
			this.resetContentIndices();
			await this.runtimeSession.prompt({
				text: event.text,
				source: promptSource(event.source),
				capabilityScope: event.capabilityScope,
			});
			if (this.disposed) return;
			if (!this.activeMessageFailed) {
				this.emit({
					type: "message_finished",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					source: event.source,
					provenance: event.provenance,
				});
			}
		} catch (error) {
			if (this.disposed) return;
			if (!this.activeMessageFailed) {
				const message = errorMessage(error);
				this.emit({
					type: "session_error",
					piboSessionId: this.piboSessionId,
					eventId: event.id,
					error: message,
					errorDetails: runtimeSessionErrorDetails(message),
					provenance: event.provenance,
				});
			}
		} finally {
			this.activeMessage = undefined;
			this.activeMessageFailed = false;
			this.resetContentIndices();
		}
	}

	private async processQueuedCompact(event: PiboExecutionEvent): Promise<void> {
		this.activeExecutionEvent = event;
		try {
			const result = await this.runAction(event);
			if (this.disposed) return;
			this.emit({
				type: "execution_result",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				action: event.action,
				result,
			});
		} catch (error) {
			if (this.disposed) return;
			const message = errorMessage(error);
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: event.id,
				error: message,
				errorDetails: runtimeSessionErrorDetails(message),
			});
		} finally {
			this.activeExecutionEvent = undefined;
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
		this.notifyState();
		this.startDrain();
		return output;
	}

	private async runAction(event: PiboExecutionEvent): Promise<unknown> {
		const gatewayAction = this.pluginRegistry.getGatewayAction(event.action);
		if (!gatewayAction) throw new Error(`Unknown execution action "${event.action}"`);
		return await gatewayAction.execute(
			{
				piboSessionId: this.piboSessionId,
				getStatus: () => this.getStatus(),
				getStatusSnapshot: () => this.getStatusSnapshot(),
				getContextUsage: () => this.getActionContextUsage(),
				getActiveModel: () => this.getActiveModel(),
				getProviderUsage: () => this.getActionProviderUsage(),
				clearQueue: () => this.clearQueue(),
				abort: async () => {
					if (this.activeMessage) this.notifyMessagesInterrupted([this.activeMessage], "abort requested");
					await this.runtimeSession.abort();
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
					if (this.options.onKillChildren) {
						const children = await this.options.onKillChildren(this.piboSessionId);
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
				killAll: async () => {
					const killed = [await this.kill()];
					let cancelledRuns: string[] = [];
					if (this.options.onKillChildren) {
						const children = await this.options.onKillChildren(this.piboSessionId, { includeRuns: true });
						killed.push(...children.killed);
						cancelledRuns = children.cancelledRuns;
					}
					return { killed, cancelledRuns };
				},
			},
			event,
		);
	}

	private getThinkingResult(): PiboThinkingResult {
		const result = this.runtimeSession.controls?.getReasoning?.();
		return {
			level: result?.value && isPiboThinkingLevel(result.value) ? result.value : "off",
			availableLevels: result?.availableValues.filter(isPiboThinkingLevel) ?? [],
			supported: result?.supported ?? false,
		};
	}

	private transitionToDisposed(reason: string): boolean {
		if (this.disposed) return false;
		const activeMessage = this.activeMessage;
		this.notifyMessagesInterrupted(this.activeAndQueuedMessages(), reason);
		if (activeMessage) {
			const error = `Session disposed while a message was active: ${reason}`;
			this.emit({
				type: "session_error",
				piboSessionId: this.piboSessionId,
				eventId: activeMessage.id,
				error,
				errorDetails: runtimeSessionErrorDetails(error),
			});
		}
		this.queue.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		this.processing = false;
		this.notifyState();
		return true;
	}

	private disposeRuntime(): Promise<void> {
		if (!this.runtimeDisposePromise) {
			try {
				this.runtimeDisposePromise = Promise.resolve(this.runtimeSession.dispose());
			} catch (error) {
				this.runtimeDisposePromise = Promise.reject(error);
			}
		}
		return this.runtimeDisposePromise;
	}

	private async disposeUnsafe(): Promise<void> {
		if (!this.transitionToDisposed("session disposed")) return;
		try {
			await Promise.allSettled([this.runtimeSession.abort()]);
			await this.drainPromise;
		} finally {
			await this.disposeRuntime();
		}
	}

	private clearQueue(): number {
		const cleared = this.queue.length;
		const removedMessages = this.queue.flatMap((item) => item.kind === "message" ? [item.event] : []);
		this.queue.length = 0;
		this.notifyMessagesInterrupted(removedMessages, "queue cleared");
		this.notifyState();
		return cleared;
	}

	private activeAndQueuedMessages(): PiboMessageEvent[] {
		const messages = this.queue.flatMap((item) => item.kind === "message" ? [item.event] : []);
		return this.activeMessage ? [this.activeMessage, ...messages] : messages;
	}

	private notifyMessagesInterrupted(messages: readonly PiboMessageEvent[], reason: string): void {
		if (messages.length === 0) return;
		this.options.onMessagesInterrupted?.(messages, reason);
	}

	private notifyState(): void {
		this.options.onStateChange?.({
			processing: this.processing,
			queuedMessages: this.queue.length,
			disposed: this.disposed,
		});
	}

	private resetContentIndices(): void {
		this.activeAssistantIndex = undefined;
		this.nextAssistantIndex = 0;
		this.activeThinkingIndex = undefined;
		this.nextThinkingIndex = 0;
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
			if (this.activeAssistantIndex === undefined) this.nextAssistantIndex += 1;
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
			this.activeMessage?.id
			&& (
				event.type === "assistant_usage"
				|| event.type === "compaction_start"
				|| event.type === "compaction_end"
				|| event.type === "tool_call"
				|| event.type === "tool_execution_started"
				|| event.type === "tool_execution_updated"
				|| event.type === "tool_execution_finished"
				|| event.type === "session_error"
				|| event.type === "execution_result"
			)
		) {
			return { ...event, eventId: this.activeMessage.id };
		}
		return event;
	}

	private assertActive(): void {
		if (this.disposed) throw new Error(`Session "${this.piboSessionId}" has been disposed`);
	}
}

export function runtimeReminderToolNames(toolNames: readonly string[]): string[] {
	return toolNames.filter((name) => RUN_REMINDER_CAPABILITY_TOOLS.has(name));
}
