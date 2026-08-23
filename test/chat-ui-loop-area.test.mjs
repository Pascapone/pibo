import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const loopAreaSource = readFileSync(new URL("../src/apps/chat-ui/src/LoopArea.tsx", import.meta.url), "utf8");

test("new Loop UI defaults to same-session goal mode and exposes legacy Ralph mode", async () => {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { LoopArea } = await import("./src/apps/chat-ui/src/LoopArea.tsx");
		const bootstrap = { rooms: [], agents: [{ name: "base" }], customAgents: [] };
		console.log(renderToStaticMarkup(React.createElement(LoopArea, { bootstrap })));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	assert.match(stdout, /Loop Jobs/);
	assert.match(stdout, /Goal — continue in the same session/);
	assert.match(stdout, /<option value="goal" selected="">/);
	assert.match(stdout, /Ralph — fresh session each run/);
	assert.match(stdout, /Goal loops continue in one Pibo Session/);
	assert.match(stdout, /Soft Token Budget/);
	assert.match(stdout, /Pre-turn Token Reserve/);
	assert.match(stdout, /cache reads and writes are excluded/);
	assert.match(stdout, /final turn can overshoot/);
});

test("Loop UI labels legacy total accounting without claiming cache exclusion", () => {
	assert.match(loopAreaSource, /This legacy Goal keeps total-token accounting, including cache reads and writes/);
	assert.match(loopAreaSource, /tokenAccountingLabel\(job\)/);
	assert.match(loopAreaSource, /legacy total/);
});
