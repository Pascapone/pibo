import type { DatabaseSync } from "node:sqlite";

export const PIBO_DATA_SCHEMA_VERSION = 2;

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

		CREATE TABLE IF NOT EXISTS telemetry_turns (
			turn_id TEXT PRIMARY KEY,
			pibo_session_id TEXT NOT NULL,
			root_session_id TEXT,
			room_id TEXT,
			input_event_id TEXT,
			event_id TEXT,
			event_stream_id INTEGER,
			payload_ref TEXT,
			run_id TEXT,
			source TEXT NOT NULL,
			status TEXT NOT NULL,
			current_phase TEXT,
			queued_at TEXT NOT NULL,
			started_at TEXT,
			completed_at TEXT,
			last_progress_at TEXT,
			queued_behind INTEGER,
			queue_depth INTEGER,
			summary TEXT,
			retention_class TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			metadata_json TEXT NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS telemetry_phases (
			phase_id TEXT PRIMARY KEY,
			turn_id TEXT NOT NULL,
			pibo_session_id TEXT NOT NULL,
			root_session_id TEXT,
			room_id TEXT,
			name TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			last_progress_at TEXT,
			duration_ms INTEGER,
			provider_request_id TEXT,
			tool_call_id TEXT,
			event_stream_id INTEGER,
			event_id TEXT,
			payload_ref TEXT,
			run_id TEXT,
			counters_json TEXT NOT NULL DEFAULT '{}',
			summary TEXT,
			retention_class TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS telemetry_provider_requests (
			provider_request_id TEXT PRIMARY KEY,
			pibo_session_id TEXT NOT NULL,
			root_session_id TEXT,
			room_id TEXT,
			turn_id TEXT NOT NULL,
			phase_id TEXT,
			provider TEXT NOT NULL,
			api TEXT NOT NULL,
			model TEXT NOT NULL,
			transport TEXT NOT NULL,
			service_tier TEXT,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			response_headers_at TEXT,
			first_byte_at TEXT,
			last_raw_event_at TEXT,
			last_normalized_event_at TEXT,
			completed_at TEXT,
			http_status INTEGER,
			upstream_response_id TEXT,
			raw_event_count INTEGER NOT NULL DEFAULT 0,
			normalized_event_count INTEGER NOT NULL DEFAULT 0,
			parse_error_count INTEGER NOT NULL DEFAULT 0,
			unknown_event_count INTEGER NOT NULL DEFAULT 0,
			bytes_received INTEGER,
			event_type_counts_json TEXT NOT NULL DEFAULT '{}',
			event_stream_id INTEGER,
			event_id TEXT,
			payload_ref TEXT,
			error_category TEXT,
			error_message TEXT,
			capture_mode TEXT NOT NULL,
			retention_class TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS telemetry_provider_events (
			raw_event_id TEXT PRIMARY KEY,
			provider_request_id TEXT NOT NULL,
			pibo_session_id TEXT,
			turn_id TEXT,
			phase_id TEXT,
			sequence INTEGER NOT NULL,
			received_at TEXT NOT NULL,
			event_type TEXT NOT NULL,
			byte_size INTEGER NOT NULL DEFAULT 0,
			parse_status TEXT NOT NULL,
			normalized_type TEXT,
			event_stream_id INTEGER,
			event_id TEXT,
			item_id TEXT,
			tool_call_id TEXT,
			payload_ref TEXT,
			payload_preview_ref TEXT,
			safe_fields_json TEXT NOT NULL DEFAULT '{}',
			retention_class TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(provider_request_id, sequence)
		);

		CREATE TABLE IF NOT EXISTS telemetry_tool_calls (
			tool_call_id TEXT PRIMARY KEY,
			pibo_session_id TEXT NOT NULL,
			root_session_id TEXT,
			room_id TEXT,
			turn_id TEXT NOT NULL,
			provider_request_id TEXT,
			provider_item_id TEXT,
			output_index INTEGER,
			tool_name TEXT NOT NULL,
			status TEXT NOT NULL,
			args_started_at TEXT,
			first_delta_at TEXT,
			last_delta_at TEXT,
			args_completed_at TEXT,
			execution_started_at TEXT,
			execution_ended_at TEXT,
			duration_ms INTEGER,
			args_bytes INTEGER NOT NULL DEFAULT 0,
			parse_status TEXT NOT NULL,
			safe_arg_keys_json TEXT NOT NULL DEFAULT '[]',
			event_stream_id INTEGER,
			event_id TEXT,
			payload_ref TEXT,
			run_id TEXT,
			error_category TEXT,
			error_message TEXT,
			retention_class TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_sessions_owner_activity
			ON sessions(owner_scope, archived_at, last_activity_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_room_activity
			ON sessions(room_id, archived_at, last_activity_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_parent_activity
			ON sessions(parent_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_origin_activity
			ON sessions(origin_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_channel_kind_activity
			ON sessions(channel, kind, updated_at DESC);
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
		CREATE INDEX IF NOT EXISTS idx_telemetry_turns_session_updated
			ON telemetry_turns(pibo_session_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_turns_room_updated
			ON telemetry_turns(room_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_turns_event
			ON telemetry_turns(event_id, event_stream_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_turns_payload
			ON telemetry_turns(payload_ref);
		CREATE INDEX IF NOT EXISTS idx_telemetry_turns_retention_updated
			ON telemetry_turns(retention_class, updated_at);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_turn_started
			ON telemetry_phases(turn_id, started_at ASC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_session_status
			ON telemetry_phases(pibo_session_id, status, last_progress_at);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_provider_request
			ON telemetry_phases(provider_request_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_tool_call
			ON telemetry_phases(tool_call_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_event
			ON telemetry_phases(event_id, event_stream_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_payload
			ON telemetry_phases(payload_ref);
		CREATE INDEX IF NOT EXISTS idx_telemetry_phases_retention_updated
			ON telemetry_phases(retention_class, updated_at);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_session_updated
			ON telemetry_provider_requests(pibo_session_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_turn
			ON telemetry_provider_requests(turn_id, started_at ASC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_upstream
			ON telemetry_provider_requests(upstream_response_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_event
			ON telemetry_provider_requests(event_id, event_stream_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_payload
			ON telemetry_provider_requests(payload_ref);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_requests_retention_updated
			ON telemetry_provider_requests(retention_class, updated_at);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_request_sequence
			ON telemetry_provider_events(provider_request_id, sequence ASC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_session_received
			ON telemetry_provider_events(pibo_session_id, received_at DESC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_event
			ON telemetry_provider_events(event_id, event_stream_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_payload
			ON telemetry_provider_events(payload_ref, payload_preview_ref);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_tool_call
			ON telemetry_provider_events(tool_call_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_provider_events_retention_received
			ON telemetry_provider_events(retention_class, received_at);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_session_updated
			ON telemetry_tool_calls(pibo_session_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_turn
			ON telemetry_tool_calls(turn_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_provider_request
			ON telemetry_tool_calls(provider_request_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_event
			ON telemetry_tool_calls(event_id, event_stream_id);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_payload
			ON telemetry_tool_calls(payload_ref);
		CREATE INDEX IF NOT EXISTS idx_telemetry_tool_calls_retention_updated
			ON telemetry_tool_calls(retention_class, updated_at);
	`);
	db.exec(`PRAGMA user_version = ${PIBO_DATA_SCHEMA_VERSION}`);
}
