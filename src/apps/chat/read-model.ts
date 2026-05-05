import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../../core/pibo-home.js";
import { DatabaseSync } from "node:sqlite";
import type { PiboOutputEvent } from "../../core/events.js";
import type { PiboSession } from "../../sessions/store.js";
import type { ChatWebStoredEvent } from "../../shared/trace-types.js";

type SessionRow = {
	pibo_session_id: string;
	pi_session_id: string;
	parent_id: string | null;
	profile: string;
	channel: string;
	kind: string;
	created_at: string;
	updated_at: string;
	last_activity_at: string | null;
	status: string;
};

type EventRow = {
	id: string;
	pibo_session_id: string;
	event_sequence: number | null;
	event_id: string | null;
	stream_id: number | null;
	type: string;
	created_at: string;
	payload_json: string;
};

export type { ChatWebStoredEvent };
export type ChatWebStoredPiboEvent = ChatWebStoredEvent<PiboOutputEvent>;

export type ChatWebSessionIndexItem = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	profile: string;
	channel: string;
	kind: string;
	createdAt: string;
	updatedAt: string;
	lastActivityAt?: string;
	status: "idle" | "running" | "error";
};

export class ChatWebReadModel {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}

		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.dropLegacySchema();
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS web_chat_sessions (
				pibo_session_id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL,
				parent_id TEXT,
				profile TEXT NOT NULL,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				last_activity_at TEXT,
				status TEXT NOT NULL DEFAULT 'idle'
			);

			CREATE TABLE IF NOT EXISTS web_chat_events (
				id TEXT PRIMARY KEY,
				pibo_session_id TEXT NOT NULL,
				event_sequence INTEGER,
				event_id TEXT,
				stream_id INTEGER,
				type TEXT NOT NULL,
				created_at TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);
		`);
		this.migrateEventSequence();
		this.migrateStreamId();
		this.db.exec(`

			CREATE INDEX IF NOT EXISTS idx_web_chat_events_session_created
				ON web_chat_events(pibo_session_id, created_at, id);
			CREATE INDEX IF NOT EXISTS idx_web_chat_events_session_sequence
				ON web_chat_events(pibo_session_id, event_sequence, id);
			CREATE INDEX IF NOT EXISTS idx_web_chat_events_event_id
				ON web_chat_events(event_id);
			CREATE INDEX IF NOT EXISTS idx_web_chat_sessions_parent
				ON web_chat_sessions(parent_id);
		`);
		this.resetInterruptedSessions();
	}

	upsertSession(session: PiboSession, status: ChatWebSessionIndexItem["status"] = "idle"): void {
		this.db
			.prepare(`
				INSERT INTO web_chat_sessions (
					pibo_session_id,
					pi_session_id,
					parent_id,
					profile,
					channel,
					kind,
					created_at,
					updated_at,
					last_activity_at,
					status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
				ON CONFLICT(pibo_session_id) DO UPDATE SET
					pi_session_id = excluded.pi_session_id,
					parent_id = excluded.parent_id,
					profile = excluded.profile,
					channel = excluded.channel,
					kind = excluded.kind,
					updated_at = excluded.updated_at,
					status = excluded.status
			`)
			.run(
				session.id,
				session.piSessionId,
				session.parentId ?? null,
				session.profile,
				session.channel,
				session.kind,
				session.createdAt,
				session.updatedAt,
				status,
			);
	}

	recordEvent(event: PiboOutputEvent, session?: PiboSession, streamId?: number): ChatWebStoredPiboEvent {
		const previousStatus = this.getSession(event.piboSessionId)?.status;
		const nextStatus = statusFromEvent(event, previousStatus);
		if (session) this.upsertSession(session, nextStatus);

		const id = randomUUID();
		const createdAt = new Date().toISOString();
		const eventSequence = this.nextEventSequence(event.piboSessionId);
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		this.db
			.prepare(
				"INSERT INTO web_chat_events (id, pibo_session_id, event_sequence, event_id, stream_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(id, event.piboSessionId, eventSequence, eventId ?? null, streamId ?? null, event.type, createdAt, JSON.stringify(event));
		if (isSessionNavigationActivityEvent(event)) {
			this.db
				.prepare(
					"UPDATE web_chat_sessions SET last_activity_at = ?, status = ?, updated_at = ? WHERE pibo_session_id = ?",
				)
				.run(createdAt, nextStatus, createdAt, event.piboSessionId);
		} else {
			this.db
				.prepare("UPDATE web_chat_sessions SET status = ?, updated_at = ? WHERE pibo_session_id = ?")
				.run(nextStatus, createdAt, event.piboSessionId);
		}

		return { id, piboSessionId: event.piboSessionId, eventSequence, eventId, streamId, type: event.type, createdAt, payload: event };
	}

	listSessions(): ChatWebSessionIndexItem[] {
		return (this.db.prepare("SELECT * FROM web_chat_sessions ORDER BY updated_at DESC").all() as SessionRow[]).map(
			sessionFromRow,
		);
	}

	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined {
		const row = this.db
			.prepare("SELECT * FROM web_chat_sessions WHERE pibo_session_id = ?")
			.get(piboSessionId) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	listEvents(piboSessionId: string, limit = 1000): ChatWebStoredPiboEvent[] {
		const rows = this.db
			.prepare(
				`
					SELECT * FROM (
						SELECT rowid AS _rowid, * FROM web_chat_events
						WHERE pibo_session_id = ?
						ORDER BY event_sequence DESC, rowid DESC
						LIMIT ?
					)
					ORDER BY event_sequence ASC, _rowid ASC
				`,
			)
			.all(piboSessionId, limit) as EventRow[];
		return rows.map(eventFromRow);
	}

	listAllEvents(piboSessionId: string): ChatWebStoredPiboEvent[] {
		const rows = this.db
			.prepare(
				`
					SELECT rowid AS _rowid, * FROM web_chat_events
					WHERE pibo_session_id = ?
					ORDER BY event_sequence ASC, _rowid ASC
				`,
			)
			.all(piboSessionId) as EventRow[];
		return rows.map(eventFromRow);
	}

	getLatestEventSequence(piboSessionId: string): number {
		const row = this.db
			.prepare("SELECT COALESCE(MAX(event_sequence), 0) AS latest_sequence FROM web_chat_events WHERE pibo_session_id = ?")
			.get(piboSessionId) as { latest_sequence: number };
		return row.latest_sequence;
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		this.db.prepare(`DELETE FROM web_chat_events WHERE pibo_session_id IN (${placeholders})`).run(...piboSessionIds);
		const result = this.db
			.prepare(`DELETE FROM web_chat_sessions WHERE pibo_session_id IN (${placeholders})`)
			.run(...piboSessionIds);
		return Number(result.changes ?? 0);
	}

	close(): void {
		this.db.close();
	}

	private dropLegacySchema(): void {
		const sessionColumns = tableColumns(this.db, "web_chat_sessions");
		const eventColumns = tableColumns(this.db, "web_chat_events");
		if (
			(sessionColumns.size > 0 && !sessionColumns.has("pibo_session_id")) ||
			(eventColumns.size > 0 && !eventColumns.has("pibo_session_id"))
		) {
			this.db.exec(`
				DROP TABLE IF EXISTS web_chat_events;
				DROP TABLE IF EXISTS web_chat_sessions;
			`);
		}
	}

	private migrateEventSequence(): void {
		const eventColumns = tableColumns(this.db, "web_chat_events");
		if (!eventColumns.has("event_sequence")) {
			this.db.exec("ALTER TABLE web_chat_events ADD COLUMN event_sequence INTEGER");
		}
		this.db.exec("UPDATE web_chat_events SET event_sequence = rowid WHERE event_sequence IS NULL");
	}

	private migrateStreamId(): void {
		const eventColumns = tableColumns(this.db, "web_chat_events");
		if (!eventColumns.has("stream_id")) {
			this.db.exec("ALTER TABLE web_chat_events ADD COLUMN stream_id INTEGER");
		}
	}

	private nextEventSequence(piboSessionId: string): number {
		const row = this.db
			.prepare("SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM web_chat_events WHERE pibo_session_id = ?")
			.get(piboSessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private resetInterruptedSessions(): void {
		this.db.prepare("UPDATE web_chat_sessions SET status = 'idle' WHERE status = 'running'").run();
	}
}

export function createDefaultChatWebReadModel(_cwd?: string): ChatWebReadModel {
	return new ChatWebReadModel(piboHomePath("web-chat.sqlite"));
}

function isSessionNavigationActivityEvent(event: PiboOutputEvent): boolean {
	return event.type === "message_queued" || event.type === "message_started" || event.type === "assistant_message";
}

function statusFromEvent(
	event: PiboOutputEvent,
	previousStatus: ChatWebSessionIndexItem["status"] = "idle",
): ChatWebSessionIndexItem["status"] {
	if (event.type === "session_error") return "error";
	if (event.type === "message_finished") return "idle";
	if (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished" ||
		event.type === "tool_call" ||
		event.type === "subagent_session" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated" ||
		event.type === "tool_execution_finished"
	) {
		return "running";
	}
	return previousStatus;
}

function sessionFromRow(row: SessionRow): ChatWebSessionIndexItem {
	return {
		piboSessionId: row.pibo_session_id,
		piSessionId: row.pi_session_id,
		parentId: row.parent_id ?? undefined,
		profile: row.profile,
		channel: row.channel,
		kind: row.kind,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastActivityAt: row.last_activity_at ?? undefined,
		status: row.status === "running" || row.status === "error" ? row.status : "idle",
	};
}

function eventFromRow(row: EventRow): ChatWebStoredPiboEvent {
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		eventSequence: row.event_sequence ?? undefined,
		eventId: row.event_id ?? undefined,
		streamId: row.stream_id ?? undefined,
		type: row.type,
		createdAt: row.created_at,
		payload: JSON.parse(row.payload_json) as PiboOutputEvent,
	};
}

function tableColumns(db: DatabaseSync, tableName: string): Set<string> {
	return new Set(
		(db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name),
	);
}
