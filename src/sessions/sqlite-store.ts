import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	PiboSessionBinding,
	PiboSessionBindingStore,
	ResolveSessionBindingInput,
} from "./bindings.js";

type BindingRow = {
	session_key: string;
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
	}

	get(sessionKey: string): PiboSessionBinding | undefined {
		const row = this.db
			.prepare("SELECT * FROM session_bindings WHERE session_key = ?")
			.get(sessionKey) as BindingRow | undefined;
		return row ? bindingFromRow(row) : undefined;
	}

	resolve(input: ResolveSessionBindingInput): PiboSessionBinding {
		const existing = this.findByChannelExternalId(input.channel, input.externalId);
		if (existing) return existing;

		const now = new Date().toISOString();
		const sessionKey = input.sessionKey ?? `${input.channel}:${input.externalId}`;
		this.db
			.prepare(`
				INSERT INTO session_bindings (
					session_key,
					channel,
					external_id,
					original_profile,
					current_profile,
					workspace,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
			`)
			.run(sessionKey, input.channel, input.externalId, input.defaultProfile, input.workspace ?? null, now, now);

		const created = this.get(sessionKey);
		if (!created) {
			throw new Error(`Failed to create session binding "${sessionKey}"`);
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
}

export function createDefaultSessionBindingStore(cwd = process.cwd()): SqliteSessionBindingStore {
	return new SqliteSessionBindingStore(resolve(cwd, ".pibo/session-bindings.sqlite"));
}

function bindingFromRow(row: BindingRow): PiboSessionBinding {
	return {
		sessionKey: row.session_key,
		channel: row.channel,
		externalId: row.external_id,
		originalProfile: row.original_profile,
		currentProfile: row.current_profile ?? undefined,
		workspace: row.workspace ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
