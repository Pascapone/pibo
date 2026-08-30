import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("desktop tab React flows preserve Preview, pause inactive resources, and focus after close", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { useEffect, useState } from "react";
		import TestRenderer, { act } from "react-test-renderer";
		import { DesktopTabSidebar, desktopCatalogPointerIsOutside } from "./src/apps/chat-ui/src/desktop-tabs.tsx";
		import { closeHostedWebAnnotations } from "./src/apps/chat-ui/src/session-trace-pane.tsx";
		import { SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		import * as model from "./src/apps/chat-ui/src/desktop-tabs-model.ts";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
		};

		const lifecycle = [];
		let focusedTitle = null;
		let observedState;
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
			observedState = state;
			return React.createElement(DesktopTabSidebar, {
				state,
				vscodeEnabled: false,
				hidden,
				onStateChange: setState,
				onActivate: (tab) => setState((current) => model.activateDesktopTab(current, tab.id)),
				onClose: (tab) => { setState((current) => model.closeDesktopTab(current, tab.id)); return true; },
				onOpenTarget() {},
				onFocusSessions() {},
				renderPanel: (tab) => tab.target.kind === "session-tool" && tab.target.tool === "preview"
					? React.createElement(SessionLivePreviewPanel, {
						previews: [preview], selectedPreview: preview, loading: false, reloadKey: 0,
						onSelect() {}, onReload() {}, onRefresh() {}, onStart() {}, onStop() {}, onRemove() {},
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
			mounted = TestRenderer.create(React.createElement(Harness), { createNodeMock });
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

		await act(async () => mounted.update(React.createElement(Harness, { hidden: true })));
		assert.equal(mounted.root.findByType("aside").props.hidden, true);
		assert.equal(mounted.root.findByType("iframe"), previewFrameBefore, "fullscreen hiding does not unmount Preview");

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
		maxBuffer: 4 * 1024 * 1024,
	});
});
