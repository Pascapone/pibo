import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { connectCdpTarget, listCdpTargets, openCdpTarget } from "../dist/tools/cdp-client.js";
import { startFixtureServer } from "../packages/pibo-plugin-vscode-web/test-fixtures/fixture-server.mjs";
import { chromeNotFoundError, resolveChromeBinary } from "../packages/pibo-plugin-vscode-web/test-fixtures/chrome-probe.mjs";
import { probeDisplay } from "../packages/pibo-plugin-vscode-web/test-fixtures/display-probe.mjs";

const PILOT_ROOT = fileURLToPath(new URL("../packages/pibo-plugin-vscode-web", import.meta.url));
const FIXTURES_ROOT = join(PILOT_ROOT, "test-fixtures");

// C1-R01: the BUILT pilot browser bundle runs in a real browser with real
// React, real DOM/iframe semantics, and a controlled loopback fixture server.
// This proves the pilot view + fixture only: screenshots show pilot-view
// rendering states, never a productive complete VS Code server installation,
// product gateway, product data, or full IDE/design acceptance. The headful
// pilot view and a later full host integration stay separate claims.

// Test-local mirror of the React-bridge esbuild plugin in
// scripts/build-pibo4-artifacts.mjs (I-owned builder). Mirror drift is caught
// by assertBuilderShimConformity (C1-R06); no shared build helper exists
// because no new generic build abstraction is allowed.
const reactNames = [
	"Children", "Component", "Fragment", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "use", "useActionState", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useOptimistic", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version",
];
const reactShim = `const React = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.React; if (!React) throw new Error("Pibo browser plugin React bridge is unavailable"); export default React; ${reactNames.map((name) => `export const ${name} = React.${name};`).join(" ")}`;
const reactDomShim = `const ReactDOM = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.ReactDOM; if (!ReactDOM) throw new Error("Pibo browser plugin ReactDOM bridge is unavailable"); export default ReactDOM; export const createPortal = ReactDOM.createPortal; export const flushSync = ReactDOM.flushSync; export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;`;
const jsxRuntimeShim = `const React = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.React; if (!React) throw new Error("Pibo browser plugin React bridge is unavailable"); export const Fragment = React.Fragment; export function jsx(type, props, key) { return React.createElement(type, key === undefined ? props : { ...props, key }); } export const jsxs = jsx; export const jsxDEV = jsx;`;
const reactQueryShim = `const ReactQuery = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.ReactQuery; if (!ReactQuery) throw new Error("Pibo browser plugin React Query bridge is unavailable"); export const useQuery = ReactQuery.useQuery; export const useQueryClient = ReactQuery.useQueryClient;`;
const browserBridgePlugin = {
	name: "pibo-browser-bridge",
	setup(buildContext) {
		buildContext.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "pibo-bridge" }));
		buildContext.onResolve({ filter: /^react-dom$/ }, () => ({ path: "react-dom", namespace: "pibo-bridge" }));
		buildContext.onResolve({ filter: /^react\/(?:jsx-runtime|jsx-dev-runtime)$/ }, () => ({ path: "jsx-runtime", namespace: "pibo-bridge" }));
		buildContext.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: "react-query", namespace: "pibo-bridge" }));
		buildContext.onLoad({ filter: /.*/, namespace: "pibo-bridge" }, ({ path }) => ({ contents: path === "react" ? reactShim : path === "react-dom" ? reactDomShim : path === "react-query" ? reactQueryShim : jsxRuntimeShim, loader: "js" }));
	},
};

const VIEW_STATE_READER = `(() => {
	const main = document.querySelector('main[aria-label="VS Code Web"]');
	if (!main) return { mounted: false };
	const alert = main.querySelector('[role="alert"]');
	const iframe = main.querySelector('iframe[title="VS Code Web"]');
	const status = main.querySelector('[role="status"]');
	return {
		mounted: true,
		checking: main.textContent.includes("Connecting to VS Code Web"),
		alertText: alert ? alert.textContent.slice(0, 500) : null,
		hasRetry: !!alert?.querySelector("button"),
		iframe: iframe ? {
			src: iframe.getAttribute("src"),
			visible: iframe.classList.contains("visible"),
			ariaHidden: iframe.getAttribute("aria-hidden"),
			fixtureWorkbench: (() => { try { return !!iframe.contentDocument?.querySelector(".monaco-workbench"); } catch { return "cross-origin"; } })(),
		} : null,
		starting: !!status,
		htmlBytes: main.outerHTML.length,
	};
})()`;

