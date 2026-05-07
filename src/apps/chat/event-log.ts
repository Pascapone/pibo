import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../../core/pibo-home.js";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PiboJsonValue, PiboOutputEvent } from "../../core/events.js";
import { isLiveOnlyOutputEvent } from "./output-event-policy.js";

export type ChatRetentionClass = "live_delta" | "trace_event" | "chat_message" | "audit_event";

export type ChatEventActorType = "user" | "assistant" | "system" | "agent";

export type ChatEventAppendInput = {
	roomId?: string;
	piboSessionId?: string;
	eventId?: string;
	eventType: string;
	actorType?: ChatEventActorType;
	actorId?: string;
	clientTxnId?: string;
	retentionClass: ChatRetentionClass;
	payload: PiboJsonValue;
	createdAt?: string;
};

export type StoredChatEvent = {
	streamId: number;
	roomId?: string;
	piboSessionId?: string;
	eventId: string;
	eventType: string;
	actorType?: ChatEventActorType;
	actorId?: string;
	clientTxnId?: string;
	createdAt: string;
	retentionClass: ChatRetentionClass;
	payload: PiboJsonValue;
};

export type ChatEventListInput = {
	roomId?: string;
	piboSessionId?: string;
	afterStreamId?: number;
	limit?: number;
};

export type ChatUnreadCountInput = {
	roomId?: string;
	piboSessionId?: string;
	principalId: string;
	afterStreamId?: number;
};

export type ChatRetentionPolicy = {
	id: string;
	deleteLiveDeltasAfterMs?: number;
	deleteTraceEventsAfterMs?: number;
	deleteChatMessagesAfterMs?: number;
};

type ChatEventRow = {
	stream_id: number;
	room_id: string | null;
	pibo_session_id: string | null;
	event_id: string;
	event_type: string;
	actor_type: string | null;
	actor_id: string | null;
	client_txn_id: string | null;
	created_at: string;
	retention_class: ChatRetentionClass;
	payload_json: string;
};

type RetentionPolicyRow = {
	id: string;
	delete_live_deltas_after_ms: number | null;
	delete_trace_events_after_ms: number | null;
	delete_chat_messages_after_ms: number | null;
};

type SessionReadCursorRow = {
	pibo_session_id: string;
	principal_id: string;
	last_read_stream_id: number;
	updated_at: string;
};

