import type { PiboOutputEvent, PiboEventSource, PiboJsonObject, PiboMessageEvent, PiboSessionStatus } from "./events.js";
import type { PiboSession } from "../sessions/store.js";
import {
	BestEffortTelemetryService,
	type StoredTelemetryProviderRequest,
	type TelemetryPhaseName,
	type TelemetryPhaseStatus,
	type TelemetryProviderEventParseStatus,
	type TelemetryProviderRequestStatus,
	type TelemetryStore,
	type TelemetryToolArgsParseStatus,
	type TelemetryToolCallStatus,
	type TelemetryTurnSource,
	type TelemetryTurnStatus,
} from "../data/telemetry.js";
import type { AsyncTelemetryWriter } from "../data/telemetry-writer.js";
import { isTerminalProviderStatus } from "./provider-telemetry.js";

type RuntimeTelemetryContext = {
	session?: PiboSession;
	status?: PiboSessionStatus;
	activeEventId?: string;
	at?: string;
	atMs?: number;
};

export type ProviderEventTelemetryMode = "aggregate" | "detailed";

export type PiboRuntimeTelemetryRecorderOptions = {
	/**
	 * Provider raw stream events are high-volume. Keep aggregate counters by default;
	 * persist per-event rows only for short, explicit debugging sessions.
	 */
	providerEventMode?: ProviderEventTelemetryMode;
	/** Minimum interval between persisted progress snapshots for one active turn. */
	progressFlushIntervalMs?: number;
	/** Optional router-wide writer used to serialize and batch telemetry persistence. */
	writer?: AsyncTelemetryWriter;
};

type PiProviderEventSummary = {
	eventType: string;
	messageEnded: boolean;
	assistantEventType?: string;
	parseStatus: TelemetryProviderEventParseStatus;
	normalizedType?: string;
	byteSize: number;
	itemId?: string;
	toolCallId?: string;
	toolName?: string;
	argsBytes?: number;
	safeArgKeys?: string[];
	safeFields: PiboJsonObject;
	upstreamResponseId?: string;
};

type TurnContext = {
	turnId: string;
	eventId?: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	source: TelemetryTurnSource;
	queueDepth?: number;
};

type PendingProviderProgress = {
	lastRawEventAt?: string;
	lastNormalizedEventAt?: string;
	upstreamResponseId?: string;
	rawEventCount: number;
	normalizedEventCount: number;
	parseErrorCount: number;
	unknownEventCount: number;
	bytesReceived: number;
	eventTypeCounts: Record<string, number>;
};

const TERMINAL_TURN_STATUSES = new Set<TelemetryTurnStatus>(["ok", "error", "aborted", "timeout"]);
const DEFAULT_PROGRESS_FLUSH_INTERVAL_MS = 1_000;

export class PiboRuntimeTelemetryRecorder {
	private readonly telemetry: BestEffortTelemetryService;
	private readonly providerEventMode: ProviderEventTelemetryMode;
	private readonly progressFlushIntervalMs: number;
	private readonly writer?: AsyncTelemetryWriter;
	private readonly pendingProviderProgress = new Map<string, PendingProviderProgress>();
	private readonly providerRequestCache = new Map<string, StoredTelemetryProviderRequest>();
	private readonly lastProviderFlushAtMs = new Map<string, number>();
	private readonly lastProgressWriteAtMs = new Map<string, number>();

	constructor(
		private readonly store?: TelemetryStore,
		private readonly onError?: (error: unknown) => void,
		options: PiboRuntimeTelemetryRecorderOptions = {},
	) {
		this.telemetry = new BestEffortTelemetryService(store, onError);
		this.providerEventMode = options.providerEventMode ?? "aggregate";
		this.writer = options.writer;
		const progressFlushIntervalMs = options.progressFlushIntervalMs;
		this.progressFlushIntervalMs = typeof progressFlushIntervalMs === "number" && Number.isFinite(progressFlushIntervalMs) && progressFlushIntervalMs >= 0
			? progressFlushIntervalMs
			: DEFAULT_PROGRESS_FLUSH_INTERVAL_MS;
	}

	recordOutput(event: PiboOutputEvent, context: RuntimeTelemetryContext = {}): void {
		if (!this.store) return;
		const captured = captureTelemetryContext(context);
		const capturedEvent = telemetryOutputEventSnapshot(event);
		this.schedule(() => this.recordOutputUnsafe(capturedEvent, captured));
	}

	recordPiEvent(piboSessionId: string, event: unknown, context: RuntimeTelemetryContext = {}): void {
		if (!this.store) return;
		const summary = providerEventSummaryForPiEvent(event);
		if (!summary) return;
		const captured = captureTelemetryContext(context);
		this.schedule(() => this.recordPiEventSummaryUnsafe(piboSessionId, summary, captured));
	}

	recordMessagesInterrupted(messages: readonly PiboMessageEvent[], context: RuntimeTelemetryContext = {}, reason = "message interrupted"): void {
		if (!this.store) return;
		const captured = captureTelemetryContext(context);
		const interrupted = messages.flatMap((message) => message.id ? [{ piboSessionId: message.piboSessionId, eventId: message.id }] : []);
		this.schedule(() => {
			for (const message of interrupted) {
				this.recordTurnTerminal(message, captured, "aborted", "abort", reason, "runtime_abort");
			}
		});
	}

	private schedule(write: () => void): void {
		const guarded = () => {
			try {
				write();
			} catch (error) {
				this.onError?.(error);
			}
		};
		if (this.writer) this.writer.enqueue(guarded, this.onError);
		else guarded();
	}

