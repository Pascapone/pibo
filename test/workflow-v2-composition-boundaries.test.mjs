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

test("Workflow V2 composition boundary tests cover registered node and picker paths", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const registryTests = await readSource("packages/workflows/src/testing/registry.test.ts");
	const runtimeMixedNodeTests = await readSource("packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();

	assertAllMatch(runtimeMixedNodeTests, [
		["mixed workflow execution covers code, agent, human, adapter, and nested workflow nodes", /dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes/],
	]);

	assertAllMatch(registryTests, [
		["code handler refs validate against the registry", /validates code node handler refs against the Workflow Registry when one is provided/],
		["Agent Designer profile refs validate against the registry", /validates fixed Agent Designer profile refs against the Workflow Registry when one is provided/],
		["archived Agent Designer profile refs are rejected", /rejects archived Agent Designer profile refs when the Workflow Registry marks them archived/],
		["edge adapter refs validate against the registry", /validates edge adapter refs against the Workflow Registry when one is provided/],
		["visible adapter node refs validate against the registry", /validates visible adapter node refs against the Workflow Registry when one is provided/],
		["human action refs validate against the registry", /validates human action refs against the Workflow Registry when one is provided/],
	]);

	assertAllMatch(webChannelTests, [
		["profile picker integration excludes archived agents", /workflow profile picker excludes archived custom agents and reports archived refs/],
		["handler picker integration lists registered handler refs", /workflow handler picker lists registered handlers and reports missing refs/],
		["guard and adapter picker integration lists registered refs", /workflow guard and adapter pickers list registered refs and report missing refs/],
		["human action picker integration lists registered action refs", /workflow human action and prompt asset pickers list registered refs and report missing refs/],
		["nested workflow picker integration lists published workflow refs", /workflow version picker lists published nested workflow refs and reports missing refs/],
		["positive composition patch keeps registered guard and edge adapter validation green", /const secureDefinition = \{[\s\S]*guard: \{ handler: "fixture\.guards\.approved"[\s\S]*params: \{ expected: true \}[\s\S]*transform: \{ kind: "adapter"[\s\S]*params: \{ format: "compact" \}[\s\S]*validPatchPayload\.validation\.ok, true/],
		["invalid params are integration-tested for guard and adapter refs", /invalidParamsDefinition[\s\S]*WorkflowGraphError\.unexpectedAdapterParams[\s\S]*WorkflowGraphError\.invalidGuardParams[\s\S]*WorkflowGraphError\.invalidAdapterParams/],
		["edge adapter output compatibility is integration-tested", /incompatibleAdapterOutputDefinition[\s\S]*WorkflowGraphError\.incompatibleEdgeAdapterOutput/],
		["missing registered refs are integration-tested", /WorkflowGraphError\.unknownAgentProfileRef[\s\S]*WorkflowGraphError\.unknownHandlerRef[\s\S]*WorkflowGraphError\.unknownAdapterRef[\s\S]*WorkflowGraphError\.unknownGuardRef[\s\S]*WorkflowGraphError\.unknownHumanActionRef[\s\S]*WorkflowCatalogError\.unknownWorkflowVersion/],
		["incompatible edges without adapters are rejected", /WorkflowGraphError\.incompatibleEdgePorts/],
		["inline executable paths are rejected", /WorkflowSecurityError\.inlineExecutableCode/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["builder exposes registered adapter node insertion", /Add Adapter node/],
		["adapter nodes select registered adapter refs", /Registered adapter ref[\s\S]*Select a registered adapter ref/],
		["edge inspector edits typed source and target ports", /Source port id[\s\S]*Target port id/],
		["edge inspector selects registered guard and edge adapter refs", /Guard ref[\s\S]*guardPicker\?\.options[\s\S]*Edge adapter ref[\s\S]*adapterPicker\?\.options/],
		["guard params editor is gated by paramsSchema", /selectedGuardOption\?\.paramsSchema[\s\S]*Guard params JSON/],
		["edge adapter params editor is gated by paramsSchema", /selectedAdapterOption\?\.paramsSchema[\s\S]*Edge adapter params JSON/],
		["compatible edge dialog previews typed port schemas", /From schema[\s\S]*To schema[\s\S]*These ports are not directly compatible/],
		["compatible edge dialog can use a registered adapter on the edge", /Use as edge adapter/],
		["compatible edge dialog can insert a visible adapter node", /Insert adapter node/],
		["adapter node editor explains refs are registered and deterministic", /Adapter nodes store only a registered deterministic adapter ref/],
		["human node editor renders prompt and resume schema fields", /Human prompt[\s\S]*Human node resume payload schema JSON/],
		["human node editor selects registered human action choices", /Registered action choices[\s\S]*Actions are selected from the Workflow Registry/],
		["human node editor renders timeout controls", /aria-label="Human node timeout"[\s\S]*Timeout kind[\s\S]*Timeout value/],
	]);
});

test("Workflow V2 composition boundary tests cover state mapping UI and raw IR boundary", async () => {
	const stateMappingTests = await readSource("test/workflow-v2-state-mapping-ui.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();

	assertAllMatch(stateMappingTests, [
		["simple state mapping dropdown controls are source-tested", /Workflow Builder exposes simple state mapping dropdown controls/],
		["state edits are tested as Pibo Workflow IR writes", /Workflow Builder state edits stay in Pibo Workflow IR and run state validation/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["node and edge controls render simple state mapping controls", /simple state mapping controls/],
		["visual controls write state.reads arrays", /state\.reads/],
		["visual controls write state.writes arrays", /state\.writes/],
		["complex mappings stay raw-IR-only", /Complex state mapping DSLs remain raw Workflow IR only/],
		["state edits trigger validation", /"state_edit"/],
	]);
});
