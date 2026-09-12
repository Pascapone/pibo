/** Additive product tables. Deliberately no installation-owned cascading foreign keys. */
export const PLUGIN_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin_installations (
 plugin_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), state TEXT NOT NULL,
 record_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_artifacts (
 plugin_id TEXT NOT NULL, content_hash TEXT NOT NULL, record_json TEXT NOT NULL,
 PRIMARY KEY(plugin_id, content_hash)
);
CREATE TABLE IF NOT EXISTS plugin_configurations (
 plugin_id TEXT NOT NULL, scope TEXT NOT NULL, target_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), value_json TEXT NOT NULL,
 PRIMARY KEY(plugin_id, scope, target_id)
);
CREATE TABLE IF NOT EXISTS plugin_session_tabsets (
 pibo_session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_generation_snapshots (
 pibo_session_id TEXT NOT NULL, generation_id TEXT NOT NULL, record_json TEXT NOT NULL,
 PRIMARY KEY(pibo_session_id, generation_id)
);
CREATE TABLE IF NOT EXISTS plugin_build_snapshots (
 pibo_session_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, generation_id TEXT NOT NULL,
 kind TEXT NOT NULL, created_at TEXT NOT NULL, record_json TEXT NOT NULL,
 PRIMARY KEY(pibo_session_id, snapshot_id)
);
CREATE TABLE IF NOT EXISTS plugin_snapshot_payload_refs (
 snapshot_kind TEXT NOT NULL, pibo_session_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, payload_id TEXT NOT NULL,
 PRIMARY KEY(snapshot_kind, pibo_session_id, snapshot_id, payload_id),
 FOREIGN KEY(payload_id) REFERENCES payloads(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS plugin_generation_admissions (
 pibo_session_id TEXT NOT NULL, generation_id TEXT NOT NULL, revision INTEGER NOT NULL,
 state TEXT NOT NULL, record_json TEXT NOT NULL,
 PRIMARY KEY(pibo_session_id, generation_id)
);
CREATE TABLE IF NOT EXISTS plugin_operations (
 id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
 state TEXT NOT NULL, record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_migration_journal (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), state TEXT NOT NULL, record_json TEXT NOT NULL
);
`;
