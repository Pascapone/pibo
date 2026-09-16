import { access, chmod, cp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const packageRoot = resolve(root, "dist/pibo4-core-package");
const generatedRoot = resolve(root, "dist/.pibo4-core-generated");
const executableMetafilePath = resolve(root, "dist/pibo4-core-executable.metafile.json");
await rm(packageRoot, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

const entries = {
	index: ["src/plugins/sdk.ts", "src/plugins/host.ts", "src/plugins/runtime.ts", "src/plugins/cutover-contract.ts", "src/plugins/product-runtime.ts"],
	"plugin-sdk": ["src/plugins/sdk.ts"],
	"plugin-host": ["src/plugins/host.ts"],
	"plugin-runtime": ["src/plugins/runtime.ts"],
	"plugin-cutover": ["src/plugins/cutover-contract.ts"],
	"product-runtime": ["src/plugins/product-runtime.ts"],
};
for (const [name, sources] of Object.entries(entries)) {
	const entry = join(generatedRoot, `${name}.ts`);
	await writeFile(entry, `${sources.map((source) => `export * from ${JSON.stringify(resolve(root, source))};`).join("\n")}\n`);
	await build({ entryPoints: [entry], outfile: join(packageRoot, `${name}.js`), bundle: true, platform: "node", format: "esm", target: "node24", packages: "bundle", sourcemap: false, legalComments: "none", logLevel: "warning" });
}

const executableOutput = join(packageRoot, "dist/core/executable-cli.js");
await mkdir(dirname(executableOutput), { recursive: true });
const executableBuild = await build({
	entryPoints: [resolve(root, "src/core/executable-cli.ts")],
	outfile: executableOutput,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	packages: "bundle",
	sourcemap: false,
	legalComments: "none",
	logLevel: "warning",
	metafile: true,
	banner: { js: "import { createRequire as __piboCreateRequire } from \"node:module\"; const require = __piboCreateRequire(import.meta.url);" },
});
const workerEntries = [
	"chat-storage-worker",
	"chat-read-worker",
	"telemetry-maintenance-worker",
	"telemetry-worker",
	"storage-verification-worker",
];
const workerBuilds = [];
for (const worker of workerEntries) {
	workerBuilds.push(await build({
		entryPoints: [resolve(root, `src/data/${worker}.ts`)],
		outfile: join(packageRoot, `dist/core/${worker}.js`),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		packages: "bundle",
		sourcemap: false,
		legalComments: "none",
		logLevel: "warning",
		metafile: true,
		banner: { js: "import { createRequire as __piboCreateRequire } from \"node:module\"; const require = __piboCreateRequire(import.meta.url);" },
	}));
}
await writeFile(executableMetafilePath, `${JSON.stringify({ executable: executableBuild.metafile, workers: workerBuilds.map((result) => result.metafile) }, null, 2)}\n`);

const chatUiSource = resolve(root, "dist/apps/chat-ui");
const contextFilesUiSource = resolve(root, "dist/apps/context-files-ui");
await access(join(chatUiSource, "index.html"));
await access(join(contextFilesUiSource, "index.html"));
await cp(chatUiSource, join(packageRoot, "dist/apps/chat-ui"), {
	recursive: true,
	filter(source) {
		const name = basename(source);
		return !name.startsWith("pibo-plugin-");
	},
});
await cp(contextFilesUiSource, join(packageRoot, "dist/apps/context-files-ui"), { recursive: true });

const packagedChatRoot = join(packageRoot, "dist/apps/chat-ui");
const packagedChatAssetsRoot = join(packagedChatRoot, "assets");
const reachableChatScripts = new Set();
const chatScriptQueue = [];
function enqueueChatScript(reference, importer = "index.html") {
	let candidate;
	if (reference.startsWith("/apps/chat/")) candidate = reference.slice("/apps/chat/".length);
	else if (reference.startsWith("./") || reference.startsWith("../")) candidate = relative(packagedChatRoot, resolve(packagedChatRoot, dirname(importer), reference));
	else return;
	candidate = candidate.replaceAll("\\", "/");
	if (!candidate.startsWith("assets/") || !candidate.endsWith(".js") || reachableChatScripts.has(candidate)) return;
	reachableChatScripts.add(candidate);
	chatScriptQueue.push(candidate);
}
const scriptReferencePattern = /["']([^"']+\.js)(?:\?[^"']*)?["']/g;
for (const match of (await readFile(join(packagedChatRoot, "index.html"), "utf8")).matchAll(scriptReferencePattern)) enqueueChatScript(match[1]);
while (chatScriptQueue.length) {
	const script = chatScriptQueue.shift();
	const source = await readFile(join(packagedChatRoot, script), "utf8");
	for (const match of source.matchAll(scriptReferencePattern)) enqueueChatScript(match[1], script);
}
for (const asset of await readdir(packagedChatAssetsRoot)) {
	if (asset.endsWith(".js") && !reachableChatScripts.has(`assets/${asset}`)) await unlink(join(packagedChatAssetsRoot, asset));
}

await mkdir(join(packageRoot, "dist/bin"), { recursive: true });
await writeFile(join(packageRoot, "dist/bin/pibo.js"), `#!/usr/bin/env node\nimport { fileURLToPath } from "node:url";\nprocess.env.PIBO_CHAT_UI_DIST_DIR ||= fileURLToPath(new URL("../apps/chat-ui", import.meta.url));\ntry {\n\tconst { runPiboCoreCli } = await import("../core/executable-cli.js");\n\tawait runPiboCoreCli(process.argv);\n} catch (error) {\n\tconsole.error(\`error: \${error instanceof Error ? error.message : String(error)}\`);\n\tprocess.exitCode = 1;\n}\n`);
await chmod(join(packageRoot, "dist/bin/pibo.js"), 0o755);

const declarationRoot = resolve(root, "dist");
const declarationTarget = join(packageRoot, "types");
const copiedDeclarations = new Set();
async function copyDeclaration(relativePath) {
	const normalized = relativePath.replaceAll("\\", "/");
	if (copiedDeclarations.has(normalized)) return;
	copiedDeclarations.add(normalized);
	const source = join(declarationRoot, normalized);
	const text = await readFile(source, "utf8");
	const target = join(declarationTarget, normalized);
	await mkdir(dirname(target), { recursive: true });
	await cp(source, target);
	const importPattern = /(?:from\s+|import\s*\()(["'])(\.[^"']+)\1/g;
	for (const match of text.matchAll(importPattern)) {
		const specifier = match[2];
		const candidate = resolve(dirname(source), specifier.replace(/\.js$/, ".d.ts"));
		const child = relative(declarationRoot, candidate).replaceAll("\\", "/");
		if (!child.startsWith("../") && child.endsWith(".d.ts")) await copyDeclaration(child);
	}
}
for (const entry of ["plugins/sdk.d.ts", "plugins/host.d.ts", "plugins/runtime.d.ts"]) await copyDeclaration(entry);
await mkdir(join(declarationTarget, "plugins"), { recursive: true });
await writeFile(join(declarationTarget, "plugins/cutover-contract.d.ts"), `export type Pibo4LegacyPackageState = "active" | "disabled" | "uninstalled";\nexport interface Pibo4LegacyPackageSelection { pluginId: string; state: Pibo4LegacyPackageState; contributions?: Record<string, boolean> }\nexport interface Pibo4LegacyCutoverSnapshot { schemaVersion: 1; plugins: Pibo4LegacyPackageSelection[] }\nexport interface Pibo4PackedCoordinate { package: string; version: string; path: string; contentHash?: string }\nexport interface Pibo4CutoverArtifactBinding extends Pibo4PackedCoordinate { contentHash: string }\nexport interface Pibo4CutoverTarget extends Pibo4PackedCoordinate { pluginId: string; state: Pibo4LegacyPackageState; legacyOwners: string[]; contentHash: string }\nexport interface Pibo4CutoverPlan { schemaVersion: 1; id: string; state: "prepared"; source: Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string }; sourceSnapshot: Pibo4LegacyCutoverSnapshot; sourceSnapshotHash: string; targetCore: Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string }; targets: Pibo4CutoverTarget[]; supersededOwners: string[]; planHash: string }\nexport declare function verifyPreparedPibo4Cutover(planPath: string, options?: { targetArtifacts?: readonly Pibo4CutoverArtifactBinding[]; verifySourceArtifact?: boolean }): Promise<Pibo4CutoverPlan>;\nexport declare function writePibo4CutoverReceipt(planPath: string, plan: Pibo4CutoverPlan): Promise<string>;\n`);
await writeFile(join(declarationTarget, "product-runtime.d.ts"), `import type { PluginHost } from "./plugins/host.js";\nimport type { Pibo4CutoverArtifactBinding } from "./plugins/cutover-contract.js";\nexport type PluginSourceInput = { kind: "local"; path: string } | { kind: "package"; path: string; name: string; version: string; integrity?: string };\nexport declare function startPluginProductRuntime(options: { host: PluginHost; artifactRoot?: string; collectConsumers?: (...args: any[]) => any; readSessionPlan?: (...args: any[]) => any; productOptions?: Record<string, unknown>; installDefaultPlugins?: boolean; bootstrapPluginSources?: readonly PluginSourceInput[]; includeWebProduct?: boolean; requirePreparedCutover?: boolean; cutoverPlanPath?: string; cutoverArtifactBindings?: readonly Pibo4CutoverArtifactBinding[]; verifyCutoverSourceArtifact?: boolean; currentCoreVersion?: string }): Promise<{ manager: any; runtime: any; data: any; dispose(): Promise<void> }>;\n`);
await writeFile(join(declarationTarget, "executable-cli.d.ts"), `import type { Pibo4CutoverArtifactBinding } from "./plugins/cutover-contract.js";\nimport type { PluginSourceInput } from "./product-runtime.js";\nexport type PiboExecutableComposition = { productName?: string; gatewayDescription?: string; defaultProfile?: string; registerRuntimeUnassignedProfile?: boolean; bootstrapPluginSources?: readonly PluginSourceInput[]; cutoverArtifactBindings?: readonly Pibo4CutoverArtifactBinding[]; verifyCutoverSourceArtifact?: boolean };\nexport declare function runPiboCoreCli(argv?: string[], composition?: PiboExecutableComposition): Promise<void>;\n`);
await writeFile(join(declarationTarget, "index.d.ts"), `export * from "./plugins/sdk.js";\nexport * from "./plugins/host.js";\nexport * from "./plugins/runtime.js";\nexport * from "./plugins/cutover-contract.js";\nexport * from "./product-runtime.js";\n`);

const pkg = {
	name: "@pasko70/pibo",
	version: releaseVersion,
	type: "module",
	main: "./index.js",
	types: "./types/index.d.ts",
	bin: { pibo: "./dist/bin/pibo.js" },
	exports: {
		".": { types: "./types/index.d.ts", import: "./index.js" },
		"./plugin-sdk": { types: "./types/plugins/sdk.d.ts", import: "./plugin-sdk.js" },
		"./plugin-host": { types: "./types/plugins/host.d.ts", import: "./plugin-host.js" },
		"./plugin-runtime": { types: "./types/plugins/runtime.d.ts", import: "./plugin-runtime.js" },
		"./plugin-cutover": { types: "./types/plugins/cutover-contract.d.ts", import: "./plugin-cutover.js" },
		"./product-runtime": { types: "./types/product-runtime.d.ts", import: "./product-runtime.js" },
		"./executable-cli": { types: "./types/executable-cli.d.ts", import: "./dist/core/executable-cli.js" },
		"./package.json": "./package.json",
	},
	files: ["*.js", "types", "dist"],
	engines: { node: ">=24" },
};
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const cutoverRoot = resolve(root, "dist/pibo4-cutover-package");
await rm(cutoverRoot, { recursive: true, force: true });
await mkdir(join(cutoverRoot, "bin"), { recursive: true });
await build({ entryPoints: [resolve(root, "src/plugins/cutover.ts")], outfile: join(cutoverRoot, "index.js"), bundle: true, platform: "node", format: "esm", target: "node24", packages: "bundle", sourcemap: false, legalComments: "none", logLevel: "warning" });
await writeFile(join(cutoverRoot, "bin/pibo4-cutover.js"), `#!/usr/bin/env node\nimport { readFile } from "node:fs/promises";\nimport { resolve } from "node:path";\nimport { preparePibo4Cutover } from "../index.js";\nconst inputPath = process.argv[2];\nif (!inputPath) { console.error("Usage: pibo4-cutover <input.json>"); process.exit(2); }\nconst input = JSON.parse(await readFile(resolve(inputPath), "utf8"));\nconst plan = await preparePibo4Cutover(input);\nconsole.log(JSON.stringify({ id: plan.id, planHash: plan.planHash, outputPath: resolve(input.outputPath), targets: plan.targets.length }));\n`);
await chmod(join(cutoverRoot, "bin/pibo4-cutover.js"), 0o755);
await writeFile(join(cutoverRoot, "package.json"), `${JSON.stringify({ name: "@pasko70/pibo-cutover", version: releaseVersion, type: "module", main: "./index.js", bin: { "pibo4-cutover": "./bin/pibo4-cutover.js" }, exports: { ".": "./index.js", "./package.json": "./package.json" }, files: ["index.js", "bin"] }, null, 2)}\n`);

const executableInputs = [executableBuild, ...workerBuilds].flatMap((result) => Object.keys(result.metafile.inputs)).map((input) => input.replaceAll("\\", "/"));
const forbiddenInputFragments = [
	"src/agent-runtimes/",
	"src/plugins/packaged-",
	"src/loops/",
	"src/cron/",
	"src/web-annotations/",
	"src/runs/tools.ts",
	"src/tools/browser-pool.ts",
	"src/tools/codex-",
	"src/resources/lifecycle.ts",
];
const forbiddenInputs = executableInputs.filter((input) => forbiddenInputFragments.some((fragment) => input.includes(fragment)));
if (forbiddenInputs.length) throw new Error(`Minimal-Core executable import graph contains feature/runtime implementations:\n${forbiddenInputs.join("\n")}`);

const executableFiles = [...Object.keys(entries).map((name) => `${name}.js`), "dist/core/executable-cli.js", ...workerEntries.map((worker) => `dist/core/${worker}.js`)];
const forbiddenSymbols = [
	"PI_AGENT_RUNTIME_DRIVER",
	"CODEX_NATIVE_AGENT_RUNTIME_DRIVER",
	"OMP_AGENT_RUNTIME_DRIVER",
	"createPiboGoalToolDefinitions",
	"formatPiboRunReminderMessage",
	"CodexBrowserSessionController",
	"saveCodexGeneratedImage",
];
const findings = [];
for (const file of executableFiles) {
	const text = await readFile(join(packageRoot, file), "utf8");
	for (const token of forbiddenSymbols) if (text.includes(token)) findings.push(`${file}: ${token}`);
}
const packagedChatAssets = await readdir(join(packageRoot, "dist/apps/chat-ui/assets"));
for (const asset of packagedChatAssets) {
	if (asset.startsWith("pibo-plugin-") || asset.startsWith("first-party-subview-")) findings.push(`dist/apps/chat-ui/assets/${asset}: first-party feature view`);
}
if (findings.length) throw new Error(`Minimal-Core executable closure contains feature/runtime delivery:\n${findings.join("\n")}`);
console.log(`Built executable Minimal-Core package at ${packageRoot}`);