	private recordOutputUnsafe(event: PiboOutputEvent, context: RuntimeTelemetryContext): void {
		switch (event.type) {
			case "message_queued":
				this.recordMessageQueued(event, context);
				return;
			case "message_started":
				this.recordMessageStarted(event, context);
				return;
			case "message_finished":
				this.recordMessageFinished(event, context);
				return;
			case "assistant_delta":
				this.recordProviderStreamProgress(event, context, "assistant_text", "assistant text progress");
				return;
			case "assistant_message":
				this.recordProviderStreamProgress(event, context, "assistant_text", "assistant text progress", true);
				return;
			case "thinking_started":
				this.recordProviderStreamProgress(event, context, "reasoning", "reasoning progress", true);
				return;
			case "thinking_delta":
				this.recordProviderStreamProgress(event, context, "reasoning", "reasoning progress");
				return;
			case "thinking_finished": {
				this.recordProviderStreamProgress(event, context, "reasoning", "reasoning finished", true);
				const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context) ?? this.activeTurnContext(event.piboSessionId, context);
				this.finishOpenPhasesByName(turn?.turnId, "reasoning", "ok", telemetryTimestamp(context));
				return;
			}
			case "tool_call":
				this.recordToolArgsPhase(event, context);
				return;
			case "tool_execution_started":
				this.recordToolExecutionPhase(event, context, true);
				return;
			case "tool_execution_updated":
				this.recordToolExecutionPhase(event, context, false);
				return;
			case "tool_execution_finished":
				this.recordToolExecutionFinished(event, context);
				return;
			case "session_error": {
				const status = terminalTurnStatusForSessionError(event);
				this.recordTurnTerminal(event, context, status, status === "aborted" ? "abort" : status === "timeout" ? "timeout" : "error", event.error, event.errorDetails?.category ?? event.errorDetails?.errorClass);
				return;
			}
			case "execution_result":
				this.recordExecutionResult(event, context);
				return;
			default:
				return;
		}
	}

	private recordPiEventSummaryUnsafe(piboSessionId: string, summary: PiProviderEventSummary, context: RuntimeTelemetryContext): void {
		const turn = context.activeEventId
			? this.progressTurnContextForEvent(piboSessionId, context.activeEventId, context)
			: this.activeTurnContext(piboSessionId, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		const nowMs = telemetryTimestampMs(context);
		if (summary.assistantEventType === "start") {
			this.flushProviderProgress(turn.turnId, now, { force: true, includeLatest: true, nowMs });
			this.clearProviderProgress(turn.turnId);
		}
		const providerRequest = this.providerEventMode === "detailed"
			? this.providerRequestForTurn(turn.turnId, { includeLatest: summary.messageEnded, refresh: summary.messageEnded })
			: this.accumulateProviderEvent(turn, summary, now, nowMs);
		if (!providerRequest) {
			if (summary.messageEnded) this.clearProviderProgress(turn.turnId);
			return;
		}
		if (this.providerEventMode === "detailed") {
			this.telemetry.appendProviderEventSummary({
				providerRequestId: providerRequest.providerRequestId,
				piboSessionId: turn.piboSessionId,
				turnId: turn.turnId,
				phaseId: providerRequest.phaseId,
				receivedAt: now,
				eventType: summary.eventType,
				byteSize: summary.byteSize,
				parseStatus: summary.parseStatus,
				normalizedType: summary.normalizedType,
				normalizedEventDelta: 0,
				eventId: turn.eventId,
				itemId: summary.itemId,
				toolCallId: summary.toolCallId,
				safeFields: summary.safeFields,
			});
		}
		if (summary.toolCallId && summary.assistantEventType?.startsWith("toolcall_")) {
			const forceToolProgress = summary.assistantEventType !== "toolcall_delta";
			if (this.shouldPersistProgress(`${turn.turnId}:tool_args:${summary.toolCallId}`, forceToolProgress, nowMs)) {
				this.recordPiToolCallProgress(turn, providerRequest.providerRequestId, summary, now);
			}
		}
		if (!summary.messageEnded && !isTerminalProviderStatus(providerRequest.status) && !summary.normalizedType && this.shouldPersistProgress(`${turn.turnId}:provider_stream:${providerRequest.providerRequestId}`, false, nowMs)) {
			this.startOrProgressPhase(turn, "provider_stream", now, "provider event metadata", { providerRequestId: providerRequest.providerRequestId });
		}
		if (summary.messageEnded) this.clearProviderProgress(turn.turnId);
	}

	private recordMessageQueued(
		event: Extract<PiboOutputEvent, { type: "message_queued" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, event.source, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		const queueDepth = event.queuedMessages;
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			inputEventId: turn.eventId,
			eventId: turn.eventId,
			source: turn.source,
			status: "queued",
			currentPhase: "queued",
			queuedAt: now,
			lastProgressAt: now,
			queuedBehind: Math.max(0, queueDepth - 1),
			queueDepth,
			summary: "message queued",
			metadata: sessionMetadata(context.session),
		});
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, "queued"),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: "queued",
			status: "open",
			startedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: "waiting in routed-session queue",
		});
	}

	private recordMessageStarted(
		event: Extract<PiboOutputEvent, { type: "message_started" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, event.source, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		this.telemetry.finishPhase(phaseId(turn.turnId, "queued"), { status: "ok", endedAt: now, lastProgressAt: now });
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, "message_started"),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: "message_started",
			status: "open",
			startedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: "routed message started",
		});
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			inputEventId: turn.eventId,
			eventId: turn.eventId,
			source: turn.source,
			status: "running",
			currentPhase: "message_started",
			startedAt: now,
			lastProgressAt: now,
			queueDepth: turn.queueDepth,
			summary: "message processing started",
			metadata: sessionMetadata(context.session),
		});
	}

	private recordMessageFinished(
		event: Extract<PiboOutputEvent, { type: "message_finished" }>,
		context: RuntimeTelemetryContext,
	): void {
		this.recordTurnTerminal(event, context, "ok", "finish", "message finished");
	}

	private recordExecutionResult(
		event: Extract<PiboOutputEvent, { type: "execution_result" }>,
		context: RuntimeTelemetryContext,
	): void {
		if (event.action === "abort" || event.action === "dispose" || event.action === "kill" || event.action === "kill_all") {
			this.recordTurnTerminal(event, context, "aborted", "abort", `${event.action} requested`);
			return;
		}
	}

	private recordProviderStreamProgress(
		event: Pick<PiboOutputEvent, "piboSessionId"> & { eventId?: string },
		context: RuntimeTelemetryContext,
		phaseName: TelemetryPhaseName,
		summary: string,
		force = false,
	): void {
		const turn = event.eventId
			? this.progressTurnContextForEvent(event.piboSessionId, event.eventId, context)
			: this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		const providerRequest = this.accumulateNormalizedProviderProgress(turn, now, force, telemetryTimestampMs(context));
		const progressKey = `${turn.turnId}:${phaseName}:${providerRequest?.providerRequestId ?? "none"}`;
		if (!this.shouldPersistProgress(progressKey, force, telemetryTimestampMs(context))) return;
		const storedTurn = this.store?.getTurn(turn.turnId);
		if (storedTurn && TERMINAL_TURN_STATUSES.has(storedTurn.status)) {
			this.clearTurnProgress(turn.turnId);
			return;
		}
		this.closeOpenPhasesByName(turn.turnId, "message_started", "ok", now);
		const providerStreamKey = `${turn.turnId}:provider_stream:${providerRequest?.providerRequestId ?? "none"}`;
		if ((!providerRequest || !isTerminalProviderStatus(providerRequest.status)) && this.shouldPersistProgress(providerStreamKey, force, telemetryTimestampMs(context))) {
			this.startOrProgressPhase(turn, "provider_stream", now, "normalized provider stream progress", { providerRequestId: providerRequest?.providerRequestId });
		}
		this.startOrProgressPhase(turn, phaseName, now, summary, { updateTurn: true, providerRequestId: providerRequest?.providerRequestId });
	}

	private recordToolArgsPhase(
		event: Extract<PiboOutputEvent, { type: "tool_call" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context) ?? this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		this.closeOpenPhasesByName(turn.turnId, "message_started", "ok", now);
		this.closeOpenPhasesByName(turn.turnId, "assistant_text", "ok", now);
		this.closeOpenPhasesByName(turn.turnId, "reasoning", "ok", now);
		const providerRequest = this.accumulateNormalizedProviderProgress(turn, now, true, telemetryTimestampMs(context))
			?? this.providerRequestForTurn(turn.turnId, { includeLatest: true });
		this.upsertToolCallArgs(turn, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			argsComplete: event.argsComplete,
			providerRequestId: providerRequest?.providerRequestId,
			now,
		});
		this.startOrProgressPhase(turn, "provider_stream", now, "normalized provider stream progress", { providerRequestId: providerRequest?.providerRequestId });
		const phase = this.startOrProgressPhase(turn, "tool_args", now, event.argsComplete ? "tool arguments complete" : "tool arguments in progress", {
			providerRequestId: providerRequest?.providerRequestId,
			toolCallId: event.toolCallId,
			updateTurn: true,
		});
		if (event.argsComplete && phase) {
			this.telemetry.finishPhase(phase.phaseId, { status: "ok", endedAt: now, lastProgressAt: now, summary: "tool arguments complete" });
		}
	}

	private recordToolExecutionPhase(
		event: Extract<PiboOutputEvent, { type: "tool_execution_started" | "tool_execution_updated" }>,
		context: RuntimeTelemetryContext,
		force: boolean,
	): void {
		const turn = event.eventId
			? this.progressTurnContextForEvent(event.piboSessionId, event.eventId, context)
			: this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		if (!this.shouldPersistProgress(`${turn.turnId}:tool_execution:${event.toolCallId}`, force, telemetryTimestampMs(context))) return;
		const storedTurn = this.store?.getTurn(turn.turnId);
		if (storedTurn && TERMINAL_TURN_STATUSES.has(storedTurn.status)) {
			this.clearTurnProgress(turn.turnId);
			return;
		}
		const now = telemetryTimestamp(context);
		const existing = this.store?.getToolCall(event.toolCallId);
		const args = toolArgsMetadata(event.args, true);
		const providerRequestId = existing?.providerRequestId ?? this.latestProviderRequestForTurn(turn.turnId)?.providerRequestId;
		this.closeOpenPhasesByName(turn.turnId, "tool_args", "ok", now);
		this.telemetry.upsertToolCall({
			toolCallId: event.toolCallId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			turnId: turn.turnId,
			providerRequestId,
			providerItemId: itemIdFromToolCallId(event.toolCallId),
			toolName: event.toolName,
			status: "executing",
			argsStartedAt: existing?.argsStartedAt ?? now,
			firstDeltaAt: existing?.firstDeltaAt ?? (args.argsBytes > 0 ? now : undefined),
			lastDeltaAt: existing?.lastDeltaAt ?? (args.argsBytes > 0 ? now : undefined),
			argsCompletedAt: existing?.argsCompletedAt ?? now,
			executionStartedAt: existing?.executionStartedAt ?? now,
			argsBytes: Math.max(existing?.argsBytes ?? 0, args.argsBytes),
			parseStatus: args.parseStatus === "empty" ? existing?.parseStatus ?? "complete" : args.parseStatus,
			safeArgKeys: args.safeArgKeys.length > 0 ? args.safeArgKeys : existing?.safeArgKeys,
			eventId: turn.eventId,
		});
		this.startOrProgressPhase(turn, "tool_execution", now, event.type === "tool_execution_started" ? "tool execution started" : "tool execution progress", {
			toolCallId: event.toolCallId,
			updateTurn: true,
		});
	}

	private recordToolExecutionFinished(
		event: Extract<PiboOutputEvent, { type: "tool_execution_finished" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context) ?? this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const now = telemetryTimestamp(context);
		const existing = this.store?.getToolCall(event.toolCallId);
		const executionStartedAt = existing?.executionStartedAt;
		this.telemetry.upsertToolCall({
			toolCallId: event.toolCallId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			turnId: turn.turnId,
			providerRequestId: existing?.providerRequestId ?? this.latestProviderRequestForTurn(turn.turnId)?.providerRequestId,
			providerItemId: existing?.providerItemId ?? itemIdFromToolCallId(event.toolCallId),
			toolName: event.toolName,
			status: event.isError ? "error" : "ok",
			executionStartedAt,
			executionEndedAt: now,
			durationMs: durationMs(executionStartedAt, now),
			argsBytes: existing?.argsBytes ?? 0,
			parseStatus: existing?.parseStatus ?? "empty",
			safeArgKeys: existing?.safeArgKeys ?? [],
			eventId: turn.eventId,
			errorCategory: event.isError ? "tool_error" : undefined,
			errorMessage: event.isError ? safeErrorMessage(event.result) : undefined,
		});
		this.startOrProgressPhase(turn, "tool_execution", now, event.isError ? "tool execution failed" : "tool execution finished", {
			toolCallId: event.toolCallId,
			updateTurn: true,
		});
		this.closeOpenPhasesByName(turn.turnId, "tool_execution", event.isError ? "error" : "ok", now, event.isError ? "tool execution failed" : "tool execution finished");
	}

	private recordPiToolCallProgress(turn: TurnContext, providerRequestId: string, summary: PiProviderEventSummary, now: string): void {
		if (!summary.toolCallId) return;
		const existing = this.store?.getToolCall(summary.toolCallId);
		const argsBytes = Math.max(existing?.argsBytes ?? 0, summary.argsBytes ?? 0, numericSafeField(summary.safeFields.deltaBytes));
		const status = toolStatusForPiAssistantEvent(summary.assistantEventType, argsBytes, existing?.status);
		const parseStatus = summary.assistantEventType === "toolcall_end" ? "complete" : argsBytes > 0 ? existing?.parseStatus === "complete" ? "complete" : "partial" : existing?.parseStatus ?? "empty";
		this.telemetry.upsertToolCall({
			toolCallId: summary.toolCallId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			turnId: turn.turnId,
			providerRequestId,
			providerItemId: summary.itemId ?? itemIdFromToolCallId(summary.toolCallId),
			toolName: summary.toolName ?? existing?.toolName ?? "tool",
			status,
			argsStartedAt: existing?.argsStartedAt ?? now,
			firstDeltaAt: existing?.firstDeltaAt ?? (argsBytes > 0 ? now : undefined),
			lastDeltaAt: argsBytes > 0 ? now : existing?.lastDeltaAt,
			argsCompletedAt: summary.assistantEventType === "toolcall_end" ? now : existing?.argsCompletedAt,
			argsBytes,
			parseStatus,
			safeArgKeys: summary.safeArgKeys && summary.safeArgKeys.length > 0 ? summary.safeArgKeys : existing?.safeArgKeys ?? [],
			eventId: turn.eventId,
		});
	}

	private upsertToolCallArgs(
		turn: TurnContext,
		input: { toolCallId: string; toolName: string; args: unknown; argsComplete: boolean; providerRequestId?: string; now: string },
	): void {
		const existing = this.store?.getToolCall(input.toolCallId);
		const args = toolArgsMetadata(input.args, input.argsComplete);
		const hasArgsProgress = args.argsBytes > 0;
		this.telemetry.upsertToolCall({
			toolCallId: input.toolCallId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			turnId: turn.turnId,
			providerRequestId: input.providerRequestId,
			providerItemId: itemIdFromToolCallId(input.toolCallId),
			toolName: input.toolName,
			status: input.argsComplete ? "args_complete" : hasArgsProgress ? "args_partial" : "args_started",
			argsStartedAt: existing?.argsStartedAt ?? input.now,
			firstDeltaAt: existing?.firstDeltaAt ?? (hasArgsProgress ? input.now : undefined),
			lastDeltaAt: hasArgsProgress ? input.now : existing?.lastDeltaAt,
			argsCompletedAt: input.argsComplete ? input.now : existing?.argsCompletedAt,
			argsBytes: Math.max(existing?.argsBytes ?? 0, args.argsBytes),
			parseStatus: args.parseStatus,
			safeArgKeys: args.safeArgKeys.length > 0 ? args.safeArgKeys : existing?.safeArgKeys ?? [],
			eventId: turn.eventId,
		});
	}

	private recordTurnTerminal(
		event: Pick<PiboOutputEvent, "piboSessionId"> & { eventId?: string },
		context: RuntimeTelemetryContext,
		status: Extract<TelemetryTurnStatus, "ok" | "error" | "aborted" | "timeout">,
		phaseName: TelemetryPhaseName,
		summary: string,
		errorCategory?: string,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context, { includeTerminal: true }) ?? this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const existingTurn = this.store?.getTurn(turn.turnId);
		if (existingTurn && TERMINAL_TURN_STATUSES.has(existingTurn.status)) {
			this.clearTurnProgress(turn.turnId);
			return;
		}
		const now = telemetryTimestamp(context);
		this.flushProviderProgress(turn.turnId, now, { force: true, includeLatest: true, nowMs: telemetryTimestampMs(context) });
		this.finishOpenPhases(turn.turnId, terminalPhaseStatus(status), now);
		this.finishActiveProviderRequests(turn.turnId, providerStatusForTurnStatus(status), now, summary, errorCategory);
		this.finishActiveToolCalls(turn.turnId, status, now, summary);
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, phaseName),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: phaseName,
			status: terminalPhaseStatus(status),
			startedAt: now,
			endedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: safeSummary(summary),
		});
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			eventId: turn.eventId,
			status,
			currentPhase: phaseName,
			completedAt: now,
			lastProgressAt: now,
			queueDepth: turn.queueDepth,
			summary: safeSummary(summary),
		});
		this.clearTurnProgress(turn.turnId);
	}

	private startOrProgressPhase(
		turn: TurnContext,
		phaseName: TelemetryPhaseName,
		now: string,
		summary: string,
		options: { providerRequestId?: string; toolCallId?: string; updateTurn?: boolean } = {},
	) {
		const storedTurn = this.store?.getTurn(turn.turnId);
		if (storedTurn && TERMINAL_TURN_STATUSES.has(storedTurn.status)) return undefined;
		const existing = this.openPhaseByName(turn.turnId, phaseName);
		const phase = this.telemetry.upsertPhase({
			phaseId: existing?.phaseId ?? this.nextPhaseId(turn.turnId, phaseName),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: phaseName,
			status: "open",
			startedAt: existing?.startedAt ?? now,
			lastProgressAt: now,
			providerRequestId: options.providerRequestId,
			toolCallId: options.toolCallId,
			eventId: turn.eventId,
			summary,
		});
		if (options.updateTurn) {
			this.telemetry.upsertTurn({
				turnId: turn.turnId,
				piboSessionId: turn.piboSessionId,
				rootSessionId: turn.rootSessionId,
				roomId: turn.roomId,
				eventId: turn.eventId,
				status: "running",
				currentPhase: phaseName,
				lastProgressAt: now,
				queueDepth: turn.queueDepth,
				summary,
			});
		}
		return phase;
	}

	private openPhaseByName(turnId: string, phaseName: TelemetryPhaseName) {
		return this.store?.getOpenPhaseForTurn(turnId, phaseName);
	}

	private nextPhaseId(turnId: string, phaseName: TelemetryPhaseName): string {
		const base = phaseId(turnId, phaseName);
		const count = this.store?.countPhasesForTurn(turnId, phaseName) ?? 0;
		if (count === 0) return base;
		return `${base}:${count + 1}`;
	}

	private finishOpenPhasesByName(turnId: string | undefined, phaseName: TelemetryPhaseName, status: TelemetryPhaseStatus, now = new Date().toISOString(), summary?: string): void {
		if (!turnId) return;
		for (const phase of this.store?.listOpenPhasesForTurn(turnId) ?? []) {
			if (phase.name !== phaseName) continue;
			this.telemetry.finishPhase(phase.phaseId, { status, endedAt: now, lastProgressAt: now, summary });
		}
	}

	private closeOpenPhasesByName(turnId: string, phaseName: TelemetryPhaseName, status: TelemetryPhaseStatus, now: string, summary?: string): void {
		this.finishOpenPhasesByName(turnId, phaseName, status, now, summary);
	}

	private finishOpenPhases(turnId: string, status: TelemetryPhaseStatus, now: string): void {
		for (const phase of this.store?.listOpenPhasesForTurn(turnId) ?? []) {
			this.telemetry.finishPhase(phase.phaseId, { status, endedAt: now, lastProgressAt: now });
		}
	}

	private activeProviderRequestForTurn(turnId: string): StoredTelemetryProviderRequest | undefined {
		return this.store?.getActiveProviderRequestForTurn(turnId);
	}

	private latestProviderRequestForTurn(turnId: string): StoredTelemetryProviderRequest | undefined {
		return this.store?.getLatestProviderRequestForTurn(turnId);
	}

	private providerRequestForTurn(
		turnId: string,
		options: { includeLatest?: boolean; refresh?: boolean } = {},
	): StoredTelemetryProviderRequest | undefined {
		const cached = this.providerRequestCache.get(turnId);
		if (!options.refresh && cached && (options.includeLatest || !isTerminalProviderStatus(cached.status))) return cached;
		const request = this.activeProviderRequestForTurn(turnId)
			?? (options.includeLatest ? this.latestProviderRequestForTurn(turnId) : undefined);
		if (request) this.providerRequestCache.set(turnId, request);
		else this.providerRequestCache.delete(turnId);
		return request;
	}

	private accumulateProviderEvent(turn: TurnContext, summary: PiProviderEventSummary, now: string, nowMs: number): StoredTelemetryProviderRequest | undefined {
		const pending = this.pendingProviderProgress.get(turn.turnId) ?? emptyPendingProviderProgress();
		pending.lastRawEventAt = now;
		pending.upstreamResponseId = summary.upstreamResponseId ?? pending.upstreamResponseId;
		pending.rawEventCount += 1;
		pending.parseErrorCount += summary.parseStatus === "invalid_json" ? 1 : 0;
		pending.unknownEventCount += summary.parseStatus === "unknown_type" ? 1 : 0;
		pending.bytesReceived += summary.byteSize;
		pending.eventTypeCounts[summary.eventType] = (pending.eventTypeCounts[summary.eventType] ?? 0) + 1;
		this.pendingProviderProgress.set(turn.turnId, pending);
		return this.flushProviderProgress(turn.turnId, now, {
			force: summary.messageEnded,
			includeLatest: summary.messageEnded,
			refresh: summary.messageEnded,
			nowMs,
		});
	}

	private accumulateNormalizedProviderProgress(turn: TurnContext, now: string, force = false, nowMs = Date.now()): StoredTelemetryProviderRequest | undefined {
		const request = this.providerRequestForTurn(turn.turnId, { includeLatest: force });
		if (!request) return undefined;
		const pending = this.pendingProviderProgress.get(turn.turnId) ?? emptyPendingProviderProgress();
		pending.lastNormalizedEventAt = now;
		pending.normalizedEventCount += 1;
		this.pendingProviderProgress.set(turn.turnId, pending);
		const flushNow = force || request.status === "started" || request.status === "headers";
		return this.flushProviderProgress(turn.turnId, now, { force: flushNow, includeLatest: force, nowMs }) ?? request;
	}

	private flushProviderProgress(
		turnId: string,
		now: string,
		options: { force?: boolean; includeLatest?: boolean; refresh?: boolean; nowMs?: number } = {},
	): StoredTelemetryProviderRequest | undefined {
		const pending = this.pendingProviderProgress.get(turnId);
		const request = this.providerRequestForTurn(turnId, options);
		if (!pending) return request;
		const nowMs = options.nowMs ?? Date.now();
		const lastFlushAtMs = this.lastProviderFlushAtMs.get(turnId);
		if (!options.force && lastFlushAtMs !== undefined && nowMs - lastFlushAtMs < this.progressFlushIntervalMs) return request;
		if (!request) {
			const turn = this.store?.getTurn(turnId);
			if (turn && TERMINAL_TURN_STATUSES.has(turn.status)) this.clearTurnProgress(turnId);
			return undefined;
		}
		const updated = this.telemetry.recordProviderProgress({
			providerRequestId: request.providerRequestId,
			status: pending.normalizedEventCount > 0 ? "streaming" : undefined,
			lastRawEventAt: pending.lastRawEventAt,
			lastNormalizedEventAt: pending.lastNormalizedEventAt,
			upstreamResponseId: pending.upstreamResponseId,
			rawEventCount: pending.rawEventCount,
			normalizedEventCount: pending.normalizedEventCount,
			parseErrorCount: pending.parseErrorCount,
			unknownEventCount: pending.unknownEventCount,
			bytesReceived: pending.bytesReceived,
			eventTypeCounts: pending.eventTypeCounts,
			updatedAt: now,
		});
		this.pendingProviderProgress.delete(turnId);
		this.lastProviderFlushAtMs.set(turnId, nowMs);
		if (updated) this.providerRequestCache.set(turnId, updated);
		return updated ?? request;
	}

	private shouldPersistProgress(key: string, force = false, nowMs = Date.now()): boolean {
		const lastWriteAtMs = this.lastProgressWriteAtMs.get(key);
		if (!force && lastWriteAtMs !== undefined && nowMs - lastWriteAtMs < this.progressFlushIntervalMs) return false;
		this.lastProgressWriteAtMs.set(key, nowMs);
		return true;
	}

	private clearProviderProgress(turnId: string): void {
		this.pendingProviderProgress.delete(turnId);
		this.providerRequestCache.delete(turnId);
		this.lastProviderFlushAtMs.delete(turnId);
	}

	private clearTurnProgress(turnId: string): void {
		this.clearProviderProgress(turnId);
		const prefix = `${turnId}:`;
		for (const key of this.lastProgressWriteAtMs.keys()) {
			if (key.startsWith(prefix)) this.lastProgressWriteAtMs.delete(key);
		}
	}

	private finishActiveProviderRequests(
		turnId: string,
		status: TelemetryProviderRequestStatus,
		now: string,
		summary: string,
		errorCategory?: string,
	): void {
		for (const request of this.store?.listActiveProviderRequestsForTurn(turnId) ?? []) {
			this.upsertProviderRequestFromExisting(request, {
				status,
				completedAt: now,
				errorCategory: status === "error" ? errorCategory ?? "runtime_error" : undefined,
				errorMessage: status === "error" ? safeSummary(summary) : undefined,
			});
		}
	}

	private finishActiveToolCalls(turnId: string, status: TelemetryTurnStatus, now: string, summary: string): void {
		if (status === "ok") return;
		for (const toolCall of this.store?.listActiveToolCallsForTurn(turnId) ?? []) {
			const terminalStatus = terminalToolCallStatus(status);
			this.telemetry.upsertToolCall({
				toolCallId: toolCall.toolCallId,
				piboSessionId: toolCall.piboSessionId,
				rootSessionId: toolCall.rootSessionId,
				roomId: toolCall.roomId,
				turnId: toolCall.turnId,
				providerRequestId: toolCall.providerRequestId,
				providerItemId: toolCall.providerItemId,
				outputIndex: toolCall.outputIndex,
				toolName: toolCall.toolName,
				status: terminalStatus,
				executionStartedAt: toolCall.executionStartedAt,
				executionEndedAt: toolCall.executionStartedAt ? now : toolCall.executionEndedAt,
				durationMs: toolCall.executionStartedAt ? durationMs(toolCall.executionStartedAt, now) : toolCall.durationMs,
				argsBytes: toolCall.argsBytes,
				parseStatus: toolCall.parseStatus,
				safeArgKeys: toolCall.safeArgKeys,
				eventId: toolCall.eventId,
				errorCategory: terminalStatus === "error" ? "runtime_error" : terminalStatus === "aborted" ? "runtime_aborted" : "runtime_timeout",
				errorMessage: terminalStatus === "error" ? safeSummary(summary) : undefined,
			});
		}
	}

	private upsertProviderRequestFromExisting(
		request: StoredTelemetryProviderRequest,
		input: Partial<Pick<StoredTelemetryProviderRequest, "status" | "lastNormalizedEventAt" | "normalizedEventCount" | "completedAt" | "upstreamResponseId" | "errorCategory" | "errorMessage">>,
	): void {
		this.telemetry.upsertProviderRequest({
			providerRequestId: request.providerRequestId,
			piboSessionId: request.piboSessionId,
			rootSessionId: request.rootSessionId,
			roomId: request.roomId,
			turnId: request.turnId,
			phaseId: request.phaseId,
			provider: request.provider,
			api: request.api,
			model: request.model,
			transport: request.transport,
			serviceTier: request.serviceTier,
			status: input.status ?? request.status,
			responseHeadersAt: request.responseHeadersAt,
			firstByteAt: request.firstByteAt,
			lastRawEventAt: request.lastRawEventAt,
			lastNormalizedEventAt: input.lastNormalizedEventAt ?? request.lastNormalizedEventAt,
			completedAt: input.completedAt ?? request.completedAt,
			httpStatus: request.httpStatus,
			upstreamResponseId: input.upstreamResponseId ?? request.upstreamResponseId,
			rawEventCount: request.rawEventCount,
			normalizedEventCount: input.normalizedEventCount ?? request.normalizedEventCount,
			parseErrorCount: request.parseErrorCount,
			unknownEventCount: request.unknownEventCount,
			bytesReceived: request.bytesReceived,
			eventTypeCounts: request.eventTypeCounts,
			eventStreamId: request.eventStreamId,
			eventId: request.eventId,
			payloadRef: request.payloadRef,
			errorCategory: input.errorCategory ?? request.errorCategory,
			errorMessage: input.errorMessage ?? request.errorMessage,
			captureMode: request.captureMode,
			retentionClass: request.retentionClass,
		});
	}

	private progressTurnContextForEvent(
		piboSessionId: string,
		eventId: string,
		context: RuntimeTelemetryContext,
	): TurnContext {
		return {
			turnId: turnIdForEvent(eventId),
			eventId,
			piboSessionId,
			rootSessionId: rootSessionIdFor(context.session, piboSessionId),
			roomId: roomIdFor(context.session),
			source: "system",
			queueDepth: context.status?.queuedMessages,
		};
	}

	private turnContextForEvent(
		piboSessionId: string,
		eventId: string | undefined,
		source: PiboEventSource | undefined,
		context: RuntimeTelemetryContext,
		options: { includeTerminal?: boolean } = {},
	): TurnContext | undefined {
		if (!eventId) return undefined;
		const turnId = turnIdForEvent(eventId);
		const existing = this.store?.getTurn(turnId);
		if (!options.includeTerminal && existing && TERMINAL_TURN_STATUSES.has(existing.status)) return undefined;
		return {
			turnId,
			eventId,
			piboSessionId,
			rootSessionId: existing?.rootSessionId ?? rootSessionIdFor(context.session, piboSessionId),
			roomId: existing?.roomId ?? roomIdFor(context.session),
			source: existing?.source ?? telemetrySource(source),
			queueDepth: context.status?.queuedMessages ?? existing?.queueDepth,
		};
	}

	private activeTurnContext(piboSessionId: string, context: RuntimeTelemetryContext): TurnContext | undefined {
		const detail = this.store?.getSessionTelemetry(piboSessionId, { limit: 10 });
		const active = detail?.activeTurn;
		if (!active || TERMINAL_TURN_STATUSES.has(active.status)) return undefined;
		return {
			turnId: active.turnId,
			eventId: active.eventId ?? active.inputEventId,
			piboSessionId,
			rootSessionId: active.rootSessionId ?? rootSessionIdFor(context.session, piboSessionId),
			roomId: active.roomId ?? roomIdFor(context.session),
			source: active.source,
			queueDepth: context.status?.queuedMessages ?? active.queueDepth,
		};
	}
}

