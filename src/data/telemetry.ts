import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";
import type { TelemetryCaptureMode, TelemetryPreviewUnavailableResult } from "./telemetry-preview.js";
import {
	getTelemetrySessionDetail,
	getTelemetryTurnTimeline,
	listTelemetryProviderEventsPage,
	listTelemetrySessions,
	listTelemetryStaleWork,
} from "./telemetry-queries.js";
import {
	getTelemetryRetentionStats,
	pruneTelemetryRetention,
	type TelemetryPruneInput,
	type TelemetryPruneResult,
	type TelemetryRetentionClass,
	type TelemetryRetentionStats,
} from "./telemetry-retention.js";
import {
	phaseFromRow,
	providerEventFromRow,
	providerRequestFromRow,
	toolCallFromRow,
	turnFromRow,
	type TelemetryPhaseRow,
	type TelemetryProviderEventRow,
	type TelemetryProviderRequestRow,
	type TelemetryToolCallRow,
	type TelemetryTurnRow,
} from "./telemetry-rows.js";

export { createTelemetryBoundedPreview, telemetrySafeJsonObject, telemetrySafeTopLevelKeys } from "./telemetry-preview.js";
export type { TelemetryBoundedPreview, TelemetryCaptureMode, TelemetryPreviewInput, TelemetryPreviewUnavailableResult } from "./telemetry-preview.js";
export type { TelemetryPruneInput, TelemetryPruneResult, TelemetryRetentionClass, TelemetryRetentionStats, TelemetryRetentionStatsRow } from "./telemetry-retention.js";
export type TelemetryTurnSource = "user" | "ui" | "rpc" | "system";
export type TelemetryTurnStatus = "queued" | "running" | "ok" | "error" | "aborted" | "timeout";
export type TelemetryPhaseStatus = "open" | "ok" | "error" | "aborted" | "timeout";
export type TelemetryProviderRequestStatus = "started" | "headers" | "streaming" | "completed" | "error" | "aborted" | "timeout";
export type TelemetryProviderTransport = "sse" | "websocket" | "auto" | "unknown";
export type TelemetryProviderEventParseStatus = "ok" | "invalid_json" | "ignored" | "unknown_type";
export type TelemetryToolCallStatus = "args_started" | "args_partial" | "args_complete" | "executing" | "ok" | "error" | "aborted" | "timeout";
export type TelemetryToolArgsParseStatus = "empty" | "partial" | "valid" | "invalid" | "complete";

export type TelemetryListOptions = {
	limit?: number;
};

export type TelemetryStaleOptions = TelemetryListOptions & {
	now?: string;
	thresholdMs?: number;
};

export type TelemetryProviderEventListOptions = TelemetryListOptions & {
	afterSequence?: number;
};

export type TelemetrySessionSummary = {
	piboSessionId: string;
	status: TelemetryTurnStatus | "idle";
	activeTurnId?: string;
	activePhase?: StoredTelemetryPhase;
	queueDepth?: number;
	lastProgressAt?: string;
	staleForMs?: number;
	isStale: boolean;
	turnCount: number;
	nextCommands: string[];
};

export type TelemetrySessionDetail = {
	piboSessionId: string;
	activeTurn?: StoredTelemetryTurn;
	activePhase?: StoredTelemetryPhase;
	recentTurns: StoredTelemetryTurn[];
	providerRequests: StoredTelemetryProviderRequest[];
	toolCalls: StoredTelemetryToolCall[];
	nextCommands: string[];
};

export type TelemetryTurnTimeline = {
	turn: StoredTelemetryTurn;
	phases: StoredTelemetryPhase[];
	providerRequests: StoredTelemetryProviderRequest[];
	toolCalls: StoredTelemetryToolCall[];
	nextCommands: string[];
};

export type TelemetryProviderEventsPage = {
	providerRequestId: string;
	rows: StoredTelemetryProviderEvent[];
	limit: number;
	afterSequence: number;
	nextAfterSequence?: number;
	hasMore: boolean;
	truncated: boolean;
	storageMode: "per_event";
};

export type TelemetryStaleWorkItem = {
	piboSessionId: string;
	turnId: string;
	phaseId?: string;
	phase?: TelemetryPhaseName;
	lastProgressAt?: string;
	staleForMs: number;
	thresholdMs: number;
	queueDepth?: number;
	nextCommands: string[];
};

export type StoredTelemetryTurn = {
	turnId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	inputEventId?: string;
	eventId?: string;
	eventStreamId?: number;
	payloadRef?: string;
	runId?: string;
	source: TelemetryTurnSource;
	status: TelemetryTurnStatus;
	currentPhase?: string;
	queuedAt: string;
	startedAt?: string;
	completedAt?: string;
	lastProgressAt?: string;
	queuedBehind?: number;
	queueDepth?: number;
	summary?: string;
	retentionClass: TelemetryRetentionClass;
	createdAt: string;
	updatedAt: string;
	metadata: PiboJsonObject;
};

export type TelemetryTurnUpsertInput = {
	turnId?: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	inputEventId?: string;
	eventId?: string;
	eventStreamId?: number;
	payloadRef?: string;
	runId?: string;
	source?: TelemetryTurnSource;
	status?: TelemetryTurnStatus;
	currentPhase?: string;
	queuedAt?: string;
	startedAt?: string;
	completedAt?: string;
	lastProgressAt?: string;
	queuedBehind?: number;
	queueDepth?: number;
	summary?: string;
	retentionClass?: TelemetryRetentionClass;
	createdAt?: string;
	updatedAt?: string;
	metadata?: PiboJsonObject;
};

