import type { DatabaseSync } from "node:sqlite";

export const PIBO_DATA_SCHEMA_VERSION = 9;

const NATIVE_HISTORY_FALLBACK_SCHEMA_VERSION = 5;
const retiredScopeColumn = ["owner", "scope"].join("_");

type RetiredScopeTable = {
	name: "sessions" | "rooms" | "session_navigation";
	columns: string[];
	definition: string;
};

const payloadTableDefinition = `
	id TEXT PRIMARY KEY,
	sha256 TEXT NOT NULL,
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
`;

const payloadTableColumns = [
	"id", "sha256", "storage_kind", "storage_path", "content_type", "encoding",
	"byte_size", "compressed_byte_size", "preview_text", "retention_class", "ref_count",
	"status", "created_at", "last_verified_at",
];

const retiredScopeTables: RetiredScopeTable[] = [
	{
		name: "sessions",
		columns: [
			"id", "pi_session_id", "room_id", "root_session_id", "parent_id", "origin_id",
			"channel", "kind", "profile", "active_model_json", "workspace", "title",
			"first_message_preview", "status", "archived_at", "deleted_at", "metadata_json",
			"created_at", "updated_at", "last_activity_at",
		],
		definition: `
			id TEXT PRIMARY KEY,
			pi_session_id TEXT UNIQUE,
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
		`,
	},
	{
		name: "rooms",
		columns: [
			"id", "name", "topic", "type", "parent_room_id", "workspace", "archived_at",
			"retention_policy_id", "metadata_json", "created_at", "updated_at",
		],
		definition: `
			id TEXT PRIMARY KEY,
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
		`,
	},
	{
		name: "session_navigation",
		columns: [
			"room_id", "session_id", "root_session_id", "parent_id", "origin_id", "title",
			"profile", "status", "archived_at", "last_activity_at", "last_message_preview",
			"child_count", "sort_key", "updated_at",
		],
		definition: `
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
		`,
	},
];

function retiredScopeTablesToRebuild(db: DatabaseSync): RetiredScopeTable[] {
	return retiredScopeTables.filter((table) => (
		(db.prepare(`SELECT 1 FROM pragma_table_info('${table.name}') WHERE name = ?`).get(retiredScopeColumn)) !== undefined
	));
}

function rebuildRetiredScopeTables(db: DatabaseSync, tablesToRebuild: RetiredScopeTable[]): void {
	for (const table of tablesToRebuild) {
		const replacement = `__pibo_schema_v7_${table.name}`;
		const columnList = table.columns.join(", ");
		db.exec(`
			CREATE TABLE ${replacement} (${table.definition});
			INSERT INTO ${replacement} (${columnList}) SELECT ${columnList} FROM ${table.name};
			DROP TABLE ${table.name};
			ALTER TABLE ${replacement} RENAME TO ${table.name};
		`);
	}
}

function payloadTableNeedsMetadataIdentityRebuild(db: DatabaseSync): boolean {
	const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'payloads'").get();
	if (!table) return false;
	const indexes = db.prepare("SELECT name FROM pragma_index_list('payloads') WHERE \"unique\" = 1").all() as Array<{ name: string }>;
	return indexes.some((index) => {
		const columns = db.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(index.name) as Array<{ name: string }>;
		return columns.length === 1 && columns[0]?.name === "sha256";
	});
}

function rebuildPayloadTableForMetadataIdentity(db: DatabaseSync): void {
	const columns = payloadTableColumns.join(", ");
	db.exec(`
		DROP TABLE IF EXISTS __pibo_schema_v8_payloads;
		CREATE TABLE __pibo_schema_v8_payloads (${payloadTableDefinition});
		INSERT INTO __pibo_schema_v8_payloads (${columns}) SELECT ${columns} FROM payloads;
		DROP TABLE payloads;
		ALTER TABLE __pibo_schema_v8_payloads RENAME TO payloads;
	`);
}

