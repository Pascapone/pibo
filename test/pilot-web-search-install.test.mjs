import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build, version as esbuildVersion } from "esbuild";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { webSearchPackageManifest } from "../dist/plugins/default-packages.js";
import { PluginHost } from "../dist/plugins/host.js";
import { PluginManager } from "../dist/plugins/manager.js";

const PLUGIN_ID = "pibo.web-search";
const PILOT_ROOT = fileURLToPath(new URL("../packages/pibo-plugin-web-search", import.meta.url));

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

function isNodeBuiltinSpecifier(specifier) {
	return specifier === "node" || specifier.startsWith("node:");
}

function isAllowedPackage(specifier, allowedPackages) {
	return allowedPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function collectOutputImports(metafile) {
	const found = [];
	for (const [output, meta] of Object.entries(metafile.outputs ?? {})) {
		for (const entry of meta.imports ?? []) {
			found.push({ output, path: entry.path, kind: entry.kind, external: entry.external === true });
		}
	}
	return found;
}

// CC-C03: only node builtins or manifest-declared runtime dependencies may
// remain as external output imports. allowedPackages comes from the pilot
// wrapper package.json (this pilot declares none); the node-platform bundle
// form inlines everything else.
function assertOnlyAllowedOutputImports(metafile, { allowedPackages = [] } = {}) {
	const imports = collectOutputImports(metafile);
	const violations = imports.filter((entry) => entry.external && !isNodeBuiltinSpecifier(entry.path) && !isAllowedPackage(entry.path, allowedPackages));
	assert.deepEqual(violations, [], `bundle output has disallowed external imports: ${JSON.stringify(violations)}`);
	return imports;
}

function assertBridgedBrowser(browserText) {
	for (const bare of ['from "react"', "from 'react'", 'from "react-dom"', 'from "react/jsx-runtime"', 'from "@tanstack/react-query"']) {
		assert.ok(!browserText.includes(bare), `browser bundle must bridge ${bare}`);
	}
	assert.ok(browserText.includes("__PIBO_BROWSER_PLUGIN_BRIDGE__"));
	assert.ok(browserText.includes("ToolFamilyView"));
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
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-pilot-web-search-"));
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
	const browserResult = await build({
		entryPoints: [join(PILOT_ROOT, "src/browser.ts")],
		outfile: join(source, "browser/index.js"),
		bundle: true,
		metafile: true,
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
	return { root, source, backendMeta: backendResult.metafile, browserMeta: browserResult.metafile };
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
	const manager = new PluginManager({ store: data.plugins, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [], lifecycle });
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

test("C1 pilot web-search: installed artefact activates in the real host", async () => {
	const { root, source, backendMeta, browserMeta } = await buildPilotSource();
	const { data, manager } = openManager(root);
	const host = new PluginHost();
	try {
		await assertBuilderShimConformity();

		const pilotManifest = JSON.parse(await readFile(join(source, "pibo.plugin.json"), "utf8"));
		const expectedManifest = { ...webSearchPackageManifest(), entrypoints: { backend: "backend.mjs", browser: "browser/index.js" } };
		assert.deepEqual(pilotManifest, expectedManifest);
		assert.equal(pilotManifest.services, undefined);

		const wrapper = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
		assert.equal(wrapper.name, "@pasko70/pibo-plugin-web-search");
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
		const allowedPackages = Object.keys(wrapper.dependencies ?? {});
		const backendOutputImports = assertOnlyAllowedOutputImports(backendMeta, { allowedPackages });
		const browserOutputImports = assertOnlyAllowedOutputImports(browserMeta, { allowedPackages });
		const backendBytes = (await stat(stagedBackend)).size;
		const browserBytes = (await stat(stagedBrowser)).size;

		const activation = await manager.activate(PLUGIN_ID, { expectedRevision: first.installation.stateRevision });
		assert.equal(activation.state, "complete");
		const activeInstallation = data.plugins.getInstallation(PLUGIN_ID);
		assert.equal(activeInstallation.state, "active");

		const backend = await import(artifactSetupUrl(activeInstallation));
		assert.equal(typeof backend.setup, "function");

		// No core services provided: the pilot declares none and must activate standalone.
		await host.start({ plugins: [hostDefinition(activeInstallation, backend.setup)] });
		assert.equal(host.inspect().state, "active");
		assert.ok(host.inspect().plugins.some((entry) => entry.pluginId === PLUGIN_ID));
		const contributions = host.contributions.list("contribution");
		assert.deepEqual(contributions.map((entry) => entry.key).sort(), ["pibo.web-search/settings", "pibo.web-search/web_search"]);
		const tool = contributions.find((entry) => entry.key === "pibo.web-search/web_search").value;
		assert.equal(tool.contribution.name, "web_search");
		assert.equal(tool.value.name, "web_search");
		assert.equal(tool.value.providerTool.kind, "web_search");
		assert.equal(tool.value.providerTool.provider, "openai");

		await host.remove(PLUGIN_ID);
		assert.equal(host.contributions.list("contribution").length, 0);

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
		assert.deepEqual(host.contributions.list("contribution").map((entry) => entry.key).sort(), ["pibo.web-search/settings", "pibo.web-search/web_search"]);
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
			backendOutputImports,
			browserOutputImports,
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

test("C1-R07/CC-C03: output-import check rejects disallowed external bare imports", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-external-fixture-"));
	try {
		const entry = join(root, "entry.js");
		await writeFile(entry, 'import "definitely-disallowed-c1-fixture";\nimport "@c1-fixture/disallowed/subpath";\nexport const marker = 1;\n');
		const result = await build({
			entryPoints: [entry],
			bundle: true,
			write: false,
			metafile: true,
			platform: "node",
			format: "esm",
			external: ["definitely-disallowed-c1-fixture", "@c1-fixture/disallowed/subpath"],
			logLevel: "warning",
		});
		assert.throws(
			() => assertOnlyAllowedOutputImports(result.metafile, { allowedPackages: [] }),
			(error) => error instanceof assert.AssertionError
				&& error.message.includes("definitely-disallowed-c1-fixture")
				&& error.message.includes("@c1-fixture/disallowed/subpath"),
		);
		assert.throws(
			() => assertOnlyAllowedOutputImports(result.metafile, { allowedPackages: ["@c1-fixture/disallowed"] }),
			(error) => error instanceof assert.AssertionError
				&& error.message.includes("definitely-disallowed-c1-fixture")
				&& !error.message.includes("@c1-fixture/disallowed/subpath"),
		);
		const builtinEntry = join(root, "builtin.js");
		await writeFile(builtinEntry, 'import { readFile } from "node:fs";\nexport const reader = readFile;\n');
		const builtinResult = await build({
			entryPoints: [builtinEntry],
			bundle: true,
			write: false,
			metafile: true,
			platform: "node",
			format: "esm",
			logLevel: "warning",
		});
		const builtinImports = assertOnlyAllowedOutputImports(builtinResult.metafile, { allowedPackages: [] });
		assert.ok(builtinImports.some((entry) => entry.path === "node:fs" && entry.external));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("C1 pilot web-search: installed browser bundle loads through the React bridge", async () => {
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
			const browser = await import(`${pathToFileURL(stagedBrowser).href}?bridge=web-search`);
			assert.equal(typeof browser.ToolFamilyView, "function");
		} finally {
			delete globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__;
		}
	} finally {
		data.close();
		await rm(root, { recursive: true, force: true });
	}
});
