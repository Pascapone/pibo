import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTranscriptHistoryPage } from "../dist/apps/chat/trace.js";

test("readTranscriptHistoryPage pages backward before a compaction cutoff", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-transcript-history-"));
	const path = join(dir, "session.jsonl");
	try {
		await writeFile(path, [
			entry("a", "2026-07-03T10:00:00.000Z", "before a"),
			entry("b", "2026-07-03T11:00:00.000Z", "before b"),
			entry("c", "2026-07-03T12:00:00.000Z", "before c"),
			entry("d", "2026-07-04T10:00:00.000Z", "after d"),
			entry("e", "2026-07-04T11:00:00.000Z", "after e"),
			"",
		].join("\n"), "utf8");

		const first = readTranscriptHistoryPage(path, {
			beforeTimestamp: "2026-07-04T00:00:00.000Z",
			limit: 2,
			pageBytes: 128,
			maxScanBytes: 4096,
		});

		assert.deepEqual(first.entries.map((item) => item.id), ["b", "c"]);
		assert.equal(first.hasOlder, true);
		assert.equal(typeof first.nextBeforeByte, "number");

		const second = readTranscriptHistoryPage(path, {
			beforeByte: first.nextBeforeByte,
			beforeTimestamp: "2026-07-04T00:00:00.000Z",
			limit: 2,
			pageBytes: 128,
			maxScanBytes: 4096,
		});

		assert.deepEqual(second.entries.map((item) => item.id), ["a"]);
		assert.equal(second.hasOlder, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

function entry(id, timestamp, content) {
	return JSON.stringify({
		type: "message",
		id,
		timestamp,
		message: {
			role: "user",
			content,
		},
	});
}
