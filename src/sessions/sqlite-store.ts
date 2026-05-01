import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		return this.list().filter((session) => matchesFindInput(session, input));
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPiboSessionStore(cwd = process.cwd()): SqlitePiboSessionStore {
	return new SqlitePiboSessionStore(resolve(cwd, ".pibo/pibo-sessions.sqlite"));
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
