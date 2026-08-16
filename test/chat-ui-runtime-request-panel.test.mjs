import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderPanel(props) {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		globalThis.React = React;
		const { RuntimeRequestPanel } = await import("./src/apps/chat-ui/src/runtime-request-panel.tsx");
		const props = ${JSON.stringify(props)};
		console.log(renderToStaticMarkup(React.createElement(RuntimeRequestPanel, {
			...props,
			onResolved() {},
			onError() {},
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return stdout.trim();
}

test("runtime request panel renders bounded approval choices and structured input controls", async () => {
	const markup = await renderPanel({
		piboSessionId: "ps_runtime_request_panel",
		approvals: [{
			requestId: "approval-product-id",
			requestType: "command_execution",
			title: "Run Codex command",
			detail: "The command needs approval.",
			arguments: { command: "printf approved token=[redacted]" },
			decisions: [
				{ id: "accept", label: "Approve once" },
				{ id: "acceptForSession", label: "Approve for session" },
				{ id: "decline", label: "Decline" },
				{ id: "cancel", label: "Cancel turn" },
			],
		}],
		userInputs: [{
			requestId: "input-product-id",
			blocking: true,
			questions: [{
				id: "approach",
				header: "Approach",
				question: "Which implementation approach should Codex use?",
				options: [
					{ label: "Safe (Recommended)", description: "Use the conservative implementation." },
					{ label: "Fast", description: "Prefer the shortest implementation." },
				],
				allowFreeform: false,
			}, {
				id: "credential",
				header: "Private",
				question: "Provide the private response.",
				allowFreeform: true,
				secret: true,
			}],
		}],
	});
	assert.match(markup, /data-pibo-debug="runtime-request-panel"/);
	assert.match(markup, /data-pibo-debug="runtime-approval-request"/);
	assert.match(markup, /Run Codex command/);
	assert.match(markup, /Approve once/);
	assert.match(markup, /Approve for session/);
	assert.match(markup, /Decline/);
	assert.match(markup, /Cancel turn/);
	assert.match(markup, /token=\[redacted\]/);
	assert.match(markup, /data-pibo-debug="runtime-user-input-request"/);
	assert.match(markup, /Safe \(Recommended\)/);
	assert.match(markup, /Submit response/);
	assert.match(markup, /type="password"/);
	assert.doesNotMatch(markup, /server-request-/);
});

test("runtime request panel renders nothing without pending runtime requests", async () => {
	const markup = await renderPanel({
		piboSessionId: "ps_runtime_request_panel_empty",
		approvals: [],
		userInputs: [],
	});
	assert.equal(markup, "");
});
