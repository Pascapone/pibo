import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderRalphLoopIdButton(jobId) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { RalphLoopIdButton } = await import("./src/apps/chat-ui/src/RalphArea.tsx");
		const markup = renderToStaticMarkup(React.createElement(RalphLoopIdButton, { jobId: ${JSON.stringify(jobId)} }));
		console.log(markup);
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return stdout.trim();
}

test("Ralph loop detail header exposes an accessible copyable loop ID", async () => {
	const markup = await renderRalphLoopIdButton("ralph_issue204_loop");

	assert.match(markup, />Loop ID</);
	assert.match(markup, /ralph_issue204_loop/);
	assert.match(markup, /<button[^>]+type="button"/);
	assert.match(markup, /title="Copy Ralph loop ID"/);
	assert.match(markup, /aria-label="Copy Ralph loop ID"/);
	assert.match(markup, /focus:ring-\[\#11a4d4\]/);
});
