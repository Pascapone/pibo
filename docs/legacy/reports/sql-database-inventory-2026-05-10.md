# SQL Database Inventory

Generated: 2026-05-10

Scope: current Pibo SQLite databases under `/root/.pibo` plus the project-local `.pibo` databases under `/root/code/pibo/.pibo`. Browser profile databases and backups are intentionally excluded. Row counts are metadata only; no table data or secrets are dumped.

## Summary

| Database | File size | SQLite pages | Free pages | Tables | Indexes | Views | Triggers | Columns | Rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `/root/.pibo/auth.sqlite` | 56.0 KiB | 56.0 KiB | 0 B | 4 | 3 | 0 | 0 | 34 | 8 |
| `/root/.pibo/chat-agents.sqlite` | 4.0 KiB | 20.0 KiB | 0 B | 1 | 1 | 0 | 0 | 21 | 3 |
| `/root/.pibo/context-files/context-files.sqlite` | 4.0 KiB | 40.0 KiB | 0 B | 2 | 2 | 0 | 0 | 21 | 14 |
| `/root/.pibo/pibo-cron.sqlite` | 36.0 KiB | 36.0 KiB | 0 B | 2 | 4 | 0 | 0 | 25 | 2 |
| `/root/.pibo/pibo-events.sqlite` | 880.3 MiB | 880.3 MiB | 628.6 MiB | 5 | 9 | 0 | 0 | 57 | 141628 |
| `/root/.pibo/pibo.sqlite` | 776.4 MiB | 776.4 MiB | 0 B | 13 | 14 | 0 | 0 | 166 | 477862 |
| `/root/.pibo/web-projects.sqlite` | 32.0 KiB | 32.0 KiB | 0 B | 2 | 3 | 0 | 0 | 24 | 2 |
| `/root/.pibo/workflows.sqlite` | 40.0 KiB | 40.0 KiB | 0 B | 3 | 2 | 0 | 0 | 32 | 0 |
| `/root/code/pibo/.pibo/auth.sqlite` | 56.0 KiB | 56.0 KiB | 0 B | 4 | 3 | 0 | 0 | 34 | 0 |
| `/root/code/pibo/.pibo/chat-agents.sqlite` | 4.0 KiB | 20.0 KiB | 0 B | 1 | 1 | 0 | 0 | 20 | 0 |
| `/root/code/pibo/.pibo/debug-pibo-sessions.sqlite` | 32.0 KiB | 32.0 KiB | 0 B | 1 | 4 | 0 | 0 | 13 | 1 |
| `/root/code/pibo/.pibo/pibo-events.sqlite` | 268.0 KiB | 268.0 KiB | 0 B | 5 | 9 | 0 | 0 | 57 | 371 |
| `/root/code/pibo/.pibo/pibo-sessions.sqlite` | 32.0 KiB | 32.0 KiB | 0 B | 1 | 4 | 0 | 0 | 13 | 0 |
| `/root/code/pibo/.pibo/web-chat.sqlite` | 4.0 KiB | 108.0 KiB | 0 B | 7 | 11 | 0 | 0 | 52 | 3 |

## Per-database schema and table metadata

### `/root/.pibo/auth.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `account` | 1 | 13 | `id` TEXT PK NOT NULL<br>`accountId` TEXT NOT NULL<br>`providerId` TEXT NOT NULL<br>`userId` TEXT NOT NULL<br>`accessToken` TEXT<br>`refreshToken` TEXT<br>`idToken` TEXT<br>`accessTokenExpiresAt` date<br>`refreshTokenExpiresAt` date<br>`scope` TEXT<br>`password` TEXT<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |
| `session` | 6 | 8 | `id` TEXT PK NOT NULL<br>`expiresAt` date NOT NULL<br>`token` TEXT NOT NULL<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL<br>`ipAddress` TEXT<br>`userAgent` TEXT<br>`userId` TEXT NOT NULL |
| `user` | 1 | 7 | `id` TEXT PK NOT NULL<br>`name` TEXT NOT NULL<br>`email` TEXT NOT NULL<br>`emailVerified` INTEGER NOT NULL<br>`image` TEXT<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |
| `verification` | 0 | 6 | `id` TEXT PK NOT NULL<br>`identifier` TEXT NOT NULL<br>`value` TEXT NOT NULL<br>`expiresAt` date NOT NULL<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX "account_userId_idx" on "account" ("userId");
CREATE INDEX "session_userId_idx" on "session" ("userId");
CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");
CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
```

</details>

### `/root/.pibo/chat-agents.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `chat_agents` | 3 | 21 | `id` TEXT PK<br>`profile_name` TEXT NOT NULL<br>`owner_scope` TEXT NOT NULL<br>`display_name` TEXT NOT NULL<br>`description` TEXT<br>`native_tools_json` TEXT NOT NULL<br>`skills_json` TEXT NOT NULL<br>`context_files_json` TEXT NOT NULL<br>`subagents_json` TEXT NOT NULL<br>`mcp_servers_json` TEXT NOT NULL DEFAULT '[]'<br>`pi_packages_json` TEXT NOT NULL DEFAULT '[]'<br>`builtin_tools` TEXT NOT NULL<br>`builtin_tool_names_json` TEXT NOT NULL DEFAULT '["read","bash","edit","write"]'<br>`auto_context_files` INTEGER NOT NULL DEFAULT 1<br>`run_control` INTEGER NOT NULL<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`archived_at` TEXT<br>`main_model_json` TEXT<br>`subagent_model_json` TEXT<br>`thinking_level` TEXT |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_chat_agents_owner
				ON chat_agents(owner_scope, updated_at);
