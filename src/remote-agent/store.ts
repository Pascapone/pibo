import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import {
	isRemoteAgentModuleName,
	REMOTE_AGENT_HISTORY_DEFAULT_LIMIT,
	REMOTE_AGENT_HISTORY_RETAIN_PER_ROOM,
	REMOTE_AGENT_MODULES,
	type NewRemoteToolCallRecord,
	type RemoteAgentMode,
	type RemoteAgentModuleName,
	type RemoteAgentRuntime,
	type RemoteDeviceCode,
	type RemoteRoomConfig,
	type RemoteRoomConfigPatch,
	type RemoteRoomModuleSelection,
	type RemoteTokenInfo,
	type RemoteToolCallRecord,
	type RemoteToolCallTransport,
} from "./types.js";

export type PiboRemoteAgentStoreOptions = {
	path?: string;
};

type RoomConfigRow = {
	room_id: string;
	enabled: number;
	mode: string;
	runtime: string;
	sandbox_path: string;
	modules_json: string;
	default_profile: string;
	allowed_profiles_json: string;
	allow_internet: number;
	updated_at: string;
};

type DeviceCodeRow = {
	code: string;
	room_id: string;
	label: string | null;
	expires_at: string;
	used: number;
	used_at: string | null;
	created_at: string;
};

type TokenRow = {
	id: string;
	token_hash: string;
	label: string;
	room_id: string;
	modules_json: string;
	created_at: string;
	expires_at: string;
	revoked_at: string | null;
};

