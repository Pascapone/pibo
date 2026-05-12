import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../../../core/pibo-home.js";
import type { PiboJsonObject } from "../../../core/events.js";
import type { ModelProfile } from "../../../core/profiles.js";
import type { PiboThinkingLevel } from "../../../core/thinking.js";

export type PiboProjectWorkflowId = "simple-chat" | "standard-project" | string;
export type PiboProjectSessionKind = "main" | "sub";
export type PiboProjectWorkflowSessionState = "configured" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type PiboProjectLegacySessionState = "simple_chat" | "workflow";
export type PiboProjectSessionState = PiboProjectWorkflowSessionState | PiboProjectLegacySessionState;

export type PiboProjectWorkflowSessionConfiguration = {
	inputValues: PiboJsonObject;
	promptOverrides: Record<string, string>;
	promptOverrideEligibleNodeIds: string[];
	overrideScopes: {
		promptOverrides: "eligible_agent_node";
		model: "workflow";
		thinkingLevel: "workflow";
		fastMode: "workflow";
	};
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
};

export type PiboProjectWorkflowPromptAssetPin = {
	assetId: string;
	revisionId: string;
	contentHash: string;
	source: "code" | "ui";
};

export type PiboProjectWorkflowSessionSnapshot = {
	id: string;
	schemaVersion: 1;
	createdAt: string;
	createdBy: string;
	ownerScope: string;
	projectId: string;
	piboSessionId: string;
	workflow: {
		id: PiboProjectWorkflowId;
		version: string;
		source: "code" | "ui";
		title?: string;
		description?: string;
		tags: string[];
		baseDefinitionHash: string;
		effectiveDefinitionHash: string;
	};
	baseDefinition: PiboJsonObject;
	effectiveDefinition: PiboJsonObject;
	inputValues: PiboJsonObject;
	promptOverrides: Record<string, string>;
	overridePolicy: {
		promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate";
		eligiblePromptNodeIds: string[];
		modelScope: "workflow";
		thinkingLevelScope: "workflow";
		fastModeScope: "workflow";
	};
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
	promptAssetPins: PiboProjectWorkflowPromptAssetPin[];
	validation: PiboJsonObject;
	deletedDefinitionFallback: {
		title?: string;
		workflowId: PiboProjectWorkflowId;
		workflowVersion: string;
		effectiveDefinitionHash: string;
		tombstoneLabel?: string;
	};
};

export type PiboProjectWorkflowRunStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";

export type PiboProjectWorkflowRun = {
	id: string;
	projectId: string;
	piboSessionId: string;
	workflowId: PiboProjectWorkflowId;
	workflowVersion: string;
	snapshotId: string;
	effectiveDefinitionHash: string;
	status: PiboProjectWorkflowRunStatus;
	current: PiboJsonObject;
	inputValues: PiboJsonObject;
	validation?: PiboJsonObject;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	failedAt?: string;
	cancelledAt?: string;
};

