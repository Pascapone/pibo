import type { DatabaseSync } from "node:sqlite";

export const CHAT_READ_PROJECTION_SCHEMA = `
CREATE INDEX IF NOT EXISTS idx_event_log_timing_sequence ON event_log(session_id,session_sequence,stream_id) WHERE type IN ('message_queued','message_steered','message_started','message_finished','session_error','thinking_finished','assistant_message');
CREATE INDEX IF NOT EXISTS idx_event_log_semantic_sequence ON event_log(session_id,session_sequence DESC,stream_id DESC) WHERE type NOT IN ('assistant_delta','thinking_delta','tool_execution_updated');
CREATE TABLE IF NOT EXISTS chat_trace_revisions(session_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS chat_trace_insert AFTER INSERT ON event_log WHEN NEW.session_id IS NOT NULL BEGIN
 INSERT INTO chat_trace_revisions VALUES(NEW.session_id,1) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS chat_trace_update AFTER UPDATE ON event_log WHEN NEW.session_id IS NOT NULL BEGIN
 INSERT INTO chat_trace_revisions VALUES(NEW.session_id,1) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1;
 UPDATE chat_trace_revisions SET revision=revision+1 WHERE session_id=OLD.session_id AND OLD.session_id IS NOT NEW.session_id;
END;
CREATE TRIGGER IF NOT EXISTS chat_trace_delete AFTER DELETE ON event_log WHEN OLD.session_id IS NOT NULL BEGIN
 INSERT INTO chat_trace_revisions VALUES(OLD.session_id,1) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1;
END;
CREATE INDEX IF NOT EXISTS idx_event_log_unread_stream ON event_log(stream_id) WHERE type='message_finished';
CREATE TABLE IF NOT EXISTS chat_unread_index(stream_id INTEGER PRIMARY KEY,session_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chat_unread_session_stream ON chat_unread_index(session_id,stream_id);
CREATE TABLE IF NOT EXISTS chat_unread_counts(session_id TEXT PRIMARY KEY,unread_count INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS chat_unread_count_insert AFTER INSERT ON chat_unread_index BEGIN
 INSERT INTO chat_unread_counts(session_id,unread_count) VALUES(NEW.session_id,CASE WHEN NEW.stream_id>COALESCE((SELECT last_read_stream_id FROM app_session_read_state WHERE session_id=NEW.session_id),0) THEN 1 ELSE 0 END)
 ON CONFLICT(session_id) DO UPDATE SET unread_count=unread_count+excluded.unread_count;
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_count_delete AFTER DELETE ON chat_unread_index BEGIN
 UPDATE chat_unread_counts SET unread_count=MAX(0,unread_count-CASE WHEN OLD.stream_id>COALESCE((SELECT last_read_stream_id FROM app_session_read_state WHERE session_id=OLD.session_id),0) THEN 1 ELSE 0 END) WHERE session_id=OLD.session_id;
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_event_insert AFTER INSERT ON event_log WHEN NEW.session_id IS NOT NULL AND NEW.type='message_finished' BEGIN
 INSERT OR IGNORE INTO chat_unread_index VALUES(NEW.stream_id,NEW.session_id);
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_event_delete AFTER DELETE ON event_log BEGIN DELETE FROM chat_unread_index WHERE stream_id=OLD.stream_id; END;
CREATE TRIGGER IF NOT EXISTS chat_unread_event_update AFTER UPDATE ON event_log BEGIN
 DELETE FROM chat_unread_index WHERE stream_id=OLD.stream_id;
 INSERT OR IGNORE INTO chat_unread_index SELECT NEW.stream_id,NEW.session_id WHERE NEW.session_id IS NOT NULL AND NEW.type='message_finished';
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_mark_insert AFTER INSERT ON app_session_read_state BEGIN
 INSERT INTO chat_unread_counts(session_id,unread_count) SELECT NEW.session_id,COUNT(*) FROM chat_unread_index WHERE session_id=NEW.session_id AND stream_id>NEW.last_read_stream_id
 ON CONFLICT(session_id) DO UPDATE SET unread_count=excluded.unread_count;
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_mark_update AFTER UPDATE OF last_read_stream_id ON app_session_read_state BEGIN
 INSERT INTO chat_unread_counts(session_id,unread_count) SELECT NEW.session_id,COUNT(*) FROM chat_unread_index WHERE session_id=NEW.session_id AND stream_id>NEW.last_read_stream_id
 ON CONFLICT(session_id) DO UPDATE SET unread_count=excluded.unread_count;
END;
CREATE TRIGGER IF NOT EXISTS chat_unread_mark_delete AFTER DELETE ON app_session_read_state BEGIN
 INSERT INTO chat_unread_counts(session_id,unread_count) SELECT OLD.session_id,COUNT(*) FROM chat_unread_index WHERE session_id=OLD.session_id
 ON CONFLICT(session_id) DO UPDATE SET unread_count=excluded.unread_count;
END;
CREATE TABLE IF NOT EXISTS chat_history_index (
 message_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_sequence INTEGER NOT NULL,
 source_stream_id INTEGER, role TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_history_index_session_event ON chat_history_index(session_id,event_sequence DESC,message_id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_history_index_session_created ON chat_history_index(session_id,created_at,message_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_index_source ON chat_history_index(source_stream_id);
CREATE TABLE IF NOT EXISTS chat_history_counts (session_id TEXT PRIMARY KEY,message_count INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_read_backfill (id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL DEFAULT 0,target INTEGER NOT NULL,event_cursor INTEGER NOT NULL DEFAULT 0,event_target INTEGER NOT NULL,paused INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO chat_read_backfill(id,target,event_target) SELECT 1,COALESCE(MAX(rowid),0),(SELECT COALESCE(MAX(stream_id),0) FROM event_log) FROM chat_messages;
CREATE TRIGGER IF NOT EXISTS chat_history_count_insert AFTER INSERT ON chat_history_index BEGIN
 INSERT INTO chat_history_counts(session_id,message_count,revision) VALUES(NEW.session_id,1,1)
 ON CONFLICT(session_id) DO UPDATE SET message_count=message_count+1,revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS chat_history_count_delete AFTER DELETE ON chat_history_index BEGIN
 UPDATE chat_history_counts SET message_count=MAX(0,message_count-1),revision=revision+1 WHERE session_id=OLD.session_id;
END;
CREATE TRIGGER IF NOT EXISTS chat_history_message_insert AFTER INSERT ON chat_messages BEGIN
 INSERT OR IGNORE INTO chat_history_index(message_id,session_id,event_sequence,source_stream_id,role,created_at)
 VALUES(NEW.id,NEW.session_id,COALESCE((SELECT session_sequence FROM event_log WHERE stream_id=NEW.source_stream_id),NEW.sequence),NEW.source_stream_id,NEW.role,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS chat_history_message_update AFTER UPDATE ON chat_messages BEGIN
 DELETE FROM chat_history_index WHERE message_id=OLD.id;
 INSERT INTO chat_history_index(message_id,session_id,event_sequence,source_stream_id,role,created_at)
 VALUES(NEW.id,NEW.session_id,COALESCE((SELECT session_sequence FROM event_log WHERE stream_id=NEW.source_stream_id),NEW.sequence),NEW.source_stream_id,NEW.role,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS chat_history_message_delete AFTER DELETE ON chat_messages BEGIN
 DELETE FROM chat_history_index WHERE message_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS chat_history_event_sequence AFTER UPDATE OF session_sequence ON event_log
WHEN OLD.session_sequence IS NOT NEW.session_sequence BEGIN
 UPDATE chat_history_index SET event_sequence=NEW.session_sequence WHERE source_stream_id=NEW.stream_id;
 UPDATE chat_history_counts SET revision=revision+1 WHERE session_id=NEW.session_id;
END;
`;

