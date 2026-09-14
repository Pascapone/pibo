import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const reactDevelopmentEnv = { ...process.env, NODE_ENV: "development" };

test("desktop tab React flows preserve every mounted panel, refresh one tab, dispose on close, and focus deterministically", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { act, useEffect, useState } from "react";
		import TestRenderer from "react-test-renderer";
		import { DesktopTabSidebar, desktopTabInsertionIndex, useDesktopTabWorkspace } from "./src/apps/chat-ui/src/desktop-tabs.tsx";
		import { SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		import * as model from "./src/apps/chat-ui/src/desktop-tabs-model.ts";
		import { SessionTabController } from "./src/apps/chat-ui/src/plugins/session-tab-controller.ts";
		const { create } = TestRenderer;

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.HTMLElement = class HTMLElement {};
		globalThis.window = {
			location: { origin: "http://pibo.test" },
			setTimeout,
			clearTimeout,
			addEventListener() {},
			removeEventListener() {},
			open() {},
		};
		globalThis.document = {
			activeElement: null,
			body: { style: { removeProperty() {} } },
			querySelector() { return null; },
		};

		const storedWorkspace = {
			...model.openDesktopTab(model.emptyDesktopTabState(), { kind: "route", route: { area: "agents" } }, { id: "stored-agents", now: 1 }),
			width: 544,
			collapsed: true,
		};
		let storedTabset = { schemaVersion: 1, piboSessionId: "ps_route", revision: 1, tabs: [], activeTabId: null, layout: model.desktopTabStateToSessionLayout({}, storedWorkspace) };
		const routeController = new SessionTabController("ps_route", {
			read: async () => structuredClone(storedTabset),
			write: async (next, expectedRevision) => {
				assert.equal(expectedRevision, storedTabset.revision);
				storedTabset = structuredClone({ ...next, revision: expectedRevision + 1 });
				return structuredClone(storedTabset);
			},
		});
		await routeController.load();
		let observedWorkspaceState;
		function RouteReconcileHarness({ route }) {
			const workspace = useDesktopTabWorkspace(route, true, routeController);
			observedWorkspaceState = workspace.state;
			return React.createElement("div", { "data-collapsed": String(workspace.state.collapsed) });
		}
		let routeRenderer;
		await act(async () => {
			routeRenderer = create(React.createElement(RouteReconcileHarness, { route: { area: "agents" } }));
		});
		assert.equal(observedWorkspaceState.collapsed, true, "initial route reconciliation keeps persisted collapse state");
		assert.equal(observedWorkspaceState.width, 544);
		assert.equal(model.desktopTabStateFromSessionTabset(routeController.state).collapsed, true, "initial reconciliation must not expand the Session-owned workspace");
		const deepLinkedRoute = { area: "workflows", viewWorkflowId: "wf/reload", viewWorkflowVersion: "v 2" };
		await act(async () => {
			routeRenderer.update(React.createElement(RouteReconcileHarness, { route: deepLinkedRoute }));
		});
		assert.equal(observedWorkspaceState.collapsed, true, "history/deep-link reconciliation keeps collapse state");
		assert.deepEqual(model.activeDesktopTab(observedWorkspaceState).target.route, deepLinkedRoute);
		const persistedAfterDeepLink = model.desktopTabStateFromSessionTabset(routeController.state);
		assert.equal(persistedAfterDeepLink.collapsed, true);
		assert.equal(persistedAfterDeepLink.width, 544);
		await act(async () => routeRenderer.unmount());

		let sessionAWorkspace = model.emptyDesktopTabState();
		sessionAWorkspace = model.openDesktopTab(sessionAWorkspace, { kind: "route", route: { area: "workflows" } }, { id: "a-one", now: 1 });
		sessionAWorkspace = model.openDesktopTab(sessionAWorkspace, { kind: "route", route: { area: "settings" } }, { id: "a-two", now: 2 });
		sessionAWorkspace = model.openDesktopTab(sessionAWorkspace, { kind: "plugin-view", piboSessionId: "ps_switch_a", viewId: "pibo.preview/view", title: "Preview" }, { id: "a-three", now: 3 });
		sessionAWorkspace = model.activateDesktopTab(sessionAWorkspace, "a-two", 4);
		const sessionATabset = {
			schemaVersion: 1,
			piboSessionId: "ps_switch_a",
			revision: 1,
			tabs: [{ instanceId: "a-three", piboSessionId: "ps_switch_a", pluginId: "pibo.preview", viewId: "pibo.preview/view", pluginRevision: "sha256:preview", stateSchemaVersion: 1, state: {}, fallback: "Preview" }],
			activeTabId: "a-three",
			layout: model.desktopTabStateToSessionLayout({}, sessionAWorkspace),
		};
		const emptySessionBTabset = { schemaVersion: 1, piboSessionId: "ps_switch_b", revision: 1, tabs: [], activeTabId: null, layout: {} };
		const emptySessionCTabset = { schemaVersion: 1, piboSessionId: "ps_switch_c", revision: 1, tabs: [], activeTabId: null, layout: {} };
		const switchController = (id, initial, delayed = false) => {
			let stored = structuredClone(initial);
			let releaseRead;
			const controller = new SessionTabController(id, {
				read: () => delayed ? new Promise((resolve) => { releaseRead = () => resolve(structuredClone(stored)); }) : Promise.resolve(structuredClone(stored)),
				write: async (next, expectedRevision) => {
					assert.equal(expectedRevision, stored.revision);
					stored = structuredClone({ ...next, revision: expectedRevision + 1 });
					return structuredClone(stored);
				},
			});
			return { controller, releaseRead: () => releaseRead?.(), stored: () => stored };
		};
		const switchA = switchController("ps_switch_a", sessionATabset);
		const switchB = switchController("ps_switch_b", emptySessionBTabset);
		const switchC = switchController("ps_switch_c", emptySessionCTabset, true);
		await switchA.controller.load();
		await switchB.controller.load();
		void switchC.controller.load();
		const switchControllers = { ps_switch_a: switchA.controller, ps_switch_b: switchB.controller, ps_switch_c: switchC.controller };
		let switchedWorkspaceState;
		function SessionSwitchHarness({ selectedId, selectionGeneration, route }) {
			const workspace = useDesktopTabWorkspace(route, true, switchControllers[selectedId], { selectionGeneration, ready: true });
			switchedWorkspaceState = workspace.state;
			return React.createElement("div", { "data-session": selectedId, "data-active-tab": workspace.state.activeTabId });
		}
		let switchRenderer;
		await act(async () => {
			switchRenderer = create(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_a", selectionGeneration: 1, route: { area: "settings" } }));
		});
		assert.deepEqual(switchedWorkspaceState.tabs.map((tab) => tab.id), ["a-one", "a-two", "a-three"]);
		assert.equal(switchedWorkspaceState.activeTabId, "a-two", "Session A starts with its second tab selected");
		await act(async () => {
			switchRenderer.update(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_b", selectionGeneration: 2, route: { area: "settings" } }));
		});
		assert.deepEqual(switchedWorkspaceState.tabs, [], "a ready empty Session cannot inherit the prior Session's selected route tab during a fast switch");
		assert.deepEqual(model.desktopTabStateFromSessionTabset(switchB.controller.state).tabs, []);
		await act(async () => {
			switchRenderer.update(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_a", selectionGeneration: 3, route: { area: "settings" } }));
		});
		assert.deepEqual(switchedWorkspaceState.tabs.map((tab) => tab.id), ["a-one", "a-two", "a-three"]);
		assert.equal(switchedWorkspaceState.activeTabId, "a-two", "returning to Session A restores its independent active selection");
		await act(async () => {
			switchRenderer.update(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_c", selectionGeneration: 4, route: { area: "settings" } }));
			switchC.releaseRead();
			await Promise.resolve();
		});
		assert.equal(switchC.controller.ready, true);
		assert.deepEqual(switchedWorkspaceState.tabs, [], "a delayed empty Session cannot inherit a stale route when its controller finishes loading");
		assert.deepEqual(model.desktopTabStateFromSessionTabset(switchC.controller.state).tabs, []);
		await act(async () => {
			switchRenderer.update(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_a", selectionGeneration: 5, route: { area: "sessions", piboSessionId: "ps_switch_a" } }));
		});
		assert.equal(switchedWorkspaceState.activeTabId, "a-two", "the Sessions route preserves Session A's stored active tab");
		await act(async () => {
			switchRenderer.update(React.createElement(SessionSwitchHarness, { selectedId: "ps_switch_a", selectionGeneration: 5, route: { area: "cron" } }));
		});
		assert.equal(model.activeDesktopTab(switchedWorkspaceState).target.route.area, "cron", "a new explicit route still reconciles into its current Session owner");
		await act(async () => switchRenderer.unmount());

		const lifecycle = [];
		let focusedTitle = null;
		let observedState;
		let removeSelectedPreview;
		let beforeRefresh = async () => true;
		function ResourceProbe({ name }) {
			useEffect(() => {
				lifecycle.push("mount:" + name);
				return () => lifecycle.push("unmount:" + name);
			}, [name]);
			return React.createElement("div", { "data-resource": name }, name);
		}

		const preview = {
			id: "preview-1",
			piboSessionId: "ps_1",
			label: "Preview one",
			openUrl: "/preview/one",
			publicUrl: "http://pibo.test/preview/one",
			health: "online",
			managed: false,
		};

		let initial = model.emptyDesktopTabState();
		initial = model.openDesktopTab(initial, { kind: "plugin-view", piboSessionId: "ps_1", viewId: "pibo.preview/view", title: "Preview" }, { id: "preview", now: 1 });
		initial = model.openDesktopTab(initial, { kind: "route", route: { area: "workflows", viewWorkflowId: "workflow-1", viewWorkflowVersion: "1.0.0" } }, { id: "workflow", now: 2 });
		initial = model.openDesktopTab(initial, { kind: "route", route: { area: "settings" } }, { id: "settings", now: 3 });
		initial = model.activateDesktopTab(initial, "preview", 4);

		function Harness({ hidden = false }) {
			const [state, setState] = useState(initial);
			const [previewFullscreen, setPreviewFullscreen] = useState(false);
			const [selectedPreview, setSelectedPreview] = useState(preview);
			removeSelectedPreview = () => setSelectedPreview(undefined);
			observedState = state;
			return React.createElement(DesktopTabSidebar, {
				state,
				hidden,
				fullscreen: previewFullscreen,
				onStateChange: setState,
				onActivate: (tab) => setState((current) => model.activateDesktopTab(current, tab.id)),
				onClose: (tab) => { setState((current) => model.closeDesktopTab(current, tab.id)); return true; },
				onBeforeRefresh: (tab) => beforeRefresh(tab),
				onFocusSessions: (tab) => setState((current) => model.closeDesktopTab(current, tab.id)),
				reservedLeftWidth: 300,
				renderPanel: (tab) => tab.target.kind === "plugin-view" && tab.target.viewId === "pibo.preview/view"
					? React.createElement(SessionLivePreviewPanel, {
						previews: selectedPreview ? [selectedPreview] : [], selectedPreview, loading: false, reloadKey: 0,
						onSelect() {}, onReload() {}, onRefresh() {}, onStart() {}, onStop() {}, onRemove() {},
						fullscreen: previewFullscreen,
						onEnterFullscreen: () => setPreviewFullscreen(true),
						onExitFullscreen: () => setPreviewFullscreen(false),
					})
					: React.createElement(ResourceProbe, { name: tab.title }),
			});
		}

		const nodeMocks = new Map();
		const createNodeMock = (element) => {
			const key = element.props.title || element.props["aria-label"] || element.props.role || Math.random();
			if (!nodeMocks.has(key)) nodeMocks.set(key, {
				focus() { focusedTitle = element.props.title || element.props["aria-label"] || null; },
				scrollIntoView() {}, scrollBy() {}, querySelector() { return null; }, querySelectorAll() { return []; },
				contains(target) { return target === this || target?.parent === this; },
			});
			return nodeMocks.get(key);
		};
		let mounted;
		await act(async () => {
			mounted = create(React.createElement(Harness), { createNodeMock });
		});
		const previewFrameBefore = mounted.root.findByType("iframe");
		const workflowPanelBefore = mounted.root.findByProps({ "data-resource": "Workflow · workflow-1" });
		const settingsPanelBefore = mounted.root.findByProps({ "data-resource": "Settings" });
		const workflowTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Workflow ·"))[0];
		await act(async () => workflowTab.parent.props.onClick());
		const previewFrameAfter = mounted.root.findByType("iframe");
		assert.equal(previewFrameAfter, previewFrameBefore, "Preview iframe remains the same React instance when another tab activates");
		assert.equal(mounted.root.findByProps({ "data-resource": "Workflow · workflow-1" }), workflowPanelBefore, "activating a mounted generic panel preserves its React instance");

		const settingsTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Settings."))[0];
		await act(async () => settingsTab.parent.props.onClick());
		assert.equal(mounted.root.findByProps({ "data-resource": "Workflow · workflow-1" }), workflowPanelBefore, "inactive Workflow content stays mounted");
		assert.equal(mounted.root.findByProps({ "data-resource": "Settings" }), settingsPanelBefore, "the selected Settings panel also keeps its instance");
		assert.equal(lifecycle.filter((event) => event === "unmount:Workflow · workflow-1").length, 0);
		assert.equal(mounted.root.findByType("iframe"), previewFrameBefore);

		const workflowMountsBeforeRefresh = lifecycle.filter((event) => event === "mount:Workflow · workflow-1").length;
		const settingsUnmountsBeforeRefresh = lifecycle.filter((event) => event === "unmount:Settings").length;
		const refreshWorkflow = mounted.root.findByProps({ "aria-label": "Refresh Workflow · workflow-1" });
		let releaseRefresh;
		beforeRefresh = () => new Promise((resolve) => { releaseRefresh = resolve; });
		await act(async () => refreshWorkflow.props.onClick({ stopPropagation() {} }));
		assert.equal(lifecycle.filter((event) => event === "mount:Workflow · workflow-1").length, workflowMountsBeforeRefresh, "Refresh does not remount while a leave/save guard is pending");
		await act(async () => { releaseRefresh(true); await Promise.resolve(); });
		assert.equal(lifecycle.filter((event) => event === "mount:Workflow · workflow-1").length, workflowMountsBeforeRefresh + 1, "Refresh remounts its target panel after guards succeed");
		assert.equal(lifecycle.filter((event) => event === "unmount:Workflow · workflow-1").length, 1);
		assert.equal(lifecycle.filter((event) => event === "unmount:Settings").length, settingsUnmountsBeforeRefresh, "Refresh leaves neighboring panels untouched");
		assert.equal(mounted.root.findByProps({ "data-resource": "Settings" }), settingsPanelBefore);
		beforeRefresh = async () => false;
		const workflowMountsBeforeBlockedRefresh = lifecycle.filter((event) => event === "mount:Workflow · workflow-1").length;
		await act(async () => { refreshWorkflow.props.onClick({ stopPropagation() {} }); await Promise.resolve(); });
		assert.equal(lifecycle.filter((event) => event === "mount:Workflow · workflow-1").length, workflowMountsBeforeBlockedRefresh, "failed Refresh guards preserve the existing mount");
		beforeRefresh = async () => true;

		assert.equal(desktopTabInsertionIndex(observedState.tabs, "preview", "settings", "after"), 2);
		const previewDragTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Preview."))[0].parent;
		const settingsDropTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Settings."))[0].parent;
		const dataTransfer = { effectAllowed: "", dropEffect: "", setData() {} };
		await act(async () => previewDragTab.props.onDragStart({ dataTransfer }));
		await act(async () => settingsDropTab.props.onDragOver({
			preventDefault() {}, dataTransfer, clientX: 90,
			currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
		}));
		const gap = mounted.root.findByProps({ "data-pibo-debug": "desktop-tab-drop-gap" });
		assert.equal(gap.props["data-pibo-insertion-index"], 2, "pointer hover exposes the exact prospective insertion index");
		const tabList = mounted.root.findByProps({ role: "tablist" });
		await act(async () => tabList.props.onDragLeave({ currentTarget: { contains: () => false }, relatedTarget: null }));
		assert.equal(mounted.root.findAllByProps({ "data-pibo-debug": "desktop-tab-drop-gap" }).length, 0, "drag leave clears the insertion gap");
		await act(async () => settingsDropTab.props.onDragOver({
			preventDefault() {}, dataTransfer, clientX: 90,
			currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
		}));
		await act(async () => settingsDropTab.props.onDrop({ preventDefault() {} }));
		assert.deepEqual(observedState.tabs.map((tab) => tab.id), ["workflow", "settings", "preview"], "drop uses the visible insertion location");
		assert.equal(mounted.root.findAllByProps({ "data-pibo-debug": "desktop-tab-drop-gap" }).length, 0, "drop clears the insertion gap");

		const workflowAgain = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Workflow ·"))[0];
		await act(async () => workflowAgain.parent.props.onClick());
		const workflowUnmountsBeforeClose = lifecycle.filter((event) => event === "unmount:Workflow · workflow-1").length;
		await act(async () => workflowAgain.props.onKeyDown({ key: "Delete", preventDefault() {} }));
		assert.equal(observedState.activeTabId, "settings");
		assert.equal(lifecycle.filter((event) => event === "unmount:Workflow · workflow-1").length, workflowUnmountsBeforeClose + 1, "Close disposes the mounted panel");
		assert.match(focusedTitle, /^Settings\./, "Delete moves DOM focus to the deterministic right neighbor");

		const previewTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Preview."))[0];
		await act(async () => previewTab.parent.props.onClick());
		const enterPreviewFullscreen = mounted.root.findByProps({ "aria-label": "Enter Preview fullscreen" });
		await act(async () => enterPreviewFullscreen.props.onClick());
		assert.equal(mounted.root.findByType("iframe"), previewFrameBefore, "Preview fullscreen reuses the mounted iframe");
		assert.equal(mounted.root.findByProps({ "data-pibo-debug": "desktop-tab-sidebar" }).props["data-pibo-preview-fullscreen"], "true");
		assert.equal(mounted.root.findByProps({ "data-pibo-debug": "session-live-preview" }).props["data-pibo-preview-fullscreen"], "true");
		assert.equal(mounted.root.findAllByProps({ "data-pibo-debug": "preview-fullscreen-top-bar" }).length, 1);
		const exitPreviewFullscreen = mounted.root.findByProps({ "aria-label": "Exit Preview fullscreen" });
		await act(async () => exitPreviewFullscreen.props.onClick());
		assert.equal(mounted.root.findByType("iframe"), previewFrameBefore, "exiting Preview fullscreen preserves iframe state");
		assert.equal(mounted.root.findByProps({ "data-pibo-debug": "desktop-tab-sidebar" }).props["data-pibo-preview-fullscreen"], "false");
		await act(async () => mounted.root.findByProps({ "aria-label": "Enter Preview fullscreen" }).props.onClick());
		await act(async () => removeSelectedPreview());
		assert.equal(mounted.root.findByProps({ "data-pibo-debug": "desktop-tab-sidebar" }).props["data-pibo-preview-fullscreen"], "false", "losing the selected Preview exits fullscreen");
		assert.equal(mounted.root.findAllByProps({ role: "tablist" }).length, 1, "desktop shell tab controls return after Preview loss");
		assert.equal(mounted.root.findAllByType("iframe").length, 0);

		const newTabButton = mounted.root.findByProps({ "aria-label": "New Tab" });
		await act(async () => newTabButton.props.onClick());
		await act(async () => newTabButton.props.onClick());
		assert.equal(observedState.tabs.filter((tab) => tab.target.kind === "new-tab").length, 2, "+ appends multiple real New Tabs");
		assert.equal(mounted.root.findAllByProps({ "data-pibo-debug": "desktop-new-tab" }).length, 2, "each New Tab owns catalog content in its tabpanel");
		const nodeText = (node) => node.children.map((child) => typeof child === "string" ? child : nodeText(child)).join("");
		const catalogButton = (label) => mounted.root.findAll((node) => node.props["data-catalog-entry"] && nodeText(node).includes(label))[0];
		await act(async () => catalogButton("Settings").props.onClick());
		assert.equal(observedState.tabs.filter((tab) => tab.target.kind === "new-tab").length, 1, "existing singleton closes the active temporary New Tab");
		assert.equal(model.activeDesktopTab(observedState).target.route.area, "settings");
		const remainingNewTab = observedState.tabs.find((tab) => tab.target.kind === "new-tab");
		const remainingNewTabButton = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("New Tab."))[0];
		await act(async () => remainingNewTabButton.parent.props.onClick());
		await act(async () => catalogButton("Workflows").props.onClick());
		assert.equal(observedState.activeTabId, remainingNewTab.id, "new module replaces the active New Tab in place");
		assert.equal(model.activeDesktopTab(observedState).target.route.area, "workflows");
		assert.equal(observedState.tabs.some((tab) => tab.target.kind === "new-tab"), false);

		await act(async () => mounted.update(React.createElement(Harness, { hidden: true })));
		assert.equal(mounted.root.findByType("aside").props.hidden, true);
		assert.equal(mounted.root.findAllByType("iframe").length, 0, "removed Preview stays absent while the sidebar hides");

	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: reactDevelopmentEnv,
		maxBuffer: 4 * 1024 * 1024,
	});
});
