import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const artifactRoot = resolve(root, "dist/pibo4-artifacts");
const coreRoot = resolve(root, "dist/pibo4-core-package");
const standardRoot = resolve(root, "dist/pibo4-standard-package");
const standardSet = JSON.parse(await readFile(join(artifactRoot, "standard-package-set.json"), "utf8"));
if (standardSet.core !== "@pasko70/pibo" || standardSet.standard !== "@pasko70/pibo-standard" || standardSet.plugins.length !== 21) {
	throw new Error("Pibo Standard requires Core plus exactly 21 declared plugin packages");
}
if (new Set(standardSet.plugins.map((entry) => entry.package)).size !== 21 || new Set(standardSet.plugins.map((entry) => entry.pluginId)).size !== 21) {
	throw new Error("Pibo Standard package and plugin identities must be unique");
}
const dependencyNames = [standardSet.core, ...standardSet.plugins.map((entry) => entry.package)];

await rm(standardRoot, { recursive: true, force: true });
await mkdir(join(standardRoot, "bin"), { recursive: true });
await mkdir(join(standardRoot, "node_modules", "@pasko70"), { recursive: true });
await cp(coreRoot, join(standardRoot, "node_modules", "@pasko70", "pibo"), { recursive: true });
for (const entry of standardSet.plugins) {
	const suffix = entry.package.slice("@pasko70/pibo-plugin-".length);
	await cp(join(artifactRoot, suffix), join(standardRoot, "node_modules", "@pasko70", `pibo-plugin-${suffix}`), { recursive: true });
}

await writeFile(join(standardRoot, "package-set.json"), `${JSON.stringify(standardSet, null, 2)}\n`);
await writeFile(join(standardRoot, "standard-cli.js"), `import { existsSync, readFileSync } from "node:fs";\nimport { createRequire } from "node:module";\nimport { dirname, join, resolve } from "node:path";\nimport { fileURLToPath, pathToFileURL } from "node:url";\nimport packageSet from "./package-set.json" with { type: "json" };\n\nconst require = createRequire(import.meta.url);\nconst standardRoot = dirname(fileURLToPath(import.meta.url));\nconst runtimeRoot = resolve(standardRoot, "../../..");\nconst runtimeRequire = createRequire(join(runtimeRoot, "package.json"));\n\nfunction installedPackageRoot(name, version) {\n\tlet packageJsonPath;\n\ttry { packageJsonPath = runtimeRequire.resolve(\`\${name}/package.json\`); }\n\tcatch { packageJsonPath = require.resolve(\`\${name}/package.json\`); }\n\tconst pkg = require(packageJsonPath);\n\tif (pkg.name !== name || pkg.version !== version) throw new Error(\`Standard composition requires \${name}@\${version}, found \${pkg.name ?? "unknown"}@\${pkg.version ?? "unknown"}\`);\n\treturn dirname(packageJsonPath);\n}\n\nfunction hasCutoverPlan(argv) {\n\treturn argv.slice(3).some((arg) => arg === "--cutover-plan" || arg.startsWith("--cutover-plan="));\n}\n\nfunction packedCutoverBindings(argv, coreRoot) {\n\tif (!hasCutoverPlan(argv)) return undefined;\n\tconst assemblyRoot = join(runtimeRoot, ".pibo-candidate-assembly");\n\tconst manifestPath = join(assemblyRoot, "assembly-manifest.json");\n\tif (!existsSync(manifestPath)) throw new Error("Standard cutover requires the verified Pibo Candidate assembly next to the installed runtime");\n\tconst manifest = JSON.parse(readFileSync(manifestPath, "utf8"));\n\tif (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) throw new Error("Standard Candidate assembly manifest is invalid");\n\tconst required = new Map([[packageSet.core, ${JSON.stringify(releaseVersion)}], ...packageSet.plugins.map((entry) => [entry.package, entry.version])]);\n\tconst bindings = [];\n\tfor (const [name, version] of required) {\n\t\tconst artifact = manifest.artifacts.find((entry) => entry.package === name && entry.version === version);\n\t\tif (!artifact || typeof artifact.file !== "string" || !/^tarballs\\/[^/]+\\.tgz$/.test(artifact.file) || typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error(\`Standard Candidate assembly is missing checksum-bound \${name}@\${version}\`);\n\t\tconst path = join(assemblyRoot, artifact.file);\n\t\tif (!existsSync(path)) throw new Error(\`Standard Candidate artifact is missing: \${artifact.file}\`);\n\t\tbindings.push({ package: name, version, path, contentHash: \`sha256:\${artifact.sha256}\` });\n\t}\n\treturn bindings;\n}\n\nexport async function runPiboStandardCli(argv = process.argv) {\n\tconst coreRoot = installedPackageRoot(packageSet.core, ${JSON.stringify(releaseVersion)});\n\tconst chatUi = join(coreRoot, "dist", "apps", "chat-ui");\n\tif (!existsSync(chatUi)) throw new Error(\`Standard composition Core is missing Chat Web assets: \${chatUi}\`);\n\tprocess.env.PIBO_CHAT_UI_DIST_DIR ||= chatUi;\n\tconst bootstrapPluginSources = packageSet.plugins.map((entry) => ({ kind: "local", path: installedPackageRoot(entry.package, entry.version) }));\n\tconst cutoverArtifactBindings = packedCutoverBindings(argv, coreRoot);\n\tconst { runPiboCoreCli } = await import(pathToFileURL(join(coreRoot, "dist", "core", "executable-cli.js")).href);\n\tawait runPiboCoreCli(argv, {\n\t\tproductName: "Pibo Standard",\n\t\tgatewayDescription: "Start the Standard Web Gateway and Chat app with 21 plugin packages",\n\t\tdefaultProfile: "base",\n\t\tregisterRuntimeUnassignedProfile: false,\n\t\tbootstrapPluginSources,\n\t\tcutoverArtifactBindings,\n\t\tverifyCutoverSourceArtifact: cutoverArtifactBindings ? false : undefined,\n\t});\n}\n`);
await writeFile(join(standardRoot, "index.js"), `import packageSet from "./package-set.json" with { type: "json" };\nexport { packageSet };\nexport { runPiboStandardCli } from "./standard-cli.js";\n`);
await writeFile(join(standardRoot, "bin/pibo.js"), `#!/usr/bin/env node\ntry {\n\tconst { runPiboStandardCli } = await import("../standard-cli.js");\n\tawait runPiboStandardCli(process.argv);\n} catch (error) {\n\tconsole.error(\`error: \${error instanceof Error ? error.message : String(error)}\`);\n\tprocess.exitCode = 1;\n}\n`);
await chmod(join(standardRoot, "bin/pibo.js"), 0o755);
await writeFile(join(standardRoot, "package.json"), `${JSON.stringify({
	name: "@pasko70/pibo-standard",
	version: releaseVersion,
	type: "module",
	main: "./index.js",
	bin: { pibo: "./bin/pibo.js", "pibo-standard": "./bin/pibo.js" },
	exports: { ".": "./index.js", "./cli": "./standard-cli.js", "./package-set.json": "./package-set.json", "./package.json": "./package.json" },
	files: ["index.js", "standard-cli.js", "bin", "package-set.json"],
	dependencies: Object.fromEntries([[standardSet.core, releaseVersion], ...standardSet.plugins.map((entry) => [entry.package, entry.version])]),
	bundledDependencies: dependencyNames,
	engines: { node: ">=24" },
}, null, 2)}\n`);
console.log(`Built executable Pibo Standard with ${standardSet.plugins.length} bundled plugin packages in ${standardRoot}`);
