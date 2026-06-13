#!/usr/bin/env node
// Build the Pibo VS Code extension:
//   1. Bundle the WebView with Vite (src/apps/chat-vscode/extension/webview/ → dist/apps/chat-vscode-web/).
//   2. Bundle the Node-side extension entry with esbuild (src/apps/chat-vscode/extension/src/extension.ts → dist/extension.cjs).
// The gateway serves the WebView at /apps/chat-vscode/ from dist/apps/chat-vscode-web/.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const packageDir = resolve(root, "src/apps/chat-vscode");
const webviewDir = resolve(packageDir, "extension/webview");
const extensionSrc = resolve(packageDir, "extension/src/extension.ts");
const extensionOutDir = resolve(packageDir, "dist/extension");
const webviewOutDir = resolve(root, "dist/apps/chat-vscode-web");

if (!existsSync(extensionOutDir)) mkdirSync(extensionOutDir, { recursive: true });
if (!existsSync(webviewOutDir)) mkdirSync(webviewOutDir, { recursive: true });

function run(command, args, cwd) {
	console.log(`[vscode-build] ${command} ${args.join(" ")}`);
	execFileSync(command, args, { cwd, stdio: "inherit" });
}

run("node", ["./node_modules/vite/bin/vite.js", "build", "--config", "src/apps/chat-vscode/extension/webview/vite.config.ts"], root);

run(
	"./node_modules/.bin/esbuild",
	[
		extensionSrc,
		"--bundle",
		"--platform=node",
		"--target=node24",
		"--format=cjs",
		`--outfile=${extensionOutDir}/extension.cjs`,
		"--external:vscode",
		"--sourcemap=inline",
	],
	root,
);

console.log("[vscode-build] done.");
