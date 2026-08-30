import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const reactDevelopmentEnv = { ...process.env, NODE_ENV: "development" };

test("desktop tab React flows preserve Preview, pause inactive resources, and focus after close", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { act, useEffect, useState } from "react";
		import TestRenderer from "react-test-renderer";
		import { DesktopTabSidebar, desktopCatalogPointerIsOutside, useDesktopTabWorkspace } from "./src/apps/chat-ui/src/desktop-tabs.tsx";
		import { closeHostedWebAnnotations, useHostedPreviewFullscreenRecovery } from "./src/apps/chat-ui/src/session-trace-pane.tsx";
		import { SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		import * as model from "./src/apps/chat-ui/src/desktop-tabs-model.ts";
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
		const workspaceStorage = new Map([[model.DESKTOP_TABS_STORAGE_KEY, model.serializeDesktopTabState(storedWorkspace)]]);
		globalThis.localStorage = {
			getItem(key) { return workspaceStorage.get(key) ?? null; },
			setItem(key, value) { workspaceStorage.set(key, value); },
		};
		let observedWorkspaceState;
		function RouteReconcileHarness({ route }) {
			const workspace = useDesktopTabWorkspace(route, true);
			observedWorkspaceState = workspace.state;
			return React.createElement("div", { "data-collapsed": String(workspace.state.collapsed) });
		}
		let routeRenderer;
		await act(async () => {
			routeRenderer = create(React.createElement(RouteReconcileHarness, { route: { area: "agents" } }));
		});
		assert.equal(observedWorkspaceState.collapsed, true, "initial route reconciliation keeps persisted collapse state");
		assert.equal(observedWorkspaceState.width, 544);
		assert.equal(model.parseDesktopTabState(workspaceStorage.get(model.DESKTOP_TABS_STORAGE_KEY)).collapsed, true, "initial reconciliation must not rewrite storage as expanded");
		const deepLinkedRoute = { area: "workflows", viewWorkflowId: "wf/reload", viewWorkflowVersion: "v 2" };
		await act(async () => {
			routeRenderer.update(React.createElement(RouteReconcileHarness, { route: deepLinkedRoute }));
		});
		assert.equal(observedWorkspaceState.collapsed, true, "history/deep-link reconciliation keeps collapse state");
		assert.deepEqual(model.activeDesktopTab(observedWorkspaceState).target.route, deepLinkedRoute);
		const persistedAfterDeepLink = model.parseDesktopTabState(workspaceStorage.get(model.DESKTOP_TABS_STORAGE_KEY));
		assert.equal(persistedAfterDeepLink.collapsed, true);
		assert.equal(persistedAfterDeepLink.width, 544);
		await act(async () => routeRenderer.unmount());

		const lifecycle = [];
		let focusedTitle = null;
		let observedState;
		let removeSelectedPreview;
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
		initial = model.openDesktopTab(initial, { kind: "session-tool", tool: "preview" }, { id: "preview", now: 1 });
		initial = model.openDesktopTab(initial, { kind: "route", route: { area: "projects", projectId: "project-1" } }, { id: "project", now: 2 });
		initial = model.openDesktopTab(initial, { kind: "route", route: { area: "settings" } }, { id: "settings", now: 3 });
		initial = model.activateDesktopTab(initial, "preview", 4);

		function Harness({ hidden = false }) {
			const [state, setState] = useState(initial);
			const [previewFullscreen, setPreviewFullscreen] = useState(false);
			const [selectedPreview, setSelectedPreview] = useState(preview);
			removeSelectedPreview = () => setSelectedPreview(undefined);
			useHostedPreviewFullscreenRecovery(previewFullscreen, Boolean(selectedPreview), () => setPreviewFullscreen(false));
			observedState = state;
			return React.createElement(DesktopTabSidebar, {
				state,
				vscodeEnabled: false,
				hidden,
				fullscreen: previewFullscreen,
				onStateChange: setState,
				onActivate: (tab) => setState((current) => model.activateDesktopTab(current, tab.id)),
				onClose: (tab) => { setState((current) => model.closeDesktopTab(current, tab.id)); return true; },
				onOpenTarget() {},
				onFocusSessions() {},
				renderPanel: (tab) => tab.target.kind === "session-tool" && tab.target.tool === "preview"
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
		const projectTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Project ·"))[0];
		await act(async () => projectTab.props.onClick());
		const previewFrameAfter = mounted.root.findByType("iframe");
		assert.equal(previewFrameAfter, previewFrameBefore, "Preview iframe remains the same React instance when another tab activates");
		assert.ok(lifecycle.includes("mount:Project · project-1"));

		const settingsTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Settings."))[0];
		await act(async () => settingsTab.props.onClick());
		assert.ok(lifecycle.includes("unmount:Project · project-1"), "inactive Project content unmounts and stops its resources");
		assert.equal(mounted.root.findByType("iframe"), previewFrameBefore);

		const projectAgain = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Project ·"))[0];
		await act(async () => projectAgain.props.onClick());
		await act(async () => projectAgain.props.onKeyDown({ key: "Delete", preventDefault() {} }));
		assert.equal(observedState.activeTabId, "settings");
		assert.match(focusedTitle, /^Settings\./, "Delete moves DOM focus to the deterministic right neighbor");

		const previewTab = mounted.root.findAll((node) => node.props.role === "tab" && node.props.title?.startsWith("Preview."))[0];
		await act(async () => previewTab.props.onClick());
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

		await act(async () => mounted.update(React.createElement(Harness, { hidden: true })));
		assert.equal(mounted.root.findByType("aside").props.hidden, true);
		assert.equal(mounted.root.findAllByType("iframe").length, 0, "removed Preview stays absent while the sidebar hides");

		const plus = { contains: (target) => target === plus || target?.parent === plus };
		const catalog = { contains: (target) => target === catalog };
		assert.equal(desktopCatalogPointerIsOutside(catalog, plus, { parent: plus }), false);
		assert.equal(desktopCatalogPointerIsOutside(catalog, plus, {}), true);

		let closedTool = null;
		let visible = true;
		closeHostedWebAnnotations(true, (tool) => { closedTool = tool; }, (next) => { visible = next; });
		assert.equal(closedTool, "web-annotations");
		assert.equal(visible, true);
		closeHostedWebAnnotations(false, undefined, (next) => { visible = next; });
		assert.equal(visible, false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: reactDevelopmentEnv,
		maxBuffer: 4 * 1024 * 1024,
	});
});
