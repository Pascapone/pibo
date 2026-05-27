import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runTracePageMergeScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { mergeOlderTracePage } = await import("./src/apps/chat-ui/src/tracing/trace-page-merge.ts");

		function node(id, title = id) {
			return {
				id,
				piboSessionId: "ps-test",
				type: "assistant.message",
				title,
				status: "done",
				children: [],
			};
		}

		function rawEvent(id, sequence, type = "assistant_delta", createdAt = "2026-05-27T10:00:00.000Z") {
			return {
				id,
				piboSessionId: "ps-test",
				eventSequence: sequence,
				type,
				createdAt,
				payload: { id, sequence },
			};
		}

		function trace(overrides) {
			return {
				piboSessionId: "ps-test",
				piSessionId: "pi-test",
				title: "Test session",
				version: "current-version",
				eventLimit: 2,
				nodes: [],
				rawEvents: [],
				...overrides,
			};
		}

		const current = trace({
			version: "current-version",
			eventLimit: 2,
			firstEventSequence: 30,
			nextBeforeSequence: 29,
			hasOlderEvents: true,
			nodes: [node("shared", "current shared"), node("current-only")],
			rawEvents: [rawEvent("raw-shared", 30), rawEvent("raw-current", 31)],
		});
		const older = trace({
			version: "older-version",
			eventLimit: 3,
			pageSize: 3,
			firstEventSequence: 10,
			nextBeforeSequence: 9,
			hasOlderEvents: false,
			nodes: [node("older-only"), node("shared", "older shared")],
			rawEvents: [rawEvent("raw-older", 10), rawEvent("raw-shared", 30)],
		});

		const merged = mergeOlderTracePage(current, older);
		assert.equal(merged.version, "current-version");
		assert.deepEqual(merged.nodes.map((entry) => entry.id), ["older-only", "shared", "current-only"]);
		assert.equal(merged.nodes.find((entry) => entry.id === "shared")?.title, "older shared");
		assert.deepEqual(merged.rawEvents.map((entry) => entry.id), ["raw-older", "raw-shared", "raw-current"]);
		assert.equal(merged.firstEventSequence, 10);
		assert.equal(merged.nextBeforeSequence, 9);
		assert.equal(merged.hasOlderEvents, false);
		assert.equal(merged.eventLimit, 5);

		const fallbackCurrent = trace({
			eventLimit: undefined,
			rawEvents: [rawEvent("", 42, "assistant_delta", "2026-05-27T10:01:00.000Z")],
		});
		const fallbackOlder = trace({
			eventLimit: undefined,
			pageSize: 25,
			rawEvents: [rawEvent("", 42, "assistant_delta", "2026-05-27T10:01:00.000Z")],
		});
		const fallbackMerged = mergeOlderTracePage(fallbackCurrent, fallbackOlder);
		assert.equal(fallbackMerged.rawEvents.length, 1);
		assert.equal(fallbackMerged.eventLimit, 25);

		const otherSession = trace({ piboSessionId: "ps-other" });
		assert.equal(mergeOlderTracePage(current, otherSession), current);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("older trace page merge preserves order, dedupes, and carries pagination metadata", async () => {
	await assert.doesNotReject(runTracePageMergeScenario());
});
