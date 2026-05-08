import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";

export type PiboEventLogAppendInput = {
	sessionId?: string;
	sessionSequence?: number;
	roomId?: string;
	topic: string;
	type: string;
	source: string;
	actorType?: string;
	actorId?: string;
	turnId?: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	workflowRunId?: string;
	idempotencyKey?: string;
	retentionClass: string;
	payloadRef?: string;
	previewText?: string;
	attributes?: PiboJsonObject;
	createdAt?: string;
	indexedAt?: string;
};

export type StoredPiboEventLogRow = {
	streamId: number;
	sessionId?: string;
	sessionSequence?: number;
	roomId?: string;
	topic: string;
	type: string;
	source: string;
	actorType?: string;
	actorId?: string;
	turnId?: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	workflowRunId?: string;
	idempotencyKey?: string;
	retentionClass: string;
	payloadRef?: string;
	previewText?: string;
	attributes: PiboJsonObject;
	createdAt: string;
	indexedAt?: string;
};

export type PiboEventLogListInput = {
	sessionId?: string;
	roomId?: string;
	topic?: string;
	afterStreamId?: number;
	limit?: number;
};

type EventLogRow = {
	stream_id: number;
	session_id: string | null;
	session_sequence: number | null;
	room_id: string | null;
	topic: string;
	type: string;
	source: string;
	actor_type: string | null;
	actor_id: string | null;
	turn_id: string | null;
	event_id: string | null;
	tool_call_id: string | null;
	run_id: string | null;
	workflow_run_id: string | null;
	idempotency_key: string | null;
	retention_class: string;
	payload_ref: string | null;
	preview_text: string | null;
	attributes_json: string;
	created_at: string;
	indexed_at: string | null;
};

export class PiboEventLogStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	appendEvent(input: PiboEventLogAppendInput): StoredPiboEventLogRow {
		if (input.idempotencyKey) {
			const existing = this.findByIdempotencyKey(input.idempotencyKey);
			if (existing) return existing;
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const eventId = input.eventId ?? `evt_${randomUUID()}`;
		const result = this.db.prepare(`
			INSERT OR IGNORE INTO event_log (
				session_id,
				session_sequence,
				room_id,
				topic,
				type,
				source,
				actor_type,
				actor_id,
				turn_id,
				event_id,
				tool_call_id,
				run_id,
				workflow_run_id,
				idempotency_key,
				retention_class,
				payload_ref,
				preview_text,
				attributes_json,
				created_at,
				indexed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			input.sessionId ?? null,
			input.sessionSequence ?? null,
			input.roomId ?? null,
			input.topic,
			input.type,
			input.source,
			input.actorType ?? null,
			input.actorId ?? null,
			input.turnId ?? null,
			eventId,
			input.toolCallId ?? null,
			input.runId ?? null,
			input.workflowRunId ?? null,
			input.idempotencyKey ?? null,
			input.retentionClass,
			input.payloadRef ?? null,
			input.previewText ?? null,
			JSON.stringify(input.attributes ?? {}),
			createdAt,
			input.indexedAt ?? null,
		);
		if (input.idempotencyKey) {
			const existing = this.findByIdempotencyKey(input.idempotencyKey);
			if (existing) return existing;
		}
		const stored = this.findByStreamId(Number(result.lastInsertRowid));
		if (!stored) throw new Error(`Failed to append event log row \"${eventId}\"`);
		return stored;
	}

	listEvents(input: PiboEventLogListInput = {}): StoredPiboEventLogRow[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.sessionId) {
			clauses.push("session_id = ?");
			values.push(input.sessionId);
		}
		if (input.roomId) {
			clauses.push("room_id = ?");
			values.push(input.roomId);
		}
		if (input.topic) {
			clauses.push("topic = ?");
			values.push(input.topic);
		}
		if (input.afterStreamId !== undefined) {
			clauses.push("stream_id > ?");
			values.push(input.afterStreamId);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
		const rows = this.db.prepare(`SELECT * FROM event_log ${where} ORDER BY stream_id ASC LIMIT ?`).all(...values, limit) as EventLogRow[];
		return rows.map(eventLogFromRow);
	}

	findByIdempotencyKey(idempotencyKey: string): StoredPiboEventLogRow | undefined {
		const row = this.db.prepare("SELECT * FROM event_log WHERE idempotency_key = ? LIMIT 1").get(idempotencyKey) as EventLogRow | undefined;
		return row ? eventLogFromRow(row) : undefined;
	}

	private findByStreamId(streamId: number): StoredPiboEventLogRow | undefined {
		const row = this.db.prepare("SELECT * FROM event_log WHERE stream_id = ?").get(streamId) as EventLogRow | undefined;
		return row ? eventLogFromRow(row) : undefined;
	}
}

function eventLogFromRow(row: EventLogRow): StoredPiboEventLogRow {
	return {
		streamId: row.stream_id,
		sessionId: row.session_id ?? undefined,
		sessionSequence: row.session_sequence ?? undefined,
		roomId: row.room_id ?? undefined,
		topic: row.topic,
		type: row.type,
		source: row.source,
		actorType: row.actor_type ?? undefined,
		actorId: row.actor_id ?? undefined,
		turnId: row.turn_id ?? undefined,
		eventId: row.event_id ?? undefined,
		toolCallId: row.tool_call_id ?? undefined,
		runId: row.run_id ?? undefined,
		workflowRunId: row.workflow_run_id ?? undefined,
		idempotencyKey: row.idempotency_key ?? undefined,
		retentionClass: row.retention_class,
		payloadRef: row.payload_ref ?? undefined,
		previewText: row.preview_text ?? undefined,
		attributes: JSON.parse(row.attributes_json) as PiboJsonObject,
		createdAt: row.created_at,
		indexedAt: row.indexed_at ?? undefined,
	};
}
