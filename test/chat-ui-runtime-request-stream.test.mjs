import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("chat UI classifies runtime request frames for status and bootstrap refresh", async () => {
	const script = String.raw`
		import assert from "node:assert/strict";
		const {
			eventShouldRefreshNavigation,
			eventUpdatesLiveOverlay,
			liveSessionStatusFromEvent,
		} = await import("./src/apps/chat-ui/src/tracing/chat-stream-events.ts");
		const events = [
			{ type: "RUNTIME_APPROVAL_REQUESTED", runId: "message-1", request: { requestId: "approval", requestType: "command_execution" } },
			{ type: "RUNTIME_APPROVAL_RESOLVED", runId: "message-1", requestId: "approval", resolution: "responded" },
			{ type: "RUNTIME_USER_INPUT_REQUESTED", runId: "message-2", request: { requestId: "input", questions: [] } },
			{ type: "RUNTIME_USER_INPUT_RESOLVED", runId: "message-2", requestId: "input", resolution: "cleared" },
		];
		for (const event of events) assert.equal(eventShouldRefreshNavigation(event), true);
		assert.equal(liveSessionStatusFromEvent(events[0]), "running");
		assert.equal(liveSessionStatusFromEvent(events[2]), "running");
		assert.equal(liveSessionStatusFromEvent(events[1]), undefined);
		assert.equal(liveSessionStatusFromEvent(events[3]), undefined);
		assert.equal(events.every((event) => eventUpdatesLiveOverlay(event) === false), true);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
});
