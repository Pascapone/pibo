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
});
