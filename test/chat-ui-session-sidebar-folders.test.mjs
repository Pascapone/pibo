import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runFolderModelScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const model = await import("./src/apps/chat-ui/src/session-folder-model.ts");

		const empty = model.emptySessionFolderState();
		assert.deepEqual(empty, { version: 1, expandedRoomIds: [], pinnedSessionsOnly: false });
		assert.equal(model.isRoomExpandedInFolder(empty, "room-a"), false);

		const expanded = model.expandRoomInFolder(empty, "room-a");
		assert.equal(model.isRoomExpandedInFolder(expanded, "room-a"), true);
		assert.equal(model.isRoomExpandedInFolder(expanded, "room-b"), false);
		assert.deepEqual(model.expandRoomInFolder(expanded, "room-a").expandedRoomIds, ["room-a"]);

		const toggled = model.toggleRoomExpandedInFolder(expanded, "room-a");
		assert.equal(model.isRoomExpandedInFolder(toggled, "room-a"), false);
		const retoggled = model.toggleRoomExpandedInFolder(toggled, "room-b");
		assert.deepEqual(retoggled.expandedRoomIds, ["room-b"]);

		const persisted = { version: 1, expandedRoomIds: ["room-a", "room-b"], pinnedSessionsOnly: true };
		assert.deepEqual(model.parseSessionFolderState(model.serializeSessionFolderState(persisted)), persisted);
		assert.deepEqual(model.parseSessionFolderState("broken"), model.emptySessionFolderState());
		assert.deepEqual(model.parseSessionFolderState(JSON.stringify({ version: 99 })), model.emptySessionFolderState());
		assert.deepEqual(
			model.parseSessionFolderState(JSON.stringify({ version: 1, expandedRoomIds: ["ok", 42, null], pinnedSessionsOnly: "yes" })),
			{ version: 1, expandedRoomIds: ["ok"], pinnedSessionsOnly: false },
		);
		const storage = new Map();
		model.writeSessionFolderState(persisted, { setItem: (key, value) => storage.set(key, value) });
		assert.deepEqual(model.readSessionFolderState({ getItem: (key) => storage.get(key) ?? null }), persisted);

		const sessions = [
			{ piboSessionId: "ps-pinned", title: "Pinned", pinned: true, children: [{ piboSessionId: "ps-child", title: "Child", children: [] }] },
			{ piboSessionId: "ps-plain", title: "Plain", children: [] },
		];
		assert.equal(model.filterFolderSessions(sessions, false), sessions);
		const pinnedOnly = model.filterFolderSessions(sessions, true);
		assert.deepEqual(pinnedOnly.map((node) => node.piboSessionId), ["ps-pinned"]);
		assert.equal(pinnedOnly[0].children.length, 1);

		const overlay = {
			generatedAt: "2026-09-19T00:00:00.000Z",
			rootVersions: {},
			sessions: {
				"ps-running": { piboSessionId: "ps-running", rootPiboSessionId: "ps-running", updatedAt: "2026-09-19T00:00:00.000Z", status: "idle", isTreeActive: true },
				"ps-error": { piboSessionId: "ps-error", rootPiboSessionId: "ps-error", updatedAt: "2026-09-19T00:00:00.000Z", status: "error", isTreeActive: false },
				"ps-read-error": { piboSessionId: "ps-read-error", rootPiboSessionId: "ps-read-error", updatedAt: "2026-09-19T00:00:00.000Z", status: "error", isTreeActive: false },
			},
		};
		const nodes = [
			{ piboSessionId: "ps-running", title: "Running", status: "idle", children: [], derivedSessions: [] },
			{ piboSessionId: "ps-error", title: "Error", status: "idle", unreadCount: 2, children: [], derivedSessions: [] },
			{ piboSessionId: "ps-read-error", title: "Read", status: "idle", children: [], derivedSessions: [] },
			{ piboSessionId: "ps-plain", title: "Plain", status: "idle", children: [], derivedSessions: [] },
		];
		const overlaid = model.applyFolderStatusOverlay(nodes, overlay);
		assert.equal(overlaid.find((node) => node.piboSessionId === "ps-running").status, "running");
		assert.equal(overlaid.find((node) => node.piboSessionId === "ps-error").status, "error");
		assert.equal(overlaid.find((node) => node.piboSessionId === "ps-read-error").status, "idle");
		assert.equal(overlaid.find((node) => node.piboSessionId === "ps-plain").status, "idle");
		assert.equal(model.applyFolderStatusOverlay(nodes, null), nodes);
		assert.equal(model.applyFolderStatusOverlay(nodes, undefined), nodes);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--loader", "./test/helpers/css-stub-loader.mjs", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session folder state persists expansion and filters to pinned sessions", async () => {
	await assert.doesNotReject(runFolderModelScenarios());
});

