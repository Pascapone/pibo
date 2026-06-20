import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolveDirname();
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

/**
 * Run an inline tsx scenario and return the parsed JSON written to
 * stdout via the marker `PIBO_HOST_TEST_RESULT::`. The runner does NOT
 * write its own marker after this helper returns, so the scenario has
 * full control over the result shape. Use this for tests that need to
 * drive the host past `resolveWebviewView` (e.g. swap requests,
 * postMessage replays) where the canned runner result format is too
 * narrow.
 */
async function runInlineScenario(scriptBody, { installBundle = false, extensionPath: explicitPath } = {}) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-host-inline-"));
	const extensionPath = explicitPath ?? path.join(tmp, "extension");
	if (!explicitPath) {
		fs.mkdirSync(extensionPath, { recursive: true });
		if (installBundle) makeBundleFixture(extensionPath);
	}
	const script = `
import { createWebviewHost } from "./src/apps/chat-vscode/extension/src/webview-host.ts";
import { createSidecarAuthBridge } from "./src/apps/chat-vscode/extension/src/sidecar-auth.ts";

function makeExtensionContext(extensionPath) {
	const store = new Map();
	return {
		subscriptions: { push: () => undefined },
		workspaceState: {
			get: (k) => store.get(k),
			update: async (k, v) => { store.set(k, v); },
		},
		globalState: { get: () => undefined, update: async () => undefined },
		extensionPath,
	};
}

function makeWebviewView() {
	let html = "";
	const webview = {
		html: "",
		cspSource: "vscode-webview://test-uuid-1234/",
		options: undefined,
		postMessage() { return Promise.resolve(true); },
		onDidReceiveMessage: () => ({ dispose: () => undefined }),
	};
	Object.defineProperty(webview, "html", {
		get() { return html; },
		set(value) { html = value; },
	});
	return {
		webview,
		visible: true,
		onDidDispose: () => ({ dispose: () => undefined }),
	};
}

(async () => {
	const context = makeExtensionContext(${JSON.stringify(extensionPath)});
	const logMessages = [];
	let view;
	let portMappingSet = null;
	try {
		${scriptBody}
	} catch (err) {
		process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({
			error: err && err.message,
			stack: err && err.stack,
		}) + "\\n");
	}
})();
`;
	const result = await execFileAsync(tsxBin, ["--eval", script], {
		cwd: root,
		env: { ...process.env, NODE_ENV: "test" },
	});
	const match = result.stdout.match(/PIBO_HOST_TEST_RESULT::(.+)/);
	if (!match) {
		throw new Error(`inline host test produced no result marker. stdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ""}`);
	}
	return JSON.parse(match[1]);
}

function resolveDirname() {
	// The test file lives at <repo>/test/chat-vscode/webview-host.test.mjs
	// and the repo root is two parents up.
	return path.resolve(new URL(".", import.meta.url).pathname, "..", "..");
}

function makeBundleFixture(extensionPath) {
	const dir = path.join(extensionPath, "dist", "chat-vscode-web");
	fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "index.html"),
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<script type="module" crossorigin src="/apps/chat-vscode/assets/index-fixture.js"></script>
<link rel="stylesheet" crossorigin href="/apps/chat-vscode/assets/index-fixture.css">
</head>
<body>
<div id="root"></div>
</body>
</html>`,
	);
	fs.writeFileSync(path.join(dir, "assets", "index-fixture.js"), `console.log("fixture bundle");\n`);
	fs.writeFileSync(path.join(dir, "assets", "index-fixture.css"), `body { color: red; }\n`);
}

async function runHostScenario(scenario) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-host-test-"));
	const extensionPath = path.join(tmp, "extension");
	fs.mkdirSync(extensionPath, { recursive: true });
	if (scenario.installBundle) makeBundleFixture(extensionPath);

	const script = `
import { createWebviewHost } from "./src/apps/chat-vscode/extension/src/webview-host.ts";
import { createSidecarAuthBridge } from "./src/apps/chat-vscode/extension/src/sidecar-auth.ts";

function makeExtensionContext(extensionPath) {
	const store = new Map();
	return {
		subscriptions: { push: () => undefined },
		workspaceState: {
			get: (k) => store.get(k),
			update: async (k, v) => { store.set(k, v); },
		},
		globalState: { get: () => undefined, update: async () => undefined },
		extensionPath,
	};
}

function makeWebviewView() {
	let html = "";
	const webview = {
		html: "",
		cspSource: "vscode-webview://test-uuid-1234/",
		options: undefined,
		postMessage() { return Promise.resolve(true); },
		onDidReceiveMessage: () => ({ dispose: () => undefined }),
	};
	Object.defineProperty(webview, "html", {
		get() { return html; },
		set(value) { html = value; },
	});
	return {
		webview,
		visible: true,
		onDidDispose: () => ({ dispose: () => undefined }),
	};
}

let view;
let portMappingSet = null;
let logMessages = [];

