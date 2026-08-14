import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runStatusRefreshScenario() {
	const script = String.raw`
		import React from "react";
		import { create } from "react-test-renderer";
		import { TerminalStatusCard } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx";
		globalThis.React = React;
		const requests = [];
		globalThis.fetch = async (path, init) => {
			requests.push({ path: String(path), cache: init?.cache });
			return new Response(JSON.stringify({
				piboSessionId: "ps_status_refresh",
				queuedMessages: 0,
				processing: false,
				streaming: false,
				activeTools: ["read"],
				enabledTools: ["read", "bash"],
				cwd: "/workspace/refreshed",
				disposed: false,
				contextUsage: { tokens: 750, contextWindow: 1000, percent: 75 },
			}), { status: 200, headers: { "content-type": "application/json" } });
		};

		const row = {
			id: "status-row",
			kind: "tool.status",
			status: "done",
			lines: [],
			sourceNodeIds: ["status-row"],
			output: {
				piboSessionId: "ps_status_refresh",
				queuedMessages: 0,
				processing: false,
				streaming: false,
				activeTools: ["read"],
				enabledTools: ["read"],
				cwd: "/workspace/original",
				disposed: false,
				contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
			},
		};

		function textOf(value) {
			if (typeof value === "string" || typeof value === "number") return String(value);
			if (Array.isArray(value)) return value.map(textOf).join("");
			if (value?.children) return textOf(value.children);
			if (value?.props) return textOf(value.props.children);
			return "";
		}

		const renderer = create(React.createElement(TerminalStatusCard, {
			row,
			piboSessionId: "ps_status_refresh",
		}));
		await new Promise((resolve) => setTimeout(resolve, 10));
		const beforeText = textOf(renderer.toJSON());
		const beforeCardCount = renderer.root.findAllByProps({ "data-pibo-component": "TerminalStatusCard" }).length;
		const refreshButton = renderer.root.findByProps({ "aria-label": "Refresh status" });

		refreshButton.props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 20));

		const afterText = textOf(renderer.toJSON());
		const afterCardCount = renderer.root.findAllByProps({ "data-pibo-component": "TerminalStatusCard" }).length;
		const updatedButton = renderer.root.findByProps({ "aria-label": "Refresh status" });

		renderer.update(React.createElement(TerminalStatusCard, {
			row: { ...row, output: { ...row.output, cwd: "/workspace/canonical" } },
			piboSessionId: "ps_status_refresh",
		}));
		await new Promise((resolve) => setTimeout(resolve, 10));
		const canonicalText = textOf(renderer.toJSON());
		console.log(JSON.stringify({
			beforeText,
			afterText,
			canonicalText,
			beforeCardCount,
			afterCardCount,
			requests,
			busy: updatedButton.props["aria-busy"],
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("Terminal status refresh updates the existing card without posting a new action", async () => {
	const result = await runStatusRefreshScenario();
	assert.match(result.beforeText, /\/workspace\/original/);
	assert.doesNotMatch(result.beforeText, /\/workspace\/refreshed/);
	assert.match(result.afterText, /\/workspace\/refreshed/);
	assert.match(result.canonicalText, /\/workspace\/canonical/);
	assert.doesNotMatch(result.canonicalText, /\/workspace\/refreshed/);
	assert.equal(result.beforeCardCount, 1);
	assert.equal(result.afterCardCount, 1);
	assert.deepEqual(result.requests, [{
		path: "/api/chat/status?piboSessionId=ps_status_refresh",
		cache: "no-store",
	}]);
	assert.equal(result.busy, false);
});