CREATE TABLE chat_agents (
				id TEXT PRIMARY KEY,
				profile_name TEXT NOT NULL UNIQUE,
				owner_scope TEXT NOT NULL,
				display_name TEXT NOT NULL,
				description TEXT,
				native_tools_json TEXT NOT NULL,
				skills_json TEXT NOT NULL,
				context_files_json TEXT NOT NULL,
				subagents_json TEXT NOT NULL,
				mcp_servers_json TEXT NOT NULL DEFAULT '[]',
				pi_packages_json TEXT NOT NULL DEFAULT '[]',
				builtin_tools TEXT NOT NULL,
				builtin_tool_names_json TEXT NOT NULL DEFAULT '["read","bash","edit","write"]',
				auto_context_files INTEGER NOT NULL DEFAULT 1,
				run_control INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				archived_at TEXT
			, main_model_json TEXT, subagent_model_json TEXT, thinking_level TEXT);
```

</details>

### `/root/.pibo/context-files/context-files.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `context_file_revisions` | 12 | 10 | `id` TEXT PK<br>`context_file_key` TEXT NOT NULL<br>`kind` TEXT NOT NULL<br>`content_hash` TEXT NOT NULL<br>`content` TEXT NOT NULL<br>`created_at` TEXT NOT NULL<br>`actor_id` TEXT<br>`based_on_revision_id` TEXT<br>`source_hash_at_creation` TEXT<br>`note` TEXT |
| `context_files` | 2 | 11 | `key` TEXT PK<br>`label` TEXT NOT NULL<br>`managed_path` TEXT NOT NULL<br>`scope` TEXT NOT NULL<br>`source_type` TEXT NOT NULL<br>`agent_profile_name` TEXT<br>`active_revision_id` TEXT<br>`source_ref` TEXT<br>`source_hash` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_context_file_revisions_key
				ON context_file_revisions(context_file_key, created_at DESC);
CREATE INDEX idx_context_files_scope
				ON context_files(scope, updated_at);
CREATE TABLE context_file_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT,
				based_on_revision_id TEXT,
				source_hash_at_creation TEXT,
				note TEXT
			);
