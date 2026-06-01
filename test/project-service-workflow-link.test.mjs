import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";

test("project service uses app-global storage and lists projects", () => {
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

		const second = service.createProject({
			name: "Second Shared Project",
			projectFolder: join(tempRoot, "second-shared"),
			createFolder: true,
		});
		assert.equal("ownerScope" in second, false);

		const projects = service.listProjects();
		assert.deepEqual(projects.map((project) => project.name).sort(), ["Second Shared Project", "Shared Feature Project", "Shared Project"]);
		assert.equal("ownerScope" in service.requireProject(second.id), false);
		const renamedSecond = service.updateProject(second.id, { name: "Second Project Renamed" });
		assert.equal(renamedSecond?.name, "Second Project Renamed");
	} finally {
		service.close();
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
