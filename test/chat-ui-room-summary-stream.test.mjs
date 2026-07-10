import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runRoomSummaryStreamScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { roomSummaryStreamUrl } = await import("./src/apps/chat-ui/src/room-summary-stream.ts");

		assert.equal(roomSummaryStreamUrl({ area: "settings", activeRoomId: "room-new", bootstrapSelectedRoomId: "room-new", latestRoomStreamId: 42 }), null);
		assert.equal(roomSummaryStreamUrl({ area: "sessions", activeRoomId: null, bootstrapSelectedRoomId: "room-new", latestRoomStreamId: 42 }), null);
		assert.equal(roomSummaryStreamUrl({ area: "sessions", activeRoomId: "room-new", bootstrapSelectedRoomId: "room-old", latestRoomStreamId: 42 }), null);
		assert.equal(roomSummaryStreamUrl({ area: "sessions", activeRoomId: "room-new", bootstrapSelectedRoomId: "room-new", latestRoomStreamId: undefined }), null);
		assert.equal(roomSummaryStreamUrl({ area: "sessions", activeRoomId: "room-new", bootstrapSelectedRoomId: "room-new", latestRoomStreamId: 0 }), null, "normal room navigation must not subscribe from the start of history");

		const url = roomSummaryStreamUrl({ area: "sessions", activeRoomId: "room-new", bootstrapSelectedRoomId: "room-new", latestRoomStreamId: 42 });
		assert.equal(url, "/api/chat/events?roomId=room-new&mode=summary&since=42%3A999999");
		assert.ok(!url.includes("since=0%3A999999"));
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("room summary stream waits for the selected room's latest stream id", async () => {
	await assert.doesNotReject(runRoomSummaryStreamScenario());
});
