#!/usr/bin/env node
// Build and package the Pibo VS Code extension into a .vsix file.
//
// Pipeline:
//   1. Run `vscode:extension:build` (esbuild → src/apps/chat-vscode/dist/extension/extension.cjs).
//   2. Run `vsce package` from the extension directory.
//   3. Copy the .vsix to a stable path inside the repo so the release script
//      can attach it to a GitHub Release without having to discover the
//      vsce-default output location.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const packageDir = resolve(root, "src/apps/chat-vscode");
const outDir = resolve(packageDir, "dist/extension");
const artifactsDir = resolve(root, "dist/apps/vscode-artifacts");

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });

function run(command, args, cwd) {
	console.log(`[vscode-package] ${command} ${args.join(" ")} (cwd=${cwd})`);
	execFileSync(command, args, { cwd, stdio: "inherit" });
}

run("npm", ["run", "--silent", "vscode:extension:build"], root);

const manifest = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
const version = manifest.version ?? "0.0.0";
const name = manifest.name ?? "pibo-vscode";
const expectedFilename = `${name}-${version}.vsix`;

// Clean up any prior .vsix output that vsce left in the extension directory.
for (const entry of readdirSync(packageDir)) {
	if (entry.endsWith(".vsix")) {
		rmSync(resolve(packageDir, entry), { force: true });
	}
}

run("npx", ["--no-install", "vsce", "package", "--no-dependencies", "--out", expectedFilename], packageDir);

const sourcePath = resolve(packageDir, expectedFilename);
if (!existsSync(sourcePath)) {
	throw new Error(`vsce did not produce ${expectedFilename} in ${packageDir}`);
}

const targetPath = resolve(artifactsDir, expectedFilename);
copyFileSync(sourcePath, targetPath);
const sizeBytes = statSync(targetPath).size;
console.log(`[vscode-package] wrote ${targetPath} (${sizeBytes} bytes)`);

// Also keep the most recent .vsix under a stable "latest.vsix" name for the release script.
const latestPath = resolve(artifactsDir, "latest.vsix");
copyFileSync(sourcePath, latestPath);
console.log(`[vscode-package] wrote ${latestPath}`);
