import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { normalizeLimit, openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { formatNextCommands } from "./next-commands.js";

export type ParsedDebugSessionInput = {
	raw: string;
	roomId?: string;
	piboSessionId: string;
};

export type DebugSessionSummary = {
	input: ParsedDebugSessionInput;
	warnings: string[];
	session: Record<string, unknown>;
	metadata: Record<string, unknown>;
	room: {
		urlRoomId?: string;
		sessionRoomId?: string;
		matches?: boolean;
	};
	children: Array<Record<string, unknown>>;
	chat?: Record<string, unknown>;
	events?: Array<Record<string, unknown>>;
	nextCommands?: string[];
};

type SessionRow = {
	id: string;
	pi_session_id: string;
	channel: string;
	kind: string;
	profile: string;
	room_id: string | null;
	root_session_id: string | null;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	status: string;
	metadata_json: string | null;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
};

export function parseDebugSessionInput(input: string): ParsedDebugSessionInput {
	const raw = input.trim();
	if (!raw) throw new Error("Session input is required");
	const pathname = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw).pathname : raw;
	const roomMatch = /^\/apps\/chat\/rooms\/([^/]+)\/sessions\/([^/]+)\/?$/.exec(pathname);
	if (roomMatch) {
		return { raw, roomId: decodeURIComponent(roomMatch[1]), piboSessionId: decodeURIComponent(roomMatch[2]) };
	}
	const sessionMatch = /^\/apps\/chat\/sessions\/([^/]+)\/?$/.exec(pathname);
	if (sessionMatch) {
		return { raw, piboSessionId: decodeURIComponent(sessionMatch[1]) };
	}
	return { raw, piboSessionId: raw };
}

export function inspectDebugSession(
	input: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	options: { limit?: string | number; events?: boolean } = {},
): DebugSessionSummary {
	const parsed = parseDebugSessionInput(input);
	const limit = normalizeLimit(options.limit);
	if (!stores.sessions.exists) {
		throw new Error(`Debug store "sessions" not found at ${stores.sessions.path}`);
	}
	const sessionsDb = openReadOnlyDebugDatabase(stores.sessions);
	try {
		const session = sessionsDb.prepare("SELECT * FROM sessions WHERE id = ?").get(parsed.piboSessionId) as
			| SessionRow
			| undefined;
		if (!session) throw new Error(`Pibo session "${parsed.piboSessionId}" not found`);
		const metadata = parseObject(session.metadata_json);
		const sessionRoomId = session.room_id ?? stringValue(metadata.chatRoomId);
		const warnings = parsed.roomId && sessionRoomId && parsed.roomId !== sessionRoomId
			? [`URL roomId "${parsed.roomId}" does not match session metadata chatRoomId "${sessionRoomId}".`]
			: [];
		const summary: DebugSessionSummary = {
			input: parsed,
			warnings,
			session: compactSessionRow(session),
			metadata,
			room: {
				urlRoomId: parsed.roomId,
				sessionRoomId,
				matches: parsed.roomId && sessionRoomId ? parsed.roomId === sessionRoomId : undefined,
			},
			children: listChildSessions(sessionsDb, parsed.piboSessionId, limit),
		};
		summary.nextCommands = [
			`pibo debug messages ${parsed.piboSessionId} list`,
			`pibo debug final ${parsed.piboSessionId}`,
			`pibo debug trace ${parsed.piboSessionId} --check`,
			`pibo debug failures ${parsed.piboSessionId}`,
			`pibo debug events ${parsed.piboSessionId} --limit 20`,
		];
		if (stores.chat.exists) {
			const chatDb = stores.chat.path === stores.sessions.path ? sessionsDb : openReadOnlyDebugDatabase(stores.chat);
			try {
				summary.chat = readChatSession(chatDb, parsed.piboSessionId);
				if (options.events) summary.events = readEventSummaries(chatDb, parsed.piboSessionId, limit);
			} catch (error) {
				throw withStorePath(error, stores.chat);
			} finally {
				if (chatDb !== sessionsDb) chatDb.close();
			}
		}
		return summary;
	} catch (error) {
		throw withStorePath(error, stores.sessions);
	} finally {
		sessionsDb.close();
	}
}

