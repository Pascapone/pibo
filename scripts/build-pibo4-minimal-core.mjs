import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const packageRoot = resolve(root, "dist/pibo4-core-package");
const generatedRoot = resolve(root, "dist/.pibo4-core-generated");
await rm(packageRoot, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

const entries = {
	index: ["src/plugins/sdk.ts", "src/plugins/host.ts", "src/plugins/runtime.ts", "src/plugins/product-runtime.ts"],
	"plugin-sdk": ["src/plugins/sdk.ts"],
	"plugin-host": ["src/plugins/host.ts"],
	"plugin-runtime": ["src/plugins/runtime.ts"],
	"product-runtime": ["src/plugins/product-runtime.ts"],
};
for (const [name, sources] of Object.entries(entries)) {
	const entry = join(generatedRoot, `${name}.ts`);
	await writeFile(entry, `${sources.map((source) => `export * from ${JSON.stringify(resolve(root, source))};`).join("\n")}\n`);
	await build({ entryPoints: [entry], outfile: join(packageRoot, `${name}.js`), bundle: true, platform: "node", format: "esm", target: "node24", packages: "bundle", sourcemap: false, legalComments: "none", logLevel: "warning" });
}

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
await writeFile(join(declarationTarget, "product-runtime.d.ts"), `import type { PluginHost } from "./plugins/host.js";\nexport declare function startPluginProductRuntime(options: { host: PluginHost; artifactRoot?: string; collectConsumers?: (...args: any[]) => any; readSessionPlan?: (...args: any[]) => any; productOptions?: Record<string, unknown>; installDefaultPlugins?: boolean; includeWebProduct?: boolean }): Promise<{ manager: any; runtime: any; data: any; dispose(): Promise<void> }>;\n`);
await writeFile(join(declarationTarget, "index.d.ts"), `export * from "./plugins/sdk.js";\nexport * from "./plugins/host.js";\nexport * from "./plugins/runtime.js";\nexport * from "./product-runtime.js";\n`);

const pkg = {
	name: "@pasko70/pibo",
	version: "4.0.0-beta.1",
	type: "module",
	main: "./index.js",
	types: "./types/index.d.ts",
	exports: {
		".": { types: "./types/index.d.ts", import: "./index.js" },
		"./plugin-sdk": { types: "./types/plugins/sdk.d.ts", import: "./plugin-sdk.js" },
		"./plugin-host": { types: "./types/plugins/host.d.ts", import: "./plugin-host.js" },
		"./plugin-runtime": { types: "./types/plugins/runtime.d.ts", import: "./plugin-runtime.js" },
		"./product-runtime": { types: "./types/product-runtime.d.ts", import: "./product-runtime.js" },
		"./package.json": "./package.json",
	},
	files: ["*.js", "types"],
	engines: { node: ">=24" },
};
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const executableFiles = Object.keys(entries).map((name) => `${name}.js`);
const forbidden = ["pibo_agents_", "formatPiboRunReminderMessage", "createPiboDelegationController", "PI_AGENT_RUNTIME_DRIVER", "CODEX_NATIVE_AGENT_RUNTIME_DRIVER", "OMP_AGENT_RUNTIME_DRIVER", "CodexBrowserSessionController"];
const findings = [];
for (const file of executableFiles) {
	const text = await readFile(join(packageRoot, file), "utf8");
	for (const token of forbidden) if (text.includes(token)) findings.push(`${file}: ${token}`);
}
if (findings.length) throw new Error(`Minimal-Core executable closure contains feature/runtime symbols:\n${findings.join("\n")}`);
console.log(`Built Minimal-Core package at ${packageRoot}`);
