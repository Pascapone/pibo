import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function renderContextualActionLabels() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		globalThis.React = React;
		const { SessionSidebar } = await import("./src/apps/chat-ui/src/session-sidebar.tsx");

		const roomId = "11111111-2222-4333-8444-555555555555";
		const secondRoomId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
		const sessionId = "66666666-7777-4888-8999-000000000000";
		const secondSessionId = "12345678-1234-4234-8234-123456789abc";
		const workspace = "/srv/private/pibo-workspace";
		const makeRoom = (id, name) => ({
			id,
			name,
			workspace,
			type: "chat",
			createdAt: "2026-08-08T00:00:00.000Z",
			updatedAt: "2026-08-08T00:00:00.000Z",
			metadata: {},
		});
		const makeSession = (piboSessionId, title) => ({
			piboSessionId,
			piSessionId: "technical-pi-session-key",
			profile: "pibo-agent",
			title,
			status: "idle",
			derivedSessions: [],
			children: [],
		});
		const renderSidebar = ({ roomName, sessionTitle }) => {
			const rooms = [makeRoom(roomId, roomName), makeRoom(secondRoomId, "Research")];
			const sessions = [makeSession(sessionId, sessionTitle), makeSession(secondSessionId, "Build verification")];
			return renderToStaticMarkup(React.createElement(SessionSidebar, {
				bootstrap: { selectedRoomId: roomId, room: rooms[0], rooms, agents: [] },
				selectedRoomId: roomId,
				selectedPiboSessionId: sessionId,
				showArchivedRooms: false,
				onToggleArchivedRooms() {},
				creatingRoom: false,
				onCreateRoom() {},
				onSelectRoom() {},
				onUpdateRoom() {},
				onArchiveRoom() {},
				onReadAllRoom() {},
				onDeleteRoom() {},
				newSessionProfile: "pibo-agent",
				newSessionProfileReady: true,
				onNewSessionProfileChange() {},
				selectedRoomArchived: false,
				creatingSession: false,
				onCreateSession() {},
				showArchived: false,
				onToggleArchivedSessions() {},
				loadingArchivedSessions: false,
				visibleActiveSessions: sessions,
				visibleArchivedSessions: [],
				totalActiveSessionCount: sessions.length,
				totalArchivedSessionCount: 0,
				hasMoreActiveSessions: false,
				hasMoreArchivedSessions: false,
				loadingActiveSessions: false,
				sessionListScrollRef: { current: null },
				onLoadMoreSessions() {},
				signalNow: Date.parse("2026-08-08T00:00:00.000Z"),
				selectedSessionPathIds: new Set(),
				onSelectSession() {},
				onRenameSession() {},
				onArchiveSession() {},
				onDeleteSession() {},
				onViewContext() {},
				onAutoRenameConsumed() {},
			}));
		};
		const actionLabels = (html) => Array.from(
			html.matchAll(/aria-label="(Actions for (?:room|session) [^"]+)"/g),
			(match) => match[1],
		);

		const initialLabels = actionLabels(renderSidebar({ roomName: "Pibo", sessionTitle: "Action menu labels" }));
		assert.deepEqual(initialLabels, [
			"Actions for room Pibo",
			"Actions for room Research",
			"Actions for session Action menu labels",
			"Actions for session Build verification",
		]);

		const renamedLabels = actionLabels(renderSidebar({ roomName: "Pibo renamed", sessionTitle: "Contextual labels renamed" }));
		assert.deepEqual(renamedLabels, [
			"Actions for room Pibo renamed",
			"Actions for room Research",
			"Actions for session Contextual labels renamed",
			"Actions for session Build verification",
		]);
		for (const label of [...initialLabels, ...renamedLabels]) {
			assert.doesNotMatch(label, /(?:11111111|aaaaaaaa|66666666|12345678|technical-pi-session-key|\\/srv\\/private)/);
			assert.doesNotMatch(label, /(?:open|closed|expanded|collapsed)/i);
		}
	`;
	try {
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: resolve(here, "..") });
	} catch (error) {
		throw new Error(error.stderr || error.message);
	}
}

test("Room and Session action triggers use distinct user-facing names that update after rename", async () => {
	await renderContextualActionLabels();
});

test("action trigger names bind only to the displayed Room and Session names", () => {
	const roomSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");
	const sessionSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-node.tsx"), "utf8");

	assert.match(roomSource, /<ActionMenu label=\{`Actions for room \$\{room\.name\}`\}/);
	assert.match(sessionSource, /<ActionMenu\s+label=\{`Actions for session \$\{safeTitle\}`\}/);
	assert.doesNotMatch(roomSource, /label=\{`Actions for room[^`]*\$\{room\.(?:id|workspace|metadata)/);
	assert.doesNotMatch(sessionSource, /label=\{`Actions for session[^`]*\$\{node\.(?:piboSessionId|piSessionId|profile|status)/);
});
