import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensurePrivatePiboHomeForPath, piboHomePath } from "../core/pibo-home.js";
import { protectPrivateFileSync } from "../core/private-path.js";
import { loadPreviewConfig } from "./config.js";
import { migratePreviewSessionOwnership } from "./migrations/session-ownership.js";
import type {
	CreatePreviewExposureInput,
	ManagedPreviewServerState,
	PreviewBrowserSession,
	PreviewExposure,
	PreviewExposureState,
	PreviewManagerIdentity,
	PreviewProxyMode,
	PreviewTicket,
} from "./types.js";

type ExposureRow = {
	id: string;
	pibo_session_id: string;
	label: string;
	target_host: "127.0.0.1" | "::1";
	target_port: number;
	target_process_id: number | null;
	target_process_start_ticks: string | null;
	workspace: string;
	management_mode: "external" | "managed";
	proxy_mode: PreviewProxyMode;
	start_command: string | null;
	server_state: ManagedPreviewServerState | "external";
	server_generation: string | null;
	server_started_at: string | null;
	server_stop_at: string | null;
	server_stopped_at: string | null;
	server_error: string | null;
	manager_kind: "systemd" | "process" | null;
	manager_id: string | null;
	manager_pid: number | null;
	manager_process_start_ticks: string | null;
	created_at: string;
	expires_at: string;
	closed_at: string | null;
};

type TicketRow = {
	preview_id: string;
	server_generation: string | null;
	expires_at: string;
	used_at: string | null;
};

type BrowserAuthorizationRow = ExposureRow & {
	browser_preview_id: string;
	browser_server_generation: string | null;
	browser_expires_at: string;
};

export const PREVIEW_SCHEMA_VERSION = 6;
export const MAX_ACTIVE_PREVIEW_EXPOSURES = 256;
export const MAX_ACTIVE_PREVIEW_EXPOSURES_PER_SESSION = 16;
export const MAX_OUTSTANDING_PREVIEW_TICKETS = 32;
export const MAX_PREVIEW_BROWSER_SESSIONS = 64;
export const CLOSED_PREVIEW_RETENTION_DAYS = 30;

export class PreviewCapacityError extends Error {
	constructor(readonly maxRunningServers: number) {
		super(`Managed Preview server limit reached (${maxRunningServers})`);
		this.name = "PreviewCapacityError";
	}
}

export class PreviewExposureCapacityError extends Error {
	constructor(readonly limit: number, readonly scope: "global" | "session") {
		super(`Active Preview exposure limit reached (${limit} per ${scope})`);
		this.name = "PreviewExposureCapacityError";
	}
}

function tokenHash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function opaqueToken(): string {
	return randomBytes(32).toString("base64url");
}

function isOpaqueToken(value: string): boolean {
	return value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value);
}

function requireIsoDate(value: string, field: string): number {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`${field} must be a valid ISO timestamp`);
	return timestamp;
}

function validateExposureInput(input: CreatePreviewExposureInput): void {
	if (input.id.length > 63 || !/^pv-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(input.id)) {
		throw new Error("Preview id is invalid");
	}
	if (!input.piboSessionId.trim() || input.piboSessionId.length > 256) throw new Error("Pibo Session id is invalid");
	if (!input.label.trim() || input.label.length > 120) throw new Error("Preview label must contain 1 to 120 characters");
	if (!input.workspace || input.workspace.length > 4_096) throw new Error("Preview workspace is invalid");
	if (!Number.isInteger(input.targetPort) || input.targetPort < 1024 || input.targetPort > 65535) {
		throw new Error("Preview target port is invalid");
	}
	const createdAt = requireIsoDate(input.createdAt, "createdAt");
	const expiresAt = requireIsoDate(input.expiresAt, "expiresAt");
	if (expiresAt <= createdAt) throw new Error("Preview expiration must be after creation");
	if ((input.managementMode ?? "external") === "managed" && !input.startCommand) {
		throw new Error("Managed Preview definitions require a start command");
	}
	if (input.proxyMode !== undefined && input.proxyMode !== "standard" && input.proxyMode !== "pibo-compute-dev-auth") {
		throw new Error("Preview proxy mode is invalid");
	}
}

