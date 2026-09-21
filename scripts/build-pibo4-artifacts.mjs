import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assertStandardPluginComposition } from "./pibo4-composition-check.mjs";

const root = process.cwd();
const outputRoot = resolve(root, "dist/pibo4-artifacts");
const generatedRoot = resolve(root, "dist/.pibo4-generated");
const defaults = await import(new URL("../dist/plugins/default-packages.js", import.meta.url));
const topLevelOAuthBundle = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/bun-oauth"));
const piAgentPackageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const piAgentOAuthBundle = join(piAgentPackageRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "bun-oauth.js");

const packages = [
	["preview", defaults.previewPackageManifest, "src/plugins/packaged-preview.ts", "setupPreview", [["PreviewView", "src/apps/chat-ui/src/plugins/preview-view.tsx"]]],
	["vscode-web", defaults.vscodeWebPackageManifest, "src/plugins/packaged-vscode-web.ts", "setupVscodeWeb", [["VscodeView", "src/apps/chat-ui/src/plugins/vscode-view.tsx"]]],
	["web-annotations", defaults.webAnnotationsPackageManifest, "src/plugins/packaged-web-annotations.ts", "setup", [["WebAnnotationsView", "src/apps/chat-ui/src/plugins/web-annotations-view.tsx"], ["BuildContextView", "src/apps/chat-ui/src/plugins/build-context-view.tsx"]]],
	["goal-loops", defaults.goalControlPackageManifest, "src/plugins/packaged-goal-loops.ts", "setupGoalControl", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"], ["LoopsView", "src/apps/chat-ui/src/plugins/loops-view.tsx"]]],
	["cron", defaults.cronPackageManifest, "src/plugins/packaged-cron.ts", "setupCron", [["CronView", "src/apps/chat-ui/src/plugins/cron-view.tsx"]]],
	["remote-agent", defaults.remoteAgentPackageManifest, "src/plugins/packaged-remote-agent.ts", "setupRemoteAgent", [["RemoteAgentView", "src/apps/chat-ui/src/plugins/remote-agent-view.tsx"]]],
	["workflows", defaults.workflowsPackageManifest, "src/plugins/packaged-workflows.ts", "setupWorkflows", [["WorkflowsView", "src/apps/chat-ui/src/plugins/workflows-view.tsx"]]],
	["runtime-pi", defaults.piRuntimePackageManifest, "src/plugins/packaged-runtime-pi.ts", "setupPiRuntime", []],
	["runtime-codex-native", defaults.codexNativeRuntimePackageManifest, "src/plugins/packaged-runtime-codex-native.ts", "setupCodexNativeRuntime", [["RuntimeRequestsView", "src/apps/chat-ui/src/plugins/runtime-requests-view.tsx"]]],
	["runtime-muse-native", defaults.museNativeRuntimePackageManifest, "src/plugins/packaged-runtime-muse-native.ts", "setupMuseNativeRuntime", [["RuntimeRequestsView", "src/apps/chat-ui/src/plugins/runtime-requests-view.tsx"]]],
	["runtime-omp", defaults.ompRuntimePackageManifest, "src/plugins/packaged-runtime-omp.ts", "setupOmpRuntime", []],
	["code-runtime", defaults.codeRuntimePackageManifest, "src/plugins/packaged-code-runtime.ts", "setupCodeRuntime", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["file-editing", defaults.fileEditingPackageManifest, "src/plugins/packaged-file-editing.ts", "setupFileEditing", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["web-search", defaults.webSearchPackageManifest, "src/plugins/packaged-web-search.ts", "setupWebSearch", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["browser-tools", defaults.browserToolsPackageManifest, "src/plugins/packaged-browser-tools.ts", "setupBrowserTools", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["gateway-tools", defaults.gatewayToolsPackageManifest, "src/plugins/packaged-gateway-tools.ts", "setupGatewayTools", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["codex-compat", defaults.codexCompatPackageManifest, "src/plugins/packaged-codex-compat.ts", "setupCodexCompat", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
	["run-control", defaults.runControlPackageManifest, "src/plugins/packaged-run-control.ts", "setupRunControl", [["ToolFamilyView", "src/apps/chat-ui/src/plugins/tool-family-view.tsx"]]],
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

await rm(outputRoot, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

for (const [packageSuffix, manifestFactory, backendSource, backendExport, browserExports] of packages) {
	const manifest = manifestFactory();
	const packageRoot = join(outputRoot, packageSuffix);
	await mkdir(packageRoot, { recursive: true });
	const backendEntry = join(generatedRoot, `${packageSuffix}-backend.ts`);
	const runtimeBootstrap = packageSuffix === "runtime-pi"
		? `import { registerBunOAuthFlows as registerTopLevelOAuthFlows } from ${JSON.stringify(topLevelOAuthBundle)};\nimport { registerBunOAuthFlows as registerPiAgentOAuthFlows } from ${JSON.stringify(piAgentOAuthBundle)};\nregisterTopLevelOAuthFlows();\nregisterPiAgentOAuthFlows();\n`
		: "";
	const runtimeExports = packageSuffix === "runtime-pi" ? `export { derivePackagedPiProviderAuth } from ${JSON.stringify(resolve(root, backendSource))};\n` : "";
	await writeFile(backendEntry, `${runtimeBootstrap}export { ${backendExport} as setup } from ${JSON.stringify(resolve(root, backendSource))};\n${runtimeExports}`);
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
	if (packageSuffix === "standard-profiles") {
		const skills = join(packageRoot, "skills");
		await mkdir(skills, { recursive: true });
		for (const contribution of manifest.contributions.filter((entry) => entry.kind === "skill")) {
			await cp(resolve(root, "skills", "builtin", contribution.name), join(skills, contribution.name), { recursive: true });
		}
	}
	if (packageSuffix === "web-annotations") {
		const skills = join(packageRoot, "skills");
		await mkdir(skills, { recursive: true });
		await cp(resolve(root, "skills", "builtin", "web-annotations"), join(skills, "web-annotations"), { recursive: true });
	}
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
	await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: `@pasko70/pibo-plugin-${packageSuffix}`, version: manifest.version, type: "module", ...(packageSuffix === "runtime-codex-native" ? { dependencies: { "@openai/codex": "0.153.2" } } : {}), files: ["pibo.plugin.json", "backend.mjs", "browser", ...(["standard-profiles", "web-annotations"].includes(packageSuffix) ? ["skills"] : []), ...(packageSuffix === "browser-tools" ? ["context"] : []), ...(["browser-tools", "runtime-pi"].includes(packageSuffix) ? ["vendor"] : [])] }, null, 2)}\n`);
}

const standardSet = { schemaVersion: 1, core: "@pasko70/pibo", standard: "@pasko70/pibo-standard", plugins: packages.map(([suffix, manifestFactory]) => ({ package: `@pasko70/pibo-plugin-${suffix}`, pluginId: manifestFactory().id, version: manifestFactory().version })) };
assertStandardPluginComposition(standardSet.plugins, defaults.standardPluginCoordinates(), "Pibo 4 plugin artifacts");
await writeFile(join(outputRoot, "standard-package-set.json"), `${JSON.stringify(standardSet, null, 2)}\n`);
console.log(`Built ${packages.length} Pibo 4 plugin package artifacts in ${outputRoot}`);
