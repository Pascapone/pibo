import type { DatabaseSync } from "node:sqlite";

export const PIBO_DATA_SCHEMA_VERSION = 1;

export function applyPiboDataSchema(db: DatabaseSync): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			pi_session_id TEXT UNIQUE,
			owner_scope TEXT NOT NULL,
			room_id TEXT,
			root_session_id TEXT,
			parent_id TEXT,
			origin_id TEXT,
			channel TEXT NOT NULL,
			kind TEXT NOT NULL,
			profile TEXT NOT NULL,
			active_model_json TEXT,
			workspace TEXT,
			title TEXT NOT NULL DEFAULT 'Untitled Session',
			first_message_preview TEXT,
			status TEXT NOT NULL DEFAULT 'idle',
			archived_at TEXT,
			deleted_at TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_activity_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			owner_scope TEXT NOT NULL,
			name TEXT NOT NULL,
			topic TEXT,
			type TEXT NOT NULL,
			parent_room_id TEXT,
			workspace TEXT,
			archived_at TEXT,
			retention_policy_id TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS room_members (
			room_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			role TEXT NOT NULL,
			joined_at TEXT NOT NULL,
			PRIMARY KEY(room_id, principal_id)
		);

		CREATE TABLE IF NOT EXISTS payloads (
			id TEXT PRIMARY KEY,
			sha256 TEXT NOT NULL UNIQUE,
			storage_kind TEXT NOT NULL,
			storage_path TEXT,
			content_type TEXT NOT NULL,
			encoding TEXT NOT NULL DEFAULT 'gzip',
			byte_size INTEGER NOT NULL,
			compressed_byte_size INTEGER,
			preview_text TEXT,
			retention_class TEXT NOT NULL,
			ref_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'committed',
			created_at TEXT NOT NULL,
			last_verified_at TEXT
		);

		CREATE TABLE IF NOT EXISTS event_log (
			stream_id INTEGER PRIMARY KEY,
			session_id TEXT,
			session_sequence INTEGER,
			room_id TEXT,
			topic TEXT NOT NULL,
			type TEXT NOT NULL,
			source TEXT NOT NULL,
			actor_type TEXT,
			actor_id TEXT,
			turn_id TEXT,
			event_id TEXT,
			tool_call_id TEXT,
			run_id TEXT,
			workflow_run_id TEXT,
			idempotency_key TEXT,
			retention_class TEXT NOT NULL,
			payload_ref TEXT,
			preview_text TEXT,
			attributes_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			indexed_at TEXT
		);

		CREATE TABLE IF NOT EXISTS chat_messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			room_id TEXT,
			sequence INTEGER NOT NULL,
			turn_id TEXT,
			role TEXT NOT NULL,
			actor_id TEXT,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			completed_at TEXT,
			content_preview TEXT,
			content_payload_ref TEXT,
			source_stream_id INTEGER,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cost_usd REAL,
			attributes_json TEXT NOT NULL DEFAULT '{}',
			UNIQUE(session_id, sequence)
		);

		CREATE TABLE IF NOT EXISTS observations (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			trace_id TEXT,
			span_id TEXT,
			parent_span_id TEXT,
			parent_observation_id TEXT,
			turn_id TEXT,
			event_stream_id INTEGER,
			kind TEXT NOT NULL,
			role TEXT,
			name TEXT,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			latency_ms INTEGER,
			model_provider TEXT,
			model_id TEXT,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cost_usd REAL,
			preview_text TEXT,
			payload_ref TEXT,
			attributes_json TEXT NOT NULL DEFAULT '{}',
			UNIQUE(session_id, sequence)
		);

		CREATE TABLE IF NOT EXISTS session_stats (
			session_id TEXT PRIMARY KEY,
			message_count INTEGER NOT NULL DEFAULT 0,
			tool_call_count INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0,
			last_event_stream_id INTEGER,
			last_message_sequence INTEGER,
			last_observation_sequence INTEGER,
			last_message_preview TEXT,
			last_activity_at TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'idle',
			total_latency_ms INTEGER NOT NULL DEFAULT 0,
			total_input_tokens INTEGER NOT NULL DEFAULT 0,
			total_output_tokens INTEGER NOT NULL DEFAULT 0,
			total_cost_usd REAL NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS principal_session_stats (
			session_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_message_sequence INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(session_id, principal_id)
		);

		CREATE TABLE IF NOT EXISTS principal_room_stats (
			room_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(room_id, principal_id)
		);

		CREATE TABLE IF NOT EXISTS session_navigation (
			owner_scope TEXT NOT NULL,
			room_id TEXT,
			session_id TEXT PRIMARY KEY,
			root_session_id TEXT,
			parent_id TEXT,
			origin_id TEXT,
			title TEXT NOT NULL,
			profile TEXT NOT NULL,
			status TEXT NOT NULL,
			archived_at TEXT,
			last_activity_at TEXT NOT NULL,
			last_message_preview TEXT,
			child_count INTEGER NOT NULL DEFAULT 0,
			sort_key TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS indexer_offsets (
			indexer_name TEXT PRIMARY KEY,
			source_name TEXT NOT NULL,
			last_stream_id INTEGER NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS migration_import_map (
			source_store TEXT NOT NULL,
			source_table TEXT NOT NULL,
			source_key TEXT NOT NULL,
			target_kind TEXT NOT NULL,
			target_id TEXT NOT NULL,
			imported_at TEXT NOT NULL,
			PRIMARY KEY(source_store, source_table, source_key)
		);

		CREATE INDEX IF NOT EXISTS idx_sessions_owner_activity
			ON sessions(owner_scope, archived_at, last_activity_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_room_activity
			ON sessions(room_id, archived_at, last_activity_at DESC);
		CREATE INDEX IF NOT EXISTS idx_room_members_principal
			ON room_members(principal_id, room_id);
		CREATE INDEX IF NOT EXISTS idx_event_log_session_stream
			ON event_log(session_id, stream_id);
		CREATE INDEX IF NOT EXISTS idx_event_log_room_stream
			ON event_log(room_id, stream_id);
		CREATE INDEX IF NOT EXISTS idx_event_log_topic_stream
			ON event_log(topic, stream_id);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_idempotency
			ON event_log(idempotency_key)
			WHERE idempotency_key IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_chat_messages_session_sequence
			ON chat_messages(session_id, sequence);
		CREATE INDEX IF NOT EXISTS idx_observations_session_sequence
			ON observations(session_id, sequence);
		CREATE INDEX IF NOT EXISTS idx_session_navigation_owner_room_sort
			ON session_navigation(owner_scope, room_id, archived_at, sort_key DESC);
		CREATE INDEX IF NOT EXISTS idx_session_navigation_root
			ON session_navigation(root_session_id, parent_id);
	`);
	db.exec(`PRAGMA user_version = ${PIBO_DATA_SCHEMA_VERSION}`);
}
