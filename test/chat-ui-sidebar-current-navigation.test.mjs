import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderSidebarSelections() {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");

		const rooms = [
			{ id: "room-alpha", name: "Room Alpha", type: "chat", metadata: {}, children: [] },
			{ id: "room-beta", name: "Room Beta", type: "chat", metadata: {}, children: [] },
		];
		const sessions = [
			{ piboSessionId: "session-one", title: "Session One", children: [] },
			{ piboSessionId: "session-two", title: "Session Two", children: [] },
		];
		const bootstrap = { selectedRoomId: "room-alpha", room: rooms[0], rooms, agents: [] };
		const noop = () => {};
		const baseProps = {
			bootstrap,
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
			visibleActiveSessions: sessions,
			visibleArchivedSessions: [],
			totalActiveSessionCount: sessions.length,
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
		};
		const render = (selectedRoomId, selectedPiboSessionId) => renderToStaticMarkup(
			React.createElement(SessionSidebar, { ...baseProps, selectedRoomId, selectedPiboSessionId }),
		);
		console.log(JSON.stringify({
			first: render("room-alpha", "session-one"),
			second: render("room-beta", "session-two"),
			none: render(null, null),
		}));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return JSON.parse(stdout);
}

function buttons(markup) {
	return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ attributes: match[1], body: match[2] }));
}

function roomButton(markup, roomName) {
	const button = buttons(markup).find((candidate) => candidate.body.includes(">" + roomName + "<"));
	assert.ok(button, `expected navigation button for ${roomName}`);
	return button.attributes;
}

function sessionButton(markup, sessionName) {
	const button = buttons(markup).find((candidate) => candidate.attributes.includes(`aria-label="Open session ${sessionName}"`));
	assert.ok(button, `expected navigation button for ${sessionName}`);
	return button.attributes;
}

function assertCurrent(attributes) {
	assert.match(attributes, /\baria-current="page"/);
}

function assertNotCurrent(attributes) {
	assert.doesNotMatch(attributes, /\baria-current=/);
}

test("Room and Session navigation buttons expose and update aria-current", async () => {
	const { first, second, none } = await renderSidebarSelections();

	assertCurrent(roomButton(first, "Room Alpha"));
	assertNotCurrent(roomButton(first, "Room Beta"));
	assertCurrent(sessionButton(first, "Session One"));
	assertNotCurrent(sessionButton(first, "Session Two"));

	assertNotCurrent(roomButton(second, "Room Alpha"));
	assertCurrent(roomButton(second, "Room Beta"));
	assertNotCurrent(sessionButton(second, "Session One"));
	assertCurrent(sessionButton(second, "Session Two"));

	assert.equal((none.match(/aria-current="page"/g) ?? []).length, 0);
});