function exposureFromRow(row: ExposureRow): PreviewExposure {
	const managementMode = row.management_mode === "managed" ? "managed" : "external";
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		label: row.label,
		targetHost: row.target_host,
		targetPort: row.target_port,
		targetProcessId: row.target_process_id ?? undefined,
		targetProcessStartTicks: row.target_process_start_ticks ?? undefined,
		workspace: row.workspace,
		managementMode,
		proxyMode: row.proxy_mode === "pibo-compute-dev-auth" ? "pibo-compute-dev-auth" : "standard",
		startCommand: row.start_command ?? undefined,
		serverState: managementMode === "managed" && row.server_state !== "external" ? row.server_state : undefined,
		serverGeneration: row.server_generation ?? undefined,
		serverStartedAt: row.server_started_at ?? undefined,
		serverStopAt: row.server_stop_at ?? undefined,
		serverStoppedAt: row.server_stopped_at ?? undefined,
		serverError: row.server_error ?? undefined,
		managerKind: row.manager_kind ?? undefined,
		managerId: row.manager_id ?? undefined,
		managerPid: row.manager_pid ?? undefined,
		managerProcessStartTicks: row.manager_process_start_ticks ?? undefined,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		closedAt: row.closed_at ?? undefined,
	};
}

function authorizationGeneration(exposure: PreviewExposure): string | null | undefined {
	if (exposure.managementMode === "external") return null;
	if (exposure.serverState !== "running" || !exposure.serverGeneration) return undefined;
	return exposure.serverGeneration;
}

function sameAuthorizationExposure(first: PreviewExposure, second: PreviewExposure): boolean {
	return first.id === second.id &&
		first.createdAt === second.createdAt &&
		first.managementMode === second.managementMode &&
		first.proxyMode === second.proxyMode &&
		first.serverGeneration === second.serverGeneration &&
		first.targetHost === second.targetHost &&
		first.targetPort === second.targetPort &&
		first.targetProcessId === second.targetProcessId &&
		first.targetProcessStartTicks === second.targetProcessStartTicks &&
		first.managerKind === second.managerKind &&
		first.managerId === second.managerId &&
		first.managerPid === second.managerPid &&
		first.managerProcessStartTicks === second.managerProcessStartTicks;
}

export function previewExposureState(exposure: PreviewExposure, now = new Date()): PreviewExposureState {
	if (exposure.closedAt) return "closed";
	if (Date.parse(exposure.expiresAt) <= now.getTime()) return "expired";
	return "active";
}

export class PreviewStore {
	readonly path: string;
	private readonly db: DatabaseSync;

	constructor(path = loadPreviewConfig().databasePath ?? piboHomePath("previews.sqlite")) {
		this.path = path === ":memory:" ? path : resolve(path);
		if (this.path !== ":memory:") {
			ensurePrivatePiboHomeForPath(this.path);
			mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		}
		this.db = new DatabaseSync(this.path);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (this.path !== ":memory:") {
			this.db.exec("PRAGMA journal_mode = WAL");
			protectPrivateFileSync(this.path, { force: true });
		}
		try {
			this.applySchema();
		} catch (error) {
			this.db.close();
			throw error;
		}
	}