export type StoredTelemetryPhase = {
	phaseId: string;
	turnId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	name: TelemetryPhaseName;
	status: TelemetryPhaseStatus;
	startedAt: string;
	endedAt?: string;
	lastProgressAt?: string;
	durationMs?: number;
	providerRequestId?: string;
	toolCallId?: string;
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	runId?: string;
	counters: PiboJsonObject;
	summary?: string;
	retentionClass: TelemetryRetentionClass;
	createdAt: string;
	updatedAt: string;
};

export type TelemetryPhaseName =
	| "queued"
	| "message_started"
	| "prompt_build"
	| "provider_request"
	| "provider_stream"
	| "reasoning"
	| "assistant_text"
	| "tool_args"
	| "tool_execution"
	| "continuation"
	| "abort"
	| "error"
	| "timeout"
	| "finish";

export type TelemetryPhaseUpsertInput = {
	phaseId?: string;
	turnId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	name: TelemetryPhaseName;
	status?: TelemetryPhaseStatus;
	startedAt?: string;
	endedAt?: string;
	lastProgressAt?: string;
	durationMs?: number;
	providerRequestId?: string;
	toolCallId?: string;
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	runId?: string;
	counters?: PiboJsonObject;
	summary?: string;
	retentionClass?: TelemetryRetentionClass;
	createdAt?: string;
	updatedAt?: string;
};

export type TelemetryPhaseFinishInput = {
	status?: TelemetryPhaseStatus;
	endedAt?: string;
	lastProgressAt?: string;
	durationMs?: number;
	summary?: string;
};

export type StoredTelemetryProviderRequest = {
	providerRequestId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	turnId: string;
	phaseId?: string;
	provider: string;
	api: string;
	model: string;
	transport: TelemetryProviderTransport;
	serviceTier?: string;
	status: TelemetryProviderRequestStatus;
	startedAt: string;
	responseHeadersAt?: string;
	firstByteAt?: string;
	lastRawEventAt?: string;
	lastNormalizedEventAt?: string;
	completedAt?: string;
	httpStatus?: number;
	upstreamResponseId?: string;
	rawEventCount: number;
	normalizedEventCount: number;
	parseErrorCount: number;
	unknownEventCount: number;
	bytesReceived?: number;
	eventTypeCounts: PiboJsonObject;
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	errorCategory?: string;
	errorMessage?: string;
	captureMode: TelemetryCaptureMode;
	retentionClass: TelemetryRetentionClass;
	createdAt: string;
	updatedAt: string;
};

export type TelemetryProviderRequestUpsertInput = {
	providerRequestId?: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	turnId: string;
	phaseId?: string;
	provider: string;
	api: string;
	model: string;
	transport?: TelemetryProviderTransport;
	serviceTier?: string;
	status?: TelemetryProviderRequestStatus;
	startedAt?: string;
	responseHeadersAt?: string;
	firstByteAt?: string;
	lastRawEventAt?: string;
	lastNormalizedEventAt?: string;
	completedAt?: string;
	httpStatus?: number;
	upstreamResponseId?: string;
	rawEventCount?: number;
	normalizedEventCount?: number;
	parseErrorCount?: number;
	unknownEventCount?: number;
	bytesReceived?: number;
	eventTypeCounts?: PiboJsonObject;
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	errorCategory?: string;
	errorMessage?: string;
	captureMode?: TelemetryCaptureMode;
	retentionClass?: TelemetryRetentionClass;
	createdAt?: string;
	updatedAt?: string;
};

export type StoredTelemetryProviderEvent = {
	rawEventId: string;
	providerRequestId: string;
	piboSessionId?: string;
	turnId?: string;
	phaseId?: string;
	sequence: number;
	receivedAt: string;
	eventType: string;
	byteSize: number;
	parseStatus: TelemetryProviderEventParseStatus;
	normalizedType?: string;
	eventStreamId?: number;
	eventId?: string;
	itemId?: string;
	toolCallId?: string;
	payloadRef?: string;
	payloadPreviewRef?: string;
	safeFields: PiboJsonObject;
	retentionClass: TelemetryRetentionClass;
	createdAt: string;
	updatedAt: string;
};

export type TelemetryProviderEventInput = {
	rawEventId?: string;
	providerRequestId: string;
	piboSessionId?: string;
	turnId?: string;
	phaseId?: string;
	sequence?: number;
	receivedAt?: string;
	eventType: string;
	byteSize?: number;
	parseStatus?: TelemetryProviderEventParseStatus;
	normalizedType?: string;
	/** Optional counter delta for provider request normalized events. Defaults to 1 when normalizedType is present. */
	normalizedEventDelta?: number;
	eventStreamId?: number;
	eventId?: string;
	itemId?: string;
	toolCallId?: string;
	payloadRef?: string;
	payloadPreviewRef?: string;
	safeFields?: PiboJsonObject;
	retentionClass?: TelemetryRetentionClass;
	createdAt?: string;
	updatedAt?: string;
};

export type TelemetryProviderProgressInput = {
	providerRequestId: string;
	status?: TelemetryProviderRequestStatus;
	lastRawEventAt?: string;
	lastNormalizedEventAt?: string;
	upstreamResponseId?: string;
	rawEventCount?: number;
	normalizedEventCount?: number;
	parseErrorCount?: number;
	unknownEventCount?: number;
	bytesReceived?: number;
	eventTypeCounts?: Record<string, number>;
	updatedAt?: string;
};

export type StoredTelemetryToolCall = {
	toolCallId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	turnId: string;
	providerRequestId?: string;
	providerItemId?: string;
	outputIndex?: number;
	toolName: string;
	status: TelemetryToolCallStatus;
	argsStartedAt?: string;
	firstDeltaAt?: string;
	lastDeltaAt?: string;
	argsCompletedAt?: string;
	executionStartedAt?: string;
	executionEndedAt?: string;
	durationMs?: number;
	argsBytes: number;
	parseStatus: TelemetryToolArgsParseStatus;
	safeArgKeys: string[];
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	runId?: string;
	errorCategory?: string;
	errorMessage?: string;
	retentionClass: TelemetryRetentionClass;
	createdAt: string;
	updatedAt: string;
};