export function assertSupportedPiboDataSchemaVersion(db: DatabaseSync): number {
	const version = Number((db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0);
	if (version > PIBO_DATA_SCHEMA_VERSION) {
		throw new Error(`Pibo database schema version ${version} is newer than supported version ${PIBO_DATA_SCHEMA_VERSION}`);
	}
	return version;
}

export const PIBO_DATA_SCHEMA_MIGRATION_STEPS = [
	"payload-metadata-identity",
	"schema",
	"runtime-bindings",
	"render-high-water",
	"sequence-repair-selection",
	"sequence-repair-temporary",
	"sequence-repair-backfill",
	"sequence-repair-cleanup",
	"runtime-binding-metadata",
	"user-version",
] as const;

export type PiboDataSchemaMigrationStep = typeof PIBO_DATA_SCHEMA_MIGRATION_STEPS[number];

export type PiboDataSchemaMigrationHooks = {
	afterStep?(step: PiboDataSchemaMigrationStep): void;
};

export function applyPiboDataSchema(db: DatabaseSync, hooks: PiboDataSchemaMigrationHooks = {}): void {
	const previousVersion = assertSupportedPiboDataSchemaVersion(db);
	const tablesToRebuild = retiredScopeTablesToRebuild(db);
	const rebuildPayloadTable = payloadTableNeedsMetadataIdentityRebuild(db);
	const requiresTableRebuild = tablesToRebuild.length > 0 || rebuildPayloadTable;
	const ownsTransaction = !db.isTransaction;
	if (!ownsTransaction && requiresTableRebuild) {
		throw new Error("Pibo data schema migration requires an independent transaction");
	}
	const foreignKeysEnabled = ownsTransaction
		&& requiresTableRebuild
		&& Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number }).foreign_keys ?? 0) === 1;
	if (foreignKeysEnabled) db.exec("PRAGMA foreign_keys = OFF");
	try {
		if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
		applyPiboDataSchemaInTransaction(db, hooks, previousVersion, tablesToRebuild, rebuildPayloadTable);
		if (requiresTableRebuild) {
			const violations = db.prepare("PRAGMA foreign_key_check").all();
			if (violations.length > 0) {
				throw new Error(`Pibo data schema migration would retain ${violations.length} foreign-key violation(s)`);
			}
		}
		if (ownsTransaction) db.exec("COMMIT");
	} catch (error) {
		if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
		throw error;
	} finally {
		if (foreignKeysEnabled) db.exec("PRAGMA foreign_keys = ON");
	}
}