function emptyPendingProviderProgress(): PendingProviderProgress {
	return {
		rawEventCount: 0,
		normalizedEventCount: 0,
		parseErrorCount: 0,
		unknownEventCount: 0,
		bytesReceived: 0,
		eventTypeCounts: {},
	};
}

function providerEventSummaryForPiEvent(event: unknown): PiProviderEventSummary | undefined {
	if (!event || typeof event !== "object") return undefined;
	const candidate = event as {
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
	};
	if (candidate.type !== "message_update" && candidate.type !== "message_end") return undefined;
	const assistantType = typeof candidate.assistantMessageEvent?.type === "string" ? candidate.assistantMessageEvent.type : undefined;
	const eventType = assistantType ? `pi.${assistantType}` : `pi.${String(candidate.type)}`;
	const parseStatus = assistantType && !KNOWN_PI_ASSISTANT_EVENTS.has(assistantType) ? "unknown_type" : "ok";
	const toolCall = candidate.assistantMessageEvent?.toolCall;
	const toolCallId = stringValue(toolCall?.id) ?? stringValue(candidate.toolCallId) ?? toolCallIdFromMessage(candidate.message);
	const toolName = stringValue(toolCall?.name) ?? stringValue(candidate.toolName) ?? toolNameFromMessage(candidate.message);
	const deltaBytes = typeof candidate.assistantMessageEvent?.delta === "string" ? utf8Bytes(candidate.assistantMessageEvent.delta) : undefined;
	const contentBytes = typeof candidate.assistantMessageEvent?.content === "string" ? utf8Bytes(candidate.assistantMessageEvent.content) : undefined;
	const argsValue = toolCall?.arguments === undefined ? argsFromMessage(candidate.message) : toolCall.arguments;
	const argsBytes = argsValue === undefined ? undefined : safeJsonByteSize(argsValue);
	const safeArgKeys = argsValue === undefined ? undefined : toolArgsMetadata(argsValue, assistantType === "toolcall_end").safeArgKeys;
	const upstreamResponseId = responseIdFromMessage(candidate.message);
	const safeFields: PiboJsonObject = {
		piEventType: String(candidate.type),
	};
	if (assistantType) safeFields.assistantEventType = assistantType;
	if (typeof candidate.assistantMessageEvent?.contentIndex === "number") safeFields.contentIndex = candidate.assistantMessageEvent.contentIndex;
	if (deltaBytes !== undefined) safeFields.deltaBytes = deltaBytes;
	if (contentBytes !== undefined) safeFields.contentBytes = contentBytes;
	if (argsBytes !== undefined) safeFields.argsBytes = argsBytes;
	if (toolName) safeFields.toolName = toolName;
	if (toolCallId) safeFields.toolCallId = toolCallId;
	if (upstreamResponseId) safeFields.upstreamResponseId = upstreamResponseId;
	const byteSize = safeJsonByteSize(safeFields);
	return {
		eventType,
		messageEnded: candidate.type === "message_end",
		assistantEventType: assistantType,
		parseStatus,
		normalizedType: normalizedTypeForPiAssistantEvent(assistantType),
		byteSize,
		itemId: itemIdFromToolCallId(toolCallId),
		toolCallId,
		toolName,
		argsBytes,
		safeArgKeys,
		safeFields,
		upstreamResponseId,
	};
}