export class ChatEventLog {
	private readonly db: DatabaseSync;
	private readonly appendEventStatement: StatementSync;
	private readonly selectEventByStreamIdStatement: StatementSync;
	private readonly selectEventByClientTxnStatement: StatementSync;
	private readonly latestStreamStatements: {
		all: StatementSync;
		room: StatementSync;
		session: StatementSync;
		roomSession: StatementSync;
	};
	private readonly getSessionReadCursorStatement: StatementSync;
	private readonly markSessionReadStatement: StatementSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}

		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_events (
				stream_id INTEGER PRIMARY KEY,
				room_id TEXT,
				pibo_session_id TEXT,
				event_id TEXT NOT NULL,
				event_type TEXT NOT NULL,
				actor_type TEXT,
				actor_id TEXT,
				client_txn_id TEXT,
				created_at TEXT NOT NULL,
				retention_class TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_chat_events_room_stream
				ON chat_events(room_id, stream_id);
			CREATE INDEX IF NOT EXISTS idx_chat_events_session_stream
				ON chat_events(pibo_session_id, stream_id);
			CREATE INDEX IF NOT EXISTS idx_chat_events_session_type_event
				ON chat_events(pibo_session_id, event_type, event_id);
			CREATE INDEX IF NOT EXISTS idx_chat_events_event_id
				ON chat_events(event_id);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_events_client_txn
				ON chat_events(room_id, actor_id, client_txn_id)
				WHERE client_txn_id IS NOT NULL;

			CREATE TABLE IF NOT EXISTS chat_retention_policies (
				id TEXT PRIMARY KEY,
				delete_live_deltas_after_ms INTEGER,
				delete_trace_events_after_ms INTEGER,
				delete_chat_messages_after_ms INTEGER
			);

			CREATE TABLE IF NOT EXISTS chat_session_reads (
				pibo_session_id TEXT NOT NULL,
				principal_id TEXT NOT NULL,
				last_read_stream_id INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(pibo_session_id, principal_id)
			);
		`);

		this.appendEventStatement = this.db.prepare(`
			INSERT OR IGNORE INTO chat_events (
				room_id,
				pibo_session_id,
				event_id,
				event_type,
				actor_type,
				actor_id,
				client_txn_id,
				created_at,
				retention_class,
				payload_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.selectEventByStreamIdStatement = this.db.prepare("SELECT * FROM chat_events WHERE stream_id = ?");
		this.selectEventByClientTxnStatement = this.db.prepare(`
			SELECT * FROM chat_events
			WHERE room_id = ? AND actor_id = ? AND client_txn_id = ?
			ORDER BY stream_id ASC
			LIMIT 1
		`);
		this.latestStreamStatements = {
			all: this.db.prepare("SELECT MAX(stream_id) AS stream_id FROM chat_events"),
			room: this.db.prepare("SELECT MAX(stream_id) AS stream_id FROM chat_events WHERE room_id = ?"),
			session: this.db.prepare("SELECT MAX(stream_id) AS stream_id FROM chat_events WHERE pibo_session_id = ?"),
			roomSession: this.db.prepare("SELECT MAX(stream_id) AS stream_id FROM chat_events WHERE room_id = ? AND pibo_session_id = ?"),
		};
		this.getSessionReadCursorStatement = this.db.prepare("SELECT * FROM chat_session_reads WHERE pibo_session_id = ? AND principal_id = ?");
		this.markSessionReadStatement = this.db.prepare(`
			INSERT INTO chat_session_reads (pibo_session_id, principal_id, last_read_stream_id, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(pibo_session_id, principal_id) DO UPDATE SET
				last_read_stream_id = excluded.last_read_stream_id,
				updated_at = excluded.updated_at
			WHERE excluded.last_read_stream_id > chat_session_reads.last_read_stream_id
		`);
	}

	appendEvent(input: ChatEventAppendInput): StoredChatEvent {
		const eventId = input.eventId ?? `ce_${randomUUID()}`;
		const createdAt = input.createdAt ?? new Date().toISOString();
		const payloadJson = JSON.stringify(input.payload);
		const result = this.appendEventStatement.run(
				input.roomId ?? null,
				input.piboSessionId ?? null,
				eventId,
				input.eventType,
				input.actorType ?? null,
				input.actorId ?? null,
				input.clientTxnId ?? null,
				createdAt,
				input.retentionClass,
				payloadJson,
			);

		if (input.clientTxnId) {
			const existing = this.findByClientTxn(input.roomId, input.actorId, input.clientTxnId);
			if (existing) return existing;
		}

		const streamId = Number(result.lastInsertRowid);
		const stored = this.selectEventByStreamIdStatement.get(streamId) as ChatEventRow | undefined;
		if (!stored) throw new Error(`Failed to append chat event "${eventId}"`);
		return eventFromRow(stored);
	}

	appendOutputEvent(event: PiboOutputEvent, input: { roomId?: string; actorId?: string } = {}): StoredChatEvent | undefined {
		if (isLiveOnlyOutputEvent(event)) return undefined;
		return this.appendEvent({
			roomId: input.roomId,
			piboSessionId: event.piboSessionId,
			eventId: "eventId" in event && event.eventId ? `pibo:${event.piboSessionId}:${event.eventId}` : undefined,
			eventType: event.type,
			actorType: actorTypeForOutputEvent(event),
			actorId: input.actorId,
			retentionClass: retentionClassForOutputEvent(event),
			payload: event as PiboJsonValue,
		});
	}

	listEvents(input: ChatEventListInput = {}): StoredChatEvent[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.roomId) {
			clauses.push("room_id = ?");
			values.push(input.roomId);
		}
		if (input.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(input.piboSessionId);
		}
		if (input.afterStreamId !== undefined) {
			clauses.push("stream_id > ?");
			values.push(input.afterStreamId);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.min(input.limit ?? 1000, 5000));
		const rows = this.db
			.prepare(`SELECT * FROM chat_events ${where} ORDER BY stream_id ASC LIMIT ?`)
			.all(...values, limit) as ChatEventRow[];
		return rows.map(eventFromRow);
	}

	countEventsByType(input: { piboSessionId?: string; eventTypes?: string[] } = {}): Array<{ eventType: string; count: number }> {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(input.piboSessionId);
		}
		if (input.eventTypes?.length) {
			clauses.push(`event_type IN (${input.eventTypes.map(() => "?").join(", ")})`);
			values.push(...input.eventTypes);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT event_type, COUNT(*) AS count FROM chat_events ${where} GROUP BY event_type ORDER BY event_type`)
			.all(...values) as Array<{ event_type: string; count: number }>;
		return rows.map((row) => ({ eventType: row.event_type, count: Number(row.count) }));
	}

	getEvent(streamId: number): StoredChatEvent | undefined {
		const row = this.selectEventByStreamIdStatement.get(streamId) as ChatEventRow | undefined;
		return row ? eventFromRow(row) : undefined;
	}

	findByClientTxn(roomId: string | undefined, actorId: string | undefined, clientTxnId: string): StoredChatEvent | undefined {
		if (!roomId || !actorId) return undefined;
		const row = this.selectEventByClientTxnStatement.get(roomId, actorId, clientTxnId) as ChatEventRow | undefined;
		return row ? eventFromRow(row) : undefined;
	}

	getLatestStreamId(input: { roomId?: string; piboSessionId?: string } = {}): number | undefined {
		const row = (input.roomId && input.piboSessionId
			? this.latestStreamStatements.roomSession.get(input.roomId, input.piboSessionId)
			: input.roomId
				? this.latestStreamStatements.room.get(input.roomId)
				: input.piboSessionId
					? this.latestStreamStatements.session.get(input.piboSessionId)
					: this.latestStreamStatements.all.get()) as { stream_id: number | null } | undefined;
		return row?.stream_id ?? undefined;
	}

	getSessionReadCursor(piboSessionId: string, principalId: string): number | undefined {
		const row = this.getSessionReadCursorStatement.get(piboSessionId, principalId) as SessionReadCursorRow | undefined;
		return row?.last_read_stream_id;
	}

	markSessionRead(piboSessionId: string, principalId: string, lastReadStreamId: number): void {
		this.markSessionReadStatement.run(piboSessionId, principalId, lastReadStreamId, new Date().toISOString());
	}

	countUnreadMessages(input: ChatUnreadCountInput): number {
		const assistantTurnId = `
			CASE
				WHEN event_id LIKE '%:assistant_message'
					THEN substr(event_id, 1, length(event_id) - length(':assistant_message'))
				ELSE event_id
			END
		`;
		const clauses: string[] = [
			"retention_class = 'chat_message'",
			`(
				event_type = 'user.message.accepted'
				OR (
					event_type = 'assistant_message'
					AND event_id IS NOT NULL
					AND EXISTS (
						SELECT 1 FROM chat_events done
						WHERE done.pibo_session_id = chat_events.pibo_session_id
							AND done.event_type = 'message_finished'
							AND (
								done.event_id = ${assistantTurnId}
								OR done.event_id = ${assistantTurnId} || ':message_finished'
							)
					)
				)
			)`,
			"(actor_type IS NULL OR actor_type != 'user' OR actor_id IS NULL OR actor_id != ?)",
		];
		const values: Array<string | number> = [input.principalId];
		if (input.roomId) {
			clauses.push("room_id = ?");
			values.push(input.roomId);
		}
		if (input.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(input.piboSessionId);
		}
		if (input.afterStreamId !== undefined) {
			clauses.push("stream_id > ?");
			values.push(input.afterStreamId);
		}
		const row = this.db
			.prepare(`
				SELECT COUNT(DISTINCT CASE
					WHEN event_type = 'assistant_message' THEN pibo_session_id || ':' || ${assistantTurnId}
					ELSE 'stream:' || stream_id
				END) AS count
				FROM chat_events
				WHERE ${clauses.join(" AND ")}
			`)
			.get(...values) as { count: number } | undefined;
		return Number(row?.count ?? 0);
	}

	countUnreadMessagesBySession(input: { piboSessionIds: string[]; principalId: string }): Map<string, number> {
		const counts = new Map<string, number>();
		if (input.piboSessionIds.length === 0) return counts;
		const uniqueIds = [...new Set(input.piboSessionIds)];
		for (let offset = 0; offset < uniqueIds.length; offset += 400) {
			const ids = uniqueIds.slice(offset, offset + 400);
			const placeholders = ids.map(() => "?").join(", ");
			const assistantTurnId = `
				CASE
					WHEN e.event_id LIKE '%:assistant_message'
						THEN substr(e.event_id, 1, length(e.event_id) - length(':assistant_message'))
					ELSE e.event_id
				END
			`;
			const rows = this.db
				.prepare(`
					SELECT e.pibo_session_id, COUNT(DISTINCT CASE
						WHEN e.event_type = 'assistant_message' THEN e.pibo_session_id || ':' || ${assistantTurnId}
						ELSE 'stream:' || e.stream_id
					END) AS count
					FROM chat_events e
					LEFT JOIN chat_session_reads reads
						ON reads.pibo_session_id = e.pibo_session_id AND reads.principal_id = ?
					WHERE e.pibo_session_id IN (${placeholders})
						AND e.retention_class = 'chat_message'
						AND e.stream_id > COALESCE(reads.last_read_stream_id, 0)
						AND (e.actor_type IS NULL OR e.actor_type != 'user' OR e.actor_id IS NULL OR e.actor_id != ?)
						AND (
							e.event_type = 'user.message.accepted'
							OR (
								e.event_type = 'assistant_message'
								AND e.event_id IS NOT NULL
								AND EXISTS (
									SELECT 1 FROM chat_events done
									WHERE done.pibo_session_id = e.pibo_session_id
										AND done.event_type = 'message_finished'
										AND (
											done.event_id = ${assistantTurnId}
											OR done.event_id = ${assistantTurnId} || ':message_finished'
										)
								)
							)
						)
					GROUP BY e.pibo_session_id
				`)
				.all(input.principalId, ...ids, input.principalId) as Array<{ pibo_session_id: string; count: number }>;
			for (const row of rows) {
				const count = Number(row.count ?? 0);
				if (count > 0) counts.set(row.pibo_session_id, count);
			}
		}
		return counts;
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		this.db.prepare(`DELETE FROM chat_session_reads WHERE pibo_session_id IN (${placeholders})`).run(...piboSessionIds);
		const result = this.db.prepare(`DELETE FROM chat_events WHERE pibo_session_id IN (${placeholders})`).run(...piboSessionIds);
		return Number(result.changes ?? 0);
	}

	deleteRooms(roomIds: string[]): number {
		if (!roomIds.length) return 0;
		const placeholders = roomIds.map(() => "?").join(", ");
		const result = this.db.prepare(`DELETE FROM chat_events WHERE room_id IN (${placeholders})`).run(...roomIds);
		return Number(result.changes ?? 0);
	}

	upsertRetentionPolicy(policy: ChatRetentionPolicy): ChatRetentionPolicy {
		this.db
			.prepare(`
				INSERT INTO chat_retention_policies (
					id,
					delete_live_deltas_after_ms,
					delete_trace_events_after_ms,
					delete_chat_messages_after_ms
				) VALUES (?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					delete_live_deltas_after_ms = excluded.delete_live_deltas_after_ms,
					delete_trace_events_after_ms = excluded.delete_trace_events_after_ms,
					delete_chat_messages_after_ms = excluded.delete_chat_messages_after_ms
			`)
			.run(
				policy.id,
				policy.deleteLiveDeltasAfterMs ?? null,
				policy.deleteTraceEventsAfterMs ?? null,
				policy.deleteChatMessagesAfterMs ?? null,
			);
		return this.getRetentionPolicy(policy.id) ?? policy;
	}

	getRetentionPolicy(id: string): ChatRetentionPolicy | undefined {
		const row = this.db.prepare("SELECT * FROM chat_retention_policies WHERE id = ?").get(id) as
			| RetentionPolicyRow
			| undefined;
		return row ? policyFromRow(row) : undefined;
	}

	purgeExpired(input: { now?: Date; policy?: ChatRetentionPolicy; batchSize?: number } = {}): number {
		const now = input.now ?? new Date();
		const policy: ChatRetentionPolicy = input.policy ?? this.getRetentionPolicy("default") ?? { id: "default" };
		const batchSize = Math.max(1, Math.min(input.batchSize ?? 500, 5000));
		const clauses: string[] = [];
		const values: string[] = [];
		addRetentionClause(clauses, values, "live_delta", policy.deleteLiveDeltasAfterMs, now);
		addRetentionClause(clauses, values, "trace_event", policy.deleteTraceEventsAfterMs, now);
		addRetentionClause(clauses, values, "chat_message", policy.deleteChatMessagesAfterMs, now);
		if (!clauses.length) return 0;
		const result = this.db
			.prepare(`
				DELETE FROM chat_events
				WHERE stream_id IN (
					SELECT stream_id FROM chat_events
					WHERE ${clauses.join(" OR ")}
					ORDER BY stream_id ASC
					LIMIT ${batchSize}
				)
			`)
			.run(...values);
		return Number(result.changes ?? 0);
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultChatEventLog(_cwd?: string): ChatEventLog {
	return new ChatEventLog(piboHomePath("web-chat.sqlite"));
}

function eventFromRow(row: ChatEventRow): StoredChatEvent {
	return {
		streamId: row.stream_id,
		roomId: row.room_id ?? undefined,
		piboSessionId: row.pibo_session_id ?? undefined,
		eventId: row.event_id,
		eventType: row.event_type,
		actorType: row.actor_type as ChatEventActorType | undefined,
		actorId: row.actor_id ?? undefined,
		clientTxnId: row.client_txn_id ?? undefined,
		createdAt: row.created_at,
		retentionClass: row.retention_class,
		payload: JSON.parse(row.payload_json) as PiboJsonValue,
	};
}

function policyFromRow(row: RetentionPolicyRow): ChatRetentionPolicy {
	return {
		id: row.id,
		deleteLiveDeltasAfterMs: row.delete_live_deltas_after_ms ?? undefined,
		deleteTraceEventsAfterMs: row.delete_trace_events_after_ms ?? undefined,
		deleteChatMessagesAfterMs: row.delete_chat_messages_after_ms ?? undefined,
	};
}

function retentionClassForOutputEvent(event: PiboOutputEvent): ChatRetentionClass {
	if (event.type === "assistant_delta" || event.type === "thinking_delta") return "live_delta";
	if (event.type === "assistant_message" || event.type === "message_started" || event.type === "message_finished") {
		return "chat_message";
	}
	return "trace_event";
}

function actorTypeForOutputEvent(event: PiboOutputEvent): ChatEventActorType {
	if (event.type === "assistant_delta" || event.type === "assistant_message" || event.type.startsWith("thinking_")) {
		return "assistant";
	}
	if (event.type === "message_queued" || event.type === "message_started" || event.type === "message_finished") {
		return "user";
	}
	return "agent";
}

function addRetentionClause(
	clauses: string[],
	values: string[],
	retentionClass: ChatRetentionClass,
	ageMs: number | undefined,
	now: Date,
): void {
	if (!ageMs || ageMs <= 0) return;
	clauses.push("(retention_class = ? AND created_at < ?)");
	values.push(retentionClass, new Date(now.getTime() - ageMs).toISOString());
}