	private applySchema(): void {
		const currentVersion = Number((this.db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0);
		if (currentVersion > PREVIEW_SCHEMA_VERSION) {
			throw new Error(`Preview database schema version ${currentVersion} is newer than supported version ${PREVIEW_SCHEMA_VERSION}`);
		}
		const existingExposureSql = (this.db.prepare(
			"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'preview_exposures'",
		).get() as { sql?: string } | undefined)?.sql;
		const needsStoppingStateMigration = Boolean(existingExposureSql && !existingExposureSql.includes("'stopping'"));
		if (needsStoppingStateMigration) {
			this.db.exec("PRAGMA foreign_keys = OFF");
			this.db.exec("PRAGMA legacy_alter_table = ON");
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.exec(`
			CREATE TABLE IF NOT EXISTS preview_exposures (
				id TEXT PRIMARY KEY,
				pibo_session_id TEXT NOT NULL,
				label TEXT NOT NULL,
				target_host TEXT NOT NULL CHECK (target_host IN ('127.0.0.1', '::1')),
				target_port INTEGER NOT NULL CHECK (target_port BETWEEN 1024 AND 65535),
				target_process_id INTEGER,
				target_process_start_ticks TEXT,
				workspace TEXT NOT NULL,
				management_mode TEXT NOT NULL DEFAULT 'external' CHECK (management_mode IN ('external', 'managed')),
				proxy_mode TEXT NOT NULL DEFAULT 'standard' CHECK (proxy_mode IN ('standard', 'pibo-compute-dev-auth')),
				start_command TEXT,
				server_state TEXT NOT NULL DEFAULT 'external' CHECK (server_state IN ('external', 'stopped', 'starting', 'running', 'stopping', 'error')),
				server_generation TEXT,
				server_started_at TEXT,
				server_stop_at TEXT,
				server_stopped_at TEXT,
				server_error TEXT,
				manager_kind TEXT,
				manager_id TEXT,
				manager_pid INTEGER,
				manager_process_start_ticks TEXT,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				closed_at TEXT
			);
			CREATE INDEX IF NOT EXISTS preview_exposures_session_idx
				ON preview_exposures (pibo_session_id, created_at DESC);
			CREATE TABLE IF NOT EXISTS preview_tickets (
				token_hash TEXT PRIMARY KEY,
				preview_id TEXT NOT NULL,
				server_generation TEXT,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				used_at TEXT,
				FOREIGN KEY (preview_id) REFERENCES preview_exposures(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS preview_tickets_preview_idx
				ON preview_tickets (preview_id, expires_at);
			CREATE TABLE IF NOT EXISTS preview_browser_sessions (
				token_hash TEXT PRIMARY KEY,
				preview_id TEXT NOT NULL,
				server_generation TEXT,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				FOREIGN KEY (preview_id) REFERENCES preview_exposures(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS preview_browser_sessions_preview_idx
				ON preview_browser_sessions (preview_id, expires_at);
		`);
			const columns = new Set((this.db.prepare("PRAGMA table_info(preview_exposures)").all() as Array<{ name: string }>).map((column) => column.name));
			const additions: Array<[string, string]> = [
			["target_process_id", "INTEGER"],
			["target_process_start_ticks", "TEXT"],
			["management_mode", "TEXT NOT NULL DEFAULT 'external'"],
			["proxy_mode", "TEXT NOT NULL DEFAULT 'standard' CHECK (proxy_mode IN ('standard', 'pibo-compute-dev-auth'))"],
			["start_command", "TEXT"],
			["server_state", "TEXT NOT NULL DEFAULT 'external'"],
			["server_generation", "TEXT"],
			["server_started_at", "TEXT"],
			["server_stop_at", "TEXT"],
			["server_stopped_at", "TEXT"],
			["server_error", "TEXT"],
			["manager_kind", "TEXT"],
			["manager_id", "TEXT"],
			["manager_pid", "INTEGER"],
			["manager_process_start_ticks", "TEXT"],
			];
			for (const [name, declaration] of additions) {
				if (!columns.has(name)) this.db.exec(`ALTER TABLE preview_exposures ADD COLUMN ${name} ${declaration}`);
			}
			for (const table of ["preview_tickets", "preview_browser_sessions"]) {
				const authorityColumns = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
				if (!authorityColumns.has("server_generation")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN server_generation TEXT`);
			}
			if (needsStoppingStateMigration) {
				this.db.exec(`
					ALTER TABLE preview_exposures RENAME TO preview_exposures_before_stopping;
					CREATE TABLE preview_exposures (
						id TEXT PRIMARY KEY,
						pibo_session_id TEXT NOT NULL,
						label TEXT NOT NULL,
						target_host TEXT NOT NULL CHECK (target_host IN ('127.0.0.1', '::1')),
						target_port INTEGER NOT NULL CHECK (target_port BETWEEN 1024 AND 65535),
						target_process_id INTEGER,
						target_process_start_ticks TEXT,
						workspace TEXT NOT NULL,
						management_mode TEXT NOT NULL DEFAULT 'external' CHECK (management_mode IN ('external', 'managed')),
						proxy_mode TEXT NOT NULL DEFAULT 'standard' CHECK (proxy_mode IN ('standard', 'pibo-compute-dev-auth')),
						start_command TEXT,
						server_state TEXT NOT NULL DEFAULT 'external' CHECK (server_state IN ('external', 'stopped', 'starting', 'running', 'stopping', 'error')),
						server_generation TEXT,
						server_started_at TEXT,
						server_stop_at TEXT,
						server_stopped_at TEXT,
						server_error TEXT,
						manager_kind TEXT,
						manager_id TEXT,
						manager_pid INTEGER,
						manager_process_start_ticks TEXT,
						created_at TEXT NOT NULL,
						expires_at TEXT NOT NULL,
						closed_at TEXT
					);
					INSERT INTO preview_exposures (
						id, pibo_session_id, label, target_host, target_port,
						target_process_id, target_process_start_ticks, workspace,
						management_mode, proxy_mode, start_command, server_state, server_generation,
						server_started_at, server_stop_at, server_stopped_at, server_error,
						manager_kind, manager_id, manager_pid, manager_process_start_ticks,
						created_at, expires_at, closed_at
					)
					SELECT
						id, pibo_session_id, label, target_host, target_port,
						target_process_id, target_process_start_ticks, workspace,
						management_mode, proxy_mode, start_command, server_state, server_generation,
						server_started_at, server_stop_at, server_stopped_at, server_error,
						manager_kind, manager_id, manager_pid, manager_process_start_ticks,
						created_at, expires_at, closed_at
					FROM preview_exposures_before_stopping;
					DROP TABLE preview_exposures_before_stopping;
				`);
			}
			this.db.exec(`
			CREATE INDEX IF NOT EXISTS preview_exposures_session_idx
				ON preview_exposures (pibo_session_id, created_at DESC);
			CREATE INDEX IF NOT EXISTS preview_exposures_managed_state_idx
				ON preview_exposures (management_mode, server_state, expires_at)
		`);
			if (currentVersion < 5) migratePreviewSessionOwnership(this.db);
			this.db.exec(`PRAGMA user_version = ${PREVIEW_SCHEMA_VERSION}`);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		} finally {
			if (needsStoppingStateMigration) {
				this.db.exec("PRAGMA legacy_alter_table = OFF");
				this.db.exec("PRAGMA foreign_keys = ON");
			}
		}
		if (needsStoppingStateMigration) {
			const violations = this.db.prepare("PRAGMA foreign_key_check").all();
			if (violations.length > 0) throw new Error("Preview database migration violated foreign-key integrity");
		}
	}

	createExposure(input: CreatePreviewExposureInput): PreviewExposure {
		validateExposureInput(input);
		const managementMode = input.managementMode ?? "external";
		const proxyMode = input.proxyMode ?? "standard";
		const serverState = managementMode === "managed" ? input.serverState ?? "stopped" : "external";
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const globalCount = Number((this.db.prepare(
				"SELECT COUNT(*) AS count FROM preview_exposures WHERE closed_at IS NULL AND expires_at > ?",
			).get(input.createdAt) as { count: number }).count);
			if (globalCount >= MAX_ACTIVE_PREVIEW_EXPOSURES) {
				throw new PreviewExposureCapacityError(MAX_ACTIVE_PREVIEW_EXPOSURES, "global");
			}
			const sessionCount = Number((this.db.prepare(
				"SELECT COUNT(*) AS count FROM preview_exposures WHERE pibo_session_id = ? AND closed_at IS NULL AND expires_at > ?",
			).get(input.piboSessionId, input.createdAt) as { count: number }).count);
			if (sessionCount >= MAX_ACTIVE_PREVIEW_EXPOSURES_PER_SESSION) {
				throw new PreviewExposureCapacityError(MAX_ACTIVE_PREVIEW_EXPOSURES_PER_SESSION, "session");
			}
			this.db.prepare(`
			INSERT INTO preview_exposures (
				id, pibo_session_id, label, target_host, target_port,
				target_process_id, target_process_start_ticks, workspace,
				management_mode, proxy_mode, start_command, server_state,
				created_at, expires_at, closed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			`).run(
			input.id,
			input.piboSessionId,
			input.label,
			input.targetHost,
			input.targetPort,
			input.targetProcessId ?? null,
			input.targetProcessStartTicks ?? null,
			input.workspace,
			managementMode,
			proxyMode,
			input.startCommand ?? null,
			serverState,
			input.createdAt,
			input.expiresAt,
			);
			const exposure = this.requireExposure(input.id);
			this.db.exec("COMMIT");
			return exposure;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	getExposure(id: string): PreviewExposure | undefined {
		const row = this.db.prepare("SELECT * FROM preview_exposures WHERE id = ?").get(id) as ExposureRow | undefined;
		return row ? exposureFromRow(row) : undefined;
	}

	requireExposure(id: string): PreviewExposure {
		const exposure = this.getExposure(id);
		if (!exposure) throw new Error(`Preview "${id}" was not found`);
		return exposure;
	}

	listExposures(input: { piboSessionId?: string; includeInactive?: boolean } = {}): PreviewExposure[] {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(input.piboSessionId);
		}
		if (!input.includeInactive) {
			clauses.push("closed_at IS NULL");
			clauses.push("expires_at > ?");
			values.push(new Date().toISOString());
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		return (this.db.prepare(`SELECT * FROM preview_exposures ${where} ORDER BY created_at DESC`).all(...values) as ExposureRow[])
			.map(exposureFromRow);
	}

	listManagedServerCandidates(): PreviewExposure[] {
		return (this.db.prepare(`
			SELECT * FROM preview_exposures
			WHERE management_mode = 'managed'
				AND (server_state IN ('starting', 'running', 'stopping') OR manager_id IS NOT NULL)
			ORDER BY created_at ASC
		`).all() as ExposureRow[]).map(exposureFromRow);
	}

	reserveManagedServerStart(
		id: string,
		maxRunningServers: number,
		startedAt: string,
		stopAt: string,
		manager: PreviewManagerIdentity,
	): { exposure: PreviewExposure; reserved: boolean } {
		if (
			!manager.id ||
			manager.id.length > 256 ||
			(manager.kind !== "systemd" && manager.kind !== "process")
		) throw new Error("Managed Preview owner identity is invalid");
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const exposure = this.requireExposure(id);
			if (previewExposureState(exposure, new Date(startedAt)) !== "active") throw new Error(`Preview "${id}" is not active`);
			if (exposure.managementMode !== "managed" || !exposure.startCommand) throw new Error(`Preview "${id}" has no managed start command`);
			if (
				exposure.serverState === "starting" ||
				exposure.serverState === "running" ||
				exposure.serverState === "stopping" ||
				exposure.serverGeneration ||
				exposure.managerId
			) {
				this.db.exec("COMMIT");
				return { exposure, reserved: false };
			}
			const row = this.db.prepare(`
				SELECT COUNT(*) AS count FROM preview_exposures
				WHERE management_mode = 'managed'
					AND (server_state IN ('starting', 'running', 'stopping') OR manager_id IS NOT NULL)
					AND closed_at IS NULL
					AND expires_at > ?
			`).get(startedAt) as { count: number };
			if (Number(row.count) >= maxRunningServers) throw new PreviewCapacityError(maxRunningServers);
			const generation = opaqueToken();
			this.db.prepare(`
				UPDATE preview_exposures SET
					server_state = 'starting', server_generation = ?, server_started_at = ?, server_stop_at = ?,
					server_stopped_at = NULL, server_error = NULL,
					manager_kind = ?, manager_id = ?, manager_pid = ?, manager_process_start_ticks = ?,
					target_process_id = NULL, target_process_start_ticks = NULL
				WHERE id = ?
			`).run(
				generation,
				startedAt,
				stopAt,
				manager.kind,
				manager.id,
				manager.pid ?? null,
				manager.processStartTicks ?? null,
				id,
			);
			this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ?").run(id);
			this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ?").run(id);
			this.db.exec("COMMIT");
			return { exposure: this.requireExposure(id), reserved: true };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	markManagedServerManager(id: string, generation: string, manager: PreviewManagerIdentity): PreviewExposure {
		this.db.prepare(`
			UPDATE preview_exposures SET
				manager_pid = ?, manager_process_start_ticks = ?
			WHERE id = ? AND management_mode = 'managed'
				AND server_state = 'starting' AND server_generation = ? AND closed_at IS NULL
				AND manager_kind = ? AND manager_id = ?
		`).run(manager.pid ?? null, manager.processStartTicks ?? null, id, generation, manager.kind, manager.id);
		return this.requireExposure(id);
	}

	markManagedServerRunning(id: string, generation: string, input: {
		targetHost: PreviewExposure["targetHost"];
		targetProcessId?: number;
		targetProcessStartTicks?: string;
		manager: PreviewManagerIdentity;
	}): PreviewExposure {
		this.db.prepare(`
			UPDATE preview_exposures SET
				server_state = 'running', server_error = NULL,
				target_host = ?, target_process_id = ?, target_process_start_ticks = ?,
				manager_pid = ?, manager_process_start_ticks = ?
			WHERE id = ? AND management_mode = 'managed'
				AND server_state = 'starting' AND server_generation = ? AND closed_at IS NULL
				AND manager_kind = ? AND manager_id = ?
		`).run(
			input.targetHost,
			input.targetProcessId ?? null,
			input.targetProcessStartTicks ?? null,
			input.manager.pid ?? null,
			input.manager.processStartTicks ?? null,
			id,
			generation,
			input.manager.kind,
			input.manager.id,
		);
		return this.requireExposure(id);
	}

	markManagedServerStopping(id: string, generation: string): PreviewExposure {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = this.db.prepare(`
				UPDATE preview_exposures SET server_state = 'stopping'
				WHERE id = ? AND management_mode = 'managed'
					AND server_state IN ('starting', 'running', 'error')
					AND server_generation = ? AND manager_id IS NOT NULL
			`).run(id, generation);
			if (Number(result.changes ?? 0) > 0) {
				this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ?").run(id);
				this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ?").run(id);
			}
			const exposure = this.requireExposure(id);
			this.db.exec("COMMIT");
			return exposure;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	markManagedServerStopped(id: string, input: { stoppedAt?: string; error?: string; expectedGeneration?: string } = {}): PreviewExposure {
		const stoppedAt = input.stoppedAt ?? new Date().toISOString();
		const generationClause = input.expectedGeneration ? " AND server_generation = ?" : "";
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = this.db.prepare(`
				UPDATE preview_exposures SET
					server_state = ?, server_generation = NULL, server_stopped_at = ?, server_error = ?,
					manager_kind = NULL, manager_id = NULL, manager_pid = NULL, manager_process_start_ticks = NULL,
					target_process_id = NULL, target_process_start_ticks = NULL
				WHERE id = ? AND management_mode = 'managed'${generationClause}
			`).run(
				input.error ? "error" : "stopped",
				stoppedAt,
				input.error ?? null,
				id,
				...(input.expectedGeneration ? [input.expectedGeneration] : []),
			);
			if (Number(result.changes ?? 0) > 0) {
				this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ?").run(id);
				this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ?").run(id);
			}
			const exposure = this.requireExposure(id);
			this.db.exec("COMMIT");
			return exposure;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	closeExposure(id: string, closedAt = new Date().toISOString()): PreviewExposure | undefined {
		requireIsoDate(closedAt, "closedAt");
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.getExposure(id);
			if (
				current?.managementMode === "managed" &&
				(current.serverGeneration || current.managerId || ["starting", "running", "stopping"].includes(current.serverState ?? ""))
			) {
				throw new Error(`Managed Preview "${id}" must be fully stopped before removal`);
			}
			const result = this.db.prepare(`
			UPDATE preview_exposures SET
				closed_at = COALESCE(closed_at, ?), start_command = NULL,
				server_state = CASE WHEN management_mode = 'managed' THEN 'stopped' ELSE server_state END,
				server_generation = NULL,
				server_stopped_at = CASE WHEN management_mode = 'managed' THEN ? ELSE server_stopped_at END,
				manager_kind = NULL, manager_id = NULL, manager_pid = NULL, manager_process_start_ticks = NULL,
				target_process_id = NULL, target_process_start_ticks = NULL
			WHERE id = ?
			`).run(closedAt, closedAt, id);
			if (Number(result.changes ?? 0) === 0) {
				this.db.exec("COMMIT");
				return undefined;
			}
			this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ?").run(id);
			this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ?").run(id);
			const exposure = this.getExposure(id);
			this.db.exec("COMMIT");
			return exposure;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	createTicket(previewId: string, ttlSeconds: number, now = new Date()): PreviewTicket {
		if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
			throw new Error("Preview ticket lifetime must be between 1 and 300 seconds");
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const exposure = this.requireExposure(previewId);
			if (previewExposureState(exposure, now) !== "active") throw new Error(`Preview "${previewId}" is not active`);
			const serverGeneration = authorizationGeneration(exposure);
			if (serverGeneration === undefined) throw new Error(`Preview "${previewId}" server is not running`);
			const nowIso = now.toISOString();
			this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ? AND (expires_at <= ? OR used_at IS NOT NULL)")
				.run(previewId, nowIso);
			this.db.prepare(
				"DELETE FROM preview_tickets WHERE token_hash IN (" +
				"SELECT token_hash FROM preview_tickets WHERE preview_id = ? " +
				"ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?)",
			).run(previewId, MAX_OUTSTANDING_PREVIEW_TICKETS - 1);
			const token = opaqueToken();
			const expiresAt = new Date(Math.min(
				now.getTime() + ttlSeconds * 1000,
				Date.parse(exposure.expiresAt),
			)).toISOString();
			this.db.prepare("INSERT INTO preview_tickets (token_hash, preview_id, server_generation, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)")
				.run(tokenHash(token), previewId, serverGeneration, nowIso, expiresAt);
			this.db.exec("COMMIT");
			return { token, previewId, expiresAt };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	consumeTicket(token: string, previewId: string, now = new Date()): boolean {
		if (!isOpaqueToken(token)) return false;
		const hash = tokenHash(token);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const row = this.db.prepare("SELECT preview_id, server_generation, expires_at, used_at FROM preview_tickets WHERE token_hash = ?").get(hash) as TicketRow | undefined;
			const exposure = row?.preview_id === previewId ? this.getExposure(previewId) : undefined;
			const serverGeneration = exposure && previewExposureState(exposure, now) === "active"
				? authorizationGeneration(exposure)
				: undefined;
			const valid = Boolean(
				row &&
				row.preview_id === previewId &&
				serverGeneration !== undefined &&
				row.server_generation === serverGeneration &&
				!row.used_at &&
				Date.parse(row.expires_at) > now.getTime(),
			);
			if (valid) this.db.prepare("UPDATE preview_tickets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(now.toISOString(), hash);
			this.db.exec("COMMIT");
			return valid;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	createBrowserSession(previewId: string, ttlMinutes: number, now = new Date()): PreviewBrowserSession {
		if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 24 * 60) {
			throw new Error("Preview browser session lifetime must be between 1 minute and 24 hours");
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const exposure = this.requireExposure(previewId);
			if (previewExposureState(exposure, now) !== "active") throw new Error(`Preview "${previewId}" is not active`);
			const serverGeneration = authorizationGeneration(exposure);
			if (serverGeneration === undefined) throw new Error(`Preview "${previewId}" server is not running`);
			const nowIso = now.toISOString();
			this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ? AND expires_at <= ?").run(previewId, nowIso);
			this.db.prepare(
				"DELETE FROM preview_browser_sessions WHERE token_hash IN (" +
				"SELECT token_hash FROM preview_browser_sessions WHERE preview_id = ? " +
				"ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?)",
			).run(previewId, MAX_PREVIEW_BROWSER_SESSIONS - 1);
			const token = opaqueToken();
			const expiresAt = new Date(Math.min(
				now.getTime() + ttlMinutes * 60_000,
				Date.parse(exposure.expiresAt),
			)).toISOString();
			this.db.prepare("INSERT INTO preview_browser_sessions (token_hash, preview_id, server_generation, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
				.run(tokenHash(token), previewId, serverGeneration, nowIso, expiresAt);
			this.db.exec("COMMIT");
			return { token, previewId, expiresAt };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	exchangeTicketForBrowserSession(
		token: string,
		previewId: string,
		ttlMinutes: number,
		now = new Date(),
	): PreviewBrowserSession | undefined {
		if (!isOpaqueToken(token)) return undefined;
		if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 24 * 60) {
			throw new Error("Preview browser session lifetime must be between 1 minute and 24 hours");
		}
		const hash = tokenHash(token);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const row = this.db.prepare("SELECT preview_id, server_generation, expires_at, used_at FROM preview_tickets WHERE token_hash = ?")
				.get(hash) as TicketRow | undefined;
			const exposure = row?.preview_id === previewId ? this.getExposure(previewId) : undefined;
			const serverGeneration = exposure && previewExposureState(exposure, now) === "active"
				? authorizationGeneration(exposure)
				: undefined;
			if (
				!row ||
				row.preview_id !== previewId ||
				row.used_at ||
				Date.parse(row.expires_at) <= now.getTime() ||
				serverGeneration === undefined ||
				row.server_generation !== serverGeneration
			) {
				this.db.exec("COMMIT");
				return undefined;
			}
			const consumed = this.db.prepare("UPDATE preview_tickets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
				.run(now.toISOString(), hash);
			if (Number(consumed.changes ?? 0) !== 1) {
				this.db.exec("COMMIT");
				return undefined;
			}
			const nowIso = now.toISOString();
			this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ? AND expires_at <= ?").run(previewId, nowIso);
			this.db.prepare(
				"DELETE FROM preview_browser_sessions WHERE token_hash IN (" +
				"SELECT token_hash FROM preview_browser_sessions WHERE preview_id = ? " +
				"ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?)",
			).run(previewId, MAX_PREVIEW_BROWSER_SESSIONS - 1);
			const browserToken = opaqueToken();
			const expiresAt = new Date(Math.min(
				now.getTime() + ttlMinutes * 60_000,
				Date.parse(exposure!.expiresAt),
			)).toISOString();
			this.db.prepare("INSERT INTO preview_browser_sessions (token_hash, preview_id, server_generation, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
				.run(tokenHash(browserToken), previewId, serverGeneration, nowIso, expiresAt);
			this.db.exec("COMMIT");
			return { token: browserToken, previewId, expiresAt };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	authorizedBrowserSessionExposure(
		token: string | undefined,
		previewId: string,
		expectedExposure?: PreviewExposure,
		now = new Date(),
	): PreviewExposure | undefined {
		if (!token || !isOpaqueToken(token)) return undefined;
		const row = this.db.prepare(`
			SELECT exposure.*,
				browser.preview_id AS browser_preview_id,
				browser.server_generation AS browser_server_generation,
				browser.expires_at AS browser_expires_at
			FROM preview_browser_sessions browser
			JOIN preview_exposures exposure ON exposure.id = browser.preview_id
			WHERE browser.token_hash = ?
		`).get(tokenHash(token)) as BrowserAuthorizationRow | undefined;
		if (!row || row.browser_preview_id !== previewId || Date.parse(row.browser_expires_at) <= now.getTime()) {
			return undefined;
		}
		const exposure = exposureFromRow(row);
		if (previewExposureState(exposure, now) !== "active") return undefined;
		const serverGeneration = authorizationGeneration(exposure);
		if (serverGeneration === undefined || row.browser_server_generation !== serverGeneration) return undefined;
		return !expectedExposure || sameAuthorizationExposure(exposure, expectedExposure) ? exposure : undefined;
	}

	authenticateBrowserSession(token: string | undefined, previewId: string, now = new Date()): boolean {
		return Boolean(this.authorizedBrowserSessionExposure(token, previewId, undefined, now));
	}

	diagnostics(now = new Date()): {
		schemaVersion: number;
		activeExposures: number;
		expiredExposures: number;
		closedExposures: number;
		managedStartingOrRunning: number;
		outstandingTickets: number;
		activeBrowserSessions: number;
	} {
		const iso = now.toISOString();
		const count = (sql: string, ...values: string[]) =>
			Number((this.db.prepare(sql).get(...values) as { count: number }).count);
		return {
			schemaVersion: Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version),
			activeExposures: count("SELECT COUNT(*) AS count FROM preview_exposures WHERE closed_at IS NULL AND expires_at > ?", iso),
			expiredExposures: count("SELECT COUNT(*) AS count FROM preview_exposures WHERE closed_at IS NULL AND expires_at <= ?", iso),
			closedExposures: count("SELECT COUNT(*) AS count FROM preview_exposures WHERE closed_at IS NOT NULL"),
			managedStartingOrRunning: count("SELECT COUNT(*) AS count FROM preview_exposures WHERE management_mode = 'managed' AND server_state IN ('starting', 'running', 'stopping')"),
			outstandingTickets: count("SELECT COUNT(*) AS count FROM preview_tickets WHERE used_at IS NULL AND expires_at > ?", iso),
			activeBrowserSessions: count("SELECT COUNT(*) AS count FROM preview_browser_sessions WHERE expires_at > ?", iso),
		};
	}

	prune(now = new Date()): { tickets: number; browserSessions: number; expiredCommands: number; exposures: number } {
		const iso = now.toISOString();
		const retentionCutoff = new Date(now.getTime() - CLOSED_PREVIEW_RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const inactiveTickets = this.db.prepare(`
				DELETE FROM preview_tickets WHERE preview_id IN (
					SELECT id FROM preview_exposures WHERE closed_at IS NOT NULL OR expires_at <= ?
				)
			`).run(iso);
			const expiredTickets = this.db.prepare("DELETE FROM preview_tickets WHERE expires_at <= ? OR used_at IS NOT NULL").run(iso);
			const inactiveBrowserSessions = this.db.prepare(`
				DELETE FROM preview_browser_sessions WHERE preview_id IN (
					SELECT id FROM preview_exposures WHERE closed_at IS NOT NULL OR expires_at <= ?
				)
			`).run(iso);
			const expiredBrowserSessions = this.db.prepare("DELETE FROM preview_browser_sessions WHERE expires_at <= ?").run(iso);
			const expiredCommands = this.db.prepare(`
				UPDATE preview_exposures SET start_command = NULL
				WHERE expires_at <= ? AND start_command IS NOT NULL
					AND server_state NOT IN ('starting', 'running', 'stopping')
					AND server_generation IS NULL AND manager_id IS NULL
			`).run(iso);
			const exposures = this.db.prepare(`
				DELETE FROM preview_exposures
				WHERE server_generation IS NULL AND manager_id IS NULL
					AND ((closed_at IS NOT NULL AND closed_at <= ?)
						OR (expires_at <= ? AND server_state NOT IN ('starting', 'running', 'stopping')))
			`).run(retentionCutoff, retentionCutoff);
			this.db.exec("COMMIT");
			return {
				tickets: Number(inactiveTickets.changes ?? 0) + Number(expiredTickets.changes ?? 0),
				browserSessions: Number(inactiveBrowserSessions.changes ?? 0) + Number(expiredBrowserSessions.changes ?? 0),
				expiredCommands: Number(expiredCommands.changes ?? 0),
				exposures: Number(exposures.changes ?? 0),
			};
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPreviewStore(): PreviewStore {
	return new PreviewStore();
}