export type TelemetryToolCallUpsertInput = {
	toolCallId: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	turnId: string;
	providerRequestId?: string;
	providerItemId?: string;
	outputIndex?: number;
	toolName: string;
	status?: TelemetryToolCallStatus;
	argsStartedAt?: string;
	firstDeltaAt?: string;
	lastDeltaAt?: string;
	argsCompletedAt?: string;
	executionStartedAt?: string;
	executionEndedAt?: string;
	durationMs?: number;
	argsBytes?: number;
	parseStatus?: TelemetryToolArgsParseStatus;
	safeArgKeys?: string[];
	eventStreamId?: number;
	eventId?: string;
	payloadRef?: string;
	runId?: string;
	errorCategory?: string;
	errorMessage?: string;
	retentionClass?: TelemetryRetentionClass;
	createdAt?: string;
	updatedAt?: string;
};

export class TelemetryStore {
	constructor(private readonly db: DatabaseSync) {}

	listSessions(input: TelemetryStaleOptions = {}): TelemetrySessionSummary[] {
		return listTelemetrySessions(this.db, input);
	}

	getSessionTelemetry(piboSessionId: string, input: TelemetryListOptions = {}): TelemetrySessionDetail | undefined {
		return getTelemetrySessionDetail(this.db, piboSessionId, input);
	}

	getTurnTimeline(turnIdOrEventId: string, input: TelemetryListOptions = {}): TelemetryTurnTimeline | undefined {
		return getTelemetryTurnTimeline(this.db, turnIdOrEventId, input);
	}

	getOpenPhaseForTurn(turnId: string, name: TelemetryPhaseName): StoredTelemetryPhase | undefined {
		const row = this.db.prepare(`
			SELECT * FROM telemetry_phases
			WHERE turn_id = ? AND name = ? AND status = 'open'
			ORDER BY COALESCE(last_progress_at, started_at) DESC, created_at DESC
			LIMIT 1
		`).get(turnId, name) as TelemetryPhaseRow | undefined;
		return row ? phaseFromRow(row) : undefined;
	}

	countPhasesForTurn(turnId: string, name: TelemetryPhaseName): number {
		const row = this.db.prepare("SELECT COUNT(*) AS count FROM telemetry_phases WHERE turn_id = ? AND name = ?").get(turnId, name) as { count: number };
		return Number(row.count);
	}

	listOpenPhasesForTurn(turnId: string): StoredTelemetryPhase[] {
		const rows = this.db.prepare(`
			SELECT * FROM telemetry_phases
			WHERE turn_id = ? AND status = 'open'
			ORDER BY started_at ASC, created_at ASC
		`).all(turnId) as TelemetryPhaseRow[];
		return rows.map(phaseFromRow);
	}

	getLatestProviderRequestForTurn(turnId: string): StoredTelemetryProviderRequest | undefined {
		const row = this.db.prepare(`
			SELECT * FROM telemetry_provider_requests
			WHERE turn_id = ?
			ORDER BY started_at DESC, created_at DESC
			LIMIT 1
		`).get(turnId) as TelemetryProviderRequestRow | undefined;
		return row ? providerRequestFromRow(row) : undefined;
	}

	getActiveProviderRequestForTurn(turnId: string): StoredTelemetryProviderRequest | undefined {
		const row = this.db.prepare(`
			SELECT * FROM telemetry_provider_requests
			WHERE turn_id = ? AND status NOT IN ('completed', 'error', 'aborted', 'timeout')
			ORDER BY started_at DESC, created_at DESC
			LIMIT 1
		`).get(turnId) as TelemetryProviderRequestRow | undefined;
		return row ? providerRequestFromRow(row) : undefined;
	}

	listActiveProviderRequestsForTurn(turnId: string): StoredTelemetryProviderRequest[] {
		const rows = this.db.prepare(`
			SELECT * FROM telemetry_provider_requests
			WHERE turn_id = ? AND status NOT IN ('completed', 'error', 'aborted', 'timeout')
			ORDER BY started_at ASC, created_at ASC
		`).all(turnId) as TelemetryProviderRequestRow[];
		return rows.map(providerRequestFromRow);
	}

	listActiveToolCallsForTurn(turnId: string): StoredTelemetryToolCall[] {
		const rows = this.db.prepare(`
			SELECT * FROM telemetry_tool_calls
			WHERE turn_id = ? AND status NOT IN ('ok', 'error', 'aborted', 'timeout')
			ORDER BY created_at ASC
		`).all(turnId) as TelemetryToolCallRow[];
		return rows.map(toolCallFromRow);
	}

	listProviderEventsPage(providerRequestId: string, input: TelemetryProviderEventListOptions = {}): TelemetryProviderEventsPage {
		return listTelemetryProviderEventsPage(this.db, providerRequestId, input);
	}

	listStaleWork(input: TelemetryStaleOptions = {}): TelemetryStaleWorkItem[] {
		return listTelemetryStaleWork(this.db, input);
	}

	getStats(): TelemetryRetentionStats {
		return getTelemetryRetentionStats(this.db);
	}

	prune(input: TelemetryPruneInput): TelemetryPruneResult {
		return pruneTelemetryRetention(this.db, input);
	}