function applyPiboDataSchemaInTransaction(
	db: DatabaseSync,
	hooks: PiboDataSchemaMigrationHooks,
	previousVersion: number,
	tablesToRebuild: RetiredScopeTable[],
	rebuildPayloadTable: boolean,
): void {
	const existingSessionCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'").get() as { count: number };
	const hadSessionsBeforeMigration = existingSessionCount.count > 0
		&& Number((db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count) > 0;
	rebuildRetiredScopeTables(db, tablesToRebuild);
	if (rebuildPayloadTable) rebuildPayloadTableForMetadataIdentity(db);
	hooks.afterStep?.("payload-metadata-identity");
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			pi_session_id TEXT UNIQUE,
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

		CREATE TABLE IF NOT EXISTS session_runtime_bindings (
			pibo_session_id TEXT PRIMARY KEY,
			runtime_instance_id TEXT NOT NULL,
			runtime_adapter_id TEXT NOT NULL,
			native_session_id TEXT,
			binding_state TEXT NOT NULL CHECK(binding_state IN ('unbound', 'bound', 'missing', 'error'))
				CHECK(binding_state NOT IN ('bound', 'missing') OR native_session_id IS NOT NULL),
			protocol TEXT,
			protocol_version TEXT,
			adapter_version TEXT,
			locator_json TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_output_render_high_water (
			pibo_session_id TEXT PRIMARY KEY,
			high_water INTEGER NOT NULL CHECK(high_water >= 0),
			updated_at TEXT NOT NULL,
			FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_agent_observation_counters (
			parent_pibo_session_id TEXT PRIMARY KEY,
			next_sequence INTEGER NOT NULL CHECK(next_sequence >= 1),
			updated_at TEXT NOT NULL,
			FOREIGN KEY (parent_pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_agent_observation_auto_cursors (
			parent_pibo_session_id TEXT NOT NULL,
			cursor_scope TEXT NOT NULL,
			sequence INTEGER NOT NULL CHECK(sequence >= 0),
			updated_at TEXT NOT NULL,
			PRIMARY KEY (parent_pibo_session_id, cursor_scope),
			FOREIGN KEY (parent_pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_output_part_counters (
			pibo_session_id TEXT NOT NULL,
			event_id TEXT NOT NULL,
			part_kind TEXT NOT NULL CHECK(part_kind IN ('assistant', 'thinking', 'usage', 'compaction')),
			next_index INTEGER NOT NULL CHECK(next_index >= 0),
			updated_at TEXT NOT NULL,
			PRIMARY KEY (pibo_session_id, event_id, part_kind),
			FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_tool_invocation_counters (
			pibo_session_id TEXT NOT NULL,
			event_id TEXT NOT NULL,
			tool_call_id TEXT NOT NULL,
			next_ordinal INTEGER NOT NULL CHECK(next_ordinal >= 0),
			updated_at TEXT NOT NULL,
			PRIMARY KEY (pibo_session_id, event_id, tool_call_id),
			FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS session_tool_invocations (
			pibo_session_id TEXT NOT NULL,
			event_id TEXT NOT NULL,
			tool_call_id TEXT NOT NULL,
			invocation_ordinal INTEGER NOT NULL CHECK(invocation_ordinal >= 0),
			call_fingerprint TEXT,
			status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
			seen_call INTEGER NOT NULL DEFAULT 0 CHECK(seen_call IN (0, 1)),
			seen_started INTEGER NOT NULL DEFAULT 0 CHECK(seen_started IN (0, 1)),
			seen_updated INTEGER NOT NULL DEFAULT 0 CHECK(seen_updated IN (0, 1)),
			seen_finished INTEGER NOT NULL DEFAULT 0 CHECK(seen_finished IN (0, 1)),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (pibo_session_id, event_id, tool_call_id, invocation_ordinal),
			FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_session_tool_invocations_open
			ON session_tool_invocations(pibo_session_id, event_id, tool_call_id, status, invocation_ordinal DESC);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_session_runtime_bindings_native
			ON session_runtime_bindings(runtime_adapter_id, native_session_id)
			WHERE native_session_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_session_runtime_bindings_instance_state
			ON session_runtime_bindings(runtime_instance_id, binding_state, updated_at DESC);

		CREATE TRIGGER IF NOT EXISTS trg_sessions_runtime_binding_insert
		AFTER INSERT ON sessions
		WHEN NOT EXISTS (
			SELECT 1 FROM session_runtime_bindings WHERE pibo_session_id = NEW.id
		)
		BEGIN
			INSERT INTO session_runtime_bindings (
				pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
				binding_state, protocol, metadata_json, revision, created_at, updated_at
			) VALUES (
				NEW.id, 'pi', 'pi', NULLIF(NEW.pi_session_id, ''),
				'unbound',
				'pi-sdk', '{}', 1, NEW.created_at, NEW.updated_at
			);
		END;

		CREATE TRIGGER IF NOT EXISTS trg_sessions_runtime_binding_pi_update
		AFTER UPDATE OF pi_session_id ON sessions
		WHEN EXISTS (
			SELECT 1 FROM session_runtime_bindings
			WHERE pibo_session_id = NEW.id
				AND runtime_adapter_id = 'pi'
				AND COALESCE(native_session_id, '') <> COALESCE(NEW.pi_session_id, '')
		)
		BEGIN
			UPDATE session_runtime_bindings SET
				native_session_id = NULLIF(NEW.pi_session_id, ''),
				binding_state = CASE WHEN NEW.pi_session_id IS NULL OR NEW.pi_session_id = '' THEN 'unbound' ELSE 'bound' END,
				revision = revision + 1,
				updated_at = NEW.updated_at
			WHERE pibo_session_id = NEW.id AND runtime_adapter_id = 'pi';
		END;

		CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
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


		CREATE TABLE IF NOT EXISTS payloads (${payloadTableDefinition});
		CREATE UNIQUE INDEX IF NOT EXISTS idx_payloads_identity
			ON payloads(sha256, content_type, retention_class);

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

		CREATE TABLE IF NOT EXISTS app_session_read_state (
			session_id TEXT PRIMARY KEY,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_message_sequence INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS app_room_read_state (
			room_id TEXT PRIMARY KEY,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS session_navigation (
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

		CREATE INDEX IF NOT EXISTS idx_sessions_room_activity
			ON sessions(room_id, archived_at, last_activity_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_parent_activity
			ON sessions(parent_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_origin_activity
			ON sessions(origin_id, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_channel_kind_activity
			ON sessions(channel, kind, updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_event_log_session_stream
			ON event_log(session_id, stream_id);
		CREATE INDEX IF NOT EXISTS idx_event_log_unread_session_stream
			ON event_log(session_id, stream_id)
			WHERE (retention_class = 'chat_message' AND type IN ('user.message.accepted', 'assistant_message'))
				OR type = 'session_error';
		CREATE INDEX IF NOT EXISTS idx_event_log_session_sequence_stream
			ON event_log(session_id, session_sequence DESC, stream_id DESC);
		CREATE INDEX IF NOT EXISTS idx_event_log_session_type_sequence_stream
			ON event_log(session_id, type, session_sequence ASC, stream_id ASC);
		CREATE INDEX IF NOT EXISTS idx_event_log_session_tool_event_sequence_stream
			ON event_log(session_id, tool_call_id, event_id, session_sequence ASC, stream_id ASC)
			WHERE tool_call_id IS NOT NULL
				AND type IN ('tool_execution_started', 'tool_execution_updated', 'tool_execution_finished');
		CREATE INDEX IF NOT EXISTS idx_event_log_session_tool_sequence_stream
			ON event_log(session_id, tool_call_id, session_sequence ASC, stream_id ASC)
			WHERE tool_call_id IS NOT NULL
				AND type IN ('tool_execution_started', 'tool_execution_updated', 'tool_execution_finished');
		CREATE INDEX IF NOT EXISTS idx_event_log_session_attribute_tool_event_sequence_stream
			ON event_log(
				session_id,
				json_extract(attributes_json, '$.toolCallId'),
				event_id,
				session_sequence ASC,
				stream_id ASC
			)
			WHERE type IN ('tool_execution_started', 'tool_execution_updated', 'tool_execution_finished');
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
		CREATE INDEX IF NOT EXISTS idx_session_navigation_room_sort
			ON session_navigation(room_id, archived_at, sort_key DESC);
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
	hooks.afterStep?.("schema");
	db.exec(`
		INSERT OR IGNORE INTO session_runtime_bindings (
			pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
			binding_state, protocol, metadata_json, revision, created_at, updated_at
		)
		SELECT
			id, 'pi', 'pi', NULLIF(pi_session_id, ''),
			CASE WHEN pi_session_id IS NULL OR pi_session_id = '' THEN 'unbound' ELSE 'bound' END,
			'pi-sdk',
			CASE WHEN EXISTS (SELECT 1 FROM event_log WHERE event_log.session_id = sessions.id LIMIT 1)
				THEN '{"migrationSource":"schema-v4","nativePresenceExpected":true}'
				ELSE '{"migrationSource":"schema-v4","nativePresenceExpected":false}'
			END,
			1, created_at, updated_at
		FROM sessions
		WHERE NOT EXISTS (
			SELECT 1 FROM session_runtime_bindings existing
			WHERE existing.pibo_session_id = sessions.id
		);
	`);
	hooks.afterStep?.("runtime-bindings");
	db.exec(`
		INSERT INTO session_output_render_high_water (pibo_session_id, high_water, updated_at)
		SELECT
			id,
			CAST(json_extract(metadata_json, '$.outputRenderSequenceHighWater') AS INTEGER),
			updated_at
		FROM sessions
		WHERE json_type(metadata_json, '$.outputRenderSequenceHighWater') IN ('integer', 'real')
			AND CAST(json_extract(metadata_json, '$.outputRenderSequenceHighWater') AS INTEGER) >= 0
		ON CONFLICT(pibo_session_id) DO UPDATE SET
			high_water = MAX(session_output_render_high_water.high_water, excluded.high_water),
			updated_at = CASE
				WHEN excluded.high_water > session_output_render_high_water.high_water THEN excluded.updated_at
				ELSE session_output_render_high_water.updated_at
			END;
	`);
	hooks.afterStep?.("render-high-water");
	// Always inspect for interrupted pre-atomic v7 repairs. A previous process
	// may have written negative temporary values before setting user_version.
	db.exec(`
		DROP TABLE IF EXISTS temp.pibo_v7_sequence_repair_sessions;
		CREATE TEMP TABLE pibo_v7_sequence_repair_sessions (
			session_id TEXT PRIMARY KEY
		);
		INSERT INTO pibo_v7_sequence_repair_sessions (session_id)
		SELECT DISTINCT session_id
		FROM event_log
		WHERE session_id IS NOT NULL
			AND (session_sequence IS NULL OR session_sequence <= 0);
	`);
	hooks.afterStep?.("sequence-repair-selection");
	db.exec(`
		UPDATE event_log
		SET session_sequence = -stream_id
		WHERE session_id IN (SELECT session_id FROM pibo_v7_sequence_repair_sessions);
	`);
	hooks.afterStep?.("sequence-repair-temporary");
	db.exec(`
		WITH ranked AS (
			SELECT
				stream_id,
				ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY stream_id ASC) AS repaired_sequence
			FROM event_log
			WHERE session_id IN (SELECT session_id FROM pibo_v7_sequence_repair_sessions)
		)
		UPDATE event_log
		SET session_sequence = (
			SELECT repaired_sequence FROM ranked WHERE ranked.stream_id = event_log.stream_id
		)
		WHERE stream_id IN (SELECT stream_id FROM ranked);
	`);
	hooks.afterStep?.("sequence-repair-backfill");
	db.exec("DROP TABLE pibo_v7_sequence_repair_sessions");
	hooks.afterStep?.("sequence-repair-cleanup");
	if (previousVersion < NATIVE_HISTORY_FALLBACK_SCHEMA_VERSION && hadSessionsBeforeMigration) {
		const rows = db.prepare("SELECT pibo_session_id, metadata_json FROM session_runtime_bindings").all() as Array<{
			pibo_session_id: string;
			metadata_json: string;
		}>;
		const update = db.prepare("UPDATE session_runtime_bindings SET metadata_json = ? WHERE pibo_session_id = ?");
		for (const row of rows) {
			let metadata: Record<string, unknown> = {};
			try {
				const parsed = JSON.parse(row.metadata_json) as unknown;
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
			} catch {
				// Preserve a valid object even if legacy metadata was malformed.
			}
			if (metadata.nativeHistoryFallback === true) continue;
			update.run(JSON.stringify({
				...metadata,
				nativeHistoryFallback: true,
				historyMigrationSource: "schema-v5",
			}), row.pibo_session_id);
		}
	}
	hooks.afterStep?.("runtime-binding-metadata");
	db.exec(`PRAGMA user_version = ${PIBO_DATA_SCHEMA_VERSION}`);
	hooks.afterStep?.("user-version");
}
