import type { PiboJsonObject } from "../core/events.js";
import type { TelemetryCaptureMode } from "./telemetry-preview.js";
import type {
	StoredTelemetryPhase,
	StoredTelemetryProviderEvent,
	StoredTelemetryProviderRequest,
	StoredTelemetryToolCall,
	StoredTelemetryTurn,
	TelemetryPhaseName,
	TelemetryPhaseStatus,
	TelemetryProviderEventParseStatus,
	TelemetryProviderRequestStatus,
	TelemetryProviderTransport,
	TelemetryRetentionClass,
	TelemetryToolArgsParseStatus,
	TelemetryToolCallStatus,
	TelemetryTurnSource,
	TelemetryTurnStatus,
} from "./telemetry.js";

export type TelemetryTurnRow = {
	turn_id: string;
	pibo_session_id: string;
	root_session_id: string | null;
	room_id: string | null;
	input_event_id: string | null;
	event_id: string | null;
	event_stream_id: number | null;
	payload_ref: string | null;
	run_id: string | null;
	source: TelemetryTurnSource;
	status: TelemetryTurnStatus;
	current_phase: string | null;
	queued_at: string;
	started_at: string | null;
	completed_at: string | null;
	last_progress_at: string | null;
	queued_behind: number | null;
	queue_depth: number | null;
	summary: string | null;
	retention_class: TelemetryRetentionClass;
	created_at: string;
	updated_at: string;
	metadata_json: string;
};

export type TelemetryPhaseRow = {
	phase_id: string;
	turn_id: string;
	pibo_session_id: string;
	root_session_id: string | null;
	room_id: string | null;
	name: TelemetryPhaseName;
	status: TelemetryPhaseStatus;
	started_at: string;
	ended_at: string | null;
	last_progress_at: string | null;
	duration_ms: number | null;
	provider_request_id: string | null;
	tool_call_id: string | null;
	event_stream_id: number | null;
	event_id: string | null;
	payload_ref: string | null;
	run_id: string | null;
	counters_json: string;
	summary: string | null;
	retention_class: TelemetryRetentionClass;
	created_at: string;
	updated_at: string;
};

export type TelemetryProviderRequestRow = {
	provider_request_id: string;
	pibo_session_id: string;
	root_session_id: string | null;
	room_id: string | null;
	turn_id: string;
	phase_id: string | null;
	provider: string;
	api: string;
	model: string;
	transport: TelemetryProviderTransport;
	service_tier: string | null;
	status: TelemetryProviderRequestStatus;
	started_at: string;
	response_headers_at: string | null;
	first_byte_at: string | null;
	last_raw_event_at: string | null;
	last_normalized_event_at: string | null;
	completed_at: string | null;
	http_status: number | null;
	upstream_response_id: string | null;
	raw_event_count: number;
	normalized_event_count: number;
	parse_error_count: number;
	unknown_event_count: number;
	bytes_received: number | null;
	event_type_counts_json: string;
	event_stream_id: number | null;
	event_id: string | null;
	payload_ref: string | null;
	error_category: string | null;
	error_message: string | null;
	capture_mode: TelemetryCaptureMode;
	retention_class: TelemetryRetentionClass;
	created_at: string;
	updated_at: string;
};

export type TelemetryProviderEventRow = {
	raw_event_id: string;
	provider_request_id: string;
	pibo_session_id: string | null;
	turn_id: string | null;
	phase_id: string | null;
	sequence: number;
	received_at: string;
	event_type: string;
	byte_size: number;
	parse_status: TelemetryProviderEventParseStatus;
	normalized_type: string | null;
	event_stream_id: number | null;
	event_id: string | null;
	item_id: string | null;
	tool_call_id: string | null;
	payload_ref: string | null;
	payload_preview_ref: string | null;
	safe_fields_json: string;
	retention_class: TelemetryRetentionClass;
	created_at: string;
	updated_at: string;
};

export type TelemetryToolCallRow = {
	tool_call_id: string;
	pibo_session_id: string;
	root_session_id: string | null;
	room_id: string | null;
	turn_id: string;
	provider_request_id: string | null;
	provider_item_id: string | null;
	output_index: number | null;
	tool_name: string;
	status: TelemetryToolCallStatus;
	args_started_at: string | null;
	first_delta_at: string | null;
	last_delta_at: string | null;
	args_completed_at: string | null;
	execution_started_at: string | null;
	execution_ended_at: string | null;
	duration_ms: number | null;
	args_bytes: number;
	parse_status: TelemetryToolArgsParseStatus;
	safe_arg_keys_json: string;
	event_stream_id: number | null;
	event_id: string | null;
	payload_ref: string | null;
	run_id: string | null;
	error_category: string | null;
	error_message: string | null;
	retention_class: TelemetryRetentionClass;
	created_at: string;
	updated_at: string;
};

export function turnFromRow(row: TelemetryTurnRow): StoredTelemetryTurn {
	return {
		turnId: row.turn_id,
		piboSessionId: row.pibo_session_id,
		rootSessionId: row.root_session_id ?? undefined,
		roomId: row.room_id ?? undefined,
		inputEventId: row.input_event_id ?? undefined,
		eventId: row.event_id ?? undefined,
		eventStreamId: row.event_stream_id ?? undefined,
		payloadRef: row.payload_ref ?? undefined,
		runId: row.run_id ?? undefined,
		source: row.source,
		status: row.status,
		currentPhase: row.current_phase ?? undefined,
		queuedAt: row.queued_at,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		lastProgressAt: row.last_progress_at ?? undefined,
		queuedBehind: row.queued_behind ?? undefined,
		queueDepth: row.queue_depth ?? undefined,
		summary: row.summary ?? undefined,
		retentionClass: row.retention_class,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		metadata: parseJsonObject(row.metadata_json),
	};
}

