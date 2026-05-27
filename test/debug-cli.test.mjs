import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { sliceTextByBytes } from "../dist/debug/detail-format.js";
import { attachStreamingProviderTelemetryToBenchmark, collectStreamingProviderTelemetryFromSelectedBrowserSession, collectStreamingProviderTelemetryFromSession, collectStreamingProviderTelemetryFromTurn, evaluateStreamingBenchmarkAssertion, evaluateStreamingBenchmarkUrlComparisonRegressions, evaluateStreamingLivePipelineRegressions, evaluateStreamingProviderRegressions, formatStreamingBenchmarkAssertionSummary, formatStreamingBenchmarkUrlComparison, formatWatch, inferWatchFlickers, resolveStreamingBenchmarkHostedCompareUrlFromValues, summarizeStreamingBenchmarkUrlComparison, summarizeStreamingBenchmarks, summarizeStreamingLivePipeline, summarizeStreamingProviderPreservation, summarizeStreamingProviderTelemetry, summarizeStreamingSelectedLiveEventSource } from "../dist/debug/web.js";

const execFileAsyncRaw = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function execFileAsync(file, args, options = {}) {
	const piboHome = options.cwd ? join(options.cwd, ".pibo") : undefined;
	return execFileAsyncRaw(file, args, {
		...options,
		env: {
			...process.env,
			...options.env,
			...(piboHome ? { PIBO_HOME: piboHome } : {}),
		},
	});
}

test("debug byte slicing preserves UTF-8 characters", () => {
	const text = "Hamburg Grüße Straße";
	const first = sliceTextByBytes(text, { maxBytes: 12 });
	assert.equal(first.text, "Hamburg Grü");
	assert.equal(first.truncatedAfter, true);
	const second = sliceTextByBytes(text, { from: first.from + first.bytesShown, bytes: 5 });
	assert.doesNotMatch(second.text, /�/);
	assert.equal(`${first.text}${second.text}`, "Hamburg Grüße S");
});

test("pibo debug web watch rejects action flags", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "watch", "--preset", "app", "--act"]),
		(error) => {
			assert.match(error.stderr, /Action flags are only supported by scenarios/);
			assert.match(error.stderr, /pibo debug web scenario new-session --act/);
			return true;
		},
	);
});

