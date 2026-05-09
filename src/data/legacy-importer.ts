import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import { piboHomePath } from "../core/pibo-home.js";
import { PiboDataStore } from "./pibo-store.js";

export type LegacyChatImportOptions = {
	root?: string;
	from?: string;
	to?: string;
	payloadRootDir?: string;
};

export type LegacyChatImportReport = {
	legacyRoot: string;
	v2Path: string;
	inputs: {
		sessions: { path: string; exists: boolean };
		chat: { path: string; exists: boolean };
	};
	imported: {
		rooms: number;
		roomMembers: number;
		sessions: number;
		events: number;
		messages: number;
		observations: number;
		navigation: number;
	};
	skipped: {
		rooms: number;
		roomMembers: number;
		sessions: number;
		events: number;
		messages: number;
		observations: number;
		navigation: number;
	};
};

type LegacySessionRow = {
	id: string;
	pi_session_id: string;
	channel: string;
	kind: string;
	profile: string;
	owner_scope: string | null;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	metadata_json: string | null;
	active_model_json: string | null;
	created_at: string;
	updated_at: string;
};

type LegacyIndexedSessionRow = {
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

type LegacyRoomRow = {
	id: string;
	owner_scope: string;
	name: string;
	topic: string | null;
	type: string;
	parent_room_id: string | null;
	created_at: string;
	updated_at: string;
	retention_policy_id: string | null;
	metadata_json: string | null;
};

type LegacyRoomMemberRow = {
	room_id: string;
	principal_id: string;
	role: string;
	joined_at: string;
};

type LegacyChatEventRow = {
	stream_id: number;
	room_id: string | null;
	pibo_session_id: string | null;
	event_id: string;
	event_type: string;
	actor_type: string | null;
	actor_id: string | null;
	client_txn_id: string | null;
	created_at: string;
	retention_class: string;
	payload_json: string;
};

type LegacyWebChatEventRow = {
	id: string;
	pibo_session_id: string;
	event_sequence: number | null;
	event_id: string | null;
	stream_id: number | null;
	type: string;
	created_at: string;
	payload_json: string;
};

export function importLegacyChatData(options: LegacyChatImportOptions = {}): LegacyChatImportReport {
	const legacyRoot = resolve(options.from ?? options.root ?? process.env.PIBO_HOME ?? piboHomePath());
	const sessionsPath = resolve(legacyRoot, "pibo-sessions.sqlite");
	const chatPath = resolve(legacyRoot, "web-chat.sqlite");
	const v2Path = resolve(options.to ?? resolve(legacyRoot, "pibo.sqlite"));
	const report: LegacyChatImportReport = {
		legacyRoot,
		v2Path,
		inputs: {
			sessions: { path: sessionsPath, exists: existsSync(sessionsPath) },
			chat: { path: chatPath, exists: existsSync(chatPath) },
		},
		imported: zeroCounts(),
		skipped: zeroCounts(),
	};
	const store = new PiboDataStore(v2Path, { payloadRootDir: options.payloadRootDir });
	try {
		store.transaction(() => {
			if (existsSync(chatPath)) importRooms(store.db, chatPath, report);
			if (existsSync(sessionsPath)) importSessions(store.db, sessionsPath, chatPath, report);
			if (existsSync(chatPath)) importChatEvents(store.db, chatPath, report);
			if (existsSync(chatPath)) importWebChatEvents(store.db, chatPath, report);
			rebuildNavigation(store.db, report);
		});
	} finally {
		store.close();
	}
	return report;
}

function zeroCounts(): LegacyChatImportReport["imported"] {
	return { rooms: 0, roomMembers: 0, sessions: 0, events: 0, messages: 0, observations: 0, navigation: 0 };
}

function importRooms(target: DatabaseSync, chatPath: string, report: LegacyChatImportReport): void {
	const source = new DatabaseSync(chatPath, { readOnly: true });
	try {
		if (hasTable(source, "pibo_rooms")) {
			const rows = source.prepare("SELECT * FROM pibo_rooms ORDER BY created_at ASC, id ASC").all() as LegacyRoomRow[];
			for (const row of rows) {
				const changes = runChanges(target, `INSERT OR IGNORE INTO rooms (
					id, owner_scope, name, topic, type, parent_room_id, workspace, archived_at, retention_policy_id, metadata_json, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				row.id,
				row.owner_scope,
				row.name,
				row.topic,
				row.type,
				row.parent_room_id,
				stringValue(parseJson(row.metadata_json)?.workspace),
				stringValue(parseJson(row.metadata_json)?.chatRoomArchivedAt),
				row.retention_policy_id,
				row.metadata_json ?? "{}",
				row.created_at,
				row.updated_at,
				);
				count(report, "rooms", changes);
				mapImport(target, "web-chat.sqlite", "pibo_rooms", row.id, "room", row.id);
			}
		}
		if (hasTable(source, "pibo_room_members")) {
			const rows = source.prepare("SELECT * FROM pibo_room_members ORDER BY joined_at ASC, room_id ASC, principal_id ASC").all() as LegacyRoomMemberRow[];
			for (const row of rows) {
				const changes = runChanges(target, "INSERT OR IGNORE INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)", row.room_id, row.principal_id, row.role, row.joined_at);
				count(report, "roomMembers", changes);
				mapImport(target, "web-chat.sqlite", "pibo_room_members", `${row.room_id}:${row.principal_id}`, "room_member", `${row.room_id}:${row.principal_id}`);
			}
		}
	} finally {
		source.close();
	}
}

function importSessions(target: DatabaseSync, sessionsPath: string, chatPath: string, report: LegacyChatImportReport): void {
	const indexed = loadIndexedSessions(chatPath);
	const source = new DatabaseSync(sessionsPath, { readOnly: true });
	try {
		if (!hasTable(source, "pibo_sessions")) return;
		const rows = source.prepare("SELECT * FROM pibo_sessions ORDER BY created_at ASC, id ASC").all() as LegacySessionRow[];
		for (const row of rows) {
			const metadata = parseJson(row.metadata_json) ?? {};
			const indexedRow = indexed.get(row.id);
			const now = indexedRow?.last_activity_at ?? row.updated_at;
			const roomId = stringValue(metadata.chatRoomId);
			const rootId = rootSessionId(row, rows);
			const changes = runChanges(target, `INSERT OR IGNORE INTO sessions (
				id, pi_session_id, owner_scope, room_id, root_session_id, parent_id, origin_id, channel, kind, profile,
				active_model_json, workspace, title, first_message_preview, status, archived_at, deleted_at, metadata_json,
				created_at, updated_at, last_activity_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.id,
			row.pi_session_id,
			row.owner_scope ?? "user:unknown",
			roomId ?? null,
			rootId,
			row.parent_id,
			row.origin_id,
			row.channel,
			row.kind,
			row.profile,
			row.active_model_json,
			row.workspace,
			row.title ?? "Untitled Session",
			null,
			indexedRow?.status ?? "idle",
			stringValue(metadata.chatArchivedAt),
			null,
			row.metadata_json ?? "{}",
			row.created_at,
			row.updated_at,
			now,
			);
			count(report, "sessions", changes);
			mapImport(target, "pibo-sessions.sqlite", "pibo_sessions", row.id, "session", row.id);
		}
	} finally {
		source.close();
	}
}

function loadIndexedSessions(chatPath: string): Map<string, LegacyIndexedSessionRow> {
	const result = new Map<string, LegacyIndexedSessionRow>();
	if (!existsSync(chatPath)) return result;
	const db = new DatabaseSync(chatPath, { readOnly: true });
	try {
		if (!hasTable(db, "web_chat_sessions")) return result;
		const rows = db.prepare("SELECT * FROM web_chat_sessions").all() as LegacyIndexedSessionRow[];
		for (const row of rows) result.set(row.pibo_session_id, row);
	} finally {
		db.close();
	}
	return result;
}

function importChatEvents(target: DatabaseSync, chatPath: string, report: LegacyChatImportReport): void {
	const source = new DatabaseSync(chatPath, { readOnly: true });
	try {
		if (!hasTable(source, "chat_events")) return;
		const rows = source.prepare("SELECT * FROM chat_events ORDER BY stream_id ASC").all() as LegacyChatEventRow[];
		for (const row of rows) {
			const payload = parseJson(row.payload_json);
			const idempotencyKey = row.client_txn_id ? `legacy:chat_events:client_txn:${row.room_id ?? ""}:${row.actor_id ?? ""}:${row.client_txn_id}` : `legacy:chat_events:${row.stream_id}`;
			const changes = runChanges(target, `INSERT OR IGNORE INTO event_log (
				session_id, session_sequence, room_id, topic, type, source, actor_type, actor_id, turn_id, event_id,
				tool_call_id, run_id, workflow_run_id, idempotency_key, retention_class, payload_ref, preview_text, attributes_json, created_at, indexed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.pibo_session_id,
			nextSessionSequence(target, row.pibo_session_id),
			row.room_id,
			"legacy.chat_events",
			row.event_type,
			row.actor_type ?? "legacy",
			row.actor_type,
			row.actor_id,
			turnIdForPayload(payload),
			row.event_id,
			toolCallIdForPayload(payload),
			runIdForPayload(payload),
			null,
			idempotencyKey,
			row.retention_class,
			null,
			previewForPayload(payload),
			JSON.stringify(compactJsonObject({ legacyStreamId: row.stream_id, clientTxnId: row.client_txn_id, inlinePayload: payload })),
			row.created_at,
			row.created_at,
			);
			count(report, "events", changes);
			mapImport(target, "web-chat.sqlite", "chat_events", String(row.stream_id), "event_log", String(row.stream_id));
			if (row.event_type === "user.message.accepted") importUserMessage(target, row, payload, report);
		}
	} finally {
		source.close();
	}
}

function importWebChatEvents(target: DatabaseSync, chatPath: string, report: LegacyChatImportReport): void {
	const source = new DatabaseSync(chatPath, { readOnly: true });
	try {
		if (!hasTable(source, "web_chat_events")) return;
		const rows = source.prepare("SELECT * FROM web_chat_events ORDER BY pibo_session_id ASC, event_sequence ASC, rowid ASC").all() as LegacyWebChatEventRow[];
		for (const row of rows) {
			const event = parseJson(row.payload_json) as PiboOutputEvent | undefined;
			const idempotencyKey = `legacy:web_chat_events:${row.id}`;
			const changes = runChanges(target, `INSERT OR IGNORE INTO event_log (
				session_id, session_sequence, room_id, topic, type, source, actor_type, actor_id, turn_id, event_id,
				tool_call_id, run_id, workflow_run_id, idempotency_key, retention_class, payload_ref, preview_text, attributes_json, created_at, indexed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.pibo_session_id,
			row.event_sequence ?? nextSessionSequence(target, row.pibo_session_id),
			null,
			"legacy.web_chat_events",
			row.type,
			"legacy",
			actorTypeForEvent(event),
			null,
			turnIdForPayload(event),
			row.event_id,
			toolCallIdForPayload(event),
			runIdForPayload(event),
			null,
			idempotencyKey,
			retentionClassForEventType(row.type),
			null,
			previewForPayload(event),
			JSON.stringify(compactJsonObject({ legacyId: row.id, legacyStreamId: row.stream_id, inlinePayload: event })),
			row.created_at,
			row.created_at,
			);
			count(report, "events", changes);
			mapImport(target, "web-chat.sqlite", "web_chat_events", row.id, "event_log", row.id);
			if (event?.type === "assistant_message") importAssistantMessage(target, row, event, report);
			if (event && !isLiveOnlyEventType(event.type)) importObservation(target, row, event, report);
		}
	} finally {
		source.close();
	}
}

function importUserMessage(target: DatabaseSync, row: LegacyChatEventRow, payload: unknown, report: LegacyChatImportReport): void {
	if (!row.pibo_session_id) return;
	const text = typeof payload === "object" && payload && "text" in payload && typeof payload.text === "string" ? payload.text : "";
	const id = deterministicId("msg", `legacy:chat_events:${row.stream_id}:user`);
	const changes = runChanges(target, `INSERT OR IGNORE INTO chat_messages (
		id, session_id, room_id, sequence, turn_id, role, actor_id, status, created_at, completed_at, content_preview,
		content_payload_ref, source_stream_id, input_tokens, output_tokens, cost_usd, attributes_json
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	id,
	row.pibo_session_id,
	row.room_id,
	nextMessageSequence(target, row.pibo_session_id),
	null,
	"user",
	row.actor_id,
	"complete",
	row.created_at,
	row.created_at,
	previewText(text),
	null,
	row.stream_id,
	null,
	null,
	null,
	JSON.stringify(compactJsonObject({ legacyStreamId: row.stream_id, clientTxnId: row.client_txn_id, inlineText: text })),
	);
	count(report, "messages", changes);
}

function importAssistantMessage(target: DatabaseSync, row: LegacyWebChatEventRow, event: PiboOutputEvent, report: LegacyChatImportReport): void {
	if (event.type !== "assistant_message") return;
	const id = deterministicId("msg", `legacy:web_chat_events:${row.id}:assistant`);
	const changes = runChanges(target, `INSERT OR IGNORE INTO chat_messages (
		id, session_id, room_id, sequence, turn_id, role, actor_id, status, created_at, completed_at, content_preview,
		content_payload_ref, source_stream_id, input_tokens, output_tokens, cost_usd, attributes_json
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	id,
	row.pibo_session_id,
	null,
	nextMessageSequence(target, row.pibo_session_id),
	turnIdForPayload(event),
	"assistant",
	null,
	"complete",
	row.created_at,
	row.created_at,
	previewText(event.text),
	null,
	row.stream_id,
	null,
	null,
	null,
	JSON.stringify(compactJsonObject({ legacyId: row.id, eventId: event.eventId, assistantIndex: event.assistantIndex, contentIndex: event.contentIndex, inlineText: event.text })),
	);
	count(report, "messages", changes);
}

function importObservation(target: DatabaseSync, row: LegacyWebChatEventRow, event: PiboOutputEvent, report: LegacyChatImportReport): void {
	const id = deterministicId("obs", `legacy:web_chat_events:${row.id}:observation`);
	const changes = runChanges(target, `INSERT OR IGNORE INTO observations (
		id, session_id, sequence, trace_id, span_id, parent_span_id, parent_observation_id, turn_id, event_stream_id,
		kind, role, name, status, started_at, ended_at, latency_ms, model_provider, model_id, input_tokens, output_tokens,
		cost_usd, preview_text, payload_ref, attributes_json
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	id,
	row.pibo_session_id,
	row.event_sequence ?? nextObservationSequence(target, row.pibo_session_id),
	null,
	eventIdForEvent(event),
	null,
	null,
	turnIdForPayload(event),
	row.stream_id,
	observationKindForEvent(event),
	actorTypeForEvent(event),
	observationNameForEvent(event),
	observationStatusForEvent(event),
	row.created_at,
	isTerminalEventType(event.type) ? row.created_at : null,
	null,
	null,
	null,
	null,
	null,
	null,
	previewForPayload(event),
	null,
	JSON.stringify(compactJsonObject({ legacyId: row.id, eventType: event.type, eventId: eventIdForEvent(event), inlinePayload: event })),
	);
	count(report, "observations", changes);
}

function rebuildNavigation(target: DatabaseSync, report: LegacyChatImportReport): void {
	const rows = target.prepare(`
		SELECT s.*, COALESCE(m.content_preview, s.first_message_preview) AS last_message_preview
		FROM sessions s
		LEFT JOIN chat_messages m ON m.id = (
			SELECT id FROM chat_messages WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1
		)
		ORDER BY s.last_activity_at ASC, s.id ASC
	`).all() as Array<Record<string, unknown>>;
	for (const row of rows) {
		const sessionId = String(row.id);
		const changes = runChanges(target, `INSERT INTO session_navigation (
			owner_scope, room_id, session_id, root_session_id, parent_id, origin_id, title, profile, status, archived_at,
			last_activity_at, last_message_preview, child_count, sort_key, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			owner_scope = excluded.owner_scope,
			room_id = excluded.room_id,
			root_session_id = excluded.root_session_id,
			parent_id = excluded.parent_id,
			origin_id = excluded.origin_id,
			title = excluded.title,
			profile = excluded.profile,
			status = excluded.status,
			archived_at = excluded.archived_at,
			last_activity_at = excluded.last_activity_at,
			last_message_preview = excluded.last_message_preview,
			child_count = excluded.child_count,
			sort_key = excluded.sort_key,
			updated_at = excluded.updated_at`,
		row.owner_scope,
		row.room_id,
		sessionId,
		row.root_session_id,
		row.parent_id,
		row.origin_id,
		row.title,
		row.profile,
		row.status,
		row.archived_at,
		row.last_activity_at,
		row.last_message_preview,
		countChildren(target, sessionId),
		`${row.last_activity_at ?? ""}:${sessionId}`,
		new Date().toISOString(),
		);
		count(report, "navigation", changes);
	}
}

function rootSessionId(session: LegacySessionRow, sessions: LegacySessionRow[]): string {
	let current = session;
	const byId = new Map(sessions.map((row) => [row.id, row]));
	while (current.parent_id) {
		const parent = byId.get(current.parent_id);
		if (!parent) return current.parent_id;
		current = parent;
	}
	return current.id;
}

function nextSessionSequence(db: DatabaseSync, sessionId?: string | null): number | null {
	if (!sessionId) return null;
	const row = db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number };
	return row.next_sequence;
}

function nextMessageSequence(db: DatabaseSync, sessionId: string): number {
	const row = db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM chat_messages WHERE session_id = ?").get(sessionId) as { next_sequence: number };
	return row.next_sequence;
}

function nextObservationSequence(db: DatabaseSync, sessionId: string): number {
	const row = db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM observations WHERE session_id = ?").get(sessionId) as { next_sequence: number };
	return row.next_sequence;
}

function countChildren(db: DatabaseSync, sessionId: string): number {
	const row = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE parent_id = ?").get(sessionId) as { count: number };
	return Number(row.count ?? 0);
}

function mapImport(db: DatabaseSync, sourceStore: string, sourceTable: string, sourceKey: string, targetKind: string, targetId: string): void {
	db.prepare("INSERT OR IGNORE INTO migration_import_map (source_store, source_table, source_key, target_kind, target_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)").run(sourceStore, sourceTable, sourceKey, targetKind, targetId, new Date().toISOString());
}

function count(report: LegacyChatImportReport, key: keyof LegacyChatImportReport["imported"], changes: number): void {
	if (changes > 0) report.imported[key] += 1;
	else report.skipped[key] += 1;
}

function runChanges(db: DatabaseSync, sql: string, ...values: unknown[]): number {
	return Number(db.prepare(sql).run(...(values.map((value) => value === undefined ? null : value) as any[])).changes ?? 0);
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function parseJson(value: string | null | undefined): PiboJsonObject | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : undefined;
	} catch {
		return undefined;
	}
}

function compactJsonObject(input: Record<string, unknown>): PiboJsonObject {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null) continue;
		output[key] = value;
	}
	return output as PiboJsonObject;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function deterministicId(prefix: string, input: string): string {
	return `${prefix}_${createHash("sha256").update(input).digest("hex").slice(0, 24)}`;
}

function previewText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 512) : undefined;
}

function previewForPayload(payload: unknown): string | undefined {
	if (!payload) return undefined;
	if (typeof payload === "object" && payload && "text" in payload && typeof payload.text === "string") return previewText(payload.text);
	if (typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string") return previewText(payload.error);
	return previewText(JSON.stringify(payload));
}

function turnIdForPayload(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	if ("eventId" in payload && typeof payload.eventId === "string") return payload.eventId;
	return undefined;
}

function toolCallIdForPayload(payload: unknown): string | undefined {
	return payload && typeof payload === "object" && "toolCallId" in payload && typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
}

function runIdForPayload(payload: unknown): string | undefined {
	return payload && typeof payload === "object" && "runId" in payload && typeof payload.runId === "string" ? payload.runId : undefined;
}

function eventIdForEvent(event: PiboOutputEvent): string | undefined {
	return "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
}

function actorTypeForEvent(event: PiboOutputEvent | undefined): string | undefined {
	if (!event) return undefined;
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type.startsWith("thinking_")) return "assistant";
	if (event.type.startsWith("tool_")) return "tool";
	if (event.type === "session_error") return "system";
	return "agent";
}

function retentionClassForEventType(type: string): string {
	if (type === "assistant_delta" || type === "thinking_delta" || type === "tool_execution_updated") return "live_delta";
	if (type === "assistant_message" || type === "message_queued" || type === "message_started" || type === "message_finished") return "chat_message";
	return "trace_event";
}

function observationKindForEvent(event: PiboOutputEvent): string {
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type.startsWith("thinking_")) return "message";
	if (event.type.startsWith("tool_")) return "tool";
	if (event.type === "subagent_session") return "agent";
	if (event.type === "session_error") return "error";
	return "event";
}

function observationNameForEvent(event: PiboOutputEvent): string | undefined {
	if ("toolName" in event && typeof event.toolName === "string") return event.toolName;
	return event.type;
}

function observationStatusForEvent(event: PiboOutputEvent): string {
	if (event.type === "session_error") return "error";
	if (event.type === "tool_execution_finished") return event.isError ? "error" : "completed";
	if (isTerminalEventType(event.type)) return "completed";
	return "running";
}

function isLiveOnlyEventType(type: string): boolean {
	return type === "assistant_delta" || type === "thinking_delta" || type === "tool_execution_updated";
}

function isTerminalEventType(type: string): boolean {
	return type === "assistant_message" || type === "message_finished" || type === "thinking_finished" || type === "tool_execution_finished" || type === "compaction_end" || type === "session_error";
}
