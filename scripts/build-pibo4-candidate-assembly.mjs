import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseVersion = process.env.PIBO_RELEASE_VERSION?.trim() || "4.0.0-beta.1";
const assemblyRoot = resolve(root, "dist/pibo4-candidate-assembly");
const tarballRoot = join(assemblyRoot, "tarballs");
const packageSet = JSON.parse(await readFile(resolve(root, "dist/pibo4-artifacts/standard-package-set.json"), "utf8"));

if (packageSet.core !== "@pasko70/pibo" || packageSet.standard !== "@pasko70/pibo-standard" || packageSet.plugins.length !== 20) {
	throw new Error("Candidate assembly requires Core, Standard, and exactly 20 plugin packages");
}

const packageDirectories = [
	{ role: "core", directory: resolve(root, "dist/pibo4-core-package") },
	{ role: "cutover", directory: resolve(root, "dist/pibo4-cutover-package") },
	...packageSet.plugins.map((entry) => ({ role: "plugin", directory: resolve(root, "dist/pibo4-artifacts", entry.package.slice("@pasko70/pibo-plugin-".length)) })),
	{ role: "standard", directory: resolve(root, "dist/pibo4-standard-package") },
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
	artifacts.push({
		role: input.role,
		package: pkg.name,
		version: pkg.version,
		file: `tarballs/${filename}`,
		bytes: (await stat(path)).size,
		sha256: await sha256(path),
	});
}

const pluginArtifacts = artifacts.filter((entry) => entry.role === "plugin");
if (artifacts.length !== 23 || pluginArtifacts.length !== 20 || artifacts.filter((entry) => entry.role === "cutover").length !== 1 || new Set(artifacts.map((entry) => entry.package)).size !== 23) {
	throw new Error("Candidate assembly package identities are incomplete or duplicated");
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
