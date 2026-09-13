import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer preserves, exposes, and can remove missing plugin selections", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { agentToDraft, agentDraftToSaveInput } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const pluginSelection = { schemaVersion: 1, plugins: [{ pluginId: "retired.tools", revision: "old-hash", enabled: true, contributions: { retired_tool: true }, config: { retained: true } }] };
		const draft = agentToDraft({
			id: "agent-1",
			revision: 3,
			profileName: "stale-tool-agent",
			displayName: "Stale Tool Agent",
			runtimeInstanceId: "pi",
			runtimeOptions: {},
			pluginSelection,
			skills: [],
			contextFiles: [],
			subagents: [],
			mainModelFallbacks: [],
			builtinTools: "default",
			builtinToolNames: [],
			autoContextFiles: true,
			createdAt: "2026-08-28T00:00:00.000Z",
			updatedAt: "2026-08-28T00:00:00.000Z",
		});
		assert.deepEqual(draft.pluginSelection, pluginSelection);
		assert.notEqual(draft.pluginSelection, pluginSelection);
		assert.deepEqual(agentDraftToSaveInput(draft).pluginSelection, pluginSelection);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });

	const source = await readFile("src/apps/chat-ui/src/agents/AgentPluginsDesigner.tsx", "utf8");
	assert.match(source, /missing from catalog\. Reference and configuration retained/);
	assert.match(source, /Object\.entries\(entry\.contributions\)/);
	assert.match(source, />Remove retained reference</);
	assert.match(source, /plugins\.filter\(\(item\) => item\.pluginId !== entry\.pluginId\)/);
});
