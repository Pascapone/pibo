import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer preserves and exposes stale native tool diagnostics", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { agentToDraft } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const draft = agentToDraft({
			id: "agent-1",
			profileName: "stale-tool-agent",
			displayName: "Stale Tool Agent",
			runtimeInstanceId: "pi",
			runtimeOptions: {},
			nativeTools: ["retired-tool"],
			skills: [],
			contextFiles: [],
			subagents: [],
			mcpServers: [],
			piPackages: [],
			mainModelFallbacks: [],
			builtinTools: "default",
			builtinToolNames: [],
			autoContextFiles: true,
			runControl: false,
			goalControl: true,
			brokenNativeTools: ["retired-tool"],
			createdAt: "2026-08-28T00:00:00.000Z",
			updatedAt: "2026-08-28T00:00:00.000Z",
		});
		assert.deepEqual(draft.brokenNativeTools, ["retired-tool"]);
		assert.deepEqual(draft.nativeTools, ["retired-tool"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });

	const source = await readFile("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.match(source, /This agent references tools that are no longer registered/);
	assert.match(source, /nativeTools: current\.nativeTools\.filter\(\(item\) => item !== toolName\)/);
	assert.match(source, /brokenNativeTools: \(current\.brokenNativeTools \?\? \[\]\)\.filter/);
});
