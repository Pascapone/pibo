import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
			addSessionNodeToBootstrap,
			reorderSessionRootsInBootstrap,
			setSessionPinnedInBootstrap,
		} = await import("./src/apps/chat-ui/src/app-bootstrap-mutations.ts");
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");
		const { buildSessionNodes } = await import("./src/apps/chat/trace.ts");

		const activityIndependentNodes = await buildSessionNodes([
			{ id: "older", piSessionId: "pi-older", channel: "web", kind: "chat", profile: "base", title: "Older", metadata: {}, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-04T12:00:00.000Z" },
			{ id: "newer", piSessionId: "pi-newer", channel: "web", kind: "chat", profile: "base", title: "Newer", metadata: {}, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
		], [
			{ piboSessionId: "older", piSessionId: "pi-older", profile: "base", channel: "web", kind: "chat", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-04T12:00:00.000Z", lastActivityAt: "2026-09-04T12:00:00.000Z", status: "running" },
			{ piboSessionId: "newer", piSessionId: "pi-newer", profile: "base", channel: "web", kind: "chat", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", lastActivityAt: "2026-09-02T00:00:00.000Z", status: "idle" },
		]);
		assert.deepEqual(activityIndependentNodes.map((item) => item.piboSessionId), ["newer", "older"]);

		const node = (id, pinned = false) => ({
			piboSessionId: id,
			piSessionId: "pi-" + id,
			profile: "pibo-agent",
			title: id,
			createdAt: "2026-09-04T00:00:00.000Z",
			pinned,
			status: "idle",
			derivedSessions: [],
			children: [],
		});
		const session = { id: "pinned-a", piSessionId: "pi-pinned-a", channel: "web", kind: "chat", profile: "pibo-agent", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" };
		const base = {
			session,
			selectedRoomId: "room-a",
			selectedPiboSessionId: "pinned-a",
			rooms: [],
			agents: [],
			customAgents: [],
			agentFolders: [],
			capabilities: { actions: [] },
			sessions: [node("pinned-a", true), node("normal-a"), node("normal-b")],
		};

		const created = addSessionNodeToBootstrap(base, node("new-normal"));
		assert.deepEqual(created.sessions.map((item) => item.piboSessionId), ["pinned-a", "new-normal", "normal-a", "normal-b"]);
		const pinned = setSessionPinnedInBootstrap(created, "normal-b", true);
		assert.deepEqual(pinned.sessions.map((item) => item.piboSessionId), ["normal-b", "pinned-a", "new-normal", "normal-a"]);
		const unpinned = setSessionPinnedInBootstrap(pinned, "normal-b", false);
		assert.deepEqual(unpinned.sessions.map((item) => item.piboSessionId), ["pinned-a", "normal-b", "new-normal", "normal-a"]);
		const reordered = reorderSessionRootsInBootstrap(unpinned, "normal-a", "normal-b", "before");
		assert.deepEqual(reordered.sessions.map((item) => item.piboSessionId), ["pinned-a", "normal-a", "normal-b", "new-normal"]);
		assert.equal(reorderSessionRootsInBootstrap(reordered, "pinned-a", "normal-a", "after"), reordered);

		const room = { id: "room-a", name: "Room A", type: "chat", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", metadata: {}, children: [] };
		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: { ...base, room, rooms: [room] },
			selectedRoomId: room.id,
			selectedPiboSessionId: "pinned-a",
			showArchivedRooms: false,
			onToggleArchivedRooms: noop,
			creatingRoom: false,
			onCreateRoom: noop,
			onSelectRoom: noop,
			onUpdateRoom: noop,
			onArchiveRoom: noop,
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
			visibleActiveSessions: base.sessions,
			visibleArchivedSessions: [],
			totalActiveSessionCount: base.sessions.length,
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
		assert.match(html, /data-pibo-debug="pinned-session-divider"/);
		assert.match(html, /aria-label="Pinned session"/);
		assert.match(html, /draggable="true"/);
		assert.doesNotMatch(html, />Pinned Sessions</);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Session sidebar keeps pinned and normal ordering user-controlled", async () => {
	await runSourceAssertions();
});
