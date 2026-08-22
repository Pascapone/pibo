import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const appSource = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
const agentsViewSource = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
const sidebarSource = readFileSync("src/apps/chat-ui/src/agents/AgentsSidebar.tsx", "utf8");
const apiSource = readFileSync("src/apps/chat-ui/src/api-agent-designer.ts", "utf8");

test("Agent Designer uses the standard responsive sidebar contract", () => {
	assert.doesNotMatch(appSource, /area === "agents" \|\| area === "workflows"/);
	assert.match(appSource, /initialAgentFolders=\{bootstrap\.agentFolders\}/);
	assert.match(appSource, /mobileSidebarOpen=\{mobileSidebarOpen\}/);
	assert.match(appSource, /isMobileSidebarViewport=\{isMobileSidebarViewport\}/);
	assert.match(appSource, /onCloseMobileSidebar=\{closeMobileSidebar\}/);
	assert.match(agentsViewSource, /data-pibo-mobile-sidebar-backdrop/);
	assert.match(agentsViewSource, /<AgentsSidebar/);
	assert.match(sidebarSource, /mobileSidebarA11yProps\(isMobileSidebarViewport, mobileSidebarOpen, "Agents sidebar"\)/);
	assert.match(sidebarSource, /max-\[980px\]:-translate-x-full/);
	assert.match(sidebarSource, /min-\[981px\]:hidden/);
});

test("Agent picker exposes folder creation, rename, assignment, and empty-folder deletion", () => {
	assert.match(sidebarSource, /title="New agent folder"/);
	assert.match(sidebarSource, /New agent in \$\{folder\?\.name \?\? "Unfiled"\}/);
	assert.match(sidebarSource, /Rename folder/);
	assert.match(sidebarSource, /Delete empty folder/);
	assert.match(sidebarSource, /Move to/);
	assert.match(sidebarSource, /onMove\(folder\.id\)/);
	assert.match(apiSource, /postAgentFolder/);
	assert.match(apiSource, /patchAgentFolder/);
	assert.match(apiSource, /deleteAgentFolder/);
});

test("Agent drafts preserve folder assignment without changing runtime behavior", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { agentDraftToSaveInput, agentToDraft, createBlankAgentDraft } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const draft = createBlankAgentDraft(undefined, "folder-agent", "folder-1");
		assert.equal(draft.folderId, "folder-1");
		assert.equal(agentDraftToSaveInput(draft).folderId, "folder-1");
		const agent = {
			id: "agent-1",
			profileName: "folder-agent",
			displayName: "folder-agent",
			folderId: "folder-1",
			runtimeInstanceId: "pi",
			runtimeOptions: {},
			nativeTools: [], skills: [], contextFiles: [], subagents: [], mcpServers: [], piPackages: [],
			builtinTools: "default", builtinToolNames: [], autoContextFiles: true, runControl: false, goalControl: true,
		};
		assert.equal(agentToDraft(agent).folderId, "folder-1");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
