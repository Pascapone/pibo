import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";
import { ChatWorkflowDraftStore, ChatWorkflowLifecycleEventStore, ChatWorkflowPromptAssetStore } from "../dist/apps/chat/workflow-persistence.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";

test("project service uses shared app storage and lists historical owner projects", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-shared-app-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const defaultA = service.ensureSharedDefaultProject({ projectFolder: join(tempRoot, "default") });
		const defaultB = service.ensureSharedDefaultProject({ projectFolder: join(tempRoot, "ignored-default") });
		assert.equal(defaultA.id, defaultB.id);
		assert.equal("ownerScope" in defaultA, false);
		assert.equal(defaultA.name, "Shared Project");
		assert.equal(defaultA.metadata.default, true);

		const created = service.createProject({
			name: "Shared Feature Project",
			projectFolder: join(tempRoot, "shared-feature"),
			createFolder: true,
		});
		assert.equal("ownerScope" in created, false);

		const db = new DatabaseSync(service.path);
		try {
			db.exec("ALTER TABLE projects ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app'");
			db.prepare(`INSERT INTO projects (id, owner_scope, name, description, project_folder, configuration_status, metadata_json, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 'configured', '{}', ?, ?)`).run(
				"prj_historical_user",
				"user:historical",
				"Historical User Project",
				null,
				join(tempRoot, "historical-user"),
				"2026-05-30T00:00:00.000Z",
				"2026-05-30T00:00:00.000Z",
			);
		} finally {
			db.close();
		}

		const projects = service.listProjects();
		assert.deepEqual(projects.map((project) => project.name).sort(), ["Historical User Project", "Shared Feature Project", "Shared Project"]);
		assert.equal("ownerScope" in service.requireProject("prj_historical_user"), false);
		const renamedHistorical = service.updateProject("prj_historical_user", { name: "Historical Project Renamed" });
		assert.equal(renamedHistorical?.name, "Historical Project Renamed");
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project and workflow UI stores migrate historical owner columns to app-global rows", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-ownerless-migration-"));
	try {
		const projectsPath = join(tempRoot, "web-projects.sqlite");
		const projectsDb = new DatabaseSync(projectsPath);
		try {
			projectsDb.exec(`
				CREATE TABLE projects (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, project_folder TEXT NOT NULL, configuration_status TEXT NOT NULL, current_main_session_id TEXT, archived_at TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
				CREATE TABLE project_sessions (project_id TEXT NOT NULL, pibo_session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, workflow_id TEXT NOT NULL, workflow_version TEXT, workflow_run_id TEXT, parent_main_session_id TEXT, title TEXT, state TEXT, configuration_json TEXT, retry_count INTEGER, max_retries INTEGER, archived INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
				CREATE TABLE project_workflow_session_snapshots (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, project_id TEXT NOT NULL, pibo_session_id TEXT NOT NULL, workflow_id TEXT NOT NULL, workflow_version TEXT NOT NULL, base_definition_hash TEXT NOT NULL, effective_definition_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
			`);
			projectsDb.prepare("INSERT INTO projects (id, owner_scope, name, description, project_folder, configuration_status, current_main_session_id, archived_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 'configured', NULL, NULL, '{}', ?, ?)").run("prj_legacy", "user:legacy", "Legacy Project", join(tempRoot, "legacy-project"), "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
			projectsDb.prepare("INSERT INTO project_sessions (project_id, pibo_session_id, kind, workflow_id, workflow_version, archived, created_at, updated_at) VALUES (?, ?, 'main', ?, ?, 0, ?, ?)").run("prj_legacy", "ps_legacy", "legacy-workflow", "1.0.0", "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
			const snapshot = { id: "wfs_legacy", schemaVersion: 1, createdAt: "2026-05-30T00:00:00.000Z", createdBy: "legacy-user", ownerScope: "user:legacy", projectId: "prj_legacy", piboSessionId: "ps_legacy", workflow: { id: "legacy-workflow", version: "1.0.0", source: "ui", tags: [], baseDefinitionHash: "sha256:base", effectiveDefinitionHash: "sha256:effective" }, baseDefinition: {}, effectiveDefinition: {}, inputValues: {}, promptOverrides: {}, promptAssetPins: [], validation: {}, deletedDefinitionFallback: { workflowId: "legacy-workflow", workflowVersion: "1.0.0", effectiveDefinitionHash: "sha256:effective" } };
			projectsDb.prepare("INSERT INTO project_workflow_session_snapshots (id, schema_version, project_id, pibo_session_id, workflow_id, workflow_version, base_definition_hash, effective_definition_hash, snapshot_json, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)").run(snapshot.id, snapshot.projectId, snapshot.piboSessionId, snapshot.workflow.id, snapshot.workflow.version, snapshot.workflow.baseDefinitionHash, snapshot.workflow.effectiveDefinitionHash, JSON.stringify(snapshot), snapshot.createdAt);
		} finally {
			projectsDb.close();
		}

		const projectService = new ChatProjectService(projectsPath);
		try {
			const projectColumns = new Set(projectService["db"].prepare("PRAGMA table_info(projects)").all().map((column) => column.name));
			assert.equal(projectColumns.has("owner_scope"), false);
			assert.equal("ownerScope" in projectService.requireProject("prj_legacy"), false);
			assert.equal("ownerScope" in projectService.getWorkflowSessionSnapshot("wfs_legacy"), false);
			const storedSnapshot = projectService["db"].prepare("SELECT snapshot_json FROM project_workflow_session_snapshots WHERE id = ?").get("wfs_legacy");
			assert.equal("ownerScope" in JSON.parse(storedSnapshot.snapshot_json), false);
		} finally {
			projectService.close();
		}

		const dataStorePath = join(tempRoot, "pibo.sqlite");
		const workflowDb = new DatabaseSync(dataStorePath);
		try {
			workflowDb.exec(`
				CREATE TABLE workflow_ui_drafts (draft_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, owner_scope TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, base_workflow_id TEXT, base_workflow_version TEXT, base_definition_hash TEXT, target_workflow_version TEXT, version_intent TEXT NOT NULL, definition_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, validation_json TEXT, validation_state TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
				CREATE TABLE workflow_prompt_assets (asset_id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, source TEXT NOT NULL, display_name TEXT NOT NULL, description TEXT, active_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
				CREATE TABLE workflow_prompt_asset_revisions (revision_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, owner_scope TEXT NOT NULL, content_hash TEXT NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT, based_on_revision_id TEXT);
				CREATE TABLE workflow_lifecycle_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, owner_scope TEXT NOT NULL, actor_id TEXT, workflow_id TEXT, workflow_version TEXT, draft_id TEXT, project_id TEXT, pibo_session_id TEXT, workflow_run_id TEXT, status TEXT, validation_json TEXT, diagnostics_json TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
			`);
			workflowDb.prepare("INSERT INTO workflow_ui_drafts (draft_id, workflow_id, owner_scope, source, status, version_intent, definition_json, diagnostics_json, validation_state, revision, created_at, updated_at) VALUES (?, ?, ?, 'ui', 'draft', 'patch', '{}', '[]', 'unknown', 1, ?, ?)").run("draft_legacy", "workflow_legacy", "user:legacy", "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
			workflowDb.prepare("INSERT INTO workflow_prompt_assets (asset_id, owner_scope, source, display_name, active_revision_id, created_at, updated_at) VALUES (?, ?, 'ui', ?, ?, ?, ?)").run("ui.promptAssets.legacy", "user:legacy", "Legacy Prompt", "wpar_legacy", "2026-05-30T00:00:00.000Z", "2026-05-30T00:00:00.000Z");
			workflowDb.prepare("INSERT INTO workflow_prompt_asset_revisions (revision_id, asset_id, owner_scope, content_hash, markdown, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("wpar_legacy", "ui.promptAssets.legacy", "user:legacy", "sha256:legacy", "# Legacy", "2026-05-30T00:00:00.000Z");
			workflowDb.prepare("INSERT INTO workflow_lifecycle_events (id, type, owner_scope, actor_id, diagnostics_json, created_at) VALUES (?, ?, ?, ?, '[]', ?)").run("wfle_legacy", "workflow.draft.saved", "user:legacy", "legacy-user", "2026-05-30T00:00:00.000Z");
		} finally {
			workflowDb.close();
		}

		const dataStore = new PiboDataStore(dataStorePath);
		try {
			const draftStore = new ChatWorkflowDraftStore(dataStore);
			const promptAssetStore = new ChatWorkflowPromptAssetStore(dataStore);
			const lifecycleStore = new ChatWorkflowLifecycleEventStore(dataStore);
			for (const table of ["workflow_ui_drafts", "workflow_prompt_assets", "workflow_prompt_asset_revisions", "workflow_lifecycle_events"]) {
				const columns = new Set(dataStore.db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
				assert.equal(columns.has("owner_scope"), false, `${table}.owner_scope should be removed`);
			}
			assert.equal("ownerScope" in draftStore.getDraft("draft_legacy"), false);
			assert.equal("ownerScope" in promptAssetStore.getAsset("ui.promptAssets.legacy"), false);
			assert.equal("ownerScope" in promptAssetStore.getActiveRevision("ui.promptAssets.legacy"), false);
			assert.equal("ownerScope" in lifecycleStore.listEvents({})[0], false);
		} finally {
			dataStore.close();
		}
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project workflow session records persist selection metadata before runs start", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-record-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			name: "Workflow Record Project",
			projectFolder: join(tempRoot, "project"),
			createFolder: true,
		});

		const configuration = {
			inputValues: { topic: "Persist configuration" },
			promptOverrides: { agent: "Use the persisted session prompt." },
			promptOverrideEligibleNodeIds: ["agent"],
			overrideScopes: {
				promptOverrides: "eligible_agent_node",
				model: "workflow",
				thinkingLevel: "workflow",
				fastMode: "workflow",
			},
			model: { provider: "openai", id: "gpt-5.1" },
			thinkingLevel: "low",
			fastMode: false,
		};
		const configured = service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_configured_workflow",
			kind: "main",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			title: "Configured Standard Project",
			state: "configured",
			configuration,
		});

		assert.equal(configured.projectId, project.id);
		assert.equal(configured.piboSessionId, "ps_configured_workflow");
		assert.equal(configured.title, "Configured Standard Project");
		assert.equal(configured.workflowId, "standard-project");
		assert.equal(configured.workflowVersion, "1.0.0");
		assert.equal(configured.state, "configured");
		assert.deepEqual(configured.configuration, configuration);
		assert.deepEqual(service.getProjectSession("ps_configured_workflow")?.configuration, configuration);
		assert.equal(configured.workflowRunId, undefined);

		for (const state of ["running", "waiting", "completed", "failed", "cancelled"]) {
			const stored = service.addProjectSession({
				projectId: project.id,
				piboSessionId: `ps_${state}`,
				kind: "main",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				state,
			});
			assert.equal(stored.state, state);
		}

		assert.throws(() => service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_invalid_state",
			workflowId: "standard-project",
			state: "paused",
		}), /Unsupported project session state/);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project workflow session selection and configuration stay immutable after creation", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-immutable-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			name: "Workflow Immutable Project",
			projectFolder: join(tempRoot, "project"),
			createFolder: true,
		});
		const configuration = {
			inputValues: { topic: "Original topic" },
			promptOverrides: { agent: "Original prompt" },
			promptOverrideEligibleNodeIds: ["agent"],
			overrideScopes: {
				promptOverrides: "eligible_agent_node",
				model: "workflow",
				thinkingLevel: "workflow",
				fastMode: "workflow",
			},
			model: { provider: "openai", id: "gpt-5.1" },
			thinkingLevel: "low",
			fastMode: false,
		};
		service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			kind: "main",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			title: "Configured immutable workflow",
			state: "configured",
			configuration,
		});

		assert.throws(() => service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			workflowId: "other-workflow",
			workflowVersion: "1.0.0",
		}), /workflow session selection is immutable/);
		assert.throws(() => service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			workflowId: "standard-project",
			workflowVersion: "2.0.0",
		}), /workflow session selection is immutable/);
		assert.throws(() => service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			configuration: { ...configuration, inputValues: { topic: "Mutated topic" } },
		}), /workflow session configuration is immutable/);

		const renamed = service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			title: "Renamed immutable workflow",
		});
		assert.equal(renamed.title, "Renamed immutable workflow");
		assert.equal(renamed.workflowId, "standard-project");
		assert.equal(renamed.workflowVersion, "1.0.0");
		assert.deepEqual(renamed.configuration, configuration);

		const snapshot = {
			id: "wfs_immutable_start",
			schemaVersion: 1,
			createdAt: "2026-05-12T02:00:00.000Z",
			createdBy: "user-1",
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			workflow: {
				id: "standard-project",
				version: "1.0.0",
				source: "code",
				title: "Standard Project",
				tags: ["project"],
				baseDefinitionHash: "sha256:base",
				effectiveDefinitionHash: "sha256:effective",
			},
			baseDefinition: { id: "standard-project", version: "1.0.0", nodes: {} },
			effectiveDefinition: { id: "standard-project", version: "1.0.0", nodes: {} },
			inputValues: configuration.inputValues,
			promptOverrides: configuration.promptOverrides,
			overridePolicy: {
				promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
				eligiblePromptNodeIds: ["agent"],
				modelScope: "workflow",
				thinkingLevelScope: "workflow",
				fastModeScope: "workflow",
			},
			model: configuration.model,
			thinkingLevel: configuration.thinkingLevel,
			fastMode: configuration.fastMode,
			promptAssetPins: [],
			validation: { trigger: "before_project_session_creation", ok: true, validatedAt: "2026-05-12T02:00:00.000Z" },
			deletedDefinitionFallback: {
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				effectiveDefinitionHash: "sha256:effective",
			},
		};
		service.saveWorkflowSessionSnapshot(snapshot);
		assert.throws(() => service.startWorkflowSessionRun({
			projectId: project.id,
			piboSessionId: "ps_immutable_workflow",
			runId: "wfr_wrong_version",
			workflowId: "standard-project",
			workflowVersion: "2.0.0",
			snapshotId: snapshot.id,
			effectiveDefinitionHash: snapshot.workflow.effectiveDefinitionHash,
			current: { status: "running" },
			inputValues: snapshot.inputValues,
		}), /workflow session selection is immutable/);
		assert.equal(service.listProjectWorkflowRuns({ piboSessionId: "ps_immutable_workflow" }).length, 0);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project workflow session snapshots persist configuration and effective definitions", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-snapshot-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			name: "Workflow Snapshot Project",
			projectFolder: join(tempRoot, "project"),
			createFolder: true,
		});
		service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_snapshot_workflow",
			kind: "main",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			state: "configured",
		});

		const snapshot = {
			id: "wfs_project_service",
			schemaVersion: 1,
			createdAt: "2026-05-12T00:00:00.000Z",
			createdBy: "user-1",
			projectId: project.id,
			piboSessionId: "ps_snapshot_workflow",
			workflow: {
				id: "standard-project",
				version: "1.0.0",
				source: "code",
				title: "Standard Project",
				tags: ["project"],
				baseDefinitionHash: "sha256:base",
				effectiveDefinitionHash: "sha256:effective",
			},
			baseDefinition: { id: "standard-project", version: "1.0.0", nodes: { agent: { promptTemplate: "Base" } } },
			effectiveDefinition: { id: "standard-project", version: "1.0.0", nodes: { agent: { promptTemplate: "Override" } } },
			inputValues: { topic: "Snapshots" },
			promptOverrides: { agent: "Override" },
			overridePolicy: {
				promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
				eligiblePromptNodeIds: ["agent"],
				modelScope: "workflow",
				thinkingLevelScope: "workflow",
				fastModeScope: "workflow",
			},
			model: { provider: "openai", id: "gpt-5.1" },
			thinkingLevel: "low",
			fastMode: false,
			promptAssetPins: [],
			validation: { trigger: "before_project_session_creation", ok: true, validatedAt: "2026-05-12T00:00:00.000Z" },
			deletedDefinitionFallback: {
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				effectiveDefinitionHash: "sha256:effective",
			},
		};

		const saved = service.saveWorkflowSessionSnapshot(snapshot);
		assert.deepEqual(saved, snapshot);
		assert.deepEqual(service.getWorkflowSessionSnapshot("wfs_project_service"), snapshot);
		assert.deepEqual(service.getWorkflowSessionSnapshotForSession("ps_snapshot_workflow"), snapshot);
		assert.throws(() => service.saveWorkflowSessionSnapshot({
			...snapshot,
			id: "wfs_second_snapshot",
		}), /already has a configuration snapshot/);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project workflow start creates one run per configured session", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-start-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			name: "Workflow Start Project",
			projectFolder: join(tempRoot, "project"),
			createFolder: true,
		});
		service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_start_workflow",
			kind: "main",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			state: "configured",
		});

		const snapshot = {
			id: "wfs_start_once",
			schemaVersion: 1,
			createdAt: "2026-05-12T01:00:00.000Z",
			createdBy: "user-1",
			projectId: project.id,
			piboSessionId: "ps_start_workflow",
			workflow: {
				id: "standard-project",
				version: "1.0.0",
				source: "code",
				title: "Standard Project",
				tags: ["project"],
				baseDefinitionHash: "sha256:base",
				effectiveDefinitionHash: "sha256:effective",
			},
			baseDefinition: { id: "standard-project", version: "1.0.0", initial: ["draft", "review"], nodes: {} },
			effectiveDefinition: { id: "standard-project", version: "1.0.0", initial: ["draft", "review"], nodes: {} },
			inputValues: { topic: "Parallel start" },
			promptOverrides: {},
			overridePolicy: {
				promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
				eligiblePromptNodeIds: [],
				modelScope: "workflow",
				thinkingLevelScope: "workflow",
				fastModeScope: "workflow",
			},
			promptAssetPins: [],
			validation: { trigger: "before_project_session_creation", ok: true, validatedAt: "2026-05-12T01:00:00.000Z" },
			deletedDefinitionFallback: {
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				effectiveDefinitionHash: "sha256:effective",
			},
		};
		service.saveWorkflowSessionSnapshot(snapshot);

		const first = service.startWorkflowSessionRun({
			projectId: project.id,
			piboSessionId: "ps_start_workflow",
			runId: "wfr_first",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			snapshotId: snapshot.id,
			effectiveDefinitionHash: snapshot.workflow.effectiveDefinitionHash,
			current: { status: "running", initialNodeIds: ["draft", "review"] },
			inputValues: snapshot.inputValues,
			validation: { trigger: "before_workflow_start", ok: true },
		});
		assert.equal(first.alreadyStarted, false);
		assert.equal(first.projectSession.state, "running");
		assert.equal(first.projectSession.workflowRunId, "wfr_first");
		assert.deepEqual(first.run.current.initialNodeIds, ["draft", "review"]);

		const second = service.startWorkflowSessionRun({
			projectId: project.id,
			piboSessionId: "ps_start_workflow",
			runId: "wfr_second",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
			snapshotId: snapshot.id,
			effectiveDefinitionHash: snapshot.workflow.effectiveDefinitionHash,
			current: { status: "running", initialNodeIds: ["other"] },
			inputValues: {},
		});
		assert.equal(second.alreadyStarted, true);
		assert.equal(second.run.id, "wfr_first");
		assert.equal(second.projectSession.workflowRunId, "wfr_first");
		assert.deepEqual(second.run.current.initialNodeIds, ["draft", "review"]);
		assert.equal(service.listProjectWorkflowRuns({ piboSessionId: "ps_start_workflow" }).length, 1);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("project sessions can link back to workflow run ids", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-link-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			name: "Workflow Link Project",
			projectFolder: join(tempRoot, "project"),
			createFolder: true,
		});
		service.addProjectSession({
			projectId: project.id,
			piboSessionId: "ps_project_main",
			kind: "main",
			workflowId: "simple-chat",
			title: "Main project session",
		});

		const linked = service.linkWorkflowRunSession({
			projectId: project.id,
			piboSessionId: "ps_project_child",
			workflowRunId: "wfr_project_child",
			workflowId: "workflow.prd-review",
			workflowVersion: "2.1.0",
			parentMainSessionId: "ps_project_main",
			title: "Workflow child session",
		});

		assert.equal(linked.projectId, project.id);
		assert.equal(linked.piboSessionId, "ps_project_child");
		assert.equal(linked.kind, "sub");
		assert.equal(linked.workflowId, "workflow.prd-review");
		assert.equal(linked.workflowVersion, "2.1.0");
		assert.equal(linked.workflowRunId, "wfr_project_child");
		assert.equal(linked.parentMainSessionId, "ps_project_main");
		assert.equal(linked.state, "workflow");
		assert.equal(service.requireProject(project.id).currentMainSessionId, "ps_project_main");
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
