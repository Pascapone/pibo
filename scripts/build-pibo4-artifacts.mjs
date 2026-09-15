import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const outputRoot = resolve(root, "dist/pibo4-artifacts");
const generatedRoot = resolve(root, "dist/.pibo4-generated");
const defaults = await import(new URL("../dist/plugins/default-packages.js", import.meta.url));

const packages = [
	["preview", defaults.previewPackageManifest, "src/plugins/packaged-preview.ts", "setupPreview", [["PreviewView", "src/apps/chat-ui/src/plugins/preview-view.tsx"]]],
	["web-annotations", defaults.webAnnotationsPackageManifest, "src/plugins/packaged-web-annotations.ts", "setup", [["WebAnnotationsView", "src/apps/chat-ui/src/plugins/web-annotations-view.tsx"], ["BuildContextView", "src/apps/chat-ui/src/plugins/build-context-view.tsx"]]],
	["goal-loops", defaults.goalControlPackageManifest, "src/plugins/packaged-goal-loops.ts", "setupGoalControl", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"], ["LoopsView", "src/apps/chat-ui/src/plugins/loops-view.tsx"]]],
	["cron", defaults.cronPackageManifest, "src/plugins/packaged-cron.ts", "setupCron", [["CronView", "src/apps/chat-ui/src/plugins/cron-view.tsx"]]],
	["workflows", defaults.workflowsPackageManifest, "src/plugins/packaged-workflows.ts", "setupWorkflows", [["WorkflowsView", "src/apps/chat-ui/src/plugins/workflows-view.tsx"]]],
	["runtime-pi", defaults.piRuntimePackageManifest, "src/plugins/packaged-runtime-pi.ts", "setupPiRuntime", []],
	["runtime-codex-native", defaults.codexNativeRuntimePackageManifest, "src/plugins/packaged-runtime-codex-native.ts", "setupCodexNativeRuntime", [["RuntimeRequestsView", "src/apps/chat-ui/src/plugins/runtime-requests-view.tsx"]]],
	["runtime-omp", defaults.ompRuntimePackageManifest, "src/plugins/packaged-runtime-omp.ts", "setupOmpRuntime", []],
	["code-runtime", defaults.codeRuntimePackageManifest, "src/plugins/packaged-code-runtime.ts", "setupCodeRuntime", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["file-editing", defaults.fileEditingPackageManifest, "src/plugins/packaged-file-editing.ts", "setupFileEditing", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["web-search", defaults.webSearchPackageManifest, "src/plugins/packaged-web-search.ts", "setupWebSearch", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["browser-tools", defaults.browserToolsPackageManifest, "src/plugins/packaged-browser-tools.ts", "setupBrowserTools", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["gateway-tools", defaults.gatewayToolsPackageManifest, "src/plugins/packaged-gateway-tools.ts", "setupGatewayTools", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["codex-compat", defaults.codexCompatPackageManifest, "src/plugins/packaged-codex-compat.ts", "setupCodexCompat", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["run-control", defaults.runControlPackageManifest, "src/plugins/packaged-run-control.ts", "setupRunControl", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["agent-delegation", defaults.agentDelegationPackageManifest, "src/plugins/packaged-agent-delegation.ts", "setupAgentDelegation", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["mcp-cli", defaults.mcpCliPackageManifest, "src/plugins/packaged-mcp-cli.ts", "setupMcpCli", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["transcription-openai-chatgpt", defaults.openAiChatGptTranscriptionPackageManifest, "src/plugins/packaged-transcription-openai-chatgpt.ts", "setupOpenAiChatGptTranscription", []],
	["transcription-openai", defaults.openAiTranscriptionPackageManifest, "src/plugins/packaged-transcription-openai.ts", "setupOpenAiTranscription", []],
	["standard-profiles", defaults.builtinProfilesPackageManifest, "src/plugins/packaged-profiles.ts", "setupBuiltinProfiles", []],
];

const reactNames = [
	"Children", "Component", "Fragment", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "use", "useActionState", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useOptimistic", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version",
];
const reactShim = `const React = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.React; if (!React) throw new Error("Pibo browser plugin React bridge is unavailable"); export default React; ${reactNames.map((name) => `export const ${name} = React.${name};`).join(" ")}`;
const reactDomShim = `const ReactDOM = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.ReactDOM; if (!ReactDOM) throw new Error("Pibo browser plugin ReactDOM bridge is unavailable"); export default ReactDOM; export const createPortal = ReactDOM.createPortal; export const flushSync = ReactDOM.flushSync; export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;`;
const jsxRuntimeShim = `const React = globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__?.React; if (!React) throw new Error("Pibo browser plugin React bridge is unavailable"); export const Fragment = React.Fragment; export function jsx(type, props, key) { return React.createElement(type, key === undefined ? props : { ...props, key }); } export const jsxs = jsx; export const jsxDEV = jsx;`;
const browserBridgePlugin = {
	name: "pibo-browser-bridge",
	setup(buildContext) {
		buildContext.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "pibo-bridge" }));
		buildContext.onResolve({ filter: /^react-dom$/ }, () => ({ path: "react-dom", namespace: "pibo-bridge" }));
		buildContext.onResolve({ filter: /^react\/(?:jsx-runtime|jsx-dev-runtime)$/ }, () => ({ path: "jsx-runtime", namespace: "pibo-bridge" }));
		buildContext.onLoad({ filter: /.*/, namespace: "pibo-bridge" }, ({ path }) => ({ contents: path === "react" ? reactShim : path === "react-dom" ? reactDomShim : jsxRuntimeShim, loader: "js" }));
	},
};

await rm(outputRoot, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

for (const [packageSuffix, manifestFactory, backendSource, backendExport, browserExports] of packages) {
	const manifest = manifestFactory();
	const packageRoot = join(outputRoot, packageSuffix);
	await mkdir(packageRoot, { recursive: true });
	const backendEntry = join(generatedRoot, `${packageSuffix}-backend.ts`);
	await writeFile(backendEntry, `export { ${backendExport} as setup } from ${JSON.stringify(resolve(root, backendSource))};\n`);
	await build({
		entryPoints: [backendEntry],
		outfile: join(packageRoot, "backend.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		packages: "bundle",
		banner: { js: 'import { createRequire as __piboCreateRequire } from "node:module"; const require = __piboCreateRequire(import.meta.url);' },
		sourcemap: false,
		legalComments: "none",
		logLevel: "warning",
	});
	if (packageSuffix === "browser-tools") {
		const vendor = join(packageRoot, "vendor");
		await mkdir(vendor, { recursive: true });
		await cp(resolve(root, "node_modules/acorn/dist/acorn.js"), join(vendor, "acorn.cjs"));
		await cp(resolve(root, "node_modules/acorn-walk/dist/walk.js"), join(vendor, "acorn-walk.cjs"));
		const context = join(packageRoot, "context");
		await mkdir(context, { recursive: true });
		await cp(resolve(root, "context/pibo-native-tooling.md"), join(context, "pibo-native-tooling.md"));
	}
	if (packageSuffix === "runtime-pi") {
		const vendor = join(packageRoot, "vendor");
		await mkdir(vendor, { recursive: true });
		await build({
			entryPoints: [resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js")],
			outfile: join(vendor, "pi-auth-storage.mjs"),
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node24",
			packages: "bundle",
			banner: { js: 'import { createRequire as __piboCreateRequire } from "node:module"; const require = __piboCreateRequire(import.meta.url);' },
			sourcemap: false,
			legalComments: "none",
			logLevel: "warning",
		});
	}
	if (browserExports.length) {
		const browserDir = join(packageRoot, "browser");
		await mkdir(browserDir, { recursive: true });
		const browserEntry = join(generatedRoot, `${packageSuffix}-browser.ts`);
		await writeFile(browserEntry, `${browserExports.map(([name, source]) => `export { ${name} } from ${JSON.stringify(resolve(root, source))};`).join("\n")}\n`);
		await build({
			entryPoints: [browserEntry],
			outfile: join(browserDir, "index.js"),
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
		manifest.entrypoints = { ...manifest.entrypoints, browser: "browser/index.js" };
	}
	manifest.entrypoints = { ...manifest.entrypoints, backend: "backend.mjs" };
	await writeFile(join(packageRoot, "pibo.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: `@pasko70/pibo-plugin-${packageSuffix}`, version: manifest.version, type: "module", files: ["pibo.plugin.json", "backend.mjs", "browser", ...(packageSuffix === "browser-tools" ? ["context"] : []), ...(["browser-tools", "runtime-pi"].includes(packageSuffix) ? ["vendor"] : [])] }, null, 2)}\n`);
}

const standardSet = { schemaVersion: 1, core: "@pasko70/pibo", standard: "@pasko70/pibo-standard", plugins: packages.map(([suffix, manifestFactory]) => ({ package: `@pasko70/pibo-plugin-${suffix}`, pluginId: manifestFactory().id, version: manifestFactory().version })) };
await writeFile(join(outputRoot, "standard-package-set.json"), `${JSON.stringify(standardSet, null, 2)}\n`);
const standardRoot = resolve(root, "dist/pibo4-standard-package");
await rm(standardRoot, { recursive: true, force: true });
await mkdir(standardRoot, { recursive: true });
await writeFile(join(standardRoot, "package-set.json"), `${JSON.stringify(standardSet, null, 2)}\n`);
await writeFile(join(standardRoot, "index.js"), `import packageSet from "./package-set.json" with { type: "json" };\nexport { packageSet };\n`);
await writeFile(join(standardRoot, "package.json"), `${JSON.stringify({
	name: "@pasko70/pibo-standard",
	version: releaseVersion,
	type: "module",
	main: "./index.js",
	exports: { ".": "./index.js", "./package-set.json": "./package-set.json", "./package.json": "./package.json" },
	files: ["index.js", "package-set.json"],
	dependencies: Object.fromEntries([["@pasko70/pibo", releaseVersion], ...standardSet.plugins.map((entry) => [entry.package, entry.version])]),
}, null, 2)}\n`);
console.log(`Built ${packages.length} Pibo 4 plugin package artifacts and the Standard composition in ${outputRoot}`);
