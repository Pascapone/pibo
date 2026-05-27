import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowSettingsModelScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			applyWorkflowPromptAssetDocumentToNode,
			applyWorkflowSettingsForm,
			createDefaultGlobalStateField,
			createWorkflowSettingsFormState,
			formatWorkflowStringList,
			parseWorkflowStringList,
			readPromptAssetRefId,
			readWorkflowGlobalStateMergeKind,
			workflowSettingsStateChanged,
			writeWorkflowPromptAssetMetadata,
		} from "./src/apps/chat-ui/src/workflows/workflow-settings-model.ts";

		const definition = {
			title: "Draft workflow",
			description: "Existing description",
			input: { kind: "json", description: "Input payload", schema: { type: "object", properties: { topic: { type: "string" } } } },
			output: { kind: "text", description: "Answer" },
			state: {
				global: {
					projectGoal: { description: "Goal", schema: { type: "string" }, merge: { kind: "replace" } },
					ignored: "not an object",
				},
				local: { untouched: true },
			},
			metadata: {
				tags: ["alpha", 7, "beta"],
				useWhen: ["drafting"],
				notFor: ["exports"],
				examples: ["one", "two"],
				keep: "yes",
			},
		};

		const form = createWorkflowSettingsFormState(definition);
		assert.equal(form.title, "Draft workflow");
		assert.equal(form.inputKind, "json");
		assert.equal(form.inputSchemaText.includes('"topic"'), true);
		assert.deepEqual(form.globalStateFields, [{
			path: "projectGoal",
			description: "Goal",
			schemaText: JSON.stringify({ type: "string" }, null, 2),
			mergeKind: "replace",
		}]);
		assert.equal(form.metadataTags, "alpha\\nbeta");
		assert.equal(formatWorkflowStringList(["one", 2, "two"]), "one\\ntwo");
		assert.deepEqual(parseWorkflowStringList("alpha, beta\\ngamma"), ["alpha", "beta", "gamma"]);
		assert.equal(readWorkflowGlobalStateMergeKind({ kind: "append" }), "append");
		assert.equal(readWorkflowGlobalStateMergeKind({ kind: "unknown" }), "none");
		assert.equal(readWorkflowGlobalStateMergeKind(undefined), "none");
		assert.equal(createDefaultGlobalStateField([{ path: "projectGoal", description: "", schemaText: "{}", mergeKind: "none" }]).path, "projectGoal2");

		const next = applyWorkflowSettingsForm(definition, {
			...form,
			title: "  Updated workflow  ",
			description: "",
			inputKind: "text",
			inputDescription: "Plain input",
			inputSchemaText: "{}",
			metadataTags: "alpha,delta",
			metadataUseWhen: "",
			globalStateFields: [
				{
					path: " review score ",
					description: "Score",
					schemaText: JSON.stringify({ type: "number" }, null, 2),
					mergeKind: "shallowMerge",
				},
			],
		});
		assert.equal(next.title, "Updated workflow");
		assert.equal(next.description, undefined);
		assert.deepEqual(next.input, { kind: "text", description: "Plain input" });
		assert.deepEqual(next.state.global.reviewscore, { description: "Score", schema: { type: "number" }, merge: { kind: "shallowMerge" } });
		assert.deepEqual(next.state.local, { untouched: true });
		assert.deepEqual(next.metadata.tags, ["alpha", "delta"]);
		assert.equal(next.metadata.useWhen, undefined);
		assert.equal(next.metadata.keep, "yes");
		assert.equal(workflowSettingsStateChanged(definition, form), false);
		assert.equal(workflowSettingsStateChanged(definition, { ...form, globalStateFields: [] }), true);

		const asset = {
			id: "ui.promptAssets.agentPrompt",
			displayName: "Agent prompt",
			source: "ui",
			readOnly: false,
			revisionId: "rev_2",
			contentHash: "sha256:new",
			markdown: "Prompt",
			createdAt: "2026-05-27T00:00:00.000Z",
			updatedAt: "2026-05-27T00:00:00.000Z",
		};
		assert.equal(readPromptAssetRefId(" plugin.prompt "), "plugin.prompt");
		assert.equal(readPromptAssetRefId({ id: " ui.promptAssets.x " }), "ui.promptAssets.x");
		assert.equal(readPromptAssetRefId({}), "");
		assert.deepEqual(writeWorkflowPromptAssetMetadata({ promptAssetRefs: ["old", "ui.promptAssets.agentPrompt"], promptAssetPins: [{ assetId: "ui.promptAssets.agentPrompt", revisionId: "rev_1" }] }, asset), {
			promptAssetRefs: ["old", "ui.promptAssets.agentPrompt"],
			promptAssetPins: [{ assetId: "ui.promptAssets.agentPrompt", revisionId: "rev_2", contentHash: "sha256:new", source: "ui" }],
		});

		const withPromptAsset = applyWorkflowPromptAssetDocumentToNode({
			metadata: { existing: true, promptAssetRefs: ["old"] },
			nodes: {
				agent: {
					kind: "agent",
					promptTemplate: "Old direct prompt",
					metadata: { promptAssetPins: [{ assetId: "old", revisionId: "rev_1" }] },
				},
			},
		}, "agent", asset);
		assert.equal(withPromptAsset.nodes.agent.promptTemplate, undefined);
		assert.deepEqual(withPromptAsset.nodes.agent.promptBuilder, {
			kind: "promptBuilder",
			language: "typescript",
			id: "ui.promptAssets.agentPrompt",
			revisionId: "rev_2",
			contentHash: "sha256:new",
			source: "ui",
		});
		assert.deepEqual(withPromptAsset.metadata.promptAssetRefs, ["old", "ui.promptAssets.agentPrompt"]);
		assert.deepEqual(withPromptAsset.nodes.agent.metadata.promptAssetRefs, ["ui.promptAssets.agentPrompt"]);
		const unchanged = { nodes: {} };
		assert.equal(applyWorkflowPromptAssetDocumentToNode(unchanged, "missing", asset), unchanged);
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow settings model helpers round-trip settings and prompt asset pins", async () => {
	const { stdout, stderr } = await runWorkflowSettingsModelScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
