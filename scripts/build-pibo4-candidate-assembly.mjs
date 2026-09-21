import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertStandardPluginComposition } from "./pibo4-composition-check.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const assemblyRoot = resolve(root, "dist/pibo4-candidate-assembly");
const tarballRoot = join(assemblyRoot, "tarballs");
const packageSet = JSON.parse(await readFile(resolve(root, "dist/pibo4-artifacts/standard-package-set.json"), "utf8"));
const require = createRequire(import.meta.url);
const codexPlatformPackage = process.platform === "linux" && process.arch === "x64"
	? "@openai/codex-linux-x64"
	: process.platform === "linux" && process.arch === "arm64"
		? "@openai/codex-linux-arm64"
		: process.platform === "darwin" && process.arch === "x64"
			? "@openai/codex-darwin-x64"
			: process.platform === "darwin" && process.arch === "arm64"
				? "@openai/codex-darwin-arm64"
				: process.platform === "win32" && process.arch === "x64"
					? "@openai/codex-win32-x64"
					: process.platform === "win32" && process.arch === "arm64"
						? "@openai/codex-win32-arm64"
						: undefined;
if (!codexPlatformPackage) throw new Error("Pibo Candidate assembly does not support Codex Native on this build platform");

const defaults = await import(new URL("../dist/plugins/default-packages.js", import.meta.url));
if (packageSet.core !== "@pasko70/pibo" || packageSet.standard !== "@pasko70/pibo-standard") {
	throw new Error("Candidate assembly requires the Core and Standard package identities");
}
const expectedPluginCount = assertStandardPluginComposition(packageSet.plugins, defaults.standardPluginCoordinates(), "Candidate assembly");

const packageDirectories = [
	{ role: "core", directory: resolve(root, "dist/pibo4-core-package") },
	{ role: "cutover", directory: resolve(root, "dist/pibo4-cutover-package") },
	...packageSet.plugins.map((entry) => ({ role: "plugin", directory: resolve(root, "dist/pibo4-artifacts", entry.package.slice("@pasko70/pibo-plugin-".length)) })),
	{ role: "standard", directory: resolve(root, "dist/pibo4-standard-package") },
	{ role: "dependency", directory: dirname(require.resolve("@openai/codex/package.json")) },
	{ role: "dependency", directory: dirname(require.resolve(`${codexPlatformPackage}/package.json`)), package: codexPlatformPackage },
];

async function sha256(path) {
	return createHash("sha256").update(await readFile(path)).digest("hex");
}

await rm(assemblyRoot, { recursive: true, force: true });
await mkdir(tarballRoot, { recursive: true });
const artifacts = [];
for (const input of packageDirectories) {
	const pkg = JSON.parse(await readFile(join(input.directory, "package.json"), "utf8"));
	const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tarballRoot, input.directory], { maxBuffer: 64 * 1024 * 1024 });
	const filename = JSON.parse(stdout)[0]?.filename;
	if (!filename || basename(filename) !== filename) throw new Error(`npm pack returned an invalid filename for ${pkg.name}`);
	const path = join(tarballRoot, filename);
	const packageName = input.package ?? pkg.name;
	artifacts.push({
		role: input.role,
		package: packageName,
		...(packageName === pkg.name ? {} : { packageJsonName: pkg.name }),
		version: pkg.version,
		file: `tarballs/${filename}`,
		bytes: (await stat(path)).size,
		sha256: await sha256(path),
	});
}

const pluginArtifacts = artifacts.filter((entry) => entry.role === "plugin");
const expectedArtifactCount = expectedPluginCount + 5;
if (artifacts.length !== expectedArtifactCount || pluginArtifacts.length !== expectedPluginCount || artifacts.filter((entry) => entry.role === "dependency").length !== 2 || artifacts.filter((entry) => entry.role === "cutover").length !== 1 || artifacts.filter((entry) => entry.role === "standard").length !== 1 || new Set(artifacts.map((entry) => entry.package)).size !== expectedArtifactCount) {
	throw new Error(`Candidate assembly package identities are incomplete or duplicated: expected ${expectedPluginCount} plugin artifacts plus Core, Cutover, Standard, and two runtime dependencies`);
}

let sourceCommit = process.env.PIBO_SOURCE_COMMIT?.trim() || "unknown";
if (sourceCommit === "unknown") {
	try { sourceCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); }
	catch {}
}
if (!/^(?:[0-9a-f]{40}|unknown)$/.test(sourceCommit)) throw new Error("PIBO_SOURCE_COMMIT must be a full Git commit hash");
const manifest = {
	schemaVersion: 1,
	createdAt: new Date().toISOString(),
	sourceCommit,
	application: {
		package: "@pasko70/pibo-standard",
		version: releaseVersion,
		binary: "node_modules/@pasko70/pibo-standard/bin/pibo.js",
		command: ["node", "node_modules/@pasko70/pibo-standard/bin/pibo.js", "gateway:web", "--web-host", "0.0.0.0", "--web-port", "4788", "--gateway-port", "4789"],
		cutoverCommand: ["node", "node_modules/@pasko70/pibo-standard/bin/pibo.js", "gateway:web", "--cutover-plan", "<prepared-plan.json>", "--web-host", "0.0.0.0", "--web-port", "4788", "--gateway-port", "4789"],
	},
	cutover: {
		package: "@pasko70/pibo-cutover",
		version: releaseVersion,
		binary: "node_modules/@pasko70/pibo-cutover/bin/pibo4-cutover.js",
		command: ["node", "node_modules/@pasko70/pibo-cutover/bin/pibo4-cutover.js", "<prepare-input.json>"],
		sourceArtifact: "external-retained",
	},
	artifacts,
};
await writeFile(join(assemblyRoot, "assembly-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(assemblyRoot, "package.json"), `${JSON.stringify({
	name: "@pasko70/pibo-candidate-assembly",
	version: releaseVersion,
	private: true,
	type: "module",
	files: ["assembly-manifest.json", "tarballs"],
}, null, 2)}\n`);
console.log(`Built content-addressed Candidate assembly with ${artifacts.length} tarballs in ${assemblyRoot}`);