async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

// C1-R2-02: explicit real-browser candidate list for the actual browser flow.
// Usability (regular file + executable) is decided by the shared chrome probe;
// an empty or unusable list there never falls back to other system paths.
const DEFAULT_CHROME_CANDIDATES = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);

function chromeVersionText(binary) {
	try {
		const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000 });
		return (result.stdout ?? result.stderr ?? "").trim() || "unknown";
	} catch {
		return "unknown";
	}
}

async function displayDiscovery() {
	const { binary: chromeBinary, checked: chromeChecked } = await resolveChromeBinary(DEFAULT_CHROME_CANDIDATES);
	const display = await probeDisplay();
	return { chromeBinary, chromeChecked, ...display };
}

function headfulBlockedError(discovery, detail) {
	return new Error([
		"HEADFUL_BLOCKED (C1-R01): no usable display for headful Chromium.",
		`Discovery: ${discovery.detail}; chrome=${discovery.chromeBinary ?? "none"}.`,
		`Cause: ${detail}`,
		"Need: an X server/Xvfb/Wayland display for headful chrome (no --headless flag).",
		"The headless supplement in this file validates all fixture machinery except headful mode.",
	].join("\n"));
}

function chromeLaunchFailedError(argv, chromeLogTail, cause) {
	return new Error([
		"CHROME_LAUNCH_FAILED: Chromium started but did not expose CDP.",
		`Cause: ${cause}`,
		`Argv: ${JSON.stringify(argv)}`,
		`Stderr tail: ${chromeLogTail || "empty"}`,
	].join("\n"));
}

async function freePort() {
	const { createServer } = await import("node:net");
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			probe.close(() => resolve(address.port));
		});
	});
}

async function waitForCdp(cdpUrl, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const response = await fetch(`${cdpUrl}/json/version`);
			if (response.ok) return await response.json();
		} catch {
			// not up yet
		}
		if (Date.now() >= deadline) throw new Error(`CDP endpoint ${cdpUrl} did not answer within ${timeoutMs} ms`);
		await sleep(200);
	}
}

async function waitFor(expression, client, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await client.evaluate(`(() => { try { return (${expression}); } catch { return "__c1_error__"; } })()`);
		if (value !== "__c1_error__" && value !== undefined && value !== null && value !== false) return value;
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
		await sleep(100);
	}
}

async function stopChrome(chrome) {
	if (!chrome.pid) return;
	try {
		process.kill(-chrome.pid, "SIGTERM");
	} catch {
		try { chrome.kill("SIGTERM"); } catch { /* ignore */ }
	}
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		try {
			process.kill(chrome.pid, 0);
		} catch {
			return;
		}
		await sleep(100);
	}
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {
		try { chrome.kill("SIGKILL"); } catch { /* ignore */ }
	}
}