type ChatReadBackfillRow = {
	cursor: number;
	target: number;
	event_cursor: number;
	event_target: number;
	paused: number;
};

/** Resumable bounded backfill; concurrent product writes maintain their rows through triggers. */
export class ChatReadProjectionStore {
	constructor(private readonly db: DatabaseSync) {}

	status() {
		const row = this.db.prepare("SELECT cursor,target,event_cursor,event_target,paused FROM chat_read_backfill WHERE id=1").get() as ChatReadBackfillRow;
		return {
			...row,
			paused: Boolean(row.paused),
			historyComplete: row.cursor >= row.target,
			unreadComplete: row.event_cursor >= row.event_target,
			complete: row.cursor >= row.target && row.event_cursor >= row.event_target,
		};
	}

	setPaused(paused: boolean): void {
		this.db.prepare("UPDATE chat_read_backfill SET paused=? WHERE id=1").run(paused ? 1 : 0);
	}

	step(limit = 128, maxMs = 4) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) throw Error("Backfill row budget must be 1..512");
		const state = this.status();
		if (state.paused || state.complete) return { ...state, processed: 0 };
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.status();
			if (current.paused || current.complete) {
				this.db.exec("COMMIT");
				return { ...current, processed: 0 };
			}
			const processed = current.historyComplete
				? this.backfillUnread(current.event_cursor, current.event_target, limit, maxMs)
				: this.backfillHistory(current.cursor, current.target, limit, maxMs);
			this.db.exec("COMMIT");
			return { ...this.status(), processed };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private backfillUnread(cursor: number, target: number, limit: number, maxMs: number): number {
		const rows = this.db.prepare("SELECT stream_id,session_id FROM event_log INDEXED BY idx_event_log_unread_stream WHERE stream_id>? AND stream_id<=? AND type='message_finished' ORDER BY stream_id LIMIT ?").all(cursor, target, limit) as Array<{ stream_id: number; session_id: string | null }>;
		const insert = this.db.prepare("INSERT OR IGNORE INTO chat_unread_index VALUES(?,?)");
		let processed = 0;
		const started = performance.now();
		for (const row of rows) {
			if (row.session_id) insert.run(row.stream_id, row.session_id);
			processed++;
			if (performance.now() - started >= maxMs) break;
		}
		const nextCursor = processed === rows.length && rows.length < limit ? target : rows[processed - 1]!.stream_id;
		this.db.prepare("UPDATE chat_read_backfill SET event_cursor=? WHERE id=1").run(nextCursor);
		return processed;
	}

	private backfillHistory(cursor: number, target: number, limit: number, maxMs: number): number {
		const rows = this.db.prepare("SELECT rowid AS cursor,id FROM chat_messages WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?").all(cursor, target, limit) as Array<{ cursor: number; id: string }>;
		const insert = this.db.prepare(`INSERT OR IGNORE INTO chat_history_index(message_id,session_id,event_sequence,source_stream_id,role,created_at)
    SELECT m.id,m.session_id,COALESCE(e.session_sequence,m.sequence),m.source_stream_id,m.role,m.created_at FROM chat_messages m LEFT JOIN event_log e ON e.stream_id=m.source_stream_id WHERE m.id=?`);
		let processed = 0;
		const started = performance.now();
		for (const row of rows) {
			insert.run(row.id);
			processed++;
			if (performance.now() - started >= maxMs) break;
		}
		const nextCursor = processed === rows.length && rows.length < limit ? target : rows[processed - 1]!.cursor;
		this.db.prepare("UPDATE chat_read_backfill SET cursor=? WHERE id=1").run(nextCursor);
		return processed;
	}
}

