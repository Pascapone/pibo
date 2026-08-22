import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import {
	BROWSER_USE_OPEN_TABS_TOOL_NAME,
	BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME,
	BROWSER_USE_TOOL_NAME,
	CODEX_BROWSER_TOOL_NAMES,
	CodexBrowserSessionController,
	NODE_REPL_JS_RESET_TOOL_NAME,
	NODE_REPL_JS_TOOL_NAME,
	createCodexBrowserToolDefinitions,
} from "../dist/tools/codex-browser.js";
import { CodexBrowserNodeRepl } from "../dist/tools/codex-browser-node-repl.js";

function fakeToolContext(cwd) {
	return { cwd };
}

test("Codex browser interface is registered as one selectable native capability package", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const catalog = registry.getCapabilityCatalog();
	const tools = new Map(catalog.nativeTools.map((tool) => [tool.name, tool]));
	for (const name of CODEX_BROWSER_TOOL_NAMES) {
		assert.equal(tools.get(name)?.pluginId, "pibo.core");
		assert.equal(tools.get(name)?.hasDefinition, false, `${name} is generated with its session controller at runtime`);
	}
	assert.deepEqual(
		catalog.packages.find((pkg) => pkg.name === "codex-browser-interface")?.toolNames,
		[...CODEX_BROWSER_TOOL_NAMES],
	);

	registry.upsertProfile({
		name: "codex-browser-test",
		create(context) {
			return new InitialSessionContextBuilder("codex-browser-test")
				.addTools(context.getTools(CODEX_BROWSER_TOOL_NAMES))
				.createSession();
		},
	});
	const profile = registry.createProfile("codex-browser-test");
	assert.ok(profile.tools.every((tool) => tool.builtInPiboTool === "codex_browser"));

	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	for (const name of CODEX_BROWSER_TOOL_NAMES) {
		const tool = inspection.tools.find((candidate) => candidate.name === name);
		assert.ok(tool, `${name} should be inspectable`);
		assert.equal(tool.hasDefinition, true);
		assert.equal(tool.registered, true);
		assert.equal(tool.active, true);
	}
});

test("Codex-compatible labels and structured schemas dispatch to one controller", async () => {
	const calls = [];
	const controller = {
		async openTabs() {
			calls.push(["openTabs"]);
			return [{ index: 0, tabId: "abcd", targetId: "target-abcd", title: "Example", url: "https://example.test", type: "page" }];
		},
		async takeScreenshot(input) {
			calls.push(["takeScreenshot", input]);
			return {
				status: "ok",
				sessionName: "pibo-test",
				browserPoolLeaseId: "browser-use:pibo-test",
				tab: { index: 0, tabId: "abcd", targetId: "target-abcd", title: "Example", url: "https://example.test", type: "page" },
				fullPage: Boolean(input?.fullPage),
				mimeType: "image/png",
				data: Buffer.from("png").toString("base64"),
			};
		},
		async use(input) {
			calls.push(["use", input]);
			return { status: "ok", sessionName: "pibo-test", browserPoolLeaseId: "browser-use:pibo-test", command: ["state"], output: { url: "https://example.test" } };
		},
		async js(code, timeoutMs) {
			calls.push(["js", code, timeoutMs]);
			return { status: "ok", stdout: "", stderr: "", result: { type: "number", repr: "2" }, durationMs: 1, executionCount: 1 };
		},
		async jsReset() {
			calls.push(["jsReset"]);
			return { status: "ok", reset: true };
		},
		dispose() {},
	};
	const definitions = createCodexBrowserToolDefinitions(controller);
	const byName = new Map(definitions.map((tool) => [tool.name, tool]));
	assert.equal(byName.get(BROWSER_USE_OPEN_TABS_TOOL_NAME)?.label, "browser_use.open_tabs");
	assert.equal(byName.get(BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME)?.label, "browser_use.take_screenshot");
	assert.equal(byName.get(BROWSER_USE_TOOL_NAME)?.label, "browser_use.browser_use");
	assert.equal(byName.get(NODE_REPL_JS_TOOL_NAME)?.label, "node_repl.js");
	assert.equal(byName.get(NODE_REPL_JS_RESET_TOOL_NAME)?.label, "node_repl.js_reset");

	const cwd = process.cwd();
	const tabsResult = await byName.get(BROWSER_USE_OPEN_TABS_TOOL_NAME).execute("tabs", {}, undefined, undefined, fakeToolContext(cwd));
	assert.match(tabsResult.content[0].text, /target-abcd/);
	const screenshotResult = await byName.get(BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME).execute("shot", { tabId: "abcd", fullPage: true }, undefined, undefined, fakeToolContext(cwd));
	assert.equal(screenshotResult.content[1].type, "image");
	await byName.get(BROWSER_USE_TOOL_NAME).execute("browser", { action: "state" }, undefined, undefined, fakeToolContext(cwd));
	await byName.get(NODE_REPL_JS_TOOL_NAME).execute("js", { code: "1 + 1", timeoutMs: 50 }, undefined, undefined, fakeToolContext(cwd));
	await byName.get(NODE_REPL_JS_RESET_TOOL_NAME).execute("reset", {}, undefined, undefined, fakeToolContext(cwd));

	assert.deepEqual(calls, [
		["openTabs"],
		["takeScreenshot", { tabId: "abcd", fullPage: true }],
		["use", { action: "state" }],
		["js", "1 + 1", 50],
		["jsReset"],
	]);
});