	upsertTurn(input: TelemetryTurnUpsertInput): StoredTelemetryTurn {
		const now = input.updatedAt ?? new Date().toISOString();
		const turnId = input.turnId ?? `turn_${randomUUID()}`;
		const existing = input.turnId ? this.getTurn(input.turnId) : undefined;
		const queuedAt = input.queuedAt ?? existing?.queuedAt ?? now;
		this.db.prepare(`
			INSERT INTO telemetry_turns (
				turn_id, pibo_session_id, root_session_id, room_id, input_event_id, event_id, event_stream_id,
				payload_ref, run_id, source, status, current_phase, queued_at, started_at, completed_at,
				last_progress_at, queued_behind, queue_depth, summary, retention_class, created_at, updated_at, metadata_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(turn_id) DO UPDATE SET
				pibo_session_id = excluded.pibo_session_id,
				root_session_id = COALESCE(excluded.root_session_id, telemetry_turns.root_session_id),
				room_id = COALESCE(excluded.room_id, telemetry_turns.room_id),
				input_event_id = COALESCE(excluded.input_event_id, telemetry_turns.input_event_id),
				event_id = COALESCE(excluded.event_id, telemetry_turns.event_id),
				event_stream_id = COALESCE(excluded.event_stream_id, telemetry_turns.event_stream_id),
				payload_ref = COALESCE(excluded.payload_ref, telemetry_turns.payload_ref),
				run_id = COALESCE(excluded.run_id, telemetry_turns.run_id),
				source = excluded.source,
				status = excluded.status,
				current_phase = COALESCE(excluded.current_phase, telemetry_turns.current_phase),
				started_at = COALESCE(excluded.started_at, telemetry_turns.started_at),
				completed_at = COALESCE(excluded.completed_at, telemetry_turns.completed_at),
				last_progress_at = COALESCE(excluded.last_progress_at, telemetry_turns.last_progress_at),
				queued_behind = COALESCE(excluded.queued_behind, telemetry_turns.queued_behind),
				queue_depth = COALESCE(excluded.queue_depth, telemetry_turns.queue_depth),
				summary = COALESCE(excluded.summary, telemetry_turns.summary),
				retention_class = excluded.retention_class,
				updated_at = excluded.updated_at,
				metadata_json = COALESCE(excluded.metadata_json, telemetry_turns.metadata_json)
		`).run(
			turnId,
			input.piboSessionId,
			input.rootSessionId ?? null,
			input.roomId ?? null,
			input.inputEventId ?? null,
			input.eventId ?? null,
			input.eventStreamId ?? null,
			input.payloadRef ?? null,
			input.runId ?? null,
			input.source ?? existing?.source ?? "user",
			input.status ?? existing?.status ?? "queued",
			input.currentPhase ?? null,
			queuedAt,
			input.startedAt ?? null,
			input.completedAt ?? null,
			input.lastProgressAt ?? null,
			input.queuedBehind ?? null,
			input.queueDepth ?? null,
			input.summary ?? null,
			input.retentionClass ?? existing?.retentionClass ?? "diagnostic",
			input.createdAt ?? existing?.createdAt ?? now,
			now,
			JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
		);
		return this.getTurn(turnId) ?? fail(`Failed to upsert telemetry turn ${turnId}`);
	}

	upsertPhase(input: TelemetryPhaseUpsertInput): StoredTelemetryPhase {
		const now = input.updatedAt ?? new Date().toISOString();
		const phaseId = input.phaseId ?? `phase_${randomUUID()}`;
		const existing = input.phaseId ? this.getPhase(input.phaseId) : undefined;
		const startedAt = input.startedAt ?? existing?.startedAt ?? now;
		this.db.prepare(`
			INSERT INTO telemetry_phases (
				phase_id, turn_id, pibo_session_id, root_session_id, room_id, name, status, started_at, ended_at,
				last_progress_at, duration_ms, provider_request_id, tool_call_id, event_stream_id, event_id,
				payload_ref, run_id, counters_json, summary, retention_class, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(phase_id) DO UPDATE SET
				turn_id = excluded.turn_id,
				pibo_session_id = excluded.pibo_session_id,
				root_session_id = COALESCE(excluded.root_session_id, telemetry_phases.root_session_id),
				room_id = COALESCE(excluded.room_id, telemetry_phases.room_id),
				name = excluded.name,
				status = excluded.status,
				ended_at = COALESCE(excluded.ended_at, telemetry_phases.ended_at),
				last_progress_at = COALESCE(excluded.last_progress_at, telemetry_phases.last_progress_at),
				duration_ms = COALESCE(excluded.duration_ms, telemetry_phases.duration_ms),
				provider_request_id = COALESCE(excluded.provider_request_id, telemetry_phases.provider_request_id),
				tool_call_id = COALESCE(excluded.tool_call_id, telemetry_phases.tool_call_id),
				event_stream_id = COALESCE(excluded.event_stream_id, telemetry_phases.event_stream_id),
				event_id = COALESCE(excluded.event_id, telemetry_phases.event_id),
				payload_ref = COALESCE(excluded.payload_ref, telemetry_phases.payload_ref),
				run_id = COALESCE(excluded.run_id, telemetry_phases.run_id),
				counters_json = COALESCE(excluded.counters_json, telemetry_phases.counters_json),
				summary = COALESCE(excluded.summary, telemetry_phases.summary),
				retention_class = excluded.retention_class,
				updated_at = excluded.updated_at
		`).run(
			phaseId,
			input.turnId,
			input.piboSessionId,
			input.rootSessionId ?? null,
			input.roomId ?? null,
			input.name,
			input.status ?? existing?.status ?? "open",
			startedAt,
			input.endedAt ?? null,
			input.lastProgressAt ?? null,
			input.durationMs ?? null,
			input.providerRequestId ?? null,
			input.toolCallId ?? null,
			input.eventStreamId ?? null,
			input.eventId ?? null,
			input.payloadRef ?? null,
			input.runId ?? null,
			JSON.stringify(input.counters ?? existing?.counters ?? {}),
			input.summary ?? null,
			input.retentionClass ?? existing?.retentionClass ?? "diagnostic",
			input.createdAt ?? existing?.createdAt ?? now,
			now,
		);
		return this.getPhase(phaseId) ?? fail(`Failed to upsert telemetry phase ${phaseId}`);
	}

