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
		if (sourcePath.includes("CompactTerminalSessionView")) {
			assert.match(source, /COMPACT_TOOL_MODE_PREFETCH_TOP_THRESHOLD_PX = 800/);
			assert.match(source, /toolDisplayMode === "default"\s*\? OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX\s*:\s*COMPACT_TOOL_MODE_PREFETCH_TOP_THRESHOLD_PX/);
			assert.match(source, /nearTopThreshold: olderTracePrefetchTopThreshold/);
			assert.match(source, /if \(!rangePrefetchReadyRef\.current \|\| toolDisplayMode !== "default"\) return;/);
		} else {
			assert.match(source, /nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX/);
		}
		assert.match(source, /onAtTop: loadOlderAtTop/);
		assert.match(source, /onNearTop: loadOlderNearTop/);
		assert.match(source, /scrollbarDragActiveRef\.current = active/);
		assert.match(source, /scrollbarDragDeferredLoadRef\.current = true/);
		assert.match(source, /onScrollbarDragChange: handleScrollbarDragChange/);
		assert.match(source, /olderTraceRequestPendingRef\.current = true/);
		assert.match(source, /prepareOlderTracePrependRef\.current\(\)/);
		assert.match(source, /Promise\.resolve\(request\)\.then/);
		assert.match(source, /isPrepending: isFetchingOlderTracePage/);
		assert.match(source, /const loadOlderAtTop = useCallback[\s\S]*?if \(!olderTraceIntentRef\.current && !scrollbarDragActiveRef\.current\) return;/, "the exact edge consumes one explicit older-history intent or defers an active scrollbar drag");
		assert.doesNotMatch(source, /OLDER_TRACE_INTENT_SETTLE_MS|olderTraceLoadTimerRef/, "wheel, keyboard, and touch prefetches are not delayed behind a settle timer");
		if (sourcePath.includes("CompactTerminalSessionView")) {
			assert.match(source, /window\.addEventListener\("beforeunload", persistBeforePageExit\)/);
			assert.match(source, /window\.addEventListener\("pagehide", persistBeforePageExit\)/);
			assert.match(source, /document\.addEventListener\("visibilitychange", persistWhenHidden\)/);
			assert.doesNotMatch(source, /range\.startIndex <= 0\) loadOlderAtTop/);
			assert.doesNotMatch(source, /atTopStateChange=/);
			assert.doesNotMatch(source, /startReached=/);
			assert.doesNotMatch(source, /if \(stickyView\.isScrolledToTop\(\)\) loadOlderAtTop/);
		} else {
			assert.match(source, /if \(!stickyView\.isAtTop && !stickyView\.isScrolledToTop\(\)\) return/);
			assert.match(source, /range\.startIndex <= 0\) loadOlderAtTop/);
			assert.match(source, /startReached=\{loadOlderAtTop\}/);
			assert.doesNotMatch(source, /if \(stickyView\.isAtTop \|\| stickyView\.isScrolledToTop\(\)\) loadOlderAtTop/);
		}
		assert.match(source, /firstItemIndex=\{stickyView\.firstItemIndex\}/);
		assert.match(source, /itemsRendered=\{stickyView\.itemsRendered\}/);
		assert.match(source, /data-row-id=\{row\.id\}/, "each virtualized row exposes its stable conceptual anchor to DOM restoration");
		assert.match(source, /rangeChanged=\{\(range\) => handleVisibleRangeChanged\(stickyView\.normalizeRange\(range\)\)\}/);
		assert.doesNotMatch(source, /Load older trace history/);
	}
});

test("trace history pages use a latency-efficient bounded event count", async () => {
	const source = await readFile("src/apps/chat-ui/src/cache.ts", "utf8");
	assert.match(source, /DEFAULT_TRACE_EVENTS_PAGE_SIZE = 100/);
});

test("trace v2 adapter maps cursor.before and preserves integrity status", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { traceViewFromTimelinePage } = await import("./src/apps/chat-ui/src/tracing/trace-v2-adapter.ts");
		const trace = traceViewFromTimelinePage({
			piboSessionId: "ps-test",
			piSessionId: "pi-test",
			integrityStatus: "incomplete",
			title: "Test",
			version: "v1",
			latestStreamId: 42,
			projectionStatus: "ready",
			pageSize: 50,
			cursor: { before: "4640", after: "4689", hasOlder: true, hasNewer: false },
			nodes: [],
		});
		assert.equal(trace.hasOlderEvents, true);
		assert.equal(trace.integrityStatus, "incomplete");
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
