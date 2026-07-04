import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("trace views preload older pages near the top without a manual trace-history button", async () => {
	const stickyHookSource = await readFile("src/apps/chat-ui/src/components/useStickyVirtuoso.ts", "utf8");
	assert.match(stickyHookSource, /onNearTop\?: \(\) => void/);
	assert.match(stickyHookSource, /nearTopThreshold\?: number/);
	assert.match(stickyHookSource, /readingAwayFromBottom && scrollTop <= nearTopThreshold/);

	for (const sourcePath of [
		"src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx",
		"src/apps/chat-ui/src/tracing/TraceTimeline.tsx",
	]) {
		const source = await readFile(sourcePath, "utf8");
		assert.match(source, /OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = 1_200/);
		assert.match(source, /nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX/);
		assert.match(source, /onNearTop: loadOlderAtTop/);
		assert.match(source, /startReached=\{loadOlderAtTop\}/);
		assert.doesNotMatch(source, /Load older trace history/);
	}
});
