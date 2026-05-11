import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../../../core/pibo-home.js";

export type PiboProjectWorkflowId = "simple-chat" | "standard-project" | string;
export type PiboProjectSessionKind = "main" | "sub";

export type PiboProject = {
	id: string;
	ownerScope: string;
	name: string;
	description?: string;
	projectFolder: string;
	configurationStatus: "configured";
	currentMainSessionId?: string;
	archivedAt?: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type PiboProjectSession = {
	projectId: string;
	piboSessionId: string;
	kind: PiboProjectSessionKind;
	workflowId: PiboProjectWorkflowId;
	workflowRunId?: string;
	parentMainSessionId?: string;
	title?: string;
	state?: string;
	retryCount?: number;
	maxRetries?: number;
	archived?: boolean;
	createdAt: string;
	updatedAt: string;
};

export type CreateProjectInput = {
	ownerScope: string;
	name: string;
	description?: string;
	projectFolder: string;
	createFolder?: boolean;
};

export class ChatProjectService {
	readonly path: string;
	private readonly db: DatabaseSync;

	constructor(path = piboHomePath("web-projects.sqlite")) {
		this.path = resolve(path);
		mkdirSync(dirname(this.path), { recursive: true });
		this.db = new DatabaseSync(this.path);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec("PRAGMA journal_mode = WAL");
		this.applySchema();
	}

	close(): void {
		this.db.close();
	}

	ensurePersonalProject(input: { ownerScope: string; projectFolder?: string }): PiboProject {
		const id = personalProjectId(input.ownerScope);
		const existing = this.getProject(id, { includeArchived: true });
		if (existing) return existing;
		const folder = resolve(input.projectFolder ?? piboHomePath("projects/workspace"));
		mkdirSync(folder, { recursive: true });
		const now = new Date().toISOString();
		this.db.prepare(`INSERT INTO projects (id, owner_scope, name, description, project_folder, configuration_status, metadata_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'configured', ?, ?, ?)`).run(id, input.ownerScope, "Personal Chat", null, folder, JSON.stringify({ personal: true }), now, now);
		return this.requireProject(id);
	}

	listProjects(options: { includeArchived?: boolean } = {}): PiboProject[] {
		const rows = this.db.prepare(`SELECT * FROM projects WHERE json_extract(metadata_json, '$.personal') IS NOT 1 ${options.includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY lower(name), created_at`).all() as ProjectRow[];
		return rows.map(projectFromRow);
	}

	getProject(id: string, options: { includeArchived?: boolean } = {}): PiboProject | undefined {
		const row = this.db.prepare(`SELECT * FROM projects WHERE id = ? ${options.includeArchived ? "" : "AND archived_at IS NULL"}`).get(id) as ProjectRow | undefined;
		return row ? projectFromRow(row) : undefined;
	}

	requireProject(id: string, options: { includeArchived?: boolean } = {}): PiboProject {
		const project = this.getProject(id, options);
		if (!project) throw new Error("Project not found");
		return project;
	}

	createProject(input: CreateProjectInput): PiboProject {
		const name = normalizeProjectName(input.name);
		const projectFolder = resolve(normalizeProjectFolder(input.projectFolder));
		this.assertNameAvailable(name);
		this.assertFolderAvailable(projectFolder);
		if (input.createFolder) mkdirSync(projectFolder, { recursive: true });
		const now = new Date().toISOString();
		const id = `prj_${randomUUID()}`;
		this.db.prepare(`INSERT INTO projects (id, owner_scope, name, description, project_folder, configuration_status, metadata_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'configured', ?, ?, ?)`).run(id, input.ownerScope, name, normalizeOptionalString(input.description) ?? null, projectFolder, "{}", now, now);
		return this.requireProject(id);
	}

	updateProject(id: string, input: { name?: string; description?: string | null; archived?: boolean }): PiboProject | undefined {
		const existing = this.getProject(id, { includeArchived: true });
		if (!existing) return undefined;
		const name = input.name === undefined ? existing.name : normalizeProjectName(input.name);
		if (name !== existing.name) this.assertNameAvailable(name, id);
		const description = input.description === undefined ? existing.description : normalizeOptionalString(input.description ?? undefined);
		const archivedAt = input.archived === undefined ? existing.archivedAt : input.archived ? (existing.archivedAt ?? new Date().toISOString()) : undefined;
		const now = new Date().toISOString();
		this.db.prepare(`UPDATE projects SET name = ?, description = ?, archived_at = ?, updated_at = ? WHERE id = ?`).run(name, description ?? null, archivedAt ?? null, now, id);
		return this.getProject(id, { includeArchived: true });
	}

	deleteProject(id: string, options: { confirmName: string; deleteFiles?: boolean }): { deletedProjectId: string } {
		const project = this.requireProject(id, { includeArchived: true });
		if (!project.archivedAt) throw new Error("Archive the project before permanently deleting it.");
		if (options.confirmName !== project.name) throw new Error(`Type \"${project.name}\" to permanently delete this project.`);
		this.db.prepare("DELETE FROM project_sessions WHERE project_id = ?").run(id);
		this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
		if (options.deleteFiles) rmSync(project.projectFolder, { recursive: true, force: true });
		return { deletedProjectId: id };
	}

	listProjectSessions(projectId: string, options: { includeArchived?: boolean } = {}): PiboProjectSession[] {
		const rows = this.db.prepare(`SELECT * FROM project_sessions WHERE project_id = ? ${options.includeArchived ? "" : "AND archived = 0"} ORDER BY created_at`).all(projectId) as ProjectSessionRow[];
		return rows.map(projectSessionFromRow);
	}

	getProjectSession(piboSessionId: string): PiboProjectSession | undefined {
		const row = this.db.prepare("SELECT * FROM project_sessions WHERE pibo_session_id = ?").get(piboSessionId) as ProjectSessionRow | undefined;
		return row ? projectSessionFromRow(row) : undefined;
	}

	addProjectSession(input: { projectId: string; piboSessionId: string; kind?: PiboProjectSessionKind; workflowId?: PiboProjectWorkflowId; workflowRunId?: string; parentMainSessionId?: string; title?: string; state?: string }): PiboProjectSession {
		const now = new Date().toISOString();
		const kind = input.kind ?? "main";
		this.db.prepare(`INSERT INTO project_sessions (project_id, pibo_session_id, kind, workflow_id, workflow_run_id, parent_main_session_id, title, state, archived, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
			ON CONFLICT(pibo_session_id) DO UPDATE SET project_id = excluded.project_id, kind = excluded.kind, workflow_id = excluded.workflow_id, workflow_run_id = COALESCE(excluded.workflow_run_id, workflow_run_id), parent_main_session_id = excluded.parent_main_session_id, title = excluded.title, state = COALESCE(excluded.state, state), updated_at = excluded.updated_at`)
			.run(input.projectId, input.piboSessionId, kind, input.workflowId ?? "simple-chat", input.workflowRunId ?? null, input.parentMainSessionId ?? null, input.title ?? null, input.state ?? "simple_chat", now, now);
		if (kind === "main") {
			this.db.prepare("UPDATE projects SET current_main_session_id = ?, updated_at = ? WHERE id = ?").run(input.piboSessionId, now, input.projectId);
		}
		return this.getProjectSession(input.piboSessionId)!;
	}

	linkWorkflowRunSession(input: { projectId: string; piboSessionId: string; workflowRunId: string; workflowId: PiboProjectWorkflowId; parentMainSessionId?: string; title?: string }): PiboProjectSession {
		return this.addProjectSession({
			projectId: input.projectId,
			piboSessionId: input.piboSessionId,
			kind: input.parentMainSessionId ? "sub" : "main",
			workflowId: input.workflowId,
			workflowRunId: input.workflowRunId,
			parentMainSessionId: input.parentMainSessionId,
			title: input.title,
			state: "workflow",
		});
	}

	setProjectSessionArchived(piboSessionId: string, archived: boolean): PiboProjectSession | undefined {
		const now = new Date().toISOString();
		this.db.prepare("UPDATE project_sessions SET archived = ?, updated_at = ? WHERE pibo_session_id = ?").run(archived ? 1 : 0, now, piboSessionId);
		return this.getProjectSession(piboSessionId);
	}

	private applySchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				project_folder TEXT NOT NULL,
				configuration_status TEXT NOT NULL DEFAULT 'configured',
				current_main_session_id TEXT,
				archived_at TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS projects_name_unique ON projects (lower(name));
			CREATE UNIQUE INDEX IF NOT EXISTS projects_folder_unique ON projects (project_folder);
			CREATE TABLE IF NOT EXISTS project_sessions (
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				pibo_session_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL DEFAULT 'main',
				workflow_id TEXT NOT NULL DEFAULT 'simple-chat',
				workflow_run_id TEXT,
				parent_main_session_id TEXT,
				title TEXT,
				state TEXT,
				retry_count INTEGER,
				max_retries INTEGER,
				archived INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS project_sessions_project_id_idx ON project_sessions(project_id, archived, created_at);
		`);
	}

	private assertNameAvailable(name: string, exceptId?: string): void {
		const existing = this.db.prepare("SELECT id FROM projects WHERE lower(name) = lower(?) AND (? IS NULL OR id != ?)").get(name, exceptId ?? null, exceptId ?? null) as { id: string } | undefined;
		if (existing) throw new Error("Project name already exists");
	}

	private assertFolderAvailable(folder: string, exceptId?: string): void {
		const existing = this.db.prepare("SELECT id FROM projects WHERE project_folder = ? AND (? IS NULL OR id != ?)").get(folder, exceptId ?? null, exceptId ?? null) as { id: string } | undefined;
		if (existing) throw new Error("Project folder already exists");
	}
}

type ProjectRow = {
	id: string;
	owner_scope: string;
	name: string;
	description: string | null;
	project_folder: string;
	configuration_status: "configured";
	current_main_session_id: string | null;
	archived_at: string | null;
	metadata_json: string;
	created_at: string;
	updated_at: string;
};

type ProjectSessionRow = {
	project_id: string;
	pibo_session_id: string;
	kind: PiboProjectSessionKind;
	workflow_id: string;
	workflow_run_id: string | null;
	parent_main_session_id: string | null;
	title: string | null;
	state: string | null;
	retry_count: number | null;
	max_retries: number | null;
	archived: number;
	created_at: string;
	updated_at: string;
};

function projectFromRow(row: ProjectRow): PiboProject {
	return {
		id: row.id,
		ownerScope: row.owner_scope,
		name: row.name,
		...(row.description ? { description: row.description } : {}),
		projectFolder: row.project_folder,
		configurationStatus: "configured",
		...(row.current_main_session_id ? { currentMainSessionId: row.current_main_session_id } : {}),
		...(row.archived_at ? { archivedAt: row.archived_at } : {}),
		metadata: safeJsonObject(row.metadata_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function projectSessionFromRow(row: ProjectSessionRow): PiboProjectSession {
	return {
		projectId: row.project_id,
		piboSessionId: row.pibo_session_id,
		kind: row.kind,
		workflowId: row.workflow_id,
		...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
		...(row.parent_main_session_id ? { parentMainSessionId: row.parent_main_session_id } : {}),
		...(row.title ? { title: row.title } : {}),
		...(row.state ? { state: row.state } : {}),
		...(row.retry_count !== null ? { retryCount: row.retry_count } : {}),
		...(row.max_retries !== null ? { maxRetries: row.max_retries } : {}),
		archived: row.archived === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function normalizeProjectName(value: unknown): string {
	if (typeof value !== "string") throw new Error("Project name is required");
	const name = value.replace(/\s+/g, " ").trim();
	if (!name) throw new Error("Project name is required");
	if (name.length > 120) throw new Error("Project name is too long");
	return name;
}

function normalizeProjectFolder(value: unknown): string {
	if (typeof value !== "string") throw new Error("Project folder is required");
	let folder = value.trim();
	if (!folder) throw new Error("Project folder is required");
	if (folder === "~") folder = process.env.HOME ?? folder;
	else if (folder.startsWith("~/")) folder = `${process.env.HOME ?? ""}${folder.slice(1)}`;
	if (!isAbsolute(folder)) throw new Error("Project folder must be an absolute path, e.g. ~/code/my-project or /home/me/code/my-project");
	return folder;
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error("Value must be a string");
	const text = value.trim();
	return text || undefined;
}

function safeJsonObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

export function personalProjectId(ownerScope: string): string {
	return `personal_${Buffer.from(ownerScope).toString("base64url")}`;
}
