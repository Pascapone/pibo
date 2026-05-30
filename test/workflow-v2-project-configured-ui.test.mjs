import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readAppSource() {
	return (await Promise.all([
		"../src/apps/chat-ui/src/App.tsx",
		"../src/apps/chat-ui/src/projects/ProjectWorkflowPanels.tsx",
		"../src/apps/chat-ui/src/projects/ProjectsAreaModel.ts",
	].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")))).join("\n");
}

test("Project workflow configured-session UI exposes review, start, and empty run-history state", async () => {
	const source = await readAppSource();

	assert.match(source, /Create workflow Project session/);
	assert.match(source, /Save configured session/);
	assert.match(source, /Configured\/not-started/);
	assert.match(source, /Ready to start workflow/);
	assert.match(source, /Start workflow/);
	assert.match(source, /Workflow/);
	assert.match(source, /version \{projectSession\.workflowVersion\}/);
	assert.match(source, /Configuration summary/);
	assert.match(source, /Validation state/);
	assert.match(source, /Run history/);
	assert.match(source, /No current run attempts/);
});

test("Project workflow blocked create and start diagnostics expose actionable links", async () => {
	const source = await readAppSource();

	assert.match(source, /ProjectWorkflowSessionCreate\.missingWorkflowVersion/);
	assert.match(source, /Create-blocking diagnostics/);
	assert.match(source, /Start-blocking diagnostics/);
	assert.match(source, /diagnostic\.path/);
	assert.match(source, /diagnostic\.nodeId/);
	assert.match(source, /diagnostic\.edgeId/);
	assert.match(source, /diagnostic\.registryRef/);
	assert.match(source, /diagnostic\.hint/);
});