type ToolCallRow = {
	id: number;
	tool_call_id: string;
	room_id: string;
	token_id: string;
	label: string;
	transport: string;
	tool_name: string;
	args_json: string;
	ok: number;
	result_text: string | null;
	result_json: string | null;
	error: string | null;
	started_at: string;
	finished_at: string;
	duration_ms: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS remote_room_config (
	room_id TEXT PRIMARY KEY,
	enabled INTEGER NOT NULL DEFAULT 0,
	mode TEXT NOT NULL DEFAULT 'sandbox',
	runtime TEXT NOT NULL DEFAULT 'muse',
	sandbox_path TEXT NOT NULL DEFAULT '',
	modules_json TEXT NOT NULL DEFAULT '{}',
	default_profile TEXT NOT NULL DEFAULT '',
	allowed_profiles_json TEXT NOT NULL DEFAULT '[]',
	allow_internet INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS remote_device_codes (
	code TEXT PRIMARY KEY,
	room_id TEXT NOT NULL,
	label TEXT,
	expires_at TEXT NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	used_at TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_device_codes_room ON remote_device_codes(room_id);
CREATE TABLE IF NOT EXISTS remote_tokens (
	id TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL UNIQUE,
	label TEXT NOT NULL,
	room_id TEXT NOT NULL,
	modules_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_tokens_room ON remote_tokens(room_id);
CREATE TABLE IF NOT EXISTS remote_tool_calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	tool_call_id TEXT NOT NULL DEFAULT '',
	room_id TEXT NOT NULL,
	token_id TEXT NOT NULL,
	label TEXT NOT NULL DEFAULT '',
	transport TEXT NOT NULL DEFAULT 'mcp',
	tool_name TEXT NOT NULL,
	args_json TEXT NOT NULL DEFAULT '{}',
	ok INTEGER NOT NULL DEFAULT 1,
	result_text TEXT,
	result_json TEXT,
	error TEXT,
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_remote_tool_calls_room ON remote_tool_calls(room_id, id DESC);
`;

export const DEFAULT_REMOTE_MODULES: RemoteRoomModuleSelection = {
	sessions: true,
	observe: true,
	files: true,
	bash: false,
};

function normalizeMode(value: string): RemoteAgentMode {
	return value === "yolo" ? "yolo" : "sandbox";
}

function normalizeRuntime(value: string): RemoteAgentRuntime {
	return value === "pi" ? "pi" : "muse";
}

function normalizeModules(value: unknown): RemoteRoomModuleSelection {
	const parsed = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	const selection = { ...DEFAULT_REMOTE_MODULES };
	for (const module of REMOTE_AGENT_MODULES) {
		if (typeof parsed[module] === "boolean") selection[module] = parsed[module];
	}
	return selection;
}

function normalizeAllowedProfiles(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const trimmed = entry.trim();
		if (trimmed && !names.includes(trimmed)) names.push(trimmed);
	}
	return names;
}

function configFromRow(row: RoomConfigRow): RemoteRoomConfig {
	let modules: unknown = {};
	try {
		modules = JSON.parse(row.modules_json) as unknown;
	} catch {}
	let allowed: unknown = [];
	try {
		allowed = JSON.parse(row.allowed_profiles_json) as unknown;
	} catch {}
	return {
		roomId: row.room_id,
		enabled: row.enabled === 1,
		mode: normalizeMode(row.mode),
		runtime: normalizeRuntime(row.runtime),
		sandboxPath: row.sandbox_path,
		modules: normalizeModules(modules),
		defaultProfile: typeof row.default_profile === "string" ? row.default_profile.trim() : "",
		allowedProfiles: normalizeAllowedProfiles(allowed),
		allowInternet: row.allow_internet === 1,
		updatedAt: row.updated_at,
	};
}

function codeFromRow(row: DeviceCodeRow): RemoteDeviceCode {
	return {
		code: row.code,
		roomId: row.room_id,
		...(row.label ? { label: row.label } : {}),
		expiresAt: row.expires_at,
		used: row.used === 1,
		...(row.used_at ? { usedAt: row.used_at } : {}),
		createdAt: row.created_at,
	};
}

function tokenInfoFromRow(row: TokenRow): RemoteTokenInfo {
	let modules: unknown = [];
	try {
		modules = JSON.parse(row.modules_json) as unknown;
	} catch {}
	return {
		id: row.id,
		label: row.label,
		roomId: row.room_id,
		modules: (Array.isArray(modules) ? modules : []).filter(isRemoteAgentModuleName),
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		revoked: row.revoked_at !== null,
		...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
	};
}

export type StoredRemoteToken = RemoteTokenInfo & { tokenHash: string };

function toolCallFromRow(row: ToolCallRow): RemoteToolCallRecord {
	const transport: RemoteToolCallTransport = row.transport === "rest" ? "rest" : "mcp";
	return {
		id: row.id,
		toolCallId: row.tool_call_id,
		roomId: row.room_id,
		tokenId: row.token_id,
		label: row.label,
		transport,
		toolName: row.tool_name,
		argsJson: row.args_json,
		ok: row.ok === 1,
		...(row.result_text !== null ? { resultText: row.result_text } : {}),
		...(row.result_json !== null ? { resultJson: row.result_json } : {}),
		...(row.error !== null ? { error: row.error } : {}),
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		durationMs: row.duration_ms,
	};
}

export class PiboRemoteAgentStore {
	private readonly db: DatabaseSync;

	constructor(options: PiboRemoteAgentStoreOptions = {}) {
		const dbPath = options.path ?? piboHomePath("pibo-remote-agent.sqlite");
		const resolved = dbPath === ":memory:" ? dbPath : resolve(dbPath);
		if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
		this.db = new DatabaseSync(resolved);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (resolved !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(SCHEMA);
		this.migrateRoomConfigColumns();
	}

	/** Add agent/internet columns to room configs created before those features. */
	private migrateRoomConfigColumns(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(remote_room_config)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("default_profile")) {
			this.db.exec("ALTER TABLE remote_room_config ADD COLUMN default_profile TEXT NOT NULL DEFAULT ''");
		}
		if (!columns.has("allowed_profiles_json")) {
			this.db.exec("ALTER TABLE remote_room_config ADD COLUMN allowed_profiles_json TEXT NOT NULL DEFAULT '[]'");
		}
		if (!columns.has("allow_internet")) {
			this.db.exec("ALTER TABLE remote_room_config ADD COLUMN allow_internet INTEGER NOT NULL DEFAULT 0");
		}
	}

	close(): void {
		this.db.close();
	}

	getRoomConfig(roomId: string): RemoteRoomConfig | undefined {
		const row = this.db.prepare("SELECT * FROM remote_room_config WHERE room_id = ?").get(roomId) as RoomConfigRow | undefined;
		return row ? configFromRow(row) : undefined;
	}

	listRoomConfigs(): RemoteRoomConfig[] {
		return (this.db.prepare("SELECT * FROM remote_room_config ORDER BY room_id ASC").all() as RoomConfigRow[]).map(configFromRow);
	}

	listEnabledRoomIds(): string[] {
		return (this.db.prepare("SELECT room_id FROM remote_room_config WHERE enabled = 1 ORDER BY room_id ASC").all() as Array<{ room_id: string }>).map((row) => row.room_id);
	}

	upsertRoomConfig(roomId: string, patch: RemoteRoomConfigPatch, input: { sandboxPath: string; now?: string }): RemoteRoomConfig {
		const existing = this.getRoomConfig(roomId);
		const now = input.now ?? new Date().toISOString();
		const next: RemoteRoomConfig = {
			roomId,
			enabled: patch.enabled ?? existing?.enabled ?? false,
			mode: patch.mode ?? existing?.mode ?? "sandbox",
			runtime: patch.runtime ?? existing?.runtime ?? "muse",
			sandboxPath: patch.sandboxPath ?? existing?.sandboxPath ?? input.sandboxPath,
			modules: { ...(existing?.modules ?? DEFAULT_REMOTE_MODULES), ...(patch.modules ?? {}) },
			defaultProfile: patch.defaultProfile ?? existing?.defaultProfile ?? "",
			allowedProfiles: patch.allowedProfiles ?? existing?.allowedProfiles ?? [],
			allowInternet: patch.allowInternet ?? existing?.allowInternet ?? false,
			updatedAt: now,
		};
		this.db.prepare(
			`INSERT INTO remote_room_config (room_id, enabled, mode, runtime, sandbox_path, modules_json, default_profile, allowed_profiles_json, allow_internet, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(room_id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, runtime = excluded.runtime,
			 sandbox_path = excluded.sandbox_path, modules_json = excluded.modules_json, default_profile = excluded.default_profile,
			 allowed_profiles_json = excluded.allowed_profiles_json, allow_internet = excluded.allow_internet, updated_at = excluded.updated_at`,
		).run(next.roomId, next.enabled ? 1 : 0, next.mode, next.runtime, next.sandboxPath, JSON.stringify(next.modules), next.defaultProfile, JSON.stringify(next.allowedProfiles), next.allowInternet ? 1 : 0, next.updatedAt);
		return next;
	}

	insertDeviceCode(code: RemoteDeviceCode): void {
		this.db.prepare(
			"INSERT INTO remote_device_codes (code, room_id, label, expires_at, used, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		).run(code.code, code.roomId, code.label ?? null, code.expiresAt, code.used ? 1 : 0, code.usedAt ?? null, code.createdAt);
	}

	getDeviceCode(code: string): RemoteDeviceCode | undefined {
		const row = this.db.prepare("SELECT * FROM remote_device_codes WHERE code = ?").get(code) as DeviceCodeRow | undefined;
		return row ? codeFromRow(row) : undefined;
	}

	markDeviceCodeUsed(code: string, usedAt: string): boolean {
		const result = this.db.prepare("UPDATE remote_device_codes SET used = 1, used_at = ? WHERE code = ? AND used = 0").run(usedAt, code);
		return result.changes === 1;
	}

	pruneDeviceCodes(now: string): number {
		const result = this.db.prepare("DELETE FROM remote_device_codes WHERE expires_at <= ? OR used = 1").run(now);
		return Number(result.changes);
	}

	insertToken(input: { id: string; tokenHash: string; label: string; roomId: string; modules: RemoteAgentModuleName[]; createdAt: string; expiresAt: string }): RemoteTokenInfo {
		this.db.prepare(
			"INSERT INTO remote_tokens (id, token_hash, label, room_id, modules_json, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
		).run(input.id, input.tokenHash, input.label, input.roomId, JSON.stringify(input.modules), input.createdAt, input.expiresAt);
		return {
			id: input.id,
			label: input.label,
			roomId: input.roomId,
			modules: [...input.modules],
			createdAt: input.createdAt,
			expiresAt: input.expiresAt,
			revoked: false,
		};
	}

	listTokens(roomId?: string): RemoteTokenInfo[] {
		const rows = (roomId
			? this.db.prepare("SELECT * FROM remote_tokens WHERE room_id = ? ORDER BY created_at DESC, id ASC").all(roomId)
			: this.db.prepare("SELECT * FROM remote_tokens ORDER BY created_at DESC, id ASC").all()) as TokenRow[];
		return rows.map(tokenInfoFromRow);
	}

	getToken(id: string): RemoteTokenInfo | undefined {
		const row = this.db.prepare("SELECT * FROM remote_tokens WHERE id = ?").get(id) as TokenRow | undefined;
		return row ? tokenInfoFromRow(row) : undefined;
	}

	revokeToken(id: string, revokedAt: string): boolean {
		const result = this.db.prepare("UPDATE remote_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(revokedAt, id);
		return result.changes === 1;
	}

	revokeRoomTokens(roomId: string, revokedAt: string): number {
		const result = this.db.prepare("UPDATE remote_tokens SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL").run(revokedAt, roomId);
		return Number(result.changes);
	}

	findTokenByHash(tokenHash: string): StoredRemoteToken | undefined {
		const row = this.db.prepare("SELECT * FROM remote_tokens WHERE token_hash = ?").get(tokenHash) as TokenRow | undefined;
		return row ? { ...tokenInfoFromRow(row), tokenHash: row.token_hash } : undefined;
	}

	pruneTokens(now: string): number {
		const result = this.db.prepare("DELETE FROM remote_tokens WHERE expires_at <= ?").run(now);
		return Number(result.changes);
	}

	insertToolCall(input: NewRemoteToolCallRecord, retainPerRoom = REMOTE_AGENT_HISTORY_RETAIN_PER_ROOM): RemoteToolCallRecord {
		const result = this.db.prepare(
			`INSERT INTO remote_tool_calls (tool_call_id, room_id, token_id, label, transport, tool_name, args_json, ok,
			 result_text, result_json, error, started_at, finished_at, duration_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			input.toolCallId, input.roomId, input.tokenId, input.label, input.transport, input.toolName,
			input.argsJson, input.ok ? 1 : 0, input.resultText ?? null, input.resultJson ?? null,
			input.error ?? null, input.startedAt, input.finishedAt, input.durationMs,
		);
		const id = Number(result.lastInsertRowid);
		this.db.prepare(
			`DELETE FROM remote_tool_calls WHERE room_id = ? AND id NOT IN
			 (SELECT id FROM remote_tool_calls WHERE room_id = ? ORDER BY id DESC LIMIT ?)`,
		).run(input.roomId, input.roomId, Math.max(retainPerRoom, 1));
		return { ...input, id };
	}

	listToolCalls(roomId: string, limit = REMOTE_AGENT_HISTORY_DEFAULT_LIMIT): RemoteToolCallRecord[] {
		const rows = this.db.prepare(
			"SELECT * FROM remote_tool_calls WHERE room_id = ? ORDER BY id DESC LIMIT ?",
		).all(roomId, Math.max(Math.floor(limit) || 0, 1)) as ToolCallRow[];
		return rows.map(toolCallFromRow);
	}
}

export function createDefaultPiboRemoteAgentStore(options: PiboRemoteAgentStoreOptions = {}): PiboRemoteAgentStore {
	return new PiboRemoteAgentStore(options);
}