export function formatDebugSessionSummary(summary: DebugSessionSummary): string {
	const lines: string[] = [];
	lines.push(`piboSessionId: ${summary.input.piboSessionId}`);
	if (summary.input.roomId) lines.push(`urlRoomId: ${summary.input.roomId}`);
	if (summary.room.sessionRoomId) lines.push(`sessionRoomId: ${summary.room.sessionRoomId}`);
	if (summary.room.matches !== undefined) lines.push(`roomMatch: ${String(summary.room.matches)}`);
	for (const warning of summary.warnings) lines.push(`warning: ${warning}`);
	lines.push("");
	lines.push("Session:");
	for (const [key, value] of Object.entries(summary.session)) {
		lines.push(`  ${key}: ${formatValue(value)}`);
	}
	if (Object.keys(summary.metadata).length) {
		lines.push("");
		lines.push("Metadata:");
		for (const [key, value] of Object.entries(summary.metadata)) {
			lines.push(`  ${key}: ${formatValue(value)}`);
		}
	}
	lines.push("");
	lines.push(`Children: ${summary.children.length}`);
	for (const child of summary.children) {
		lines.push(
			`  ${formatValue(child.id)}\t${formatValue(child.profile)}\t${formatValue(child.kind)}\t${formatValue(child.subagentName)}\t${formatValue(child.threadKey)}`,
		);
	}
	if (summary.chat) {
		lines.push("");
		lines.push("Chat Web:");
		for (const [key, value] of Object.entries(summary.chat)) {
			lines.push(`  ${key}: ${formatValue(value)}`);
		}
	}
	if (summary.events) {
		lines.push("");
		lines.push(`Events: ${summary.events.length}`);
		for (const event of summary.events) {
			lines.push(`  ${formatValue(event.created_at)}\t${formatValue(event.type)}\t${formatValue(event.event_id)}`);
		}
	}
	lines.push(...formatNextCommands(summary.nextCommands ?? []));
	return lines.join("\n");
}

function listChildSessions(db: DatabaseSync, piboSessionId: string, limit: number): Array<Record<string, unknown>> {
	const rows = db
		.prepare(
			`
				SELECT id, pi_session_id, channel, kind, profile, room_id, root_session_id, parent_id, origin_id, workspace, title, status, metadata_json, created_at, updated_at, last_activity_at
				FROM sessions
				WHERE parent_id = ?
				ORDER BY created_at
				LIMIT ?
			`,
		)
		.all(piboSessionId, limit) as Array<SessionRow>;
	return rows.map((row) => {
		const metadata = parseObject(row.metadata_json);
		return {
			id: row.id,
			pi_session_id: row.pi_session_id,
			channel: row.channel,
			kind: row.kind,
			profile: row.profile,
			parent_id: row.parent_id,
			subagentName: stringValue(metadata.subagentName),
			subagentToolName: stringValue(metadata.subagentToolName),
			threadKey: stringValue(metadata.threadKey),
			chatRoomId: stringValue(metadata.chatRoomId),
			created_at: row.created_at,
			updated_at: row.updated_at,
		};
	});
}

function readChatSession(db: DatabaseSync, piboSessionId: string): Record<string, unknown> | undefined {
	if (!tableExists(db, "sessions")) return undefined;
	return db.prepare(`
		SELECT
			s.id AS pibo_session_id,
			s.room_id,
			s.root_session_id,
			s.status,
			s.last_activity_at,
			stats.message_count,
			stats.tool_call_count,
			stats.error_count,
			stats.last_event_stream_id,
			nav.child_count,
			nav.sort_key
		FROM sessions s
		LEFT JOIN session_stats stats ON stats.session_id = s.id
		LEFT JOIN session_navigation nav ON nav.session_id = s.id
		WHERE s.id = ?
	`).get(piboSessionId) as Record<string, unknown> | undefined;
}

function readEventSummaries(db: DatabaseSync, piboSessionId: string, limit: number): Array<Record<string, unknown>> {
	if (!tableExists(db, "event_log")) return [];
	return db
		.prepare(
			`
				SELECT type, event_id, created_at, stream_id
				FROM event_log
				WHERE session_id = ?
				ORDER BY stream_id DESC
				LIMIT ?
			`,
		)
		.all(piboSessionId, limit) as Array<Record<string, unknown>>;
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

function compactSessionRow(row: SessionRow): Record<string, unknown> {
	return {
		id: row.id,
		pi_session_id: row.pi_session_id,
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		parent_id: row.parent_id,
		origin_id: row.origin_id,
		workspace: row.workspace,
		title: row.title,
		status: row.status,
		room_id: row.room_id,
		root_session_id: row.root_session_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_activity_at: row.last_activity_at,
	};
}

function parseObject(value: string | null): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