const KNOWN_PI_ASSISTANT_EVENTS = new Set([
	"start",
	"text_start",
	"text_delta",
	"text_end",
	"thinking_start",
	"thinking_delta",
	"thinking_end",
	"toolcall_start",
	"toolcall_delta",
	"toolcall_end",
	"done",
	"error",
]);

function normalizedTypeForPiAssistantEvent(type: string | undefined): string | undefined {
	if (!type) return undefined;
	if (type === "text_delta") return "assistant_delta";
	if (type === "text_end") return "assistant_message";
	if (type === "thinking_start") return "thinking_started";
	if (type === "thinking_delta") return "thinking_delta";
	if (type === "thinking_end") return "thinking_finished";
	if (type === "toolcall_start" || type === "toolcall_delta" || type === "toolcall_end") return "tool_call";
	return undefined;
}

function toolArgsMetadata(args: unknown, argsComplete: boolean): { argsBytes: number; parseStatus: TelemetryToolArgsParseStatus; safeArgKeys: string[] } {
	if (args === undefined || args === null || args === "") return { argsBytes: 0, parseStatus: argsComplete ? "invalid" : "empty", safeArgKeys: [] };
	const argsBytes = typeof args === "string" ? utf8Bytes(args) : safeJsonByteSize(args);
	if (typeof args === "string") {
		const trimmed = args.trim();
		if (!trimmed) return { argsBytes: 0, parseStatus: argsComplete ? "invalid" : "empty", safeArgKeys: [] };
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			return { argsBytes, parseStatus: argsComplete ? "complete" : "valid", safeArgKeys: safeTopLevelKeys(parsed) };
		} catch (error) {
			return { argsBytes, parseStatus: isLikelyPartialJson(trimmed, error) ? "partial" : "invalid", safeArgKeys: [] };
		}
	}
	return { argsBytes, parseStatus: argsComplete ? "complete" : "valid", safeArgKeys: safeTopLevelKeys(args) };
}

