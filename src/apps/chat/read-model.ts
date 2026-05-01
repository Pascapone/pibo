import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PiboOutputEvent } from "../../core/events.js";
import type { PiboSession } from "../../sessions/store.js";

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
	event_id: string | null;
	type: string;
	created_at: string;
	payload_json: string;
};

export type ChatWebStoredEvent = {
	id: string;
	piboSessionId: string;
	eventId?: string;
	type: string;
	createdAt: string;
	payload: PiboOutputEvent;
};

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
				event_id TEXT,
				type TEXT NOT NULL,
				created_at TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_web_chat_events_session_created
				ON web_chat_events(pibo_session_id, created_at, id);
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
					status = CASE
						WHEN web_chat_sessions.status = 'running' AND excluded.status = 'idle' THEN web_chat_sessions.status
						ELSE excluded.status
					END
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

	recordEvent(event: PiboOutputEvent, session?: PiboSession): ChatWebStoredEvent {
		if (session) this.upsertSession(session, statusFromEvent(event));

		const id = randomUUID();
		const createdAt = new Date().toISOString();
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		this.db
			.prepare(
				"INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(id, event.piboSessionId, eventId ?? null, event.type, createdAt, JSON.stringify(event));
		this.db
			.prepare(
				"UPDATE web_chat_sessions SET last_activity_at = ?, status = ?, updated_at = ? WHERE pibo_session_id = ?",
			)
			.run(createdAt, statusFromEvent(event), createdAt, event.piboSessionId);

		return { id, piboSessionId: event.piboSessionId, eventId, type: event.type, createdAt, payload: event };
	}

	listSessions(): ChatWebSessionIndexItem[] {
		return (this.db.prepare("SELECT * FROM web_chat_sessions ORDER BY updated_at DESC").all() as SessionRow[]).map(
			sessionFromRow,
		);
	}

	listEvents(piboSessionId: string, limit = 1000): ChatWebStoredEvent[] {
		const rows = this.db
			.prepare(
				`
					SELECT * FROM (
						SELECT rowid AS _rowid, * FROM web_chat_events
						WHERE pibo_session_id = ?
						ORDER BY rowid DESC
						LIMIT ?
					)
					ORDER BY _rowid ASC
				`,
			)
			.all(piboSessionId, limit) as EventRow[];
		return rows.map(eventFromRow);
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

	private resetInterruptedSessions(): void {
		this.db.prepare("UPDATE web_chat_sessions SET status = 'idle' WHERE status = 'running'").run();
	}
}

export function createDefaultChatWebReadModel(cwd = process.cwd()): ChatWebReadModel {
	return new ChatWebReadModel(resolve(cwd, ".pibo/web-chat.sqlite"));
}

function statusFromEvent(event: PiboOutputEvent): ChatWebSessionIndexItem["status"] {
	if (event.type === "session_error") return "error";
	if (
		event.type === "message_started" ||
		event.type === "assistant_delta" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished" ||
		event.type === "subagent_session" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated"
	) {
		return "running";
	}
	return "idle";
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

function eventFromRow(row: EventRow): ChatWebStoredEvent {
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		eventId: row.event_id ?? undefined,
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
