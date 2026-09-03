import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Desktop sidebar preserves the existing Rooms, profile, and Sessions data contract", async () => {
	const app = await readFile("src/apps/chat-ui/src/App.tsx", "utf8");
	const desktopSidebar = app.match(/<DesktopSessionSidebar[\s\S]*?<\/DesktopSessionSidebar>/)?.[0] ?? "";
	assert.match(desktopSidebar, /state=\{desktopSessionSidebar\.state\}/);
	assert.match(desktopSidebar, /onStateChange=\{desktopSessionSidebar\.setState\}/);
	assert.match(desktopSidebar, /identity=\{identity\}/);
	for (const wiring of [
		"bootstrap={bootstrap}",
		"visibleActiveSessions={visibleActiveSessions}",
		"visibleArchivedSessions={visibleArchivedSessions}",
		"onSelectRoom={selectRoom}",
		"onCreateRoom={() => createRoom()}",
		"onSelectSession={selectSession}",
		"onCreateSession={() => createSession()}",
		"onArchiveRoom={setRoomArchived}",
		"onArchiveSession={setSessionArchived}",
		"sessionListScrollRef={sessionListScrollRef}",
	]) assert.match(desktopSidebar, new RegExp(wiring.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SessionSidebar } from "./src/apps/chat-ui/src/session-sidebar.tsx";
		globalThis.React = React;
		const shared = { id: "room-shared", name: "Personal Chat", type: "chat", metadata: { default: true }, children: [], unreadCount: 4 };
		const room = { id: "room-pibo", name: "Pibo", type: "chat", metadata: {}, children: [], unreadCount: 2 };
		const sessions = [
			{ piboSessionId: "ps-one", title: "Sidebar Follow-up", status: "running", unreadCount: 3, children: [] },
			{ piboSessionId: "ps-two", title: "Terminal Scroll", status: "idle", children: [] },
		];
		const noop = () => {};
		const html = renderToStaticMarkup(React.createElement(SessionSidebar, {
			bootstrap: { selectedRoomId: room.id, room, rooms: [shared, room], agents: [{ name: "pibo-agent-v2" }] },
			selectedRoomId: room.id, selectedPiboSessionId: "ps-one", showArchivedRooms: false,
			onToggleArchivedRooms: noop, creatingRoom: false, onCreateRoom: noop, onSelectRoom: noop,
			onUpdateRoom: noop, onArchiveRoom: noop, onReadAllRoom: noop, onDeleteRoom: noop,
			newSessionProfile: "pibo-agent-v2", newSessionProfileReady: true, onNewSessionProfileChange: noop,
			selectedRoomArchived: false, creatingSession: false, onCreateSession: noop,
			showArchived: false, onToggleArchivedSessions: noop, loadingArchivedSessions: false,
			visibleActiveSessions: sessions, visibleArchivedSessions: [], totalActiveSessionCount: 2,
			totalArchivedSessionCount: 0, hasMoreActiveSessions: false, hasMoreArchivedSessions: false,
			loadingActiveSessions: false, sessionListScrollRef: { current: null }, onLoadMoreSessions: noop,
			signalNow: 0, selectedSessionPathIds: new Set(["ps-one"]), onSelectSession: noop,
			onRenameSession: noop, onArchiveSession: noop, onDeleteSession: noop, onViewContext: noop,
			onAutoRenameConsumed: noop,
		}));
		console.log(JSON.stringify(html));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	const html = JSON.parse(stdout);
	for (const visible of ["Shared Chat", "Personal Chat", "Rooms", "Pibo", "Sessions", "pibo-agent-v2", "Sidebar Follow-up", "Terminal Scroll"]) {
		assert.match(html, new RegExp(visible));
	}
	assert.match(html, /aria-label="2 unread messages"/);
	assert.match(html, /data-pibo-session-id="ps-one"[^>]*data-pibo-unread-count="3"/);
	assert.match(html, /aria-label="New Room"/);
	assert.match(html, /aria-label="New Session"/);
});

test("Desktop sidebar owns the desktop brand and tooltip-only account controls", async () => {
	const script = `
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { DesktopSessionSidebar } from "./src/apps/chat-ui/src/desktop-session-sidebar.tsx";
		globalThis.React = React;
		const html = renderToStaticMarkup(React.createElement(DesktopSessionSidebar, {
			state: { version: 1, width: 300, collapsed: false },
			onStateChange() {},
			onRefresh() {},
			identity: { userId: "test-user", name: "Test User", email: "test@example.com" },
		}, React.createElement("div", null, "Sidebar content")));
		console.log(JSON.stringify(html));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	const html = JSON.parse(stdout);
	assert.match(html, /data-pibo-debug="desktop-sidebar-app-header"/);
	assert.match(html, /@max-\[190px\]:h-20/);
	assert.match(html, />Pibo Chat</);
	assert.match(html, /title="test@example\.com"/);
	assert.match(html, /aria-label="Signed in as test@example\.com"/);
	assert.match(html, /aria-label="Sign out"/);
	assert.doesNotMatch(html, />test@example\.com</);
});

test("Desktop sidebar resize handle stays fully inside the clipped sidebar", async () => {
	const component = await readFile("src/apps/chat-ui/src/desktop-session-sidebar.tsx", "utf8");
	assert.match(component, /absolute inset-y-0 right-0 z-20 w-2 touch-none cursor-col-resize/);
	assert.doesNotMatch(component, /absolute inset-y-0 -right-1/);
});

test("Desktop sidebar width and collapse state are bounded and persisted", async () => {
	const script = `
		import assert from "node:assert/strict";
		const model = await import("./src/apps/chat-ui/src/desktop-session-sidebar-model.ts");
		let state = model.emptyDesktopSessionSidebarState();
		assert.equal(state.width, 300);
		state = model.resizeDesktopSessionSidebar(state, 10);
		assert.equal(state.width, 150);
		state = model.resizeDesktopSessionSidebar(state, 5_000);
		assert.equal(state.width, 680);
		state = { ...state, collapsed: true };
		assert.deepEqual(model.parseDesktopSessionSidebarState(model.serializeDesktopSessionSidebarState(state)), state);
		assert.deepEqual(model.parseDesktopSessionSidebarState("broken"), model.emptyDesktopSessionSidebarState());
		const storage = new Map();
		model.writeDesktopSessionSidebarState(state, { setItem: (key, value) => storage.set(key, value) });
		assert.deepEqual(model.readDesktopSessionSidebarState({ getItem: (key) => storage.get(key) ?? null }), state);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
