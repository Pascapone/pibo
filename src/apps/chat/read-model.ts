import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../../core/pibo-home.js";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PiboOutputEvent } from "../../core/events.js";
import { isLiveOnlyOutputEvent } from "./output-event-policy.js";
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

export type ChatWebSessionBootstrapIndexResult = {
	checked: number;
	written: number;
	skipped: number;
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
	private readonly upsertSessionStatement: StatementSync;
	private readonly getSessionStatement: StatementSync;
	private readonly insertEventStatement: StatementSync;
	private readonly nextEventSequenceStatement: StatementSync;
	private readonly updateSessionStatusStatement: StatementSync;
	private readonly updateSessionActivityStatement: StatementSync;
	private readonly resetInterruptedSessionsStatement: StatementSync;

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
		this.upsertSessionStatement = this.db.prepare(`
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
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				status = COALESCE(?, web_chat_sessions.status)
			WHERE web_chat_sessions.pi_session_id IS NOT excluded.pi_session_id
				OR web_chat_sessions.parent_id IS NOT excluded.parent_id
				OR web_chat_sessions.profile IS NOT excluded.profile
				OR web_chat_sessions.channel IS NOT excluded.channel
				OR web_chat_sessions.kind IS NOT excluded.kind
				OR web_chat_sessions.created_at IS NOT excluded.created_at
				OR web_chat_sessions.updated_at IS NOT excluded.updated_at
				OR (? IS NOT NULL AND web_chat_sessions.status IS NOT ?)
		`);
		this.getSessionStatement = this.db.prepare("SELECT * FROM web_chat_sessions WHERE pibo_session_id = ?");
		this.insertEventStatement = this.db.prepare(
			"INSERT INTO web_chat_events (id, pibo_session_id, event_sequence, event_id, stream_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		);
		this.nextEventSequenceStatement = this.db.prepare("SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM web_chat_events WHERE pibo_session_id = ?");
		this.updateSessionStatusStatement = this.db.prepare(
			"UPDATE web_chat_sessions SET status = ?, updated_at = ? WHERE pibo_session_id = ? AND status IS NOT ?",
		);
		this.updateSessionActivityStatement = this.db.prepare(
			"UPDATE web_chat_sessions SET last_activity_at = ?, status = ?, updated_at = ? WHERE pibo_session_id = ?",
		);
		this.resetInterruptedSessionsStatement = this.db.prepare("UPDATE web_chat_sessions SET status = 'idle' WHERE status = 'running'");
		this.resetInterruptedSessions();
	}

	upsertSession(session: PiboSession, status?: ChatWebSessionIndexItem["status"]): void {
		this.upsertSessionStatement.run(
			session.id,
			session.piSessionId,
			session.parentId ?? null,
			session.profile,
			session.channel,
			session.kind,
			session.createdAt,
			session.updatedAt,
			status ?? "idle",
			status ?? null,
			status ?? null,
			status ?? null,
		);
	}

	upsertSessionsIfChanged(sessions: PiboSession[]): ChatWebSessionBootstrapIndexResult {
		if (!sessions.length) return { checked: 0, written: 0, skipped: 0 };

		const existingRows = this.getSessionRowsByIds(sessions.map((session) => session.id));
		const changedSessions = sessions.filter((session) => {
			const row = existingRows.get(session.id);
			return !row || !sessionRowMatchesPiboSession(row, session);
		});

		if (changedSessions.length === 1) {
			this.upsertSession(changedSessions[0]);
		} else if (changedSessions.length > 1) {
			this.db.exec("BEGIN");
			try {
				for (const session of changedSessions) this.upsertSession(session);
				this.db.exec("COMMIT");
			} catch (error) {
				this.db.exec("ROLLBACK");
				throw error;
			}
		}

		return {
			checked: sessions.length,
			written: changedSessions.length,
			skipped: sessions.length - changedSessions.length,
		};
	}

	recordEvent(event: PiboOutputEvent, session?: PiboSession, streamId?: number): ChatWebStoredPiboEvent | undefined {
		const previousStatus = this.getSession(event.piboSessionId)?.status;
		const nextStatus = statusFromEvent(event, previousStatus);
		if (session) this.upsertSession(session, nextStatus);
		if (isLiveOnlyOutputEvent(event)) {
			const updatedAt = new Date().toISOString();
			this.updateSessionStatusStatement.run(nextStatus, updatedAt, event.piboSessionId, nextStatus);
			return undefined;
		}

		const id = randomUUID();
		const createdAt = new Date().toISOString();
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		let eventSequence = 0;
		this.db.exec("BEGIN IMMEDIATE");
		try {
			eventSequence = this.nextEventSequence(event.piboSessionId);
			this.insertEventStatement.run(
				id,
				event.piboSessionId,
				eventSequence,
				eventId ?? null,
				streamId ?? null,
				event.type,
				createdAt,
				JSON.stringify(event),
			);
			if (isSessionNavigationActivityEvent(event)) {
				this.updateSessionActivityStatement.run(createdAt, nextStatus, createdAt, event.piboSessionId);
			} else {
				this.updateSessionStatusStatement.run(nextStatus, createdAt, event.piboSessionId, nextStatus);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}

		return { id, piboSessionId: event.piboSessionId, eventSequence, eventId, streamId, type: event.type, createdAt, payload: event };
	}

	listSessions(): ChatWebSessionIndexItem[] {
		return (this.db.prepare("SELECT * FROM web_chat_sessions ORDER BY COALESCE(last_activity_at, created_at) DESC, created_at DESC").all() as SessionRow[]).map(
			sessionFromRow,
		);
	}

	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined {
		const row = this.getSessionStatement.get(piboSessionId) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	private getSessionRowsByIds(piboSessionIds: string[]): Map<string, SessionRow> {
		const rowsById = new Map<string, SessionRow>();
		const uniqueIds = [...new Set(piboSessionIds)];
		const chunkSize = 900;
		for (let index = 0; index < uniqueIds.length; index += chunkSize) {
			const chunk = uniqueIds.slice(index, index + chunkSize);
			if (!chunk.length) continue;
			const placeholders = chunk.map(() => "?").join(", ");
			const rows = this.db
				.prepare(`SELECT * FROM web_chat_sessions WHERE pibo_session_id IN (${placeholders})`)
				.all(...chunk) as SessionRow[];
			for (const row of rows) rowsById.set(row.pibo_session_id, row);
		}
		return rowsById;
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

	listTraceEvents(input: { piboSessionId: string; limit?: number; beforeOrAtSequence?: number } | string): ChatWebStoredPiboEvent[] {
		const piboSessionId = typeof input === "string" ? input : input.piboSessionId;
		const limit = Math.max(1, Math.min((typeof input === "string" ? undefined : input.limit) ?? 2000, 10000));
		const beforeOrAtSequence = typeof input === "string" ? undefined : input.beforeOrAtSequence;
		const clauses = ["pibo_session_id = ?", "type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated')"];
		const values: Array<string | number> = [piboSessionId];
		if (beforeOrAtSequence !== undefined) {
			clauses.push("event_sequence <= ?");
			values.push(beforeOrAtSequence);
		}
		const rows = this.db
			.prepare(
				`
					SELECT * FROM (
						SELECT rowid AS _rowid, * FROM web_chat_events
						WHERE ${clauses.join(" AND ")}
						ORDER BY event_sequence DESC, rowid DESC
						LIMIT ?
					)
					ORDER BY event_sequence ASC, _rowid ASC
				`,
			)
			.all(...values, limit) as EventRow[];
		return rows.map(eventFromRow);
	}

	hasSessionActivity(piboSessionId: string): boolean {
		const row = this.db
			.prepare(
				"SELECT 1 AS found FROM web_chat_events WHERE pibo_session_id = ? AND type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated') LIMIT 1",
			)
			.get(piboSessionId) as { found: number } | undefined;
		if (row) return true;
		return this.getSession(piboSessionId)?.status === "running";
	}

	countEventsByType(input: { piboSessionId?: string; eventTypes?: string[] } = {}): Array<{ eventType: string; count: number }> {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(input.piboSessionId);
		}
		if (input.eventTypes?.length) {
			clauses.push(`type IN (${input.eventTypes.map(() => "?").join(", ")})`);
			values.push(...input.eventTypes);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT type, COUNT(*) AS count FROM web_chat_events ${where} GROUP BY type ORDER BY type`)
			.all(...values) as Array<{ type: string; count: number }>;
		return rows.map((row) => ({ eventType: row.type, count: Number(row.count) }));
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
		const row = this.nextEventSequenceStatement.get(piboSessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private resetInterruptedSessions(): void {
		this.resetInterruptedSessionsStatement.run();
	}
}

export function createDefaultChatWebReadModel(_cwd?: string): ChatWebReadModel {
	return new ChatWebReadModel(piboHomePath("web-chat.sqlite"));
}

function isSessionNavigationActivityEvent(event: PiboOutputEvent): boolean {
	return event.type === "message_queued" || event.type === "assistant_message";
}

function statusFromEvent(
	event: PiboOutputEvent,
	previousStatus: ChatWebSessionIndexItem["status"] = "idle",
): ChatWebSessionIndexItem["status"] {
	if (event.type === "session_error") return "error";
	if (event.type === "compaction_end") return event.errorMessage ? "error" : "idle";
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
		event.type === "tool_execution_finished" ||
		event.type === "compaction_start"
	) {
		return "running";
	}
	return previousStatus;
}

function sessionRowMatchesPiboSession(row: SessionRow, session: PiboSession): boolean {
	return (
		row.pibo_session_id === session.id &&
		row.pi_session_id === session.piSessionId &&
		row.parent_id === (session.parentId ?? null) &&
		row.profile === session.profile &&
		row.channel === session.channel &&
		row.kind === session.kind &&
		row.created_at === session.createdAt &&
		row.updated_at === session.updatedAt
	);
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
