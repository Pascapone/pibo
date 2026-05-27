import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runChatTraceHelpersScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			annotateTracePage,
			etagForVersion,
			liveSnapshotVersion,
			requestMatchesVersion,
			setTraceCache,
			storedLiveSnapshotEvents,
			traceCacheKey,
			withRawTraceTail,
		} = await import("./src/apps/chat/chat-trace-helpers.ts");

		const trace = { piboSessionId: "ps_1", piSessionId: "pi_1", title: "Trace", version: "v1", nodes: [], rawEvents: [] };
		const events = [
			{ id: "e3", piboSessionId: "ps_1", eventSequence: 3, type: "assistant_delta", createdAt: "2026-05-27T00:00:03.000Z", payload: { type: "assistant_delta", text: "hi" } },
			{ id: "e5", piboSessionId: "ps_1", eventSequence: 5, type: "assistant_message", createdAt: "2026-05-27T00:00:05.000Z", payload: { type: "assistant_message", text: "hi" } },
		];

		assert.equal(etagForVersion("abc"), '"abc"');
		assert.equal(requestMatchesVersion(new Request("http://example.test", { headers: { "if-none-match": 'W/"abc", "def"' } }), "abc"), true);
		assert.equal(requestMatchesVersion(new Request("http://example.test", { headers: { "if-none-match": '"def"' } }), "abc"), false);
		assert.equal(traceCacheKey("ps_1", "v1"), "ps_1:v1:structural");

		const annotated = annotateTracePage(trace, events, { lastEventSequence: 7, pageSize: 2, beforeSequence: 8 });
		assert.equal(annotated.eventCount, 7);
		assert.equal(annotated.eventLimit, 2);
		assert.equal(annotated.firstEventSequence, 3);
		assert.equal(annotated.lastEventSequence, 5);
		assert.equal(annotated.nextBeforeSequence, 3);
		assert.equal(annotated.hasOlderEvents, true);

		assert.equal(withRawTraceTail(trace, []), trace);
		assert.deepEqual(withRawTraceTail(trace, events).rawEvents, events);

		const snapshot = { type: "assistant_delta", eventId: "evt_1", text: "live" };
		assert.equal(liveSnapshotVersion([]), "");
		assert.equal(liveSnapshotVersion([snapshot]), liveSnapshotVersion([snapshot]));
		const stored = storedLiveSnapshotEvents({ piboSessionId: "ps_1", snapshots: [snapshot], lastEventSequence: 7, now: "2026-05-27T00:00:00.000Z" });
		assert.equal(stored[0].eventSequence, 8);
		assert.equal(stored[0].eventId, "evt_1");
		assert.equal(stored[0].type, "assistant_delta");
		assert.equal(stored[0].createdAt, "2026-05-27T00:00:00.000Z");

		const cache = new Map();
		setTraceCache(cache, "a", trace, 2);
		setTraceCache(cache, "b", { ...trace, version: "v2" }, 2);
		setTraceCache(cache, "c", { ...trace, version: "v3" }, 2);
		assert.deepEqual([...cache.keys()], ["b", "c"]);
		setTraceCache(cache, "raw", { ...trace, rawEvents: events }, 2);
		assert.equal(cache.has("raw"), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat trace helpers preserve cache, ETag, and page metadata behavior", async () => {
	await assert.doesNotReject(runChatTraceHelpersScenario());
});
