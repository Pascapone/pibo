/** Explicit lifetime ownership; receipts/events are not resource reference owners. */
export const ATTACHMENT_RESOURCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachment_resource_grants (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	client_txn_id TEXT NOT NULL,
	draft_resource_id TEXT NOT NULL,
	payload_ref TEXT NOT NULL REFERENCES payloads(id),
	name TEXT NOT NULL,
	message_id TEXT,
	created_at TEXT NOT NULL,
	UNIQUE (session_id, client_txn_id, draft_resource_id)
);
CREATE INDEX IF NOT EXISTS attachment_resource_message_idx ON attachment_resource_grants(message_id);
CREATE INDEX IF NOT EXISTS attachment_resource_payload_idx ON attachment_resource_grants(payload_ref);
`;