function safeTopLevelKeys(value: unknown, limit = 50): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value).filter((key) => key.length <= 128).slice(0, limit);
}

function isLikelyPartialJson(value: string, error: unknown): boolean {
	if (error instanceof SyntaxError && /end of JSON input/i.test(error.message)) return true;
	const opens = (value.match(/[\[{]/g) ?? []).length;
	const closes = (value.match(/[\]}]/g) ?? []).length;
	return opens > closes || /[:,]$/.test(value);
}

function toolStatusForPiAssistantEvent(type: string | undefined, argsBytes: number, existingStatus?: TelemetryToolCallStatus): TelemetryToolCallStatus {
	if (type === "toolcall_end") return "args_complete";
	if (type === "toolcall_delta") return argsBytes > 0 ? "args_partial" : existingStatus ?? "args_started";
	return existingStatus ?? "args_started";
}

function terminalTurnStatusForSessionError(event: Extract<PiboOutputEvent, { type: "session_error" }>): Extract<TelemetryTurnStatus, "error" | "aborted" | "timeout"> {
	if (event.errorDetails?.category === "runtime_abort" || event.errorDetails?.errorClass === "runtime_abort") return "aborted";
	if (event.errorDetails?.code === "timeout") return "timeout";
	return "error";
}

function terminalToolCallStatus(status: TelemetryTurnStatus): Extract<TelemetryToolCallStatus, "error" | "aborted" | "timeout"> {
	if (status === "aborted") return "aborted";
	if (status === "timeout") return "timeout";
	return "error";
}

