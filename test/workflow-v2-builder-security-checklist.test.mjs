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

test("Workflow V2 builder/security checklist covers builder authoring and validation surfaces", async () => {
	const builderTests = await readSource("test/workflow-v2-builder-editing-raw-ir.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(builderTests, [
		["visual graph editing tests add nodes, connect edges, and save layout metadata", /graph editing adds a node[\s\S]*graph editing connects an edge[\s\S]*graph editing saves manual layout positions/],
		["raw IR tests cover safe sync, invalid JSON, and last-valid preservation", /raw IR valid sync patches through rawDefinitionText[\s\S]*invalid raw JSON returns warning diagnostics[\s\S]*invalid raw JSON preserves the last valid definition/],
		["raw schema tests cover workflow, node, and human JSON schema editors", /workflow settings render workflow raw schema editors[\s\S]*node inspectors render node raw schema editors[\s\S]*human node renders resume payload schema JSON editor/],
		["prompt tests cover direct promptTemplate edits and Markdown prompt assets", /agent node direct prompt template editor writes promptTemplate IR[\s\S]*prompt assets use the shared Markdown editor component[\s\S]*prompt asset editor documents revision and hash pinning/],
		["validation and publish panel tests cover diagnostics and blocking state", /validation panel exposes summary and structured diagnostics[\s\S]*publish panel gates publish on blocking diagnostics[\s\S]*publish gate names before-publish node and IO contracts/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["builder renders the visual graph editor", /Visual graph editor/],
		["builder renders the workflow settings inspector", /Workflow settings inspector/],
		["builder renders the raw IR panel", /Raw Pibo Workflow IR editor/],
		["builder renders the validation panel", /aria-label="Workflow validation panel"/],
		["builder renders the publish action", /Publish draft/],
		["raw JSON schema editing stays on the existing subset boundary", /Raw JSON Schema subset only\. Unsupported keywords return workflow diagnostics; no Zod, AJV, or form-builder schema layer is introduced\./],
		["raw IR editor separates unsaved invalid text from the last valid object", /Raw Workflow IR text was not saved; the last valid draft object remains unchanged[\s\S]*Last valid Pibo Workflow IR object/],
	]);

	assertAllMatch(webChannelTests, [
		["builder loader opens starter and duplicated draft wrappers", /workflow builder draft loader opens starter and duplicated UI draft wrappers/],
		["validation pipeline covers draft load", /assert\.equal\(loadPayload\.draft\.validation\.trigger, "draft_load"\)/],
		["validation pipeline covers graph, node, edge, schema, prompt, and state edits", /for \(const editTrigger of \["graph_edit", "node_edit", "edge_edit", "schema_edit", "prompt_edit", "state_edit"\]\)/],
		["validation pipeline covers raw IR edits", /assert\.equal\(rawPatchPayload\.validation\.trigger, "raw_ir_edit"\)/],
		["validation pipeline covers before-publish blocking", /assert\.equal\(publishPayload\.validation\.trigger, "before_publish"\)[\s\S]*assert\.equal\(publishPayload\.validation\.blocksPublish, true\)/],
		["schema editing returns JSON Schema subset diagnostics", /unsupportedSchemaDefinition[\s\S]*editTrigger: "schema_edit"[\s\S]*WorkflowInterfaceError\.unsupportedSchemaKeyword/],
		["prompt editing persists managed prompt asset revisions", /workflow prompt asset revisions create managed assets and draft prompt refs[\s\S]*editTrigger: "prompt_edit"/],
	]);
});

