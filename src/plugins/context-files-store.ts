import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ContextFileScope } from "../core/profiles.js";

export type ContextFileLinkState =
	| "plugin-only"
	| "linked-clean"
	| "linked-dirty"
	| "linked-stale"
	| "orphaned"
	| "managed-unlinked";

export type StoredContextFileRecord = {
	key: string;
	label: string;
	managedPath: string;
	scope: ContextFileScope;
	sourceType: "managed";
	agentProfileName?: string;
	workingContent: string;
	sourceRef?: string;
	sourceHash?: string;
	sourceContent?: string;
	createdAt: string;
	updatedAt: string;
};

export type StoredContextFileRevisionRecord = {
	id: string;
	contextFileKey: string;
	name: string;
	contentHash: string;
	content: string;
	createdAt: string;
	actorId?: string;
};

export type StoredContextFileCatalogRecord = Pick<
	StoredContextFileRecord,
	"key" | "label" | "managedPath" | "scope" | "agentProfileName"
>;

type LegacyManagedContextFile = {
	key: string;
	label: string;
	path: string;
	scope: ContextFileScope;
	agentProfileName?: string;
};

type LegacyManagedContextFileStore = {
	files: LegacyManagedContextFile[];
};

type ContextFileRow = {
	key: string;
	label: string;
	managed_path: string;
	scope: ContextFileScope;
	source_type: "managed";
	agent_profile_name: string | null;
	active_revision_id: string | null;
	working_content: string | null;
	source_ref: string | null;
	source_hash: string | null;
	source_content: string | null;
	created_at: string;
	updated_at: string;
};

type ContextFileRevisionRow = {
	id: string;
	context_file_key: string;
	name: string;
	content_hash: string;
	content: string;
	created_at: string;
	actor_id: string | null;
};

type RevisionStorageMigrationRow = Pick<
	ContextFileRow,
	"key" | "managed_path" | "active_revision_id" | "working_content" | "source_content"
>;

const CONTEXT_FILE_SCHEMA_VERSION_KEY = "schema-version";
const CONTEXT_FILE_SCHEMA_VERSION = "2";
const MANUAL_REVISION_MIGRATION_KEY = "manual-revisions-v2";
const CONTEXT_FILE_BASE_COLUMNS = [
	"key",
	"label",
	"managed_path",
	"scope",
	"source_type",
	"agent_profile_name",
	"active_revision_id",
	"source_ref",
	"source_hash",
	"created_at",
	"updated_at",
] as const;
const CONTEXT_FILE_COLUMNS = [
	...CONTEXT_FILE_BASE_COLUMNS,
	"working_content",
	"source_content",
] as const;
const AUTOMATIC_REVISION_COLUMNS = [
	"id",
	"context_file_key",
	"kind",
	"content_hash",
	"content",
	"created_at",
	"actor_id",
	"based_on_revision_id",
	"source_hash_at_creation",
	"note",
] as const;
const MANUAL_REVISION_COLUMNS = [
	"id",
	"context_file_key",
	"name",
	"content_hash",
	"content",
	"created_at",
	"actor_id",
] as const;

export type CreateStoredContextFileInput = {
	key: string;
	label: string;
	managedPath: string;
	scope: ContextFileScope;
	agentProfileName?: string;
	workingContent: string;
	sourceRef?: string;
	sourceHash?: string;
	sourceContent?: string;
	createdAt?: string;
	updatedAt?: string;
};

export type UpdateStoredContextFileInput = {
	key: string;
	label: string;
	managedPath: string;
	scope: ContextFileScope;
	agentProfileName?: string;
	workingContent: string;
	sourceRef?: string;
	sourceHash?: string;
	sourceContent?: string;
	createdAt: string;
	updatedAt: string;
};

export type AppendRevisionInput = {
	contextFileKey: string;
	name: string;
	contentHash: string;
	content: string;
	createdAt?: string;
	actorId?: string;
};

export type ContextFileDiffChunk = {
	type: "equal" | "add" | "remove";
	lines: string[];
};

function readLegacyManagedStore(storePath: string): LegacyManagedContextFileStore {
	if (!existsSync(storePath)) return { files: [] };
	const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<LegacyManagedContextFileStore>;
	if (!Array.isArray(parsed.files)) return { files: [] };
	return {
		files: parsed.files.flatMap((file): LegacyManagedContextFile[] => {
			if (!file || typeof file !== "object") return [];
			const candidate = file as Partial<LegacyManagedContextFile>;
			if (typeof candidate.key !== "string" || typeof candidate.path !== "string") return [];
			const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : candidate.key;
			const scope = candidate.scope === "agent" ? "agent" : "global";
			const agentProfileName = scope === "agent" && typeof candidate.agentProfileName === "string"
				? candidate.agentProfileName
				: undefined;
			if (scope === "agent" && !agentProfileName) return [];
			return [{
				key: candidate.key,
				label,
				path: candidate.path,
				scope,
				...(agentProfileName ? { agentProfileName } : {}),
			}];
		}),
	};
}

