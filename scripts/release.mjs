#!/usr/bin/env node
// Orchestrate a Pibo release end-to-end.
//
// Steps:
//   1. Bump the version in package.json (root) AND src/apps/chat-vscode/package.json.
//   2. Run the full build (tsc + web-ui + vscode webview + esbuild).
//   3. Package the VS Code extension into dist/apps/vscode-artifacts/.
//   4. (Optional) Publish the npm package: `npm publish`.
//   5. (Optional) Create a GitHub Release that attaches the VSIX.
//
// The VSIX is the artifact the user uploads to the VS Code Marketplace.
//
// Usage:
//   node scripts/release.mjs --version 1.3.0 [--publish-npm] [--create-release]
//   node scripts/release.mjs --version 1.3.0 --no-publish --no-release
//                                              ^^^^^^^^^^^^^^^^^^^^^^^^
//                                              just bump + build + package
//
// This script does NOT push to git or create tags automatically; the
// maintainer reviews the diff, commits, and pushes manually.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const rootPackageJsonPath = resolve(root, "package.json");
const extensionPackageJsonPath = resolve(root, "src/apps/chat-vscode/package.json");
const artifactsDir = resolve(root, "dist/apps/vscode-artifacts");

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
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(result.version)) {
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

function runInherit(command, args, options = {}) {
	return execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
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

const args = parseArgs(process.argv.slice(2));
const currentRoot = readJson(rootPackageJsonPath);
const currentExtension = readJson(extensionPackageJsonPath);

console.log(`[release] root @pasko70/pibo: ${currentRoot.version} -> ${args.version}`);
console.log(`[release] pibo.pibo-vscode: ${currentExtension.version} -> ${args.version}`);

if (args.dryRun) {
	console.log("[release] --dry-run: not writing files or invoking side-effects.");
	process.exit(0);
}

currentRoot.version = args.version;
writeJson(rootPackageJsonPath, currentRoot);

currentExtension.version = args.version;
writeJson(extensionPackageJsonPath, currentExtension);

console.log(`[release] updated version in both package.json files`);

runInherit("npm", ["run", "--silent", "build"]);
console.log(`[release] built server + web UIs + VS Code WebView`);

runInherit("npm", ["run", "--silent", "vscode:package"]);
console.log(`[release] packaged VS Code extension`);

const expectedVsix = resolve(artifactsDir, `pibo-vscode-${args.version}.vsix`);
if (!existsSync(expectedVsix)) {
	throw new Error(`Expected VSIX not found at ${expectedVsix}`);
}
const sizeBytes = statSync(expectedVsix).size;
console.log(`[release] VSIX ready: ${expectedVsix} (${sizeBytes} bytes)`);

if (args.publishNpm) {
	console.log(`[release] publishing @pasko70/pibo@${args.version} to npm…`);
	runInherit("npm", ["publish"]);
	console.log(`[release] published to npm`);
} else {
	console.log(`[release] (skipped npm publish; pass --publish-npm to enable)`);
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
		console.log(`[release] creating GitHub Release ${tag} with the VSIX attached (via Pibo GitHub App)…`);
		const createReleaseScript = resolve(here, "create-github-release.mjs");
		const output = runCaptured("node", [
			createReleaseScript,
			"--tag", tag,
			"--asset", expectedVsix,
			"--asset-name", `pibo-vscode-${args.version}.vsix`,
		]);
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
console.log(`  VSIX: ${expectedVsix}`);
console.log(`  marketplace: upload the VSIX via https://marketplace.visualstudio.com/manage`);
console.log(`  size: ${sizeBytes} bytes`);
if (releaseUrl) console.log(`  GitHub Release: ${releaseUrl}`);
