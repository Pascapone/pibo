import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sources(paths) {
	return Promise.all(paths.map((path) => readFile(path, "utf8")));
}

test("desktop module tabs use pane-width sidebars and container-responsive content flows", async () => {
	const [app, responsivePane, loops, cron, agents, projects, settings, designerUi, workflowGraph] = await sources([
		"src/apps/chat-ui/src/App.tsx",
		"src/apps/chat-ui/src/responsive-pane-sidebar.tsx",
		"src/apps/chat-ui/src/LoopArea.tsx",
		"src/apps/chat-ui/src/CronArea.tsx",
		"src/apps/chat-ui/src/agents/AgentsView.tsx",
		"src/apps/chat-ui/src/projects/ProjectsArea.tsx",
		"src/apps/chat-ui/src/settings/SettingsView.tsx",
		"src/apps/chat-ui/src/agents/designer-ui.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx",
	]);

	assert.match(app, /<CronArea[\s\S]*?surface="tab"/);
	assert.match(app, /<LoopArea[\s\S]*?surface="tab"/);
	assert.match(app, /<AgentsView[\s\S]*surface="tab"/);
	assert.match(app, /<ProjectsArea[\s\S]*surface="tab"/);
	assert.match(app, /ResponsiveTabSidebarPanel[\s\S]*label="Context"/);
	assert.match(app, /ResponsiveTabSidebarPanel[\s\S]*label="Settings"/);

	assert.match(responsivePane, /ResizeObserver/);
	assert.match(responsivePane, /const \[rootElement, setRootElement\]/);
	assert.match(responsivePane, /observer\.observe\(rootElement\)/);
	assert.match(responsivePane, /breakpoint = 760/);
	assert.match(responsivePane, /grid-cols-\[var\(--pibo-panel-sidebar-width\)_minmax\(0,1fr\)\]/);
	assert.match(responsivePane, /aria-modal=\{layout\.isOverlay && layout\.isOpen \? true : undefined\}/);

	for (const source of [loops, cron, agents]) {
		assert.match(source, /className="@container/);
		assert.match(source, /sidebar\.isOverlay/);
		assert.match(source, /sidebar\.triggerRef/);
	}
	assert.match(loops, /@max-\[720px\]:grid-cols-1/);
	assert.match(cron, /@max-\[720px\]:grid-cols-1/);
	assert.match(agents, /grid-cols-\[300px_minmax\(0,1fr\)\]/);
	assert.match(projects, /effectiveShowRawEvents/);
	assert.match(projects, /projectGridColumns/);
	assert.match(projects, /containerResponsive=\{surface === "tab"\}/);
	assert.match(settings, /@max-\[520px\]:grid-cols-1/);
	assert.match(designerUi, /@max-\[680px\]:grid-cols-1/);
	assert.match(workflowGraph, /@max-\[760px\]:grid-cols-1/);
});

test("Agent Designer exposes Archive and Read-only Profiles as fixed folders", async () => {
	const sidebar = await readFile("src/apps/chat-ui/src/agents/AgentsSidebar.tsx", "utf8");
	assert.match(sidebar, /SystemAgentFolderGroup label="Archive"/);
	assert.match(sidebar, /SystemAgentFolderGroup label="Read-only Profiles"/);
	assert.match(sidebar, /function SystemAgentFolderGroup/);
	assert.doesNotMatch(sidebar, /ArchivedAgentGroup/);
});