export type StartProjectWorkflowRunResult = {
	projectSession: PiboProjectSession;
	run: PiboProjectWorkflowRun;
	alreadyStarted: boolean;
};

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
	workflowVersion?: string;
	workflowRunId?: string;
	parentMainSessionId?: string;
	title?: string;
	state?: PiboProjectSessionState;
	configuration?: PiboProjectWorkflowSessionConfiguration;
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

	addProjectSession(input: { projectId: string; piboSessionId: string; kind?: PiboProjectSessionKind; workflowId?: PiboProjectWorkflowId; workflowVersion?: string; workflowRunId?: string; parentMainSessionId?: string; title?: string; state?: PiboProjectSessionState; configuration?: PiboProjectWorkflowSessionConfiguration }): PiboProjectSession {
		const now = new Date().toISOString();
		const kind = input.kind ?? "main";
		const state = normalizeProjectSessionState(input.state);
		this.db.prepare(`INSERT INTO project_sessions (project_id, pibo_session_id, kind, workflow_id, workflow_version, workflow_run_id, parent_main_session_id, title, state, configuration_json, archived, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
			ON CONFLICT(pibo_session_id) DO UPDATE SET project_id = excluded.project_id, kind = excluded.kind, workflow_id = excluded.workflow_id, workflow_version = COALESCE(excluded.workflow_version, workflow_version), workflow_run_id = COALESCE(excluded.workflow_run_id, workflow_run_id), parent_main_session_id = excluded.parent_main_session_id, title = excluded.title, state = COALESCE(excluded.state, state), configuration_json = COALESCE(excluded.configuration_json, configuration_json), updated_at = excluded.updated_at`)
			.run(input.projectId, input.piboSessionId, kind, input.workflowId ?? "simple-chat", normalizeOptionalString(input.workflowVersion) ?? null, input.workflowRunId ?? null, input.parentMainSessionId ?? null, input.title ?? null, state, serializeProjectSessionConfiguration(input.configuration), now, now);
		if (kind === "main") {
			this.db.prepare("UPDATE projects SET current_main_session_id = ?, updated_at = ? WHERE id = ?").run(input.piboSessionId, now, input.projectId);
		}
		return this.getProjectSession(input.piboSessionId)!;
	}

	linkWorkflowRunSession(input: { projectId: string; piboSessionId: string; workflowRunId: string; workflowId: PiboProjectWorkflowId; workflowVersion?: string; parentMainSessionId?: string; title?: string }): PiboProjectSession {
		return this.addProjectSession({
			projectId: input.projectId,
			piboSessionId: input.piboSessionId,
			kind: input.parentMainSessionId ? "sub" : "main",
			workflowId: input.workflowId,
			workflowVersion: input.workflowVersion,
			workflowRunId: input.workflowRunId,
			parentMainSessionId: input.parentMainSessionId,
			title: input.title,
			state: "workflow",
		});
	}

	saveWorkflowSessionSnapshot(snapshot: PiboProjectWorkflowSessionSnapshot): PiboProjectWorkflowSessionSnapshot {
		const existing = this.getWorkflowSessionSnapshot(snapshot.id);
		if (existing) {
			if (existing.piboSessionId !== snapshot.piboSessionId || existing.workflow.effectiveDefinitionHash !== snapshot.workflow.effectiveDefinitionHash) {
				throw new Error("Workflow session snapshots are immutable");
			}
			return existing;
		}
		const existingForSession = this.getWorkflowSessionSnapshotForSession(snapshot.piboSessionId);
		if (existingForSession) throw new Error(`Project workflow session '${snapshot.piboSessionId}' already has a configuration snapshot`);
		this.db.prepare(`INSERT INTO project_workflow_session_snapshots (id, schema_version, project_id, pibo_session_id, workflow_id, workflow_version, base_definition_hash, effective_definition_hash, snapshot_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			snapshot.id,
			snapshot.schemaVersion,
			snapshot.projectId,
			snapshot.piboSessionId,
			snapshot.workflow.id,
			snapshot.workflow.version,
			snapshot.workflow.baseDefinitionHash,
			snapshot.workflow.effectiveDefinitionHash,
			JSON.stringify(snapshot),
			snapshot.createdAt,
		);
		return this.getWorkflowSessionSnapshot(snapshot.id)!;
	}

	getWorkflowSessionSnapshot(id: string): PiboProjectWorkflowSessionSnapshot | undefined {
		const row = this.db.prepare("SELECT * FROM project_workflow_session_snapshots WHERE id = ?").get(id) as ProjectWorkflowSessionSnapshotRow | undefined;
		return row ? workflowSessionSnapshotFromRow(row) : undefined;
	}

	getWorkflowSessionSnapshotForSession(piboSessionId: string): PiboProjectWorkflowSessionSnapshot | undefined {
		const row = this.db.prepare("SELECT * FROM project_workflow_session_snapshots WHERE pibo_session_id = ?").get(piboSessionId) as ProjectWorkflowSessionSnapshotRow | undefined;
		return row ? workflowSessionSnapshotFromRow(row) : undefined;
	}

	getProjectWorkflowRun(runId: string): PiboProjectWorkflowRun | undefined {
		const row = this.db.prepare("SELECT * FROM project_workflow_runs WHERE id = ?").get(runId) as ProjectWorkflowRunRow | undefined;
		return row ? projectWorkflowRunFromRow(row) : undefined;
	}

	getProjectWorkflowRunForSession(piboSessionId: string): PiboProjectWorkflowRun | undefined {
		const row = this.db.prepare("SELECT * FROM project_workflow_runs WHERE pibo_session_id = ?").get(piboSessionId) as ProjectWorkflowRunRow | undefined;
		return row ? projectWorkflowRunFromRow(row) : undefined;
	}

	listProjectWorkflowRuns(filter: { projectId?: string; piboSessionId?: string; limit?: number } = {}): PiboProjectWorkflowRun[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (filter.projectId) {
			clauses.push("project_id = ?");
			values.push(filter.projectId);
		}
		if (filter.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(filter.piboSessionId);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
		const rows = this.db.prepare(`SELECT * FROM project_workflow_runs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values, limit) as ProjectWorkflowRunRow[];
		return rows.map(projectWorkflowRunFromRow);
	}

	startWorkflowSessionRun(input: {
		projectId: string;
		piboSessionId: string;
		runId: string;
		workflowId: PiboProjectWorkflowId;
		workflowVersion: string;
		snapshotId: string;
		effectiveDefinitionHash: string;
		current: PiboJsonObject;
		inputValues: PiboJsonObject;
		validation?: PiboJsonObject;
	}): StartProjectWorkflowRunResult {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const existingSessionRow = this.db.prepare("SELECT * FROM project_sessions WHERE pibo_session_id = ?").get(input.piboSessionId) as ProjectSessionRow | undefined;
			if (!existingSessionRow || existingSessionRow.project_id !== input.projectId) throw new Error("Project workflow session not found");

			if (existingSessionRow.workflow_run_id) {
				const existingRun = this.getProjectWorkflowRun(existingSessionRow.workflow_run_id)
					?? this.insertProjectWorkflowRunForExistingSession(existingSessionRow, input);
				this.db.exec("COMMIT");
				return {
					projectSession: projectSessionFromRow(existingSessionRow),
					run: existingRun,
					alreadyStarted: true,
				};
			}

			const now = new Date().toISOString();
			const run: PiboProjectWorkflowRun = {
				id: input.runId,
				projectId: input.projectId,
				piboSessionId: input.piboSessionId,
				workflowId: input.workflowId,
				workflowVersion: input.workflowVersion,
				snapshotId: input.snapshotId,
				effectiveDefinitionHash: input.effectiveDefinitionHash,
				status: "running",
				current: input.current,
				inputValues: input.inputValues,
				...(input.validation ? { validation: input.validation } : {}),
				createdAt: now,
				updatedAt: now,
			};
			this.insertProjectWorkflowRun(run);
			this.db.prepare("UPDATE project_sessions SET workflow_run_id = ?, state = 'running', updated_at = ? WHERE pibo_session_id = ? AND workflow_run_id IS NULL")
				.run(run.id, now, input.piboSessionId);
			const updatedSessionRow = this.db.prepare("SELECT * FROM project_sessions WHERE pibo_session_id = ?").get(input.piboSessionId) as ProjectSessionRow;
			this.db.exec("COMMIT");
			return {
				projectSession: projectSessionFromRow(updatedSessionRow),
				run,
				alreadyStarted: false,
			};
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	setProjectSessionArchived(piboSessionId: string, archived: boolean): PiboProjectSession | undefined {
		const now = new Date().toISOString();
		this.db.prepare("UPDATE project_sessions SET archived = ?, updated_at = ? WHERE pibo_session_id = ?").run(archived ? 1 : 0, now, piboSessionId);
		return this.getProjectSession(piboSessionId);
	}

	private insertProjectWorkflowRunForExistingSession(row: ProjectSessionRow, input: {
		workflowId: PiboProjectWorkflowId;
		workflowVersion: string;
		snapshotId: string;
		effectiveDefinitionHash: string;
		current: PiboJsonObject;
		inputValues: PiboJsonObject;
		validation?: PiboJsonObject;
	}): PiboProjectWorkflowRun {
		const now = new Date().toISOString();
		const run: PiboProjectWorkflowRun = {
			id: row.workflow_run_id!,
			projectId: row.project_id,
			piboSessionId: row.pibo_session_id,
			workflowId: row.workflow_id,
			workflowVersion: row.workflow_version ?? input.workflowVersion,
			snapshotId: input.snapshotId,
			effectiveDefinitionHash: input.effectiveDefinitionHash,
			status: normalizeWorkflowRunStatus(row.state) ?? "running",
			current: input.current,
			inputValues: input.inputValues,
			...(input.validation ? { validation: input.validation } : {}),
			createdAt: row.updated_at ?? now,
			updatedAt: row.updated_at ?? now,
		};
		this.insertProjectWorkflowRun(run);
		return run;
	}

	private insertProjectWorkflowRun(run: PiboProjectWorkflowRun): void {
		this.db.prepare(`INSERT INTO project_workflow_runs (
			id,
			project_id,
			pibo_session_id,
			workflow_id,
			workflow_version,
			snapshot_id,
			effective_definition_hash,
			status,
			current_json,
			input_json,
			validation_json,
			created_at,
			updated_at,
			completed_at,
			failed_at,
			cancelled_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			run.id,
			run.projectId,
			run.piboSessionId,
			run.workflowId,
			run.workflowVersion,
			run.snapshotId,
			run.effectiveDefinitionHash,
			run.status,
			JSON.stringify(run.current),
			JSON.stringify(run.inputValues),
			run.validation ? JSON.stringify(run.validation) : null,
			run.createdAt,
			run.updatedAt,
			run.completedAt ?? null,
			run.failedAt ?? null,
			run.cancelledAt ?? null,
		);
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
				workflow_version TEXT,
				workflow_run_id TEXT,
				parent_main_session_id TEXT,
				title TEXT,
				state TEXT,
				configuration_json TEXT,
				retry_count INTEGER,
				max_retries INTEGER,
				archived INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS project_sessions_project_id_idx ON project_sessions(project_id, archived, created_at);
			CREATE TABLE IF NOT EXISTS project_workflow_session_snapshots (
				id TEXT PRIMARY KEY,
				schema_version INTEGER NOT NULL,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				pibo_session_id TEXT NOT NULL REFERENCES project_sessions(pibo_session_id) ON DELETE CASCADE,
				workflow_id TEXT NOT NULL,
				workflow_version TEXT NOT NULL,
				base_definition_hash TEXT NOT NULL,
				effective_definition_hash TEXT NOT NULL,
				snapshot_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE(pibo_session_id)
			);
			CREATE INDEX IF NOT EXISTS project_workflow_session_snapshots_project_idx ON project_workflow_session_snapshots(project_id, created_at);
			CREATE TABLE IF NOT EXISTS project_workflow_runs (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
				pibo_session_id TEXT NOT NULL REFERENCES project_sessions(pibo_session_id) ON DELETE CASCADE,
				workflow_id TEXT NOT NULL,
				workflow_version TEXT NOT NULL,
				snapshot_id TEXT NOT NULL REFERENCES project_workflow_session_snapshots(id) ON DELETE RESTRICT,
				effective_definition_hash TEXT NOT NULL,
				status TEXT NOT NULL,
				current_json TEXT NOT NULL,
				input_json TEXT NOT NULL,
				validation_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				failed_at TEXT,
				cancelled_at TEXT,
				UNIQUE(pibo_session_id)
			);
			CREATE INDEX IF NOT EXISTS project_workflow_runs_project_idx ON project_workflow_runs(project_id, created_at);
			CREATE INDEX IF NOT EXISTS project_workflow_runs_session_idx ON project_workflow_runs(pibo_session_id);
		`);
		this.ensureProjectSessionWorkflowVersionColumn();
		this.ensureProjectSessionConfigurationColumn();
	}

	private ensureProjectSessionWorkflowVersionColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(project_sessions)").all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === "workflow_version")) {
			this.db.exec("ALTER TABLE project_sessions ADD COLUMN workflow_version TEXT");
		}
	}

	private ensureProjectSessionConfigurationColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(project_sessions)").all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === "configuration_json")) {
			this.db.exec("ALTER TABLE project_sessions ADD COLUMN configuration_json TEXT");
		}
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
	workflow_version: string | null;
	workflow_run_id: string | null;
	parent_main_session_id: string | null;
	title: string | null;
	state: PiboProjectSessionState | null;
	configuration_json: string | null;
	retry_count: number | null;
	max_retries: number | null;
	archived: number;
	created_at: string;
	updated_at: string;
};

