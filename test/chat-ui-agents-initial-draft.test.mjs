import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Agent Designer selects an existing agent initially and only creates drafts explicitly", async () => {
	const source = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	const modelSource = readFileSync("src/apps/chat-ui/src/agents/agent-designer-model.ts", "utf8");
	assert.match(source, /pending\?\.draft \?\? selectExistingAgentDraft\(agents, initialCustomAgents, initialCatalog\)/);
	assert.match(source, /const \[showUnsavedAgentDraft, setShowUnsavedAgentDraft\] = useState\(Boolean\(initialDraftState\.restored && !initialDraftState\.draft\.id\)\)/);
	assert.match(source, /onCreateAgent=\{createNewAgentDraft\}/);
	assert.match(source, /activateDraft\(nextDraft, null\)/);
	assert.match(source, /noAgentSelected \? "no agent selected"/);
	assert.match(source, /draft\.source === "custom" && !archivedDraft && !noAgentSelected/);
	assert.match(modelSource, /const activeCustomAgent = customAgents\.find\(\(agent\) => !agent\.archivedAt\)/);
	assert.match(modelSource, /return profile \? profileToDraft\(profile, catalog\) : createBlankAgentDraft\(catalog\)/);

	const script = `
		import assert from "node:assert/strict";
		const { saveCustomAgentDraft } = await import("./src/apps/chat-ui/src/api-agent-designer.ts");
		const { selectExistingAgentDraft, uniqueDraftAgentName } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const savedAgent = {
			id: "agent-1",
			profileName: "saved-agent",
			displayName: "Saved Agent",
			nativeTools: [],
			skills: [],
			contextFiles: [],
			subagents: [],
			mcpServers: [],
			piPackages: [],
			builtinTools: "default",
			builtinToolNames: [],
			autoContextFiles: true,
			runControl: false,
			goalControl: true,
		};
		const pluginProfile = { name: "pibo-agent", aliases: [] };
		assert.equal(selectExistingAgentDraft([pluginProfile], [savedAgent]).id, "agent-1");
		assert.equal(selectExistingAgentDraft([pluginProfile], [{ ...savedAgent, archivedAt: "2026-08-13T00:00:00.000Z" }]).source, "profile");
		assert.equal(selectExistingAgentDraft([pluginProfile], []).source, "profile");
		const emptySelection = selectExistingAgentDraft([], []);
		assert.equal(emptySelection.source, "custom");
		assert.equal(emptySelection.profileName, undefined);
		assert.equal(uniqueDraftAgentName(["new-agent", "other-agent"]), "new-agent-1");
		assert.equal(uniqueDraftAgentName(["renamed-agent", "new-agent"]), "new-agent-1");

		const calls = [];
		globalThis.fetch = async (url, init = {}) => {
			calls.push({ url, method: init.method });
			return new Response(JSON.stringify({ agent: { id: "agent-1" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const input = {
			displayName: "new-agent",
			nativeTools: [],
			skills: [],
			contextFiles: [],
			subagents: [],
			mcpServers: [],
			piPackages: [],
			builtinTools: "default",
			builtinToolNames: [],
			autoContextFiles: true,
			runControl: false,
		};
		await saveCustomAgentDraft(undefined, input);
		await saveCustomAgentDraft("agent/existing", input);
		assert.deepEqual(calls, [
			{ url: "/api/chat/agents", method: "POST" },
			{ url: "/api/chat/agents/agent%2Fexisting", method: "PATCH" },
		]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
