import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("trace views preload older pages near the top without a manual trace-history button", async () => {
	const stickyHookSource = await readFile("src/apps/chat-ui/src/components/useStickyVirtuoso.ts", "utf8");
	assert.match(stickyHookSource, /onAtTop\?: \(\) => void/);
	assert.match(stickyHookSource, /onNearTop\?: \(\) => void/);
	assert.match(stickyHookSource, /const \[isAtTop, setIsAtTopState\] = useState\(false\)/);
	assert.match(stickyHookSource, /updateAtTopFromScrollTop\(getScrollTop\(scroller\)\)/);
	assert.match(stickyHookSource, /const isScrolledToTop = useCallback/);
	assert.match(stickyHookSource, /scrollTop <= atTopThreshold/);
	assert.match(stickyHookSource, /nearTopThreshold\?: number/);
	assert.match(stickyHookSource, /readingAwayFromBottom && scrollTop <= nearTopThreshold/);
	const tracePageHookSource = await readFile("src/apps/chat-ui/src/tracing/use-session-trace-page.ts", "utf8");
	assert.doesNotMatch(tracePageHookSource, /OLDER_TRACE_LOAD_MIN_INTERVAL_MS/);
	assert.match(tracePageHookSource, /if \(loadingOlderTraceBeforeRef\.current\) return/);
	assert.match(tracePageHookSource, /loadedOlderTraceBeforeRef\.current\.has\(loadKey\)/);

	for (const [sourcePath, topThreshold, rowThreshold] of [
		["src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "4_800", "20"],
		["src/apps/chat-ui/src/tracing/TraceTimeline.tsx", "1_200", "8"],
	]) {
		const source = await readFile(sourcePath, "utf8");
		assert.match(source, new RegExp(`OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = ${topThreshold}`));
		assert.match(source, new RegExp(`OLDER_TRACE_PREFETCH_ROW_THRESHOLD = ${rowThreshold}`));
		assert.match(source, /nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX/);
		assert.match(source, /onAtTop: loadOlderAtTop/);
		assert.match(source, /onNearTop: loadOlderNearTop/);
		assert.match(source, /scrollbarDragActiveRef\.current = active/);
		assert.match(source, /scrollbarDragDeferredLoadRef\.current = true/);
		assert.match(source, /onScrollbarDragChange: handleScrollbarDragChange/);
		if (sourcePath.includes("CompactTerminalSessionView")) {
			assert.match(source, /if \(!stickyView\.isScrolledToTop\(\)\) return/);
			assert.match(source, /olderTraceRequestPendingRef\.current = true/);
			assert.match(source, /OLDER_TRACE_INTENT_SETTLE_MS = 700/);
			assert.match(source, /loadOlderTracePage\(true\)/, "near-top prefetch still settles active scroll intent");
			assert.match(source, /loadOlderTracePage\(false\)/, "the exact history edge loads immediately");
			assert.match(source, /clearTimeout\(olderTraceLoadTimerRef\.current\)/, "reaching the edge cancels a pending settle timer");
		} else {
			assert.match(source, /if \(!stickyView\.isAtTop && !stickyView\.isScrolledToTop\(\)\) return/);
		}
		assert.match(source, /range\.startIndex <= 0\) loadOlderAtTop/);
		assert.match(source, /firstItemIndex=\{stickyView\.firstItemIndex\}/);
		assert.match(source, /itemsRendered=\{stickyView\.itemsRendered\}/);
		assert.match(source, /rangeChanged=\{\(range\) => handleVisibleRangeChanged\(stickyView\.normalizeRange\(range\)\)\}/);
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

test("trace v2 adapter does not synthesize older cursors for exhausted pages", async () => {
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
			cursor: { before: "1", after: "39", hasOlder: false, hasNewer: false },
			nextBeforeSequence: 1,
			hasOlderEvents: false,
			nodes: [],
		});
		assert.equal(trace.hasOlderEvents, false);
		assert.equal(trace.nextBeforeSequence, undefined);
		assert.equal(trace.nextBeforeCursor, undefined);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
