import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("desktop tabs model covers dedupe, close focus, reorder, persistence, and route reconciliation", async () => {
	const script = `
		import assert from "node:assert/strict";
		const model = await import("./src/apps/chat-ui/src/desktop-tabs-model.ts");
		let state = model.emptyDesktopTabState();
		state = model.openDesktopTab(state, { kind: "route", route: { area: "workflows" } }, { id: "workflows", now: 1 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "vscode" } }, { id: "vscode", now: 2 });
		state = model.openDesktopTab(state, { kind: "session-tool", tool: "preview" }, { id: "preview", now: 3 });
		assert.deepEqual(state.tabs.map((tab) => tab.id), ["workflows", "vscode", "preview"]);
		assert.equal(state.activeTabId, "preview");

		let newTabs = model.openDesktopNewTab(model.emptyDesktopTabState(), { id: "new-one", now: 1 });
		newTabs = model.openDesktopNewTab(newTabs, { id: "new-two", now: 2 });
		assert.deepEqual(newTabs.tabs.map((tab) => [tab.id, tab.title, tab.target.kind]), [
			["new-one", "New Tab", "new-tab"],
			["new-two", "New Tab", "new-tab"],
		], "each + action creates a distinct real tab");
		const persistedNewTabs = model.parseDesktopTabState(model.serializeDesktopTabState(newTabs));
		assert.deepEqual(persistedNewTabs.tabs.map((tab) => tab.id), ["new-one", "new-two"], "multiple New Tabs persist without logical dedupe");
		newTabs = model.replaceDesktopNewTab(newTabs, "new-two", { kind: "route", route: { area: "settings" } }, 3);
		assert.equal(newTabs.activeTabId, "new-two");
		assert.equal(model.activeDesktopTab(newTabs).title, "Settings");
		assert.equal(model.activeDesktopTab(newTabs).target.kind, "route");
		newTabs = model.openDesktopNewTab(newTabs, { id: "new-three", now: 4 });
		newTabs = model.replaceDesktopNewTab(newTabs, "new-three", { kind: "route", route: { area: "settings", panel: "providers" } }, 5);
		assert.equal(newTabs.tabs.some((tab) => tab.id === "new-three"), false, "choosing an existing singleton closes the temporary New Tab");
		assert.equal(newTabs.activeTabId, "new-two");
		assert.equal(model.activeDesktopTab(newTabs).target.route.panel, "providers");

		state = model.openDesktopTab(state, { kind: "route", route: { area: "workflows", draftId: "draft-1" } }, { id: "workflow-1", now: 4 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "workflows", draftId: "draft-2" } }, { id: "workflow-2", now: 5 });
		assert.equal(state.tabs.filter((tab) => tab.target.kind === "route" && tab.target.route.area === "workflows").length, 3);

		state = model.openDesktopTab(state, { kind: "route", route: { area: "settings", panel: "general" } }, { id: "settings", now: 6 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "settings", panel: "providers" } }, { id: "duplicate-settings", now: 7 });
		assert.equal(state.tabs.filter((tab) => tab.target.kind === "route" && tab.target.route.area === "settings").length, 1);
		assert.equal(model.activeDesktopTab(state).target.route.panel, "providers");

		state = model.activateDesktopTab(state, "vscode", 8);
		state = model.closeDesktopTab(state, "vscode");
		assert.equal(state.activeTabId, "preview", "close focuses the right neighbor");
		state = model.moveDesktopTab(state, "preview", 1);
		assert.equal(state.tabs.at(2).id, "preview");
		state = model.reorderDesktopTab(state, "preview", 0);
		assert.equal(state.tabs[0].id, "preview");
		const withoutInactive = model.closeDesktopTab(state, "workflows");
		assert.equal(withoutInactive.activeTabId, state.activeTabId, "closing an inactive tab keeps focus");
		let one = model.openDesktopTab(model.emptyDesktopTabState(), { kind: "session-tool", tool: "preview" }, { id: "only", now: 1 });
		one = model.closeDesktopTab(one, "only");
		assert.equal(one.activeTabId, null);
		assert.deepEqual(one.tabs, []);

		state = model.resizeDesktopTabs(state, 5_000);
		assert.equal(state.width, model.DESKTOP_TAB_MAX_WIDTH);
		state = { ...state, collapsed: true };
		const restored = model.parseDesktopTabState(model.serializeDesktopTabState(state));
		assert.deepEqual(restored.tabs.map((tab) => tab.id), state.tabs.map((tab) => tab.id));
		assert.equal(restored.collapsed, true);
		assert.equal(restored.width, model.DESKTOP_TAB_MAX_WIDTH);
		assert.deepEqual(model.parseDesktopTabState("broken"), model.emptyDesktopTabState());

		const persistedCollapsedRoute = {
			...model.openDesktopTab(model.emptyDesktopTabState(), { kind: "route", route: { area: "agents" } }, { id: "agents-existing", now: 8 }),
			width: 544,
			collapsed: true,
		};
		const reconciledExistingRoute = model.reconcileDesktopRoute(persistedCollapsedRoute, { area: "agents" }, { now: 9 });
		assert.equal(reconciledExistingRoute.activeTabId, "agents-existing");
		assert.equal(reconciledExistingRoute.collapsed, true, "passive reconciliation of an existing route keeps the workspace collapsed");
		const reloadedExistingRoute = model.parseDesktopTabState(model.serializeDesktopTabState(reconciledExistingRoute));
		assert.equal(reloadedExistingRoute.collapsed, true);
		assert.equal(reloadedExistingRoute.width, 544);
		const deepLinkedRoute = { area: "workflows", viewWorkflowId: "wf/reload", viewWorkflowVersion: "v 2" };
		const reconciledDeepLink = model.reconcileDesktopRoute(reloadedExistingRoute, deepLinkedRoute, { id: "workflow-deep-link", now: 10 });
		assert.equal(reconciledDeepLink.collapsed, true, "passive reconciliation of a new deep link keeps the workspace collapsed");
		const reloadedDeepLink = model.parseDesktopTabState(model.serializeDesktopTabState(reconciledDeepLink));
		assert.equal(reloadedDeepLink.collapsed, true);
		assert.equal(reloadedDeepLink.width, 544);
		assert.deepEqual(model.activeDesktopTab(reloadedDeepLink).target.route, deepLinkedRoute);
		assert.equal(model.openDesktopTab(reloadedDeepLink, { kind: "route", route: { area: "settings" } }, { id: "explicit-settings", now: 11 }).collapsed, false, "explicit open expands the workspace");
		assert.equal(model.activateDesktopTab(reloadedDeepLink, "agents-existing", 12).collapsed, false, "explicit activation expands the workspace");

		const beforeSessions = restored;
		assert.equal(model.reconcileDesktopRoute(beforeSessions, { area: "sessions", piboSessionId: "ps_1" }), beforeSessions);
		const routed = model.reconcileDesktopRoute(beforeSessions, { area: "agents" }, { id: "agents", now: 9 });
		assert.equal(model.activeDesktopTab(routed).target.route.area, "agents");
		for (const area of ["vscode", "workflows", "cron", "loops", "agents", "context", "settings"]) {
			const next = model.reconcileDesktopRoute(model.emptyDesktopTabState(), { area }, { id: area, now: 10 });
			assert.equal(model.activeDesktopTab(next).target.route.area, area);
		}
		const workflowViewerRoute = { area: "workflows", viewWorkflowId: "wf/deep", viewWorkflowVersion: "v 7" };
		let workflowHistory = model.reconcileDesktopRoute(model.emptyDesktopTabState(), workflowViewerRoute, { id: "workflow-viewer", now: 10 });
		assert.deepEqual(model.activeDesktopTab(workflowHistory).target.route, workflowViewerRoute);
		workflowHistory = model.openDesktopTab(workflowHistory, { kind: "route", route: { area: "settings" } }, { id: "workflow-settings", now: 11 });
		workflowHistory = model.activateDesktopTab(workflowHistory, "workflow-viewer", 12);
		assert.deepEqual(model.desktopRouteForState(workflowHistory, { area: "sessions" }), workflowViewerRoute);
		const reloadedWorkflowHistory = model.parseDesktopTabState(model.serializeDesktopTabState(workflowHistory));
		assert.deepEqual(model.activeDesktopTab(reloadedWorkflowHistory).target.route, workflowViewerRoute);
		assert.equal(model.desktopTabTargetKey(model.activeDesktopTab(reloadedWorkflowHistory).target), "workflows:view:wf/deep:v 7");

		let closeRouteToTool = model.emptyDesktopTabState();
		closeRouteToTool = model.openDesktopTab(closeRouteToTool, { kind: "route", route: { area: "agents" } }, { id: "agent", now: 11 });
		closeRouteToTool = model.openDesktopTab(closeRouteToTool, { kind: "session-tool", tool: "preview" }, { id: "preview-tool", now: 12 });
		closeRouteToTool = model.activateDesktopTab(closeRouteToTool, "agent", 13);
		const beforeRouteClose = closeRouteToTool;
		closeRouteToTool = model.closeDesktopTab(closeRouteToTool, "agent");
		const sessionsRoute = { area: "sessions", roomId: "room_1", piboSessionId: "ps_1" };
		assert.deepEqual(model.desktopRouteForState(closeRouteToTool, sessionsRoute), sessionsRoute);
		let committedRouteClose = null;
		let navigatedAfterClose = null;
		assert.deepEqual(await model.applyGuardedDesktopTabTransition({
			current: beforeRouteClose,
			next: closeRouteToTool,
			sessionsRoute,
			closingTab: beforeRouteClose.tabs.find((tab) => tab.id === "agent"),
			autosave: async () => {},
			onCommit: (next) => { committedRouteClose = next; },
			onNavigate: (route) => { navigatedAfterClose = route; },
		}), { allowed: true });
		assert.equal(committedRouteClose.activeTabId, "preview-tool");
		assert.deepEqual(navigatedAfterClose, sessionsRoute);
		const reloadedTool = model.reconcileDesktopRoute(
			model.parseDesktopTabState(model.serializeDesktopTabState(committedRouteClose)),
			sessionsRoute,
		);
		assert.equal(model.activeDesktopTab(reloadedTool).target.tool, "preview");
		assert.equal(reloadedTool.tabs.some((tab) => tab.target.kind === "route" && tab.target.route.area === "agents"), false);

		const duplicateRoute = {
			id: "workflow-one",
			target: { kind: "route", route: { area: "workflows", draftId: "draft-1" } },
			title: "Workflow one",
			createdAt: 1,
			lastActivatedAt: 1,
		};
		const recovered = model.parseDesktopTabState(JSON.stringify({
			version: 1,
			tabs: [
				duplicateRoute,
				{ ...duplicateRoute, target: { kind: "route", route: { area: "settings" } } },
				{ ...duplicateRoute, id: "workflow-alias", lastActivatedAt: 2 },
				{ ...duplicateRoute, id: "vscode", target: { kind: "route", route: { area: "vscode" } } },
			],
			activeTabId: "workflow-alias",
			width: 520,
			collapsed: false,
		}));
		assert.deepEqual(recovered.tabs.map((tab) => tab.id), ["workflow-one", "vscode"]);
		assert.equal(recovered.activeTabId, "workflow-one", "duplicate target active id aliases to the retained tab");

		assert.equal(model.desktopTabKeepsMounted({ ...duplicateRoute, id: "preview", target: { kind: "session-tool", tool: "preview" } }), true);
		assert.equal(model.desktopTabKeepsMounted({ ...duplicateRoute, id: "raw", target: { kind: "session-tool", tool: "raw-events" } }), false);
		assert.equal(model.desktopTabKeepsMounted({ ...duplicateRoute, id: "workflow" }), false);
		assert.equal(model.desktopTabKeepsMounted({ ...duplicateRoute, id: "agent", target: { kind: "route", route: { area: "agents" } } }), false);

		const saveOrder = [];
		assert.deepEqual(await model.guardDesktopAgentTransition(true, async () => { saveOrder.push("saved"); }), { allowed: true });
		assert.deepEqual(saveOrder, ["saved"]);
		const saveFailure = new Error("save failed");
		const denied = await model.guardDesktopAgentTransition(true, async () => { throw saveFailure; });
		assert.equal(denied.allowed, false);
		assert.equal(denied.error, saveFailure);
		let committedAfterFailure = false;
		const deniedClose = await model.applyGuardedDesktopTabTransition({
			current: beforeRouteClose,
			next: closeRouteToTool,
			sessionsRoute,
			closingTab: beforeRouteClose.tabs.find((tab) => tab.id === "agent"),
			autosave: async () => { throw saveFailure; },
			onCommit: () => { committedAfterFailure = true; },
			onNavigate: () => { throw new Error("must not navigate after save failure"); },
		});
		assert.equal(deniedClose.allowed, false);
		assert.equal(committedAfterFailure, false, "save failure keeps the Agent Designer tab open");

		const storage = new Map();
		model.writeDesktopTabState(routed, { setItem: (key, value) => storage.set(key, value) });
		assert.equal(model.readDesktopTabState({ getItem: (key) => storage.get(key) ?? null }).activeTabId, routed.activeTabId);
		assert.doesNotThrow(() => model.writeDesktopTabState(routed, { setItem: () => { throw new Error("blocked"); } }));
		assert.deepEqual(model.readDesktopTabState({ getItem: () => { throw new Error("blocked"); } }), model.emptyDesktopTabState());
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
