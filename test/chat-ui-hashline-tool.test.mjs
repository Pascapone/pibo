import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const agentsViewSource = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
const pluginsDesignerSource = readFileSync("src/apps/chat-ui/src/agents/AgentPluginsDesigner.tsx", "utf8");
const packageSource = readFileSync("src/plugins/default-packages.ts", "utf8");

test("Agent Designer greys out replaced built-in tools while preserving their configured selection", async () => {
	assert.match(pluginsDesignerSource, /buildPluginBuiltinToolReplacementMap\(plan\)/);
	assert.match(agentsViewSource, /replacements=\{pluginBuiltinToolReplacements\}/);
	assert.match(agentsViewSource, /Replaced by \$\{replacers\.join\(", "\)\} while selected\./);
	assert.match(agentsViewSource, /disabled=\{readOnly \|\| Boolean\(replacementReason\)/);
	assert.match(agentsViewSource, /checked=\{selectedTools\.includes\(toolName\)\}/);
	assert.match(packageSource, /metadata: \{ replacesBuiltinTools: \["read"\] \}/);

	const script = `
		import assert from "node:assert/strict";
		const { buildPluginBuiltinToolReplacementMap } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const plan = {
			contributions: [{
				id: "pibo.file-editing/hashline",
				pluginId: "pibo.file-editing",
				pluginRevision: "r1",
				contribution: { id: "hashline", kind: "tool", name: "hashline", metadata: { replacesBuiltinTools: ["read"] } },
			}],
		};
		assert.deepEqual([...buildPluginBuiltinToolReplacementMap(undefined).entries()], []);
		assert.deepEqual([...buildPluginBuiltinToolReplacementMap(plan).entries()], [["read", ["hashline"]]]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
