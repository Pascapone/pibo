import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderCompactSidebar() {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");

		const room = {
			id: "room-alpha",
			name: "Room Alpha",
			topic: "Roadmap",
			workspace: "/srv/pibo-alpha",
			type: "chat",
			metadata: {},
			children: [],
		};
		const session = {
			piboSessionId: "session-one",
			title: "Session One",
			status: "idle",
			children: [],
		};
		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: { selectedRoomId: room.id, room, rooms: [room], agents: [] },
			selectedRoomId: room.id,
			selectedPiboSessionId: session.piboSessionId,
			showArchivedRooms: false,
			onToggleArchivedRooms: noop,
			creatingRoom: false,
			onCreateRoom: noop,
			onSelectRoom: noop,
			onUpdateRoom: noop,
			onArchiveRoom: noop,
			onReadAllRoom: noop,
			onDeleteRoom: noop,
			newSessionProfile: "",
			newSessionProfileReady: false,
			onNewSessionProfileChange: noop,
			selectedRoomArchived: false,
			creatingSession: false,
			onCreateSession: noop,
			showArchived: false,
			onToggleArchivedSessions: noop,
			loadingArchivedSessions: false,
			visibleActiveSessions: [session],
			visibleArchivedSessions: [],
			totalActiveSessionCount: 1,
			totalArchivedSessionCount: 0,
			hasMoreActiveSessions: false,
			hasMoreArchivedSessions: false,
			loadingActiveSessions: false,
			sessionListScrollRef: { current: null },
			onLoadMoreSessions: noop,
			signalNow: 0,
			selectedSessionPathIds: new Set(),
			onSelectSession: noop,
			onRenameSession: noop,
			onArchiveSession: noop,
			onDeleteSession: noop,
			onViewContext: noop,
			onAutoRenameConsumed: noop,
		}));
		console.log(JSON.stringify(html));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return JSON.parse(stdout);
}

function buttons(markup) {
	return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ attributes: match[1], body: match[2] }));
}

function visibleText(markup) {
	return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("Room and Session sidebar rows render as compact single-line items", async () => {
	const html = await renderCompactSidebar();
	const renderedButtons = buttons(html);
	const roomButton = renderedButtons.find((button) => button.body.includes(">Room Alpha<"));
	const sessionButton = renderedButtons.find((button) => button.attributes.includes('aria-label="Open session Session One"'));
	const roomActionButton = renderedButtons.find((button) => button.attributes.includes('aria-label="Actions for room Room Alpha"'));
	const sessionActionButton = renderedButtons.find((button) => button.attributes.includes('aria-label="Actions for session Session One"'));

	assert.ok(roomButton);
	assert.ok(sessionButton);
	assert.ok(roomActionButton);
	assert.ok(sessionActionButton);
	assert.equal(visibleText(roomButton.body), "Room Alpha");
	assert.equal(visibleText(sessionButton.body), "Session One");
	assert.match(roomButton.attributes, /\bh-7\b/);
	assert.match(sessionButton.attributes, /\bh-7\b/);
	assert.match(roomActionButton.attributes, /\bh-6\b/);
	assert.match(sessionActionButton.attributes, /\bh-6\b/);
});