function fileRowToRecord(row: ContextFileRow): StoredContextFileRecord {
	return {
		key: row.key,
		label: row.label,
		managedPath: row.managed_path,
		scope: row.scope,
		sourceType: row.source_type,
		...(row.agent_profile_name ? { agentProfileName: row.agent_profile_name } : {}),
		workingContent: row.working_content ?? "",
		...(row.source_ref ? { sourceRef: row.source_ref } : {}),
		...(row.source_hash ? { sourceHash: row.source_hash } : {}),
		...(row.source_content !== null ? { sourceContent: row.source_content } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function revisionRowToRecord(row: ContextFileRevisionRow): StoredContextFileRevisionRecord {
	return {
		id: row.id,
		contextFileKey: row.context_file_key,
		name: row.name,
		contentHash: row.content_hash,
		content: row.content,
		createdAt: row.created_at,
		...(row.actor_id ? { actorId: row.actor_id } : {}),
	};
}

export function readContextFileCatalog(path: string): StoredContextFileCatalogRecord[] {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) return [];

	const db = new DatabaseSync(resolvedPath, { readOnly: true });
	try {
		const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'context_files'").get();
		if (!table) return [];
		const columns = new Set(
			(db.prepare("PRAGMA table_info(context_files)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		const required = ["key", "label", "managed_path", "scope", "agent_profile_name"];
		if (!required.every((column) => columns.has(column))) return [];
		const rows = db.prepare(`
			SELECT key, label, managed_path, scope, agent_profile_name
			FROM context_files
			ORDER BY updated_at DESC
		`).all() as Array<Pick<ContextFileRow, "key" | "label" | "managed_path" | "scope" | "agent_profile_name">>;
		return rows.map((row) => ({
			key: row.key,
			label: row.label,
			managedPath: row.managed_path,
			scope: row.scope,
			...(row.agent_profile_name ? { agentProfileName: row.agent_profile_name } : {}),
		}));
	} finally {
		db.close();
	}
}

export class ContextFileMetadataStore {
	private readonly db: DatabaseSync;

	constructor(
		path: string,
		private readonly legacyStorePath?: string,
	) {
		const resolvedPath = resolve(path);
		mkdirSync(dirname(resolvedPath), { recursive: true });
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA journal_mode = WAL");
		this.migrateStorage();
		this.assertCompatibleSchema();
		this.migrateLegacyStore();
	}

	listFiles(): StoredContextFileRecord[] {
		this.assertCompatibleSchema();
		const rows = this.db.prepare("SELECT * FROM context_files ORDER BY updated_at DESC").all() as ContextFileRow[];
		return rows.map(fileRowToRecord);
	}

	getFile(key: string): StoredContextFileRecord | undefined {
		this.assertCompatibleSchema();
		const row = this.db.prepare("SELECT * FROM context_files WHERE key = ?").get(key) as ContextFileRow | undefined;
		return row ? fileRowToRecord(row) : undefined;
	}

	createFile(input: CreateStoredContextFileInput): StoredContextFileRecord {
		this.assertCompatibleSchema();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const updatedAt = input.updatedAt ?? createdAt;
		this.db
			.prepare(`
				INSERT INTO context_files (
					key,
					label,
					managed_path,
					scope,
					source_type,
					agent_profile_name,
					active_revision_id,
					working_content,
					source_ref,
					source_hash,
					source_content,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				input.key,
				input.label,
				input.managedPath,
				input.scope,
				"managed",
				input.agentProfileName ?? null,
				null,
				input.workingContent,
				input.sourceRef ?? null,
				input.sourceHash ?? null,
				input.sourceContent ?? null,
				createdAt,
				updatedAt,
			);
		const record = this.getFile(input.key);
		if (!record) throw new Error(`Failed to create context file record "${input.key}"`);
		return record;
	}

	updateFile(input: UpdateStoredContextFileInput): StoredContextFileRecord {
		this.assertCompatibleSchema();
		this.db
			.prepare(`
				UPDATE context_files SET
					label = ?,
					managed_path = ?,
					scope = ?,
					source_type = ?,
					agent_profile_name = ?,
					active_revision_id = NULL,
					working_content = ?,
					source_ref = ?,
					source_hash = ?,
					source_content = ?,
					created_at = ?,
					updated_at = ?
				WHERE key = ?
			`)
			.run(
				input.label,
				input.managedPath,
				input.scope,
				"managed",
				input.agentProfileName ?? null,
				input.workingContent,
				input.sourceRef ?? null,
				input.sourceHash ?? null,
				input.sourceContent ?? null,
				input.createdAt,
				input.updatedAt,
				input.key,
			);
		const record = this.getFile(input.key);
		if (!record) throw new Error(`Failed to update context file record "${input.key}"`);
		return record;
	}

	deleteFile(key: string): void {
		this.assertCompatibleSchema();
		this.db.exec("BEGIN");
		try {
			this.db.prepare("DELETE FROM context_file_manual_revisions WHERE context_file_key = ?").run(key);
			this.db.prepare("DELETE FROM context_file_revisions WHERE context_file_key = ?").run(key);
			this.db.prepare("DELETE FROM context_files WHERE key = ?").run(key);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	appendRevision(input: AppendRevisionInput): StoredContextFileRevisionRecord {
		this.assertCompatibleSchema();
		const id = `rev_${randomUUID()}`;
		const createdAt = input.createdAt ?? new Date().toISOString();
		this.db
			.prepare(`
				INSERT INTO context_file_manual_revisions (
					id,
					context_file_key,
					name,
					content_hash,
					content,
					created_at,
					actor_id
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				id,
				input.contextFileKey,
				input.name,
				input.contentHash,
				input.content,
				createdAt,
				input.actorId ?? null,
			);
		const revision = this.getRevision(id);
		if (!revision) throw new Error(`Failed to create context file revision "${id}"`);
		return revision;
	}

	getRevision(id: string): StoredContextFileRevisionRecord | undefined {
		this.assertCompatibleSchema();
		const row = this.db.prepare("SELECT * FROM context_file_manual_revisions WHERE id = ?").get(id) as ContextFileRevisionRow | undefined;
		return row ? revisionRowToRecord(row) : undefined;
	}

	listRevisions(contextFileKey: string): StoredContextFileRevisionRecord[] {
		this.assertCompatibleSchema();
		const rows = this.db
			.prepare("SELECT * FROM context_file_manual_revisions WHERE context_file_key = ? ORDER BY created_at DESC")
			.all(contextFileKey) as ContextFileRevisionRow[];
		return rows.map(revisionRowToRecord);
	}

	close(): void {
		this.db.close();
	}

	private columnsFor(table: string): Set<string> {
		if (!this.tableExists(table)) return new Set();
		return new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
	}

	private hasColumns(table: string, required: readonly string[]): boolean {
		const columns = this.columnsFor(table);
		return required.every((column) => columns.has(column));
	}

	private ensureColumn(table: string, column: string, type: string): void {
		if (this.columnsFor(table).has(column)) return;
		this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
	}

	private tableExists(table: string): boolean {
		return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
	}

	private ensureAutomaticRevisionTable(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS context_file_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT,
				based_on_revision_id TEXT,
				source_hash_at_creation TEXT,
				note TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_context_file_revisions_key
				ON context_file_revisions(context_file_key, created_at DESC);
		`);
	}

	private ensureManualRevisionTable(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS context_file_manual_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				name TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_context_file_manual_revisions_key
				ON context_file_manual_revisions(context_file_key, created_at DESC);
		`);
	}

	private assertCompatibleSchema(): void {
		const version = this.db.prepare("SELECT value FROM context_file_store_meta WHERE key = ?").get(CONTEXT_FILE_SCHEMA_VERSION_KEY) as { value?: string } | undefined;
		const compatible = version?.value === CONTEXT_FILE_SCHEMA_VERSION
			&& this.hasColumns("context_files", CONTEXT_FILE_COLUMNS)
			&& this.hasColumns("context_file_revisions", AUTOMATIC_REVISION_COLUMNS)
			&& this.hasColumns("context_file_manual_revisions", MANUAL_REVISION_COLUMNS);
		if (compatible) return;
		throw new Error(
			`Context Files metadata schema is incompatible with this Pibo version (expected ${CONTEXT_FILE_SCHEMA_VERSION}, found ${version?.value ?? "unversioned"}). ` +
			"Activate a matching package version or use an isolated PIBO_HOME before accessing Context Files storage.",
		);
	}

	private migrateStorage(): void {
		let recovered: Array<{
			key: string;
			managedPath: string;
			workingContent: string;
			sourceContent?: string;
			restoreManagedFile: boolean;
		}> = [];
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.exec(`
				CREATE TABLE IF NOT EXISTS context_file_store_meta (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);
			`);
			const version = this.db.prepare("SELECT value FROM context_file_store_meta WHERE key = ?").get(CONTEXT_FILE_SCHEMA_VERSION_KEY) as { value?: string } | undefined;
			if (version?.value === CONTEXT_FILE_SCHEMA_VERSION) {
				this.db.exec("COMMIT");
				return;
			}
			if (version?.value !== undefined && version.value !== "1") {
				throw new Error(`Unsupported Context Files metadata schema version ${version.value}; expected ${CONTEXT_FILE_SCHEMA_VERSION}`);
			}

			this.db.exec(`
				CREATE TABLE IF NOT EXISTS context_files (
					key TEXT PRIMARY KEY,
					label TEXT NOT NULL,
					managed_path TEXT NOT NULL,
					scope TEXT NOT NULL,
					source_type TEXT NOT NULL,
					agent_profile_name TEXT,
					active_revision_id TEXT,
					working_content TEXT,
					source_ref TEXT,
					source_hash TEXT,
					source_content TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_context_files_scope
					ON context_files(scope, updated_at);
			`);
			if (!this.hasColumns("context_files", CONTEXT_FILE_BASE_COLUMNS)) {
				throw new Error("Context Files metadata has an unsupported context_files table shape");
			}
			this.ensureColumn("context_files", "working_content", "TEXT");
			this.ensureColumn("context_files", "source_content", "TEXT");

			const revisionTableExists = this.tableExists("context_file_revisions");
			const revisionColumns = this.columnsFor("context_file_revisions");
			const hasAutomaticRevisionSchema = revisionTableExists
				&& AUTOMATIC_REVISION_COLUMNS.every((column) => revisionColumns.has(column));
			const hasManualOnlyRevisionSchema = revisionTableExists
				&& !hasAutomaticRevisionSchema
				&& MANUAL_REVISION_COLUMNS.every((column) => revisionColumns.has(column));
			if (revisionTableExists && !hasAutomaticRevisionSchema && !hasManualOnlyRevisionSchema) {
				throw new Error("Context Files metadata has an unsupported context_file_revisions table shape");
			}

			const files = this.db.prepare(`
				SELECT key, managed_path, active_revision_id, working_content, source_content
				FROM context_files
			`).all() as RevisionStorageMigrationRow[];
			recovered = files.map((file) => {
				const fileExists = existsSync(file.managed_path);
				const activeContent = !fileExists && revisionTableExists && file.active_revision_id
					? (this.db.prepare("SELECT content FROM context_file_revisions WHERE id = ?").get(file.active_revision_id) as { content?: string } | undefined)?.content
					: undefined;
				const workingContent = fileExists
					? readFileSync(file.managed_path, "utf8")
					: file.working_content ?? activeContent ?? "";
				const sourceContent = file.source_content ?? (hasAutomaticRevisionSchema
					? (this.db.prepare(`
						SELECT content FROM context_file_revisions
						WHERE context_file_key = ? AND kind = 'source-snapshot'
						ORDER BY created_at DESC
						LIMIT 1
					`).get(file.key) as { content?: string } | undefined)?.content
					: undefined);
				return {
					key: file.key,
					managedPath: file.managed_path,
					workingContent,
					sourceContent,
					restoreManagedFile: !fileExists && (file.working_content !== null || activeContent !== undefined),
				};
			});

			if (hasManualOnlyRevisionSchema) {
				this.db.exec("DROP INDEX IF EXISTS idx_context_file_revisions_key");
				if (this.tableExists("context_file_manual_revisions")) {
					if (!this.hasColumns("context_file_manual_revisions", MANUAL_REVISION_COLUMNS)) {
						throw new Error("Context Files metadata has an unsupported context_file_manual_revisions table shape");
					}
					this.db.exec(`
						INSERT OR IGNORE INTO context_file_manual_revisions (
							id, context_file_key, name, content_hash, content, created_at, actor_id
						)
						SELECT id, context_file_key, name, content_hash, content, created_at, actor_id
						FROM context_file_revisions;
						DROP TABLE context_file_revisions;
					`);
				} else {
					this.db.exec("ALTER TABLE context_file_revisions RENAME TO context_file_manual_revisions");
				}
				this.db.exec(`
					CREATE INDEX IF NOT EXISTS idx_context_file_manual_revisions_key
						ON context_file_manual_revisions(context_file_key, created_at DESC);
				`);
			}

			this.ensureAutomaticRevisionTable();
			this.ensureManualRevisionTable();
			if (hasAutomaticRevisionSchema && revisionColumns.has("name")) {
				this.db.exec(`
					INSERT OR IGNORE INTO context_file_manual_revisions (
						id, context_file_key, name, content_hash, content, created_at, actor_id
					)
					SELECT id, context_file_key, name, content_hash, content, created_at, actor_id
					FROM context_file_revisions
					WHERE name IS NOT NULL;
				`);
			}
			for (const file of recovered) {
				this.db.prepare(`
					UPDATE context_files
					SET active_revision_id = NULL, working_content = ?, source_content = ?
					WHERE key = ?
				`).run(file.workingContent, file.sourceContent ?? null, file.key);
			}
			const migratedAt = new Date().toISOString();
			this.db.prepare(`
				INSERT INTO context_file_store_meta (key, value) VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`).run(CONTEXT_FILE_SCHEMA_VERSION_KEY, CONTEXT_FILE_SCHEMA_VERSION);
			this.db.prepare(`
				INSERT INTO context_file_store_meta (key, value) VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`).run(MANUAL_REVISION_MIGRATION_KEY, migratedAt);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}

		for (const file of recovered) {
			if (!file.restoreManagedFile) continue;
			mkdirSync(dirname(file.managedPath), { recursive: true });
			writeFileSync(file.managedPath, file.workingContent, "utf8");
		}
	}

	private migrateLegacyStore(): void {
		if (!this.legacyStorePath) return;
		const count = this.db.prepare("SELECT COUNT(*) AS count FROM context_files").get() as { count: number };
		if (Number(count.count) > 0) return;

		const legacyStore = readLegacyManagedStore(this.legacyStorePath);
		if (legacyStore.files.length === 0) return;

		this.db.exec("BEGIN");
		try {
			for (const file of legacyStore.files) {
				const resolvedPath = resolve(file.path);
				const fileExists = existsSync(resolvedPath);
				const createdAt = fileExists
					? statSync(resolvedPath).mtime.toISOString()
					: new Date().toISOString();
				const workingContent = fileExists ? readFileSync(resolvedPath, "utf8") : "";
				this.db
					.prepare(`
						INSERT INTO context_files (
							key,
							label,
							managed_path,
							scope,
							source_type,
							agent_profile_name,
							active_revision_id,
							working_content,
							source_ref,
							source_hash,
							source_content,
							created_at,
							updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					`)
					.run(
						file.key,
						file.label,
						resolvedPath,
						file.scope,
						"managed",
						file.agentProfileName ?? null,
						null,
						workingContent,
						null,
						null,
						null,
						createdAt,
						createdAt,
					);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
}

export function hashContextFileContent(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function splitLines(content: string): string[] {
	return content.split("\n");
}

export function buildContextFileDiff(baseContent: string, targetContent: string): ContextFileDiffChunk[] {
	const baseLines = splitLines(baseContent);
	const targetLines = splitLines(targetContent);
	const rows = baseLines.length;
	const cols = targetLines.length;
	const lcs: number[][] = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

	for (let left = rows - 1; left >= 0; left -= 1) {
		for (let right = cols - 1; right >= 0; right -= 1) {
			lcs[left][right] = baseLines[left] === targetLines[right]
				? lcs[left + 1][right + 1] + 1
				: Math.max(lcs[left + 1][right], lcs[left][right + 1]);
		}
	}

	const chunks: ContextFileDiffChunk[] = [];
	let left = 0;
	let right = 0;
	while (left < rows && right < cols) {
		if (baseLines[left] === targetLines[right]) {
			pushDiffChunk(chunks, "equal", baseLines[left]);
			left += 1;
			right += 1;
			continue;
		}
		if (lcs[left + 1][right] >= lcs[left][right + 1]) {
			pushDiffChunk(chunks, "remove", baseLines[left]);
			left += 1;
			continue;
		}
		pushDiffChunk(chunks, "add", targetLines[right]);
		right += 1;
	}
	while (left < rows) {
		pushDiffChunk(chunks, "remove", baseLines[left]);
		left += 1;
	}
	while (right < cols) {
		pushDiffChunk(chunks, "add", targetLines[right]);
		right += 1;
	}
	return chunks;
}

function pushDiffChunk(chunks: ContextFileDiffChunk[], type: ContextFileDiffChunk["type"], line: string): void {
	const previous = chunks[chunks.length - 1];
	if (previous && previous.type === type) {
		previous.lines.push(line);
		return;
	}
	chunks.push({ type, lines: [line] });
}
