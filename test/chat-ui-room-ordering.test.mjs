import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runSourceAssertions() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		globalThis.React = React;
		const {
			reorderRoomRootsInBootstrap,
			setRoomPinnedInBootstrap,
		} = await import("./src/apps/chat-ui/src/app-bootstrap-mutations.ts");
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");

		const room = (id, metadata = {}) => ({
			id,
			name: id,
			type: "chat",
			createdAt: "2026-09-04T00:00:00.000Z",
			updatedAt: "2026-09-04T00:00:00.000Z",
			metadata,
			children: [],
		});
		const shared = room("shared", { default: true });
		const pinnedRoom = room("pinned-room", { chatRoomPinnedAt: "2026-09-04T01:00:00.000Z" });
		const normalA = room("normal-a");
		const normalB = room("normal-b");
		const session = { id: "session-a", piSessionId: "pi-session-a", channel: "web", kind: "chat", profile: "pibo-agent", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" };
		const sessionNode = {
			piboSessionId: session.id,
			piSessionId: session.piSessionId,
			profile: session.profile,
			title: "Session A",
			status: "idle",
			derivedSessions: [],
			children: [],
		};
		const base = {
			session,
			room: pinnedRoom,
			selectedRoomId: pinnedRoom.id,
			selectedPiboSessionId: session.id,
			rooms: [shared, pinnedRoom, normalA, normalB],
			agents: [],
			customAgents: [],
			agentFolders: [],
			capabilities: { actions: [] },
			sessions: [sessionNode],
		};

		const pinned = setRoomPinnedInBootstrap(base, normalB.id, true);
		assert.deepEqual(pinned.rooms.map((item) => item.id), [shared.id, normalB.id, pinnedRoom.id, normalA.id]);
		const unpinned = setRoomPinnedInBootstrap(pinned, normalB.id, false);
		assert.deepEqual(unpinned.rooms.map((item) => item.id), [shared.id, pinnedRoom.id, normalB.id, normalA.id]);
		const reordered = reorderRoomRootsInBootstrap(unpinned, normalA.id, normalB.id, "before");
		assert.deepEqual(reordered.rooms.map((item) => item.id), [shared.id, pinnedRoom.id, normalA.id, normalB.id]);
		assert.equal(reorderRoomRootsInBootstrap(reordered, pinnedRoom.id, normalA.id, "after"), reordered);

		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: base,
			selectedRoomId: pinnedRoom.id,
			selectedPiboSessionId: session.id,
			showArchivedRooms: false,
			onToggleArchivedRooms: noop,
			creatingRoom: false,
			onCreateRoom: noop,
			onSelectRoom: noop,
			onUpdateRoom: noop,
			onArchiveRoom: noop,
			onPinnedRoomChange: noop,
			onReorderRoom: noop,
			onReadAllRoom: noop,
			onDeleteRoom: noop,
			newSessionProfile: "pibo-agent",
			newSessionProfileReady: true,
			onNewSessionProfileChange: noop,
			selectedRoomArchived: false,
			creatingSession: false,
			onCreateSession: noop,
			showArchived: false,
			onToggleArchivedSessions: noop,
			loadingArchivedSessions: false,
			visibleActiveSessions: [sessionNode],
			visibleArchivedSessions: [],
			totalActiveSessionCount: 1,
			totalArchivedSessionCount: 0,
			hasMoreActiveSessions: false,
			hasMoreArchivedSessions: false,
			loadingActiveSessions: false,
			sessionListScrollRef: { current: null },
			onLoadMoreSessions: noop,
			signalNow: Date.now(),
			selectedSessionPathIds: new Set(),
			onSelectSession: noop,
			onRenameSession: noop,
			onArchiveSession: noop,
			onPinnedSessionChange: noop,
			onReorderSession: noop,
			onDeleteSession: noop,
			onViewContext: noop,
			onAutoRenameConsumed: noop,
		}));
		assert.match(html, /data-pibo-debug="pinned-room-divider"/);
		assert.match(html, /aria-label="Pinned room"/);
		assert.match(html, /draggable="true"/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Room sidebar mirrors session pinning and drag ordering without a drag handle", async () => {
	await runSourceAssertions();
	const sidebarSource = await readFile("src/apps/chat-ui/src/session-sidebar.tsx", "utf8");
	assert.match(sidebarSource, /Pin Room/);
	assert.match(sidebarSource, /Unpin Room/);
	assert.doesNotMatch(sidebarSource, /GripVertical|showDragHandle/);
});
