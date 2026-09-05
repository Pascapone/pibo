import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readWorkflowsAreaSource() {
	return readFile(new URL("../src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx", import.meta.url), "utf8");
}

test("Workflow Library renders deliberate archive and delete confirmation copy", async () => {
	const source = await readWorkflowsAreaSource();

	assert.match(source, /WorkflowLifecycleConfirmationPanel/);
	assert.match(source, /aria-label=\{`\$\{isDelete \? "Delete" : "Archive"\} workflow confirmation`\}/);
	assert.match(source, /Archiving applies to the whole workflow identity/);
	assert.match(source, /hides this workflow from the default catalog and new Workflow Session choices/);
	assert.match(source, /Published versions stay available only through archive filters and historical run links/);
	assert.match(source, /historical Workflow Runs continue to render from their snapshots/);
	assert.match(source, /Deleting tombstones the live workflow identity/);
	assert.match(source, /removes this workflow from the default catalog, workflow pickers, duplicate\/edit\/publish\/archive actions, and new Workflow Session creation/);
	assert.match(source, /Historical Workflow Runs remain inspectable from immutable snapshots/);
	assert.match(source, /definition-deleted state/);
	assert.match(source, /Type the workflow id to confirm delete/);
});

test("Workflow Library delete confirmation requires typing the workflow id", async () => {
	const source = await readWorkflowsAreaSource();

	assert.doesNotMatch(source, /window\.prompt/);
	assert.match(source, /deleteConfirmationMatches = deleteConfirmWorkflowId\.trim\(\) === target\.workflowId/);
	assert.match(source, /disabled=\{busy \|\| \(isDelete && !deleteConfirmationMatches\)\}/);
	assert.match(source, /confirmWorkflowId: deleteConfirmWorkflowId/);
});
