import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer edits description, model, and thinking per subagent", async () => {
	const source = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.doesNotMatch(source, /title="Subagent"\s+modelTitle="Subagent Model"/);
	assert.match(source, /placeholder="Describe when the parent agent should delegate to this subagent\."/);
	assert.match(source, /model=\{subagent\.model\}/);
	assert.match(source, /thinking=\{subagent\.thinkingLevel\}/);
	assert.match(source, /showFast=\{false\}/);

	const script = `
		import assert from "node:assert/strict";
		const { agentDraftToSaveInput } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const input = agentDraftToSaveInput({
			displayName: "parent-agent",
			description: "",
			runtimeInstanceId: "pi",
			runtimeOptions: {},
			nativeTools: [],
			skills: [],
			contextFiles: [],
			subagents: [{
				name: " researcher ",
				description: " Research current sources. ",
				targetProfile: " research-agent ",
				model: { provider: " openai ", id: " gpt-5.6-mini " },
				thinkingLevel: "high",
				maxDepth: 2.4,
			}],
			mcpServers: [],
			piPackages: [],
			mainModel: undefined,
			thinkingLevel: undefined,
			mainThinkingLevel: undefined,
			fast: false,
			mainFast: false,
			builtinTools: "default",
			builtinToolNames: ["read", "bash", "edit", "write"],
			autoContextFiles: true,
			runControl: false,
			goalControl: true,
			source: "custom",
		});
		assert.deepEqual(input.subagents, [{
			name: "researcher",
			description: "Research current sources.",
			targetProfile: "research-agent",
			model: { provider: "openai", id: "gpt-5.6-mini" },
			thinkingLevel: "high",
			maxDepth: 2,
		}]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
