import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderTerminalLine(clampLines) {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SquareTerminal } from "lucide-react";
		import { TerminalLine } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx";

		globalThis.React = React;
		console.log(renderToStaticMarkup(React.createElement(TerminalLine, {
			line: {
				prefix: "bullet",
				tokens: [
					{ text: "Ran", tone: "green", weight: "semibold" },
					{ text: " cd " },
					{ text: "/root/code/pibo/.worktrees/chat-trace-spacing", tone: "cyan" },
				],
			},
			status: "done",
			prefixIcon: SquareTerminal,
			clampLines: ${clampLines},
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout;
}

test("single-line Terminal rows use continuous character-level ellipsis", async () => {
	const markup = await renderTerminalLine(1);
	assert.match(markup, /block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap/);
	assert.doesNotMatch(markup, /whitespace-pre-wrap break-words/);
	assert.doesNotMatch(markup, /max-height:/);
	assert.match(markup, /chat-trace-spacing/);
});

test("multi-line Terminal previews retain wrapped height clamping", async () => {
	const markup = await renderTerminalLine(5);
	assert.match(markup, /min-w-0 whitespace-pre-wrap break-words block overflow-hidden/);
	assert.match(markup, /max-height:7\.25em/);
	assert.doesNotMatch(markup, /text-ellipsis whitespace-nowrap/);
});