	finishPhase(phaseId: string, input: TelemetryPhaseFinishInput = {}): StoredTelemetryPhase | undefined {
		const existing = this.getPhase(phaseId);
		if (!existing) return undefined;
		const endedAt = input.endedAt ?? new Date().toISOString();
		return this.upsertPhase({
			phaseId,
			turnId: existing.turnId,
			piboSessionId: existing.piboSessionId,
			rootSessionId: existing.rootSessionId,
			roomId: existing.roomId,
			name: existing.name,
			status: input.status ?? "ok",
			endedAt,
			lastProgressAt: input.lastProgressAt ?? endedAt,
			durationMs: input.durationMs ?? Math.max(0, Date.parse(endedAt) - Date.parse(existing.startedAt)),
			summary: input.summary,
			retentionClass: existing.retentionClass,
		});
	}

	upsertProviderRequest(input: TelemetryProviderRequestUpsertInput): StoredTelemetryProviderRequest {
		const now = input.updatedAt ?? new Date().toISOString();
		const providerRequestId = input.providerRequestId ?? `pr_${randomUUID()}`;
		const existing = input.providerRequestId ? this.getProviderRequest(input.providerRequestId) : undefined;
		const startedAt = input.startedAt ?? existing?.startedAt ?? now;
		this.db.prepare(`
			INSERT INTO telemetry_provider_requests (
				provider_request_id, pibo_session_id, root_session_id, room_id, turn_id, phase_id, provider, api, model,
				transport, service_tier, status, started_at, response_headers_at, first_byte_at, last_raw_event_at,
				last_normalized_event_at, completed_at, http_status, upstream_response_id, raw_event_count,
				normalized_event_count, parse_error_count, unknown_event_count, bytes_received, event_type_counts_json,
				event_stream_id, event_id, payload_ref, error_category, error_message, capture_mode, retention_class,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(provider_request_id) DO UPDATE SET
				pibo_session_id = excluded.pibo_session_id,
				root_session_id = COALESCE(excluded.root_session_id, telemetry_provider_requests.root_session_id),
				room_id = COALESCE(excluded.room_id, telemetry_provider_requests.room_id),
				turn_id = excluded.turn_id,
				phase_id = COALESCE(excluded.phase_id, telemetry_provider_requests.phase_id),
				provider = excluded.provider,
				api = excluded.api,
				model = excluded.model,
				transport = excluded.transport,
				service_tier = COALESCE(excluded.service_tier, telemetry_provider_requests.service_tier),
				status = excluded.status,
				response_headers_at = COALESCE(excluded.response_headers_at, telemetry_provider_requests.response_headers_at),
				first_byte_at = COALESCE(excluded.first_byte_at, telemetry_provider_requests.first_byte_at),
				last_raw_event_at = COALESCE(excluded.last_raw_event_at, telemetry_provider_requests.last_raw_event_at),
				last_normalized_event_at = COALESCE(excluded.last_normalized_event_at, telemetry_provider_requests.last_normalized_event_at),
				completed_at = COALESCE(excluded.completed_at, telemetry_provider_requests.completed_at),
				http_status = COALESCE(excluded.http_status, telemetry_provider_requests.http_status),
				upstream_response_id = COALESCE(excluded.upstream_response_id, telemetry_provider_requests.upstream_response_id),
				raw_event_count = excluded.raw_event_count,
				normalized_event_count = excluded.normalized_event_count,
				parse_error_count = excluded.parse_error_count,
				unknown_event_count = excluded.unknown_event_count,
				bytes_received = COALESCE(excluded.bytes_received, telemetry_provider_requests.bytes_received),
				event_type_counts_json = excluded.event_type_counts_json,
				event_stream_id = COALESCE(excluded.event_stream_id, telemetry_provider_requests.event_stream_id),
				event_id = COALESCE(excluded.event_id, telemetry_provider_requests.event_id),
				payload_ref = COALESCE(excluded.payload_ref, telemetry_provider_requests.payload_ref),
				error_category = COALESCE(excluded.error_category, telemetry_provider_requests.error_category),
				error_message = COALESCE(excluded.error_message, telemetry_provider_requests.error_message),
				capture_mode = excluded.capture_mode,
				retention_class = excluded.retention_class,
				updated_at = excluded.updated_at
		`).run(
			providerRequestId,
			input.piboSessionId,
			input.rootSessionId ?? null,
			input.roomId ?? null,
			input.turnId,
			input.phaseId ?? null,
			input.provider,
			input.api,
			input.model,
			input.transport ?? existing?.transport ?? "unknown",
			input.serviceTier ?? null,
			input.status ?? existing?.status ?? "started",
			startedAt,
			input.responseHeadersAt ?? null,
			input.firstByteAt ?? null,
			input.lastRawEventAt ?? null,
			input.lastNormalizedEventAt ?? null,
			input.completedAt ?? null,
			input.httpStatus ?? null,
			input.upstreamResponseId ?? null,
			input.rawEventCount ?? existing?.rawEventCount ?? 0,
			input.normalizedEventCount ?? existing?.normalizedEventCount ?? 0,
			input.parseErrorCount ?? existing?.parseErrorCount ?? 0,
			input.unknownEventCount ?? existing?.unknownEventCount ?? 0,
			input.bytesReceived ?? existing?.bytesReceived ?? null,
			JSON.stringify(input.eventTypeCounts ?? existing?.eventTypeCounts ?? {}),
			input.eventStreamId ?? null,
			input.eventId ?? null,
			input.payloadRef ?? null,
			input.errorCategory ?? null,
			input.errorMessage ?? null,
			input.captureMode ?? existing?.captureMode ?? "metadata_only",
			input.retentionClass ?? existing?.retentionClass ?? "diagnostic",
			input.createdAt ?? existing?.createdAt ?? now,
			now,
		);
		return this.getProviderRequest(providerRequestId) ?? fail(`Failed to upsert telemetry provider request ${providerRequestId}`);
	}

