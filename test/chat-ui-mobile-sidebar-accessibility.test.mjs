import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runHelperAssertions() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import {
			applyMobileSidebarBackgroundIsolation,
			collectMobileSidebarBackgroundElements,
			mobileSidebarA11yProps,
			mobileSidebarFocusTarget,
			mobileSidebarInitialFocusTarget,
		} from "./src/apps/chat-ui/src/mobile-sidebar-accessibility.ts";

		assert.deepEqual(mobileSidebarA11yProps(true, false, "Chat sidebar"), { "aria-hidden": true, inert: true });
		assert.deepEqual(mobileSidebarA11yProps(true, true, "Chat sidebar"), {
			role: "dialog",
			"aria-modal": true,
			"aria-label": "Chat sidebar",
			tabIndex: -1,
		});
		assert.deepEqual(mobileSidebarA11yProps(false, false, "Chat sidebar"), {});
		assert.deepEqual(mobileSidebarA11yProps(false, true, "Chat sidebar"), {});

		const first = { name: "first" };
		const middle = { name: "middle" };
		const last = { name: "last" };
		const outside = { name: "outside" };
		const fallback = { name: "fallback" };
		const focusable = [first, middle, last];
		assert.equal(mobileSidebarInitialFocusTarget(focusable, fallback), first);
		assert.equal(mobileSidebarInitialFocusTarget([], fallback), fallback);
		assert.equal(mobileSidebarFocusTarget(focusable, last, false), first);
		assert.equal(mobileSidebarFocusTarget(focusable, first, true), last);
		assert.equal(mobileSidebarFocusTarget(focusable, outside, false), first);
		assert.equal(mobileSidebarFocusTarget(focusable, outside, true), last);
		assert.equal(mobileSidebarFocusTarget(focusable, middle, false), null);
		assert.equal(mobileSidebarFocusTarget(focusable, middle, true), null);

		function element(name) {
			const attributes = new Map();
			return {
				name,
				parentElement: null,
				children: [],
				inert: false,
				getAttribute(attribute) { return attributes.has(attribute) ? attributes.get(attribute) : null; },
				hasAttribute(attribute) { return attributes.has(attribute); },
				removeAttribute(attribute) { attributes.delete(attribute); },
				setAttribute(attribute, value) { attributes.set(attribute, value); },
			};
		}
		function append(parent, ...children) {
			parent.children.push(...children);
			for (const child of children) child.parentElement = parent;
		}

		const root = element("root");
		const header = element("header");
		const route = element("route");
		const backdrop = element("backdrop");
		const sidebar = element("sidebar");
		const main = element("main");
		backdrop.setAttribute("data-pibo-mobile-sidebar-backdrop", "");
		header.setAttribute("aria-hidden", "false");
		append(root, header, route);
		append(route, backdrop, sidebar, main);

		assert.deepEqual(
			collectMobileSidebarBackgroundElements(sidebar, root).map((item) => item.name),
			["main", "header"],
		);
		const restore = applyMobileSidebarBackgroundIsolation(sidebar, root);
		assert.equal(header.inert, true);
		assert.equal(header.getAttribute("aria-hidden"), "true");
		assert.equal(main.inert, true);
		assert.equal(main.getAttribute("aria-hidden"), "true");
		assert.equal(backdrop.inert, false);
		restore();
		assert.equal(header.inert, false);
		assert.equal(header.getAttribute("aria-hidden"), "false");
		assert.equal(main.inert, false);
		assert.equal(main.hasAttribute("aria-hidden"), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("mobile sidebar helpers cover closed, modal, focus wrap, and background isolation states", async () => {
	await runHelperAssertions();
});

test("every responsive Chat Web drawer applies shared modal semantics and preserves an actionable backdrop", async () => {
	const drawers = [
		["src/apps/chat-ui/src/App.tsx", "Chat sidebar"],
		["src/apps/chat-ui/src/projects/ProjectsSidebar.tsx", "Projects sidebar"],
		["src/apps/chat-ui/src/agents/AgentsSidebar.tsx", "Agents sidebar"],
		["src/apps/chat-ui/src/CronArea.tsx", "Cron jobs sidebar"],
		["src/apps/chat-ui/src/LoopArea.tsx", "Loop jobs sidebar"],
	];

	for (const [path, label] of drawers) {
		const source = await readFile(path, "utf8");
		assert.match(source, /data-pibo-mobile-sidebar/);
		assert.match(source, new RegExp(`mobileSidebarA11yProps\\(isMobileSidebarViewport, mobileSidebarOpen, "${label}"\\)`));
	}

	const backdropSources = await Promise.all([
		"src/apps/chat-ui/src/App.tsx",
		"src/apps/chat-ui/src/projects/ProjectsArea.tsx",
		"src/apps/chat-ui/src/agents/AgentsView.tsx",
		"src/apps/chat-ui/src/CronArea.tsx",
		"src/apps/chat-ui/src/LoopArea.tsx",
	].map((path) => readFile(path, "utf8")));
	for (const source of backdropSources) {
		assert.match(source, /data-pibo-mobile-sidebar-backdrop/);
		assert.match(source, /aria-hidden="true"/);
	}
});

test("App owns initial focus, bidirectional containment, Escape close, and delayed trigger restoration", async () => {
	const [appSource, helperSource, chromeSource] = await Promise.all([
		readFile("src/apps/chat-ui/src/App.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/mobile-sidebar-accessibility.ts", "utf8"),
		readFile("src/apps/chat-ui/src/app-chrome.tsx", "utf8"),
	]);
	assert.match(appSource, /useMobileSidebarModal/);
	assert.match(appSource, /const closeMobileSidebar = useMobileSidebarModal/);
	assert.match(helperSource, /mobileSidebarInitialFocusTarget/);
	assert.match(helperSource, /mobileSidebarFocusTarget/);
	assert.match(helperSource, /event\.key === "Escape"/);
	assert.match(helperSource, /event\.key !== "Tab"/);
	assert.match(helperSource, /applyMobileSidebarBackgroundIsolation/);
	assert.match(helperSource, /requestAnimationFrame/);
	assert.match(helperSource, /triggerRef\.current/);
	assert.match(chromeSource, /mobileSidebarTriggerRef/);
	assert.match(chromeSource, /ref=\{mobileSidebarTriggerRef\}/);
});
