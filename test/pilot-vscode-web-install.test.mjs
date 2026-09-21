import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build, version as esbuildVersion } from "esbuild";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { vscodeWebPackageManifest } from "../dist/plugins/default-packages.js";
import { PluginHost } from "../dist/plugins/host.js";
import { PluginManager } from "../dist/plugins/manager.js";
import { PIBO_CHAT_EXTENSION_SERVICE, PiboChatExtensionRegistry } from "../dist/plugins/product-services.js";

const PLUGIN_ID = "pibo.vscode-web";
const ROUTE = "http://localhost/api/chat/vscode-web";
const PILOT_ROOT = fileURLToPath(new URL("../packages/pibo-plugin-vscode-web", import.meta.url));

// Proof boundary (C1-R05): real PluginManager + SQLite store (staging,
// content-hash verify, drain protocol) and real PluginHost (graph validation,
// setup, disposal). The host runs setup imported from the INSTALLED managed
// artifactPath (read back from the store after activation), never from the
// temporary source tree. Test-local glue: the manager lifecycle is an
// import-only state machine, and the manager record is wired into
// host.start/add manually. The product join (lifecycle <-> host) lives in
// I-owned product-runtime.ts and is NOT duplicated here.

// Test-local mirror of the React-bridge esbuild plugin in
// scripts/build-pibo4-artifacts.mjs (I-owned builder). Mirror drift is caught
// by assertBuilderShimConformity below (C1-R06).
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