	recordProviderEventSummary(input: TelemetryProviderEventInput): void {
		const now = input.updatedAt ?? new Date().toISOString();
		const receivedAt = input.receivedAt ?? now;
		const byteSize = input.byteSize ?? 0;
		const parseStatus = input.parseStatus ?? "ok";
		const normalizedDelta = input.normalizedEventDelta ?? (input.normalizedType ? 1 : 0);
		this.incrementProviderCounters(input.providerRequestId, input.eventType, receivedAt, byteSize, parseStatus, normalizedDelta);
	}

	recordProviderProgress(input: TelemetryProviderProgressInput): StoredTelemetryProviderRequest | undefined {
		const existing = this.getProviderRequest(input.providerRequestId);
		if (!existing) return undefined;
		const eventTypeCounts = { ...existing.eventTypeCounts };
		for (const [eventType, delta] of Object.entries(input.eventTypeCounts ?? {})) {
			if (!Number.isFinite(delta) || delta <= 0) continue;
			const current = typeof eventTypeCounts[eventType] === "number" ? eventTypeCounts[eventType] : 0;
			eventTypeCounts[eventType] = current + delta;
		}
		const rawEventCount = Math.max(0, input.rawEventCount ?? 0);
		const normalizedEventCount = Math.max(0, input.normalizedEventCount ?? 0);
		const parseErrorCount = Math.max(0, input.parseErrorCount ?? 0);
		const unknownEventCount = Math.max(0, input.unknownEventCount ?? 0);
		const bytesReceived = Math.max(0, input.bytesReceived ?? 0);
		const updatedAt = input.updatedAt ?? input.lastNormalizedEventAt ?? input.lastRawEventAt ?? new Date().toISOString();
		this.db.prepare(`
			UPDATE telemetry_provider_requests SET
				status = CASE WHEN status IN ('completed', 'error', 'aborted', 'timeout') THEN status ELSE COALESCE(?, status) END,
				last_raw_event_at = COALESCE(?, last_raw_event_at),
				last_normalized_event_at = COALESCE(?, last_normalized_event_at),
				upstream_response_id = COALESCE(?, upstream_response_id),
				raw_event_count = raw_event_count + ?,
				normalized_event_count = normalized_event_count + ?,
				parse_error_count = parse_error_count + ?,
				unknown_event_count = unknown_event_count + ?,
				bytes_received = CASE WHEN ? = 0 THEN bytes_received ELSE COALESCE(bytes_received, 0) + ? END,
				event_type_counts_json = ?,
				updated_at = ?
			WHERE provider_request_id = ?
		`).run(
			input.status ?? null,
			input.lastRawEventAt ?? null,
			input.lastNormalizedEventAt ?? null,
			input.upstreamResponseId ?? null,
			rawEventCount,
			normalizedEventCount,
			parseErrorCount,
			unknownEventCount,
			bytesReceived,
			bytesReceived,
			JSON.stringify(eventTypeCounts),
			updatedAt,
			input.providerRequestId,
		);
		return {
			...existing,
			status: isTerminalProviderRequestStatus(existing.status) ? existing.status : input.status ?? existing.status,
			lastRawEventAt: input.lastRawEventAt ?? existing.lastRawEventAt,
			lastNormalizedEventAt: input.lastNormalizedEventAt ?? existing.lastNormalizedEventAt,
			upstreamResponseId: input.upstreamResponseId ?? existing.upstreamResponseId,
			rawEventCount: existing.rawEventCount + rawEventCount,
			normalizedEventCount: existing.normalizedEventCount + normalizedEventCount,
			parseErrorCount: existing.parseErrorCount + parseErrorCount,
			unknownEventCount: existing.unknownEventCount + unknownEventCount,
			bytesReceived: bytesReceived > 0 ? (existing.bytesReceived ?? 0) + bytesReceived : existing.bytesReceived,
			eventTypeCounts,
			updatedAt,
		};
	}

