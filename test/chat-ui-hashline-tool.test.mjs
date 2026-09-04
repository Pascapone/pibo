import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const agentsViewSource = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");

test("Agent Designer greys out replaced built-in tools while preserving their configured selection", async () => {
	assert.match(agentsViewSource, /buildBuiltinToolReplacementMap/);
	assert.match(agentsViewSource, /Replaced by \$\{replacers\.join\(", "\)\} while selected\./);
	assert.match(agentsViewSource, /disabled=\{readOnly \|\| Boolean\(replacementReason\)/);
	assert.match(agentsViewSource, /checked=\{selectedTools\.includes\(toolName\)\}/);

	const script = `
		import assert from "node:assert/strict";
		const { buildBuiltinToolReplacementMap } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const tools = [{
			name: "hashline",
			description: "Hashline",
			yieldable: false,
			hasDefinition: true,
			portable: false,
			replacesBuiltinTools: ["read"],
		}];
		assert.deepEqual([...buildBuiltinToolReplacementMap(tools, []).entries()], []);
		assert.deepEqual([...buildBuiltinToolReplacementMap(tools, ["hashline"]).entries()], [["read", ["hashline"]]]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