export function phaseFromRow(row: TelemetryPhaseRow): StoredTelemetryPhase {
	return {
		phaseId: row.phase_id,
		turnId: row.turn_id,
		piboSessionId: row.pibo_session_id,
		rootSessionId: row.root_session_id ?? undefined,
		roomId: row.room_id ?? undefined,
		name: row.name,
		status: row.status,
		startedAt: row.started_at,
		endedAt: row.ended_at ?? undefined,
		lastProgressAt: row.last_progress_at ?? undefined,
		durationMs: row.duration_ms ?? undefined,
		providerRequestId: row.provider_request_id ?? undefined,
		toolCallId: row.tool_call_id ?? undefined,
		eventStreamId: row.event_stream_id ?? undefined,
		eventId: row.event_id ?? undefined,
		payloadRef: row.payload_ref ?? undefined,
		runId: row.run_id ?? undefined,
		counters: parseJsonObject(row.counters_json),
		summary: row.summary ?? undefined,
		retentionClass: row.retention_class,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function providerRequestFromRow(row: TelemetryProviderRequestRow): StoredTelemetryProviderRequest {
	return {
		providerRequestId: row.provider_request_id,
		piboSessionId: row.pibo_session_id,
		rootSessionId: row.root_session_id ?? undefined,
		roomId: row.room_id ?? undefined,
		turnId: row.turn_id,
		phaseId: row.phase_id ?? undefined,
		provider: row.provider,
		api: row.api,
		model: row.model,
		transport: row.transport,
		serviceTier: row.service_tier ?? undefined,
		status: row.status,
		startedAt: row.started_at,
		responseHeadersAt: row.response_headers_at ?? undefined,
		firstByteAt: row.first_byte_at ?? undefined,
		lastRawEventAt: row.last_raw_event_at ?? undefined,
		lastNormalizedEventAt: row.last_normalized_event_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		httpStatus: row.http_status ?? undefined,
		upstreamResponseId: row.upstream_response_id ?? undefined,
		rawEventCount: row.raw_event_count,
		normalizedEventCount: row.normalized_event_count,
		parseErrorCount: row.parse_error_count,
		unknownEventCount: row.unknown_event_count,
		bytesReceived: row.bytes_received ?? undefined,
		eventTypeCounts: parseJsonObject(row.event_type_counts_json),
		eventStreamId: row.event_stream_id ?? undefined,
		eventId: row.event_id ?? undefined,
		payloadRef: row.payload_ref ?? undefined,
		errorCategory: row.error_category ?? undefined,
		errorMessage: row.error_message ?? undefined,
		captureMode: row.capture_mode,
		retentionClass: row.retention_class,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function providerEventFromRow(row: TelemetryProviderEventRow): StoredTelemetryProviderEvent {
	return {
		rawEventId: row.raw_event_id,
		providerRequestId: row.provider_request_id,
		piboSessionId: row.pibo_session_id ?? undefined,
		turnId: row.turn_id ?? undefined,
		phaseId: row.phase_id ?? undefined,
		sequence: row.sequence,
		receivedAt: row.received_at,
		eventType: row.event_type,
		byteSize: row.byte_size,
		parseStatus: row.parse_status,
		normalizedType: row.normalized_type ?? undefined,
		eventStreamId: row.event_stream_id ?? undefined,
		eventId: row.event_id ?? undefined,
		itemId: row.item_id ?? undefined,
		toolCallId: row.tool_call_id ?? undefined,
		payloadRef: row.payload_ref ?? undefined,
		payloadPreviewRef: row.payload_preview_ref ?? undefined,
		safeFields: parseJsonObject(row.safe_fields_json),
		retentionClass: row.retention_class,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function toolCallFromRow(row: TelemetryToolCallRow): StoredTelemetryToolCall {
	return {
		toolCallId: row.tool_call_id,
		piboSessionId: row.pibo_session_id,
		rootSessionId: row.root_session_id ?? undefined,
		roomId: row.room_id ?? undefined,
		turnId: row.turn_id,
		providerRequestId: row.provider_request_id ?? undefined,
		providerItemId: row.provider_item_id ?? undefined,
		outputIndex: row.output_index ?? undefined,
		toolName: row.tool_name,
		status: row.status,
		argsStartedAt: row.args_started_at ?? undefined,
		firstDeltaAt: row.first_delta_at ?? undefined,
		lastDeltaAt: row.last_delta_at ?? undefined,
		argsCompletedAt: row.args_completed_at ?? undefined,
		executionStartedAt: row.execution_started_at ?? undefined,
		executionEndedAt: row.execution_ended_at ?? undefined,
		durationMs: row.duration_ms ?? undefined,
		argsBytes: row.args_bytes,
		parseStatus: row.parse_status,
		safeArgKeys: parseStringArray(row.safe_arg_keys_json),
		eventStreamId: row.event_stream_id ?? undefined,
		eventId: row.event_id ?? undefined,
		payloadRef: row.payload_ref ?? undefined,
		runId: row.run_id ?? undefined,
		errorCategory: row.error_category ?? undefined,
		errorMessage: row.error_message ?? undefined,
		retentionClass: row.retention_class,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseJsonObject(text: string): PiboJsonObject {
	const parsed = JSON.parse(text) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PiboJsonObject) : {};
}

function parseStringArray(text: string): string[] {
	const parsed = JSON.parse(text) as unknown;
	return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}
