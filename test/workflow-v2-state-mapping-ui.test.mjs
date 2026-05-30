import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readWorkflowsAreaSource() {
	return readFile(new URL("../src/apps/chat-ui/src/workflows/WorkflowInspectorsPanel.tsx", import.meta.url), "utf8");
}

test("Workflow Builder exposes simple state mapping dropdown controls", async () => {
	const source = await readWorkflowsAreaSource();

	assert.match(source, /simple state mapping controls/);
	assert.match(source, /Read scope/);
	assert.match(source, /Read path/);
	assert.match(source, /Write scope/);
	assert.match(source, /Write path/);
	assert.match(source, /Add read/);
	assert.match(source, /Add write/);
	assert.match(source, /state\.reads/);
	assert.match(source, /state\.writes/);
	assert.match(source, /Complex state mapping DSLs remain raw Workflow IR only/);
});

test("Workflow Builder state edits stay in Pibo Workflow IR and run state validation", async () => {
	const source = await readWorkflowsAreaSource();

	assert.match(source, /Workflow global state fields/);
	assert.match(source, /Add global state field/);
	assert.match(source, /workflowSettingsStateChanged/);
	assert.match(source, /workflowNodeStateAccessChanged/);
	assert.match(source, /workflowStateAccessChanged\(edge\.state, form\.stateAccess\)/);
	assert.match(source, /"state_edit"/);
});
