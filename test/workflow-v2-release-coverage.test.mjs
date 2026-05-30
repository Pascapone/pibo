import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readProjectUiSourceBundle() {
	return (await Promise.all([
		"src/apps/chat-ui/src/App.tsx",
		"src/apps/chat-ui/src/projects/ProjectWorkflowPanels.tsx",
		"src/apps/chat-ui/src/projects/ProjectsAreaModel.ts",
		"src/apps/chat-ui/src/projects/ProjectsSidebar.tsx",
		"src/apps/chat-ui/src/projects/project-session-workflow.tsx",
		"src/apps/chat-ui/src/session-node.tsx",
	].map(readSource))).join("\n");
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

function assertMatches(source, pattern, label) {
	assert.match(source, pattern, label);
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assertMatches(source, pattern, label);
	}
}

test("Workflow V2 release unit coverage maps registry, diagnostics, versions, archive, and delete", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const validationTests = await readSource("packages/workflows/src/testing/validation.test.ts");
	const publishedVersionTests = await readSource("packages/workflows/src/testing/workflow-published-versions.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["source/status record values are unit-tested", /defines workflow source\/status values and rejects conflated UI entity records/],
		["draft, published, archive, and tombstone entities are unit-tested", /stores identity, draft, published version, archive, and tombstone records as separate entities/],
		["invalid draft persistence is unit-tested", /persists partial invalid UI drafts and enforces one active draft per workflow identity/],
		["snapshot preservation after tombstone is unit-tested", /records delete tombstones without removing historical definition snapshots/],
	]);
	assertAllMatch(validationTests, [
		["shared diagnostic grouping is unit-tested", /groups V2 diagnostics by workflow, node, edge, schema path, state path, registry ref, and severity/],
		["missing registry refs are unit-tested", /registryRef === "profile\.missing"/],
		["incompatible edge diagnostics are unit-tested", /WorkflowGraphError\.incompatibleEdgePorts/],
	]);
	assertAllMatch(publishedVersionTests, [
		["published definition hashing is unit-tested", /stores immutable published versions with definition hashes/],
		["published version immutability is unit-tested", /rejects attempts to replace an existing published definition body/],
	]);
	assertAllMatch(webChannelTests, [
		["catalog API source/status actions are integration-tested", /workflow catalog list and inspect APIs expose source\/status, diagnostics, and archive filtering/],
		["draft publish lifecycle API is integration-tested", /workflow catalog lifecycle APIs create, validate, publish, and expose version resources/],
		["patch, minor, and major version bumps are integration-tested", /workflow draft publish allocates patch, minor, and major versions/],
		["archive lifecycle API is integration-tested", /workflow archive API applies at workflow identity scope and hides archived workflows from selection/],
		["delete lifecycle API is integration-tested", /workflow delete API tombstones UI workflows while preserving Project snapshots/],
	]);
});

test("Workflow V2 release integration coverage maps Project workflow snapshots and start gates", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(webChannelTests, [
		["Project workflow selection and delayed start are tested", /chat web app creates configured Project workflow sessions and starts one workflow run explicitly/],
		["published workflow picker selection is asserted", /option\.id === "standard-project" && option\.version === "1\.0\.0"/],
		["configured sessions have no run before explicit start", /createdPayload\.projectSession\.workflowRunId, undefined/],
		["base and effective snapshot hashes are asserted", /createdPayload\.snapshot\.workflow\.baseDefinitionHash[\s\S]*createdPayload\.snapshot\.workflow\.effectiveDefinitionHash/],
		["workflow selection immutability is asserted", /Project workflow selection and configuration are immutable/],
		["one-run enforcement is asserted", /secondStartPayload\.alreadyStarted, true/],
		["start validation is asserted", /startValidationPayload\.validation\.trigger, "before_workflow_start"/],
		["blocked start validation diagnostics are asserted", /project\.workflow_start\.blocked[\s\S]*WorkflowGraphError\.unknownAgentProfileRef/],
		["unsupported workflow session creation inputs are rejected", /chat web app rejects unsupported Project workflow session creation inputs/],
	]);
});

test("Workflow V2 release UI coverage maps Builder, routing, and human action surfaces", async () => {
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const appSource = await readProjectUiSourceBundle();
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");

	assertAllMatch(workflowsAreaSource, [
		["duplicate to draft action is rendered", /Duplicate to draft/],
		["edit published action is rendered", /Edit published/],
		["validate action is wired through the builder panel", /Validate draft/],
		["publish action is rendered", /Publish draft/],
		["raw IR invalid warning code is surfaced", /WorkflowBuilderWarning\.invalidRawIrText/],
		["raw IR editor preserves invalid text for repair", /Invalid JSON or non-object text returns a warning diagnostic and keeps the last valid draft object unchanged/],
		["missing picker refs render diagnostics", /WorkflowInspectorPickerDiagnostics/],
		["incompatible edge adapter dialog is rendered", /Open compatible edge adapter dialog/],
		["incompatible edges require registered adapters", /not directly compatible[\s\S]*Select a registered adapter instead of hidden LLM coercion or inline transformation code/],
	]);
	assertAllMatch(appSource, [
		["Project routing chooses workflow view for main and nested workflow sessions", /workflowSessionKind === "main_workflow" \|\| workflowSessionKind === "nested_workflow"/],
		["Project routing keeps agent node and subagent sessions in Terminal", /workflowSessionKind === "agent_node" \|\| workflowSessionKind === "subagent"[\s\S]*return \{ viewId: "terminal" \}/],
		["Project UI exposes configured workflow Start", /Start workflow/],
	]);
	assertAllMatch(workflowViewSource, [
		["human action API submission is wired from the Workflow view", /postProjectWorkflowHumanAction/],
		["human wait-token action buttons are rendered", /aria-label="Workflow wait token actions"/],
		["human action diagnostics render near the controls", /aria-label="Human action diagnostics"/],
		["human action area stays separate from Terminal chat controls", /stays separate from normal Terminal chat controls/],
	]);
});