CREATE TABLE context_files (
				key TEXT PRIMARY KEY,
				label TEXT NOT NULL,
				managed_path TEXT NOT NULL,
				scope TEXT NOT NULL,
				source_type TEXT NOT NULL,
				agent_profile_name TEXT,
				active_revision_id TEXT,
				source_ref TEXT,
				source_hash TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
```

</details>

### `/root/.pibo/pibo-cron.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `pibo_cron_jobs` | 1 | 14 | `id` TEXT PK<br>`owner_scope` TEXT NOT NULL<br>`name` TEXT NOT NULL<br>`description` TEXT<br>`enabled` INTEGER NOT NULL<br>`target_json` TEXT NOT NULL<br>`profile` TEXT NOT NULL<br>`prompt` TEXT NOT NULL<br>`schedule_json` TEXT NOT NULL<br>`schedule_ui_json` TEXT<br>`delete_after_run` INTEGER NOT NULL DEFAULT 0<br>`state_json` TEXT NOT NULL<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |
| `pibo_cron_runs` | 1 | 11 | `id` TEXT PK<br>`job_id` TEXT NOT NULL<br>`owner_scope` TEXT NOT NULL<br>`pibo_session_id` TEXT<br>`status` TEXT NOT NULL<br>`reason` TEXT<br>`error` TEXT<br>`started_at` TEXT<br>`completed_at` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_pibo_cron_jobs_enabled ON pibo_cron_jobs(enabled, updated_at DESC);
CREATE INDEX idx_pibo_cron_jobs_owner ON pibo_cron_jobs(owner_scope, updated_at DESC);
CREATE INDEX idx_pibo_cron_runs_job_created ON pibo_cron_runs(job_id, created_at DESC);
CREATE INDEX idx_pibo_cron_runs_owner_created ON pibo_cron_runs(owner_scope, created_at DESC);
CREATE TABLE pibo_cron_jobs (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				enabled INTEGER NOT NULL,
				target_json TEXT NOT NULL,
				profile TEXT NOT NULL,
				prompt TEXT NOT NULL,
				schedule_json TEXT NOT NULL,
				schedule_ui_json TEXT,
				delete_after_run INTEGER NOT NULL DEFAULT 0,
				state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
CREATE TABLE pibo_cron_runs (
				id TEXT PRIMARY KEY,
				job_id TEXT NOT NULL,
				owner_scope TEXT NOT NULL,
				pibo_session_id TEXT,
				status TEXT NOT NULL,
				reason TEXT,
				error TEXT,
				started_at TEXT,
				completed_at TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
```

</details>

### `/root/.pibo/pibo-events.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `pibo_dead_jobs` | 115 | 12 | `job_id` TEXT PK<br>`queue` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL<br>`attempts` INTEGER NOT NULL<br>`max_attempts` INTEGER NOT NULL<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`expires_at` TEXT<br>`last_error` TEXT<br>`dead_at` TEXT NOT NULL<br>`dead_reason` TEXT NOT NULL |
| `pibo_event_consumers` | 0 | 4 | `consumer` TEXT PK NOT NULL<br>`topic` TEXT PK NOT NULL<br>`last_stream_id` INTEGER NOT NULL<br>`updated_at` TEXT NOT NULL |
| `pibo_event_stream` | 141507 | 8 | `stream_id` INTEGER PK<br>`topic` TEXT NOT NULL<br>`key` TEXT<br>`event_id` TEXT NOT NULL<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`retention_class` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL |
| `pibo_jobs` | 2 | 15 | `job_id` TEXT PK<br>`queue` TEXT NOT NULL<br>`state` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL<br>`run_at` TEXT NOT NULL<br>`priority` INTEGER NOT NULL DEFAULT 0<br>`worker_id` TEXT<br>`claim_expires_at` TEXT<br>`attempts` INTEGER NOT NULL DEFAULT 0<br>`max_attempts` INTEGER NOT NULL DEFAULT 1<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`expires_at` TEXT<br>`last_error` TEXT |
| `pibo_runs` | 4 | 18 | `run_id` TEXT PK<br>`kind` TEXT NOT NULL<br>`owner_pibo_session_id` TEXT NOT NULL<br>`status` TEXT NOT NULL<br>`completion_policy` TEXT NOT NULL<br>`consumed` INTEGER NOT NULL DEFAULT 0<br>`tool_name` TEXT NOT NULL<br>`summary` TEXT<br>`result_json` TEXT<br>`error` TEXT<br>`notified_status` TEXT<br>`acknowledged_status` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`completed_at` TEXT<br>`job_id` TEXT<br>`retryable` INTEGER NOT NULL DEFAULT 0<br>`max_attempts` INTEGER NOT NULL DEFAULT 1 |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_pibo_dead_jobs_queue_dead_at
				ON pibo_dead_jobs(queue, dead_at);
CREATE UNIQUE INDEX idx_pibo_event_stream_event
				ON pibo_event_stream(topic, event_id);
CREATE UNIQUE INDEX idx_pibo_event_stream_idempotency
				ON pibo_event_stream(topic, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pibo_event_stream_topic_stream
				ON pibo_event_stream(topic, stream_id);
CREATE INDEX idx_pibo_jobs_expired_claim
				ON pibo_jobs(queue, state, claim_expires_at, priority DESC, created_at)
				WHERE state = 'running';
CREATE UNIQUE INDEX idx_pibo_jobs_idempotency
				ON pibo_jobs(queue, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pibo_jobs_live_claim
				ON pibo_jobs(queue, state, run_at, priority DESC, created_at)
				WHERE state = 'pending';
CREATE INDEX idx_pibo_runs_owner_updated
				ON pibo_runs(owner_pibo_session_id, updated_at);
CREATE INDEX idx_pibo_runs_status
				ON pibo_runs(status);
CREATE TABLE pibo_dead_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				attempts INTEGER NOT NULL,
				max_attempts INTEGER NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT,
				dead_at TEXT NOT NULL,
				dead_reason TEXT NOT NULL
			);
CREATE TABLE pibo_event_consumers (
				consumer TEXT NOT NULL,
				topic TEXT NOT NULL,
				last_stream_id INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(consumer, topic)
			);
CREATE TABLE pibo_event_stream (
				stream_id INTEGER PRIMARY KEY,
				topic TEXT NOT NULL,
				key TEXT,
				event_id TEXT NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				retention_class TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);
CREATE TABLE pibo_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				state TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				run_at TEXT NOT NULL,
				priority INTEGER NOT NULL DEFAULT 0,
				worker_id TEXT,
				claim_expires_at TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT
			);
CREATE TABLE pibo_runs (
				run_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				owner_pibo_session_id TEXT NOT NULL,
				status TEXT NOT NULL,
				completion_policy TEXT NOT NULL,
				consumed INTEGER NOT NULL DEFAULT 0,
				tool_name TEXT NOT NULL,
				summary TEXT,
				result_json TEXT,
				error TEXT,
				notified_status TEXT,
				acknowledged_status TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				job_id TEXT,
				retryable INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1
			);
```

</details>

### `/root/.pibo/pibo.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `chat_messages` | 2798 | 17 | `id` TEXT PK<br>`session_id` TEXT NOT NULL<br>`room_id` TEXT<br>`sequence` INTEGER NOT NULL<br>`turn_id` TEXT<br>`role` TEXT NOT NULL<br>`actor_id` TEXT<br>`status` TEXT NOT NULL<br>`created_at` TEXT NOT NULL<br>`completed_at` TEXT<br>`content_preview` TEXT<br>`content_payload_ref` TEXT<br>`source_stream_id` INTEGER<br>`input_tokens` INTEGER<br>`output_tokens` INTEGER<br>`cost_usd` REAL<br>`attributes_json` TEXT NOT NULL DEFAULT '{}' |
| `event_log` | 193233 | 21 | `stream_id` INTEGER PK<br>`session_id` TEXT<br>`session_sequence` INTEGER<br>`room_id` TEXT<br>`topic` TEXT NOT NULL<br>`type` TEXT NOT NULL<br>`source` TEXT NOT NULL<br>`actor_type` TEXT<br>`actor_id` TEXT<br>`turn_id` TEXT<br>`event_id` TEXT<br>`tool_call_id` TEXT<br>`run_id` TEXT<br>`workflow_run_id` TEXT<br>`idempotency_key` TEXT<br>`retention_class` TEXT NOT NULL<br>`payload_ref` TEXT<br>`preview_text` TEXT<br>`attributes_json` TEXT NOT NULL DEFAULT '{}'<br>`created_at` TEXT NOT NULL<br>`indexed_at` TEXT |
| `indexer_offsets` | 0 | 4 | `indexer_name` TEXT PK<br>`source_name` TEXT NOT NULL<br>`last_stream_id` INTEGER NOT NULL<br>`updated_at` TEXT NOT NULL |
| `migration_import_map` | 176033 | 6 | `source_store` TEXT PK NOT NULL<br>`source_table` TEXT PK NOT NULL<br>`source_key` TEXT PK NOT NULL<br>`target_kind` TEXT NOT NULL<br>`target_id` TEXT NOT NULL<br>`imported_at` TEXT NOT NULL |
| `observations` | 104685 | 24 | `id` TEXT PK<br>`session_id` TEXT NOT NULL<br>`sequence` INTEGER NOT NULL<br>`trace_id` TEXT<br>`span_id` TEXT<br>`parent_span_id` TEXT<br>`parent_observation_id` TEXT<br>`turn_id` TEXT<br>`event_stream_id` INTEGER<br>`kind` TEXT NOT NULL<br>`role` TEXT<br>`name` TEXT<br>`status` TEXT NOT NULL<br>`started_at` TEXT NOT NULL<br>`ended_at` TEXT<br>`latency_ms` INTEGER<br>`model_provider` TEXT<br>`model_id` TEXT<br>`input_tokens` INTEGER<br>`output_tokens` INTEGER<br>`cost_usd` REAL<br>`preview_text` TEXT<br>`payload_ref` TEXT<br>`attributes_json` TEXT NOT NULL DEFAULT '{}' |
| `payloads` | 243 | 14 | `id` TEXT PK<br>`sha256` TEXT NOT NULL<br>`storage_kind` TEXT NOT NULL<br>`storage_path` TEXT<br>`content_type` TEXT NOT NULL<br>`encoding` TEXT NOT NULL DEFAULT 'gzip'<br>`byte_size` INTEGER NOT NULL<br>`compressed_byte_size` INTEGER<br>`preview_text` TEXT<br>`retention_class` TEXT NOT NULL<br>`ref_count` INTEGER NOT NULL DEFAULT 0<br>`status` TEXT NOT NULL DEFAULT 'committed'<br>`created_at` TEXT NOT NULL<br>`last_verified_at` TEXT |
| `principal_room_stats` | 0 | 6 | `room_id` TEXT PK NOT NULL<br>`principal_id` TEXT PK NOT NULL<br>`unread_count` INTEGER NOT NULL DEFAULT 0<br>`last_read_stream_id` INTEGER NOT NULL DEFAULT 0<br>`last_read_at` TEXT<br>`updated_at` TEXT NOT NULL |
| `principal_session_stats` | 257 | 7 | `session_id` TEXT PK NOT NULL<br>`principal_id` TEXT PK NOT NULL<br>`unread_count` INTEGER NOT NULL DEFAULT 0<br>`last_read_stream_id` INTEGER NOT NULL DEFAULT 0<br>`last_read_message_sequence` INTEGER NOT NULL DEFAULT 0<br>`last_read_at` TEXT<br>`updated_at` TEXT NOT NULL |
| `room_members` | 8 | 4 | `room_id` TEXT PK NOT NULL<br>`principal_id` TEXT PK NOT NULL<br>`role` TEXT NOT NULL<br>`joined_at` TEXT NOT NULL |
| `rooms` | 8 | 12 | `id` TEXT PK<br>`owner_scope` TEXT NOT NULL<br>`name` TEXT NOT NULL<br>`topic` TEXT<br>`type` TEXT NOT NULL<br>`parent_room_id` TEXT<br>`workspace` TEXT<br>`archived_at` TEXT<br>`retention_policy_id` TEXT<br>`metadata_json` TEXT NOT NULL DEFAULT '{}'<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |
| `session_navigation` | 298 | 15 | `owner_scope` TEXT NOT NULL<br>`room_id` TEXT<br>`session_id` TEXT PK<br>`root_session_id` TEXT<br>`parent_id` TEXT<br>`origin_id` TEXT<br>`title` TEXT NOT NULL<br>`profile` TEXT NOT NULL<br>`status` TEXT NOT NULL<br>`archived_at` TEXT<br>`last_activity_at` TEXT NOT NULL<br>`last_message_preview` TEXT<br>`child_count` INTEGER NOT NULL DEFAULT 0<br>`sort_key` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |
| `session_stats` | 0 | 15 | `session_id` TEXT PK<br>`message_count` INTEGER NOT NULL DEFAULT 0<br>`tool_call_count` INTEGER NOT NULL DEFAULT 0<br>`error_count` INTEGER NOT NULL DEFAULT 0<br>`last_event_stream_id` INTEGER<br>`last_message_sequence` INTEGER<br>`last_observation_sequence` INTEGER<br>`last_message_preview` TEXT<br>`last_activity_at` TEXT NOT NULL<br>`status` TEXT NOT NULL DEFAULT 'idle'<br>`total_latency_ms` INTEGER NOT NULL DEFAULT 0<br>`total_input_tokens` INTEGER NOT NULL DEFAULT 0<br>`total_output_tokens` INTEGER NOT NULL DEFAULT 0<br>`total_cost_usd` REAL NOT NULL DEFAULT 0<br>`updated_at` TEXT NOT NULL |
| `sessions` | 299 | 21 | `id` TEXT PK<br>`pi_session_id` TEXT<br>`owner_scope` TEXT NOT NULL<br>`room_id` TEXT<br>`root_session_id` TEXT<br>`parent_id` TEXT<br>`origin_id` TEXT<br>`channel` TEXT NOT NULL<br>`kind` TEXT NOT NULL<br>`profile` TEXT NOT NULL<br>`active_model_json` TEXT<br>`workspace` TEXT<br>`title` TEXT NOT NULL DEFAULT 'Untitled Session'<br>`first_message_preview` TEXT<br>`status` TEXT NOT NULL DEFAULT 'idle'<br>`archived_at` TEXT<br>`deleted_at` TEXT<br>`metadata_json` TEXT NOT NULL DEFAULT '{}'<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`last_activity_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_chat_messages_session_sequence
			ON chat_messages(session_id, sequence);
CREATE UNIQUE INDEX idx_event_log_idempotency
			ON event_log(idempotency_key)
			WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_event_log_room_stream
			ON event_log(room_id, stream_id);
CREATE INDEX idx_event_log_session_stream
			ON event_log(session_id, stream_id);
CREATE INDEX idx_event_log_topic_stream
			ON event_log(topic, stream_id);
CREATE INDEX idx_observations_session_sequence
			ON observations(session_id, sequence);
CREATE INDEX idx_room_members_principal
			ON room_members(principal_id, room_id);
CREATE INDEX idx_session_navigation_owner_room_sort
			ON session_navigation(owner_scope, room_id, archived_at, sort_key DESC);
CREATE INDEX idx_session_navigation_root
			ON session_navigation(root_session_id, parent_id);
CREATE INDEX idx_sessions_channel_kind_activity
			ON sessions(channel, kind, updated_at DESC);
CREATE INDEX idx_sessions_origin_activity
			ON sessions(origin_id, updated_at DESC);
CREATE INDEX idx_sessions_owner_activity
			ON sessions(owner_scope, archived_at, last_activity_at DESC);
CREATE INDEX idx_sessions_parent_activity
			ON sessions(parent_id, updated_at DESC);
CREATE INDEX idx_sessions_room_activity
			ON sessions(room_id, archived_at, last_activity_at DESC);
CREATE TABLE chat_messages (
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
CREATE TABLE event_log (
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
CREATE TABLE indexer_offsets (
			indexer_name TEXT PRIMARY KEY,
			source_name TEXT NOT NULL,
			last_stream_id INTEGER NOT NULL,
			updated_at TEXT NOT NULL
		);
CREATE TABLE migration_import_map (
			source_store TEXT NOT NULL,
			source_table TEXT NOT NULL,
			source_key TEXT NOT NULL,
			target_kind TEXT NOT NULL,
			target_id TEXT NOT NULL,
			imported_at TEXT NOT NULL,
			PRIMARY KEY(source_store, source_table, source_key)
		);
CREATE TABLE observations (
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
CREATE TABLE payloads (
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
CREATE TABLE principal_room_stats (
			room_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(room_id, principal_id)
		);
CREATE TABLE principal_session_stats (
			session_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			unread_count INTEGER NOT NULL DEFAULT 0,
			last_read_stream_id INTEGER NOT NULL DEFAULT 0,
			last_read_message_sequence INTEGER NOT NULL DEFAULT 0,
			last_read_at TEXT,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(session_id, principal_id)
		);
CREATE TABLE room_members (
			room_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			role TEXT NOT NULL,
			joined_at TEXT NOT NULL,
			PRIMARY KEY(room_id, principal_id)
		);
CREATE TABLE rooms (
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
CREATE TABLE session_navigation (
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
CREATE TABLE session_stats (
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
CREATE TABLE sessions (
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
```

</details>

### `/root/.pibo/web-projects.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `project_sessions` | 1 | 13 | `project_id` TEXT NOT NULL<br>`pibo_session_id` TEXT PK<br>`kind` TEXT NOT NULL DEFAULT 'main'<br>`workflow_id` TEXT NOT NULL DEFAULT 'simple-chat'<br>`workflow_run_id` TEXT<br>`parent_main_session_id` TEXT<br>`title` TEXT<br>`state` TEXT<br>`retry_count` INTEGER<br>`max_retries` INTEGER<br>`archived` INTEGER NOT NULL DEFAULT 0<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |
| `projects` | 1 | 11 | `id` TEXT PK<br>`owner_scope` TEXT NOT NULL<br>`name` TEXT NOT NULL<br>`description` TEXT<br>`project_folder` TEXT NOT NULL<br>`configuration_status` TEXT NOT NULL DEFAULT 'configured'<br>`current_main_session_id` TEXT<br>`archived_at` TEXT<br>`metadata_json` TEXT NOT NULL DEFAULT '{}'<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX project_sessions_project_id_idx ON project_sessions(project_id, archived, created_at);
CREATE UNIQUE INDEX projects_folder_unique ON projects (project_folder);
CREATE UNIQUE INDEX projects_name_unique ON projects (lower(name));
CREATE TABLE project_sessions (
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				pibo_session_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL DEFAULT 'main',
				workflow_id TEXT NOT NULL DEFAULT 'simple-chat',
				workflow_run_id TEXT,
				parent_main_session_id TEXT,
				title TEXT,
				state TEXT,
				retry_count INTEGER,
				max_retries INTEGER,
				archived INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
CREATE TABLE projects (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				project_folder TEXT NOT NULL,
				configuration_status TEXT NOT NULL DEFAULT 'configured',
				current_main_session_id TEXT,
				archived_at TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
```

</details>

### `/root/.pibo/workflows.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `workflow_runs` | 0 | 18 | `id` TEXT PK<br>`workflow_id` TEXT NOT NULL<br>`workflow_version` TEXT NOT NULL<br>`usage` TEXT NOT NULL<br>`owner_scope` TEXT NOT NULL<br>`project_id` TEXT<br>`status` TEXT NOT NULL<br>`current_node_id` TEXT NOT NULL<br>`retry_count` INTEGER NOT NULL<br>`max_retries` INTEGER NOT NULL<br>`state_json` TEXT NOT NULL<br>`expected_actions_json` TEXT<br>`waiting_prompt` TEXT<br>`reason` TEXT<br>`initiator` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`completed_at` TEXT |
| `workflow_session_links` | 0 | 5 | `workflow_run_id` TEXT PK NOT NULL<br>`pibo_session_id` TEXT PK NOT NULL<br>`role` TEXT PK NOT NULL<br>`created_at` TEXT NOT NULL<br>`metadata_json` TEXT NOT NULL |
| `workflow_trace_events` | 0 | 9 | `id` TEXT PK<br>`workflow_run_id` TEXT NOT NULL<br>`sequence` INTEGER NOT NULL<br>`type` TEXT NOT NULL<br>`node_id` TEXT<br>`edge_id` TEXT<br>`pibo_session_id` TEXT<br>`payload_json` TEXT NOT NULL<br>`created_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_workflow_runs_owner ON workflow_runs(owner_scope, updated_at);
CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id, updated_at);
CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        usage TEXT NOT NULL,
        owner_scope TEXT NOT NULL,
        project_id TEXT,
        status TEXT NOT NULL,
        current_node_id TEXT NOT NULL,
        retry_count INTEGER NOT NULL,
        max_retries INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        expected_actions_json TEXT,
        waiting_prompt TEXT,
        reason TEXT,
        initiator TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
CREATE TABLE workflow_session_links (
        workflow_run_id TEXT NOT NULL,
        pibo_session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY(workflow_run_id, pibo_session_id, role)
      );
CREATE TABLE workflow_trace_events (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        node_id TEXT,
        edge_id TEXT,
        pibo_session_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workflow_run_id, sequence)
      );
```

</details>

### `/root/code/pibo/.pibo/auth.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `account` | 0 | 13 | `id` TEXT PK NOT NULL<br>`accountId` TEXT NOT NULL<br>`providerId` TEXT NOT NULL<br>`userId` TEXT NOT NULL<br>`accessToken` TEXT<br>`refreshToken` TEXT<br>`idToken` TEXT<br>`accessTokenExpiresAt` date<br>`refreshTokenExpiresAt` date<br>`scope` TEXT<br>`password` TEXT<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |
| `session` | 0 | 8 | `id` TEXT PK NOT NULL<br>`expiresAt` date NOT NULL<br>`token` TEXT NOT NULL<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL<br>`ipAddress` TEXT<br>`userAgent` TEXT<br>`userId` TEXT NOT NULL |
| `user` | 0 | 7 | `id` TEXT PK NOT NULL<br>`name` TEXT NOT NULL<br>`email` TEXT NOT NULL<br>`emailVerified` INTEGER NOT NULL<br>`image` TEXT<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |
| `verification` | 0 | 6 | `id` TEXT PK NOT NULL<br>`identifier` TEXT NOT NULL<br>`value` TEXT NOT NULL<br>`expiresAt` date NOT NULL<br>`createdAt` date NOT NULL<br>`updatedAt` date NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX "account_userId_idx" on "account" ("userId");
CREATE INDEX "session_userId_idx" on "session" ("userId");
CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");
CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
```

</details>

### `/root/code/pibo/.pibo/chat-agents.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `chat_agents` | 0 | 20 | `id` TEXT PK<br>`profile_name` TEXT NOT NULL<br>`owner_scope` TEXT NOT NULL<br>`display_name` TEXT NOT NULL<br>`description` TEXT<br>`native_tools_json` TEXT NOT NULL<br>`skills_json` TEXT NOT NULL<br>`context_files_json` TEXT NOT NULL<br>`subagents_json` TEXT NOT NULL<br>`mcp_servers_json` TEXT NOT NULL DEFAULT '[]'<br>`pi_packages_json` TEXT NOT NULL DEFAULT '[]'<br>`main_model_json` TEXT<br>`subagent_model_json` TEXT<br>`builtin_tools` TEXT NOT NULL<br>`builtin_tool_names_json` TEXT NOT NULL DEFAULT '["read","bash","edit","write"]'<br>`auto_context_files` INTEGER NOT NULL DEFAULT 1<br>`run_control` INTEGER NOT NULL<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`archived_at` TEXT |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_chat_agents_owner
				ON chat_agents(owner_scope, updated_at);
CREATE TABLE chat_agents (
				id TEXT PRIMARY KEY,
				profile_name TEXT NOT NULL UNIQUE,
				owner_scope TEXT NOT NULL,
				display_name TEXT NOT NULL,
				description TEXT,
				native_tools_json TEXT NOT NULL,
				skills_json TEXT NOT NULL,
				context_files_json TEXT NOT NULL,
				subagents_json TEXT NOT NULL,
				mcp_servers_json TEXT NOT NULL DEFAULT '[]',
				pi_packages_json TEXT NOT NULL DEFAULT '[]',
				main_model_json TEXT,
				subagent_model_json TEXT,
				builtin_tools TEXT NOT NULL,
				builtin_tool_names_json TEXT NOT NULL DEFAULT '["read","bash","edit","write"]',
				auto_context_files INTEGER NOT NULL DEFAULT 1,
				run_control INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				archived_at TEXT
			);
```

</details>

### `/root/code/pibo/.pibo/debug-pibo-sessions.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `pibo_sessions` | 1 | 13 | `id` TEXT PK<br>`pi_session_id` TEXT NOT NULL<br>`channel` TEXT NOT NULL<br>`kind` TEXT NOT NULL<br>`profile` TEXT NOT NULL<br>`owner_scope` TEXT<br>`parent_id` TEXT<br>`origin_id` TEXT<br>`workspace` TEXT<br>`title` TEXT<br>`metadata_json` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_pibo_sessions_channel_kind
				ON pibo_sessions(channel, kind, updated_at);
CREATE INDEX idx_pibo_sessions_origin
				ON pibo_sessions(origin_id, updated_at);
CREATE INDEX idx_pibo_sessions_owner
				ON pibo_sessions(owner_scope, updated_at);
CREATE INDEX idx_pibo_sessions_parent
				ON pibo_sessions(parent_id, updated_at);
CREATE TABLE pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
				owner_scope TEXT,
				parent_id TEXT,
				origin_id TEXT,
				workspace TEXT,
				title TEXT,
				metadata_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(parent_id) REFERENCES pibo_sessions(id),
				FOREIGN KEY(origin_id) REFERENCES pibo_sessions(id)
			);
```

</details>

### `/root/code/pibo/.pibo/pibo-events.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `pibo_dead_jobs` | 0 | 12 | `job_id` TEXT PK<br>`queue` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL<br>`attempts` INTEGER NOT NULL<br>`max_attempts` INTEGER NOT NULL<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`expires_at` TEXT<br>`last_error` TEXT<br>`dead_at` TEXT NOT NULL<br>`dead_reason` TEXT NOT NULL |
| `pibo_event_consumers` | 0 | 4 | `consumer` TEXT PK NOT NULL<br>`topic` TEXT PK NOT NULL<br>`last_stream_id` INTEGER NOT NULL<br>`updated_at` TEXT NOT NULL |
| `pibo_event_stream` | 371 | 8 | `stream_id` INTEGER PK<br>`topic` TEXT NOT NULL<br>`key` TEXT<br>`event_id` TEXT NOT NULL<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`retention_class` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL |
| `pibo_jobs` | 0 | 15 | `job_id` TEXT PK<br>`queue` TEXT NOT NULL<br>`state` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL<br>`run_at` TEXT NOT NULL<br>`priority` INTEGER NOT NULL DEFAULT 0<br>`worker_id` TEXT<br>`claim_expires_at` TEXT<br>`attempts` INTEGER NOT NULL DEFAULT 0<br>`max_attempts` INTEGER NOT NULL DEFAULT 1<br>`idempotency_key` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`expires_at` TEXT<br>`last_error` TEXT |
| `pibo_runs` | 0 | 18 | `run_id` TEXT PK<br>`kind` TEXT NOT NULL<br>`owner_pibo_session_id` TEXT NOT NULL<br>`status` TEXT NOT NULL<br>`completion_policy` TEXT NOT NULL<br>`consumed` INTEGER NOT NULL DEFAULT 0<br>`tool_name` TEXT NOT NULL<br>`summary` TEXT<br>`result_json` TEXT<br>`error` TEXT<br>`notified_status` TEXT<br>`acknowledged_status` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`completed_at` TEXT<br>`job_id` TEXT<br>`retryable` INTEGER NOT NULL DEFAULT 0<br>`max_attempts` INTEGER NOT NULL DEFAULT 1 |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_pibo_dead_jobs_queue_dead_at
				ON pibo_dead_jobs(queue, dead_at);
CREATE UNIQUE INDEX idx_pibo_event_stream_event
				ON pibo_event_stream(topic, event_id);
CREATE UNIQUE INDEX idx_pibo_event_stream_idempotency
				ON pibo_event_stream(topic, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pibo_event_stream_topic_stream
				ON pibo_event_stream(topic, stream_id);
CREATE INDEX idx_pibo_jobs_expired_claim
				ON pibo_jobs(queue, state, claim_expires_at, priority DESC, created_at)
				WHERE state = 'running';
CREATE UNIQUE INDEX idx_pibo_jobs_idempotency
				ON pibo_jobs(queue, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pibo_jobs_live_claim
				ON pibo_jobs(queue, state, run_at, priority DESC, created_at)
				WHERE state = 'pending';
CREATE INDEX idx_pibo_runs_owner_updated
				ON pibo_runs(owner_pibo_session_id, updated_at);
CREATE INDEX idx_pibo_runs_status
				ON pibo_runs(status);
CREATE TABLE pibo_dead_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				attempts INTEGER NOT NULL,
				max_attempts INTEGER NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT,
				dead_at TEXT NOT NULL,
				dead_reason TEXT NOT NULL
			);
CREATE TABLE pibo_event_consumers (
				consumer TEXT NOT NULL,
				topic TEXT NOT NULL,
				last_stream_id INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(consumer, topic)
			);
CREATE TABLE pibo_event_stream (
				stream_id INTEGER PRIMARY KEY,
				topic TEXT NOT NULL,
				key TEXT,
				event_id TEXT NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				retention_class TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);
CREATE TABLE pibo_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				state TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				run_at TEXT NOT NULL,
				priority INTEGER NOT NULL DEFAULT 0,
				worker_id TEXT,
				claim_expires_at TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT
			);
CREATE TABLE pibo_runs (
				run_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				owner_pibo_session_id TEXT NOT NULL,
				status TEXT NOT NULL,
				completion_policy TEXT NOT NULL,
				consumed INTEGER NOT NULL DEFAULT 0,
				tool_name TEXT NOT NULL,
				summary TEXT,
				result_json TEXT,
				error TEXT,
				notified_status TEXT,
				acknowledged_status TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				job_id TEXT,
				retryable INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1
			);
```

</details>

### `/root/code/pibo/.pibo/pibo-sessions.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `pibo_sessions` | 0 | 13 | `id` TEXT PK<br>`pi_session_id` TEXT NOT NULL<br>`channel` TEXT NOT NULL<br>`kind` TEXT NOT NULL<br>`profile` TEXT NOT NULL<br>`owner_scope` TEXT<br>`parent_id` TEXT<br>`origin_id` TEXT<br>`workspace` TEXT<br>`title` TEXT<br>`metadata_json` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE INDEX idx_pibo_sessions_channel_kind
				ON pibo_sessions(channel, kind, updated_at);
CREATE INDEX idx_pibo_sessions_origin
				ON pibo_sessions(origin_id, updated_at);
CREATE INDEX idx_pibo_sessions_owner
				ON pibo_sessions(owner_scope, updated_at);
CREATE INDEX idx_pibo_sessions_parent
				ON pibo_sessions(parent_id, updated_at);
CREATE TABLE pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
				owner_scope TEXT,
				parent_id TEXT,
				origin_id TEXT,
				workspace TEXT,
				title TEXT,
				metadata_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(parent_id) REFERENCES pibo_sessions(id),
				FOREIGN KEY(origin_id) REFERENCES pibo_sessions(id)
			);
```

</details>

### `/root/code/pibo/.pibo/web-chat.sqlite`

| Table | Rows | Columns | Column definitions |
|---|---:|---:|---|
| `chat_events` | 0 | 11 | `stream_id` INTEGER PK<br>`room_id` TEXT<br>`pibo_session_id` TEXT<br>`event_id` TEXT NOT NULL<br>`event_type` TEXT NOT NULL<br>`actor_type` TEXT<br>`actor_id` TEXT<br>`client_txn_id` TEXT<br>`created_at` TEXT NOT NULL<br>`retention_class` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL |
| `chat_retention_policies` | 0 | 4 | `id` TEXT PK<br>`delete_live_deltas_after_ms` INTEGER<br>`delete_trace_events_after_ms` INTEGER<br>`delete_chat_messages_after_ms` INTEGER |
| `chat_session_reads` | 0 | 4 | `pibo_session_id` TEXT PK NOT NULL<br>`principal_id` TEXT PK NOT NULL<br>`last_read_stream_id` INTEGER NOT NULL<br>`updated_at` TEXT NOT NULL |
| `pibo_room_members` | 1 | 5 | `room_id` TEXT PK NOT NULL<br>`principal_id` TEXT PK NOT NULL<br>`role` TEXT NOT NULL<br>`joined_at` TEXT NOT NULL<br>`last_read_stream_id` INTEGER |
| `pibo_rooms` | 1 | 10 | `id` TEXT PK<br>`owner_scope` TEXT NOT NULL<br>`name` TEXT NOT NULL<br>`topic` TEXT<br>`type` TEXT NOT NULL<br>`parent_room_id` TEXT<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`retention_policy_id` TEXT<br>`metadata_json` TEXT |
| `web_chat_events` | 0 | 8 | `id` TEXT PK<br>`pibo_session_id` TEXT NOT NULL<br>`event_sequence` INTEGER<br>`event_id` TEXT<br>`type` TEXT NOT NULL<br>`created_at` TEXT NOT NULL<br>`payload_json` TEXT NOT NULL<br>`stream_id` INTEGER |
| `web_chat_sessions` | 1 | 10 | `pibo_session_id` TEXT PK<br>`pi_session_id` TEXT NOT NULL<br>`parent_id` TEXT<br>`profile` TEXT NOT NULL<br>`channel` TEXT NOT NULL<br>`kind` TEXT NOT NULL<br>`created_at` TEXT NOT NULL<br>`updated_at` TEXT NOT NULL<br>`last_activity_at` TEXT<br>`status` TEXT NOT NULL DEFAULT 'idle' |

<details><summary>CREATE statements / indexes / triggers</summary>

```sql
CREATE UNIQUE INDEX idx_chat_events_client_txn
				ON chat_events(room_id, actor_id, client_txn_id)
				WHERE client_txn_id IS NOT NULL;
CREATE INDEX idx_chat_events_event_id
				ON chat_events(event_id);
CREATE INDEX idx_chat_events_room_stream
				ON chat_events(room_id, stream_id);
CREATE INDEX idx_chat_events_session_stream
				ON chat_events(pibo_session_id, stream_id);
CREATE INDEX idx_pibo_room_members_principal
				ON pibo_room_members(principal_id, room_id);
CREATE INDEX idx_pibo_rooms_owner
				ON pibo_rooms(owner_scope, updated_at);
CREATE INDEX idx_pibo_rooms_parent
				ON pibo_rooms(parent_room_id, updated_at);
CREATE INDEX idx_web_chat_events_event_id
				ON web_chat_events(event_id);
CREATE INDEX idx_web_chat_events_session_created
				ON web_chat_events(pibo_session_id, created_at, id);
CREATE INDEX idx_web_chat_events_session_sequence
				ON web_chat_events(pibo_session_id, event_sequence, id);
CREATE INDEX idx_web_chat_sessions_parent
				ON web_chat_sessions(parent_id);
CREATE TABLE chat_events (
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
CREATE TABLE chat_retention_policies (
				id TEXT PRIMARY KEY,
				delete_live_deltas_after_ms INTEGER,
				delete_trace_events_after_ms INTEGER,
				delete_chat_messages_after_ms INTEGER
			);
CREATE TABLE chat_session_reads (
				pibo_session_id TEXT NOT NULL,
				principal_id TEXT NOT NULL,
				last_read_stream_id INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(pibo_session_id, principal_id)
			);
CREATE TABLE pibo_room_members (
				room_id TEXT NOT NULL,
				principal_id TEXT NOT NULL,
				role TEXT NOT NULL,
				joined_at TEXT NOT NULL,
				last_read_stream_id INTEGER,
				PRIMARY KEY(room_id, principal_id),
				FOREIGN KEY(room_id) REFERENCES pibo_rooms(id)
			);
CREATE TABLE pibo_rooms (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				topic TEXT,
				type TEXT NOT NULL,
				parent_room_id TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				retention_policy_id TEXT,
				metadata_json TEXT,
				FOREIGN KEY(parent_room_id) REFERENCES pibo_rooms(id)
			);
CREATE TABLE web_chat_events (
				id TEXT PRIMARY KEY,
				pibo_session_id TEXT NOT NULL,
				event_sequence INTEGER,
				event_id TEXT,
				type TEXT NOT NULL,
				created_at TEXT NOT NULL,
				payload_json TEXT NOT NULL
			, stream_id INTEGER);
CREATE TABLE web_chat_sessions (
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
```

</details>
