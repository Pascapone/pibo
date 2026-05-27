import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runRawEventCompactionScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { compactRawEvents } = await import("./src/apps/chat-ui/src/tracing/raw-events.ts");
		const event = (id, type, payload, createdAt = id) => ({
			id,
			piboSessionId: "ps-test",
			createdAt,
			eventSequence: Number(id.replace(/\\D/g, "")) || 0,
			type,
			payload,
		});
		const compacted = compactRawEvents([
			event("event-1", "assistant_delta", { eventId: "turn-1", text: "Hel" }, "2026-05-27T10:00:00.000Z"),
			event("event-2", "assistant_delta", { eventId: "turn-1", text: "lo" }, "2026-05-27T10:00:01.000Z"),
			event("event-3", "assistant_delta", { eventId: "turn-2", text: "separate" }),
			event("event-4", "TEXT_MESSAGE_CONTENT", { messageId: "msg-1", delta: "wor" }),
			event("event-5", "TEXT_MESSAGE_CONTENT", { messageId: "msg-1", delta: "ld" }),
			event("event-6", "tool_call", { eventId: "turn-1", text: "not merged" }),
		]);
		assert.equal(compacted.length, 4);
		assert.equal(compacted[0].id, "event-1");
		assert.equal(compacted[0].count, 2);
		assert.equal(compacted[0].createdAt, "2026-05-27T10:00:01.000Z");
		assert.deepEqual(compacted[0].payload, { eventId: "turn-1", text: "Hello" });
		assert.equal(compacted[1].count, 1);
		assert.equal(compacted[2].count, 2);
		assert.deepEqual(compacted[2].payload, { messageId: "msg-1", delta: "wor", text: "world" });
		assert.equal(compacted[3].count, 1);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("raw event compaction merges only adjacent stream deltas with the same event key", async () => {
	await assert.doesNotReject(runRawEventCompactionScenario());
});
