import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppRouteSelectionScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			hasExplicitSessionsRouteSelection,
			routeSelectionRequest,
			sessionsRouteCanonicalSelection,
			shouldSkipRouteSelectionLoad,
		} = await import("./src/apps/chat-ui/src/app-route-selection.ts");

		assert.deepEqual(
			routeSelectionRequest(
				{ area: "sessions", roomId: "room-a" },
				{ roomId: "stored-room", piboSessionId: "stored-session", sessionsByRoom: { "room-a": "room-session" } },
			),
			{ requestedRoomId: "room-a", requestedPiboSessionId: "room-session" },
		);
		assert.deepEqual(
			routeSelectionRequest(
				{ area: "sessions", roomId: "room-a", piboSessionId: "explicit-session" },
				{ roomId: "stored-room", piboSessionId: "stored-session", sessionsByRoom: { "room-a": "room-session" } },
			),
			{ requestedRoomId: "room-a", requestedPiboSessionId: "explicit-session" },
		);
		assert.deepEqual(
			routeSelectionRequest(
				{ area: "sessions" },
				{ roomId: "stored-room", piboSessionId: "stored-session" },
			),
			{ requestedRoomId: "stored-room", requestedPiboSessionId: "stored-session" },
		);
		assert.deepEqual(
			routeSelectionRequest(
				{ area: "context", piboSessionId: "context-session" },
				{ roomId: "stored-room", piboSessionId: "stored-session" },
			),
			{ requestedRoomId: undefined, requestedPiboSessionId: "context-session" },
		);
		assert.deepEqual(
			routeSelectionRequest(
				{ area: "settings", panel: "providers" },
				{ roomId: "stored-room", piboSessionId: "stored-session" },
			),
			{ requestedRoomId: "stored-room", requestedPiboSessionId: "stored-session" },
		);

		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: { selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
				creatingSession: false,
				route: { area: "settings", panel: "general" },
			}),
			true,
		);
		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: { selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
				creatingSession: false,
				route: { area: "context", piboSessionId: "session-a" },
			}),
			true,
		);
		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: { selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
				creatingSession: false,
				route: { area: "context", piboSessionId: "session-b" },
			}),
			false,
		);
		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: null,
				creatingSession: true,
				route: { area: "sessions", piboSessionId: "session-a" },
			}),
			true,
		);
		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: { selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
				creatingSession: false,
				route: { area: "sessions", roomId: "room-a", piboSessionId: "session-a" },
			}),
			true,
		);
		assert.equal(
			shouldSkipRouteSelectionLoad({
				bootstrap: { selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
				creatingSession: false,
				route: { area: "sessions", piboSessionId: "session-a" },
			}),
			false,
		);

		assert.deepEqual(
			sessionsRouteCanonicalSelection(
				{ area: "sessions", roomId: "room-a", piboSessionId: "session-a" },
				{ selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
			),
			undefined,
		);
		assert.deepEqual(
			sessionsRouteCanonicalSelection(
				{ area: "sessions", roomId: "room-old", piboSessionId: "session-old" },
				{ selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
			),
			{ selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
		);
		assert.deepEqual(
			sessionsRouteCanonicalSelection(
				{ area: "projects", projectId: "project-a", piboSessionId: "session-a" },
				{ selectedRoomId: "room-a", selectedPiboSessionId: "session-a" },
			),
			undefined,
		);

		assert.equal(hasExplicitSessionsRouteSelection({ area: "sessions", roomId: "room-a" }), true);
		assert.equal(hasExplicitSessionsRouteSelection({ area: "sessions" }), false);
		assert.equal(hasExplicitSessionsRouteSelection({ area: "context", piboSessionId: "session-a" }), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app route-selection helpers preserve stored, explicit, skip, and canonicalization rules", async () => {
	await assert.doesNotReject(runAppRouteSelectionScenario());
});