test("Workflow V2 builder/security checklist covers registered composition boundaries", async () => {
	const compositionTests = await readSource("test/workflow-v2-composition-boundaries.test.mjs");
	const stateMappingTests = await readSource("test/workflow-v2-state-mapping-ui.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(compositionTests, [
		["composition test covers all registered node kinds and picker paths", /Workflow V2 composition boundary tests cover registered node and picker paths[\s\S]*code, agent, human, adapter, and nested workflow nodes/],
		["composition test covers registered guard and adapter refs with params", /positive composition patch keeps registered guard and edge adapter validation green[\s\S]*invalid params are integration-tested for guard and adapter refs/],
		["composition test covers incompatible ports and adapter compatibility", /edge adapter output compatibility is integration-tested[\s\S]*incompatible edges without adapters are rejected/],
		["composition test covers every missing registered ref family", /missing registered refs are integration-tested[\s\S]*unknownAgentProfileRef[\s\S]*unknownHandlerRef[\s\S]*unknownAdapterRef[\s\S]*unknownGuardRef[\s\S]*unknownHumanActionRef[\s\S]*unknownWorkflowVersion/],
		["composition test covers paramsSchema-gated guard and adapter editors", /guard params editor is gated by paramsSchema[\s\S]*edge adapter params editor is gated by paramsSchema/],
	]);

	assertAllMatch(stateMappingTests, [
		["state mapping test exposes dropdown controls", /Workflow Builder exposes simple state mapping dropdown controls[\s\S]*Read scope[\s\S]*Write scope/],
		["state mapping test keeps complex mappings in raw IR", /Complex state mapping DSLs remain raw Workflow IR only/],
		["state mapping test patches with state_edit validation", /"state_edit"/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["builder can use a registered adapter on an incompatible edge", /These ports are not directly compatible[\s\S]*Use as edge adapter/],
		["builder can insert a visible registered adapter node", /Insert adapter node/],
		["adapter node editor stores only registered adapter refs", /Adapter nodes store only a registered deterministic adapter ref/],
		["builder selects guard refs from pickers", /Guard ref/],
		["builder selects edge adapter refs from pickers", /Edge adapter ref/],
		["builder selects registered human actions", /Registered action choices/],
		["builder links nested workflow nodes separately", /Open workflow/],
	]);

	assertAllMatch(webChannelTests, [
		["guard and adapter pickers list registered refs and report missing refs", /workflow guard and adapter pickers list registered refs and report missing refs/],
		["human action and prompt asset pickers list refs and report missing refs", /workflow human action and prompt asset pickers list registered refs and report missing refs/],
		["nested workflow picker reports missing workflow versions", /workflow version picker lists published nested workflow refs and reports missing refs[\s\S]*WorkflowCatalogError\.unknownWorkflowVersion/],
		["missing registered refs block publish before execution", /invalidPublishPayload\.diagnostics\.some\(\(diagnostic\) => diagnostic\.code === "WorkflowGraphError\.unknownAdapterRef"[\s\S]*invalidPublishPayload\.diagnostics\.some\(\(diagnostic\) => diagnostic\.code === "WorkflowGraphError\.unknownHumanActionRef"/],
	]);
});

test("Workflow V2 builder/security checklist covers explicit security non-goals", async () => {
	const securityTests = await readSource("test/workflow-v2-security-boundary.test.mjs");
	const deferralTests = await readSource("test/workflow-v2-deferrals.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const workflowSecuritySource = [
		await readSource("src/apps/chat/workflow-v2-security-validation.ts"),
		await readSource("src/apps/chat/workflow-json-schema-validation.ts"),
	].join("\n");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(securityTests, [
		["security tests cover visible auth and Project/session visibility copy", /auth and Project\/session visibility boundary is named/],
		["security tests cover profile tool skill context and compute boundaries", /tools, skills, context, native tools, and MCP are not granted by the UI[\s\S]*compute-worker access stays behind the selected runtime profile/],
		["security tests cover inline executable, raw XState, hidden coercion, and Zod rejection", /inline executable IR fields are rejected[\s\S]*raw XState fields are rejected by validation[\s\S]*hidden LLM coercion is rejected[\s\S]*Zod is excluded by the JSON Schema subset validator/],
		["security tests cover sensitive data redaction", /diagnostics are sanitized before storage or responses[\s\S]*diagnostic text redacts sensitive workflow values/],
	]);

	assertAllMatch(deferralTests, [
		["deferral tests require visible non-goal copy", /workflow V2 UI names every explicit deferral in scope-boundary copy/],
		["deferral tests cover no inline code", /No inline TypeScript, JavaScript, shell, eval, arbitrary executable code/],
		["deferral tests cover no raw XState, templates, slash commands, or workflow tools", /No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents/],
		["deferral tests cover no Zod schema authoring", /No Zod schema authoring/],
		["deferral tests scan interactive controls for deferred actions", /workflow V2 UI controls do not expose deferred authoring actions/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["visible security boundary forbids inline code and hidden LLM coercion", /No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies[\s\S]*hidden LLM coercion is not used/],
		["visible security boundary keeps XState projection-only", /XState remains projection-only; Pibo Workflow IR is the persisted source of truth/],
		["visible non-goals name templates, slash commands, tools, raw XState, and Zod", /No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents[\s\S]*No Zod schema authoring/],
	]);

	assertAllMatch(workflowSecuritySource, [
		["server keeps inline executable paths out of V2", /WorkflowSecurityError\.inlineExecutableCode/],
		["server rejects raw XState authoring", /WorkflowSecurityError\.rawXStateAuthoring/],
		["server rejects hidden LLM coercion", /WorkflowSecurityError\.hiddenLlmCoercion/],
		["server documents Zod as outside the authoring boundary", /Zod schemas are not part of V2 authoring/],
	]);

	assertAllMatch(webChannelTests, [
		["integration tests reject inline execution and raw XState payloads", /workflow security boundary validates registered refs and rejects inline execution paths[\s\S]*WorkflowSecurityError\.inlineExecutableCode[\s\S]*WorkflowSecurityError\.rawXStateAuthoring/],
		["integration tests verify redaction and scoped Project visibility", /workflow diagnostics are redacted and scoped to owning Project sessions/],
	]);
});
