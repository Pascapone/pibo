import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runScenarios() {
	const script = String.raw`
		import React, { useState } from "react";
		import TestRenderer from "react-test-renderer";
		import { AppHeader } from "./src/apps/chat-ui/src/app-chrome.tsx";

		const { act, create } = TestRenderer;

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const results = {};

		function textOf(value) {
			if (typeof value === "string" || typeof value === "number") return String(value);
			if (Array.isArray(value)) return value.map(textOf).join("");
			if (value?.props) return textOf(value.props.children);
			return "";
		}

		function keyboardEvent(key, shiftKey = false) {
			return {
				key,
				shiftKey,
				prevented: false,
				stopped: false,
				preventDefault() { this.prevented = true; },
				stopPropagation() { this.stopped = true; },
			};
		}

		async function mount(initialOpen = false) {
			const listeners = new Map();
			const focusLog = [];
			const selected = [];
			const actionOrder = [];
			const itemNodes = new Map();
			const documentMock = {
				activeElement: null,
				addEventListener(type, listener) { listeners.set(type, listener); },
				removeEventListener(type, listener) {
					if (listeners.get(type) === listener) listeners.delete(type);
				},
			};
			globalThis.document = documentMock;

			function focusNode(name) {
				return {
					name,
					focus() {
						documentMock.activeElement = this;
						focusLog.push(name);
					},
				};
			}
			const triggerNode = focusNode("trigger");
			const sidebarTriggerNode = focusNode("sidebar-trigger");
			const mobileSidebarTriggerRef = { current: null };
			const wrapperNode = {
				name: "wrapper",
				contains(target) {
					return target === this || target === triggerNode || [...itemNodes.values()].includes(target);
				},
			};

			function Harness() {
				const [open, setOpen] = useState(initialOpen);
				return React.createElement(AppHeader, {
					area: "sessions",
					identity: { userId: "test-user", name: "Test User", email: "test@example.com" },
					mobileAreaMenuOpen: open,
					mobileSidebarTriggerRef,
					totalRoomUnreadCount: 2,
					vscodeEnabled: true,
					onOpenMobileSidebar() {},
					onSelectMainNavArea(area) {
						actionOrder.push("select:" + area);
						selected.push(area);
						setOpen(false);
					},
					onToggleMobileAreaMenu() { setOpen((value) => !value); },
					onCloseMobileAreaMenu() {
						actionOrder.push("close");
						setOpen(false);
					},
				});
			}

			let renderer;
			await act(async () => {
				renderer = create(React.createElement(Harness), {
					createNodeMock(element) {
						if (element.type === "button" && element.props["aria-label"] === "Open sidebar") return sidebarTriggerNode;
						if (element.type === "button" && element.props["aria-label"] === "Open navigation menu") return triggerNode;
						if (element.type === "button" && element.props.role === "menuitem") {
							const area = textOf(element.props.children[0]);
							if (!itemNodes.has(area)) itemNodes.set(area, focusNode(area));
							return itemNodes.get(area);
						}
						if (element.type === "div" && String(element.props.className).includes("relative min-[1201px]:hidden")) return wrapperNode;
						return {};
					},
				});
			});

			return {
				renderer,
				listeners,
				focusLog,
				selected,
				actionOrder,
				itemNodes,
				documentMock,
				triggerNode,
				sidebarTriggerNode,
				mobileSidebarTriggerRef,
				trigger: () => renderer.root.findByProps({ "aria-label": "Open navigation menu" }),
				menu: () => renderer.root.findByProps({ role: "menu" }),
				items: () => renderer.root.findAllByProps({ role: "menuitem" }),
				isOpen: () => renderer.root.findAllByProps({ role: "menu" }).length === 1,
			};
		}

		{
			const app = await mount();
			const trigger = app.trigger();
			const desktopNav = app.renderer.root.findByType("nav");
			results.contract = {
				hasPopup: trigger.props["aria-haspopup"],
				controls: trigger.props["aria-controls"],
				expanded: trigger.props["aria-expanded"],
				desktopItems: desktopNav.findAllByType("button").length,
				desktopMenuItems: desktopNav.findAllByProps({ role: "menuitem" }).length,
				sidebarTriggerWired: app.mobileSidebarTriggerRef.current === app.sidebarTriggerNode,
			};
			await act(async () => desktopNav.findAllByType("button").find((button) => textOf(button.props.children) === "projects").props.onClick());
			results.desktopSelection = app.selected;
		}

		for (const key of ["Enter", " ", "ArrowDown", "ArrowUp"]) {
			const app = await mount();
			const event = keyboardEvent(key);
			await act(async () => app.trigger().props.onKeyDown(event));
			results["open-" + (key === " " ? "Space" : key)] = {
				open: app.isOpen(),
				focus: app.focusLog.at(-1),
				prevented: event.prevented,
			};
		}

		{
			const app = await mount();
			app.triggerNode.focus();
			await act(async () => app.trigger().props.onClick());
			results.pointerOpen = { open: app.isOpen(), focus: app.focusLog.at(-1), items: app.items().length };
			const outside = { name: "outside" };
			await act(async () => app.listeners.get("mousedown")({ target: outside }));
			results.outsideClose = { open: app.isOpen(), focus: app.focusLog.at(-1) };
		}

		{
			const app = await mount();
			await act(async () => app.trigger().props.onKeyDown(keyboardEvent("ArrowDown")));
			const menu = app.menu();
			for (const key of ["ArrowUp", "ArrowDown", "End", "Home"]) {
				await act(async () => menu.props.onKeyDown(keyboardEvent(key)));
			}
			results.navigation = [...app.focusLog];
			const escape = keyboardEvent("Escape");
			await act(async () => app.listeners.get("keydown")(escape));
			results.escape = { open: app.isOpen(), focus: app.focusLog.at(-1), prevented: escape.prevented };
		}

		for (const shiftKey of [false, true]) {
			const app = await mount();
			await act(async () => app.trigger().props.onKeyDown(keyboardEvent("ArrowDown")));
			const tab = keyboardEvent("Tab", shiftKey);
			await act(async () => app.menu().props.onKeyDown(tab));
			results[shiftKey ? "shiftTab" : "tab"] = {
				open: app.isOpen(),
				prevented: tab.prevented,
				focus: app.documentMock.activeElement?.name,
			};
		}

		{
			const app = await mount();
			app.triggerNode.focus();
			await act(async () => app.trigger().props.onClick());
			const projects = app.items().find((item) => textOf(item.props.children) === "projects");
			await act(async () => projects.props.onClick());
			results.pointerSelection = { open: app.isOpen(), selected: app.selected, order: app.actionOrder };
		}

		console.log(JSON.stringify(results));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		env: { ...process.env, NODE_ENV: "development" },
		maxBuffer: 1024 * 1024,
	});
	return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("mobile main-navigation menu has complete keyboard, focus, pointer, and desktop behavior", async () => {
	const result = await runScenarios();

	assert.deepEqual(result.contract, {
		hasPopup: "menu",
		controls: "main-navigation-menu",
		expanded: false,
		desktopItems: 9,
		desktopMenuItems: 0,
		sidebarTriggerWired: true,
	});
	assert.deepEqual(result.desktopSelection, ["projects"]);

	for (const scenario of ["open-Enter", "open-Space", "open-ArrowDown"]) {
		assert.deepEqual(result[scenario], { open: true, focus: "sessions", prevented: true });
	}
	assert.deepEqual(result["open-ArrowUp"], { open: true, focus: "settings", prevented: true });
	assert.deepEqual(result.pointerOpen, { open: true, focus: "trigger", items: 9 });
	assert.deepEqual(result.outsideClose, { open: false, focus: "trigger" });
	assert.deepEqual(result.navigation, ["sessions", "settings", "sessions", "settings", "sessions"]);
	assert.deepEqual(result.escape, { open: false, focus: "trigger", prevented: true });
	assert.deepEqual(result.tab, { open: false, prevented: false, focus: "sessions" });
	assert.deepEqual(result.shiftTab, { open: false, prevented: false, focus: "sessions" });
	assert.deepEqual(result.pointerSelection, { open: false, selected: ["projects"], order: ["close", "select:projects"] });
});

test("App delegates mobile navigation focus ownership while preserving bootstrap recovery and the sidebar trigger ref", () => {
	const appSource = readFileSync(resolve("src/apps/chat-ui/src/App.tsx"), "utf8");
	const chromeSource = readFileSync(resolve("src/apps/chat-ui/src/app-chrome.tsx"), "utf8");

	assert.match(appSource, /const mobileSidebarTriggerRef = useRef<HTMLButtonElement>\(null\)/);
	assert.match(appSource, /mobileSidebarTriggerRef=\{mobileSidebarTriggerRef\}/);
	assert.doesNotMatch(appSource, /mobileAreaMenuRef/);
	assert.match(appSource, /<BootstrapLoadError[\s\S]*onRetry=\{\(\) => window\.location\.reload\(\)\}/);
	assert.match(chromeSource, /ref=\{mobileSidebarTriggerRef\}/);
	assert.match(chromeSource, /AlertTriangle, LogOut, List, Menu, RefreshCw, UserRound/);
	assert.match(chromeSource, /export function BootstrapLoadError/);
});
