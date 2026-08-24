import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

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

test("Loop UI draft shows uncached after Ralph-to-Goal switch while legacy Goals remain total", async () => {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { GoalTokenAccountingNotice } = await import("./src/apps/chat-ui/src/LoopArea.tsx");
		const base = {
			id: "loop_ralph",
			mode: "ralph",
			name: "Legacy Ralph",
			enabled: false,
			target: { kind: "default-chat" },
			profile: "base",
			prompt: "Continue",
			state: {},
			createdAt: "2026-08-24T00:00:00.000Z",
			updatedAt: "2026-08-24T00:00:00.000Z",
		};
		const render = (selectedJob) => renderToStaticMarkup(React.createElement(GoalTokenAccountingNotice, { selectedJob, draftMode: "goal" }));
		console.log(JSON.stringify({
			fromRalph: render(base),
			legacyGoal: render({ ...base, id: "loop_legacy", mode: "goal", state: { goalStatus: "paused" } }),
			newGoal: render({ ...base, id: "loop_new", mode: "goal", state: { goalStatus: "active", tokenAccounting: { version: 1, basis: "uncached" } } }),
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	const rendered = JSON.parse(stdout.trim());
	assert.match(rendered.fromRalph, /data-pibo-goal-token-accounting="uncached"/);
	assert.match(rendered.fromRalph, /budget counts uncached input and output tokens/);
	assert.doesNotMatch(rendered.fromRalph, /legacy Goal keeps total-token accounting/);
	assert.match(rendered.legacyGoal, /data-pibo-goal-token-accounting="total"/);
	assert.match(rendered.legacyGoal, /legacy Goal keeps total-token accounting, including cache reads and writes/);
	assert.match(rendered.newGoal, /data-pibo-goal-token-accounting="uncached"/);
});
