import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensurePrivatePiboHomeForPath, piboHomePath } from "../core/pibo-home.js";
import { protectPrivateFileSync } from "../core/private-path.js";
import { loadPreviewConfig } from "./config.js";
import type {
	CreatePreviewExposureInput,
	PreviewBrowserSession,
	PreviewExposure,
	PreviewExposureState,
	PreviewTicket,
} from "./types.js";

type ExposureRow = {
	id: string;
	pibo_session_id: string;
	project_id: string | null;
	label: string;
	target_host: "127.0.0.1" | "::1";
	target_port: number;
	target_process_id: number | null;
	target_process_start_ticks: string | null;
	workspace: string;
	created_at: string;
	expires_at: string;
	closed_at: string | null;
};

type TicketRow = {
	preview_id: string;
	expires_at: string;
	used_at: string | null;
};

function tokenHash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function opaqueToken(): string {
	return randomBytes(32).toString("base64url");
}

function exposureFromRow(row: ExposureRow): PreviewExposure {
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		projectId: row.project_id ?? undefined,
		label: row.label,
		targetHost: row.target_host,
		targetPort: row.target_port,
		targetProcessId: row.target_process_id ?? undefined,
		targetProcessStartTicks: row.target_process_start_ticks ?? undefined,
		workspace: row.workspace,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		closedAt: row.closed_at ?? undefined,
	};
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
		if (this.path !== ":memory:") {
			this.db.exec("PRAGMA journal_mode = WAL");
			protectPrivateFileSync(this.path, { force: true });
		}
		this.applySchema();
	}

	private applySchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS preview_exposures (
				id TEXT PRIMARY KEY,
				pibo_session_id TEXT NOT NULL,
				project_id TEXT,
				label TEXT NOT NULL,
				target_host TEXT NOT NULL CHECK (target_host IN ('127.0.0.1', '::1')),
				target_port INTEGER NOT NULL,
				target_process_id INTEGER,
				target_process_start_ticks TEXT,
				workspace TEXT NOT NULL,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				closed_at TEXT
			);
			CREATE INDEX IF NOT EXISTS preview_exposures_session_idx
				ON preview_exposures (pibo_session_id, created_at DESC);
			CREATE TABLE IF NOT EXISTS preview_tickets (
				token_hash TEXT PRIMARY KEY,
				preview_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				used_at TEXT
			);
			CREATE INDEX IF NOT EXISTS preview_tickets_preview_idx
				ON preview_tickets (preview_id, expires_at);
			CREATE TABLE IF NOT EXISTS preview_browser_sessions (
				token_hash TEXT PRIMARY KEY,
				preview_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS preview_browser_sessions_preview_idx
				ON preview_browser_sessions (preview_id, expires_at);
		`);
		const columns = new Set((this.db.prepare("PRAGMA table_info(preview_exposures)").all() as Array<{ name: string }>).map((column) => column.name));
		if (!columns.has("target_process_id")) this.db.exec("ALTER TABLE preview_exposures ADD COLUMN target_process_id INTEGER");
		if (!columns.has("target_process_start_ticks")) this.db.exec("ALTER TABLE preview_exposures ADD COLUMN target_process_start_ticks TEXT");
	}

	createExposure(input: CreatePreviewExposureInput): PreviewExposure {
		this.db.prepare(`
			INSERT INTO preview_exposures (
				id, pibo_session_id, project_id, label, target_host, target_port,
				target_process_id, target_process_start_ticks, workspace, created_at, expires_at, closed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
		`).run(
			input.id,
			input.piboSessionId,
			input.projectId ?? null,
			input.label,
			input.targetHost,
			input.targetPort,
			input.targetProcessId ?? null,
			input.targetProcessStartTicks ?? null,
			input.workspace,
			input.createdAt,
			input.expiresAt,
		);
		return this.requireExposure(input.id);
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

	closeExposure(id: string, closedAt = new Date().toISOString()): PreviewExposure | undefined {
		const result = this.db.prepare("UPDATE preview_exposures SET closed_at = COALESCE(closed_at, ?) WHERE id = ?").run(closedAt, id);
		if (Number(result.changes ?? 0) === 0) return undefined;
		this.db.prepare("DELETE FROM preview_tickets WHERE preview_id = ?").run(id);
		this.db.prepare("DELETE FROM preview_browser_sessions WHERE preview_id = ?").run(id);
		return this.getExposure(id);
	}

	createTicket(previewId: string, ttlSeconds: number, now = new Date()): PreviewTicket {
		const exposure = this.requireExposure(previewId);
		if (previewExposureState(exposure, now) !== "active") throw new Error(`Preview "${previewId}" is not active`);
		const token = opaqueToken();
		const expiresAt = new Date(Math.min(
			now.getTime() + ttlSeconds * 1000,
			Date.parse(exposure.expiresAt),
		)).toISOString();
		this.db.prepare("INSERT INTO preview_tickets (token_hash, preview_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)")
			.run(tokenHash(token), previewId, now.toISOString(), expiresAt);
		return { token, previewId, expiresAt };
	}

	consumeTicket(token: string, previewId: string, now = new Date()): boolean {
		const hash = tokenHash(token);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const row = this.db.prepare("SELECT preview_id, expires_at, used_at FROM preview_tickets WHERE token_hash = ?").get(hash) as TicketRow | undefined;
			const valid = Boolean(
				row &&
				row.preview_id === previewId &&
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
		const exposure = this.requireExposure(previewId);
		if (previewExposureState(exposure, now) !== "active") throw new Error(`Preview "${previewId}" is not active`);
		const token = opaqueToken();
		const expiresAt = new Date(Math.min(
			now.getTime() + ttlMinutes * 60_000,
			Date.parse(exposure.expiresAt),
		)).toISOString();
		this.db.prepare("INSERT INTO preview_browser_sessions (token_hash, preview_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
			.run(tokenHash(token), previewId, now.toISOString(), expiresAt);
		return { token, previewId, expiresAt };
	}

	authenticateBrowserSession(token: string | undefined, previewId: string, now = new Date()): boolean {
		if (!token) return false;
		const row = this.db.prepare("SELECT preview_id, expires_at FROM preview_browser_sessions WHERE token_hash = ?")
			.get(tokenHash(token)) as { preview_id: string; expires_at: string } | undefined;
		return Boolean(row && row.preview_id === previewId && Date.parse(row.expires_at) > now.getTime());
	}

	prune(now = new Date()): { tickets: number; browserSessions: number } {
		const iso = now.toISOString();
		const tickets = this.db.prepare("DELETE FROM preview_tickets WHERE expires_at <= ? OR used_at IS NOT NULL").run(iso);
		const browserSessions = this.db.prepare("DELETE FROM preview_browser_sessions WHERE expires_at <= ?").run(iso);
		return { tickets: Number(tickets.changes ?? 0), browserSessions: Number(browserSessions.changes ?? 0) };
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPreviewStore(): PreviewStore {
	return new PreviewStore();
}
