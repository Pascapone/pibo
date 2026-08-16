import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");

async function renderSharedRoomSidebar() {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");

		const sharedRoom = {
			id: "room_shared",
			name: "Shared Chat",
			type: "chat",
			metadata: { default: true },
			children: [],
		};
		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: { selectedRoomId: sharedRoom.id, room: sharedRoom, rooms: [sharedRoom], agents: [] },
			selectedRoomId: sharedRoom.id,
			selectedPiboSessionId: null,
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
			visibleActiveSessions: [],
			visibleArchivedSessions: [],
			totalActiveSessionCount: 0,
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

test("The Shared Chat (personal) room exposes a 3-dot action button", async () => {
	const html = await renderSharedRoomSidebar();
	const actionButton = html.match(/aria-label="Actions for room Shared Chat"[^>]*/);
	assert.ok(actionButton, "expected an Actions trigger button for the Shared Chat room");
	assert.match(html, /ellipsis-vertical/);
});

test("The personal room action menu is limited to Read All", () => {
	const markerStart = source.indexOf("{personal ? (");
	assert.notEqual(markerStart, -1, "missing personal branch");
	const branchEnd = source.indexOf(") : (", markerStart);
	assert.notEqual(branchEnd, -1, "unterminated personal branch");
	const personalBranch = source.slice(markerStart, branchEnd);

	assert.match(personalBranch, /ActionMenu/);
	assert.match(personalBranch, /Read All/);
	assert.doesNotMatch(personalBranch, /Copy Room ID|Edit Room|Archive Room|Delete Room|Restore Room/);
	const readAllCount = (personalBranch.match(/<ActionMenuItem\b/g) ?? []).length;
	assert.equal(readAllCount, 1, "expected exactly one action in the personal room menu");
});