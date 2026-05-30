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

function sortAndStripUi(value) {
	if (Array.isArray(value)) return value.map((item) => sortAndStripUi(item));
	if (value && typeof value === "object") {
		const output = {};
		for (const key of Object.keys(value).sort()) {
			if (key === "ui") continue;
			const next = sortAndStripUi(value[key]);
			if (next !== undefined) output[key] = next;
		}
		return output;
	}
	return value;
}

function runtimeSemanticsJson(definition) {
	return JSON.stringify(sortAndStripUi(definition));
}

test("Workflow V2 builder tests cover visual editing and publish flow", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();

	assertAllMatch(webChannelTests, [
		["duplicate/open builder wrappers are integration-tested", /workflow builder draft loader opens starter and duplicated UI draft wrappers/],
		["builder loader never exposes raw XState source", /starterPayload\.draft\.definition\.xstate, undefined[\s\S]*loadedDuplicatePayload\.draft\.definition\.xstate, undefined/],
		["zero-node UI drafts can be saved", /zeroNodeSaveDefinition\.nodes = \{\}[\s\S]*zeroNodeSaveResponse\.status, 200[\s\S]*WorkflowValidationError\.emptyGraph/],
		["graph editing adds a node", /graphEditedDefinition\.nodes\.agent_2 = \{/],
		["graph editing connects an edge", /graphEditedDefinition\.edges\.edge_agent_to_agent_2 = \{/],
		["graph editing saves manual layout positions", /graphEditedDefinition\.ui = \{[\s\S]*layout: "manual"[\s\S]*positions:[\s\S]*agent_2: \{ x: 420, y: 100 \}/],
		["prompt editing is covered by prompt asset revisions", /workflow prompt asset revisions create managed assets and draft prompt refs[\s\S]*editTrigger: "prompt_edit"/],
		["schema editing is covered by subset diagnostics", /editTrigger: "schema_edit"[\s\S]*WorkflowInterfaceError\.unsupportedSchemaKeyword/],
		["manual validate route is covered", /\/api\/chat\/workflows\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/validate[\s\S]*validatePayload\.validation\.trigger, "prompt_edit"/],
		["publish rejection is covered for invalid drafts", /publishPayload\.validation\.trigger, "before_publish"[\s\S]*publishPayload\.validation\.blocksPublish, true/],
		["publish success and version allocation are covered", /workflow draft publish allocates patch, minor, and major versions[\s\S]*patchPublish\.payload\.publishedVersion\.version, "2\.0\.1"/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["graph canvas exposes the add-node control", /Add Agent node/],
		["graph canvas exposes the connect-edge control", /Connect nodes/],
		["graph canvas exposes the layout save control", /Save layout/],
		["workflow settings inspector is visible", /Workflow settings inspector/],
		["node inspector is visible", /Node inspector: \{nodeId\}/],
		["edge inspector is visible", /Edge inspector: \{edgeId\}/],
		["layout copy states runtime semantics are unchanged", /Saving layout writes only display metadata and does not change nodes, edges, ports, guards, adapters, runtime routing, or validation semantics/],
		["validation panel exposes summary and structured diagnostics", /aria-label="Workflow validation panel"[\s\S]*aria-label="Workflow validation summary"[\s\S]*aria-label="Workflow structured diagnostics"/],
		["publish panel exposes validation and publish actions", /Validate draft[\s\S]*Publish draft/],
		["publish panel gates publish on blocking diagnostics", /const publishBlocked = currentDraft\.validation\?\.blocksPublish === true \|\| publishErrorCount > 0[\s\S]*disabled=\{publishActionBusy \|\| publishBlocked\}/],
		["publish gate names before-publish node and IO contracts", /before-publish validation also requires workflow input\/output ports and at least one node/],
	]);
});

test("Workflow V2 builder tests cover raw IR safe sync and last-valid preservation", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();

	assertAllMatch(webChannelTests, [
		["raw IR valid sync patches through rawDefinitionText", /rawDefinitionText: JSON\.stringify\(validDefinition\)[\s\S]*rawPatchPayload\.validation\.trigger, "raw_ir_edit"[\s\S]*rawPatchPayload\.validation\.ok, true/],
		["invalid raw JSON returns warning diagnostics", /rawDefinitionText: "\{ invalid raw workflow ir"[\s\S]*WorkflowBuilderWarning\.invalidRawIrText/],
		["invalid raw JSON preserves the previous revision", /invalidRawPatchPayload\.draft\.revision, rawPatchPayload\.draft\.revision/],
		["invalid raw JSON preserves the last valid definition", /assert\.deepEqual\(invalidRawPatchPayload\.draft\.definition, rawPatchPayload\.draft\.definition\)/],
		["reloading after invalid raw JSON keeps the last valid object", /reloadedAfterInvalidRawPayload\.draft\.revision, rawPatchPayload\.draft\.revision[\s\S]*assert\.deepEqual\(reloadedAfterInvalidRawPayload\.draft\.definition, rawPatchPayload\.draft\.definition\)/],
		["raw repair clears invalid raw warning", /rawRepairDefinition\.title = "Raw IR safe sync"[\s\S]*code === "WorkflowBuilderWarning\.invalidRawIrText"\), false/],
		["invalid workflow diagnostics remain covered after raw sync", /invalidDefinition\.nodes\.agent\.profile\.id = "missing-workflow-profile"[\s\S]*WorkflowGraphError\.unknownAgentProfileRef/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["raw editor submits rawDefinitionText", /patchWorkflowDraft\(draft\.draftId, \{ rawDefinitionText: rawText, editTrigger: "raw_ir_edit" \}\)/],
		["raw editor preserves invalid text for repair", /Raw Workflow IR text was not saved; the last valid draft object remains unchanged/],
		["raw editor renders the last valid object separately", /Last valid Pibo Workflow IR object/],
		["raw editor says XState is not editable", /raw XState JSON is not exposed here/],
	]);
});

test("Workflow V2 builder tests cover raw/schema/prompt panel completeness", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const markdownEditorSource = await readSource("src/apps/chat-ui/src/context/MarkdownEditor.tsx");

	assertAllMatch(workflowsAreaSource, [
		["builder renders the raw Pibo Workflow IR panel", /aria-label="Raw Pibo Workflow IR editor panel"[\s\S]*Raw Pibo Workflow IR editor/],
		["raw panel explicitly forbids raw XState editing", /Edit only Pibo Workflow IR JSON[\s\S]*raw XState JSON is not exposed here/],
		["workflow settings render workflow raw schema editors", /<WorkflowPortEditor label="Workflow input port"[\s\S]*<WorkflowPortEditor label="Workflow output port"/],
		["node inspectors render node raw schema editors", /<WorkflowOptionalPortEditor label="Node input port"[\s\S]*<WorkflowOptionalPortEditor label="Node output port"/],
		["human node renders resume payload schema JSON editor", /<WorkflowSchemaTextEditor label="Human node resume payload schema JSON"/],
		["schema editor advertises the existing subset boundary", /Raw JSON Schema subset only\. Unsupported keywords return workflow diagnostics; no Zod, AJV, or form-builder schema layer is introduced\./],
		["agent node direct prompt template editor writes promptTemplate IR", /<span>Prompt template<\/span>[\s\S]*Saving direct prompt text writes[\s\S]*promptTemplate/],
		["prompt assets use the shared Markdown editor component", /import \{ MarkdownEditor \} from "\.\.\/context\/MarkdownEditor";[\s\S]*aria-label="Prompt asset Markdown editor"[\s\S]*<MarkdownEditor/],
		["prompt asset editor documents revision and hash pinning", /Saving creates a managed UI asset revision[\s\S]*pins the revision id plus content hash in the Pibo Workflow IR/],
	]);

	assertAllMatch(markdownEditorSource, [
		["shared Markdown editor exposes markdown persistence", /type MarkdownEditorProps = \{[\s\S]*initialMarkdown: string;[\s\S]*onPersist\(markdown: string\): Promise<void>/],
		["shared Markdown editor uses MDXEditor with raw markdown fallback", /context-files-plain-fallback__textarea[\s\S]*<MDXEditor[\s\S]*markdown=\{initialMarkdown\}[\s\S]*onChange=\{handleEditorChange\}/],
	]);

	assertAllMatch(webChannelTests, [
		["schema edits use the validation pipeline and existing subset diagnostics", /unsupportedSchemaDefinition\.input = \{[\s\S]*pattern: "\^\[a-z\]\+\$"[\s\S]*editTrigger: "schema_edit"[\s\S]*WorkflowInterfaceError\.unsupportedSchemaKeyword/],
		["prompt asset revisions create managed assets", /workflow prompt asset revisions create managed assets and draft prompt refs[\s\S]*sourceRefId: "fixture\.promptBuilders\.draftPrompt"/],
		["prompt asset save patches the draft through prompt_edit", /promptBuilder: \{[\s\S]*revisionId: saveAssetPayload\.asset\.revisionId[\s\S]*editTrigger: "prompt_edit"/],
		["prompt asset revisions change revision ids and content hashes", /secondRevisionPayload\.asset\.id, saveAssetPayload\.asset\.id[\s\S]*notEqual\(secondRevisionPayload\.asset\.revisionId, saveAssetPayload\.asset\.revisionId\)[\s\S]*notEqual\(secondRevisionPayload\.asset\.contentHash, saveAssetPayload\.asset\.contentHash\)/],
	]);
});

test("Workflow Builder layout metadata does not change serialized runtime semantics", () => {
	const baseDefinition = {
		id: "layout-semantics-workflow",
		title: "Layout semantics workflow",
		version: "1.0.0",
		input: { kind: "json", schema: { type: "object" } },
		output: { kind: "json", schema: { type: "object" } },
		nodes: {
			agent: {
				kind: "agent",
				runtime: "pibo",
				profile: { kind: "fixed", id: "base" },
				promptTemplate: "Summarize the input.",
				ui: { position: { x: 80, y: 80 } },
			},
		},
		edges: {},
		ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
	};
	const movedDefinition = structuredClone(baseDefinition);
	movedDefinition.ui = { layout: "manual", positions: { agent: { x: 320, y: 180 } } };
	movedDefinition.nodes.agent.ui = { position: { x: 320, y: 180 } };

	assert.notDeepEqual(baseDefinition.ui, movedDefinition.ui);
	assert.notDeepEqual(baseDefinition.nodes.agent.ui, movedDefinition.nodes.agent.ui);
	assert.equal(runtimeSemanticsJson(movedDefinition), runtimeSemanticsJson(baseDefinition));
});
