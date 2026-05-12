import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";

test("project workflow session records persist selection metadata before runs start", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-record-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			ownerScope: "user:workflow-record",
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

test("project workflow session snapshots persist configuration and effective definitions", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-snapshot-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			ownerScope: "user:workflow-snapshot",
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
			ownerScope: "user:workflow-snapshot",
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

test("project sessions can link back to workflow run ids", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-workflow-link-"));
	const service = new ChatProjectService(join(tempRoot, "web-projects.sqlite"));

	try {
		const project = service.createProject({
			ownerScope: "user:workflow-link",
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
