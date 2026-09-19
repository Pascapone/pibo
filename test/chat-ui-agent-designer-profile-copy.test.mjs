import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer profile copies seed a default plugin selection so they can save", async () => {
	const modelSource = readFileSync("src/apps/chat-ui/src/agents/agent-designer-model.ts", "utf8");
	const viewSource = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.match(modelSource, /export function defaultAgentPluginSelection\(catalog\?: AgentCatalog\)/);
	assert.match(
		modelSource,
		/pluginSelection: profile\.pluginSelection \? structuredClone\(profile\.pluginSelection\) : defaultAgentPluginSelection\(catalog\)/,
	);
	assert.match(viewSource, /function readPendingAgentDraft\(catalog\?: AgentCatalog \| null\)/);
	assert.match(viewSource, /backfillRestoredPluginSelection\(parsed\.draft, catalog\)/);
	assert.match(viewSource, /if \(draft\.id \|\| draft\.pluginSelection\) return \{\}/);
	assert.match(viewSource, /readPendingAgentDraft\(initialCatalog\)/);

	const script = `
		import assert from "node:assert/strict";
		const { agentDraftToSaveInput, copyProfileToDraft, profileToDraft } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const profile = { name: "muse-native", aliases: [], runtimeInstanceId: "muse-native" };
		const copy = copyProfileToDraft(profile);
		assert.equal(copy.displayName, "muse-native-copy");
		assert.equal(copy.id, undefined);
		assert.deepEqual(copy.pluginSelection, { schemaVersion: 1, plugins: [] });
		const input = agentDraftToSaveInput(copy);
		assert.deepEqual(input.pluginSelection, { schemaVersion: 1, plugins: [] });

		const catalog = { defaultPluginSelection: { schemaVersion: 1, plugins: [{ id: "pibo.preview" }] } };
		const seeded = copyProfileToDraft(profile, catalog);
		assert.deepEqual(seeded.pluginSelection, { schemaVersion: 1, plugins: [{ id: "pibo.preview" }] });

		const withSelection = profileToDraft({ ...profile, pluginSelection: { schemaVersion: 1, plugins: [{ id: "pibo.custom" }] } }, catalog);
		assert.deepEqual(withSelection.pluginSelection, { schemaVersion: 1, plugins: [{ id: "pibo.custom" }] });
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