async function renderFolderSidebar() {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SessionSidebar } from "./src/apps/chat-ui/src/session-sidebar.tsx";
		globalThis.React = React;
		const shared = { id: "room-shared", name: "Personal Chat", type: "chat", metadata: { default: true }, children: [], unreadCount: 4 };
		const selected = { id: "room-a", name: "Room A", type: "chat", metadata: {}, children: [], unreadCount: 2 };
		const other = { id: "room-b", name: "Room B", type: "chat", metadata: {}, children: [] };
		const sessions = [
			{ piboSessionId: "ps-one", title: "Sidebar Follow-up", status: "running", pinned: true, unreadCount: 3, children: [], derivedSessions: [] },
			{ piboSessionId: "ps-two", title: "Terminal Scroll", status: "idle", children: [], derivedSessions: [] },
		];
		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: { selectedRoomId: selected.id, room: selected, rooms: [shared, selected, other], agents: [{ name: "pibo-agent-v2" }] },
			selectedRoomId: selected.id, selectedPiboSessionId: "ps-one", showArchivedRooms: false,
			onToggleArchivedRooms: noop, creatingRoom: false, onCreateRoom: noop, onSelectRoom: noop,
			onUpdateRoom: noop, onArchiveRoom: noop, onReadAllRoom: noop, onDeleteRoom: noop,
			newSessionProfile: "pibo-agent-v2", newSessionProfileReady: true, onNewSessionProfileChange: noop,
			selectedRoomArchived: false, creatingSession: false, onCreateSession: noop, onCreateWorkflowSession: noop,
			showArchived: false, onToggleArchivedSessions: noop, loadingArchivedSessions: false,
			visibleActiveSessions: sessions, visibleArchivedSessions: [], totalActiveSessionCount: 2,
			totalArchivedSessionCount: 0, hasMoreActiveSessions: false, hasMoreArchivedSessions: false,
			loadingActiveSessions: false, sessionListScrollRef: { current: null }, onLoadMoreSessions: noop,
			signalNow: 0, selectedSessionPathIds: new Set(["ps-one"]), onSelectSession: noop,
			onRenameSession: noop, onArchiveSession: noop, onPinnedSessionChange: noop, onReorderSession: noop,
			onDeleteSession: noop, onViewContext: noop,
		}));
		console.log(JSON.stringify(html));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--loader", "./test/helpers/css-stub-loader.mjs", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return JSON.parse(stdout);
}

test("rooms render as expandable folders with the selected room expanded", async () => {
	const html = await renderFolderSidebar();
	const toggles = html.match(/data-pibo-debug="room-folder-toggle"/g) ?? [];
	assert.equal(toggles.length, 3);
	assert.match(html, /data-pibo-debug="room-folder"[^>]*data-pibo-room-id="room-a"[^>]*data-pibo-state="expanded"/);
	assert.match(html, /data-pibo-debug="room-folder"[^>]*data-pibo-room-id="room-b"[^>]*data-pibo-state="collapsed"/);
	assert.match(html, /aria-label="Collapse room Room A"/);
	assert.match(html, /aria-label="Expand room Room B"/);
	assert.match(html, /aria-label="Pinned sessions only"/);
	assert.match(html, /Sidebar Follow-up/);
	assert.match(html, /Terminal Scroll/);
	assert.match(html, /aria-label="New session in Room A"/);
	assert.match(html, /aria-label="New session in Room B"/);
	assert.doesNotMatch(html, /new-session-agent-select/);
	assert.doesNotMatch(html, />Sessions</);
});

test("the Shared Chat room sorts first inside the Rooms list without its own heading", async () => {
	const html = await renderFolderSidebar();
	assert.ok(html.indexOf("Personal Chat") < html.indexOf(">Room A<"), "expected the Shared Chat room first in the Rooms list");
	assert.doesNotMatch(html, />Shared Chat</);
});

test("selected sessions bleed edge to edge without shrinking and mark only the room icon", async () => {
	const html = await renderFolderSidebar();
	assert.match(html, /data-pibo-selected="true"[^>]*bg-\[#11a4d4\]\/20/, "expected the translucent full-bleed fill on the selected session");
	assert.match(html, /data-pibo-selected="true"[^>]*w-auto/, "expected width auto so negative margins grow the row instead of shrinking it");
	assert.match(html, /aria-hidden="true"[^>]*w-\[3px\][^>]*bg-\[#11a4d4\]/, "expected the 3px selection bar on the selected session");
	assert.match(html, /data-pibo-debug="room-node"[^>]*border-transparent/, "expected unmarked room rows");
	assert.match(html, /aria-label="Collapse room Room A"[\s\S]{0,400}border-\[#11a4d4\]/, "expected the active room icon tile in standard blue with a blue border");
	assert.match(html, /aria-label="Expand room Room B"[\s\S]{0,400}border-transparent/, "expected inactive room icon tiles without a border");
	const { readFile } = await import("node:fs/promises");
	const source = await readFile("src/apps/chat-ui/src/session-sidebar.tsx", "utf8");
	assert.match(source, /folderToggle \? folderToggle\.onToggle\(room\.id\) : onSelect\(room\.id\)/, "expected folder room clicks to only expand/collapse without selecting a session");
});