	appendProviderEventSummary(input: TelemetryProviderEventInput): StoredTelemetryProviderEvent {
		const now = input.updatedAt ?? new Date().toISOString();
		const receivedAt = input.receivedAt ?? now;
		const rawEventId = input.rawEventId ?? `raw_${randomUUID()}`;
		const existingEvent = this.getProviderEvent(rawEventId);
		const sequence = input.sequence ?? existingEvent?.sequence ?? this.nextProviderEventSequence(input.providerRequestId);
		const byteSize = input.byteSize ?? 0;
		const parseStatus = input.parseStatus ?? "ok";
		this.db.prepare(`
			INSERT INTO telemetry_provider_events (
				raw_event_id, provider_request_id, pibo_session_id, turn_id, phase_id, sequence, received_at,
				event_type, byte_size, parse_status, normalized_type, event_stream_id, event_id, item_id,
				tool_call_id, payload_ref, payload_preview_ref, safe_fields_json, retention_class, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(raw_event_id) DO UPDATE SET
				provider_request_id = excluded.provider_request_id,
				pibo_session_id = COALESCE(excluded.pibo_session_id, telemetry_provider_events.pibo_session_id),
				turn_id = COALESCE(excluded.turn_id, telemetry_provider_events.turn_id),
				phase_id = COALESCE(excluded.phase_id, telemetry_provider_events.phase_id),
				sequence = excluded.sequence,
				received_at = excluded.received_at,
				event_type = excluded.event_type,
				byte_size = excluded.byte_size,
				parse_status = excluded.parse_status,
				normalized_type = COALESCE(excluded.normalized_type, telemetry_provider_events.normalized_type),
				event_stream_id = COALESCE(excluded.event_stream_id, telemetry_provider_events.event_stream_id),
				event_id = COALESCE(excluded.event_id, telemetry_provider_events.event_id),
				item_id = COALESCE(excluded.item_id, telemetry_provider_events.item_id),
				tool_call_id = COALESCE(excluded.tool_call_id, telemetry_provider_events.tool_call_id),
				payload_ref = COALESCE(excluded.payload_ref, telemetry_provider_events.payload_ref),
				payload_preview_ref = COALESCE(excluded.payload_preview_ref, telemetry_provider_events.payload_preview_ref),
				safe_fields_json = excluded.safe_fields_json,
				retention_class = excluded.retention_class,
				updated_at = excluded.updated_at
		`).run(
			rawEventId,
			input.providerRequestId,
			input.piboSessionId ?? null,
			input.turnId ?? null,
			input.phaseId ?? null,
			sequence,
			receivedAt,
			input.eventType,
			byteSize,
			parseStatus,
			input.normalizedType ?? null,
			input.eventStreamId ?? null,
			input.eventId ?? null,
			input.itemId ?? null,
			input.toolCallId ?? null,
			input.payloadRef ?? null,
			input.payloadPreviewRef ?? null,
			JSON.stringify(input.safeFields ?? {}),
			input.retentionClass ?? "provider_event",
			input.createdAt ?? now,
			now,
		);
		const normalizedDelta = input.normalizedEventDelta ?? (input.normalizedType ? 1 : 0);
		if (!existingEvent) this.incrementProviderCounters(input.providerRequestId, input.eventType, receivedAt, byteSize, parseStatus, normalizedDelta);
		return this.getProviderEvent(rawEventId) ?? fail(`Failed to append telemetry provider event ${rawEventId}`);
	}

	upsertToolCall(input: TelemetryToolCallUpsertInput): StoredTelemetryToolCall {
		const now = input.updatedAt ?? new Date().toISOString();
		const existing = this.getToolCall(input.toolCallId);
		this.db.prepare(`
			INSERT INTO telemetry_tool_calls (
				tool_call_id, pibo_session_id, root_session_id, room_id, turn_id, provider_request_id, provider_item_id,
				output_index, tool_name, status, args_started_at, first_delta_at, last_delta_at, args_completed_at,
				execution_started_at, execution_ended_at, duration_ms, args_bytes, parse_status, safe_arg_keys_json,
				event_stream_id, event_id, payload_ref, run_id, error_category, error_message, retention_class, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(tool_call_id) DO UPDATE SET
				pibo_session_id = excluded.pibo_session_id,
				root_session_id = COALESCE(excluded.root_session_id, telemetry_tool_calls.root_session_id),
				room_id = COALESCE(excluded.room_id, telemetry_tool_calls.room_id),
				turn_id = excluded.turn_id,
				provider_request_id = COALESCE(excluded.provider_request_id, telemetry_tool_calls.provider_request_id),
				provider_item_id = COALESCE(excluded.provider_item_id, telemetry_tool_calls.provider_item_id),
				output_index = COALESCE(excluded.output_index, telemetry_tool_calls.output_index),
				tool_name = excluded.tool_name,
				status = excluded.status,
				args_started_at = COALESCE(excluded.args_started_at, telemetry_tool_calls.args_started_at),
				first_delta_at = COALESCE(excluded.first_delta_at, telemetry_tool_calls.first_delta_at),
				last_delta_at = COALESCE(excluded.last_delta_at, telemetry_tool_calls.last_delta_at),
				args_completed_at = COALESCE(excluded.args_completed_at, telemetry_tool_calls.args_completed_at),
				execution_started_at = COALESCE(excluded.execution_started_at, telemetry_tool_calls.execution_started_at),
				execution_ended_at = COALESCE(excluded.execution_ended_at, telemetry_tool_calls.execution_ended_at),
				duration_ms = COALESCE(excluded.duration_ms, telemetry_tool_calls.duration_ms),
				args_bytes = excluded.args_bytes,
				parse_status = excluded.parse_status,
				safe_arg_keys_json = excluded.safe_arg_keys_json,
				event_stream_id = COALESCE(excluded.event_stream_id, telemetry_tool_calls.event_stream_id),
				event_id = COALESCE(excluded.event_id, telemetry_tool_calls.event_id),
				payload_ref = COALESCE(excluded.payload_ref, telemetry_tool_calls.payload_ref),
				run_id = COALESCE(excluded.run_id, telemetry_tool_calls.run_id),
				error_category = COALESCE(excluded.error_category, telemetry_tool_calls.error_category),
				error_message = COALESCE(excluded.error_message, telemetry_tool_calls.error_message),
				retention_class = excluded.retention_class,
				updated_at = excluded.updated_at
		`).run(
			input.toolCallId,
			input.piboSessionId,
			input.rootSessionId ?? null,
			input.roomId ?? null,
			input.turnId,
			input.providerRequestId ?? null,
			input.providerItemId ?? null,
			input.outputIndex ?? null,
			input.toolName,
			input.status ?? existing?.status ?? "args_started",
			input.argsStartedAt ?? null,
			input.firstDeltaAt ?? null,
			input.lastDeltaAt ?? null,
			input.argsCompletedAt ?? null,
			input.executionStartedAt ?? null,
			input.executionEndedAt ?? null,
			input.durationMs ?? null,
			input.argsBytes ?? existing?.argsBytes ?? 0,
			input.parseStatus ?? existing?.parseStatus ?? "empty",
			JSON.stringify(input.safeArgKeys ?? existing?.safeArgKeys ?? []),
			input.eventStreamId ?? null,
			input.eventId ?? null,
			input.payloadRef ?? null,
			input.runId ?? null,
			input.errorCategory ?? null,
			input.errorMessage ?? null,
			input.retentionClass ?? existing?.retentionClass ?? "diagnostic",
			input.createdAt ?? existing?.createdAt ?? now,
			now,
		);
		return this.getToolCall(input.toolCallId) ?? fail(`Failed to upsert telemetry tool call ${input.toolCallId}`);
	}

