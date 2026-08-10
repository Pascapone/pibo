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

			CREATE TABLE IF NOT EXISTS context_file_store_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
		this.ensureColumn("context_files", "working_content", "TEXT");
		this.ensureColumn("context_files", "source_content", "TEXT");
		this.migrateManualRevisionStorage();
		this.migrateLegacyStore();
	}

	listFiles(): StoredContextFileRecord[] {
		const rows = this.db.prepare("SELECT * FROM context_files ORDER BY updated_at DESC").all() as ContextFileRow[];
		return rows.map(fileRowToRecord);
	}

	getFile(key: string): StoredContextFileRecord | undefined {
		const row = this.db.prepare("SELECT * FROM context_files WHERE key = ?").get(key) as ContextFileRow | undefined;
		return row ? fileRowToRecord(row) : undefined;
	}

	createFile(input: CreateStoredContextFileInput): StoredContextFileRecord {
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
		this.db.exec("BEGIN");
		try {
			this.db.prepare("DELETE FROM context_file_revisions WHERE context_file_key = ?").run(key);
			this.db.prepare("DELETE FROM context_files WHERE key = ?").run(key);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	appendRevision(input: AppendRevisionInput): StoredContextFileRevisionRecord {
		const id = `rev_${randomUUID()}`;
		const createdAt = input.createdAt ?? new Date().toISOString();
		this.db
			.prepare(`
				INSERT INTO context_file_revisions (
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
		const row = this.db.prepare("SELECT * FROM context_file_revisions WHERE id = ?").get(id) as ContextFileRevisionRow | undefined;
		return row ? revisionRowToRecord(row) : undefined;
	}

	listRevisions(contextFileKey: string): StoredContextFileRevisionRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM context_file_revisions WHERE context_file_key = ? ORDER BY created_at DESC")
			.all(contextFileKey) as ContextFileRevisionRow[];
		return rows.map(revisionRowToRecord);
	}

	close(): void {
		this.db.close();
	}

	private ensureColumn(table: string, column: string, type: string): void {
		const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
		if (columns.some((candidate) => candidate.name === column)) return;
		this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
	}

	private tableExists(table: string): boolean {
		return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
	}

	private ensureManualRevisionTable(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS context_file_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				name TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_context_file_revisions_key
				ON context_file_revisions(context_file_key, created_at DESC);
		`);
	}

	private migrateManualRevisionStorage(): void {
		const migrationKey = "manual-revisions-v1";
		const migrated = this.db.prepare("SELECT 1 FROM context_file_store_meta WHERE key = ?").get(migrationKey);
		if (migrated) {
			this.ensureManualRevisionTable();
			return;
		}

		const revisionTableExists = this.tableExists("context_file_revisions");
		const revisionColumns = revisionTableExists
			? new Set((this.db.prepare("PRAGMA table_info(context_file_revisions)").all() as Array<{ name: string }>).map((column) => column.name))
			: new Set<string>();
		const hasAutomaticRevisionSchema = revisionColumns.has("kind");
		const files = this.db.prepare(`
			SELECT key, managed_path, active_revision_id, working_content, source_content
			FROM context_files
		`).all() as RevisionStorageMigrationRow[];
		const recovered = files.map((file) => {
			const fileExists = existsSync(file.managed_path);
			const activeContent = !fileExists && hasAutomaticRevisionSchema && file.active_revision_id
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

			if (!fileExists && (file.working_content !== null || activeContent !== undefined)) {
				mkdirSync(dirname(file.managed_path), { recursive: true });
				writeFileSync(file.managed_path, workingContent, "utf8");
			}
			return { key: file.key, workingContent, sourceContent };
		});

		this.db.exec("BEGIN");
		try {
			for (const file of recovered) {
				this.db.prepare(`
					UPDATE context_files
					SET active_revision_id = NULL, working_content = ?, source_content = ?
					WHERE key = ?
				`).run(file.workingContent, file.sourceContent ?? null, file.key);
			}
			if (hasAutomaticRevisionSchema) {
				this.db.exec("DROP TABLE context_file_revisions");
			}
			this.ensureManualRevisionTable();
			this.db.prepare("INSERT INTO context_file_store_meta (key, value) VALUES (?, ?)").run(migrationKey, new Date().toISOString());
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
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
