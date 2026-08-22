import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("VS Code Web URL helper preserves the mount path and selects server folders", async () => {
	const script = String.raw`
		import assert from "node:assert/strict";
		const { vscodeWebUrl } = await import("./src/apps/chat-ui/src/VscodeArea.tsx");

		assert.equal(
			vscodeWebUrl("/apps/vscode/", "/root/code/pibo", "https://pibo.example/apps/chat/vscode"),
			"/apps/vscode/?folder=%2Froot%2Fcode%2Fpibo",
		);
		assert.equal(
			vscodeWebUrl("/apps/vscode/?quality=stable", undefined, "https://pibo.example/apps/chat/vscode"),
			"/apps/vscode/?quality=stable",
		);
		assert.equal(
			vscodeWebUrl("https://code.example/", "/srv/project", "https://pibo.example/apps/chat/vscode"),
			"https://code.example/?folder=%2Fsrv%2Fproject",
		);
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});

test("VS Code area provides a configured-state fallback and trusted IDE iframe controls", async () => {
	const script = String.raw`
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		globalThis.React = React;
		const { VscodeArea } = await import("./src/apps/chat-ui/src/VscodeArea.tsx");
		console.log(renderToStaticMarkup(React.createElement(VscodeArea, {})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	assert.match(stdout, /VS Code Web unavailable/);
	assert.match(stdout, /PIBO_VSCODE_WEB_URL/);

	const source = readFileSync(resolve("src/apps/chat-ui/src/VscodeArea.tsx"), "utf8");
	assert.match(source, /<main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden/);
	assert.match(source, /<iframe/);
	assert.match(source, /allow="clipboard-read; clipboard-write"/);
	assert.match(source, /getProjects\(\)/);
	assert.match(source, /searchParams\.set\("folder", folder\)/);
});
