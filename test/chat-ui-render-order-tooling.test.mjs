import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("trace render-order tooling records base, overlay, current, and terminal state", async () => {
	const [collector, currentTrace, terminal, timeline] = await Promise.all([
		source("src/apps/chat-ui/src/tracing/snapshotCollector.ts"),
		source("src/apps/chat-ui/src/tracing/use-current-session-trace.ts"),
		source("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"),
		source("src/apps/chat-ui/src/tracing/TraceTimeline.tsx"),
	]);
	for (const layer of ["baseNodes", "overlayEvents", "currentNodes", "terminalRows"]) {
		assert.match(collector, new RegExp(`\\"${layer}\\"`));
	}
	assert.match(collector, /contentKind: traceNodeContentKind\(content\)/);
	assert.doesNotMatch(collector, /contentDigest|contentToken|contentTokensBySession/);
	assert.match(collector, /getLatestSequence: getLatestSnapshotSequence/);
	assert.match(collector, /clearTimeout\(buffer\.pendingTimer\)/);
	assert.match(currentTrace, /collectTraceState\(\{/);
	assert.match(terminal, /useLayoutEffect\(\(\) => \{/);
	assert.match(terminal, /collectTerminalRows\(piboSessionId, "compact-terminal:render", rows/);
	assert.match(timeline, /useLayoutEffect\(\(\) => \{/);
	assert.match(timeline, /collectVisibleRows\(/);
});

test("diagnosis report omits content-derived fingerprints", async () => {
	const report = await source("docs/reports/chat-web-live-render-order-diagnosis-2026-08-09.md");
	assert.doesNotMatch(report, /content digest|contentDigest|dw4mqd/);
});

test("trace cards expose stable ids and order metadata to CDP", async () => {
	const spans = await source("src/apps/chat-ui/src/tracing/SpanNode.tsx");
	assert.match(spans, /data-pibo-debug="trace-span"/);
	assert.match(spans, /data-trace-node-id=\{span\.id\}/);
	assert.match(spans, /data-order-source=\{span\.pibo\?\.source\}/);
	assert.match(spans, /data-stable-key=\{span\.pibo\?\.stableKey\}/);
});
