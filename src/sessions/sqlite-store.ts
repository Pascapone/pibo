import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	createSessionBinding,
	createPiboSessionId,
	type PiboSessionBinding,
	type PiboSessionBindingStore,
	type ResolveSessionBindingInput,
	type UpdateSessionBindingInput,
} from "./bindings.js";

type BindingRow = {
	session_key: string;
	session_id: string;
	parent_session_key: string | null;
	parent_session_id: string | null;
	channel: string;
	external_id: string;
	original_profile: string;
	current_profile: string | null;
	workspace: string | null;
	created_at: string;
	updated_at: string;
};

export class SqliteSessionBindingStore implements PiboSessionBindingStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS session_bindings (
				session_key TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				parent_session_key TEXT,
				parent_session_id TEXT,
				channel TEXT NOT NULL,
				external_id TEXT NOT NULL,
				original_profile TEXT NOT NULL,
				current_profile TEXT,
				workspace TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				UNIQUE(channel, external_id)
			)
		`);
		this.migrate();
	}

	get(sessionKey: string): PiboSessionBinding | undefined {
		const row = this.db
			.prepare("SELECT * FROM session_bindings WHERE session_key = ?")
			.get(sessionKey) as BindingRow | undefined;
		return row ? bindingFromRow(row) : undefined;
	}

	list(): PiboSessionBinding[] {
		return (this.db.prepare("SELECT * FROM session_bindings ORDER BY updated_at DESC").all() as BindingRow[]).map(
			bindingFromRow,
		);
	}

	update(sessionKey: string, input: UpdateSessionBindingInput): PiboSessionBinding | undefined {
		const existing = this.get(sessionKey);
		if (!existing) return undefined;
		if (input.sessionId && input.sessionId !== existing.sessionId) {
			const existingSession = this.findBySessionId(input.sessionId);
			if (existingSession) return existingSession;
		}

		const updatedAt = new Date().toISOString();
		this.db
			.prepare(`
				UPDATE session_bindings SET
					session_id = ?,
					parent_session_id = ?,
					current_profile = ?,
					workspace = ?,
					updated_at = ?
				WHERE session_key = ?
			`)
			.run(
				input.sessionId ?? existing.sessionId,
				input.parentSessionId ?? existing.parentSessionId ?? null,
				input.currentProfile ?? existing.currentProfile ?? null,
				input.workspace ?? existing.workspace ?? null,
				updatedAt,
				sessionKey,
			);
		return this.get(sessionKey);
	}

	resolve(input: ResolveSessionBindingInput): PiboSessionBinding {
		const existing = this.findByChannelExternalId(input.channel, input.externalId);
		if (existing) return existing;
		if (input.sessionId) {
			const existingSession = this.findBySessionId(input.sessionId);
			if (existingSession) return existingSession;
		}

		const binding = createSessionBinding(input);
		this.db
			.prepare(`
				INSERT INTO session_bindings (
					session_key,
					session_id,
					parent_session_key,
					parent_session_id,
					channel,
					external_id,
					original_profile,
					current_profile,
					workspace,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
			`)
			.run(
				binding.sessionKey,
				binding.sessionId,
				binding.parentSessionKey ?? null,
				binding.parentSessionId ?? null,
				binding.channel,
				binding.externalId,
				binding.originalProfile,
				binding.workspace ?? null,
				binding.createdAt,
				binding.updatedAt,
			);

		const created = this.get(binding.sessionKey);
		if (!created) {
			throw new Error(`Failed to create session binding "${binding.sessionKey}"`);
		}
		return created;
	}

	close(): void {
		this.db.close();
	}

	private findByChannelExternalId(channel: string, externalId: string): PiboSessionBinding | undefined {
		const row = this.db
			.prepare("SELECT * FROM session_bindings WHERE channel = ? AND external_id = ?")
			.get(channel, externalId) as BindingRow | undefined;
		return row ? bindingFromRow(row) : undefined;
	}

	private findBySessionId(sessionId: string): PiboSessionBinding | undefined {
		const row = this.db
			.prepare("SELECT * FROM session_bindings WHERE session_id = ?")
			.get(sessionId) as BindingRow | undefined;
		return row ? bindingFromRow(row) : undefined;
	}

	private migrate(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(session_bindings)").all() as Array<{ name: string }>).map(
				(column) => column.name,
			),
		);

		if (!columns.has("session_id")) {
			this.db.exec("ALTER TABLE session_bindings ADD COLUMN session_id TEXT");
		}
		if (!columns.has("parent_session_key")) {
			this.db.exec("ALTER TABLE session_bindings ADD COLUMN parent_session_key TEXT");
		}
		if (!columns.has("parent_session_id")) {
			this.db.exec("ALTER TABLE session_bindings ADD COLUMN parent_session_id TEXT");
		}

		const missingSessionIds = this.db
			.prepare("SELECT session_key FROM session_bindings WHERE session_id IS NULL OR session_id = ''")
			.all() as Array<{ session_key: string }>;
		const update = this.db.prepare("UPDATE session_bindings SET session_id = ? WHERE session_key = ?");
		for (const row of missingSessionIds) {
			update.run(createPiboSessionId(), row.session_key);
		}

		this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_bindings_session_id ON session_bindings(session_id)");
	}
}

export function createDefaultSessionBindingStore(cwd = process.cwd()): SqliteSessionBindingStore {
	return new SqliteSessionBindingStore(resolve(cwd, ".pibo/session-bindings.sqlite"));
}

function bindingFromRow(row: BindingRow): PiboSessionBinding {
	return {
		sessionKey: row.session_key,
		sessionId: row.session_id,
		parentSessionKey: row.parent_session_key ?? undefined,
		parentSessionId: row.parent_session_id ?? undefined,
		channel: row.channel,
		externalId: row.external_id,
		originalProfile: row.original_profile,
		currentProfile: row.current_profile ?? undefined,
		workspace: row.workspace ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
