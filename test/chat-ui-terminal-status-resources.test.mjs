import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderResourceScenario() {
	const script = String.raw`
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { TerminalStatusCard } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx";
		const { act, create } = TestRenderer;
		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;

		const row = {
			id: "status-resources",
			kind: "tool.status",
			status: "done",
			lines: [],
			sourceNodeIds: ["status-resources"],
			output: {
				piboSessionId: "ps_resources",
				queuedMessages: 0,
				processing: false,
				streaming: false,
				enabledTools: ["read"],
				enabledSkills: ["pibo-docker-system", "github-server-flow"],
				contextFiles: ["/workspace/AGENTS.md", "pibo://runtime/session-context.md"],
				cwd: "/workspace",
				disposed: false,
			},
		};

		function textOf(value) {
			if (typeof value === "string" || typeof value === "number") return String(value);
			if (Array.isArray(value)) return value.map(textOf).join("");
			if (value?.children) return textOf(value.children);
			if (value?.props) return textOf(value.props.children);
			return "";
		}

		let renderer;
		await act(async () => {
			renderer = create(React.createElement(TerminalStatusCard, { row, piboSessionId: "ps_resources" }));
		});
		const buttons = renderer.root.findAllByType("button");
		const skillButton = buttons.find((button) => textOf(button).includes("Enabled skills"));
		const contextButton = buttons.find((button) => textOf(button).includes("Context files"));
		const collapsedText = textOf(renderer.toJSON());
		await act(async () => {
			skillButton.props.onClick();
			contextButton.props.onClick();
		});
		console.log(JSON.stringify({
			collapsedText,
			expandedText: textOf(renderer.toJSON()),
			skillExpanded: renderer.root.findAllByType("button").find((button) => textOf(button).includes("Enabled skills")).props["aria-expanded"],
			contextExpanded: renderer.root.findAllByType("button").find((button) => textOf(button).includes("Context files")).props["aria-expanded"],
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("Terminal status exposes collapsible skills and context files", async () => {
	const result = await renderResourceScenario();
	assert.match(result.collapsedText, /Enabled tools \(1\)/);
	assert.match(result.collapsedText, /Enabled skills \(2\)/);
	assert.match(result.collapsedText, /Context files \(2\)/);
	assert.doesNotMatch(result.collapsedText, /pibo-docker-system/);
	assert.doesNotMatch(result.collapsedText, /pibo:\/\/runtime\/session-context\.md/);
	assert.match(result.expandedText, /pibo-docker-system/);
	assert.match(result.expandedText, /github-server-flow/);
	assert.match(result.expandedText, /\/workspace\/AGENTS\.md/);
	assert.match(result.expandedText, /pibo:\/\/runtime\/session-context\.md/);
	assert.equal(result.skillExpanded, true);
	assert.equal(result.contextExpanded, true);
});
