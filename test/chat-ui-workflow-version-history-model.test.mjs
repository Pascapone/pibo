import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowVersionHistoryModelScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			groupWorkflowVersionHistory,
			hasWorkflowCatalogAction,
			workflowCatalogActionLabel,
			workflowHistoryStatusDescription,
		} from "./src/apps/chat-ui/src/workflows/workflow-version-history-model.ts";

		const editability = {
			canView: true,
			canDuplicate: true,
			canEditDraft: false,
			canCreateDraft: true,
			canValidate: false,
			canPublish: false,
			canArchive: true,
			canDelete: true,
			canCreateProjectSession: true,
		};

		function historyRecord(overrides) {
			return {
				id: overrides.id ?? "workflow.alpha",
				version: overrides.version ?? "1.0.0",
				title: overrides.title ?? "Alpha",
				description: overrides.description,
				source: overrides.source ?? "ui",
				status: overrides.status ?? "published",
				tags: overrides.tags ?? [],
				actions: overrides.actions ?? ["view"],
				editability: overrides.editability ?? editability,
			};
		}

		const groups = groupWorkflowVersionHistory([
			historyRecord({ id: "workflow.alpha", version: "0.9.0", title: "Alpha archived", source: "code", status: "archived" }),
			historyRecord({ id: "workflow.alpha", version: "1.0.0", title: "Alpha current", source: "ui", status: "published" }),
			historyRecord({ id: "workflow.beta", version: "1.0.0", title: "Beta", source: "code", status: "deleted" }),
		]);
		assert.deepEqual(groups.map((group) => group.workflowId), ["workflow.alpha", "workflow.beta"]);
		assert.equal(groups[0].title, "Alpha current");
		assert.equal(groups[0].source, "ui");
		assert.deepEqual(groups[0].records.map((record) => record.version), ["0.9.0", "1.0.0"]);
		assert.equal(groups[1].title, "Beta");

		assert.equal(hasWorkflowCatalogAction({ actions: ["view", "archive"] }, "archive"), true);
		assert.equal(hasWorkflowCatalogAction({ actions: ["view"] }, "delete"), false);
		assert.equal(workflowCatalogActionLabel("create_project_session"), "Create Project session");
		assert.equal(workflowCatalogActionLabel("create_next_draft"), "Create next draft");
		assert.match(workflowHistoryStatusDescription(historyRecord({ status: "published" })), /selectable for Project sessions/);
		assert.match(workflowHistoryStatusDescription(historyRecord({ status: "archived" })), /hidden from default Project session creation/);
		assert.match(workflowHistoryStatusDescription(historyRecord({ status: "deleted" })), /immutable snapshots/);
		assert.match(workflowHistoryStatusDescription(historyRecord({ status: "draft" })), /not published/);
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow version history model groups rows and exposes catalog copy helpers", async () => {
	const { stdout, stderr } = await runWorkflowVersionHistoryModelScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
