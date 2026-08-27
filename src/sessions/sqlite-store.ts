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
import {
	createLegacyPiRuntimeSessionBinding,
	nextRuntimeSessionBinding,
	RuntimeSessionBindingConflictError,
	type RuntimeSessionBinding,
	type RuntimeSessionBindingUpdateOptions,
} from "./runtime-binding.js";

type SessionRow = {
	id: string;
	pi_session_id: string | null;
	channel: string;
	kind: string;
	profile: string;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	metadata_json: string | null;
	active_model_json: string | null;
	created_at: string;
	updated_at: string;
	binding_pibo_session_id: string | null;
	binding_runtime_instance_id: string | null;
	binding_runtime_adapter_id: string | null;
	binding_native_session_id: string | null;
	binding_state: string | null;
	binding_protocol: string | null;
	binding_protocol_version: string | null;
	binding_adapter_version: string | null;
	binding_locator_json: string | null;
	binding_metadata_json: string | null;
	binding_revision: number | null;
	binding_created_at: string | null;
	binding_updated_at: string | null;
};

const SESSION_SELECT = `
	SELECT
		s.*,
		b.pibo_session_id AS binding_pibo_session_id,
		b.runtime_instance_id AS binding_runtime_instance_id,
		b.runtime_adapter_id AS binding_runtime_adapter_id,
		b.native_session_id AS binding_native_session_id,
		b.binding_state AS binding_state,
		b.protocol AS binding_protocol,
		b.protocol_version AS binding_protocol_version,
		b.adapter_version AS binding_adapter_version,
		b.locator_json AS binding_locator_json,
		b.metadata_json AS binding_metadata_json,
		b.revision AS binding_revision,
		b.created_at AS binding_created_at,
		b.updated_at AS binding_updated_at
	FROM pibo_sessions s
	LEFT JOIN pibo_session_runtime_bindings b ON b.pibo_session_id = s.id
`;

export class SqlitePiboSessionStore implements PiboSessionStore {
	readonly #concreteRuntimeBindingCasIdentity: boolean;
	private readonly db: DatabaseSync;

	constructor(path: string) {
		this.#concreteRuntimeBindingCasIdentity = new.target === SqlitePiboSessionStore;
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.applySchema();
		this.ensureActiveModelColumn();
		this.ensureNullablePiSessionId();
		this.applySchema();
		this.applyRuntimeBindingSchema();
	}

	/** @internal Read-only concrete-construction identity; it cannot mint authorization. */
	static hasConcreteRuntimeBindingCasIdentity(store: unknown): store is SqlitePiboSessionStore {
		return typeof store === "object"
			&& store !== null
			&& #concreteRuntimeBindingCasIdentity in store
			&& store.#concreteRuntimeBindingCasIdentity;
	}