test("pibo debug web report renders saved streaming benchmark artifacts without CDP", async () => {
	const help = await execFileAsync("node", [cliPath, "debug", "web", "report", "--help"]);
	assert.match(help.stdout, /--json-output\s+Write the normalized JSON report payload and compact rows/);
	const cwd = await makeEmptyCwd();
	try {
		const artifact = join(cwd, "streaming-benchmark.json");
		await writeFile(artifact, JSON.stringify({
			kind: "streaming-benchmark",
			createdAt: "2026-05-23T00:00:00.000Z",
			url: "http://example.test/apps/chat/rooms/room_test/sessions/ps_test",
			title: "Chat",
			durationMs: 1800,
			debug: {
				enabledRequested: true,
				available: true,
				reset: true,
				delta: { textDeltaCount: 12, textDeltaBytes: 24, reasoningDeltaCount: 4, enqueueCount: 22, flushCount: 20, overlayUpdateCount: 20, markdownRenderCount: 12, markdownRenderPlainCount: 12, markdownRenderCommonMarkCount: 0, markdownRenderGfmCount: 0, markdownRenderGfmFastCount: 0, markdownRenderFullCount: 0, markdownRenderDurationMsTotal: 1.5 },
				after: { overlayEventCount: 16, currentOutputLength: 24, traceBaseOutputLength: 0, markdownRenderDurationMsMax: 0.25 },
			},
			dom: {
				selector: "[data-pibo-component=MarkdownRendererHost]",
				targetCountStart: 1,
				targetCountEnd: 1,
				lengthStart: 0,
				lengthEnd: 24,
				lengthMax: 24,
				updateCount: 12,
				positiveUpdateCount: 12,
				firstPositiveUpdateMs: 145,
				gapsMs: { count: 11, p50: 100, p90: 101, p99: 103, max: 103, avg: 100.4 },
				positiveCharJumps: { count: 12, p50: 2, p90: 2, p99: 2, max: 2, avg: 2 },
			},
			raf: { count: 100, gapsMs: { count: 99, p50: 16.7, p90: 16.8, p99: 17, max: 17, avg: 16.7 } },
			longTasks: { count: 0, totalMs: 0, maxMs: 0 },
			eventSource: { streams: [{ role: "selected-live", eventCount: 26, eventCountAfterStart: 26, textEventCount: 12, textEventCountAfterStart: 12, reasoningEventCount: 4, reasoningEventCountAfterStart: 4, transientIdCount: 24, uniqueTransientIdCount: 17, transientIdCountAfterStart: 24, uniqueTransientIdCountAfterStart: 17, durableIdCount: 0, otherIdCount: 0, liveReplayEventCount: 24, liveReplayEventCountAfterStart: 24, sinceValues: [], liveSinceValues: ["153"], openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 1, forcedCloseCountAfterStart: 1, firstTextEventMsAfterStart: 184 }] },
			score: { smoothness: 58, textDeltaCount: 12, domPositiveUpdateCount: 12 },
			regressions: [],
			warnings: [],
		}, null, 2));
		const report = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact], { cwd });
		assert.match(report.stdout, /# Web Streaming Benchmark, 1\.8s/);
		assert.match(report.stdout, /# target: artifact http:\/\/example\.test\/apps\/chat/);
		assert.match(report.stdout, /events: text=12 \(24 bytes\), reasoning=4/);
		assert.match(report.stdout, /dom gaps: count=11, p50=100, p90=101/);
		const compactReport = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact"], { cwd });
		assert.match(compactReport.stdout, /# Web Streaming Benchmark Compact Report/);
		assert.match(compactReport.stdout, /\| Layer \| Preservation \| Cadence \/ latency \|/);
		assert.match(compactReport.stdout, /\| SSE transport \| n\/a \| n\/a \|/);
		assert.match(compactReport.stdout, /\| EventSource selected-live \| text 12, reasoning 4, events 26 \| first text 184ms, transient 17\/24, replay 24, liveSince 1 \|/);
		assert.match(compactReport.stdout, /\| Markdown render \| count 12, plain 12, commonmark 0, gfm 0, gfmFast 0, full 0 \| total 1\.5ms, max 0\.25ms \|/);
		assert.match(compactReport.stdout, /\| DOM \| positive 12, max jump 2 chars \| p90 gap 101ms, first visible 145ms \|/);
		const output = join(cwd, "reports", "streaming-compact.md");
		const outputReport = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact", "--output", output], { cwd });
		assert.match(outputReport.stdout, /Wrote report: .*streaming-compact\.md/);
		const writtenReport = await readFile(output, "utf-8");
		assert.match(writtenReport, /# Web Streaming Benchmark Compact Report/);
		assert.match(writtenReport, /\| DOM \| positive 12, max jump 2 chars \| p90 gap 101ms, first visible 145ms \|/);
		const jsonOutput = join(cwd, "reports", "streaming-compact.json");
		const jsonOutputReport = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact", "--json-output", jsonOutput], { cwd });
		assert.match(jsonOutputReport.stdout, /Wrote report JSON: .*streaming-compact\.json/);
		const writtenJson = JSON.parse(await readFile(jsonOutput, "utf-8"));
		assert.equal(writtenJson.format, "compact");
		assert.equal(writtenJson.benchmark.kind, "streaming-benchmark");
		assert.match(writtenJson.markdown, /# Web Streaming Benchmark Compact Report/);
		assert.deepEqual(writtenJson.rows.find((row) => row.metric === "Markdown render"), {
			section: "compact",
			metric: "Markdown render",
			preservation: "count 12, plain 12, commonmark 0, gfm 0, gfmFast 0, full 0",
			cadenceLatency: "total 1.5ms, max 0.25ms",
		});
		assert.deepEqual(writtenJson.rows.find((row) => row.metric === "DOM"), {
			section: "compact",
			metric: "DOM",
			preservation: "positive 12, max jump 2 chars",
			cadenceLatency: "p90 gap 101ms, first visible 145ms",
		});
		const stdoutJsonReport = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact", "--json"], { cwd });
		const stdoutJson = JSON.parse(stdoutJsonReport.stdout);
		assert.equal(stdoutJson.benchmark.kind, "streaming-benchmark");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug web report emits compact URL comparison JSON rows", async () => {
	const cwd = await makeEmptyCwd();
	try {
		const makeRun = (url, firstOffset = 0) => ({
			kind: "streaming-benchmark",
			createdAt: "2026-05-23T00:00:00.000Z",
			url,
			title: "Chat",
			durationMs: 1800,
			debug: {
				enabledRequested: true,
				available: true,
				reset: true,
				delta: { textDeltaCount: 12, textDeltaBytes: 24, reasoningDeltaCount: 4, enqueueCount: 22, flushCount: 20, flushedEventCount: 22, overlayUpdateCount: 20 },
				after: { overlayEventCount: 16, currentOutputLength: 24, traceBaseOutputLength: 0 },
			},
			fixture: { requested: true, mode: "backend", profile: "steady", mix: "reasoning-text", available: true, started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24, scheduleGapsMs: { count: 11, p90: 100 } },
			dom: {
				selector: "[data-pibo-component=MarkdownRendererHost]",
				targetCountStart: 1,
				targetCountEnd: 1,
				lengthStart: 0,
				lengthEnd: 24,
				lengthMax: 24,
				updateCount: 12,
				positiveUpdateCount: 12,
				firstPositiveUpdateMs: 145 + firstOffset,
				gapsMs: { count: 11, p50: 100, p90: 101, p99: 103, max: 103, avg: 100.4 },
				positiveCharJumps: { count: 12, p50: 2, p90: 2, p99: 2, max: 2, avg: 2 },
			},
			raf: { count: 100, gapsMs: { count: 99, p90: 16.8 } },
			longTasks: { count: 0, totalMs: 0, maxMs: 0 },
			eventSource: { streams: [{ role: "selected-live", eventCountAfterStart: 22, textEventCountAfterStart: 12, reasoningEventCountAfterStart: 4, transientIdCountAfterStart: 22, firstTextEventMsAfterStart: 121 + firstOffset }] },
			sse: { textEventCount: 12, reasoningEventCount: 4, firstTextEventMs: 119 + firstOffset, chunkBytes: { count: 1, p50: 280 }, chunkGapsMs: { count: 1, p90: 100 }, textEventsPerChunk: { count: 1, p90: 1 }, textEventGapsMs: { count: 11, p90: 100 } },
			livePipeline: { expectedInputEventCount: 16, flushedEventsToExpectedRatio: 1.375, overlayEventsToExpectedRatio: 1, currentOutputToExpectedTextBytesRatio: 1, flushToEnqueueRatio: 0.909, overlayUpdatesToFlushedEventsRatio: 0.909, firstTextDeltaMs: 120 + firstOffset, firstEnqueueMs: 40 + firstOffset, firstFlushMs: 42 + firstOffset, firstOverlayUpdateMs: 44 + firstOffset },
			score: { smoothness: 58, textDeltaCount: 12, domPositiveUpdateCount: 12 },
			regressions: [],
			warnings: [],
		});
		const primaryRun = makeRun("http://direct.example/apps/chat/rooms/room/sessions/ps");
		const compareRun = makeRun("https://hosted.example/apps/chat/rooms/room/sessions/ps", 5);
		const artifact = join(cwd, "streaming-url-comparison.json");
		await writeFile(artifact, JSON.stringify({
			kind: "streaming-benchmark-url-comparison",
			createdAt: "2026-05-23T00:00:00.000Z",
			primaryUrl: primaryRun.url,
			compareUrl: compareRun.url,
			primary: { kind: "streaming-benchmark-runs", createdAt: "2026-05-23T00:00:00.000Z", durationMs: 1800, runs: [primaryRun], summary: {}, regressions: [], warnings: [] },
			compare: { kind: "streaming-benchmark-runs", createdAt: "2026-05-23T00:00:00.000Z", durationMs: 1800, runs: [compareRun], summary: {}, regressions: [], warnings: [] },
			comparison: {},
			regressions: [],
			warnings: [],
		}, null, 2));
		const jsonOutput = join(cwd, "reports", "streaming-url-compact.json");
		await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact", "--json-output", jsonOutput], { cwd });
		const writtenJson = JSON.parse(await readFile(jsonOutput, "utf-8"));
		assert.equal(writtenJson.benchmark.kind, "streaming-benchmark-url-comparison");
		assert.deepEqual(writtenJson.rows.find((row) => row.metric === "First SSE text"), {
			section: "compact-url-comparison",
			metric: "First SSE text",
			primaryP50: "119ms",
			compareP50: "124ms",
			delta: "+5ms",
		});
		assert.deepEqual(writtenJson.rows.find((row) => row.metric === "First live flush"), {
			section: "compact-url-comparison",
			metric: "First live flush",
			primaryP50: "42ms",
			compareP50: "47ms",
			delta: "+5ms",
		});
		assert.match(writtenJson.markdown, /\| First live overlay \| 44ms \| 49ms \| \+5ms \|/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug web report recomputes streaming summaries for older artifacts", async () => {
	const cwd = await makeEmptyCwd();
	try {
		const artifact = join(cwd, "legacy-streaming-runs.json");
		const run = {
			kind: "streaming-benchmark",
			createdAt: "2026-05-23T00:00:00.000Z",
			url: "http://example.test/apps/chat/rooms/room_test/sessions/ps_test?debugStreaming=1",
			title: "Chat",
			durationMs: 1800,
			debug: {
				enabledRequested: true,
				available: true,
				reset: true,
				delta: { textDeltaCount: 12, textDeltaBytes: 24, reasoningDeltaCount: 4, enqueueCount: 22, flushCount: 20, flushedEventCount: 22, overlayUpdateCount: 20 },
				after: { overlayEventCount: 16, currentOutputLength: 24, traceBaseOutputLength: 0 },
			},
			dom: {
				selector: "[data-pibo-component=MarkdownRendererHost]",
				targetCountStart: 1,
				targetCountEnd: 1,
				lengthStart: 0,
				lengthEnd: 24,
				lengthMax: 24,
				updateCount: 12,
				positiveUpdateCount: 12,
				firstPositiveUpdateMs: 145,
				gapsMs: { count: 11, p50: 100, p90: 101, p99: 103, max: 103, avg: 100.4 },
				positiveCharJumps: { count: 12, p50: 2, p90: 2, p99: 2, max: 2, avg: 2 },
			},
			raf: { count: 100, gapsMs: { count: 99, p50: 16.7, p90: 16.8, p99: 17, max: 17, avg: 16.7 } },
			longTasks: { count: 0, totalMs: 0, maxMs: 0 },
			fixture: { requested: true, mode: "backend", profile: "steady", mix: "reasoning-text", available: true, started: true, deltaCount: 12, reasoningDeltaCount: 4, scheduleGapsMs: { count: 11, p50: 100, p90: 100, p99: 100, max: 100, avg: 100 }, textBytes: 24 },
			sse: { requested: true, installed: true, status: 200, textEventCount: 12, reasoningEventCount: 4, transientIdCount: 22, chunkBytes: { count: 1 }, chunkGapsMs: { count: 0 }, textEventsPerChunk: { count: 12, p50: 1, p90: 1, p99: 1, max: 1, avg: 1 }, textEventGapsMs: { count: 11, p50: 100, p90: 101, p99: 103, max: 103, avg: 100.4 }, errors: [] },
			score: { smoothness: 58, textDeltaCount: 12, domPositiveUpdateCount: 12 },
			regressions: [],
			warnings: [],
		};
		await writeFile(artifact, JSON.stringify({
			kind: "streaming-benchmark-runs",
			createdAt: "2026-05-23T00:00:00.000Z",
			durationMs: 1800,
			runs: [run],
			summary: { runs: 1, smoothness: { count: 1, p50: 58 } },
			regressions: [],
			warnings: [],
		}, null, 2));
		const report = await execFileAsync("node", [cliPath, "debug", "web", "report", "streaming-benchmark", "--from", artifact, "--compact"], { cwd });
		assert.match(report.stdout, /\| SSE transport \| text 12, reasoning 4 \|/);
		assert.match(report.stdout, /\| Cadence lag \| fixture schedule p90 100ms \| DOM lag 1ms, SSE text lag 1ms \|/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug web streaming benchmark help advertises the deterministic fixture", async () => {
	const help = await execFileAsync("node", [cliPath, "debug", "web", "scenario", "--help"]);
	assert.match(help.stdout, /streaming-benchmark \[--fixture\|--backend-fixture\].*\[--fixture-profile steady\|jitter\|burst\|batch\].*\[--fixture-mix text\|reasoning-text\|markdown\|gfm-markdown\|gfm-task-markdown\|gfm-full-markdown\].*\[--fixture-prelude-messages n\].*\[--simulate-reconnect\|--simulate-trace-catchup\].*\[--provider-request-id pr_\.\.\.\|--provider-session-id ps_\.\.\.\|--provider-turn-id turn_\.\.\.\|--provider-selected-session\].*\[--compare-url url\|--compare-hosted\|--compare-hosted-if-configured\].*\[--assert\].*\[--expect-regression text\].*\[--negative-profile batch\|overlay-drop\]/);
	assert.match(help.stdout, /deterministic in-browser stream fixture/);
	assert.match(help.stdout, /real app consumes deterministic \/api\/chat\/events frames/);
	assert.match(help.stdout, /--fixture-profile selects steady cadence, deterministic jitter, bursty timing, or intentional batch stress/);
	assert.match(help.stdout, /--fixture-mix includes text-only, mixed reasoning\/text, CommonMark Markdown, simple GFM Markdown, or full-parser GFM Markdown assistant deltas/);
	assert.match(help.stdout, /--fixture-prelude-messages seeds completed live assistant messages before counters reset/);
	assert.match(help.stdout, /--simulate-reconnect reloads the app with an EventSource probe/);
	assert.match(help.stdout, /--simulate-trace-catchup suppresses backend live text deltas/);
	assert.match(help.stdout, /--runs repeats the same scenario and reports medians/);
	assert.match(help.stdout, /--compare-url runs the same backend fixture at another Chat URL/);
	assert.match(help.stdout, /--compare-hosted uses PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL/);
	assert.match(help.stdout, /--compare-hosted-if-configured runs the hosted comparison when a dev URL is configured/);
	assert.match(help.stdout, /--provider-request-id attaches provider\/Pi telemetry delta counts/);
	assert.match(help.stdout, /--provider-session-id, --provider-turn-id, or --provider-selected-session discovers the latest provider request.*after the benchmark window/);
	assert.match(help.stdout, /--assert exits non-zero when fixture\/debug\/DOM\/provider preservation gates fail/);
	assert.match(help.stdout, /--expect-regression marks a required regression substring/);
	assert.match(help.stdout, /--negative-profile batch expands to the backend batch reasoning\/text fixture/);
	assert.match(help.stdout, /--negative-profile overlay-drop preserves SSE\/EventSource input/);
});

test("streaming benchmark assertion matches expected controlled regressions", () => {
	const assertion = evaluateStreamingBenchmarkAssertion(
		[
			"positive DOM updates 3 < 10",
			"DOM max jump 8 chars exceeds gate",
		],
		["positive DOM updates", "DOM max jump"],
	);
	assert.equal(assertion.passed, true);
	assert.deepEqual(assertion.unexpectedRegressions, []);
	assert.deepEqual(assertion.missingExpectedRegressionPatterns, []);
});

test("streaming benchmark assertion fails on unexpected or missing expected regressions", () => {
	const assertion = evaluateStreamingBenchmarkAssertion(
		[
			"positive DOM updates 3 < 10",
			"fixture did not start",
		],
		["positive DOM updates", "DOM max jump"],
	);
	assert.equal(assertion.passed, false);
	assert.deepEqual(assertion.unexpectedRegressions, ["fixture did not start"]);
	assert.deepEqual(assertion.missingExpectedRegressionPatterns, ["DOM max jump"]);
});

test("streaming benchmark assertion summary reports matched expected regressions", () => {
	const assertion = evaluateStreamingBenchmarkAssertion(
		[
			"positive DOM updates 3 < 10",
			"fixture did not start",
		],
		["positive DOM updates", "DOM max jump"],
	);
	assert.equal(formatStreamingBenchmarkAssertionSummary(assertion), "expected regressions: passed=false matched=1/2 expected=1 unexpected=1 missing=1");
});

test("streaming hosted compare URL resolution prefers env and supports optional absence", () => {
	assert.equal(resolveStreamingBenchmarkHostedCompareUrlFromValues({ PIBO_DEV_PUBLIC_URL: " https://dev.example.test/apps/chat " }, {}), "https://dev.example.test/apps/chat");
	assert.equal(resolveStreamingBenchmarkHostedCompareUrlFromValues({ PIBO_DEV_BASE_URL: "https://dev.example.test/" }, {}), "https://dev.example.test/apps/chat");
	assert.equal(resolveStreamingBenchmarkHostedCompareUrlFromValues({}, { PIBO_DEV_PUBLIC_URL: "https://file.example.test/apps/chat" }), "https://file.example.test/apps/chat");
	assert.equal(resolveStreamingBenchmarkHostedCompareUrlFromValues({ PIBO_DEV_PUBLIC_URL: "", PIBO_DEV_BASE_URL: "" }, {}), undefined);
});

test("streaming benchmark summaries include live pipeline debug counters", () => {
	const run = (enqueueCount, traceRefreshCompletedCount, stateBaseline = 0) => ({
		kind: "streaming-benchmark",
		debug: {
			stateBeforeReset: {
				overlayEventCount: stateBaseline,
				currentOutputLength: stateBaseline * 2,
			},
			delta: {
				textDeltaCount: 12,
				reasoningDeltaCount: 4,
				enqueueCount,
				flushCount: enqueueCount - 1,
				flushedEventCount: enqueueCount,
				overlayUpdateCount: enqueueCount - 1,
				liveTraceComputeCount: enqueueCount - 1,
				liveTraceComputeDurationMsTotal: (enqueueCount - 1) * 0.25,
				markdownRenderCount: enqueueCount + 2,
				markdownRenderPlainCount: enqueueCount,
				markdownRenderCommonMarkCount: 1,
				markdownRenderGfmCount: 1,
				markdownRenderGfmFastCount: 1,
				markdownRenderFullCount: 2,
				markdownRenderDurationMsTotal: enqueueCount * 0.1,
				traceRefreshScheduledCount: 2,
				traceRefreshCompletedCount,
				traceRefreshFailedCount: 0,
			},
			after: {
				startedAt: "2026-01-01T00:00:00.000Z",
				firstReasoningDeltaAt: "2026-01-01T00:00:00.090Z",
				firstTextDeltaAt: "2026-01-01T00:00:00.100Z",
				firstEnqueueAt: "2026-01-01T00:00:00.110Z",
				firstFlushAt: "2026-01-01T00:00:00.125Z",
				firstOverlayUpdateAt: "2026-01-01T00:00:00.126Z",
				overlayEventCount: stateBaseline + enqueueCount,
				currentOutputLength: (stateBaseline * 2) + (enqueueCount * 2),
				traceBaseOutputLength: 4,
				liveTraceComputeDurationMsMax: 0.5,
				markdownRenderDurationMsMax: 0.4,
				markdownRenderPlainDurationMsMax: 0.2,
				markdownRenderFullDurationMsMax: 0.4,
				traceRefreshDurationMsMax: 25,
			},
		},
		fixture: { available: true, requested: true, mode: "backend", started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24 },
		eventSource: { streams: [{ role: "selected-live", textEventCountAfterStart: 12, firstTextEventMsAfterStart: 103 }] },
		sse: { textEventCount: 12, firstTextEventMs: 101, chunkBytes: {}, chunkGapsMs: {}, textEventsPerChunk: {}, textEventGapsMs: {} },
		dom: { gapsMs: { count: 0 }, positiveCharJumps: { count: 0 }, positiveUpdateCount: enqueueCount },
		longTasks: { maxMs: 0 },
		regressions: [],
		score: { smoothness: 50, textDeltaCount: 12, domPositiveUpdateCount: enqueueCount },
	});
	const summary = summarizeStreamingBenchmarks([run(12, 1), run(14, 2, 40)]);
	assert.equal(summary.debugEnqueueCount.p50, 12);
	assert.equal(summary.debugFlushCount.p50, 11);
	assert.equal(summary.debugFlushedEventCount.p90, 12);
	assert.equal(summary.debugOverlayUpdateCount.p90, 11);
	assert.equal(summary.debugOverlayEventCount.max, 14);
	assert.equal(summary.debugLiveTraceComputeCount.p50, 11);
	assert.equal(summary.debugLiveTraceComputeDurationTotalMs.p50, 2.75);
	assert.equal(summary.debugLiveTraceComputeDurationMaxMs.p50, 0.5);
	assert.equal(summary.debugMarkdownRenderCount.p50, 14);
	assert.equal(summary.debugMarkdownRenderPlainCount.p50, 12);
	assert.equal(summary.debugMarkdownRenderFullCount.p50, 2);
	assert.equal(summary.debugMarkdownRenderCommonMarkCount.p50, 1);
	assert.equal(summary.debugMarkdownRenderGfmCount.p50, 1);
	assert.equal(summary.debugMarkdownRenderGfmFastCount.p50, 1);
	assert.equal(summary.debugMarkdownRenderDurationTotalMs.p50, 1.2);
	assert.equal(summary.debugMarkdownRenderDurationMaxMs.p50, 0.4);
	assert.equal(summary.debugMarkdownRenderPlainDurationMaxMs.p50, 0.2);
	assert.equal(summary.debugMarkdownRenderFullDurationMaxMs.p50, 0.4);
	assert.equal(summary.debugTraceRefreshCompletedCount.max, 2);
	assert.equal(summary.debugTraceRefreshDurationMaxMs.p50, 25);
	assert.equal(summary.debugCurrentOutputLength.max, 28);
	assert.equal(summary.liveExpectedInputEventCount.p50, 16);
	assert.equal(summary.liveExpectedPipelineEventCount.p50, 16);
	assert.equal(summary.liveEnqueueToExpectedRatio.p50, 0.75);
	assert.equal(summary.liveFlushedEventsToExpectedRatio.p90, 0.75);
	assert.equal(summary.liveOverlayEventsToExpectedRatio.max, 0.875);
	assert.equal(summary.liveCurrentOutputToExpectedTextBytesRatio.max, 1.167);
	assert.equal(summary.liveFlushToEnqueueRatio.p50, 0.917);
	assert.equal(summary.liveOverlayUpdatesToFlushedEventsRatio.p50, 0.917);
	assert.equal(summary.liveFirstTextDeltaMs.p50, 100);
	assert.equal(summary.liveFirstReasoningDeltaMs.p50, 90);
	assert.equal(summary.liveFirstEnqueueMs.p50, 110);
	assert.equal(summary.liveFirstFlushMs.p50, 125);
	assert.equal(summary.liveFirstOverlayUpdateMs.p50, 126);
	assert.equal(summary.sseFirstTextEventMs.p50, 101);
	assert.equal(summary.selectedLiveFirstTextEventMsAfterStart.p50, 103);
});

test("streaming benchmark summaries aggregate selected-live reconnect streams", () => {
	const summary = summarizeStreamingBenchmarks([{
		kind: "streaming-benchmark",
		debug: { delta: { textDeltaCount: 12, reasoningDeltaCount: 4 }, after: {} },
		fixture: { available: true, requested: true, mode: "backend", started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24 },
		eventSource: {
			streams: [
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live", sinceValues: [], liveSinceValues: [], eventCount: 12, eventCountAfterStart: 12, textEventCount: 7, textEventCountAfterStart: 7, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 1, forcedCloseCountAfterStart: 1, transientIdCount: 12, uniqueTransientIdCount: 12, transientIdCountAfterStart: 12, uniqueTransientIdCountAfterStart: 12, durableIdCount: 0, otherIdCount: 0, firstTextEventMsAfterStart: 105 },
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live", sinceValues: [], liveSinceValues: ["42"], eventCount: 8, eventCountAfterStart: 8, textEventCount: 5, textEventCountAfterStart: 5, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 0, forcedCloseCountAfterStart: 0, transientIdCount: 8, uniqueTransientIdCount: 8, transientIdCountAfterStart: 8, uniqueTransientIdCountAfterStart: 8, durableIdCount: 0, otherIdCount: 0, liveReplayEventCount: 4, liveReplayEventCountAfterStart: 4, liveReplayMissedCount: 1, liveReplayMissedCountAfterStart: 1, liveReplayDuplicateCount: 2, liveReplayDuplicateCountAfterStart: 2, liveReplayCursorLagMax: 6, liveReplayCursorLagMaxAfterStart: 6, firstTextEventMsAfterStart: 212 },
			],
		},
		dom: { gapsMs: { count: 0 }, positiveCharJumps: { count: 0 }, positiveUpdateCount: 12 },
		longTasks: { maxMs: 0 },
		regressions: [],
		score: { smoothness: 50, textDeltaCount: 12, domPositiveUpdateCount: 12 },
	}]);
	assert.equal(summary.selectedLiveEventCountAfterStart.p50, 20);
	assert.equal(summary.selectedLiveTextEventCountAfterStart.p50, 12);
	assert.equal(summary.selectedLiveReasoningEventCountAfterStart.p50, 4);
	assert.equal(summary.selectedLiveForcedCloseCountAfterStart.p50, 1);
	assert.equal(summary.selectedLiveReconnectOpenCountAfterStart.p50, 2);
	assert.equal(summary.selectedLiveTransientIdCountAfterStart.p50, 20);
	assert.equal(summary.selectedLiveLiveSinceCount.p50, 1);
	assert.equal(summary.selectedLiveReplayEventCountAfterStart.p50, 4);
	assert.equal(summary.selectedLiveReplayCursorLagMaxAfterStart.p50, 6);
	assert.equal(summary.selectedLiveReplayDuplicateCountAfterStart.p50, 2);
	assert.equal(summary.selectedLiveReplayMissedCountAfterStart.p50, 1);
	assert.equal(summary.selectedLiveFirstTextEventMsAfterStart.p50, 105);
});

test("selected-live EventSource summary aggregates reconnect replay status", () => {
	const selectedLive = summarizeStreamingSelectedLiveEventSource({
		eventSource: {
			streams: [
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live", sinceValues: ["100:1"], liveSinceValues: [], eventCount: 12, eventCountAfterStart: 12, textEventCount: 7, textEventCountAfterStart: 7, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 1, forcedCloseCountAfterStart: 1, transientIdCount: 12, uniqueTransientIdCount: 12, transientIdCountAfterStart: 12, uniqueTransientIdCountAfterStart: 12, durableIdCount: 0, otherIdCount: 0, firstTextEventMsAfterStart: 105 },
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live&liveSince=42", sinceValues: [], liveSinceValues: ["42"], eventCount: 8, eventCountAfterStart: 8, textEventCount: 5, textEventCountAfterStart: 5, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 0, forcedCloseCountAfterStart: 0, transientIdCount: 8, uniqueTransientIdCount: 8, transientIdCountAfterStart: 8, uniqueTransientIdCountAfterStart: 8, durableIdCount: 0, otherIdCount: 0, liveReplayEventCount: 2, liveReplayEventCountAfterStart: 2, liveReplayMissedCount: 1, liveReplayMissedCountAfterStart: 1, liveReplayDuplicateCount: 1, liveReplayDuplicateCountAfterStart: 1, liveReplayEvictedBeforeMax: 41, liveReplayCursorLagMax: 3, liveReplayCursorLagMaxAfterStart: 3, firstTextEventMsAfterStart: 212 },
				{ role: "room-summary", url: "/api/chat/events?roomId=room_test&mode=summary", sinceValues: [], liveSinceValues: [], eventCount: 6, eventCountAfterStart: 6, textEventCount: 0, textEventCountAfterStart: 0, reasoningEventCount: 0, reasoningEventCountAfterStart: 0, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 0, forcedCloseCountAfterStart: 0, transientIdCount: 6, uniqueTransientIdCount: 6, transientIdCountAfterStart: 6, uniqueTransientIdCountAfterStart: 6, durableIdCount: 0, otherIdCount: 0, liveReplayEventCount: 5, liveReplayEventCountAfterStart: 5 },
			],
		},
	});
	assert.equal(selectedLive.textEventCountAfterStart, 12);
	assert.equal(selectedLive.reasoningEventCountAfterStart, 4);
	assert.deepEqual(selectedLive.liveSinceValues, ["42"]);
	assert.deepEqual(selectedLive.sinceValues, ["100:1"]);
	assert.equal(selectedLive.liveReplayEventCountAfterStart, 2);
	assert.equal(selectedLive.liveReplayMissedCountAfterStart, 1);
	assert.equal(selectedLive.liveReplayDuplicateCountAfterStart, 1);
	assert.equal(selectedLive.liveReplayEvictedBeforeMax, 41);
	assert.equal(selectedLive.liveReplayCursorLagMaxAfterStart, 3);
	assert.equal(selectedLive.forcedCloseCountAfterStart, 1);
	assert.equal(selectedLive.openCountAfterStart, 2);
	assert.equal(selectedLive.firstTextEventMsAfterStart, 105);
});

test("provider preservation aggregates selected-live reconnect streams", () => {
	const preservation = summarizeStreamingProviderPreservation({
		provider: { available: true, textDeltaCount: 12, reasoningDeltaCount: 4 },
		eventSource: {
			streams: [
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live", sinceValues: [], liveSinceValues: [], eventCount: 12, eventCountAfterStart: 12, textEventCount: 7, textEventCountAfterStart: 7, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 1, forcedCloseCountAfterStart: 1, transientIdCount: 12, uniqueTransientIdCount: 12, transientIdCountAfterStart: 12, uniqueTransientIdCountAfterStart: 12, durableIdCount: 0, otherIdCount: 0 },
				{ role: "selected-live", url: "/api/chat/events?piboSessionId=ps_test&mode=live&liveSince=42", sinceValues: [], liveSinceValues: ["42"], eventCount: 8, eventCountAfterStart: 8, textEventCount: 5, textEventCountAfterStart: 5, reasoningEventCount: 2, reasoningEventCountAfterStart: 2, openCountAfterStart: 1, errorCountAfterStart: 0, closeCountAfterStart: 0, forcedCloseCountAfterStart: 0, transientIdCount: 8, uniqueTransientIdCount: 8, transientIdCountAfterStart: 8, uniqueTransientIdCountAfterStart: 8, durableIdCount: 0, otherIdCount: 0, liveReplayEventCount: 2, liveReplayEventCountAfterStart: 2 },
			],
		},
		dom: { positiveUpdateCount: 12 },
	});
	assert.equal(preservation.selectedLiveTextEventCountAfterStart, 12);
	assert.equal(preservation.selectedLiveReasoningEventCountAfterStart, 4);
	assert.equal(preservation.selectedLiveTextToProviderRatio, 1);
	assert.equal(preservation.selectedLiveReasoningToProviderRatio, 1);
});

test("streaming live pipeline summary subtracts pre-reset trace state", () => {
	const summary = summarizeStreamingLivePipeline({
		debug: {
			delta: { enqueueCount: 16, flushCount: 16, flushedEventCount: 16, overlayUpdateCount: 16, textDeltaCount: 12, reasoningDeltaCount: 4 },
			stateBeforeReset: { overlayEventCount: 32, currentOutputLength: 48 },
			after: { overlayEventCount: 48, currentOutputLength: 72 },
		},
		fixture: { available: true, requested: true, mode: "backend", started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24 },
	});
	assert.equal(summary.expectedPipelineEventCount, 16);
	assert.equal(summary.overlayEventCount, 16);
	assert.equal(summary.currentOutputLength, 24);
	assert.equal(summary.overlayEventsToExpectedRatio, 1);
	assert.equal(summary.currentOutputToExpectedTextBytesRatio, 1);
});

test("streaming live pipeline summary computes fixture-normalized ratios", () => {
	const summary = summarizeStreamingLivePipeline({
		debug: {
			delta: { enqueueCount: 16, flushCount: 16, flushedEventCount: 16, overlayUpdateCount: 16, textDeltaCount: 12, reasoningDeltaCount: 4 },
			after: {
				startedAt: "2026-01-01T00:00:00.000Z",
				firstTextDeltaAt: "2026-01-01T00:00:00.120Z",
				firstEnqueueAt: "2026-01-01T00:00:00.121Z",
				firstFlushAt: "2026-01-01T00:00:00.130Z",
				overlayEventCount: 16,
				currentOutputLength: 24,
			},
		},
		fixture: { available: true, requested: true, mode: "backend", started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24 },
	});
	assert.equal(summary.expectedSource, "fixture");
	assert.equal(summary.expectedInputEventCount, 16);
	assert.equal(summary.expectedPipelineEventCount, 16);
	assert.equal(summary.enqueueToExpectedRatio, 1);
	assert.equal(summary.flushedEventsToExpectedRatio, 1);
	assert.equal(summary.overlayEventsToExpectedRatio, 1);
	assert.equal(summary.currentOutputToExpectedTextBytesRatio, 1);
	assert.equal(summary.flushToEnqueueRatio, 1);
	assert.equal(summary.overlayUpdatesToFlushedEventsRatio, 1);
	assert.equal(summary.firstTextDeltaMs, 120);
	assert.equal(summary.firstEnqueueMs, 121);
	assert.equal(summary.firstFlushMs, 130);
});

test("streaming live pipeline regressions gate preservation and flush ratios", () => {
	assert.deepEqual(evaluateStreamingLivePipelineRegressions({
		livePipeline: {
			expectedSource: "fixture",
			expectedTextDeltaCount: 12,
			expectedReasoningDeltaCount: 4,
			expectedInputEventCount: 16,
			enqueueCount: 16,
			flushCount: 16,
			flushedEventCount: 16,
			overlayUpdateCount: 16,
			overlayEventCount: 16,
			expectedPipelineEventCount: 16,
			flushedEventsToExpectedRatio: 1,
			overlayEventsToExpectedRatio: 1,
			currentOutputToExpectedTextBytesRatio: 1,
			flushToEnqueueRatio: 1,
			overlayUpdatesToFlushedEventsRatio: 1,
			expectedTextBytes: 24,
		},
	}), []);
	assert.deepEqual(evaluateStreamingLivePipelineRegressions({
		livePipeline: {
			expectedSource: "fixture",
			expectedTextDeltaCount: 12,
			expectedReasoningDeltaCount: 4,
			expectedInputEventCount: 16,
			enqueueCount: 22,
			flushCount: 13,
			flushedEventCount: 14,
			overlayUpdateCount: 13,
			overlayEventCount: 13,
			expectedPipelineEventCount: 16,
			flushedEventsToExpectedRatio: 0.875,
			overlayEventsToExpectedRatio: 0.8,
			currentOutputToExpectedTextBytesRatio: 0.7,
			flushToEnqueueRatio: 0.591,
			overlayUpdatesToFlushedEventsRatio: 0.591,
			expectedTextBytes: 24,
		},
	}), [
		"live pipeline flushed events/overlay expected ratio 0.875 < 0.95",
		"live pipeline overlay events/input expected ratio 0.8 < 0.95",
		"live pipeline current text/expected bytes ratio 0.7 < 0.95",
		"live pipeline flush/enqueue ratio 0.591 < 0.75",
		"live pipeline overlay updates/flushed ratio 0.591 < 0.75",
	]);
	assert.deepEqual(evaluateStreamingLivePipelineRegressions({
		livePipeline: {
			expectedSource: "provider",
			expectedTextDeltaCount: 12,
			expectedReasoningDeltaCount: 0,
			expectedInputEventCount: 12,
		},
	}), []);
	assert.deepEqual(evaluateStreamingLivePipelineRegressions({
		fixture: { simulation: "trace-catchup" },
		livePipeline: {
			expectedSource: "fixture",
			expectedTextDeltaCount: 12,
			expectedReasoningDeltaCount: 0,
			expectedInputEventCount: 12,
			flushedEventsToExpectedRatio: 0,
			overlayEventsToExpectedRatio: 0,
			flushToEnqueueRatio: 0,
			overlayUpdatesToFlushedEventsRatio: 0,
		},
	}), []);
});

test("streaming provider preservation summary computes provider-to-transport ratios", () => {
	const summary = summarizeStreamingProviderPreservation({
		provider: {
			requested: true,
			available: true,
			providerRequestId: "pr_fixture",
			textDeltaCount: 10,
			reasoningDeltaCount: 4,
			textDeltaBytes: { count: 10 },
			reasoningDeltaBytes: { count: 4 },
			textDeltaGapsMs: { count: 9 },
			reasoningDeltaGapsMs: { count: 3 },
			eventPageCount: 1,
			truncated: false,
		},
		sse: { textEventCount: 10, reasoningEventCount: 3 },
		eventSource: { streams: [{ role: "selected-live", textEventCountAfterStart: 9, reasoningEventCountAfterStart: 4 }] },
		dom: { positiveUpdateCount: 8 },
	});
	assert.equal(summary.providerTextDeltaCount, 10);
	assert.equal(summary.sseTextToProviderRatio, 1);
	assert.equal(summary.selectedLiveTextToProviderRatio, 0.9);
	assert.equal(summary.domPositiveToProviderTextRatio, 0.8);
	assert.equal(summary.sseReasoningToProviderRatio, 0.75);
	assert.equal(summary.selectedLiveReasoningToProviderRatio, 1);
});

test("streaming provider telemetry can be attached after a benchmark window", () => {
	const updated = attachStreamingProviderTelemetryToBenchmark({
		regressions: ["fixture did not start", "provider stale regression"],
		sse: { requested: true, textEventCount: 9, reasoningEventCount: 4 },
		eventSource: { requested: true, streams: [{ role: "selected-live", textEventCountAfterStart: 10, reasoningEventCountAfterStart: 4 }] },
		dom: { positiveUpdateCount: 8 },
	}, {
		requested: true,
		available: true,
		providerRequestId: "pr_after_window",
		textDeltaCount: 10,
		reasoningDeltaCount: 4,
		textDeltaBytes: { count: 10 },
		reasoningDeltaBytes: { count: 4 },
		textDeltaGapsMs: { count: 9 },
		reasoningDeltaGapsMs: { count: 3 },
		parseErrorCount: 0,
		unknownEventCount: 0,
		eventPageCount: 1,
		truncated: false,
	});
	assert.equal(updated.provider.providerRequestId, "pr_after_window");
	assert.equal(updated.providerPreservation.sseTextToProviderRatio, 0.9);
	assert.equal(updated.providerPreservation.selectedLiveTextToProviderRatio, 1);
	assert.deepEqual(updated.regressions, [
		"fixture did not start",
		"provider SSE text preservation ratio 0.9 < 0.95",
	]);
});

test("streaming provider regressions gate telemetry health and preservation ratios", () => {
	const healthyProvider = {
		requested: true,
		available: true,
		providerRequestId: "pr_fixture",
		textDeltaCount: 100,
		reasoningDeltaCount: 20,
		textDeltaBytes: { count: 100 },
		reasoningDeltaBytes: { count: 20 },
		textDeltaGapsMs: { count: 99 },
		reasoningDeltaGapsMs: { count: 19 },
		parseErrorCount: 0,
		unknownEventCount: 0,
		eventPageCount: 1,
		truncated: false,
	};
	assert.deepEqual(evaluateStreamingProviderRegressions({
		provider: healthyProvider,
		providerPreservation: {
			providerTextDeltaCount: 100,
			providerReasoningDeltaCount: 20,
			sseTextToProviderRatio: 0.98,
			selectedLiveTextToProviderRatio: 0.99,
			sseReasoningToProviderRatio: 1,
			selectedLiveReasoningToProviderRatio: 0.95,
		},
		sse: { requested: true },
		eventSource: { requested: true },
	}), []);
	assert.deepEqual(evaluateStreamingProviderRegressions({
		provider: { ...healthyProvider, parseErrorCount: 1, unknownEventCount: 2, truncated: true },
		providerPreservation: {
			providerTextDeltaCount: 100,
			providerReasoningDeltaCount: 20,
			sseTextToProviderRatio: 0.94,
			selectedLiveTextToProviderRatio: 0.93,
			sseReasoningToProviderRatio: 0.9,
			selectedLiveReasoningToProviderRatio: 0.94,
		},
		sse: { requested: true },
		eventSource: { requested: true },
	}), [
		"provider parse errors 1 > 0",
		"provider unknown events 2 > 0",
		"provider telemetry events were truncated",
		"provider SSE text preservation ratio 0.94 < 0.95",
		"provider selected-live text preservation ratio 0.93 < 0.95",
		"provider SSE reasoning preservation ratio 0.9 < 0.95",
		"provider selected-live reasoning preservation ratio 0.94 < 0.95",
	]);
});

test("streaming provider telemetry summary extracts delta bytes, gaps, and latencies", () => {
	const summary = summarizeStreamingProviderTelemetry({
		request: {
			providerRequestId: "pr_fixture",
			piboSessionId: "ps_fixture",
			turnId: "turn_fixture",
			provider: "openai",
			api: "responses",
			model: "gpt-fixture",
			transport: "sse",
			status: "completed",
			startedAt: "2026-05-23T00:00:00.000Z",
			firstByteAt: "2026-05-23T00:00:00.050Z",
			completedAt: "2026-05-23T00:00:00.300Z",
			parseErrorCount: 0,
			unknownEventCount: 1,
			rawEventCount: 5,
			normalizedEventCount: 4,
			eventTypeCounts: { "pi.text_delta": 3, "pi.thinking_delta": 1 },
		},
		events: [
			{ normalizedType: "thinking_delta", eventType: "pi.thinking_delta", receivedAt: "2026-05-23T00:00:00.075Z", safeFields: { deltaBytes: 4 }, byteSize: 40 },
			{ normalizedType: "assistant_delta", eventType: "pi.text_delta", receivedAt: "2026-05-23T00:00:00.100Z", safeFields: { deltaBytes: 2 }, byteSize: 20 },
			{ normalizedType: "assistant_delta", eventType: "pi.text_delta", receivedAt: "2026-05-23T00:00:00.125Z", safeFields: { deltaBytes: 3 }, byteSize: 30 },
			{ normalizedType: "assistant_delta", eventType: "pi.text_delta", receivedAt: "2026-05-23T00:00:00.175Z", safeFields: { deltaBytes: 5 }, byteSize: 50 },
		],
		eventPageCount: 1,
	});
	assert.equal(summary.available, true);
	assert.equal(summary.providerRequestId, "pr_fixture");
	assert.equal(summary.textDeltaCount, 3);
	assert.equal(summary.reasoningDeltaCount, 1);
	assert.equal(summary.textDeltaBytes.p50, 3);
	assert.equal(summary.textDeltaGapsMs.max, 50);
	assert.equal(summary.firstByteLatencyMs, 50);
	assert.equal(summary.firstTextLatencyMs, 100);
	assert.equal(summary.firstReasoningLatencyMs, 75);
	assert.equal(summary.unknownEventCount, 1);
});

test("streaming provider telemetry can be discovered from session or turn metadata", async () => {
	const cwd = await makeDebugFixture();
	const previousPiboHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = join(cwd, ".pibo");
	try {
		const bySession = collectStreamingProviderTelemetryFromSession("ps_running");
		assert.equal(bySession.available, true);
		assert.equal(bySession.providerRequestId, "pr_debug_stuck");
		assert.equal(bySession.piboSessionId, "ps_running");
		assert.equal(bySession.turnId, "turn_debug_stuck");

		const byTurn = collectStreamingProviderTelemetryFromTurn("evt_running");
		assert.equal(byTurn.available, true);
		assert.equal(byTurn.providerRequestId, "pr_debug_stuck");
		assert.equal(byTurn.unknownEventCount, 1);

		const bySelectedSession = await collectStreamingProviderTelemetryFromSelectedBrowserSession({
			evaluate: async () => ({ piboSessionId: "ps_running" }),
		});
		assert.equal(bySelectedSession.available, true);
		assert.equal(bySelectedSession.providerRequestId, "pr_debug_stuck");

		const missingSelectedSession = await collectStreamingProviderTelemetryFromSelectedBrowserSession({
			evaluate: async () => ({}),
		});
		assert.equal(missingSelectedSession.available, false);
		assert.equal(missingSelectedSession.providerRequestId, "selected-session");
		assert.match(missingSelectedSession.error, /No selected Chat session/);

		const missing = collectStreamingProviderTelemetryFromSession("ps_missing");
		assert.equal(missing.available, false);
		assert.equal(missing.providerRequestId, "session:ps_missing");
		assert.match(missing.error, /No telemetry found/);
	} finally {
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		await rm(cwd, { recursive: true, force: true });
	}
});

test("streaming URL comparison regressions gate hosted-vs-direct degradation", () => {
	assert.deepEqual(evaluateStreamingBenchmarkUrlComparisonRegressions({
		baselineRuns: 2,
		currentRuns: 2,
		smoothnessDelta: -1,
		domLagOverFixtureScheduleP90DeltaMs: 2,
		sseTextLagOverFixtureScheduleP90DeltaMs: 3,
		sseChunkGapP90DeltaMs: 4,
		selectedLiveFirstTextEventDeltaMs: 20,
		sseFirstTextEventDeltaMs: 20,
		liveFirstTextDeltaDeltaMs: 20,
		liveFirstEnqueueDeltaMs: 20,
		liveFirstFlushDeltaMs: 20,
		liveFirstOverlayUpdateDeltaMs: 20,
		firstVisibleDeltaMs: 20,
		sseTextEventDelta: 0,
		selectedLiveTextEventDelta: 0,
		selectedLiveReasoningEventDelta: 0,
	}), []);
	assert.deepEqual(evaluateStreamingBenchmarkUrlComparisonRegressions({
		baselineRuns: 2,
		currentRuns: 2,
		smoothnessDelta: -16,
		domLagOverFixtureScheduleP90DeltaMs: 151,
		sseTextLagOverFixtureScheduleP90DeltaMs: 101,
		sseChunkGapP90DeltaMs: 101,
		selectedLiveFirstTextEventDeltaMs: 251,
		sseFirstTextEventDeltaMs: 252,
		liveFirstTextDeltaDeltaMs: 253,
		liveFirstEnqueueDeltaMs: 254,
		liveFirstFlushDeltaMs: 255,
		liveFirstOverlayUpdateDeltaMs: 256,
		firstVisibleDeltaMs: 301,
		sseTextEventDelta: -1,
		selectedLiveTextEventDelta: -1,
		selectedLiveReasoningEventDelta: -1,
	}), [
		"compare smoothness delta -16 below -15",
		"compare DOM lag over schedule delta 151ms exceeds 150ms",
		"compare SSE text lag over schedule delta 101ms exceeds 100ms",
		"compare SSE chunk p90 gap delta 101ms exceeds 100ms",
		"compare selected-live first text latency delta 251ms exceeds 250ms",
		"compare SSE first text latency delta 252ms exceeds 250ms",
		"compare live first text latency delta 253ms exceeds 250ms",
		"compare live first enqueue latency delta 254ms exceeds 250ms",
		"compare live first flush latency delta 255ms exceeds 250ms",
		"compare live first overlay latency delta 256ms exceeds 250ms",
		"compare DOM first visible latency delta 301ms exceeds 300ms",
		"compare SSE text events delta -1 below 0",
		"compare selected-live text events delta -1 below 0",
		"compare selected-live reasoning events delta -1 below 0",
	]);
});

test("streaming URL comparison preserves controlled negative profile in artifacts and text", () => {
	const makeRun = (regression) => ({
		kind: "streaming-benchmark",
		durationMs: 1200,
		url: "http://direct.example/apps/chat/rooms/room/sessions/ps",
		debug: { available: true, reset: true, before: {}, after: {}, delta: { textDeltaCount: 12, reasoningDeltaCount: 4 } },
		fixture: { requested: true, mode: "backend", profile: "steady", mix: "reasoning-text", available: true, started: true, deltaCount: 12, reasoningDeltaCount: 4, textBytes: 24, scheduleGapsMs: { count: 11, p90: 100 } },
		dom: { targetCountStart: 1, targetCountEnd: 1, lengthStart: 0, lengthEnd: 0, updateCount: 0, positiveUpdateCount: 0, firstPositiveUpdateMs: 140, gapsMs: { count: 0 }, positiveCharJumps: { count: 0 } },
		raf: { count: 10, gapsMs: { count: 9, p90: 16.7 } },
		longTasks: { count: 0, maxMs: 0, totalMs: 0 },
		eventSource: { streams: [{ role: "selected-live", eventCountAfterStart: 22, textEventCountAfterStart: 12, reasoningEventCountAfterStart: 4, transientIdCountAfterStart: 22, firstTextEventMsAfterStart: 121 }] },
		sse: { textEventCount: 12, reasoningEventCount: 4, firstTextEventMs: 119, chunkBytes: { count: 1, p50: 200 }, chunkGapsMs: { count: 1, p90: 100 }, textEventsPerChunk: { count: 1, p90: 1 }, textEventGapsMs: { count: 1, p90: 100 } },
		livePipeline: { expectedInputEventCount: 16, expectedPipelineEventCount: 16, flushedEventsToExpectedRatio: 0, overlayEventsToExpectedRatio: 0, currentOutputToExpectedTextBytesRatio: 0, flushToEnqueueRatio: 0.5, overlayUpdatesToFlushedEventsRatio: 0.5, firstTextDeltaMs: 120, firstEnqueueMs: 40, firstFlushMs: 42, firstOverlayUpdateMs: 44 },
		score: { smoothness: 10, textDeltaCount: 12, domPositiveUpdateCount: 0 },
		negativeProfile: "overlay-drop",
		regressions: [regression],
		warnings: [],
	});
	const makeGroup = (run, label) => ({
		kind: "streaming-benchmark-runs",
		createdAt: "2026-05-23T00:00:00.000Z",
		durationMs: 1200,
		runs: [run],
		negativeProfile: "overlay-drop",
		summary: summarizeStreamingBenchmarks([run]),
		regressions: run.regressions.map((regression) => `${label}: ${regression}`),
		warnings: [],
	});
	const primary = makeGroup(makeRun("positive DOM updates 0 < 10"), "run 1");
	const compare = makeGroup(makeRun("positive DOM updates 0 < 10"), "run 1");
	const comparison = summarizeStreamingBenchmarkUrlComparison("http://direct.example/apps/chat", "https://hosted.example/apps/chat", primary, compare);
	assert.equal(comparison.negativeProfile, "overlay-drop");
	assert.deepEqual(comparison.regressions, ["primary: run 1: positive DOM updates 0 < 10", "compare: run 1: positive DOM updates 0 < 10"]);
	assert.equal(comparison.comparison.selectedLiveFirstTextEventDeltaMs, 0);
	assert.equal(comparison.comparison.sseFirstTextEventDeltaMs, 0);
	assert.equal(comparison.comparison.liveFirstTextDeltaDeltaMs, 0);
	assert.equal(comparison.comparison.firstVisibleDeltaMs, 0);
	const text = formatStreamingBenchmarkUrlComparison(comparison, { id: "target", url: "", title: "" });
	assert.match(text, /negative profile: overlay-drop/);
	assert.match(text, /primary selected-live: .*text=count=1, p50=12/);
	assert.match(text, /compare selected-live: .*reasoning=count=1, p50=4/);
	assert.match(text, /comparison selected-live: events 0, text 0, reasoning 0/);
	assert.match(text, /primary live ratios: .*overlayExpected=count=1, p50=16.*flushed\/overlayExpected=count=1, p50=0/);
	assert.match(text, /compare live ratios: .*overlayEvents\/inputExpected=count=1, p50=0/);
	assert.match(text, /comparison live ratios: flushed\/overlayExpected 0, overlayEvents\/inputExpected 0, flush\/enqueue 0, overlayUpdates\/flushed 0/);
	assert.match(text, /primary first latency: .*selectedLive=count=1, p50=121.*sse=count=1, p50=119.*liveText=count=1, p50=120.*domVisible=count=1, p50=140/);
	assert.match(text, /comparison first latency: selectedLive 0ms, sse 0ms, liveText 0ms, liveEnqueue 0ms, liveFlush 0ms, liveOverlay 0ms, domVisible 0ms/);
});

test("pibo debug web streaming benchmark rejects missing expected regression value before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--expect-regression"]),
		(error) => {
			assert.match(error.stderr, /--expect-regression requires a value/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects missing provider request id before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--provider-request-id"]),
		(error) => {
			assert.match(error.stderr, /--provider-request-id requires a value/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects missing provider session id before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--provider-session-id"]),
		(error) => {
			assert.match(error.stderr, /--provider-session-id requires a value/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects multiple provider telemetry sources before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--provider-request-id", "pr_one", "--provider-selected-session"]),
		(error) => {
			assert.match(error.stderr, /Use only one provider telemetry source flag: --provider-request-id, --provider-selected-session/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects missing negative profile value before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--negative-profile"]),
		(error) => {
			assert.match(error.stderr, /--negative-profile requires a value/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects missing compare URL before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--compare-url"]),
		(error) => {
			assert.match(error.stderr, /--compare-url requires a value/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects compare URL without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--compare-url", "http://example.test/apps/chat"]),
		(error) => {
			assert.match(error.stderr, /--compare-url requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects compare hosted without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--compare-hosted"]),
		(error) => {
			assert.match(error.stderr, /--compare-hosted requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects mutually exclusive compare targets before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--compare-url", "http://example.test/apps/chat", "--compare-hosted"]),
		(error) => {
			assert.match(error.stderr, /Use only one compare target flag: --compare-url, --compare-hosted/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects optional compare hosted without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--compare-hosted-if-configured"]),
		(error) => {
			assert.match(error.stderr, /--compare-hosted-if-configured requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects compare hosted without configured dev URL before target discovery", async () => {
	const cwd = await makeEmptyCwd();
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--compare-hosted"], { cwd, env: { PIBO_DEV_PUBLIC_URL: "", PIBO_DEV_BASE_URL: "" } }),
			(error) => {
				assert.match(error.stderr, /--compare-hosted requires PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL/);
				assert.doesNotMatch(error.stderr, /No attachable CDP target/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug web streaming benchmark rejects invalid negative profile before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--negative-profile", "random"]),
		(error) => {
			assert.match(error.stderr, /--negative-profile must be batch or overlay-drop/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects conflicting negative profile flags before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--negative-profile", "batch", "--fixture-profile", "steady"]),
		(error) => {
			assert.match(error.stderr, /--negative-profile batch already selects fixture settings and expected regressions; remove --fixture-profile/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects mutually exclusive fixtures before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--fixture", "--backend-fixture"]),
		(error) => {
			assert.match(error.stderr, /Use either --fixture or --backend-fixture, not both/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects action flags before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--act"]),
		(error) => {
			assert.match(error.stderr, /streaming-benchmark does not support --act or --manual/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects invalid fixture profiles before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--fixture-profile", "random"]),
		(error) => {
			assert.match(error.stderr, /--fixture-profile must be steady, jitter, burst, or batch/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects invalid fixture mix before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--fixture-mix", "thinking-only"]),
		(error) => {
			assert.match(error.stderr, /--fixture-mix must be text, reasoning-text, markdown, gfm-markdown, gfm-task-markdown, or gfm-full-markdown/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects fixture mix without fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--fixture-mix", "reasoning-text"]),
		(error) => {
			assert.match(error.stderr, /--fixture-mix requires --fixture or --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects fixture prelude without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--fixture-prelude-messages", "100"]),
		(error) => {
			assert.match(error.stderr, /--fixture-prelude-messages requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects invalid fixture prelude count before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--fixture-prelude-messages", "2.5"]),
		(error) => {
			assert.match(error.stderr, /--fixture-prelude-messages must be a non-negative integer/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects reconnect simulation without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--simulate-reconnect"]),
		(error) => {
			assert.match(error.stderr, /--simulate-reconnect requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects trace catch-up simulation without backend fixture before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--simulate-trace-catchup"]),
		(error) => {
			assert.match(error.stderr, /--simulate-trace-catchup requires --backend-fixture/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("pibo debug web streaming benchmark rejects combined stream simulations before target discovery", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "scenario", "streaming-benchmark", "--backend-fixture", "--simulate-reconnect", "--simulate-trace-catchup"]),
		(error) => {
			assert.match(error.stderr, /Use either --simulate-reconnect or --simulate-trace-catchup, not both/);
			assert.doesNotMatch(error.stderr, /No attachable CDP target/);
			return true;
		},
	);
});

test("web render flicker detection does not match a removal to an earlier add", () => {
	const opt = makeWatchNode("session-row:opt", { "data-pibo-session-id": "opt" });
	const real = makeWatchNode("session-row:real", { "data-pibo-session-id": "real" });
	const flickers = inferWatchFlickers([
		{ t: 1, source: "dom", kind: "added", target: opt.identity, node: opt },
		{ t: 61, source: "dom", kind: "removed", target: opt.identity, node: opt },
		{ t: 122, source: "dom", kind: "added", target: real.identity, node: real },
	]);
	const output = flickers.join("\n");
	assert.match(output, /transient node within 60ms: session-row:opt added then removed/);
	assert.match(output, /remove\/add within 61ms: session-row:opt -> session-row:real/);
	assert.doesNotMatch(output, /session-row:opt -> session-row:opt/);
});

test("web render watch reports final snapshot deltas when no mutation events were captured", () => {
	const before = makeWatchSnapshot([]);
	const after = makeWatchSnapshot([makeWatchNode("session-row:ps_new", { "data-pibo-session-id": "ps_new" })]);
	const output = formatWatch(
		{
			kind: "watch",
			createdAt: "2026-05-16T00:00:00.000Z",
			url: "file:///fixture.html",
			title: "Fixture",
			scope: "#container",
			durationMs: 1000,
			rootFound: true,
			events: [],
			before,
			after,
			omitted: { events: 0, nodes: 0, depth: 0, budget: false },
		},
		{ id: "target", url: "file:///fixture.html", title: "Fixture" },
	);
	assert.match(output, /no mutation events captured; final snapshot differs/);
	assert.match(output, /\+ session-row:ps_new/);
	assert.doesNotMatch(output, /no changes/);
});

test("pibo debug help stays progressive", async () => {
	const root = await execFileAsync("node", [cliPath, "debug", "--help"]);
	assert.match(root.stdout, /pibo debug - inspect local Pibo data/);
	assert.match(root.stdout, /pibo debug db/);
	assert.match(root.stdout, /pibo debug trace/);
	assert.match(root.stdout, /pibo debug telemetry/);
	assert.doesNotMatch(root.stdout, /pibo_sessions/);

	const telemetry = await execFileAsync("node", [cliPath, "debug", "telemetry", "--help"]);
	assert.match(telemetry.stdout, /pibo debug telemetry - inspect bounded runtime observability telemetry/);
	assert.match(telemetry.stdout, /sessions\s+List recent, active, or stale telemetry sessions/);
	assert.match(telemetry.stdout, /session\s+Show compact session telemetry/);
	assert.match(telemetry.stdout, /turn\s+Show a phase timeline/);
	assert.match(telemetry.stdout, /provider\s+Show provider request summary/);
	assert.doesNotMatch(telemetry.stdout, /telemetry_turns/);

	const db = await execFileAsync("node", [cliPath, "debug", "db", "--help"]);
	assert.match(db.stdout, /pibo debug db - inspect local SQLite stores/);
	assert.match(db.stdout, /pibo-data\s+pibo\.sqlite/);
	assert.match(db.stdout, /query <store> <sql>/);
	assert.doesNotMatch(db.stdout, /CREATE TABLE/);
	assert.doesNotMatch(db.stdout, /web-chat\.sqlite/);
	assert.doesNotMatch(db.stdout, /pibo-sessions\.sqlite/);
});

test("pibo debug telemetry lists sessions and drills into session and turn summaries", async () => {
	const cwd = await makeDebugFixture();
	try {
		const sessions = await execFileAsync("node", [cliPath, "debug", "telemetry", "sessions", "--active", "--limit", "5"], { cwd });
		assert.match(sessions.stdout, /pibo debug telemetry sessions/);
		assert.match(sessions.stdout, /piboSessionId\tstatus\tactiveTurnId\tactivePhase/);
		assert.match(sessions.stdout, /ps_running\trunning\tturn_debug_stuck\ttool_args:open/);
		assert.match(sessions.stdout, /pibo debug telemetry session ps_running/);
		assert.doesNotMatch(sessions.stdout, /sleep 10/);

		const stale = await execFileAsync("node", [cliPath, "debug", "telemetry", "sessions", "--stale", "--json"], { cwd });
		const staleParsed = JSON.parse(stale.stdout);
		assert.equal(staleParsed.available, true);
		assert.equal(staleParsed.filters.stale, true);
		assert.equal(staleParsed.rows.some((row) => row.piboSessionId === "ps_running" && row.isStale === true), true);
		assert.equal(staleParsed.limit, 20);

		const session = await execFileAsync("node", [cliPath, "debug", "telemetry", "session", "ps_running", "--limit", "5"], { cwd });
		assert.match(session.stdout, /status\trunning/);
		assert.match(session.stdout, /activeTurn\tturn_debug_stuck/);
		assert.match(session.stdout, /activePhase\ttool_args:open/);
		assert.match(session.stdout, /providerRequestId\tpr_debug_stuck/);
		assert.match(session.stdout, /toolCallId\ttool_debug_stuck/);
		assert.match(session.stdout, /pibo debug telemetry turn turn_debug_stuck/);
		assert.doesNotMatch(session.stdout, /large provider body/);

		const sessionJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "session", "ps_running", "--json"], { cwd });
		const sessionParsed = JSON.parse(sessionJson.stdout);
		assert.equal(sessionParsed.available, true);
		assert.equal(sessionParsed.detail.activeTurn.turnId, "turn_debug_stuck");
		assert.equal(sessionParsed.detail.providerRequests[0].providerRequestId, "pr_debug_stuck");
		assert.equal(sessionParsed.detail.toolCalls[0].argsBytes, 18);

		const turn = await execFileAsync("node", [cliPath, "debug", "telemetry", "turn", "turn_debug_stuck", "--events"], { cwd });
		assert.match(turn.stdout, /pibo debug telemetry turn turn_debug_stuck/);
		assert.match(turn.stdout, /openPhases\t2/);
		assert.match(turn.stdout, /missingTerminalEvent\ttrue/);
		assert.match(turn.stdout, /provider_stream\topen/);
		assert.match(turn.stdout, /tool_args\topen/);
		assert.match(turn.stdout, /evt_running/);
		assert.match(turn.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.doesNotMatch(turn.stdout, /partial command body/);

		const turnJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "turn", "evt_running", "--json"], { cwd });
		const turnParsed = JSON.parse(turnJson.stdout);
		assert.equal(turnParsed.available, true);
		assert.equal(turnParsed.timeline.turn.turnId, "turn_debug_stuck");
		assert.equal(turnParsed.timeline.phases.some((phase) => phase.name === "tool_args" && phase.status === "open"), true);
		assert.equal(turnParsed.openPhases, 2);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug telemetry inspects provider summaries, event pages, and disabled previews", async () => {
	const cwd = await makeDebugFixture();
	try {
		const provider = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck"], { cwd });
		assert.match(provider.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.match(provider.stdout, /status\tstreaming/);
		assert.match(provider.stdout, /provider\topenai/);
		assert.match(provider.stdout, /upstreamResponseId\tresp_debug_stuck/);
		assert.match(provider.stdout, /rawEventCount\t2/);
		assert.match(provider.stdout, /unknownEventCount\t1/);
		assert.match(provider.stdout, /response\.output_item\.added\t1/);
		assert.match(provider.stdout, /pibo debug telemetry provider pr_debug_stuck events --limit 20/);
		assert.doesNotMatch(provider.stdout, /large provider body/);

		const providerJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "--json"], { cwd });
		const providerParsed = JSON.parse(providerJson.stdout);
		assert.equal(providerParsed.available, true);
		assert.equal(providerParsed.request.providerRequestId, "pr_debug_stuck");
		assert.equal(providerParsed.request.rawEventCount, 2);
		assert.equal(providerParsed.eventTypeRows.some((row) => row.eventType === "provider.experimental.unknown" && row.count === 1), true);

		const events = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "events", "--limit", "1", "--fields", "toolName,itemId,status"], { cwd });
		assert.match(events.stdout, /sequence\trawEventId\treceivedAt\teventType/);
		assert.match(events.stdout, /raw_debug_stuck_1/);
		assert.match(events.stdout, /safeFields/);
		assert.match(events.stdout, /toolName=bash/);
		assert.match(events.stdout, /nextAfterSequence\t1/);
		assert.match(events.stdout, /pibo debug telemetry provider pr_debug_stuck events --after 1 --limit 20/);
		assert.doesNotMatch(events.stdout, /large provider body/);

		const eventsJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "events", "--after", "1", "--json"], { cwd });
		const eventsParsed = JSON.parse(eventsJson.stdout);
		assert.equal(eventsParsed.available, true);
		assert.equal(eventsParsed.page.afterSequence, 1);
		assert.equal(eventsParsed.rows.length, 1);
		assert.equal(eventsParsed.rows[0].eventType, "provider.experimental.unknown");
		assert.equal(eventsParsed.rows[0].selectedSafeFields.status, "ignored");
		assert.equal(eventsParsed.rows[0].safeFields.status, "ignored");

		const payload = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "payload", "raw_debug_stuck_1"], { cwd });
		assert.match(payload.stdout, /status\tdisabled/);
		assert.match(payload.stdout, /preview_capture_disabled/);
		assert.match(payload.stdout, /metadata and links only/);
		assert.doesNotMatch(payload.stdout, /large provider body/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug telemetry inspects tool calls, stale work, stats, and dry-run-first prune", async () => {
	const cwd = await makeDebugFixture();
	try {
		const tool = await execFileAsync("node", [cliPath, "debug", "telemetry", "tool", "tool_debug_stuck"], { cwd });
		assert.match(tool.stdout, /pibo debug telemetry tool tool_debug_stuck/);
		assert.match(tool.stdout, /toolName\tbash/);
		assert.match(tool.stdout, /status\targs_partial/);
		assert.match(tool.stdout, /argsBytes\t18/);
		assert.match(tool.stdout, /parseStatus\tpartial/);
		assert.match(tool.stdout, /noExecutionStart\ttrue/);
		assert.match(tool.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.doesNotMatch(tool.stdout, /sleep 10/);
		assert.doesNotMatch(tool.stdout, /partial command body/);

		const toolJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "tool", "tool_debug_stuck", "--json"], { cwd });
		const toolParsed = JSON.parse(toolJson.stdout);
		assert.equal(toolParsed.available, true);
		assert.equal(toolParsed.tool.toolCallId, "tool_debug_stuck");
		assert.equal(toolParsed.noExecutionStart, true);
		assert.deepEqual(Object.keys(toolParsed.tool).includes("args"), false);

		const stale = await execFileAsync("node", [cliPath, "debug", "telemetry", "stale", "--limit", "5"], { cwd });
		assert.match(stale.stdout, /pibo debug telemetry stale/);
		assert.match(stale.stdout, /ps_running\tturn_debug_stuck/);
		assert.match(stale.stdout, /tool_args/);
		assert.match(stale.stdout, /300000\tdefault/);
		assert.doesNotMatch(stale.stdout, /large provider body/);

		const staleOverride = await execFileAsync("node", [cliPath, "debug", "telemetry", "stale", "--threshold-ms", "1000", "--json"], { cwd });
		const staleOverrideParsed = JSON.parse(staleOverride.stdout);
		assert.equal(staleOverrideParsed.available, true);
		assert.equal(staleOverrideParsed.thresholdOverrideMs, 1000);
		assert.equal(staleOverrideParsed.rows.some((row) => row.thresholdSource === "override" && row.appliedThresholdMs === 1000), true);

		const stats = await execFileAsync("node", [cliPath, "debug", "telemetry", "stats", "--retention", "provider_event", "--json"], { cwd });
		const statsParsed = JSON.parse(stats.stdout);
		assert.equal(statsParsed.available, true);
		assert.equal(statsParsed.retentionClass, "provider_event");
		assert.equal(statsParsed.stats.totalRows, 2);
		assert.equal(statsParsed.stats.totalBytes, 200);

		const dryRun = await execFileAsync("node", [cliPath, "debug", "telemetry", "prune", "--retention", "provider_event", "--before", "2026-05-01T10:04:04.000Z", "--json"], { cwd });
		const dryRunParsed = JSON.parse(dryRun.stdout);
		assert.equal(dryRunParsed.available, true);
		assert.equal(dryRunParsed.dryRun, true);
		assert.equal(dryRunParsed.result.applied, false);
		assert.equal(dryRunParsed.result.rowsMatched, 1);
		assert.equal(dryRunParsed.result.rowsDeleted, 0);

		const apply = await execFileAsync("node", [cliPath, "debug", "telemetry", "prune", "--retention", "provider_event", "--before", "2026-05-01T10:04:04.000Z", "--apply", "--json"], { cwd });
		const applyParsed = JSON.parse(apply.stdout);
		assert.equal(applyParsed.result.applied, true);
		assert.equal(applyParsed.result.rowsDeleted, 1);

		const statsAfter = await execFileAsync("node", [cliPath, "debug", "telemetry", "stats", "--retention", "provider_event", "--json"], { cwd });
		assert.equal(JSON.parse(statsAfter.stdout).stats.totalRows, 1);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug db discovers schema and runs limited read-only SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		const schema = await execFileAsync("node", [cliPath, "debug", "db", "schema", "sessions", "--json"], { cwd });
		const parsed = JSON.parse(schema.stdout);
		assert.equal(parsed.store, "sessions");
		const sessionsTable = parsed.tables.find((table) => table.name === "sessions");
		assert.ok(sessionsTable);
		assert.equal(sessionsTable.columns[0].name, "id");

		const query = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "select id, profile from sessions order by id", "--limit", "2"],
			{ cwd },
		);
		assert.match(query.stdout, /id\tprofile/);
		assert.match(query.stdout, /ps_child\tresearcher/);
		assert.match(query.stdout, /rows: 2 \(limited\)/);

		const cte = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "with rows as (select id from sessions) select id from rows limit 1"],
			{ cwd },
		);
		assert.match(cte.stdout, /ps_/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug db rejects mutating and multi-statement SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "insert into sessions(id) values ('x')"], {
				cwd,
			}),
			(error) => {
				assert.match(error.stderr, /Mutating SQL is not allowed: insert/);
				return true;
			},
		);
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "select 1; select 2"], { cwd }),
			(error) => {
				assert.match(error.stderr, /Only one SQL statement is allowed/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session inspects a Chat URL without event payload dumps", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"session",
				"/apps/chat/rooms/room_one/sessions/ps_parent",
				"--events",
				"--json",
			],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.input.roomId, "room_one");
		assert.equal(parsed.input.piboSessionId, "ps_parent");
		assert.equal(parsed.session.profile, "base");
		assert.equal(parsed.room.matches, true);
		assert.equal(parsed.children[0].id, "ps_child");
		assert.equal(parsed.children[0].subagentName, "researcher");
		assert.equal(parsed.chat.status, "idle");
		assert.deepEqual(Object.keys(parsed.events[0]).sort(), ["created_at", "event_id", "stream_id", "type"]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session warns when a Chat URL room does not match session metadata", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[cliPath, "debug", "session", "/apps/chat/rooms/room_wrong/sessions/ps_parent", "--json"],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.room.matches, false);
		assert.match(parsed.warnings[0], /does not match session metadata chatRoomId/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug trace prints rebuilt Chat Web trace nodes", async () => {
	const cwd = await makeDebugFixture();
	try {
		const trace = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--running-only"], { cwd });
		assert.match(trace.stdout, /status\ttype\ttitle\tid\trunId\tlinkedPiboSessionId/);
		assert.match(trace.stdout, /running\ttool.call\t\s+bash\ttool:tool_1/);
		assert.match(trace.stdout, /nodes: 2/);

		const json = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--json"], { cwd });
		const parsed = JSON.parse(json.stdout);
		assert.equal(parsed.status, "running");
		assert.equal(parsed.nodes.some((node) => node.status === "running" && node.title === "bash"), true);

		const checked = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--check", "--json"], { cwd });
		const checkedParsed = JSON.parse(checked.stdout);
		assert.equal(typeof checkedParsed.checks.status, "string");
		assert.ok(Array.isArray(checkedParsed.checks.issues));
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events extracts selected payload fields", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"events",
				"ps_parent",
				"--type",
				"tool_execution_finished",
				"--fields",
				"toolName,toolCallId,result.details.status",
			],
			{ cwd },
		);
		assert.match(result.stdout, /toolName\ttoolCallId\tresult.details.status/);
		assert.match(result.stdout, /pibo_run_wait\ttool_wait\tcompleted/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug messages, final, and events show drill down without SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		const list = await execFileAsync("node", [cliPath, "debug", "messages", "ps_parent", "list"], { cwd });
		assert.match(list.stdout, /idx\trole\tstream_id\tevent_id\tbytes\ttruncated\tpreview/);
		assert.match(list.stdout, /assistant\t5\tevt_5/);
		assert.match(list.stdout, /pibo debug messages ps_parent show assistant:last --full/);

		const final = await execFileAsync("node", [cliPath, "debug", "final", "ps_parent"], { cwd });
		assert.match(final.stdout, /Content:\nTagesbericht für Hamburg: Grüße, Straße\./);
		assert.match(final.stdout, /Source:/);
		assert.match(final.stdout, /pibo debug events ps_parent show 5 --field attributes_json.inlinePayload.text/);

		const field = await execFileAsync("node", [cliPath, "debug", "events", "ps_parent", "show", "5", "--field", "attributes_json.inlinePayload.text"], { cwd });
		assert.equal(field.stdout.trim(), "Tagesbericht für Hamburg: Grüße, Straße.");

		const json = await execFileAsync("node", [cliPath, "debug", "messages", "ps_parent", "show", "assistant:last", "--json"], { cwd });
		const parsed = JSON.parse(json.stdout);
		assert.equal(parsed.message.role, "assistant");
		assert.equal(parsed.message.streamId, 5);
		assert.equal(parsed.source.path, "attributes_json.inlinePayload.text");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug tool, failures, summary, and trace show expose next drill-down commands", async () => {
	const cwd = await makeDebugFixture();
	try {
		const tool = await execFileAsync("node", [cliPath, "debug", "tool", "ps_parent", "tool_wait"], { cwd });
		assert.match(tool.stdout, /toolCallId: tool_wait/);
		assert.match(tool.stdout, /toolName: pibo_run_wait/);
		assert.match(tool.stdout, /status: completed/);

		const failures = await execFileAsync("node", [cliPath, "debug", "failures", "ps_parent"], { cwd });
		assert.match(failures.stdout, /failures: 0/);
		assert.match(failures.stdout, /pibo debug trace ps_parent --check/);

		const summary = await execFileAsync("node", [cliPath, "debug", "summary", "ps_parent"], { cwd });
		assert.match(summary.stdout, /finalAssistant: available, \d+ bytes, stream_id=5/);
		assert.match(summary.stdout, /pibo debug final ps_parent/);

		const trace = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--medium"], { cwd });
		assert.match(trace.stdout, /toolCallId/);
		assert.match(trace.stdout, /tool_1/);
		const traceJson = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--json"], { cwd });
		const node = JSON.parse(traceJson.stdout).nodes.find((item) => item.toolCallId === "tool_1");
		const shown = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "show", node.id], { cwd });
		assert.match(shown.stdout, new RegExp(`nodeId: ${node.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.match(shown.stdout, /toolCallId: tool_1/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events inspects Pibo event streams and consumers", async () => {
	const cwd = await makeDebugFixture();
	try {
		const stream = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stream", "--topic", "pibo.output", "--after", "1"],
			{ cwd },
		);
		assert.match(stream.stdout, /streamId\ttopic\tkey\teventId\ttype\tcreatedAt\tretentionClass/);
		assert.match(stream.stdout, /pibo.output\tps_parent\tpibo.output:2\tassistant_message/);
		assert.doesNotMatch(stream.stdout, /pibo.output:1/);

		const consumers = await execFileAsync("node", [cliPath, "debug", "events", "consumers"], { cwd });
		assert.match(consumers.stdout, /consumer\ttopic\tlastStreamId\tupdatedAt/);
		assert.match(consumers.stdout, /chat-projector\tpibo.output\t3/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events reports stats and prunes live deltas", async () => {
	const cwd = await makeDebugFixture();
	try {
		const stats = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stats", "--topic", "pibo.output", "--session", "ps_parent", "--retention", "live_delta"],
			{ cwd },
		);
		assert.match(stats.stdout, /topic\tkey\tretentionClass\tcount/);
		assert.match(stats.stdout, /pibo.output\tps_parent\tlive_delta\t2/);

		const prune = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"events",
				"prune",
				"--topic",
				"pibo.output",
				"--retention",
				"live_delta",
				"--before",
				"2026-05-01T10:04:00.000Z",
			],
			{ cwd },
		);
		assert.match(prune.stdout, /deleted/);
		assert.match(prune.stdout, /1/);

		const after = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stats", "--topic", "pibo.output", "--session", "ps_parent", "--retention", "live_delta", "--json"],
			{ cwd },
		);
		const parsed = JSON.parse(after.stdout);
		assert.equal(parsed.counts[0].count, 1);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug jobs lists dead jobs and replays one", async () => {
	const cwd = await makeDebugFixture();
	try {
		const live = await execFileAsync("node", [cliPath, "debug", "jobs", "list", "--queue", "runs"], { cwd });
		assert.match(live.stdout, /jobId\tqueue\tstate\trunAt\tattempts\tworkerId\tlastError/);
		assert.match(live.stdout, /job_live\truns\tpending/);

		const dead = await execFileAsync("node", [cliPath, "debug", "jobs", "dead", "--queue", "runs"], { cwd });
		assert.match(dead.stdout, /job_dead\truns\t1\/1/);

		const replay = await execFileAsync("node", [cliPath, "debug", "jobs", "replay", "job_dead"], { cwd });
		assert.match(replay.stdout, /runs\tpending/);
		assert.doesNotMatch(replay.stdout, /job_dead\truns\tpending/);

		const deadAfterReplay = await execFileAsync("node", [cliPath, "debug", "jobs", "dead", "--queue", "runs"], { cwd });
		assert.doesNotMatch(deadAfterReplay.stdout, /job_dead/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug runs lists and inspects durable runs", async () => {
	const cwd = await makeDebugFixture();
	try {
		const list = await execFileAsync("node", [cliPath, "debug", "runs", "list", "ps_parent"], { cwd });
		assert.match(list.stdout, /runId\tpiboSessionId\tstatus\ttoolName\tpolicy\tconsumed\tupdatedAt\tsummary/);
		assert.match(list.stdout, /run_debug\tps_parent\tcompleted\thelper\ttracked\tfalse/);

		const inspect = await execFileAsync("node", [cliPath, "debug", "runs", "inspect", "run_debug", "--json"], { cwd });
		const parsed = JSON.parse(inspect.stdout);
		assert.equal(parsed.run.runId, "run_debug");
		assert.equal(parsed.run.result.text, "done");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug reports missing stores with the expected path", async () => {
	const cwd = await makeEmptyCwd();
	try {
		await assert.rejects(execFileAsync("node", [cliPath, "debug", "db", "tables", "sessions"], { cwd }), (error) => {
			assert.match(error.stderr, /Debug store "sessions" not found at .*\.pibo\/pibo\.sqlite/);
			return true;
		});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

async function makeEmptyCwd() {
	const cwd = join(tmpdir(), `pibo-debug-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(cwd, { recursive: true });
	return cwd;
}


function makeWatchNode(identity, attributes = {}) {
	return {
		ref: "@fixture",
		identity,
		identityKind: "pibo-session",
		depth: 0,
		tag: "div",
		name: identity.replace(/^session-row:/, ""),
		attributes: { "data-pibo-debug": "session-row", ...attributes },
		classSummary: "session-row",
		path: "html>body>div:nth-of-type(1)",
	};
}

function makeWatchSnapshot(nodes) {
	return {
		kind: "snapshot",
		createdAt: "2026-05-16T00:00:00.000Z",
		url: "file:///fixture.html",
		title: "Fixture",
		scope: "#container",
		rootFound: true,
		root: nodes[0],
		nodes,
		omitted: { nodes: 0, depth: 0, budget: false },
	};
}

function insertSession(db, input) {
	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, owner_scope, room_id, root_session_id, parent_id, origin_id,
			channel, kind, profile, active_model_json, workspace, title, status,
			metadata_json, created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		input.id,
		input.piSessionId,
		input.ownerScope,
		input.roomId ?? null,
		input.rootSessionId ?? input.id,
		input.parentId ?? null,
		null,
		input.channel,
		input.kind,
		input.profile,
		"/workspace",
		input.title,
		input.status,
		JSON.stringify(input.metadata ?? {}),
		input.createdAt,
		input.updatedAt,
		input.lastActivityAt,
	);
	db.prepare(`
		INSERT INTO session_stats (session_id, message_count, tool_call_count, error_count, last_event_stream_id, last_activity_at, status, updated_at)
		VALUES (?, 0, 0, 0, NULL, ?, ?, ?)
	`).run(input.id, input.lastActivityAt, input.status, input.updatedAt);
	db.prepare(`
		INSERT INTO session_navigation (
			owner_scope, room_id, session_id, root_session_id, parent_id, origin_id,
			title, profile, status, last_activity_at, child_count, sort_key, updated_at
		) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?)
	`).run(input.ownerScope, input.roomId ?? null, input.id, input.rootSessionId ?? input.id, input.parentId ?? null, input.title, input.profile, input.status, input.lastActivityAt, input.lastActivityAt, input.updatedAt);
}

function insertEvent(db, input) {
	db.prepare(`
		INSERT INTO event_log (
			stream_id, session_id, session_sequence, room_id, topic, type, source,
			event_id, retention_class, preview_text, attributes_json, created_at
		) VALUES (?, ?, ?, ?, 'pibo.output', ?, 'agent', ?, 'trace_event', ?, ?, ?)
	`).run(
		input.streamId,
		input.sessionId,
		input.sequence,
		input.roomId ?? null,
		input.type,
		input.eventId,
		input.payload?.text ?? null,
		JSON.stringify({ inlinePayload: input.payload }),
		input.createdAt,
	);
}

async function makeDebugFixture() {
	const cwd = await makeEmptyCwd();
	const piboDir = join(cwd, ".pibo");
	await mkdir(piboDir, { recursive: true });
	const data = new PiboDataStore(join(piboDir, "pibo.sqlite"));
	try {
		insertSession(data.db, {
			id: "ps_parent",
			piSessionId: "11111111-1111-4111-8111-111111111111",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:one",
			roomId: "room_one",
			rootSessionId: "ps_parent",
			title: "Parent",
			status: "idle",
			metadata: { chatRoomId: "room_one" },
			createdAt: "2026-05-01T10:00:00.000Z",
			updatedAt: "2026-05-01T10:03:00.000Z",
			lastActivityAt: "2026-05-01T10:03:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_child",
			piSessionId: "22222222-2222-4222-8222-222222222222",
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "researcher",
			ownerScope: "user:one",
			roomId: "room_one",
			rootSessionId: "ps_parent",
			parentId: "ps_parent",
			title: "Child",
			status: "idle",
			metadata: {
				chatRoomId: "room_one",
				subagentName: "researcher",
				subagentToolName: "pibo_subagent_researcher",
				threadKey: "qa",
			},
			createdAt: "2026-05-01T10:01:00.000Z",
			updatedAt: "2026-05-01T10:01:00.000Z",
			lastActivityAt: "2026-05-01T10:01:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_other",
			piSessionId: "33333333-3333-4333-8333-333333333333",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:one",
			rootSessionId: "ps_other",
			title: "Other",
			status: "idle",
			metadata: {},
			createdAt: "2026-05-01T10:02:00.000Z",
			updatedAt: "2026-05-01T10:02:00.000Z",
			lastActivityAt: "2026-05-01T10:02:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_running",
			piSessionId: "44444444-4444-4444-8444-444444444444",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:one",
			rootSessionId: "ps_running",
			title: "Running",
			status: "running",
			metadata: {},
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:03.000Z",
			lastActivityAt: "2026-05-01T10:04:03.000Z",
		});
		insertEvent(data.db, {
			streamId: 1,
			sessionId: "ps_parent",
			sequence: 1,
			roomId: "room_one",
			eventId: "evt_1",
			type: "message_finished",
			createdAt: "2026-05-01T10:03:00.000Z",
			payload: { large: "payload should not be shown" },
		});
		insertEvent(data.db, {
			streamId: 2,
			sessionId: "ps_parent",
			sequence: 2,
			roomId: "room_one",
			eventId: "evt_2",
			type: "tool_execution_finished",
			createdAt: "2026-05-01T10:03:01.000Z",
			payload: {
				type: "tool_execution_finished",
				piboSessionId: "ps_parent",
				eventId: "evt_2",
				toolCallId: "tool_wait",
				toolName: "pibo_run_wait",
				result: { details: { status: "completed" } },
				isError: false,
			},
		});
		insertEvent(data.db, {
			streamId: 5,
			sessionId: "ps_parent",
			sequence: 3,
			roomId: "room_one",
			eventId: "evt_5",
			type: "assistant_message",
			createdAt: "2026-05-01T10:03:02.000Z",
			payload: {
				type: "assistant_message",
				piboSessionId: "ps_parent",
				eventId: "evt_5",
				text: "Tagesbericht für Hamburg: Grüße, Straße.",
			},
		});
		insertEvent(data.db, {
			streamId: 3,
			sessionId: "ps_running",
			sequence: 1,
			eventId: "evt_running",
			type: "message_started",
			createdAt: "2026-05-01T10:04:01.000Z",
			payload: { type: "message_started", piboSessionId: "ps_running", eventId: "evt_running", source: "user", text: "run command" },
		});
		insertEvent(data.db, {
			streamId: 4,
			sessionId: "ps_running",
			sequence: 2,
			eventId: "evt_running",
			type: "tool_execution_started",
			createdAt: "2026-05-01T10:04:02.000Z",
			payload: { type: "tool_execution_started", piboSessionId: "ps_running", eventId: "evt_running", toolCallId: "tool_1", toolName: "bash", args: { cmd: "sleep 10" } },
		});
		data.telemetry.upsertTurn({
			turnId: "turn_parent_done",
			piboSessionId: "ps_parent",
			rootSessionId: "ps_parent",
			roomId: "room_one",
			eventId: "evt_1",
			eventStreamId: 1,
			source: "user",
			status: "ok",
			currentPhase: "finish",
			queuedAt: "2026-05-01T10:02:55.000Z",
			startedAt: "2026-05-01T10:02:56.000Z",
			completedAt: "2026-05-01T10:03:00.000Z",
			lastProgressAt: "2026-05-01T10:03:00.000Z",
			queueDepth: 0,
			summary: "completed fixture turn",
			createdAt: "2026-05-01T10:02:55.000Z",
			updatedAt: "2026-05-01T10:03:00.000Z",
		});
		data.telemetry.upsertTurn({
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			eventId: "evt_running",
			eventStreamId: 3,
			source: "user",
			status: "running",
			currentPhase: "tool_args",
			queuedAt: "2026-05-01T10:04:00.000Z",
			startedAt: "2026-05-01T10:04:01.000Z",
			lastProgressAt: "2026-05-01T10:04:06.000Z",
			queuedBehind: 0,
			queueDepth: 1,
			summary: "partial tool-call fixture without argument body",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
			metadata: { fixture: "debug_cli", omittedBody: true },
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:queued",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "queued",
			status: "ok",
			startedAt: "2026-05-01T10:04:00.000Z",
			endedAt: "2026-05-01T10:04:01.000Z",
			lastProgressAt: "2026-05-01T10:04:01.000Z",
			durationMs: 1000,
			eventId: "evt_running",
			eventStreamId: 3,
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:01.000Z",
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "provider_stream",
			status: "open",
			startedAt: "2026-05-01T10:04:02.000Z",
			lastProgressAt: "2026-05-01T10:04:05.000Z",
			providerRequestId: "pr_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 3,
			counters: { rawEvents: 2, normalizedEvents: 1 },
			summary: "provider stream metadata only; large provider body omitted",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:02.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.upsertProviderRequest({
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			provider: "openai",
			api: "openai-responses",
			model: "gpt-debug",
			transport: "sse",
			status: "streaming",
			startedAt: "2026-05-01T10:04:02.000Z",
			firstByteAt: "2026-05-01T10:04:03.000Z",
			lastRawEventAt: "2026-05-01T10:04:05.000Z",
			lastNormalizedEventAt: "2026-05-01T10:04:05.000Z",
			upstreamResponseId: "resp_debug_stuck",
			captureMode: "metadata_only",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:02.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.appendProviderEventSummary({
			rawEventId: "raw_debug_stuck_1",
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			sequence: 1,
			receivedAt: "2026-05-01T10:04:03.000Z",
			eventType: "response.output_item.added",
			byteSize: 128,
			parseStatus: "ok",
			normalizedType: "tool_call:start",
			itemId: "item_debug_stuck",
			toolCallId: "tool_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 3,
			safeFields: { itemId: "item_debug_stuck", itemType: "function_call", toolName: "bash" },
			retentionClass: "provider_event",
			createdAt: "2026-05-01T10:04:03.000Z",
			updatedAt: "2026-05-01T10:04:03.000Z",
		});
		data.telemetry.appendProviderEventSummary({
			rawEventId: "raw_debug_stuck_2",
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			sequence: 2,
			receivedAt: "2026-05-01T10:04:05.000Z",
			eventType: "provider.experimental.unknown",
			byteSize: 72,
			parseStatus: "unknown_type",
			eventId: "evt_running",
			eventStreamId: 4,
			safeFields: { eventType: "provider.experimental.unknown", sequence: 2, status: "ignored" },
			retentionClass: "provider_event",
			createdAt: "2026-05-01T10:04:05.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:tool_args:tool_debug_stuck",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "tool_args",
			status: "open",
			startedAt: "2026-05-01T10:04:04.000Z",
			lastProgressAt: "2026-05-01T10:04:06.000Z",
			providerRequestId: "pr_debug_stuck",
			toolCallId: "tool_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 4,
			counters: { argsBytes: 18 },
			summary: "partial command body omitted",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:04.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
		});
		data.telemetry.upsertToolCall({
			toolCallId: "tool_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			providerRequestId: "pr_debug_stuck",
			providerItemId: "item_debug_stuck",
			toolName: "bash",
			status: "args_partial",
			argsStartedAt: "2026-05-01T10:04:04.000Z",
			firstDeltaAt: "2026-05-01T10:04:04.000Z",
			lastDeltaAt: "2026-05-01T10:04:06.000Z",
			argsBytes: 18,
			parseStatus: "partial",
			safeArgKeys: [],
			eventId: "evt_running",
			eventStreamId: 4,
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:04.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
		});
	} finally {
		data.close();
	}

	const reliability = new PiboReliabilityStore(join(piboDir, "pibo-events.sqlite"));
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:1",
		retentionClass: "trace_event",
		payload: { type: "message_started", piboSessionId: "ps_parent" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:2",
		retentionClass: "chat_message",
		payload: { type: "assistant_message", piboSessionId: "ps_parent", text: "done" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:3",
		createdAt: "2026-05-01T10:03:00.000Z",
		retentionClass: "live_delta",
		payload: { type: "assistant_delta", piboSessionId: "ps_parent", text: "stream one" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:4",
		createdAt: "2026-05-01T10:03:01.000Z",
		retentionClass: "live_delta",
		payload: { type: "assistant_delta", piboSessionId: "ps_parent", text: "stream two" },
	});
	reliability.saveConsumerOffset("pibo.output", "chat-projector", 3);
	reliability.enqueue({
		jobId: "job_live",
		queue: "runs",
		payload: { runId: "run_live", toolName: "helper" },
		maxAttempts: 1,
	});
	const dead = reliability.enqueue({
		jobId: "job_dead",
		queue: "runs",
		payload: { runId: "run_dead", toolName: "helper" },
		maxAttempts: 1,
	});
	reliability.claimJob(dead.jobId, "worker");
	reliability.fail(dead.jobId, "worker", "failed");
	reliability.createRun({
		runId: "run_debug",
		ownerPiboSessionId: "ps_parent",
		toolName: "helper",
		completionPolicy: "tracked",
	});
	reliability.updateRun("run_debug", {
		status: "completed",
		result: { text: "done" },
		summary: "helper run completed.",
		completedAt: "2026-05-01T10:06:00.000Z",
	});
	reliability.close();
	return cwd;
}
