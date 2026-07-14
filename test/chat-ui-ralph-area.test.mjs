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

async function renderNewRalphJob(rooms) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { RalphArea } = await import("./src/apps/chat-ui/src/RalphArea.tsx");
		const bootstrap = { rooms: ${JSON.stringify(rooms)}, agents: [], customAgents: [] };
		console.log(renderToStaticMarkup(React.createElement(RalphArea, { bootstrap })));
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

test("new Ralph jobs default to a writable room and exclude archived room options", async () => {
	const room = (id, name, archived = false) => ({
		id,
		name,
		type: "chat",
		createdAt: "2026-07-14T00:00:00Z",
		updatedAt: "2026-07-14T00:00:00Z",
		metadata: archived ? { chatRoomArchivedAt: "2026-07-14T01:00:00Z" } : {},
	});
	const markup = await renderNewRalphJob([
		room("room-archived", "Archived Room", true),
		room("room-active", "Active Room"),
	]);

	assert.doesNotMatch(markup, /Archived Room/);
	assert.match(markup, /<option value="room-active" selected="">Active Room<\/option>/);
	assert.match(markup, /Target: <span[^>]*>Active Room<\/span>/);
});
