#!/usr/bin/env node
// Orchestrate a Pibo release end-to-end.
//
// Steps:
//   1. Bump the workspace version in package.json and package-lock.json.
//   2. Run the full build and produce the Pibo 4 release artifacts.
//   3. (Optional) Publish Minimal-Core, Cutover, each plugin, and Standard from
//      their generated package directories. The private repository root is
//      never published.
//   4. (Optional) Create a GitHub Release.
//
// Usage:
//   node scripts/release.mjs --version 1.3.0 [--publish-npm] [--create-release]
//   node scripts/release.mjs --version 1.3.0 --no-publish --no-release
//                                              ^^^^^^^^^^^^^^^^^^^^^^^^
//                                              just bump + build
//
// This script does NOT push to git or create tags automatically; the
// maintainer reviews the diff, commits, and pushes manually.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const rootPackageJsonPath = resolve(root, "package.json");
const rootPackageLockPath = resolve(root, "package-lock.json");
const npmCommand = process.platform === "win32" ? ["cmd.exe", "/c", "npm.cmd"] : ["npm"];

function isValidSemver(version) {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version);
	if (!match) return false;
	const prerelease = match[4]?.split(".") ?? [];
	if (prerelease.some((identifier) => identifier.length === 0 || (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")))) return false;
	const build = match[5]?.split(".") ?? [];
	return build.every((identifier) => identifier.length > 0);
}

function parseArgs(argv) {
	const result = { version: undefined, publishNpm: false, createRelease: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--version") {
			result.version = argv[++i];
		} else if (arg === "--publish-npm") {
			result.publishNpm = true;
		} else if (arg === "--create-release") {
			result.createRelease = true;
		} else if (arg === "--dry-run") {
			result.dryRun = true;
		} else if (arg === "--no-publish") {
			result.publishNpm = false;
		} else if (arg === "--no-release") {
			result.createRelease = false;
		} else if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/release.mjs --version <semver> [--publish-npm] [--create-release] [--dry-run]");
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!result.version) {
		throw new Error("--version is required (e.g., --version 1.3.0)");
	}
	if (!isValidSemver(result.version)) {
		throw new Error(`Version ${result.version} is not a valid semver string`);
	}
	return result;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function runCaptured(command, args, options = {}) {
	return execFileSync(command, args, { cwd: root, encoding: "utf8", ...options }).trim();
}

function runInherit(commandParts, args, options = {}) {
	const [command, ...prefixArgs] = Array.isArray(commandParts) ? commandParts : [commandParts];
	return execFileSync(command, [...prefixArgs, ...args], { cwd: root, stdio: "inherit", ...options });
}

function currentGitCommit() {
	return runCaptured("git", ["rev-parse", "--short", "HEAD"]);
}

function currentGitTag() {
	try {
		return runCaptured("git", ["describe", "--tags", "--exact-match", "HEAD"]);
	} catch {
		return undefined;
	}
}

function pibo4ReleasePackages(version) {
	const set = readJson(resolve(root, "dist/pibo4-artifacts/standard-package-set.json"));
	const pluginPrefix = "@pasko70/pibo-plugin-";
	const specifications = [
		{ directory: "dist/pibo4-core-package", name: "@pasko70/pibo", version },
		{ directory: "dist/pibo4-cutover-package", name: "@pasko70/pibo-cutover", version },
		...set.plugins.map((entry) => {
			if (typeof entry.package !== "string" || !entry.package.startsWith(pluginPrefix)) throw new Error(`Invalid Pibo 4 plugin package coordinate: ${entry.package}`);
			return { directory: `dist/pibo4-artifacts/${entry.package.slice(pluginPrefix.length)}`, name: entry.package, version: entry.version };
		}),
		{ directory: "dist/pibo4-standard-package", name: "@pasko70/pibo-standard", version },
	];
	const names = new Set();
	for (const specification of specifications) {
		const manifest = readJson(resolve(root, specification.directory, "package.json"));
		if (manifest.name !== specification.name || manifest.version !== specification.version) {
			throw new Error(`Release artifact ${specification.directory} is ${manifest.name}@${manifest.version}; expected ${specification.name}@${specification.version}`);
		}
		if (manifest.private === true) throw new Error(`Release artifact ${specification.name} is private`);
		if (names.has(manifest.name)) throw new Error(`Duplicate Pibo 4 release package ${manifest.name}`);
		names.add(manifest.name);
	}
	const standard = readJson(resolve(root, "dist/pibo4-standard-package/package.json"));
	if (standard.dependencies?.["@pasko70/pibo"] !== version) throw new Error(`Standard composition does not pin @pasko70/pibo@${version}`);
	for (const entry of set.plugins) {
		if (standard.dependencies?.[entry.package] !== entry.version) throw new Error(`Standard composition does not pin ${entry.package}@${entry.version}`);
	}
	return specifications;
}

const args = parseArgs(process.argv.slice(2));
const currentRoot = readJson(rootPackageJsonPath);
const currentLock = readJson(rootPackageLockPath);
const currentLockedRoot = currentLock.packages?.[""];
if (currentLock.name !== currentRoot.name || currentLockedRoot?.name !== currentRoot.name) {
	throw new Error("package-lock.json does not describe the root package");
}
if (currentRoot.private !== true) throw new Error("The repository root must remain private; publish only generated Pibo 4 package artifacts");

console.log(`[release] private workspace version: ${currentRoot.version} -> ${args.version}`);

if (args.dryRun) {
	console.log("[release] --dry-run: not writing files or invoking side-effects.");
	process.exit(0);
}

currentRoot.version = args.version;
writeJson(rootPackageJsonPath, currentRoot);

currentLock.version = args.version;
currentLockedRoot.version = args.version;
writeJson(rootPackageLockPath, currentLock);

console.log(`[release] updated workspace manifest and root lock metadata`);

const releaseEnv = { ...process.env, PIBO_RELEASE_VERSION: args.version };
runInherit(npmCommand, ["run", "--silent", "build"], { env: releaseEnv });
runInherit(npmCommand, ["run", "--silent", "pibo4:minimal-core"], { env: releaseEnv });
const releasePackages = pibo4ReleasePackages(args.version);
console.log(`[release] built and verified ${releasePackages.length} independently publishable Pibo 4 packages`);

if (args.publishNpm) {
	for (const artifact of releasePackages) {
		console.log(`[release] publishing ${artifact.name}@${artifact.version} from ${artifact.directory}…`);
		runInherit(npmCommand, ["publish", artifact.directory, "--access", "public"], { env: releaseEnv });
	}
	console.log(`[release] published ${releasePackages.length} Pibo 4 packages; the private repository root was not published`);
} else {
	console.log(`[release] (skipped npm publication; pass --publish-npm to publish generated Pibo 4 packages)`);
}

let releaseUrl;
if (args.createRelease) {
	const tag = `v${args.version}`;
	const headSha = currentGitCommit();
	const existingTag = currentGitTag();
	const headOnTag = existingTag === tag;
	if (!headOnTag) {
		console.log(`[release] head is at ${headSha}; create the tag ${tag} and push it before creating the GitHub Release.`);
	} else {
		console.log(`[release] creating GitHub Release ${tag} via Pibo GitHub App…`);
		const createReleaseScript = resolve(here, "create-github-release.mjs");
		const output = runCaptured("node", [createReleaseScript, "--tag", tag]);
		// Surface the script's own log lines so the user sees progress.
		for (const line of output.split("\n")) console.log(line);
		const match = output.match(/https:\/\/github\.com\/[^\s]+\/releases\/tag\/[^\s]+/);
		if (match) releaseUrl = match[0];
		if (releaseUrl) {
			console.log(`[release] GitHub Release: ${releaseUrl}`);
		} else {
			console.log(`[release] (could not parse release URL from create-github-release output; check above)`);
		}
	}
} else {
	console.log(`[release] (skipped GitHub Release; pass --create-release to enable)`);
}

console.log("\n[release] done.");
if (releaseUrl) console.log(`  GitHub Release: ${releaseUrl}`);
