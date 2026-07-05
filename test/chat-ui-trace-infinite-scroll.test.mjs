import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("trace views preload older pages near the top without a manual trace-history button", async () => {
	const stickyHookSource = await readFile("src/apps/chat-ui/src/components/useStickyVirtuoso.ts", "utf8");
	assert.match(stickyHookSource, /onNearTop\?: \(\) => void/);
	assert.match(stickyHookSource, /nearTopThreshold\?: number/);
	assert.match(stickyHookSource, /readingAwayFromBottom && scrollTop <= nearTopThreshold/);

	for (const [sourcePath, topThreshold, rowThreshold] of [
		["src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "4_800", "20"],
		["src/apps/chat-ui/src/tracing/TraceTimeline.tsx", "1_200", "8"],
	]) {
		const source = await readFile(sourcePath, "utf8");
		assert.match(source, new RegExp(`OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = ${topThreshold}`));
		assert.match(source, new RegExp(`OLDER_TRACE_PREFETCH_ROW_THRESHOLD = ${rowThreshold}`));
		assert.match(source, /nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX/);
		assert.match(source, /onNearTop: loadOlderAtTop/);
		assert.match(source, /rangeChanged=\{handleVisibleRangeChanged\}/);
		assert.match(source, /startReached=\{loadOlderAtTop\}/);
		assert.doesNotMatch(source, /Load older trace history/);
	}
});

test("trace v2 adapter maps cursor.before into the older-page sequence", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { traceViewFromTimelinePage } = await import("./src/apps/chat-ui/src/tracing/trace-v2-adapter.ts");
		const trace = traceViewFromTimelinePage({
			piboSessionId: "ps-test",
			piSessionId: "pi-test",
			title: "Test",
			version: "v1",
			latestStreamId: 42,
			projectionStatus: "ready",
			pageSize: 50,
			cursor: { before: "4640", after: "4689", hasOlder: true, hasNewer: false },
			nodes: [],
		});
		assert.equal(trace.hasOlderEvents, true);
		assert.equal(trace.nextBeforeSequence, 4640);
		assert.equal(trace.firstEventSequence, 4640);
		assert.equal(trace.lastEventSequence, 4689);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("trace v2 adapter preserves non-numeric transcript cursors", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { traceViewFromTimelinePage } = await import("./src/apps/chat-ui/src/tracing/trace-v2-adapter.ts");
		const trace = traceViewFromTimelinePage({
			piboSessionId: "ps-test",
			piSessionId: "pi-test",
			title: "Test",
			version: "v1",
			projectionStatus: "ready",
			pageSize: 50,
			cursor: { before: "transcript:12345:Y3V0b2Zm", hasOlder: true, hasNewer: false },
			nextBeforeCursor: "transcript:12000:Y3V0b2Zm",
			nodes: [],
		});
		assert.equal(trace.hasOlderEvents, true);
		assert.equal(trace.nextBeforeSequence, undefined);
		assert.equal(trace.nextBeforeCursor, "transcript:12000:Y3V0b2Zm");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
