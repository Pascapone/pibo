import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const defaults = await tsImport("../src/plugins/default-packages.ts", import.meta.url);

test("Preview and VS Code are ordinary plugin workspace tabs", async () => {
	const preview = defaults.previewPackageManifest();
	const previewView = preview.contributions.find((entry) => entry.id === "view");
	assert.equal(previewView.view.presentation, "workspace");
	assert.equal(previewView.metadata?.chatRoute, undefined);

	const vscode = defaults.vscodeWebPackageManifest();
	assert.equal(vscode.id, "pibo.vscode-web");
	assert.deepEqual(vscode.services.requires, [{ id: "pibo.chat.extensions", version: "1.0.0" }]);
	const vscodeView = vscode.contributions.find((entry) => entry.id === "view");
	assert.equal(vscodeView.title, "VS Code");
	assert.equal(vscodeView.view.exportName, "VscodeView");
	assert.equal(vscodeView.view.presentation, "workspace");
	assert.equal(vscodeView.metadata?.chatRoute, undefined);

	const desktopTabs = await readFile(new URL("../src/apps/chat-ui/src/desktop-tabs.tsx", import.meta.url), "utf8");
	assert.match(desktopTabs, /pluginViews\.filter\(\(view\) => view\.chatRoutes\.length === 0\)/);
});

test("VS Code plugin backend exposes only validated same-origin integration metadata", async () => {
	const { resolveVscodeWebUrl, setupVscodeWeb } = await tsImport("../src/plugins/packaged-vscode-web.ts", import.meta.url);
	assert.equal(resolveVscodeWebUrl(" /apps/vscode/?quality=stable "), "/apps/vscode/?quality=stable");
	assert.throws(() => resolveVscodeWebUrl("https://code.example/"), /same-origin absolute path/);
	assert.throws(() => resolveVscodeWebUrl("//code.example/"), /same-origin absolute path/);

	let handler;
	let disposed = false;
	const context = {
		register(localId) { assert.equal(localId, "view"); return () => {}; },
		services: {
			require(id) {
				assert.equal(id, "pibo.chat.extensions");
				return { registerApiRoute(next) { handler = next; return () => { disposed = true; }; } };
			},
		},
	};
	const previousUrl = process.env.PIBO_VSCODE_WEB_URL;
	const previousRoot = process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT;
	try {
		process.env.PIBO_VSCODE_WEB_URL = "/apps/vscode/";
		process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT = "/workspace";
		const dispose = setupVscodeWeb(context);
		const response = await handler({ request: new Request("https://pibo.test/api/chat/vscode-web") });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { integration: { url: "/apps/vscode/", workspaceRoot: "/workspace" } });
		assert.equal(await handler({ request: new Request("https://pibo.test/api/chat/other") }), undefined);
		dispose();
		assert.equal(disposed, true);
	} finally {
		if (previousUrl === undefined) delete process.env.PIBO_VSCODE_WEB_URL; else process.env.PIBO_VSCODE_WEB_URL = previousUrl;
		if (previousRoot === undefined) delete process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT; else process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT = previousRoot;
	}
});

test("browser plugin artifacts share the host React Query context", async () => {
	const host = await readFile(new URL("../src/apps/chat-ui/src/plugins/browser-host.tsx", import.meta.url), "utf8");
	const builder = await readFile(new URL("../scripts/build-pibo4-artifacts.mjs", import.meta.url), "utf8");
	assert.match(host, /import \* as ReactQuery from "@tanstack\/react-query"/);
	assert.match(host, /Object\.freeze\(\{ React, ReactDOM, ReactQuery \}\)/);
	assert.match(builder, /filter: \/\^@tanstack\\\/react-query\$\//);
	assert.match(builder, /React Query bridge is unavailable/);
});

test("VS Code browser view validates frame URLs and genuine workbench readiness", async () => {
	const { vscodeWebUrl, vscodeWorkbenchReady } = await tsImport("../src/apps/chat-ui/src/plugins/vscode-view.tsx", import.meta.url);
	assert.equal(vscodeWebUrl("/apps/vscode/", "/root/code/pibo", "https://pibo.test/apps/chat"), "/apps/vscode/?folder=%2Froot%2Fcode%2Fpibo");
	assert.throws(() => vscodeWebUrl("https://code.example/", undefined, "https://pibo.test/apps/chat"), /Pibo Chat origin/);
	for (const theme of [".vs", ".vs-dark", ".hc-black", ".hc-light"]) {
		const selectors = new Set([".monaco-workbench", theme]);
		assert.equal(vscodeWorkbenchReady({ querySelector: (selector) => selectors.has(selector) ? {} : null }), true);
	}
	assert.equal(vscodeWorkbenchReady({ querySelector: () => null }), false);
	const source = await readFile(new URL("../src/apps/chat-ui/src/plugins/vscode-view.tsx", import.meta.url), "utf8");
	assert.match(source, /<iframe/);
	assert.match(source, /allow="clipboard-read; clipboard-write"/);
	assert.match(source, /Starting VS Code…/);
	assert.match(source, /PIBO_VSCODE_WEB_URL/);
});