	getTurn(turnId: string): StoredTelemetryTurn | undefined {
		const row = this.db.prepare("SELECT * FROM telemetry_turns WHERE turn_id = ?").get(turnId) as TelemetryTurnRow | undefined;
		return row ? turnFromRow(row) : undefined;
	}

	getPhase(phaseId: string): StoredTelemetryPhase | undefined {
		const row = this.db.prepare("SELECT * FROM telemetry_phases WHERE phase_id = ?").get(phaseId) as TelemetryPhaseRow | undefined;
		return row ? phaseFromRow(row) : undefined;
	}

	getProviderRequest(providerRequestId: string): StoredTelemetryProviderRequest | undefined {
		const row = this.db.prepare("SELECT * FROM telemetry_provider_requests WHERE provider_request_id = ?").get(providerRequestId) as TelemetryProviderRequestRow | undefined;
		return row ? providerRequestFromRow(row) : undefined;
	}

	getProviderEvent(rawEventId: string): StoredTelemetryProviderEvent | undefined {
		const row = this.db.prepare("SELECT * FROM telemetry_provider_events WHERE raw_event_id = ?").get(rawEventId) as TelemetryProviderEventRow | undefined;
		return row ? providerEventFromRow(row) : undefined;
	}

	listProviderEvents(providerRequestId: string, input: TelemetryProviderEventListOptions = {}): StoredTelemetryProviderEvent[] {
		return this.listProviderEventsPage(providerRequestId, input).rows;
	}

	getToolCall(toolCallId: string): StoredTelemetryToolCall | undefined {
		const row = this.db.prepare("SELECT * FROM telemetry_tool_calls WHERE tool_call_id = ?").get(toolCallId) as TelemetryToolCallRow | undefined;
		return row ? toolCallFromRow(row) : undefined;
	}

	getPayloadPreview(_previewRef: string, _maxBytes = 2048): TelemetryPreviewUnavailableResult {
		return {
			status: "disabled",
			reason: "preview_capture_disabled",
			captureMode: "disabled",
			message: "Telemetry payload previews are disabled in V1; summaries store metadata and links only.",
		};
	}

	private nextProviderEventSequence(providerRequestId: string): number {
		const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM telemetry_provider_events WHERE provider_request_id = ?").get(providerRequestId) as { next_sequence: number };
		return row.next_sequence;
	}

	private incrementProviderCounters(providerRequestId: string, eventType: string, receivedAt: string, byteSize: number, parseStatus: TelemetryProviderEventParseStatus, normalizedDelta: number): void {
		this.recordProviderProgress({
			providerRequestId,
			lastRawEventAt: receivedAt,
			rawEventCount: 1,
			normalizedEventCount: normalizedDelta,
			parseErrorCount: parseStatus === "invalid_json" ? 1 : 0,
			unknownEventCount: parseStatus === "unknown_type" ? 1 : 0,
			bytesReceived: byteSize,
			eventTypeCounts: { [eventType]: 1 },
			updatedAt: receivedAt,
		});
	}
}

export class BestEffortTelemetryService {
	constructor(private readonly store?: TelemetryStore, private readonly onError?: (error: unknown) => void) {}

	upsertTurn(input: TelemetryTurnUpsertInput): StoredTelemetryTurn | undefined {
		return this.safe(() => this.store?.upsertTurn(input));
	}

	upsertPhase(input: TelemetryPhaseUpsertInput): StoredTelemetryPhase | undefined {
		return this.safe(() => this.store?.upsertPhase(input));
	}

	finishPhase(phaseId: string, input: TelemetryPhaseFinishInput = {}): StoredTelemetryPhase | undefined {
		return this.safe(() => this.store?.finishPhase(phaseId, input));
	}

	upsertProviderRequest(input: TelemetryProviderRequestUpsertInput): StoredTelemetryProviderRequest | undefined {
		return this.safe(() => this.store?.upsertProviderRequest(input));
	}

	recordProviderEventSummary(input: TelemetryProviderEventInput): void {
		this.safe(() => this.store?.recordProviderEventSummary(input));
	}

	recordProviderProgress(input: TelemetryProviderProgressInput): StoredTelemetryProviderRequest | undefined {
		return this.safe(() => this.store?.recordProviderProgress(input));
	}

	appendProviderEventSummary(input: TelemetryProviderEventInput): StoredTelemetryProviderEvent | undefined {
		return this.safe(() => this.store?.appendProviderEventSummary(input));
	}

	upsertToolCall(input: TelemetryToolCallUpsertInput): StoredTelemetryToolCall | undefined {
		return this.safe(() => this.store?.upsertToolCall(input));
	}

	private safe<T>(action: () => T): T | undefined {
		try {
			return action();
		} catch (error) {
			this.onError?.(error);
			return undefined;
		}
	}
}

function isTerminalProviderRequestStatus(status: TelemetryProviderRequestStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted" || status === "timeout";
}

function fail(message: string): never {
	throw new Error(message);
}
