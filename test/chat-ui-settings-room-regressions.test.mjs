import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const root = new URL("../", import.meta.url);

test("every Settings panel owns a viewport-bounded scroll container", async () => {
	const source = await readFile(new URL("../src/apps/chat-ui/src/settings/SettingsView.tsx", import.meta.url), "utf8");
	const panelRoots = [...source.matchAll(/<div className="([^"]*overflow-auto[^"]*)">/g)].map((match) => match[1]);
	assert.equal(panelRoots.length, 11);
	for (const className of panelRoots) {
		assert.match(className, /\bh-full\b/);
		assert.match(className, /\bmin-h-0\b/);
	}
});

test("Room snapshots restore the prior Session subtree without replacing the fresh Room catalog", async () => {
	const { restoreRoomNavigationSnapshot, roomNavigationSnapshot } = await tsImport(
		"../src/apps/chat-ui/src/app-navigation-merge.ts",
		import.meta.url,
	);
	const base = {
		identity: { userId: "user" },
		session: { id: "session-b" },
		room: { id: "room-b", name: "B", type: "chat", metadata: {}, children: [] },
		selectedRoomId: "room-b",
		selectedPiboSessionId: "ps-b",
		rooms: [{ id: "room-a", name: "A renamed", type: "chat", metadata: {}, children: [] }],
		sessions: [{ piboSessionId: "ps-b", children: [] }],
		agents: [], customAgents: [], agentFolders: [], capabilities: { actions: [] },
	};
	const priorA = {
		...base,
		session: { id: "session-a" },
		room: { id: "room-a", name: "A", type: "chat", metadata: {}, children: [] },
		selectedRoomId: "room-a",
		selectedPiboSessionId: "ps-a",
		rooms: [{ id: "room-a", name: "A", type: "chat", metadata: {}, children: [] }],
		sessions: [{ piboSessionId: "ps-a", title: "A Session", children: [] }],
	};
	const restored = restoreRoomNavigationSnapshot(base, roomNavigationSnapshot(priorA));
	assert.equal(restored.selectedRoomId, "room-a");
	assert.equal(restored.selectedPiboSessionId, "ps-a");
	assert.equal(restored.sessions[0].title, "A Session");
	assert.equal(restored.rooms[0].name, "A renamed", "global Room metadata stays on the freshest bootstrap");
	const emptyRestored = restoreRoomNavigationSnapshot(base, roomNavigationSnapshot({
		...priorA,
		selectedPiboSessionId: null,
		sessions: [],
	}));
	assert.equal(emptyRestored.selectedRoomId, "room-a");
	assert.equal(emptyRestored.selectedPiboSessionId, null);
	assert.deepEqual(emptyRestored.sessions, [], "known empty Rooms are cacheable and cannot expose another Room's Sessions");
});

test("Room selection owns route and cached context before forced validation", async () => {
	const app = await readFile(new URL("../src/apps/chat-ui/src/App.tsx", import.meta.url), "utf8");
	const routeEffect = app.slice(app.indexOf("const stored = readStoredSelection()"), app.indexOf("useEffect(() => {\n\t\tif (!selectedRoomId"));
	assert.match(routeEffect, /if \(loadingRoomId \|\| shouldSkipRouteSelectionLoad/);
	const selectRoom = app.slice(app.indexOf("const selectRoom = useCallback"), app.indexOf("const toggleArchivedRooms"));
	assert.match(selectRoom, /roomNavigationSnapshotsRef\.current\.get\(roomId\)/);
	assert.match(selectRoom, /restoreRoomNavigationSnapshot/);
	assert.match(app, /if \(bootstrap\?\.selectedRoomId\) \{\s*roomNavigationSnapshotsRef\.current\.set/);
	assert.match(app, /&&\s*!roomNavigationSnapshotsRef\.current\.has\(loadingRoomId\)/);
	const immediateRoute = selectRoom.indexOf("if (storedPiboSessionId) navigateToSelectedSession");
	const validatingLoad = selectRoom.indexOf("const navigation = loadNavigation");
	assert.ok(immediateRoute >= 0 && immediateRoute < validatingLoad, "cached return pushes the target route before navigation data resolves");
	assert.match(selectRoom, /loadNavigation\(storedPiboSessionId,[\s\S]*\{ force: true, signal: controller\.signal \}/);
	assert.match(selectRoom, /navigateToSelectedSession\(data\.selectedRoomId, data\.selectedPiboSessionId, Boolean\(storedPiboSessionId\)/);
});
