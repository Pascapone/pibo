import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";

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
			parentMainSessionId: "ps_project_main",
			title: "Workflow child session",
		});

		assert.equal(linked.projectId, project.id);
		assert.equal(linked.piboSessionId, "ps_project_child");
		assert.equal(linked.kind, "sub");
		assert.equal(linked.workflowId, "workflow.prd-review");
		assert.equal(linked.workflowRunId, "wfr_project_child");
		assert.equal(linked.parentMainSessionId, "ps_project_main");
		assert.equal(linked.state, "workflow");
		assert.equal(service.requireProject(project.id).currentMainSessionId, "ps_project_main");
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
