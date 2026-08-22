import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderHeader(area, vscodeEnabled = true) {
	const script = String.raw`
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { AppHeader } = await import("./src/apps/chat-ui/src/app-chrome.tsx");
		const markup = renderToStaticMarkup(React.createElement(AppHeader, {
			area: ${JSON.stringify(area)},
			identity: { userId: "test-user", name: "Test User", email: "test@example.com" },
			mobileAreaMenuOpen: true,
			mobileSidebarTriggerRef: { current: null },
			totalRoomUnreadCount: 0,
			vscodeEnabled: ${JSON.stringify(vscodeEnabled)},
			onOpenMobileSidebar() {},
			onSelectMainNavArea() {},
			onToggleMobileAreaMenu() {},
			onCloseMobileAreaMenu() {},
		}));
		console.log(markup);
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout.trim();
}

test("desktop and mobile main navigation identify the active area", async () => {
	const markup = await renderHeader("vscode");
	const currentButtons = [...markup.matchAll(/<button(?=[^>]*aria-current="page")[^>]*>([\s\S]*?)<\/button>/g)];

	assert.match(markup, /<nav aria-label="Main navigation"/);
	assert.equal(currentButtons.length, 2, "expected one current desktop item and one current mobile item");
	for (const [, contents] of currentButtons) assert.match(contents, />VS Code</);
	assert.match(markup, /max-\[1500px\]:hidden/);
});

test("main navigation hides VS Code without changing the existing account-label breakpoint", async () => {
	const markup = await renderHeader("sessions", false);
	assert.doesNotMatch(markup, />VS Code</);
	assert.match(markup, /max-\[600px\]:hidden/);
	assert.doesNotMatch(markup, /max-\[1500px\]:hidden/);
});