	private applySchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
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

			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_parent
				ON pibo_sessions(parent_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_origin
				ON pibo_sessions(origin_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_sessions_channel_kind
				ON pibo_sessions(channel, kind, updated_at);
		`);
	}

	private ensureActiveModelColumn(): void {
		const columns = new Set((this.db.prepare("PRAGMA table_info(pibo_sessions)").all() as Array<{ name: string }>).map((column) => column.name));
		if (!columns.has("active_model_json")) this.db.exec("ALTER TABLE pibo_sessions ADD COLUMN active_model_json TEXT");
	}

	private ensureNullablePiSessionId(): void {
		const column = (this.db.prepare("PRAGMA table_info(pibo_sessions)").all() as Array<{ name: string; notnull: number }>)
			.find((candidate) => candidate.name === "pi_session_id");
		if (!column || column.notnull === 0) return;
		this.db.exec(`
			PRAGMA foreign_keys = OFF;
			BEGIN IMMEDIATE;
			ALTER TABLE pibo_sessions RENAME TO pibo_sessions_before_runtime_bindings;
			CREATE TABLE pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
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
			INSERT INTO pibo_sessions (
				id, pi_session_id, channel, kind, profile, parent_id, origin_id,
				workspace, title, metadata_json, active_model_json, created_at, updated_at
			)
			SELECT
				id, pi_session_id, channel, kind, profile, parent_id, origin_id,
				workspace, title, metadata_json, active_model_json, created_at, updated_at
			FROM pibo_sessions_before_runtime_bindings;
			DROP TABLE pibo_sessions_before_runtime_bindings;
			COMMIT;
			PRAGMA foreign_keys = ON;
		`);
	}

	private applyRuntimeBindingSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_session_runtime_bindings (
				pibo_session_id TEXT PRIMARY KEY,
				runtime_instance_id TEXT NOT NULL,
				runtime_adapter_id TEXT NOT NULL,
				native_session_id TEXT,
				binding_state TEXT NOT NULL CHECK(binding_state IN ('unbound', 'bound', 'missing', 'error'))
					CHECK(binding_state NOT IN ('bound', 'missing') OR native_session_id IS NOT NULL),
				protocol TEXT,
				protocol_version TEXT,
				adapter_version TEXT,
				locator_json TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(pibo_session_id) REFERENCES pibo_sessions(id) ON DELETE CASCADE
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_session_runtime_bindings_native
				ON pibo_session_runtime_bindings(runtime_adapter_id, native_session_id)
				WHERE native_session_id IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_pibo_session_runtime_bindings_instance_state
				ON pibo_session_runtime_bindings(runtime_instance_id, binding_state, updated_at DESC);
			CREATE TRIGGER IF NOT EXISTS trg_pibo_sessions_runtime_binding_insert
			AFTER INSERT ON pibo_sessions
			WHEN NOT EXISTS (
				SELECT 1 FROM pibo_session_runtime_bindings WHERE pibo_session_id = NEW.id
			)
			BEGIN
				INSERT INTO pibo_session_runtime_bindings (
					pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
					binding_state, protocol, metadata_json, revision, created_at, updated_at
				) VALUES (NEW.id, 'pi', 'pi', NULLIF(NEW.pi_session_id, ''), 'unbound', 'pi-sdk', '{}', 1, NEW.created_at, NEW.updated_at);
			END;
			CREATE TRIGGER IF NOT EXISTS trg_pibo_sessions_runtime_binding_pi_update
			AFTER UPDATE OF pi_session_id ON pibo_sessions
			WHEN EXISTS (
				SELECT 1 FROM pibo_session_runtime_bindings
				WHERE pibo_session_id = NEW.id
					AND runtime_adapter_id = 'pi'
					AND COALESCE(native_session_id, '') <> COALESCE(NEW.pi_session_id, '')
			)
			BEGIN
				UPDATE pibo_session_runtime_bindings SET
					native_session_id = NULLIF(NEW.pi_session_id, ''),
					binding_state = CASE WHEN NEW.pi_session_id IS NULL OR NEW.pi_session_id = '' THEN 'unbound' ELSE 'bound' END,
					revision = revision + 1,
					updated_at = NEW.updated_at
				WHERE pibo_session_id = NEW.id AND runtime_adapter_id = 'pi';
			END;
			INSERT OR IGNORE INTO pibo_session_runtime_bindings (
				pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
				binding_state, protocol, metadata_json, revision, created_at, updated_at
			)
			SELECT
				id, 'pi', 'pi', NULLIF(pi_session_id, ''),
				CASE WHEN pi_session_id IS NULL OR pi_session_id = '' THEN 'unbound' ELSE 'bound' END,
				'pi-sdk', '{"migrationSource":"legacy-session-store","nativePresenceExpected":false}', 1, created_at, updated_at
			FROM pibo_sessions
			WHERE NOT EXISTS (
				SELECT 1 FROM pibo_session_runtime_bindings existing
				WHERE existing.pibo_session_id = pibo_sessions.id
			);
		`);
	}

