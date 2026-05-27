import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runLiveOverlayScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { trimLiveOverlayForBaseTrace } = await import("./src/apps/chat-ui/src/tracing/live-overlay.ts");

		const traceNode = (id, type, extra = {}) => ({
			id,
			piboSessionId: "ps-test",
			parentId: undefined,
			type,
			title: type,
			status: "done",
			output: "",
			children: [],
			...extra,
		});
		const event = (id, type, extra = {}) => ({
			id,
			piboSessionId: "ps-test",
			createdAt: "2026-05-27T10:00:00.000Z",
			eventSequence: Number(id.replace(/\\D/g, "")) || 0,
			type,
			payload: {},
			...extra,
		});

		const baseTrace = {
			piboSessionId: "ps-test",
			latestStreamId: 10,
			rawEvents: [event("base-raw", "assistant_delta", { payload: { eventId: "raw-confirmed", piboSessionId: "ps-test" } })],
			nodes: [
				traceNode("transcript-user", "user.message", { source: "transcript", entryId: "entry-confirmed", output: "already sent" }),
				traceNode("event:message_queued:node-confirmed", "user.message"),
				traceNode("assistant", "assistant.message", { eventId: "assistant-confirmed" }),
				traceNode("reasoning", "model.reasoning", { eventId: "reasoning-confirmed" }),
				traceNode("parent", "section", { children: [traceNode("nested-user", "user.message", { source: "transcript", output: { text: "nested sent" } })] }),
			],
		};

		const keep = event("keep", "assistant_delta", { streamId: 11, payload: { eventId: "new-live", piboSessionId: "ps-test" } });
		const overlay = {
			piboSessionId: "ps-test",
			events: [
				keep,
				event("old-stream", "assistant_delta", { streamId: 10, payload: { eventId: "old-live", piboSessionId: "ps-test" } }),
				event("raw-confirmed", "assistant_delta", { streamId: 11, payload: { eventId: "raw-confirmed", piboSessionId: "ps-test" } }),
				event("assistant-confirmed", "assistant_message", { streamId: 11, payload: { eventId: "assistant-confirmed", piboSessionId: "ps-test" } }),
				event("reasoning-confirmed", "thinking_finished", { streamId: 11, payload: { eventId: "reasoning-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-id", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "different", eventId: "entry-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-node-id", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "other", eventId: "node-confirmed", piboSessionId: "ps-test" } }),
				event("queued-by-text", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "already sent" } }),
				event("nested-queued-by-text", "message_queued", { streamId: 11, payload: { type: "message_queued", source: "user", text: "nested sent" } }),
			],
		};

		const trimmed = trimLiveOverlayForBaseTrace(overlay, baseTrace);
		assert.deepEqual(trimmed?.events.map((item) => item.id), ["keep"]);
		assert.notEqual(trimmed, overlay);
		assert.equal(trimmed.events[0], keep);

		const mismatched = { piboSessionId: "other-session", events: overlay.events };
		assert.equal(trimLiveOverlayForBaseTrace(mismatched, baseTrace), mismatched);
		assert.equal(trimLiveOverlayForBaseTrace({ piboSessionId: "ps-test", events: overlay.events.slice(1) }, baseTrace), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("live overlay trimming removes events already confirmed by the base trace", async () => {
	await assert.doesNotReject(runLiveOverlayScenario());
});
