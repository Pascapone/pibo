import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runHeaderUsageScenario() {
	const script = String.raw`
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { extractHeaderUsage, TerminalHeaderUsage, usageHealthColor } from "./src/apps/chat-ui/src/session-header-usage.tsx";
		const status = {
			contextUsage: { tokens: 8000, contextWindow: 10000 },
			providerUsage: {
				limits: [
					{ label: "5h limit", usedPercent: 10, remainingPercent: 90 },
					{ label: "1w limit", usedPercent: 20, remainingPercent: 80, resetsAt: "2026-09-07T12:00:00.000Z" },
				],
			},
		};
		const { act, create } = TestRenderer;
		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const usage = extractHeaderUsage(status);
		let renderer;
		await act(async () => {
			renderer = create(React.createElement(TerminalHeaderUsage, { status }));
		});
		const weekly = renderer.root.findByProps({ "data-pibo-usage-meter": "weekly-limit" });
		const context = renderer.root.findByProps({ "data-pibo-usage-meter": "context-usage" });
		const weeklyBar = weekly.findAllByType("div").find((node) => node.props.style?.width);
		const contextBar = context.findAllByType("div").find((node) => node.props.style?.width);
		console.log(JSON.stringify({
			usage,
			weeklyText: weekly.findAllByType("span").map((node) => node.children.join("")).join(" "),
			contextText: context.findAllByType("span").map((node) => node.children.join("")).join(" "),
			weeklyWidth: weeklyBar.props.style.width,
			contextWidth: contextBar.props.style.width,
			weeklyColor: weeklyBar.props.style.backgroundColor,
			contextColor: contextBar.props.style.backgroundColor,
			fullColor: usageHealthColor(100),
			emptyColor: usageHealthColor(0),
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("Terminal header shows weekly remaining and context consumed with inverse health colors", async () => {
	const result = await runHeaderUsageScenario();
	assert.equal(result.usage.weeklyRemainingPercent, 80);
	assert.equal(result.usage.contextPercent, 80);
	assert.equal(result.weeklyWidth, "80%");
	assert.equal(result.contextWidth, "80%");
	assert.match(result.weeklyText, /Weekly Limit 80%/);
	assert.match(result.contextText, /Context Usage 80%/);
	assert.notEqual(result.weeklyColor, result.contextColor, "80% remaining must be healthier than 80% consumed");
	assert.equal(result.fullColor, "rgb(34, 197, 94)");
	assert.equal(result.emptyColor, "rgb(239, 68, 68)");
});
