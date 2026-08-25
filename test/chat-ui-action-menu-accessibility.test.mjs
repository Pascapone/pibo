import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function runKeyboardNavigationScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const { nextActionMenuItemIndex } = await import("./src/apps/chat-ui/src/action-menu.tsx");

		assert.equal(nextActionMenuItemIndex("ArrowDown", 0, 3), 1);
		assert.equal(nextActionMenuItemIndex("ArrowDown", 2, 3), 0);
		assert.equal(nextActionMenuItemIndex("ArrowUp", 0, 3), 2);
		assert.equal(nextActionMenuItemIndex("ArrowUp", 2, 3), 1);
		assert.equal(nextActionMenuItemIndex("Home", 2, 3), 0);
		assert.equal(nextActionMenuItemIndex("End", 0, 3), 2);
		assert.equal(nextActionMenuItemIndex("Tab", 1, 3), null);
		assert.equal(nextActionMenuItemIndex("ArrowDown", 0, 0), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: resolve(here, "..") });
}

test("shared action menu keyboard navigation wraps and supports Home and End", async () => {
	await assert.doesNotReject(runKeyboardNavigationScenarios());
});

async function runNestedEscapeOrderingScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { consumeActionMenuEscape } = await import("./src/apps/chat-ui/src/action-menu.tsx");

		let menuOpen = true;
		let drawerOpen = true;
		let focus = "Rename Session";
		const windowCapture = [];
		const documentCapture = [];

		// The outer modal controller registers first, matching the integrated candidate.
		documentCapture.push((event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			drawerOpen = false;
			focus = "Open sidebar";
		});
		// The nested action menu registers later, but window capture runs first in the event path.
		windowCapture.push((event) => consumeActionMenuEscape(
			event,
			() => { menuOpen = false; },
			() => { focus = "Session actions"; },
		));

		const dispatchEscape = () => {
			const event = {
				key: "Escape",
				defaultPrevented: false,
				propagationStopped: false,
				immediatePropagationStopped: false,
				preventDefault() { this.defaultPrevented = true; },
				stopPropagation() { this.propagationStopped = true; },
				stopImmediatePropagation() {
					this.immediatePropagationStopped = true;
					this.propagationStopped = true;
				},
			};
			for (const listener of windowCapture) {
				listener(event);
				if (event.immediatePropagationStopped) break;
			}
			if (!event.propagationStopped) {
				for (const listener of documentCapture) listener(event);
			}
			return event;
		};

		const firstEscape = dispatchEscape();
		assert.equal(menuOpen, false);
		assert.equal(drawerOpen, true);
		assert.equal(focus, "Session actions");
		assert.equal(firstEscape.defaultPrevented, true);

		windowCapture.length = 0;
		const secondEscape = dispatchEscape();
		assert.equal(drawerOpen, false);
		assert.equal(focus, "Open sidebar");
		assert.equal(secondEscape.defaultPrevented, true);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: resolve(here, "..") });
}

test("nested action-menu Escape wins before an earlier document-capture drawer listener", async () => {
	await assert.doesNotReject(runNestedEscapeOrderingScenario());
});

async function runClosedMenuScaleScenario() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		const previousDocument = globalThis.document;
		const previousReact = globalThis.React;
		globalThis.document = { body: { nodeType: 1 } };
		globalThis.React = React;
		try {
			const { ActionMenu, ActionMenuItem } = await import("./src/apps/chat-ui/src/action-menu.tsx");
			const triggers = Array.from({ length: 87 }, (_, index) => React.createElement(
				ActionMenu,
				{ key: index, label: index < 11 ? "Room actions" : "Session actions" },
				React.createElement(ActionMenuItem, { onSelect() {} }, "Action"),
			));
			const html = renderToStaticMarkup(React.createElement(React.Fragment, null, ...triggers));
			assert.equal((html.match(/aria-haspopup="menu"/g) ?? []).length, 87);
			assert.equal((html.match(/role="menu"/g) ?? []).length, 0);
			assert.equal((html.match(/role="menuitem"/g) ?? []).length, 0);
		} finally {
			if (previousDocument === undefined) delete globalThis.document;
			else globalThis.document = previousDocument;
			if (previousReact === undefined) delete globalThis.React;
			else globalThis.React = previousReact;
		}
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: resolve(here, "..") });
}

test("many closed action-menu triggers render no menu portal subtrees", async () => {
	await assert.doesNotReject(runClosedMenuScaleScenario());
});

test("shared action menu owns menu-button semantics and dismissal behavior", () => {
	const source = readFileSync(resolve(here, "../src/apps/chat-ui/src/action-menu.tsx"), "utf8");
	assert.match(source, /aria-haspopup="menu"/);
	assert.match(source, /aria-expanded=\{open\}/);
	assert.match(source, /aria-controls=\{menuId\}/);
	assert.match(source, /role="menu"/);
	assert.match(source, /role="menuitem"/);
	assert.match(source, /max-h-\[calc\(100vh-1rem\)\]/);
	assert.match(source, /overflow-y-auto/);
	assert.match(source, /\{!disabled && open && position && typeof document !== "undefined" \? createPortal\(/);
	assert.doesNotMatch(source, /hidden=\{!open\}/);
	assert.match(source, /event\.key === "Escape"[\s\S]*event\.stopPropagation\(\)[\s\S]*event\.nativeEvent\.stopImmediatePropagation\(\)[\s\S]*triggerRef\.current\?\.focus\(\)/);
	assert.match(source, /event\.key === "Tab"[\s\S]*focusRelativeToTrigger/);
	assert.match(source, /document\.addEventListener\("pointerdown"/);
	assert.match(source, /window\.addEventListener\("keydown", handleEscape, true\)/);
	assert.doesNotMatch(source, /document\.addEventListener\("keydown", handleEscape, true\)/);
});

test("Room and Session actions use the same action menu implementation", () => {
	const roomSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");
	const sessionSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-node.tsx"), "utf8");
	assert.match(roomSource, /<ActionMenu[\s\S]*label=\{`Actions for room \$\{room\.name\}`\}/);
	assert.match(sessionSource, /<ActionMenu[\s\S]*label=\{`Actions for session \$\{safeTitle\}`\}/);
	assert.match(roomSource, /<ActionMenuItem/g);
	assert.match(sessionSource, /<ActionMenuItem/g);
});
