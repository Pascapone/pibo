import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readWorkflowsAreaSource() {
	return readFile(new URL("../src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx", import.meta.url), "utf8");
}

test("Workflow Library renders source/status action metadata from catalog actions", async () => {
	const source = await readWorkflowsAreaSource();

	assert.match(source, /WorkflowCatalogActionList/);
	assert.match(source, /aria-label="Workflow Library source\/status actions"/);
	assert.match(source, /hasWorkflowCatalogAction\(record, "create_next_draft"\)/);
	assert.match(source, /hasWorkflowCatalogAction\(record, "duplicate"\)/);
	assert.match(source, /hasWorkflowCatalogAction\(record, "create_project_session"\)/);
	assert.match(source, /hasWorkflowCatalogAction\(record, "archive"\)/);
	assert.match(source, /hasWorkflowCatalogAction\(record, "delete"\)/);
	assert.match(source, /Create Project session/);
	assert.match(source, /workflowCatalogActionLabel/);
	assert.doesNotMatch(source, /record\.source === "ui"/);
});
