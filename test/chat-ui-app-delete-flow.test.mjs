import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runDeleteFlowScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			deleteTargetMatchesSelectedRoom,
			nextSelectedSessionAfterDelete,
			planOptimisticRoomDelete,
			planOptimisticSessionDelete,
			responseDeletesSelectedSession,
		} = await import("./src/apps/chat-ui/src/app-delete-flow.ts");

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: "pibo-agent",
				title: "Session",
				status: "idle",
				derivedSessions: [],
				children: [],
				...overrides,
			};
		}

		function room(overrides = {}) {
			return {
				id: overrides.id ?? "room-root",
				name: "Room",
				type: "chat",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				metadata: {},
				children: [],
				...overrides,
			};
		}

		const child = sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child" });
		const root = sessionNode({ children: [child] });
		const sessionPlan = planOptimisticSessionDelete(root, "ps-child");
		assert.deepEqual([...sessionPlan.deletedSessionIds].sort(), ["ps-child", "ps-root"]);
		assert.equal(sessionPlan.selectedSessionDeleted, true);
		assert.equal(sessionPlan.restoreSelectedPiboSessionId, "ps-child");
		assert.equal(nextSelectedSessionAfterDelete("ps-child", true), undefined);
		assert.equal(nextSelectedSessionAfterDelete("ps-other", false), "ps-other");
		assert.equal(nextSelectedSessionAfterDelete(null, false), undefined);

		assert.equal(responseDeletesSelectedSession(["ps-root"], "ps-child", true), false);
		assert.equal(responseDeletesSelectedSession(["ps-child"], "ps-child", false), true);
		assert.equal(responseDeletesSelectedSession([], null, true), true);
		assert.equal(responseDeletesSelectedSession([], null, false), false);

		const nestedRoom = room({ id: "room-parent", children: [room({ id: "room-child" })] });
		const roomPlan = planOptimisticRoomDelete(nestedRoom, "room-child", "ps-open");
		assert.deepEqual([...roomPlan.deletedRoomIds].sort(), ["room-child", "room-parent"]);
		assert.equal(roomPlan.selectedRoomDeleted, true);
		assert.equal(roomPlan.restoreSelectedRoomId, "room-child");
		assert.equal(roomPlan.restoreSelectedPiboSessionId, "ps-open");
		assert.equal(deleteTargetMatchesSelectedRoom("room-parent", "room-parent"), true);
		assert.equal(deleteTargetMatchesSelectedRoom("room-parent", "room-child"), false);
		assert.equal(deleteTargetMatchesSelectedRoom("room-parent", null), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app delete flow helpers plan destructive session and room deletion", async () => {
	await assert.doesNotReject(runDeleteFlowScenario());
});