type ProjectWorkflowSessionSnapshotRow = {
	id: string;
	schema_version: number;
	project_id: string;
	pibo_session_id: string;
	workflow_id: string;
	workflow_version: string;
	base_definition_hash: string;
	effective_definition_hash: string;
	snapshot_json: string;
	created_at: string;
};

type ProjectWorkflowRunRow = {
	id: string;
	project_id: string;
	pibo_session_id: string;
	workflow_id: string;
	workflow_version: string;
	snapshot_id: string;
	effective_definition_hash: string;
	status: PiboProjectWorkflowRunStatus;
	current_json: string;
	input_json: string;
	validation_json: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	failed_at: string | null;
	cancelled_at: string | null;
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
	const configuration = safeWorkflowSessionConfiguration(row.configuration_json);
	return {
		projectId: row.project_id,
		piboSessionId: row.pibo_session_id,
		kind: row.kind,
		workflowId: row.workflow_id,
		...(row.workflow_version ? { workflowVersion: row.workflow_version } : {}),
		...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
		...(row.parent_main_session_id ? { parentMainSessionId: row.parent_main_session_id } : {}),
		...(row.title ? { title: row.title } : {}),
		...(row.state ? { state: row.state } : {}),
		...(configuration ? { configuration } : {}),
		...(row.retry_count !== null ? { retryCount: row.retry_count } : {}),
		...(row.max_retries !== null ? { maxRetries: row.max_retries } : {}),
		archived: row.archived === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function workflowSessionSnapshotFromRow(row: ProjectWorkflowSessionSnapshotRow): PiboProjectWorkflowSessionSnapshot {
	const snapshot = safeJsonObject(row.snapshot_json) as Partial<PiboProjectWorkflowSessionSnapshot>;
	return {
		...snapshot,
		id: row.id,
		schemaVersion: 1,
		projectId: row.project_id,
		piboSessionId: row.pibo_session_id,
		workflow: {
			...(snapshot.workflow ?? {}),
			id: row.workflow_id,
			version: row.workflow_version,
			baseDefinitionHash: row.base_definition_hash,
			effectiveDefinitionHash: row.effective_definition_hash,
			source: snapshot.workflow?.source ?? "code",
			tags: snapshot.workflow?.tags ?? [],
		},
		baseDefinition: isPlainJsonObject(snapshot.baseDefinition) ? snapshot.baseDefinition : {},
		effectiveDefinition: isPlainJsonObject(snapshot.effectiveDefinition) ? snapshot.effectiveDefinition : {},
		inputValues: isPlainJsonObject(snapshot.inputValues) ? snapshot.inputValues : {},
		promptOverrides: isStringRecord(snapshot.promptOverrides) ? snapshot.promptOverrides : {},
		overridePolicy: snapshot.overridePolicy ?? {
			promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
			eligiblePromptNodeIds: [],
			modelScope: "workflow",
			thinkingLevelScope: "workflow",
			fastModeScope: "workflow",
		},
		promptAssetPins: snapshot.promptAssetPins ?? [],
		validation: isPlainJsonObject(snapshot.validation) ? snapshot.validation : {},
		deletedDefinitionFallback: snapshot.deletedDefinitionFallback ?? {
			workflowId: row.workflow_id,
			workflowVersion: row.workflow_version,
			effectiveDefinitionHash: row.effective_definition_hash,
		},
		createdAt: typeof snapshot.createdAt === "string" ? snapshot.createdAt : row.created_at,
		createdBy: typeof snapshot.createdBy === "string" ? snapshot.createdBy : "unknown",
		ownerScope: typeof snapshot.ownerScope === "string" ? snapshot.ownerScope : "unknown",
		...(snapshot.model ? { model: snapshot.model } : {}),
		...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
		...(snapshot.fastMode !== undefined ? { fastMode: snapshot.fastMode } : {}),
	};
}

function projectWorkflowRunFromRow(row: ProjectWorkflowRunRow): PiboProjectWorkflowRun {
	return {
		id: row.id,
		projectId: row.project_id,
		piboSessionId: row.pibo_session_id,
		workflowId: row.workflow_id,
		workflowVersion: row.workflow_version,
		snapshotId: row.snapshot_id,
		effectiveDefinitionHash: row.effective_definition_hash,
		status: normalizeWorkflowRunStatus(row.status) ?? "running",
		current: safeJsonObject(row.current_json) as PiboJsonObject,
		inputValues: safeJsonObject(row.input_json) as PiboJsonObject,
		...(row.validation_json ? { validation: safeJsonObject(row.validation_json) as PiboJsonObject } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...(row.completed_at ? { completedAt: row.completed_at } : {}),
		...(row.failed_at ? { failedAt: row.failed_at } : {}),
		...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
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

const PROJECT_SESSION_STATES = new Set<PiboProjectSessionState>([
	"simple_chat",
	"workflow",
	"configured",
	"running",
	"waiting",
	"completed",
	"failed",
	"cancelled",
]);

function normalizeProjectSessionState(value: PiboProjectSessionState | undefined): PiboProjectSessionState {
	const state = value ?? "simple_chat";
	if (!PROJECT_SESSION_STATES.has(state)) throw new Error(`Unsupported project session state: ${state}`);
	return state;
}

function normalizeWorkflowRunStatus(value: PiboProjectSessionState | null | undefined): PiboProjectWorkflowRunStatus | undefined {
	if (value === "running" || value === "waiting" || value === "completed" || value === "failed" || value === "cancelled") return value;
	return undefined;
}

function serializeProjectSessionConfiguration(configuration: PiboProjectWorkflowSessionConfiguration | undefined): string | null {
	return configuration ? JSON.stringify(configuration) : null;
}

function safeWorkflowSessionConfiguration(value: string | null): PiboProjectWorkflowSessionConfiguration | undefined {
	if (!value) return undefined;
	const parsed = safeJsonObject(value);
	if (!parsed.inputValues || typeof parsed.inputValues !== "object" || Array.isArray(parsed.inputValues)) return undefined;
	if (!parsed.promptOverrides || typeof parsed.promptOverrides !== "object" || Array.isArray(parsed.promptOverrides)) return undefined;
	return parsed as PiboProjectWorkflowSessionConfiguration;
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

function isPlainJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
		&& Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

export function personalProjectId(ownerScope: string): string {
	return `personal_${Buffer.from(ownerScope).toString("base64url")}`;
}