export const CHAT_NAVIGATION_REVISION_SCHEMA = `
CREATE INDEX IF NOT EXISTS idx_sessions_navigation_cursor ON sessions(room_id,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_navigation_read ON sessions(room_id,last_activity_at DESC,created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS chat_navigation_clock(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
INSERT OR IGNORE INTO chat_navigation_clock VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS chat_navigation_session_insert AFTER INSERT ON sessions BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS chat_navigation_session_delete AFTER DELETE ON sessions BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS chat_navigation_session_update AFTER UPDATE ON sessions
WHEN OLD.title IS NOT NEW.title OR OLD.profile IS NOT NEW.profile OR OLD.parent_id IS NOT NEW.parent_id OR OLD.origin_id IS NOT NEW.origin_id OR OLD.metadata_json IS NOT NEW.metadata_json OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.active_model_json IS NOT NEW.active_model_json OR OLD.room_id IS NOT NEW.room_id
BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS chat_navigation_binding_insert AFTER INSERT ON session_runtime_bindings BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS chat_navigation_binding_update AFTER UPDATE ON session_runtime_bindings
WHEN OLD.runtime_instance_id IS NOT NEW.runtime_instance_id OR OLD.native_session_id IS NOT NEW.native_session_id OR OLD.revision IS NOT NEW.revision
BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS chat_navigation_binding_delete AFTER DELETE ON session_runtime_bindings BEGIN UPDATE chat_navigation_clock SET revision=revision+1 WHERE id=1; END;
`;
