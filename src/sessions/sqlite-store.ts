import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../core/pibo-home.js";
import { DatabaseSync } from "node:sqlite";
import {
	createPiboSession,
	matchesFindInput,
	type CreatePiboSessionInput,
	type FindPiboSessionsInput,
	type PiboSession,
	type PiboSessionStore,
	type UpdatePiboSessionInput,
} from "./store.js";
import type { PiboJsonObject } from "../core/events.js";

type SessionRow = {
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

export class SqlitePiboSessionStore implements PiboSessionStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_sessions (
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
				active_model_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(parent_id) REFERENCES pibo_sessions(id),
				FOREIGN KEY(origin_id) REFERENCES pibo_sessions(id)
			);

			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_owner
				ON pibo_sessions(owner_scope, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_parent
				ON pibo_sessions(parent_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_origin
				ON pibo_sessions(origin_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_channel_kind
				ON pibo_sessions(channel, kind, updated_at);
		`);
		this.ensureActiveModelColumn();
	}

	private ensureActiveModelColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(pibo_sessions)").all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === "active_model_json")) {
			this.db.exec("ALTER TABLE pibo_sessions ADD COLUMN active_model_json TEXT");
		}
	}

	get(id: string): PiboSession | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_sessions WHERE id = ?").get(id) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	list(): PiboSession[] {
		return (this.db.prepare("SELECT * FROM pibo_sessions ORDER BY updated_at DESC").all() as SessionRow[]).map(
			sessionFromRow,
		);
	}

	create(input: CreatePiboSessionInput): PiboSession {
		const session = createPiboSession(input);
		this.db
			.prepare(`
				INSERT INTO pibo_sessions (
					id,
					pi_session_id,
					channel,
					kind,
					profile,
					owner_scope,
					parent_id,
					origin_id,
					workspace,
					title,
					metadata_json,
					active_model_json,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				session.id,
				session.piSessionId,
				session.channel,
				session.kind,
				session.profile,
				session.ownerScope ?? null,
				session.parentId ?? null,
				session.originId ?? null,
				session.workspace ?? null,
				session.title ?? null,
				JSON.stringify(session.metadata ?? {}),
				session.activeModel ? JSON.stringify(session.activeModel) : null,
				session.createdAt,
				session.updatedAt,
			);

		const created = this.get(session.id);
		if (!created) throw new Error(`Failed to create Pibo session "${session.id}"`);
		return created;
	}

	update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined {
		const existing = this.get(id);
		if (!existing) return undefined;

		const updated: PiboSession = {
			...existing,
			piSessionId: input.piSessionId ?? existing.piSessionId,
			profile: input.profile ?? existing.profile,
			ownerScope: input.ownerScope ?? existing.ownerScope,
			parentId: input.parentId === null ? undefined : input.parentId ?? existing.parentId,
			originId: input.originId === null ? undefined : input.originId ?? existing.originId,
			workspace: input.workspace === null ? undefined : input.workspace ?? existing.workspace,
			title: input.title === null ? undefined : input.title ?? existing.title,
			metadata: input.metadata ?? existing.metadata,
			activeModel: input.activeModel === null ? undefined : input.activeModel ? { ...input.activeModel } : existing.activeModel,
			updatedAt: new Date().toISOString(),
		};

		this.db
			.prepare(`
				UPDATE pibo_sessions SET
					pi_session_id = ?,
					profile = ?,
					owner_scope = ?,
					parent_id = ?,
					origin_id = ?,
					workspace = ?,
					title = ?,
					metadata_json = ?,
					active_model_json = ?,
					updated_at = ?
				WHERE id = ?
			`)
			.run(
				updated.piSessionId,
				updated.profile,
				updated.ownerScope ?? null,
				updated.parentId ?? null,
				updated.originId ?? null,
				updated.workspace ?? null,
				updated.title ?? null,
				JSON.stringify(updated.metadata ?? {}),
				updated.activeModel ? JSON.stringify(updated.activeModel) : null,
				updated.updatedAt,
				id,
			);
		return this.get(id);
	}

	delete(id: string): boolean {
		const result = this.db.prepare("DELETE FROM pibo_sessions WHERE id = ?").run(id);
		return Number(result.changes ?? 0) > 0;
	}

	find(input: FindPiboSessionsInput): PiboSession[] {
		const clauses: string[] = [];
		const values: Array<string | null> = [];

		if (input.ids !== undefined) {
			if (input.ids.length === 0) return [];
			clauses.push(`id IN (${input.ids.map(() => "?").join(", ")})`);
			values.push(...input.ids);
		}
		if (input.channel !== undefined) { clauses.push("channel = ?"); values.push(input.channel); }
		if (input.kind !== undefined) { clauses.push("kind = ?"); values.push(input.kind); }
		if (input.ownerScope !== undefined) { clauses.push("owner_scope = ?"); values.push(input.ownerScope); }
		if (input.parentId !== undefined) {
			if (input.parentId === null) clauses.push("parent_id IS NULL");
			else { clauses.push("parent_id = ?"); values.push(input.parentId); }
		}
		if (input.originId !== undefined) { clauses.push("origin_id = ?"); values.push(input.originId); }
		if (input.profile !== undefined) { clauses.push("profile = ?"); values.push(input.profile); }

		if (input.activeModel !== undefined) {
			if (input.activeModel === null) clauses.push("active_model_json IS NULL");
			else clauses.push("active_model_json IS NOT NULL");
		}

		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT * FROM pibo_sessions ${where} ORDER BY updated_at DESC`)
			.all(...values) as SessionRow[];
		return rows.map(sessionFromRow).filter((session) => matchesFindInput(session, input));
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPiboSessionStore(_cwd?: string): SqlitePiboSessionStore {
	return new SqlitePiboSessionStore(piboHomePath("pibo-sessions.sqlite"));
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id,
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		ownerScope: row.owner_scope ?? undefined,
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		workspace: row.workspace ?? undefined,
		title: row.title ?? undefined,
		metadata: parseMetadata(row.metadata_json),
		activeModel: parseModelProfile(row.active_model_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseMetadata(value: string | null): PiboJsonObject {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as PiboJsonObject;
	} catch {
		return {};
	}
}

function parseModelProfile(value: string | null): import("../core/profiles.js").ModelProfile | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const raw = parsed as Record<string, unknown>;
		if (typeof raw.provider !== "string" || typeof raw.id !== "string") return undefined;
		return { provider: raw.provider, id: raw.id };
	} catch {
		return undefined;
	}
}
