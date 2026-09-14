import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sources(paths) {
	return Promise.all(paths.map((path) => readFile(path, "utf8")));
}

test("desktop module tabs use pane-width sidebars and container-responsive content flows", async () => {
	const [browserEntry, coreWorkspace, pluginWorkspace, responsivePane, loops, cron, agents, settings, contextFiles, designerUi, workflowGraph] = await sources([
		"src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx",
		"src/apps/chat-ui/src/core-workspace-view.tsx",
		"src/apps/chat-ui/src/plugins/plugin-workspace.tsx",
		"src/apps/chat-ui/src/responsive-pane-sidebar.tsx",
		"src/apps/chat-ui/src/LoopArea.tsx",
		"src/apps/chat-ui/src/CronArea.tsx",
		"src/apps/chat-ui/src/agents/AgentsView.tsx",
		"src/apps/chat-ui/src/settings/SettingsView.tsx",
		"src/apps/chat-ui/src/context/ContextFilesView.tsx",
		"src/apps/chat-ui/src/agents/designer-ui.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx",
	]);

	assert.match(browserEntry, /<CronArea[\s\S]*?surface="tab"/);
	assert.match(browserEntry, /<LoopArea[\s\S]*?surface="tab"/);
	assert.match(coreWorkspace, /<AgentsView[\s\S]*surface="tab"/);
	assert.match(coreWorkspace, /CoreContextView[\s\S]*<ContextFilesView[\s\S]*ResponsiveTabSidebarPanel[\s\S]*label="Context"/);
	assert.match(coreWorkspace, /CoreSettingsView[\s\S]*ResponsiveTabSidebarPanel[\s\S]*label="Settings"[\s\S]*<SettingsSidebar/);
	assert.doesNotMatch(browserEntry, /AgentDesignerView|UserResourcesView|GlobalSettingsView/);
	assert.match(browserEntry, /WebAnnotationsView[\s\S]*ResponsiveTabSidebarPanel[\s\S]*label="Web Annotations"/);
	assert.match(browserEntry, /ToolFamilyView[\s\S]*ResponsiveTabSidebarPanel/);
	assert.doesNotMatch(browserEntry, /grid-cols-\[220px_minmax\(0,1fr\)\][\s\S]*max-\[700px\]:grid-cols-1/);
	assert.match(pluginWorkspace, /FIRST_PARTY_SELF_NAVIGATED_VIEWS/);
	assert.match(pluginWorkspace, /showHostSubviewNavigation && view\.subviews\?\.length/);
	assert.match(pluginWorkspace, /aria-label=\{`\$\{view\.title\} subviews`\}/);

	assert.match(responsivePane, /ResizeObserver/);
	assert.match(responsivePane, /const \[rootElement, setRootElement\]/);
	assert.match(responsivePane, /observer\.observe\(rootElement\)/);
	assert.match(responsivePane, /breakpoint = 760/);
	assert.match(responsivePane, /grid-cols-\[var\(--pibo-panel-sidebar-width\)_minmax\(0,1fr\)\]/);
	assert.match(responsivePane, /w-\[min\(var\(--pibo-panel-sidebar-width\),86%\)\]/);
	assert.doesNotMatch(responsivePane, /w-\[min\(\$\{/);
	assert.match(responsivePane, /aria-modal=\{layout\.isOverlay && layout\.isOpen \? true : undefined\}/);
	assert.match(responsivePane, /data-pibo-sidebar-navigation/);
	assert.match(responsivePane, /layout\.closeSidebar\(\)/);

	for (const source of [loops, cron, agents]) {
		assert.match(source, /className="@container/);
		assert.match(source, /sidebar\.isOverlay/);
		assert.match(source, /sidebar\.triggerRef/);
	}
	assert.match(loops, /@max-\[720px\]:grid-cols-1/);
	assert.match(cron, /@max-\[720px\]:grid-cols-1/);
	assert.match(agents, /grid-cols-\[300px_minmax\(0,1fr\)\]/);
	assert.match(settings, /@max-\[520px\]:grid-cols-1/);
	assert.match(contextFiles, /ResizeObserver/);
	assert.match(contextFiles, /getBoundingClientRect\(\)\.width <= 860/);
	assert.match(contextFiles, /mobileSidebarA11yProps\(filePanelNarrow, filePanelOpen, "Context files"\)/);
	assert.doesNotMatch(contextFiles, /matchMedia\("\(max-width: 1180px\)"\)/);
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