(async () => {
	const context = makeExtensionContext(${JSON.stringify(extensionPath)});

	try {
		${scenario.script}

		process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({
			html: view && view.webview ? view.webview.html : (view ? view.html : undefined),
			portMappingSet: portMappingSet ? {
				webviewId: portMappingSet.webviewId,
				gatewayBaseUrl: portMappingSet.gatewayBaseUrl,
			} : null,
			logMessages,
		}) + "\\n");
	} catch (err) {
		process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({
			error: err && err.message,
			stack: err && err.stack,
		}) + "\\n");
	}
})();
`;

	const result = await execFileAsync(tsxBin, ["--eval", script], { cwd: root, env: { ...process.env, NODE_ENV: "test" } });
	const match = result.stdout.match(/PIBO_HOST_TEST_RESULT::(.+)/);
	if (!match) {
		throw new Error(`host test produced no result marker. stdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ""}`);
	}
	return JSON.parse(match[1]);
}

describe("chat-vscode/webview-host", () => {
	test("when the sidecar reports healthy and the bundle is present, serves the inlined HTML with a port-mapped base href", async () => {
		const scenario = {
			installBundle: true,
			script: `
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async (url) => {
						if (url.endsWith("/api/auth/sign-in/social")) {
							return new Response(null, { status: 302, headers: { location: "/api/auth/callback/google?code=dev" } });
						}
						return new Response(null, { status: 302, headers: { "set-cookie": "pibo_dev_session=t" } });
					},
				});
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => true,
					tryHandshake: async () => true,
					lastHandshakeError: () => undefined,
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: (opts) => {
						portMappingSet = opts;
						return fakeSidecar;
					},
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
			`,
		};
		const out = await runHostScenario(scenario);
		assert.equal(out.portMappingSet?.webviewId, "test-uuid-1234");
		assert.equal(out.portMappingSet?.gatewayBaseUrl, "http://127.0.0.1:4788");
		assert.match(out.html, /<base href="https:\/\/test-uuid-1234\.vscode-resource\.vscode-cdn\.net:4799\/"/);
		assert.match(out.html, /console\.log\("fixture bundle"\)/);
		assert.doesNotMatch(out.html, /pibo-sidecar-diagnostic/);
		assert.doesNotMatch(out.html, /Pibo Web-Gateway läuft nicht/);
	});

	test("when the sidecar reports unhealthy, serves the empty-state shell", async () => {
		const scenario = {
			installBundle: true,
			script: `
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async () => new Response(null, { status: 200 }),
				});
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => false,
					tryHandshake: async () => false,
					lastHandshakeError: () => undefined,
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: (opts) => { portMappingSet = opts; return fakeSidecar; },
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
			`,
		};
		const out = await runHostScenario(scenario);
		assert.match(out.html, /Pibo Web-Gateway läuft nicht/);
		assert.match(out.html, /pibo gateway:web/);
		assert.doesNotMatch(out.html, /pibo-sidecar-diagnostic/);
	});

	test("when the sidecar fails to start, serves the shell HTML with a diagnostic", async () => {
		const scenario = {
			installBundle: true,
			script: `
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async () => new Response(null, { status: 200 }),
				});
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: () => { throw new Error("port busy"); },
					sidecarLogger: {
						info: (m) => logMessages.push(["info", m]),
						warn: (m) => logMessages.push(["warn", m]),
						error: (m) => logMessages.push(["error", m]),
						debug: () => undefined,
					},
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
			`,
		};
		const out = await runHostScenario(scenario);
		assert.match(out.html, /Pibo Web-Gateway läuft nicht/);
		assert.match(out.html, /pibo-sidecar-diagnostic/);
		assert.match(out.html, /port busy/);
		assert.ok(
			out.logMessages.some(([level, msg]) => level === "error" && msg.includes("port busy")),
			`expected an error log; got ${JSON.stringify(out.logMessages)}`,
		);
	});

	test("swapToInlinedView swaps the empty-state shell for the inlined bundle once the sidecar reports healthy", async () => {
		// Regression test for the 1.4.0 CSP-block bug: the empty-state
		// shell used to navigate via window.location.replace, which VS Code
		// 1.117.0+ blocks via frame-src 'self'. The shell now asks the
		// extension host to swap the webview HTML. The extension host
		// re-probes the gateway and rebuilds the inlined HTML when the
		// gateway becomes reachable.
		const result = await runInlineScenario(
			`
				let healthyNow = false;
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async () => new Response(null, { status: 200 }),
				});
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => healthyNow,
					tryHandshake: async () => healthyNow,
					lastHandshakeError: () => undefined,
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: () => fakeSidecar,
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
				const beforeHtml = view.webview.html;
				healthyNow = true;
				const swapResult = await host.swapToInlinedView();
				const afterHtml = view.webview.html;
				process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({
					beforeIsShell: /Pibo Web-Gateway läuft nicht/.test(beforeHtml),
					afterIsInlined: /<base href="https:\\/\\/test-uuid-1234\\.vscode-resource\\.vscode-cdn\\.net:4799\\/"/.test(afterHtml),
					swapResult,
					afterHtmlPreview: afterHtml.slice(0, 120),
				}) + "\\n");
			`,
			{ installBundle: true },
		);
		if (result.error) throw new Error(`scenario error: ${result.error}\\n${result.stack ?? ""}`);
		assert.ok(result.beforeIsShell, `expected shell HTML before swap`);
		assert.ok(result.afterIsInlined, `expected inlined HTML after swap; got: ${result.afterHtmlPreview}`);
		assert.equal(result.swapResult.ok, true);
	});

	test("swapToInlinedView returns { ok: false, reason } when the gateway is still unhealthy", async () => {
		const result = await runInlineScenario(
			`
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async () => new Response(null, { status: 200 }),
				});
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => false,
					tryHandshake: async () => false,
					lastHandshakeError: () => undefined,
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: () => fakeSidecar,
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
				const swapResult = await host.swapToInlinedView();
				process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({ swapResult }) + "\\n");
			`,
			{ installBundle: true },
		);
		if (result.error) throw new Error(`scenario error: ${result.error}\\n${result.stack ?? ""}`);
		assert.equal(result.swapResult.ok, false);
		assert.match(result.swapResult.reason, /gateway is not reachable/);
	});

	test("swapToInlinedView returns a hint when the gateway is reachable but in Better Auth mode (handshake fails)", async () => {
		// Regression test for the user's 1.4.0 setup: they run the
		// production gateway (Better Auth) on 127.0.0.1:4788. The
		// dev-auth handshake cannot complete against Better Auth (no
		// local OAuth flow), but the gateway is reachable enough for
		// the shell's probe to succeed. swapToInlinedView must return
		// a structured failure that mentions the dev-auth requirement.
		const result = await runInlineScenario(
			`
				const authBridge = createSidecarAuthBridge({
					gatewayBaseUrl: "http://127.0.0.1:4788",
					fetchImpl: async () => new Response(null, { status: 200 }),
				});
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => true,
					tryHandshake: async () => false,
					lastHandshakeError: () => "dev-auth handshake: /api/auth/sign-in/social expected 30x, got 302",
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					createAuthBridgeImpl: () => authBridge,
					createSidecarImpl: () => fakeSidecar,
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
				const swapResult = await host.swapToInlinedView();
				process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({ swapResult }) + "\\n");
			`,
			{ installBundle: true },
		);
		if (result.error) throw new Error(`scenario error: ${result.error}\\n${result.stack ?? ""}`);
		assert.equal(result.swapResult.ok, false);
		assert.match(result.swapResult.reason, /dev-auth handshake did not complete/);
		assert.ok(result.swapResult.hint, "expected a hint about the dev-auth requirement");
		assert.match(result.swapResult.hint, /--auth=local/);
		assert.match(result.swapResult.hint, /auth\.mode = local/);
	});

	test("when a cookieSource is provided, the sidecar receives a wrapped bridge and reuses the cookie", async () => {
		// Regression test for the 1.4.0 403 bug: the room resolver used
		// to call the gateway directly without the dev-auth cookie. The
		// extension now constructs a single auth bridge at activation
		// time and shares it between the sidecar (via cookieSource) and
		// the room resolver. The sidecar's bridge is built from the
		// shared source so the cookie survives webview dispose cycles.
		const result = await runInlineScenario(
			`
				let handshakeCount = 0;
				const cookieSource = {
					getCookieHeader: async () => {
						handshakeCount++;
						return "pibo_dev_session=shared-cookie";
					},
				};
				let capturedSidecarOpts = null;
				const fakeSidecar = {
					port: () => 4799,
					isRunning: () => true,
					getOrigin: () => "https://test-uuid-1234.vscode-resource.vscode-cdn.net:4799",
					isHealthy: async () => true,
					tryHandshake: async () => true,
					lastHandshakeError: () => undefined,
					requestCount: () => 0,
					start: async () => undefined,
					stop: async () => undefined,
				};
				const host = createWebviewHost(context, {
					baseUrl: "http://127.0.0.1:4788",
					cookieSource,
					createAuthBridgeImpl: () => {
						throw new Error("createAuthBridgeImpl must not be called when cookieSource is provided");
					},
					createSidecarImpl: (opts) => {
						capturedSidecarOpts = opts;
						return fakeSidecar;
					},
				});
				view = makeWebviewView();
				await host.resolveWebviewView(view);
				const sidecarCookie = await capturedSidecarOpts.authBridge.getCookieHeader();
				process.stdout.write("PIBO_HOST_TEST_RESULT::" + JSON.stringify({
					handshakeCount,
					sidecarCookie,
					afterHtmlPreview: view.webview.html.slice(0, 120),
				}) + "\\n");
			`,
			{ installBundle: true },
		);
		if (result.error) throw new Error(`scenario error: ${result.error}\\n${result.stack ?? ""}`);
		assert.equal(result.sidecarCookie, "pibo_dev_session=shared-cookie");
		// The cookie source is hit exactly once during sidecar setup;
		// subsequent reads come from the wrapped bridge's cached token.
		assert.equal(result.handshakeCount, 1, `expected handshakeCount === 1; got ${result.handshakeCount}`);
	});
});
