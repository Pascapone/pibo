import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const artifactRoot = resolve(root, "dist/pibo4-artifacts");
const coreRoot = resolve(root, "dist/pibo4-core-package");
const standardRoot = resolve(root, "dist/pibo4-standard-package");
const standardSet = JSON.parse(await readFile(join(artifactRoot, "standard-package-set.json"), "utf8"));
if (standardSet.core !== "@pasko70/pibo" || standardSet.standard !== "@pasko70/pibo-standard" || standardSet.plugins.length !== 20) {
	throw new Error("Pibo Standard requires Core plus exactly 20 declared plugin packages");
}
if (new Set(standardSet.plugins.map((entry) => entry.package)).size !== 20 || new Set(standardSet.plugins.map((entry) => entry.pluginId)).size !== 20) {
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
await writeFile(join(standardRoot, "standard-cli.js"), `import { existsSync } from "node:fs";\nimport { createRequire } from "node:module";\nimport { dirname, join } from "node:path";\nimport packageSet from "./package-set.json" with { type: "json" };\n\nconst require = createRequire(import.meta.url);\n\nfunction installedPackageRoot(name, version) {\n\tconst packageJsonPath = require.resolve(\`\${name}/package.json\`);\n\tconst pkg = require(packageJsonPath);\n\tif (pkg.name !== name || pkg.version !== version) throw new Error(\`Standard composition requires \${name}@\${version}, found \${pkg.name ?? "unknown"}@\${pkg.version ?? "unknown"}\`);\n\treturn dirname(packageJsonPath);\n}\n\nexport async function runPiboStandardCli(argv = process.argv) {\n\tconst coreRoot = installedPackageRoot(packageSet.core, ${JSON.stringify(releaseVersion)});\n\tconst chatUi = join(coreRoot, "dist", "apps", "chat-ui");\n\tif (!existsSync(chatUi)) throw new Error(\`Standard composition Core is missing Chat Web assets: \${chatUi}\`);\n\tprocess.env.PIBO_CHAT_UI_DIST_DIR ||= chatUi;\n\tconst bootstrapPluginSources = packageSet.plugins.map((entry) => ({ kind: "local", path: installedPackageRoot(entry.package, entry.version) }));\n\tconst { runPiboCoreCli } = await import("@pasko70/pibo/executable-cli");\n\tawait runPiboCoreCli(argv, {\n\t\tproductName: "Pibo Standard",\n\t\tgatewayDescription: "Start the Standard Web Gateway and Chat app with 20 plugin packages",\n\t\tdefaultProfile: "base",\n\t\tregisterRuntimeUnassignedProfile: false,\n\t\tbootstrapPluginSources,\n\t});\n}\n`);
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
