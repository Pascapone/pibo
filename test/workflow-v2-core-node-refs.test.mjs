import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readWorkflowUiSourceBundle() {
	return (await Promise.all([
		"src/apps/chat-ui/src/WorkflowsArea.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowBuilderNodeEditors.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowInspectorsPanel.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowRawIrEditor.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowPromptAssetEditor.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowVersionViewer.tsx",
	].map(readSource))).join("\n");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assert.match(source, pattern, label);
	}
}

test("Workflow V2 core node refs use registered pickers and separate workflow navigation", async () => {
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const chatApiSource = await readSource("src/apps/chat-ui/src/api-workflows.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const registryTests = await readSource("packages/workflows/src/testing/registry.test.ts");

	assertAllMatch(workflowsAreaSource, [
		["landing renders the Agent node editor", /<WorkflowBuilderAgentNodeEditor \/>/],
		["Agent nodes use the non-archived Agent Designer profile picker", /Select a non-archived Agent Designer profile/],
		["Agent node inspector edits promptTemplate on Pibo Workflow IR", /promptTemplate/],
		["landing renders the Code node editor", /<WorkflowBuilderCodeNodeEditor \/>/],
		["Code nodes select registered code handlers", /Registered code handler/],
		["Code nodes do not expose inline executable code", /never opens inline TypeScript, JavaScript, shell, or eval code/],
		["landing renders the Workflow node editor", /<WorkflowBuilderWorkflowNodeEditor \/>/],
		["Workflow nodes select published workflow versions", /Nested workflow version/],
		["Workflow nodes expose Open workflow navigation", /Open workflow/],
		["Nested workflow internals are not inline-expanded", /Nested workflow internals stay collapsed in the parent graph for V2/],
	]);

	assertAllMatch(chatApiSource, [
		["profile picker calls the authenticated workflow profiles route", /\/api\/chat\/workflows\/pickers\/profiles/],
		["handler picker calls the authenticated workflow handlers route", /\/api\/chat\/workflows\/pickers\/handlers/],
		["workflow-version picker calls the authenticated workflow versions route", /\/api\/chat\/workflows\/pickers\/workflow-versions/],
	]);

	assertAllMatch(webChannelTests, [
		["profile picker integration excludes archived agents", /workflow profile picker excludes archived custom agents and reports archived refs/],
		["handler picker integration lists only registered handler refs", /workflow handler picker lists registered handlers and reports missing refs/],
		["workflow-version picker integration lists published workflow refs", /workflow version picker lists published nested workflow refs and reports missing refs/],
		["missing nested workflow refs produce structured diagnostics", /WorkflowCatalogError\.unknownWorkflowVersion/],
	]);

	assertAllMatch(registryTests, [
		["code handler refs validate against the registry", /validates code node handler refs against the Workflow Registry when one is provided/],
		["Agent profile refs validate against the registry", /validates fixed Agent Designer profile refs against the Workflow Registry when one is provided/],
		["archived Agent profile refs are rejected", /rejects archived Agent Designer profile refs when the Workflow Registry marks them archived/],
	]);
});
