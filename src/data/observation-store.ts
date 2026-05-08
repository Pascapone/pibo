import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";

export type ObservationInput = {
	id?: string;
	sessionId: string;
	sequence?: number;
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	parentObservationId?: string;
	turnId?: string;
	eventStreamId?: number;
	kind: string;
	role?: string;
	name?: string;
	status?: string;
	startedAt?: string;
	endedAt?: string;
	latencyMs?: number;
	modelProvider?: string;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	previewText?: string;
	payloadRef?: string;
	attributes?: PiboJsonObject;
};

export type ObservationRecord = Required<Pick<ObservationInput, "id" | "sessionId" | "sequence" | "kind" | "status" | "startedAt">> & Omit<ObservationInput, "id" | "sessionId" | "sequence" | "kind" | "status" | "startedAt"> & { attributes: PiboJsonObject };

type ObservationRow = {
	id: string; session_id: string; sequence: number; trace_id: string | null; span_id: string | null; parent_span_id: string | null; parent_observation_id: string | null; turn_id: string | null; event_stream_id: number | null; kind: string; role: string | null; name: string | null; status: string; started_at: string; ended_at: string | null; latency_ms: number | null; model_provider: string | null; model_id: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; preview_text: string | null; payload_ref: string | null; attributes_json: string;
};

export class ObservationStore {
	constructor(private readonly db: DatabaseSync) {}

	insertObservation(input: ObservationInput): ObservationRecord {
		const sequence = input.sequence ?? this.nextSequence(input.sessionId);
		const startedAt = input.startedAt ?? new Date().toISOString();
		const id = input.id ?? `obs_${randomUUID()}`;
		this.db.prepare(`INSERT OR IGNORE INTO observations (
			id, session_id, sequence, trace_id, span_id, parent_span_id, parent_observation_id, turn_id, event_stream_id,
			kind, role, name, status, started_at, ended_at, latency_ms, model_provider, model_id, input_tokens, output_tokens,
			cost_usd, preview_text, payload_ref, attributes_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			id, input.sessionId, sequence, input.traceId ?? null, input.spanId ?? null, input.parentSpanId ?? null,
			input.parentObservationId ?? null, input.turnId ?? null, input.eventStreamId ?? null, input.kind, input.role ?? null,
			input.name ?? null, input.status ?? "completed", startedAt, input.endedAt ?? null, input.latencyMs ?? null,
			input.modelProvider ?? null, input.modelId ?? null, input.inputTokens ?? null, input.outputTokens ?? null,
			input.costUsd ?? null, input.previewText ?? null, input.payloadRef ?? null, JSON.stringify(input.attributes ?? {}),
		);
		return this.getObservation(id) ?? this.listObservations(input.sessionId).find((row) => row.sequence === sequence)!;
	}

	appendObservation(input: ObservationInput): ObservationRecord {
		return this.insertObservation(input);
	}

	getObservation(id: string): ObservationRecord | undefined {
		const row = this.db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as ObservationRow | undefined;
		return row ? mapRow(row) : undefined;
	}

	listObservations(sessionId: string, limit = 200): ObservationRecord[] {
		return (this.db.prepare("SELECT * FROM observations WHERE session_id = ? ORDER BY sequence ASC LIMIT ?").all(sessionId, limit) as ObservationRow[]).map(mapRow);
	}

	listSession(sessionId: string, limit = 200): ObservationRecord[] {
		return this.listObservations(sessionId, limit);
	}

	private nextSequence(sessionId: string): number {
		const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM observations WHERE session_id = ?").get(sessionId) as { next_sequence: number };
		return row.next_sequence;
	}
}

function mapRow(row: ObservationRow): ObservationRecord {
	return {
		id: row.id, sessionId: row.session_id, sequence: row.sequence, traceId: row.trace_id ?? undefined, spanId: row.span_id ?? undefined,
		parentSpanId: row.parent_span_id ?? undefined, parentObservationId: row.parent_observation_id ?? undefined, turnId: row.turn_id ?? undefined,
		eventStreamId: row.event_stream_id ?? undefined, kind: row.kind, role: row.role ?? undefined, name: row.name ?? undefined,
		status: row.status, startedAt: row.started_at, endedAt: row.ended_at ?? undefined, latencyMs: row.latency_ms ?? undefined,
		modelProvider: row.model_provider ?? undefined, modelId: row.model_id ?? undefined, inputTokens: row.input_tokens ?? undefined,
		outputTokens: row.output_tokens ?? undefined, costUsd: row.cost_usd ?? undefined, previewText: row.preview_text ?? undefined,
		payloadRef: row.payload_ref ?? undefined, attributes: JSON.parse(row.attributes_json) as PiboJsonObject,
	};
}