test("Browser Use controller binds command session and managed pool lease to the Pibo session", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-codex-browser-controller-"));
	const homeDir = join(cwd, "browser-use-home");
	mkdirSync(homeDir, { recursive: true });
	const requests = [];
	const controller = new CodexBrowserSessionController({
		cwd,
		piboSessionId: "ps:session/one",
		env: {},
		status: {
			entry: { name: "browser-use", description: "test", guides: [], notes: [], agentContextSnippet: "test" },
			installed: true,
			executablePath: join(cwd, "browser-use-real"),
			rootDir: cwd,
			homeDir,
		},
		async runCommand(request) {
			requests.push(request);
			return { exitCode: 0, stdout: JSON.stringify({ url: "https://example.test" }), stderr: "" };
		},
	});
	try {
		const result = await controller.use({ action: "state" });
		assert.equal(controller.sessionName, "pibo-ps_session_one");
		assert.equal(controller.browserPoolLeaseId, "browser-use:pibo-ps_session_one");
		assert.equal(result.sessionName, controller.sessionName);
		assert.deepEqual(requests[0].args, ["--session", "pibo-ps_session_one", "--json", "state"]);
		assert.equal(requests[0].env.PIBO_BROWSER_POOL_LEASE_ID, "browser-use:pibo-ps_session_one");
		assert.equal(requests[0].env.PIBO_BROWSER_POOL_HOLDER, "pibo-session:ps:session/one");
		assert.equal(requests[0].env.BROWSER_USE_HOME, homeDir);
	} finally {
		await controller.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("Browser Use controller reuses an active auth lease held by the same Pibo session", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-codex-browser-auth-lease-"));
	const homeDir = join(cwd, "browser-use-home");
	const authPoolDir = join(homeDir, "auth-pool");
	const userDataDir = join(authPoolDir, "pibo-chat", "slot-001");
	mkdirSync(authPoolDir, { recursive: true });
	writeFileSync(join(authPoolDir, "leases.json"), JSON.stringify({
		version: 1,
		leases: [{
			id: "pibo-chat-slot-001",
			app: "pibo-chat",
			holder: "ps_bound",
			sessionName: "pibo-auth-pibo-chat-slot-001",
			userDataDir,
			profileName: "PIBo",
			status: "active",
			browserPoolLeaseId: "browser-use:pibo-auth-pibo-chat-slot-001",
			createdAt: "2026-08-10T20:00:00.000Z",
			updatedAt: "2026-08-10T20:00:00.000Z",
			expiresAt: "2099-08-10T20:00:00.000Z",
		}],
	}));
	const requests = [];
	const controller = new CodexBrowserSessionController({
		cwd,
		piboSessionId: "ps_bound",
		env: {},
		status: {
			entry: { name: "browser-use", description: "test", guides: [], notes: [], agentContextSnippet: "test" },
			installed: true,
			executablePath: join(cwd, "browser-use-real"),
			rootDir: cwd,
			homeDir,
		},
		async runCommand(request) {
			requests.push(request);
			return { exitCode: 0, stdout: "{}", stderr: "" };
		},
	});
	try {
		await controller.use({ action: "state" });
		assert.equal(controller.sessionName, "pibo-auth-pibo-chat-slot-001");
		assert.equal(controller.authLeaseId, "pibo-chat-slot-001");
		assert.equal(requests[0].env.PIBO_BROWSER_USE_LEASE_ID, "pibo-chat-slot-001");
		assert.equal(requests[0].env.PIBO_BROWSER_USE_CHROME_USER_DATA_DIR, userDataDir);
		assert.equal(requests[0].env.PIBO_BROWSER_USE_DEFAULT_PROFILE, "PIBo");
	} finally {
		await controller.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("node_repl.js preserves state, reaches the bound browser bridge, resets, and omits host capabilities", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-node-repl-"));
	const browserCalls = [];
	const repl = await CodexBrowserNodeRepl.start({
		async openTabs() {
			browserCalls.push(["openTabs"]);
			return [{ tabId: "abcd", url: "https://example.test" }];
		},
		async use(input) {
			browserCalls.push(["use", input]);
			return { ok: true, input };
		},
	}, cwd);
	try {
		assert.equal((await repl.exec("globalThis.answer = 41")).status, "ok");
		const persisted = await repl.exec("answer + 1");
		assert.equal(persisted.status, "ok");
		assert.equal(persisted.result?.repr, "42");

		const tabs = await repl.exec("const tabs = await browser.openTabs(); tabs[0].url");
		assert.equal(tabs.status, "ok");
		assert.match(tabs.result?.repr ?? "", /example\.test/);
		assert.equal((await repl.exec("tabs[0].tabId")).result?.repr, "'abcd'");
		const action = await repl.exec("await browser.use('state')");
		assert.equal(action.status, "ok");
		assert.deepEqual(browserCalls, [["openTabs"], ["use", { action: "state" }]]);

		const capabilities = await repl.exec("({ requireType: typeof require, processType: typeof process })");
		assert.equal(capabilities.status, "ok");
		assert.match(capabilities.result?.repr ?? "", /requireType: 'undefined'/);
		assert.match(capabilities.result?.repr ?? "", /processType: 'undefined'/);
		assert.equal((await repl.exec("console.log.constructor")).result, null);
		assert.equal((await repl.exec("browser.openTabs.constructor")).result, null);
		const constructorEscape = await repl.exec('globalThis.constructor.constructor("return process")()');
		assert.equal(constructorEscape.status, "error");
		assert.match(constructorEscape.error?.message ?? "", /Code generation from strings disallowed/);

		assert.deepEqual(await repl.reset(), { status: "ok", reset: true, error: undefined });
		const afterReset = await repl.exec("answer");
		assert.equal(afterReset.status, "error");
		assert.equal(afterReset.error?.name, "ReferenceError");
	} finally {
		await repl.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