async function runBrowserFlow({ headful }) {
	const mode = headful ? "headful" : "headless";
	const discovery = await displayDiscovery();
	// C1-R2-02: one binary gate for both modes, ahead of the display gate.
	if (!discovery.chromeBinary) throw chromeNotFoundError(discovery.chromeChecked);
	if (headful && discovery.verdict === "none") {
		throw headfulBlockedError(discovery, "no reachable X11 or Wayland display");
	}

	const root = await mkdtemp(join(tmpdir(), `pibo-c1-browser-${mode}-`));
	const staticDir = join(root, "static");
	const evidenceDir = join(root, "evidence");
	await mkdir(staticDir, { recursive: true });
	await mkdir(evidenceDir, { recursive: true });
	const shortTmp = join(root, "ctmp");
	await mkdir(shortTmp, { recursive: true });

	let fixture;
	let chrome;
	let chromeLogFd;
	let chromeLogPath;
	let client;
	const flow = { failures: [] };
	try {
	await assertBuilderShimConformity();
	await build({
		entryPoints: [join(PILOT_ROOT, "src/browser.ts")],
		outfile: join(staticDir, "pilot-browser.js"),
		bundle: true,
		platform: "browser",
		format: "esm",
		target: "es2022",
		jsx: "automatic",
		plugins: [browserBridgePlugin],
		loader: { ".css": "empty" },
		sourcemap: false,
		legalComments: "none",
		logLevel: "warning",
	});
	const pilotText = await readFile(join(staticDir, "pilot-browser.js"), "utf8");
	assert.ok(pilotText.includes("__PIBO_BROWSER_PLUGIN_BRIDGE__"));
	assert.ok(pilotText.includes("VscodeView"));

	await build({
		entryPoints: [join(FIXTURES_ROOT, "fixture-support.jsx")],
		outfile: join(staticDir, "fixture-support.js"),
		bundle: true,
		platform: "browser",
		format: "esm",
		target: "es2022",
		jsx: "automatic",
		// Production React like the shipped chat-ui build: dev-only warnings
		// (e.g. lucide-react 0.545.0 renders key-less SVG nodes, warning only
		// in development React) must not pollute the console transcript.
		define: { "process.env.NODE_ENV": '"production"' },
		loader: { ".css": "empty" },
		sourcemap: false,
		legalComments: "none",
		logLevel: "warning",
	});
	const supportText = await readFile(join(staticDir, "fixture-support.js"), "utf8");
	assert.ok(supportText.includes("__C1_FIXTURE__"));
	assert.ok(supportText.includes("__PIBO_BROWSER_PLUGIN_BRIDGE__"), "support bundle provides the bridge");
	assert.ok(!supportText.includes("bridge is unavailable"), "support bundle uses real React, no shims");
	await cp(join(FIXTURES_ROOT, "fixture-page.html"), join(staticDir, "fixture.html"));
	await cp(join(FIXTURES_ROOT, "fixture-vscode.html"), join(staticDir, "fixture-vscode.html"));

	fixture = await startFixtureServer({ staticDir });
	const baseUrl = `http://127.0.0.1:${fixture.port}`;
	const cdpPort = await freePort();
	const cdpUrl = `http://127.0.0.1:${cdpPort}`;
	const profileDir = join(root, "chrome-profile");
	const argv = [
		...(headful ? [] : ["--headless=new"]),
		"--no-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--no-first-run",
		"--no-default-browser-check",
		"--force-device-scale-factor=1",
		"--window-size=1280,800",
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${profileDir}`,
		"about:blank",
	];
	if (headful) assert.ok(!argv.some((flag) => flag.startsWith("--headless")), "headful run must not pass --headless");
	chromeLogPath = join(root, "chrome-stderr.log");
	chromeLogFd = await import("node:fs").then((fs) => fs.openSync(chromeLogPath, "w"));
	chrome = spawn(discovery.chromeBinary, argv, {
		detached: true,
		stdio: ["ignore", "ignore", chromeLogFd],
		env: { ...process.env, TMPDIR: shortTmp, TEMP: shortTmp, TMP: shortTmp },
	});
	chrome.unref();
		let chromeVersion;
		try {
			chromeVersion = await waitForCdp(cdpUrl, headful ? 20_000 : 15_000);
		} catch (error) {
			const tail = await readFile(chromeLogPath, "utf8").then((text) => text.trim().split("\n").slice(-5).join(" | ").slice(0, 800)).catch(() => "");
			throw chromeLaunchFailedError(argv, tail, error.message);
		}
		await writeFile(join(evidenceDir, `${mode}-argv.json`), JSON.stringify({ headful, argv, chromeVersion }, null, 2));
		await writeFile(join(evidenceDir, `${mode}-discovery.json`), JSON.stringify({ ...discovery, chromeVersionText: chromeVersionText(discovery.chromeBinary) }, null, 2));

		const target = await openCdpTarget(`${baseUrl}/fixture.html`, { cdpUrl });
		client = await connectCdpTarget(target);
		await client.send("Page.enable");
		await waitFor(`document.readyState === "complete" && !!window.__C1_FIXTURE__`, client, 15_000, "fixture page with harness");

		const apiRequests = () => fixture.log.filter((entry) => entry.path === "/api/chat/vscode-web");
		async function screenshot(name) {
			const shot = await client.send("Page.captureScreenshot", { format: "png" });
			await writeFile(join(evidenceDir, `${mode}-${name}.png`), Buffer.from(shot.data, "base64"));
		}
		async function viewState() {
			return client.evaluate(VIEW_STATE_READER);
		}

		// Scenario A: unconfigured fallback path.
		fixture.setMode("fallback");
		await client.evaluate(`window.__C1_FIXTURE__.mount("/pilot-browser.js")`);
		let state = await waitFor(`window.__C1_FIXTURE__ && document.querySelector('main[aria-label="VS Code Web"] [role="alert"]') ? true : false`, client, 10_000, "fallback panel");
		assert.equal(state, true);
		state = await viewState();
		assert.equal(state.mounted, true);
		assert.ok(state.alertText.includes("VS Code Web unavailable"), `fallback panel text, got: ${state.alertText}`);
		assert.ok(state.alertText.includes("PIBO_VSCODE_WEB_URL"), "fallback names the configuration knob");
		assert.equal(state.hasRetry, true);
		assert.equal(state.iframe, null);
		assert.equal(apiRequests().length, 1);
		await screenshot("fallback");
		await writeFile(join(evidenceDir, `${mode}-dom-fallback.json`), JSON.stringify(state, null, 2));

		// Scenario B: Retry refetches and surfaces the server error, then recovers.
		fixture.setMode("fail-once");
		fixture.resetFailOnce();
		await client.evaluate(`document.querySelector('main[aria-label="VS Code Web"] [role="alert"] button').click()`);
		for (let i = 0; i < 100 && apiRequests().length < 2; i++) await sleep(100);
		assert.equal(apiRequests().length, 2, "Retry must refetch the integration route");
		for (let i = 0; i < 100; i++) {
			state = await viewState();
			if (state.alertText?.includes("500")) break;
			await sleep(100);
		}
		assert.ok(state.alertText?.includes("500"), `server error surfaces, got: ${state.alertText}`);
		await client.evaluate(`document.querySelector('main[aria-label="VS Code Web"] [role="alert"] button').click()`);
		for (let i = 0; i < 100 && apiRequests().length < 3; i++) await sleep(100);
		for (let i = 0; i < 100; i++) {
			state = await viewState();
			if (state.alertText?.includes("not configured")) break;
			await sleep(100);
		}
		assert.ok(state.alertText?.includes("not configured"), `second retry returns to fallback, got: ${state.alertText}`);
		await screenshot("retry");

		// Scenario C: ready path with a real iframe and controlled fixture workbench markers.
		fixture.setMode("ready");
		await client.evaluate(`window.__C1_FIXTURE__.unmount(); window.__C1_FIXTURE__.mount("/pilot-browser.js")`);
		for (let i = 0; i < 150; i++) {
			state = await viewState();
			if (state.iframe?.visible) break;
			await sleep(100);
		}
		assert.ok(state.iframe, "ready path renders an iframe");
		assert.equal(state.iframe.src, "/fixture-vscode");
		assert.equal(state.iframe.visible, true);
		assert.equal(state.iframe.ariaHidden, "false");
		assert.equal(state.iframe.fixtureWorkbench, true, "controlled fixture counterpart exposes .monaco-workbench markers (not a real VS Code server)");
		await screenshot("ready");
		await writeFile(join(evidenceDir, `${mode}-dom-ready.json`), JSON.stringify(state, null, 2));

		// Scenario D: abort during a slow probe keeps checking without a request storm.
		fixture.setMode("slow");
		await client.evaluate(`window.__C1_FIXTURE__.unmount(); window.__C1_FIXTURE__.mount("/pilot-browser.js")`);
		await sleep(150);
		const beforeAbort = apiRequests().length;
		await client.evaluate(`window.__C1_FIXTURE__.abort()`);
		await sleep(900);
		state = await viewState();
		assert.equal(state.checking, true, "aborted probe stays visibly checking until the host unmounts the view (observed here; whether the real host unmounts immediately is a host-lifecycle question, no product contract asserted)");
		assert.equal(apiRequests().length, beforeAbort, "no request storm after abort");
		assert.equal(apiRequests().at(-1).aborted, true, "server observed the aborted fetch");
		await screenshot("abort");

		// Scenario E: unmount empties the DOM and stops further requests.
		const domAfterUnmount = await client.evaluate(`window.__C1_FIXTURE__.unmount()`);
		assert.equal(domAfterUnmount, "");
		const beforeIdle = apiRequests().length;
		await sleep(400);
		assert.equal(apiRequests().length, beforeIdle, "unmount stops polling and fetching");

		const consoleLog = await client.evaluate(`window.__C1_CONSOLE__`);
		const errors = consoleLog.filter((entry) => entry.level === "error");
		assert.deepEqual(errors, [], `no page errors, got: ${JSON.stringify(errors)}`);
		await writeFile(join(evidenceDir, `${mode}-console.json`), JSON.stringify(consoleLog, null, 2));
		await writeFile(join(evidenceDir, `${mode}-requests.json`), JSON.stringify(fixture.log, null, 2));
		flow.evidence = { scenarios: ["fallback", "retry", "ready", "abort", "unmount"], requests: fixture.log.length };
		console.log(JSON.stringify({ browserPilot: "pibo.vscode-web", mode, headful, ...flow.evidence }));
	} finally {
		try { client?.close(); } catch { /* ignore */ }
		if (chrome) await stopChrome(chrome);
		if (chromeLogFd !== undefined) {
			try {
				const { closeSync } = await import("node:fs");
				closeSync(chromeLogFd);
			} catch { /* ignore */ }
		}
		await fixture?.close().catch(() => {});
		const evidenceTarget = process.env.C1_BROWSER_EVIDENCE_DIR;
		if (evidenceTarget) {
			await mkdir(evidenceTarget, { recursive: true });
			const { readdir, copyFile } = await import("node:fs/promises");
			for (const name of await readdir(evidenceDir).catch(() => [])) {
				await copyFile(join(evidenceDir, name), join(evidenceTarget, name)).catch(() => {});
			}
			await cp(chromeLogPath, join(evidenceTarget, `${mode}-chrome-stderr.log`)).catch(() => {});
		}
		await rm(root, { recursive: true, force: true });
	}
}

async function assertBuilderShimConformity() {
	const builder = await readFile(new URL("../scripts/build-pibo4-artifacts.mjs", import.meta.url), "utf8");
	const self = await readFile(new URL(import.meta.url), "utf8");
	for (const [name, shim] of Object.entries({ reactDom: reactDomShim, jsxRuntime: jsxRuntimeShim, reactQuery: reactQueryShim })) {
		assert.ok(builder.includes(shim), `test-local ${name} bridge shim diverged from scripts/build-pibo4-artifacts.mjs`);
	}
	// reactShim is generated from reactNames: pin the static prefix, the name
	// list, and the generator line against the builder instead of the expansion.
	const staticPrefix = 'const React = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.React; if (!React) throw new Error("Pibo browser plugin React bridge is unavailable"); export default React; ';
	assert.ok(reactShim.startsWith(staticPrefix), "test-local react shim changed shape");
	assert.ok(builder.includes(staticPrefix), "builder react shim prefix diverged");
	const listPattern = /const reactNames = \[([\s\S]*?)\];/;
	const mine = self.match(listPattern)?.[1].replace(/\s+/g, "");
	const theirs = builder.match(listPattern)?.[1].replace(/\s+/g, "");
	assert.ok(mine && theirs, "reactNames list not found in test or builder");
	assert.equal(mine, theirs, "test-local reactNames diverged from scripts/build-pibo4-artifacts.mjs");
	const generatorLine = self.split("\n").find((line) => line.includes("reactNames.map"));
	assert.ok(generatorLine && builder.includes(generatorLine.trim()), "react shim generator line diverged from builder");
}

test("C1 R01 headful: VS Code pilot view mounts ready/fallback paths in headful Chromium", async () => {
	await runBrowserFlow({ headful: true });
});

test("C1 R01 supplement (headless, NOT headful acceptance): fixture machinery and DOM flow", async () => {
	await runBrowserFlow({ headful: false });
});