	get(id: string): PiboSession | undefined {
		const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	list(): PiboSession[] {
		return (this.db.prepare(`${SESSION_SELECT} ORDER BY s.updated_at DESC`).all() as SessionRow[]).map(sessionFromRow);
	}

	create(input: CreatePiboSessionInput): PiboSession {
		const session = createPiboSession(input);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db
				.prepare(`
				INSERT INTO pibo_sessions (
					id,
					pi_session_id,
					channel,
					kind,
					profile,
					parent_id,
					origin_id,
					workspace,
					title,
					metadata_json,
					active_model_json,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
				.run(
					session.id,
					session.piSessionId || null,
				session.channel,
				session.kind,
				session.profile,
				session.parentId ?? null,
				session.originId ?? null,
				session.workspace ?? null,
				session.title ?? null,
				JSON.stringify(session.metadata ?? {}),
				session.activeModel ? JSON.stringify(session.activeModel) : null,
				session.createdAt,
					session.updatedAt,
				);
			this.upsertRuntimeBinding(
				session.runtimeBinding ?? createLegacyPiRuntimeSessionBinding(session.id, session.piSessionId, session.createdAt),
			);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}

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
				updated.piSessionId || null,
				updated.profile,
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
			clauses.push(`s.id IN (${input.ids.map(() => "?").join(", ")})`);
			values.push(...input.ids);
		}
		if (input.channel !== undefined) { clauses.push("s.channel = ?"); values.push(input.channel); }
		if (input.kind !== undefined) { clauses.push("s.kind = ?"); values.push(input.kind); }
		if (input.parentId !== undefined) {
			if (input.parentId === null) clauses.push("s.parent_id IS NULL");
			else { clauses.push("s.parent_id = ?"); values.push(input.parentId); }
		}
		if (input.originId !== undefined) { clauses.push("s.origin_id = ?"); values.push(input.originId); }
		if (input.profile !== undefined) { clauses.push("s.profile = ?"); values.push(input.profile); }

		if (input.activeModel !== undefined) {
			if (input.activeModel === null) clauses.push("s.active_model_json IS NULL");
			else clauses.push("s.active_model_json IS NOT NULL");
		}

		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`${SESSION_SELECT} ${where} ORDER BY s.updated_at DESC`)
			.all(...values) as SessionRow[];
		return rows.map(sessionFromRow).filter((session) => matchesFindInput(session, input));
	}

	getRuntimeBinding(id: string): RuntimeSessionBinding | undefined {
		const session = this.get(id);
		return session?.runtimeBinding ? structuredClone(session.runtimeBinding) : undefined;
	}

	updateRuntimeBinding(
		id: string,
		binding: RuntimeSessionBinding,
		options: RuntimeSessionBindingUpdateOptions = {},
	): RuntimeSessionBinding | undefined {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const current = this.getRuntimeBinding(id);
			if (!current) {
				this.db.exec("ROLLBACK");
				return undefined;
			}
			const currentRevision = current.revision ?? 1;
			const updated = nextRuntimeSessionBinding(current, { ...structuredClone(binding), piboSessionId: id }, options);
			const result = this.db.prepare(`
				UPDATE pibo_session_runtime_bindings SET
					runtime_instance_id = ?, runtime_adapter_id = ?, native_session_id = ?,
					binding_state = ?, protocol = ?, protocol_version = ?, adapter_version = ?,
					locator_json = ?, metadata_json = ?, revision = ?, updated_at = ?
				WHERE pibo_session_id = ? AND revision = ?
			`).run(
				updated.runtimeInstanceId,
				updated.adapterId,
				updated.nativeSessionId ?? null,
				updated.state,
				updated.protocol ?? null,
				updated.protocolVersion ?? null,
				updated.adapterVersion ?? null,
				updated.locator ? JSON.stringify(updated.locator) : null,
				JSON.stringify(updated.metadata ?? {}),
				updated.revision,
				updated.updatedAt,
				id,
				currentRevision,
			);
			if (Number(result.changes ?? 0) === 0) {
				const actual = this.getRuntimeBinding(id);
				throw new RuntimeSessionBindingConflictError(id, currentRevision, actual?.revision ?? 0);
			}
			this.db.prepare("UPDATE pibo_sessions SET pi_session_id = ?, updated_at = ? WHERE id = ?").run(
				updated.adapterId === "pi" ? updated.nativeSessionId ?? null : null,
				updated.updatedAt,
				id,
			);
			this.db.exec("COMMIT");
			return this.getRuntimeBinding(id);
		} catch (error) {
			if (this.db.isTransaction) this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private upsertRuntimeBinding(binding: RuntimeSessionBinding): void {
		this.db.prepare(`
			INSERT INTO pibo_session_runtime_bindings (
				pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
				binding_state, protocol, protocol_version, adapter_version, locator_json,
				metadata_json, revision, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(pibo_session_id) DO UPDATE SET
				runtime_instance_id = excluded.runtime_instance_id,
				runtime_adapter_id = excluded.runtime_adapter_id,
				native_session_id = excluded.native_session_id,
				binding_state = excluded.binding_state,
				protocol = excluded.protocol,
				protocol_version = excluded.protocol_version,
				adapter_version = excluded.adapter_version,
				locator_json = excluded.locator_json,
				metadata_json = excluded.metadata_json,
				revision = excluded.revision,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at
		`).run(
			binding.piboSessionId,
			binding.runtimeInstanceId,
			binding.adapterId,
			binding.nativeSessionId ?? null,
			binding.state,
			binding.protocol ?? null,
			binding.protocolVersion ?? null,
			binding.adapterVersion ?? null,
			binding.locator ? JSON.stringify(binding.locator) : null,
			JSON.stringify(binding.metadata ?? {}),
			binding.revision ?? 1,
			binding.createdAt ?? new Date().toISOString(),
			binding.updatedAt ?? binding.createdAt ?? new Date().toISOString(),
		);
	}

	close(): void {
		this.db.close();
	}
}

const auditedSqliteGet = SqlitePiboSessionStore.prototype.get;
const auditedSqliteGetRuntimeBinding = SqlitePiboSessionStore.prototype.getRuntimeBinding;
const auditedSqliteRuntimeBindingCas = SqlitePiboSessionStore.prototype.updateRuntimeBinding;
const hasConcreteSqliteRuntimeBindingCasIdentity = SqlitePiboSessionStore.hasConcreteRuntimeBindingCasIdentity;

/** @internal Resolves only the original CAS of an exact, genuinely constructed built-in store. */
export function resolveSqliteRuntimeBindingCas(
	store: unknown,
): typeof auditedSqliteRuntimeBindingCas | undefined {
	if (
		!hasConcreteSqliteRuntimeBindingCasIdentity(store)
		|| Object.getPrototypeOf(store) !== SqlitePiboSessionStore.prototype
		|| Object.prototype.hasOwnProperty.call(store, "get")
		|| Object.prototype.hasOwnProperty.call(store, "getRuntimeBinding")
		|| Object.prototype.hasOwnProperty.call(store, "updateRuntimeBinding")
		|| SqlitePiboSessionStore.prototype.get !== auditedSqliteGet
		|| SqlitePiboSessionStore.prototype.getRuntimeBinding !== auditedSqliteGetRuntimeBinding
		|| SqlitePiboSessionStore.prototype.updateRuntimeBinding !== auditedSqliteRuntimeBindingCas
	) return undefined;
	const auditedStore = new Proxy(store, {
		get(target, property) {
			if (property === "get") return auditedSqliteGet;
			if (property === "getRuntimeBinding") return auditedSqliteGetRuntimeBinding;
			if (property === "updateRuntimeBinding") return auditedSqliteRuntimeBindingCas;
			return Reflect.get(target, property, target);
		},
	});
	return auditedSqliteRuntimeBindingCas.bind(auditedStore);
}

export function createDefaultPiboSessionStore(_cwd?: string): SqlitePiboSessionStore {
	return new SqlitePiboSessionStore(piboHomePath("pibo-sessions.sqlite"));
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id ?? "",
		runtimeBinding: runtimeBindingFromRow(row),
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
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

function runtimeBindingFromRow(row: SessionRow): RuntimeSessionBinding {
	if (!row.binding_runtime_instance_id || !row.binding_runtime_adapter_id || !row.binding_state) {
		return createLegacyPiRuntimeSessionBinding(row.id, row.pi_session_id ?? undefined, row.created_at);
	}
	return {
		piboSessionId: row.binding_pibo_session_id ?? row.id,
		runtimeInstanceId: row.binding_runtime_instance_id,
		adapterId: row.binding_runtime_adapter_id,
		nativeSessionId: row.binding_native_session_id ?? undefined,
		state: isRuntimeBindingState(row.binding_state) ? row.binding_state : "error",
		protocol: row.binding_protocol ?? undefined,
		protocolVersion: row.binding_protocol_version ?? undefined,
		adapterVersion: row.binding_adapter_version ?? undefined,
		locator: row.binding_locator_json
			? parseMetadata(row.binding_locator_json) as RuntimeSessionBinding["locator"]
			: undefined,
		metadata: parseMetadata(row.binding_metadata_json),
		revision: row.binding_revision ?? 1,
		createdAt: row.binding_created_at ?? row.created_at,
		updatedAt: row.binding_updated_at ?? row.updated_at,
	};
}

function isRuntimeBindingState(value: string): value is RuntimeSessionBinding["state"] {
	return value === "unbound" || value === "bound" || value === "missing" || value === "error";
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