function durationMs(startedAt: string | undefined, endedAt: string): number | undefined {
	if (!startedAt) return undefined;
	const startMs = Date.parse(startedAt);
	const endMs = Date.parse(endedAt);
	return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : undefined;
}

function numericSafeField(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeErrorMessage(value: unknown): string | undefined {
	if (typeof value === "string") return safeSummary(value);
	if (value && typeof value === "object") {
		const record = value as { message?: unknown; error?: unknown; status?: unknown };
		const message = stringValue(record.message) ?? stringValue(record.error) ?? stringValue(record.status);
		return message ? safeSummary(message) : undefined;
	}
	return undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function responseIdFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const value = (message as { responseId?: unknown }).responseId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolCallIdFromMessage(message: unknown): string | undefined {
	const block = lastToolCallBlock(message);
	return stringValue(block?.id);
}

function toolNameFromMessage(message: unknown): string | undefined {
	const block = lastToolCallBlock(message);
	return stringValue(block?.name);
}

function argsFromMessage(message: unknown): unknown {
	const block = lastToolCallBlock(message);
	return block && "arguments" in block ? block.arguments : undefined;
}

function lastToolCallBlock(message: unknown): { id?: unknown; name?: unknown; arguments?: unknown } | undefined {
	if (!message || typeof message !== "object") return undefined;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	for (let index = content.length - 1; index >= 0; index -= 1) {
		const block = content[index];
		if (!block || typeof block !== "object") continue;
		if ((block as { type?: unknown }).type === "toolCall") return block as { id?: unknown; name?: unknown; arguments?: unknown };
	}
	return undefined;
}

function itemIdFromToolCallId(toolCallId: string | undefined): string | undefined {
	if (!toolCallId) return undefined;
	const [, itemId] = toolCallId.split("|");
	return itemId && itemId.length > 0 ? itemId : undefined;
}

function safeJsonByteSize(value: unknown): number {
	try {
		return utf8Bytes(JSON.stringify(value));
	} catch {
		return 0;
	}
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function telemetryOutputEventSnapshot(event: PiboOutputEvent): PiboOutputEvent {
	if (event.type === "tool_execution_updated") return { ...event, partialResult: undefined };
	if (event.type === "tool_execution_finished") return { ...event, result: event.isError ? safeErrorMessage(event.result) : undefined };
	if (event.type === "execution_result") return { ...event, result: undefined };
	return { ...event };
}

function captureTelemetryContext(context: RuntimeTelemetryContext): RuntimeTelemetryContext {
	const parsedAtMs = context.at ? Date.parse(context.at) : Number.NaN;
	const atMs = context.atMs ?? (Number.isFinite(parsedAtMs) ? parsedAtMs : Date.now());
	return {
		...context,
		session: context.session ? { ...context.session, metadata: context.session.metadata ? { ...context.session.metadata } : undefined } : undefined,
		status: context.status ? { ...context.status, activeTools: [...context.status.activeTools], enabledTools: [...context.status.enabledTools] } : undefined,
		at: context.at ?? new Date(atMs).toISOString(),
		atMs,
	};
}

function telemetryTimestamp(context: RuntimeTelemetryContext): string {
	return context.at ?? new Date().toISOString();
}

function telemetryTimestampMs(context: RuntimeTelemetryContext): number {
	return context.atMs ?? Date.now();
}

export function turnIdForEvent(eventId: string): string {
	return `turn_${eventId}`;
}

function phaseId(turnId: string, phaseName: TelemetryPhaseName): string {
	return `${turnId}:${phaseName}`;
}

function telemetrySource(source: PiboEventSource | undefined): TelemetryTurnSource {
	if (source === "user") return "user";
	if (source === "ui") return "ui";
	if (source === "service") return "system";
	return "rpc";
}

function terminalPhaseStatus(status: TelemetryTurnStatus): TelemetryPhaseStatus {
	if (status === "ok") return "ok";
	if (status === "aborted") return "aborted";
	if (status === "timeout") return "timeout";
	return "error";
}

function providerStatusForTurnStatus(status: TelemetryTurnStatus): TelemetryProviderRequestStatus {
	if (status === "ok") return "completed";
	if (status === "aborted") return "aborted";
	if (status === "timeout") return "timeout";
	return "error";
}

function rootSessionIdFor(session: PiboSession | undefined, fallback: string): string {
	if (!session) return fallback;
	if (session.parentId) {
		const value = session.metadata?.rootSessionId;
		return typeof value === "string" && value.length > 0 ? value : session.parentId;
	}
	return session.id;
}

function roomIdFor(session: PiboSession | undefined): string | undefined {
	const value = session?.metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sessionMetadata(session: PiboSession | undefined): PiboJsonObject {
	const metadata: PiboJsonObject = {};
	if (session?.channel) metadata.channel = session.channel;
	if (session?.kind) metadata.kind = session.kind;
	if (session?.profile) metadata.profile = session.profile;
	return metadata;
}

function safeSummary(summary: string): string {
	return summary.replace(/\s+/g, " ").trim().slice(0, 512);
}