function assertPortableBackend(backendText, backendMeta) {
	assert.doesNotMatch(backendText, /from\s+["']\./);
	assert.doesNotMatch(backendText, /import\s*\(\s*["']\./);
	assert.ok(!backendText.includes("../src/"), "backend bundle must not reference in-repo sources");
	const inputs = Object.keys(backendMeta.inputs ?? {});
	assert.ok(inputs.length > 0, "backend metafile must list bundle inputs");
	for (const input of inputs) {
		assert.ok(!input.includes("node_modules"), `backend bundle must not bundle npm dependency ${input}`);
	}
	return inputs;
}

function assertBridgedBrowser(browserText) {
	for (const bare of ['from "react"', "from 'react'", 'from "react-dom"', 'from "react/jsx-runtime"', 'from "@tanstack/react-query"']) {
		assert.ok(!browserText.includes(bare), `browser bundle must bridge ${bare}`);
	}
	assert.ok(browserText.includes("__PIBO_BROWSER_PLUGIN_BRIDGE__"));
	assert.ok(browserText.includes("VscodeView"));
}

async function dirBytes(dir) {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) total += await dirBytes(path);
		else total += (await stat(path)).size;
	}
	return total;
}

async function buildPilotSource() {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-pilot-vscode-web-"));
	const source = join(root, "source");
	await mkdir(join(source, "browser"), { recursive: true });
	await cp(join(PILOT_ROOT, "pibo.plugin.json"), join(source, "pibo.plugin.json"));
	await cp(join(PILOT_ROOT, "package.json"), join(source, "package.json"));
	const backendResult = await build({
		entryPoints: [join(PILOT_ROOT, "src/backend.ts")],
		outfile: join(source, "backend.mjs"),
		bundle: true,
		metafile: true,
		platform: "node",
		format: "esm",
		target: "node24",
		packages: "bundle",
		banner: { js: 'import { createRequire as __piboCreateRequire } from "node:module"; const require = __piboCreateRequire(import.meta.url);' },
		sourcemap: false,
		legalComments: "none",
		logLevel: "warning",
	});
	await build({
		entryPoints: [join(PILOT_ROOT, "src/browser.ts")],
		outfile: join(source, "browser/index.js"),
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
	return { root, source, backendMeta: backendResult.metafile };
}

function openManager(root) {
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	let state = "inactive";
	const lifecycle = {
		async activate(artifact) {
			await import(pathToFileURL(join(artifact.artifactPath, artifact.manifest.entrypoints.backend)).href);
			state = "active";
		},
		async deactivate() { state = "inactive"; },
		async status() { return state; },
	};
	const manager = new PluginManager({
		store: data.plugins,
		artifactRoot: join(root, "artifacts"),
		collectConsumers: async () => [],
		lifecycle,
		coreServices: { [PIBO_CHAT_EXTENSION_SERVICE]: { owner: "@pibo/core", version: "1.0.0" } },
	});
	return { data, manager };
}

async function install(manager, store, source) {
	const expectedRevision = store.getInstallation(PLUGIN_ID)?.stateRevision ?? 0;
	return manager.install({ kind: "local", path: source }, { expectedRevision });
}

async function uninstall(manager) {
	const plan = await manager.planUninstall(PLUGIN_ID);
	return manager.confirmUninstall({ planId: plan.id, pluginIdText: PLUGIN_ID, expectedRevision: plan.installationRevision });
}

function artifactSetupUrl(installation) {
	return pathToFileURL(join(installation.artifactPath, installation.manifest.entrypoints.backend)).href;
}

function hostDefinition(installation, setup) {
	return {
		installation: {
			pluginId: installation.pluginId,
			revision: installation.revision,
			version: installation.version,
			contentHash: installation.contentHash,
			manifest: installation.manifest,
			source: installation.source,
			enabled: installation.enabled,
			state: installation.state,
			stateRevision: installation.stateRevision,
			createdAt: installation.createdAt,
		},
		setup,
	};
}

function withVscodeEnv(values, run) {
	const savedUrl = process.env.PIBO_VSCODE_WEB_URL;
	const savedRoot = process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT;
	if (values.url === undefined) delete process.env.PIBO_VSCODE_WEB_URL;
	else process.env.PIBO_VSCODE_WEB_URL = values.url;
	if (values.workspaceRoot === undefined) delete process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT;
	else process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT = values.workspaceRoot;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (savedUrl === undefined) delete process.env.PIBO_VSCODE_WEB_URL;
			else process.env.PIBO_VSCODE_WEB_URL = savedUrl;
			if (savedRoot === undefined) delete process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT;
			else process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT = savedRoot;
		});
}

test("C1 pilot vscode-web: installed artefact serves the preserved route", async () => {
	const { root, source, backendMeta } = await buildPilotSource();
	const { data, manager } = openManager(root);
	const host = new PluginHost();
	const extensions = new PiboChatExtensionRegistry();
	try {
		await assertBuilderShimConformity();

		const pilotManifest = JSON.parse(await readFile(join(source, "pibo.plugin.json"), "utf8"));
		const expectedManifest = { ...vscodeWebPackageManifest(), entrypoints: { backend: "backend.mjs", browser: "browser/index.js" } };
		assert.deepEqual(pilotManifest, expectedManifest);
		assert.deepEqual(pilotManifest.services, { requires: [{ id: "pibo.chat.extensions", version: "1.0.0" }] });

		const wrapper = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
		assert.equal(wrapper.name, "@pasko70/pibo-plugin-vscode-web");
		assert.equal(wrapper.version, "1.0.0");
		assert.equal(wrapper.type, "module");
		assert.deepEqual(wrapper.files, ["pibo.plugin.json", "backend.mjs", "browser"]);
		assert.equal(wrapper.dependencies, undefined);

		const first = await install(manager, data.plugins, source);
		assert.equal(first.installation.pluginId, PLUGIN_ID);
		assert.equal(first.installation.state, "installed");
		const inspected = await manager.inspect({ kind: "local", path: source });
		assert.equal(inspected.contentHash, first.installation.contentHash);
		const installWeightBytes = await dirBytes(join(root, "artifacts"));

		const staged = data.plugins.getInstallation(PLUGIN_ID);
		const stagedBackend = join(staged.artifactPath, staged.manifest.entrypoints.backend);
		const stagedBrowser = join(staged.artifactPath, staged.manifest.entrypoints.browser);
		const backendInputs = assertPortableBackend(await readFile(stagedBackend, "utf8"), backendMeta);
		assertBridgedBrowser(await readFile(stagedBrowser, "utf8"));
		const backendBytes = (await stat(stagedBackend)).size;
		const browserBytes = (await stat(stagedBrowser)).size;

		const activation = await manager.activate(PLUGIN_ID, { expectedRevision: first.installation.stateRevision });
		assert.equal(activation.state, "complete");
		assert.equal(data.plugins.getInstallation(PLUGIN_ID).state, "active");

		const backend = await import(artifactSetupUrl(data.plugins.getInstallation(PLUGIN_ID)));
		assert.equal(typeof backend.setup, "function");

		host.provideCoreService({ id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0", value: extensions });
		await host.start({ plugins: [hostDefinition(data.plugins.getInstallation(PLUGIN_ID), backend.setup)] });
		assert.equal(host.inspect().state, "active");
		assert.deepEqual(host.contributions.list("contribution").map((entry) => entry.key), ["pibo.vscode-web/view"]);

		await withVscodeEnv({}, async () => {
			const fallback = await extensions.dispatchApiRoute({ request: new Request(ROUTE) });
			assert.equal(fallback.status, 200);
			assert.deepEqual(await fallback.json(), { integration: null });

			const wrongMethod = await extensions.dispatchApiRoute({ request: new Request(ROUTE, { method: "POST" }) });
			assert.equal(wrongMethod.status, 405);

			const other = await extensions.dispatchApiRoute({ request: new Request("http://localhost/api/chat/other") });
			assert.equal(other, undefined);
		});
		await withVscodeEnv({ url: "/ide/vscode", workspaceRoot: "/work" }, async () => {
			const configured = await extensions.dispatchApiRoute({ request: new Request(ROUTE) });
			assert.equal(configured.status, 200);
			assert.deepEqual(await configured.json(), { integration: { url: "/ide/vscode", workspaceRoot: "/work" } });
		});
		await withVscodeEnv({ url: "https://evil.example/ide" }, async () => {
			await assert.rejects(extensions.dispatchApiRoute({ request: new Request(ROUTE) }), /same-origin/);
		});

		await host.remove(PLUGIN_ID);
		assert.equal(host.contributions.list("contribution").length, 0);
		assert.equal(await extensions.dispatchApiRoute({ request: new Request(ROUTE) }), undefined);

		const removal = await uninstall(manager);
		assert.equal(removal.state, "complete");
		assert.equal(data.plugins.getInstallation(PLUGIN_ID).state, "uninstalled");

		const second = await install(manager, data.plugins, source);
		assert.equal(second.installation.contentHash, first.installation.contentHash);
		assert.equal(second.installation.state, "installed");
		const reactivation = await manager.activate(PLUGIN_ID, { expectedRevision: second.installation.stateRevision });
		assert.equal(reactivation.state, "complete");
		const reinstalled = data.plugins.getInstallation(PLUGIN_ID);
		const reinstalledBackend = await import(artifactSetupUrl(reinstalled));
		await host.add({ plugins: [hostDefinition(reinstalled, reinstalledBackend.setup)] });
		assert.deepEqual(host.contributions.list("contribution").map((entry) => entry.key), ["pibo.vscode-web/view"]);
		await withVscodeEnv({}, async () => {
			const fallback = await extensions.dispatchApiRoute({ request: new Request(ROUTE) });
			assert.equal(fallback.status, 200);
			assert.deepEqual(await fallback.json(), { integration: null });
		});
		await host.remove(PLUGIN_ID);

		const pilotSrcBytes = (await stat(join(PILOT_ROOT, "src/backend.ts"))).size + (await stat(join(PILOT_ROOT, "src/browser.ts"))).size;
		console.log(JSON.stringify({
			pilot: PLUGIN_ID,
			pilotSrcBytes,
			backendBytes,
			browserBytes,
			installWeightBytes,
			contentHash: first.installation.contentHash,
			backendInputs,
			setupSource: "artifactPath",
			esbuildVersion,
			nodeVersion: process.version,
		}));
	} finally {
		await host.remove(PLUGIN_ID).catch(() => {});
		await host.stop().catch(() => {});
		data.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("C1 pilot vscode-web: installed browser bundle exports the view and its pure helpers", async () => {
	const { root, source } = await buildPilotSource();
	const { data, manager } = openManager(root);
	try {
		await install(manager, data.plugins, source);
		const staged = data.plugins.getInstallation(PLUGIN_ID);
		const stagedBrowser = join(staged.artifactPath, staged.manifest.entrypoints.browser);
		const React = (await import("react")).default;
		const ReactDOM = (await import("react-dom")).default;
		const ReactQuery = await import("@tanstack/react-query");
		globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__ = { React, ReactDOM, ReactQuery };
		try {
			const browser = await import(`${pathToFileURL(stagedBrowser).href}?bridge=vscode-web`);
			assert.equal(typeof browser.VscodeView, "function");
			assert.equal(browser.vscodeWebUrl("/ide", "ws", "http://localhost/"), "/ide?folder=ws");
			assert.throws(() => browser.vscodeWebUrl("https://other.example/ide", undefined, "http://localhost/"), /Pibo Chat origin/);
			assert.equal(browser.vscodeWorkbenchReady(null), false);
			assert.equal(browser.vscodeWorkbenchReady(undefined), false);
			const frame = { querySelector: (selector) => (selector === ".monaco-workbench" || selector === ".vs-dark" ? {} : null) };
			assert.equal(browser.vscodeWorkbenchReady(frame), true);
			const loading = { querySelector: (selector) => (selector === ".monaco-workbench" ? {} : null) };
			assert.equal(browser.vscodeWorkbenchReady(loading), false);
		} finally {
			delete globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__;
		}
	} finally {
		data.close();
		await rm(root, { recursive: true, force: true });
	}
});
