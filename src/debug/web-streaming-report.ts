import type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkReportRow,
	StreamingBenchmarkSummary,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
} from "./web-streaming-types.js";

type StreamingBenchmarkReportTarget = { id: string; url: string; title: string };

export function formatStreamingBenchmarkAssertionSummary(assertion: StreamingBenchmarkAssertion): string {
	const matchedPatternCount = assertion.expectedRegressionPatterns.length - assertion.missingExpectedRegressionPatterns.length;
	return `expected regressions: passed=${assertion.passed} matched=${matchedPatternCount}/${assertion.expectedRegressionPatterns.length} expected=${assertion.expectedRegressions.length} unexpected=${assertion.unexpectedRegressions.length} missing=${assertion.missingExpectedRegressionPatterns.length}`;
}

export function formatStreamingBenchmarkAssertionError(assertion: StreamingBenchmarkAssertion): string {
	const parts: string[] = [];
	if (assertion.unexpectedRegressions.length > 0) parts.push(`unexpected regressions: ${assertion.unexpectedRegressions.join("; ")}`);
	if (assertion.missingExpectedRegressionPatterns.length > 0) parts.push(`missing expected regressions: ${assertion.missingExpectedRegressionPatterns.join("; ")}`);
	return `streaming benchmark assertions failed: ${parts.join("; ") || "unknown assertion failure"}`;
}


export function summarizeStreamingSelectedLiveEventSource(benchmark: { eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "streams"> }): StreamingBenchmarkEventSourceStreamProbe | undefined {
	const streams = benchmark.eventSource?.streams?.filter((stream) => stream.role === "selected-live") ?? [];
	if (streams.length <= 1) return streams[0];
	return aggregateEventSourceStreams(streams, "selected-live");
}


function aggregateEventSourceStreams(streams: StreamingBenchmarkEventSourceStreamProbe[], role: StreamingBenchmarkEventSourceStreamProbe["role"]): StreamingBenchmarkEventSourceStreamProbe {
	const first = streams[0]!;
	const sum = (key: keyof StreamingBenchmarkEventSourceStreamProbe) => streams.reduce((total, stream) => total + (typeof stream[key] === "number" ? stream[key] as number : 0), 0);
	const min = (key: keyof StreamingBenchmarkEventSourceStreamProbe) => {
		const values = streams.map((stream) => stream[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		return values.length ? Math.min(...values) : undefined;
	};
	return {
		url: first.url,
		mode: first.mode,
		role,
		piboSessionId: first.piboSessionId,
		roomId: first.roomId,
		sinceValues: [...new Set(streams.flatMap((stream) => stream.sinceValues))],
		liveSinceValues: [...new Set(streams.flatMap((stream) => stream.liveSinceValues ?? []))],
		openCountAfterStart: sum("openCountAfterStart"),
		errorCountAfterStart: sum("errorCountAfterStart"),
		closeCountAfterStart: sum("closeCountAfterStart"),
		forcedCloseCountAfterStart: sum("forcedCloseCountAfterStart"),
		eventCount: sum("eventCount"),
		eventCountAfterStart: sum("eventCountAfterStart"),
		textEventCount: sum("textEventCount"),
		textEventCountAfterStart: sum("textEventCountAfterStart"),
		reasoningEventCount: sum("reasoningEventCount"),
		reasoningEventCountAfterStart: sum("reasoningEventCountAfterStart"),
		transientIdCount: sum("transientIdCount"),
		uniqueTransientIdCount: sum("uniqueTransientIdCount"),
		transientIdCountAfterStart: sum("transientIdCountAfterStart"),
		uniqueTransientIdCountAfterStart: sum("uniqueTransientIdCountAfterStart"),
		durableIdCount: sum("durableIdCount"),
		otherIdCount: sum("otherIdCount"),
		liveReplayEventCount: sum("liveReplayEventCount"),
		liveReplayEventCountAfterStart: sum("liveReplayEventCountAfterStart"),
		liveReplayMissedCount: sum("liveReplayMissedCount"),
		liveReplayMissedCountAfterStart: sum("liveReplayMissedCountAfterStart"),
		liveReplayDuplicateCount: sum("liveReplayDuplicateCount"),
		liveReplayDuplicateCountAfterStart: sum("liveReplayDuplicateCountAfterStart"),
		liveReplayEvictedBeforeMax: Math.max(...streams.map((stream) => stream.liveReplayEvictedBeforeMax).filter((value): value is number => typeof value === "number" && Number.isFinite(value)), 0) || undefined,
		liveReplayCursorLagMax: Math.max(...streams.map((stream) => stream.liveReplayCursorLagMax).filter((value): value is number => typeof value === "number" && Number.isFinite(value)), 0) || undefined,
		liveReplayCursorLagMaxAfterStart: Math.max(...streams.map((stream) => stream.liveReplayCursorLagMaxAfterStart).filter((value): value is number => typeof value === "number" && Number.isFinite(value)), 0) || undefined,
		lastEventId: streams.at(-1)?.lastEventId,
		firstEventMsAfterStart: min("firstEventMsAfterStart"),
		firstTextEventMsAfterStart: min("firstTextEventMsAfterStart"),
		firstReasoningEventMsAfterStart: min("firstReasoningEventMsAfterStart"),
	};
}


function selectedLiveStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return summarizeStreamingSelectedLiveEventSource(run);
}

function streamingDebugDeltaNumber(run: StreamingBenchmark, key: string): number | undefined {
	const value = run.debug.delta?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugAfterNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	const value = run.debug.after?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function formatStreamingBenchmarkResult(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, target: StreamingBenchmarkReportTarget): string {
	if (benchmark.kind === "streaming-benchmark-url-comparison") return formatStreamingBenchmarkUrlComparison(benchmark, target);
	return benchmark.kind === "streaming-benchmark-runs" ? formatStreamingBenchmarkGroup(benchmark, target) : formatStreamingBenchmark(benchmark, target);
}

export function formatStreamingBenchmarkCompactReport(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, target: StreamingBenchmarkReportTarget): string {
	if (benchmark.kind === "streaming-benchmark-url-comparison") return formatStreamingBenchmarkCompactUrlComparison(benchmark, target);
	if (benchmark.kind === "streaming-benchmark-runs") return formatStreamingBenchmarkCompactGroup(benchmark, target);
	return formatStreamingBenchmarkCompactRun(benchmark, target);
}

export function streamingBenchmarkReportRows(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, compact: boolean): StreamingBenchmarkReportRow[] {
	if (!compact) return [];
	if (benchmark.kind === "streaming-benchmark-url-comparison") return streamingBenchmarkCompactUrlComparisonRows(benchmark);
	if (benchmark.kind === "streaming-benchmark-runs") return streamingBenchmarkCompactGroupRows(benchmark);
	return streamingBenchmarkCompactRunRows(benchmark);
}

function streamingBenchmarkCompactRunRows(benchmark: StreamingBenchmark): StreamingBenchmarkReportRow[] {
	const selectedLive = selectedLiveStream(benchmark);
	const liveTraceComputeCount = streamingDebugDeltaNumber(benchmark, "liveTraceComputeCount");
	const liveTraceComputeTotalMs = streamingDebugDeltaNumber(benchmark, "liveTraceComputeDurationMsTotal");
	const liveTraceComputeMaxMs = streamingDebugAfterNumber(benchmark, "liveTraceComputeDurationMsMax");
	const markdownRenderCount = streamingDebugDeltaNumber(benchmark, "markdownRenderCount");
	const markdownRenderPlainCount = streamingDebugDeltaNumber(benchmark, "markdownRenderPlainCount");
	const markdownRenderFullCount = streamingDebugDeltaNumber(benchmark, "markdownRenderFullCount");
	const markdownRenderCommonMarkCount = streamingDebugDeltaNumber(benchmark, "markdownRenderCommonMarkCount");
	const markdownRenderGfmCount = streamingDebugDeltaNumber(benchmark, "markdownRenderGfmCount");
	const markdownRenderGfmFastCount = streamingDebugDeltaNumber(benchmark, "markdownRenderGfmFastCount");
	const markdownRenderTotalMs = streamingDebugDeltaNumber(benchmark, "markdownRenderDurationMsTotal");
	const markdownRenderMaxMs = streamingDebugAfterNumber(benchmark, "markdownRenderDurationMsMax");
	return [
		{ section: "compact", metric: "Provider/Pi", preservation: benchmark.provider ? `text ${jsonShort(benchmark.provider.textDeltaCount)}, reasoning ${jsonShort(benchmark.provider.reasoningDeltaCount)}, parseErrors ${jsonShort(benchmark.provider.parseErrorCount)}, unknown ${jsonShort(benchmark.provider.unknownEventCount)}` : "n/a", cadenceLatency: benchmark.provider ? `text gap p90 ${statP90(benchmark.provider.textDeltaGapsMs, "ms")}, first text ${jsonShort(benchmark.provider.firstTextLatencyMs)}ms` : "n/a" },
		{ section: "compact", metric: "Provider ratios", preservation: benchmark.providerPreservation ? `SSE text ${jsonShort(benchmark.providerPreservation.sseTextToProviderRatio)}, selected-live text ${jsonShort(benchmark.providerPreservation.selectedLiveTextToProviderRatio)}, DOM/text ${jsonShort(benchmark.providerPreservation.domPositiveToProviderTextRatio)}` : "n/a", cadenceLatency: benchmark.providerPreservation ? `SSE reasoning ${jsonShort(benchmark.providerPreservation.sseReasoningToProviderRatio)}, selected-live reasoning ${jsonShort(benchmark.providerPreservation.selectedLiveReasoningToProviderRatio)}` : "n/a" },
		{ section: "compact", metric: "SSE transport", preservation: benchmark.sse ? `text ${benchmark.sse.textEventCount}, reasoning ${benchmark.sse.reasoningEventCount}, transient ${benchmark.sse.transientIdCount}` : "n/a", cadenceLatency: benchmark.sse ? `text gap p90 ${statP90(benchmark.sse.textEventGapsMs, "ms")}, text/chunk p90 ${statP90(benchmark.sse.textEventsPerChunk)}, first text ${jsonShort(benchmark.sse.firstTextEventMs)}ms` : "n/a" },
		{ section: "compact", metric: "Cadence lag", preservation: benchmark.cadence ? `fixture schedule p90 ${jsonShort(benchmark.cadence.fixtureScheduleGapP90Ms)}ms` : "n/a", cadenceLatency: benchmark.cadence ? `DOM lag ${jsonShort(benchmark.cadence.domLagOverScheduleP90Ms)}ms, SSE text lag ${jsonShort(benchmark.cadence.sseTextLagOverScheduleP90Ms)}ms` : "n/a" },
		{ section: "compact", metric: "EventSource selected-live", preservation: selectedLive ? `text ${selectedLive.textEventCountAfterStart}, reasoning ${selectedLive.reasoningEventCountAfterStart}, events ${selectedLive.eventCount}` : "n/a", cadenceLatency: selectedLive ? formatSelectedLiveCompactCadence(selectedLive) : "n/a" },
		{ section: "compact", metric: "Live overlay", preservation: benchmark.livePipeline ? `flushed/overlayExpected ${jsonShort(benchmark.livePipeline.flushedEventsToExpectedRatio)}, overlayEvents/inputExpected ${jsonShort(benchmark.livePipeline.overlayEventsToExpectedRatio)}, currentText/expected ${jsonShort(benchmark.livePipeline.currentOutputToExpectedTextBytesRatio)}` : "n/a", cadenceLatency: benchmark.livePipeline ? `first text ${jsonShort(benchmark.livePipeline.firstTextDeltaMs)}ms, first flush ${jsonShort(benchmark.livePipeline.firstFlushMs)}ms, first overlay ${jsonShort(benchmark.livePipeline.firstOverlayUpdateMs)}ms` : "n/a" },
		{ section: "compact", metric: "Live trace compute", preservation: liveTraceComputeCount !== undefined ? `count ${jsonShort(liveTraceComputeCount)}, total ${jsonShort(liveTraceComputeTotalMs)}ms` : "n/a", cadenceLatency: liveTraceComputeMaxMs !== undefined ? `max ${jsonShort(liveTraceComputeMaxMs)}ms` : "n/a" },
		{ section: "compact", metric: "Markdown render", preservation: markdownRenderCount !== undefined ? `count ${jsonShort(markdownRenderCount)}, plain ${jsonShort(markdownRenderPlainCount)}, commonmark ${jsonShort(markdownRenderCommonMarkCount)}, gfm ${jsonShort(markdownRenderGfmCount)}, gfmFast ${jsonShort(markdownRenderGfmFastCount)}, full ${jsonShort(markdownRenderFullCount)}` : "n/a", cadenceLatency: markdownRenderMaxMs !== undefined ? `total ${jsonShort(markdownRenderTotalMs)}ms, max ${jsonShort(markdownRenderMaxMs)}ms` : "n/a" },
		{ section: "compact", metric: "DOM", preservation: `positive ${benchmark.dom.positiveUpdateCount}, max jump ${jsonShort(benchmark.dom.positiveCharJumps.max)} chars`, cadenceLatency: `p90 gap ${statP90(benchmark.dom.gapsMs, "ms")}, first visible ${jsonShort(benchmark.dom.firstPositiveUpdateMs)}ms` },
		{ section: "compact", metric: "Score", preservation: `smoothness ${benchmark.score.smoothness}`, cadenceLatency: `regressions ${benchmark.regressions.length}, warnings ${benchmark.warnings.length}` },
	];
}

function streamingBenchmarkCompactGroupRows(group: StreamingBenchmarkGroup): StreamingBenchmarkReportRow[] {
	return [
		{ section: "compact", metric: "Provider/Pi", preservation: `text ${statP50(group.summary.providerTextDeltaCount)}, reasoning ${statP50(group.summary.providerReasoningDeltaCount)}, parseErrors ${statP50(group.summary.providerParseErrorCount)}`, cadenceLatency: `text gap p90 ${statP50(group.summary.providerTextDeltaGapP90Ms, "ms")}, first text ${statP50(group.summary.providerFirstTextLatencyMs, "ms")}` },
		{ section: "compact", metric: "Provider ratios", preservation: `SSE text ${statP50(group.summary.providerSseTextRatio)}, selected-live text ${statP50(group.summary.providerSelectedLiveTextRatio)}, DOM/text ${statP50(group.summary.providerDomPositiveTextRatio)}`, cadenceLatency: `SSE reasoning ${statP50(group.summary.providerSseReasoningRatio)}, selected-live reasoning ${statP50(group.summary.providerSelectedLiveReasoningRatio)}` },
		{ section: "compact", metric: "SSE transport", preservation: `text ${statP50(group.summary.sseTextEventCount)}, reasoning ${statP50(group.summary.sseReasoningEventCount)}`, cadenceLatency: `text gap p90 ${statP50(group.summary.sseTextEventGapP90Ms, "ms")}, text/chunk p90 ${statP50(group.summary.sseTextEventsPerChunkP90)}, first text ${statP50(group.summary.sseFirstTextEventMs, "ms")}` },
		{ section: "compact", metric: "Cadence lag", preservation: `fixture schedule p90 ${statP50(group.summary.fixtureScheduleGapP90Ms, "ms")}`, cadenceLatency: `DOM lag ${statP50(group.summary.domLagOverFixtureScheduleP90Ms, "ms")}, SSE text lag ${statP50(group.summary.sseTextLagOverFixtureScheduleP90Ms, "ms")}` },
		{ section: "compact", metric: "EventSource selected-live", preservation: `text ${statP50(group.summary.selectedLiveTextEventCountAfterStart)}, reasoning ${statP50(group.summary.selectedLiveReasoningEventCountAfterStart)}, events ${statP50(group.summary.selectedLiveEventCountAfterStart)}`, cadenceLatency: formatSelectedLiveCompactGroupCadence(group.summary) },
		{ section: "compact", metric: "Live overlay", preservation: `flushed/overlayExpected ${statP50(group.summary.liveFlushedEventsToExpectedRatio)}, overlayEvents/inputExpected ${statP50(group.summary.liveOverlayEventsToExpectedRatio)}, currentText/expected ${statP50(group.summary.liveCurrentOutputToExpectedTextBytesRatio)}`, cadenceLatency: `first text ${statP50(group.summary.liveFirstTextDeltaMs, "ms")}, first flush ${statP50(group.summary.liveFirstFlushMs, "ms")}, first overlay ${statP50(group.summary.liveFirstOverlayUpdateMs, "ms")}` },
		{ section: "compact", metric: "Live trace compute", preservation: `count ${statP50(group.summary.debugLiveTraceComputeCount)}, total ${statP50(group.summary.debugLiveTraceComputeDurationTotalMs, "ms")}`, cadenceLatency: `max ${statP50(group.summary.debugLiveTraceComputeDurationMaxMs, "ms")}` },
		{ section: "compact", metric: "Markdown render", preservation: `count ${statP50(group.summary.debugMarkdownRenderCount)}, plain ${statP50(group.summary.debugMarkdownRenderPlainCount)}, commonmark ${statP50(group.summary.debugMarkdownRenderCommonMarkCount)}, gfm ${statP50(group.summary.debugMarkdownRenderGfmCount)}, gfmFast ${statP50(group.summary.debugMarkdownRenderGfmFastCount)}, full ${statP50(group.summary.debugMarkdownRenderFullCount)}`, cadenceLatency: `total ${statP50(group.summary.debugMarkdownRenderDurationTotalMs, "ms")}, max ${statP50(group.summary.debugMarkdownRenderDurationMaxMs, "ms")}` },
		{ section: "compact", metric: "DOM", preservation: `positive ${statP50(group.summary.domPositiveUpdateCount)}, max jump ${statP50(group.summary.domJumpMaxChars, " chars")}`, cadenceLatency: `p90 gap ${statP50(group.summary.domGapP90Ms, "ms")}, first visible ${statP50(group.summary.firstVisibleMs, "ms")}` },
		{ section: "compact", metric: "Score", preservation: `smoothness ${statP50(group.summary.smoothness)}`, cadenceLatency: `regressions ${statP50(group.summary.regressionCount)}, warnings ${group.warnings.length}` },
	];
}

function streamingBenchmarkCompactUrlComparisonRows(comparison: StreamingBenchmarkUrlComparison): StreamingBenchmarkReportRow[] {
	return [
		{ section: "compact-url-comparison", metric: "Smoothness", primaryP50: statP50(comparison.primary.summary.smoothness), compareP50: statP50(comparison.compare.summary.smoothness), delta: signed(comparison.comparison.smoothnessDelta) },
		{ section: "compact-url-comparison", metric: "DOM p90 gap", primaryP50: statP50(comparison.primary.summary.domGapP90Ms, "ms"), compareP50: statP50(comparison.compare.summary.domGapP90Ms, "ms"), delta: signedMs(comparison.comparison.domGapP90DeltaMs) },
		{ section: "compact-url-comparison", metric: "DOM lag vs schedule", primaryP50: statP50(comparison.primary.summary.domLagOverFixtureScheduleP90Ms, "ms"), compareP50: statP50(comparison.compare.summary.domLagOverFixtureScheduleP90Ms, "ms"), delta: signedMs(comparison.comparison.domLagOverFixtureScheduleP90DeltaMs) },
		{ section: "compact-url-comparison", metric: "SSE chunk p90 gap", primaryP50: statP50(comparison.primary.summary.sseChunkGapP90Ms, "ms"), compareP50: statP50(comparison.compare.summary.sseChunkGapP90Ms, "ms"), delta: signedMs(comparison.comparison.sseChunkGapP90DeltaMs) },
		{ section: "compact-url-comparison", metric: "SSE text lag vs schedule", primaryP50: statP50(comparison.primary.summary.sseTextLagOverFixtureScheduleP90Ms, "ms"), compareP50: statP50(comparison.compare.summary.sseTextLagOverFixtureScheduleP90Ms, "ms"), delta: signedMs(comparison.comparison.sseTextLagOverFixtureScheduleP90DeltaMs) },
		{ section: "compact-url-comparison", metric: "SSE text events", primaryP50: statP50(comparison.primary.summary.sseTextEventCount), compareP50: statP50(comparison.compare.summary.sseTextEventCount), delta: signed(comparison.comparison.sseTextEventDelta) },
		{ section: "compact-url-comparison", metric: "Selected-live text", primaryP50: statP50(comparison.primary.summary.selectedLiveTextEventCountAfterStart), compareP50: statP50(comparison.compare.summary.selectedLiveTextEventCountAfterStart), delta: signed(comparison.comparison.selectedLiveTextEventDelta) },
		{ section: "compact-url-comparison", metric: "Selected-live reasoning", primaryP50: statP50(comparison.primary.summary.selectedLiveReasoningEventCountAfterStart), compareP50: statP50(comparison.compare.summary.selectedLiveReasoningEventCountAfterStart), delta: signed(comparison.comparison.selectedLiveReasoningEventDelta) },
		{ section: "compact-url-comparison", metric: "Live flush/enqueue", primaryP50: statP50(comparison.primary.summary.liveFlushToEnqueueRatio), compareP50: statP50(comparison.compare.summary.liveFlushToEnqueueRatio), delta: signed(comparison.comparison.liveFlushToEnqueueRatioDelta) },
		{ section: "compact-url-comparison", metric: "Provider SSE text ratio", primaryP50: statP50(comparison.primary.summary.providerSseTextRatio), compareP50: statP50(comparison.compare.summary.providerSseTextRatio), delta: signed(comparison.comparison.providerSseTextRatioDelta) },
		{ section: "compact-url-comparison", metric: "Provider selected-live text ratio", primaryP50: statP50(comparison.primary.summary.providerSelectedLiveTextRatio), compareP50: statP50(comparison.compare.summary.providerSelectedLiveTextRatio), delta: signed(comparison.comparison.providerSelectedLiveTextRatioDelta) },
		{ section: "compact-url-comparison", metric: "First selected-live text", primaryP50: statP50(comparison.primary.summary.selectedLiveFirstTextEventMsAfterStart, "ms"), compareP50: statP50(comparison.compare.summary.selectedLiveFirstTextEventMsAfterStart, "ms"), delta: signedMs(comparison.comparison.selectedLiveFirstTextEventDeltaMs) },
		{ section: "compact-url-comparison", metric: "First SSE text", primaryP50: statP50(comparison.primary.summary.sseFirstTextEventMs, "ms"), compareP50: statP50(comparison.compare.summary.sseFirstTextEventMs, "ms"), delta: signedMs(comparison.comparison.sseFirstTextEventDeltaMs) },
		{ section: "compact-url-comparison", metric: "First live text", primaryP50: statP50(comparison.primary.summary.liveFirstTextDeltaMs, "ms"), compareP50: statP50(comparison.compare.summary.liveFirstTextDeltaMs, "ms"), delta: signedMs(comparison.comparison.liveFirstTextDeltaDeltaMs) },
		{ section: "compact-url-comparison", metric: "First live enqueue", primaryP50: statP50(comparison.primary.summary.liveFirstEnqueueMs, "ms"), compareP50: statP50(comparison.compare.summary.liveFirstEnqueueMs, "ms"), delta: signedMs(comparison.comparison.liveFirstEnqueueDeltaMs) },
		{ section: "compact-url-comparison", metric: "First live flush", primaryP50: statP50(comparison.primary.summary.liveFirstFlushMs, "ms"), compareP50: statP50(comparison.compare.summary.liveFirstFlushMs, "ms"), delta: signedMs(comparison.comparison.liveFirstFlushDeltaMs) },
		{ section: "compact-url-comparison", metric: "First live overlay", primaryP50: statP50(comparison.primary.summary.liveFirstOverlayUpdateMs, "ms"), compareP50: statP50(comparison.compare.summary.liveFirstOverlayUpdateMs, "ms"), delta: signedMs(comparison.comparison.liveFirstOverlayUpdateDeltaMs) },
		{ section: "compact-url-comparison", metric: "First visible DOM", primaryP50: statP50(comparison.primary.summary.firstVisibleMs, "ms"), compareP50: statP50(comparison.compare.summary.firstVisibleMs, "ms"), delta: signedMs(comparison.comparison.firstVisibleDeltaMs) },
	];
}

function formatStreamingBenchmarkCompactRun(benchmark: StreamingBenchmark, target: StreamingBenchmarkReportTarget): string {
	const selectedLive = selectedLiveStream(benchmark);
	const liveTraceComputeCount = streamingDebugDeltaNumber(benchmark, "liveTraceComputeCount");
	const liveTraceComputeTotalMs = streamingDebugDeltaNumber(benchmark, "liveTraceComputeDurationMsTotal");
	const liveTraceComputeMaxMs = streamingDebugAfterNumber(benchmark, "liveTraceComputeDurationMsMax");
	const markdownRenderCount = streamingDebugDeltaNumber(benchmark, "markdownRenderCount");
	const markdownRenderPlainCount = streamingDebugDeltaNumber(benchmark, "markdownRenderPlainCount");
	const markdownRenderFullCount = streamingDebugDeltaNumber(benchmark, "markdownRenderFullCount");
	const markdownRenderCommonMarkCount = streamingDebugDeltaNumber(benchmark, "markdownRenderCommonMarkCount");
	const markdownRenderGfmCount = streamingDebugDeltaNumber(benchmark, "markdownRenderGfmCount");
	const markdownRenderGfmFastCount = streamingDebugDeltaNumber(benchmark, "markdownRenderGfmFastCount");
	const markdownRenderTotalMs = streamingDebugDeltaNumber(benchmark, "markdownRenderDurationMsTotal");
	const markdownRenderMaxMs = streamingDebugAfterNumber(benchmark, "markdownRenderDurationMsMax");
	const lines = [
		`# Web Streaming Benchmark Compact Report`,
		`Target: ${target.url || benchmark.url}`,
		markdownTable(["Layer", "Preservation", "Cadence / latency"], [
			["Provider/Pi", benchmark.provider ? `text ${jsonShort(benchmark.provider.textDeltaCount)}, reasoning ${jsonShort(benchmark.provider.reasoningDeltaCount)}, parseErrors ${jsonShort(benchmark.provider.parseErrorCount)}, unknown ${jsonShort(benchmark.provider.unknownEventCount)}` : "n/a", benchmark.provider ? `text gap p90 ${statP90(benchmark.provider.textDeltaGapsMs, "ms")}, first text ${jsonShort(benchmark.provider.firstTextLatencyMs)}ms` : "n/a"],
			["Provider ratios", benchmark.providerPreservation ? `SSE text ${jsonShort(benchmark.providerPreservation.sseTextToProviderRatio)}, selected-live text ${jsonShort(benchmark.providerPreservation.selectedLiveTextToProviderRatio)}, DOM/text ${jsonShort(benchmark.providerPreservation.domPositiveToProviderTextRatio)}` : "n/a", benchmark.providerPreservation ? `SSE reasoning ${jsonShort(benchmark.providerPreservation.sseReasoningToProviderRatio)}, selected-live reasoning ${jsonShort(benchmark.providerPreservation.selectedLiveReasoningToProviderRatio)}` : "n/a"],
			["SSE transport", benchmark.sse ? `text ${benchmark.sse.textEventCount}, reasoning ${benchmark.sse.reasoningEventCount}, transient ${benchmark.sse.transientIdCount}` : "n/a", benchmark.sse ? `text gap p90 ${statP90(benchmark.sse.textEventGapsMs, "ms")}, text/chunk p90 ${statP90(benchmark.sse.textEventsPerChunk)}, first text ${jsonShort(benchmark.sse.firstTextEventMs)}ms` : "n/a"],
			["Cadence lag", benchmark.cadence ? `fixture schedule p90 ${jsonShort(benchmark.cadence.fixtureScheduleGapP90Ms)}ms` : "n/a", benchmark.cadence ? `DOM lag ${jsonShort(benchmark.cadence.domLagOverScheduleP90Ms)}ms, SSE text lag ${jsonShort(benchmark.cadence.sseTextLagOverScheduleP90Ms)}ms` : "n/a"],
			["EventSource selected-live", selectedLive ? `text ${selectedLive.textEventCountAfterStart}, reasoning ${selectedLive.reasoningEventCountAfterStart}, events ${selectedLive.eventCount}` : "n/a", selectedLive ? formatSelectedLiveCompactCadence(selectedLive) : "n/a"],
			["Live overlay", benchmark.livePipeline ? `flushed/overlayExpected ${jsonShort(benchmark.livePipeline.flushedEventsToExpectedRatio)}, overlayEvents/inputExpected ${jsonShort(benchmark.livePipeline.overlayEventsToExpectedRatio)}, currentText/expected ${jsonShort(benchmark.livePipeline.currentOutputToExpectedTextBytesRatio)}` : "n/a", benchmark.livePipeline ? `first text ${jsonShort(benchmark.livePipeline.firstTextDeltaMs)}ms, first flush ${jsonShort(benchmark.livePipeline.firstFlushMs)}ms, first overlay ${jsonShort(benchmark.livePipeline.firstOverlayUpdateMs)}ms` : "n/a"],
			["Live trace compute", liveTraceComputeCount !== undefined ? `count ${jsonShort(liveTraceComputeCount)}, total ${jsonShort(liveTraceComputeTotalMs)}ms` : "n/a", liveTraceComputeMaxMs !== undefined ? `max ${jsonShort(liveTraceComputeMaxMs)}ms` : "n/a"],
			["Markdown render", markdownRenderCount !== undefined ? `count ${jsonShort(markdownRenderCount)}, plain ${jsonShort(markdownRenderPlainCount)}, commonmark ${jsonShort(markdownRenderCommonMarkCount)}, gfm ${jsonShort(markdownRenderGfmCount)}, gfmFast ${jsonShort(markdownRenderGfmFastCount)}, full ${jsonShort(markdownRenderFullCount)}` : "n/a", markdownRenderMaxMs !== undefined ? `total ${jsonShort(markdownRenderTotalMs)}ms, max ${jsonShort(markdownRenderMaxMs)}ms` : "n/a"],
			["DOM", `positive ${benchmark.dom.positiveUpdateCount}, max jump ${jsonShort(benchmark.dom.positiveCharJumps.max)} chars`, `p90 gap ${statP90(benchmark.dom.gapsMs, "ms")}, first visible ${jsonShort(benchmark.dom.firstPositiveUpdateMs)}ms`],
			["Score", `smoothness ${benchmark.score.smoothness}`, `regressions ${benchmark.regressions.length}, warnings ${benchmark.warnings.length}`],
		]),
	];
	appendCompactBenchmarkNotes(lines, benchmark.negativeProfile, benchmark.regressions, benchmark.warnings);
	return lines.join("\n");
}

function formatStreamingBenchmarkCompactGroup(group: StreamingBenchmarkGroup, target: StreamingBenchmarkReportTarget): string {
	const lines = [
		`# Web Streaming Benchmark Compact Report`,
		`Target: ${target.url || group.runs[0]?.url || ""}`,
		`Runs: ${group.runs.length} x ${(group.durationMs / 1000).toFixed(1)}s`,
		markdownTable(["Layer", "Median preservation", "Median cadence / latency"], [
			["Provider/Pi", `text ${statP50(group.summary.providerTextDeltaCount)}, reasoning ${statP50(group.summary.providerReasoningDeltaCount)}, parseErrors ${statP50(group.summary.providerParseErrorCount)}`, `text gap p90 ${statP50(group.summary.providerTextDeltaGapP90Ms, "ms")}, first text ${statP50(group.summary.providerFirstTextLatencyMs, "ms")}`],
			["Provider ratios", `SSE text ${statP50(group.summary.providerSseTextRatio)}, selected-live text ${statP50(group.summary.providerSelectedLiveTextRatio)}, DOM/text ${statP50(group.summary.providerDomPositiveTextRatio)}`, `SSE reasoning ${statP50(group.summary.providerSseReasoningRatio)}, selected-live reasoning ${statP50(group.summary.providerSelectedLiveReasoningRatio)}`],
			["SSE transport", `text ${statP50(group.summary.sseTextEventCount)}, reasoning ${statP50(group.summary.sseReasoningEventCount)}`, `text gap p90 ${statP50(group.summary.sseTextEventGapP90Ms, "ms")}, text/chunk p90 ${statP50(group.summary.sseTextEventsPerChunkP90)}, first text ${statP50(group.summary.sseFirstTextEventMs, "ms")}`],
			["Cadence lag", `fixture schedule p90 ${statP50(group.summary.fixtureScheduleGapP90Ms, "ms")}`, `DOM lag ${statP50(group.summary.domLagOverFixtureScheduleP90Ms, "ms")}, SSE text lag ${statP50(group.summary.sseTextLagOverFixtureScheduleP90Ms, "ms")}`],
			["EventSource selected-live", `text ${statP50(group.summary.selectedLiveTextEventCountAfterStart)}, reasoning ${statP50(group.summary.selectedLiveReasoningEventCountAfterStart)}, events ${statP50(group.summary.selectedLiveEventCountAfterStart)}`, formatSelectedLiveCompactGroupCadence(group.summary)],
			["Live overlay", `flushed/overlayExpected ${statP50(group.summary.liveFlushedEventsToExpectedRatio)}, overlayEvents/inputExpected ${statP50(group.summary.liveOverlayEventsToExpectedRatio)}, currentText/expected ${statP50(group.summary.liveCurrentOutputToExpectedTextBytesRatio)}`, `first text ${statP50(group.summary.liveFirstTextDeltaMs, "ms")}, first flush ${statP50(group.summary.liveFirstFlushMs, "ms")}, first overlay ${statP50(group.summary.liveFirstOverlayUpdateMs, "ms")}`],
			["Live trace compute", `count ${statP50(group.summary.debugLiveTraceComputeCount)}, total ${statP50(group.summary.debugLiveTraceComputeDurationTotalMs, "ms")}`, `max ${statP50(group.summary.debugLiveTraceComputeDurationMaxMs, "ms")}`],
			["Markdown render", `count ${statP50(group.summary.debugMarkdownRenderCount)}, plain ${statP50(group.summary.debugMarkdownRenderPlainCount)}, commonmark ${statP50(group.summary.debugMarkdownRenderCommonMarkCount)}, gfm ${statP50(group.summary.debugMarkdownRenderGfmCount)}, gfmFast ${statP50(group.summary.debugMarkdownRenderGfmFastCount)}, full ${statP50(group.summary.debugMarkdownRenderFullCount)}`, `total ${statP50(group.summary.debugMarkdownRenderDurationTotalMs, "ms")}, max ${statP50(group.summary.debugMarkdownRenderDurationMaxMs, "ms")}`],
			["DOM", `positive ${statP50(group.summary.domPositiveUpdateCount)}, max jump ${statP50(group.summary.domJumpMaxChars, " chars")}`, `p90 gap ${statP50(group.summary.domGapP90Ms, "ms")}, first visible ${statP50(group.summary.firstVisibleMs, "ms")}`],
			["Score", `smoothness ${statP50(group.summary.smoothness)}`, `regressions ${statP50(group.summary.regressionCount)}, warnings ${group.warnings.length}`],
		]),
	];
	if (group.comparison) lines.push("", `Comparison vs baseline: smoothness ${signed(group.comparison.smoothnessDelta)}, DOM p90 ${signedMs(group.comparison.domGapP90DeltaMs)}, SSE text ${signed(group.comparison.sseTextEventDelta)}, selected-live text ${signed(group.comparison.selectedLiveTextEventDelta)}`);
	appendCompactBenchmarkNotes(lines, group.negativeProfile, group.regressions, group.warnings);
	return lines.join("\n");
}

function formatStreamingBenchmarkCompactUrlComparison(comparison: StreamingBenchmarkUrlComparison, target: StreamingBenchmarkReportTarget): string {
	const lines = [
		`# Web Streaming Benchmark URL Comparison Compact Report`,
		`Target: ${target.url || comparison.primaryUrl}`,
		`Primary: ${comparison.primaryUrl}`,
		`Compare: ${comparison.compareUrl}`,
		markdownTable(["Metric", "Primary p50", "Compare p50", "Delta"], [
			["Smoothness", statP50(comparison.primary.summary.smoothness), statP50(comparison.compare.summary.smoothness), signed(comparison.comparison.smoothnessDelta)],
			["DOM p90 gap", statP50(comparison.primary.summary.domGapP90Ms, "ms"), statP50(comparison.compare.summary.domGapP90Ms, "ms"), signedMs(comparison.comparison.domGapP90DeltaMs)],
			["DOM lag vs schedule", statP50(comparison.primary.summary.domLagOverFixtureScheduleP90Ms, "ms"), statP50(comparison.compare.summary.domLagOverFixtureScheduleP90Ms, "ms"), signedMs(comparison.comparison.domLagOverFixtureScheduleP90DeltaMs)],
			["SSE chunk p90 gap", statP50(comparison.primary.summary.sseChunkGapP90Ms, "ms"), statP50(comparison.compare.summary.sseChunkGapP90Ms, "ms"), signedMs(comparison.comparison.sseChunkGapP90DeltaMs)],
			["SSE text lag vs schedule", statP50(comparison.primary.summary.sseTextLagOverFixtureScheduleP90Ms, "ms"), statP50(comparison.compare.summary.sseTextLagOverFixtureScheduleP90Ms, "ms"), signedMs(comparison.comparison.sseTextLagOverFixtureScheduleP90DeltaMs)],
			["SSE text events", statP50(comparison.primary.summary.sseTextEventCount), statP50(comparison.compare.summary.sseTextEventCount), signed(comparison.comparison.sseTextEventDelta)],
			["Selected-live text", statP50(comparison.primary.summary.selectedLiveTextEventCountAfterStart), statP50(comparison.compare.summary.selectedLiveTextEventCountAfterStart), signed(comparison.comparison.selectedLiveTextEventDelta)],
			["Selected-live reasoning", statP50(comparison.primary.summary.selectedLiveReasoningEventCountAfterStart), statP50(comparison.compare.summary.selectedLiveReasoningEventCountAfterStart), signed(comparison.comparison.selectedLiveReasoningEventDelta)],
			["Live flush/enqueue", statP50(comparison.primary.summary.liveFlushToEnqueueRatio), statP50(comparison.compare.summary.liveFlushToEnqueueRatio), signed(comparison.comparison.liveFlushToEnqueueRatioDelta)],
			["Provider SSE text ratio", statP50(comparison.primary.summary.providerSseTextRatio), statP50(comparison.compare.summary.providerSseTextRatio), signed(comparison.comparison.providerSseTextRatioDelta)],
			["Provider selected-live text ratio", statP50(comparison.primary.summary.providerSelectedLiveTextRatio), statP50(comparison.compare.summary.providerSelectedLiveTextRatio), signed(comparison.comparison.providerSelectedLiveTextRatioDelta)],
			["First selected-live text", statP50(comparison.primary.summary.selectedLiveFirstTextEventMsAfterStart, "ms"), statP50(comparison.compare.summary.selectedLiveFirstTextEventMsAfterStart, "ms"), signedMs(comparison.comparison.selectedLiveFirstTextEventDeltaMs)],
			["First SSE text", statP50(comparison.primary.summary.sseFirstTextEventMs, "ms"), statP50(comparison.compare.summary.sseFirstTextEventMs, "ms"), signedMs(comparison.comparison.sseFirstTextEventDeltaMs)],
			["First live text", statP50(comparison.primary.summary.liveFirstTextDeltaMs, "ms"), statP50(comparison.compare.summary.liveFirstTextDeltaMs, "ms"), signedMs(comparison.comparison.liveFirstTextDeltaDeltaMs)],
			["First live enqueue", statP50(comparison.primary.summary.liveFirstEnqueueMs, "ms"), statP50(comparison.compare.summary.liveFirstEnqueueMs, "ms"), signedMs(comparison.comparison.liveFirstEnqueueDeltaMs)],
			["First live flush", statP50(comparison.primary.summary.liveFirstFlushMs, "ms"), statP50(comparison.compare.summary.liveFirstFlushMs, "ms"), signedMs(comparison.comparison.liveFirstFlushDeltaMs)],
			["First live overlay", statP50(comparison.primary.summary.liveFirstOverlayUpdateMs, "ms"), statP50(comparison.compare.summary.liveFirstOverlayUpdateMs, "ms"), signedMs(comparison.comparison.liveFirstOverlayUpdateDeltaMs)],
			["First visible DOM", statP50(comparison.primary.summary.firstVisibleMs, "ms"), statP50(comparison.compare.summary.firstVisibleMs, "ms"), signedMs(comparison.comparison.firstVisibleDeltaMs)],
		]),
	];
	appendCompactBenchmarkNotes(lines, comparison.negativeProfile, comparison.regressions, comparison.warnings);
	return lines.join("\n");
}

function appendCompactBenchmarkNotes(lines: string[], negativeProfile: string | undefined, regressions: readonly string[], warnings: readonly string[]): void {
	if (negativeProfile) lines.push("", `Negative profile: ${negativeProfile}`);
	if (regressions.length) lines.push("", "Regressions:", ...regressions.map((regression) => `- ${regression}`));
	if (warnings.length) lines.push("", "Warnings:", ...warnings.map((warning) => `- ${warning}`));
}

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
	return [
		`| ${headers.map(markdownCell).join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
	].join("\n");
}

function markdownCell(value: unknown): string {
	return String(value ?? "n/a").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function statP50(stats: NumberStats, unit = ""): string {
	return stats.count && stats.p50 !== undefined ? `${stats.p50}${unit}` : "n/a";
}

function statP90(stats: NumberStats, unit = ""): string {
	return stats.count && stats.p90 !== undefined ? `${stats.p90}${unit}` : "n/a";
}

function statHasPositive(stats: NumberStats): boolean {
	return typeof stats.max === "number" && stats.max > 0;
}

function formatSelectedLiveCompactCadence(stream: StreamingBenchmarkEventSourceStreamProbe): string {
	const parts = [`first text ${jsonShort(stream.firstTextEventMsAfterStart)}ms`, `transient ${stream.uniqueTransientIdCountAfterStart}/${stream.transientIdCountAfterStart}`];
	if ((stream.liveReplayEventCountAfterStart ?? 0) > 0 || (stream.liveSinceValues?.length ?? 0) > 0) parts.push(`replay ${jsonShort(stream.liveReplayEventCountAfterStart ?? 0)}`, `liveSince ${(stream.liveSinceValues ?? []).length}`);
	if ((stream.liveReplayCursorLagMaxAfterStart ?? 0) > 0) parts.push(`replayLag ${jsonShort(stream.liveReplayCursorLagMaxAfterStart)}`);
	if ((stream.liveReplayDuplicateCountAfterStart ?? 0) > 0) parts.push(`replayDup ${(stream.liveReplayDuplicateCountAfterStart ?? 0)}`);
	if ((stream.liveReplayMissedCountAfterStart ?? 0) > 0) parts.push(`replayMiss ${(stream.liveReplayMissedCountAfterStart ?? 0)}`);
	return parts.join(", ");
}

function formatSelectedLiveCompactGroupCadence(summary: StreamingBenchmarkSummary): string {
	const parts = [`first text ${statP50(summary.selectedLiveFirstTextEventMsAfterStart, "ms")}`, `transient ${statP50(summary.selectedLiveTransientIdCountAfterStart)}`];
	if (statHasPositive(summary.selectedLiveReplayEventCountAfterStart) || statHasPositive(summary.selectedLiveLiveSinceCount)) parts.push(`replay ${statP50(summary.selectedLiveReplayEventCountAfterStart)}`, `liveSince ${statP50(summary.selectedLiveLiveSinceCount)}`);
	if (statHasPositive(summary.selectedLiveReplayCursorLagMaxAfterStart)) parts.push(`replayLag ${statP50(summary.selectedLiveReplayCursorLagMaxAfterStart)}`);
	if (statHasPositive(summary.selectedLiveReplayDuplicateCountAfterStart)) parts.push(`replayDup ${statP50(summary.selectedLiveReplayDuplicateCountAfterStart)}`);
	if (statHasPositive(summary.selectedLiveReplayMissedCountAfterStart)) parts.push(`replayMiss ${statP50(summary.selectedLiveReplayMissedCountAfterStart)}`);
	return parts.join(", ");
}

function formatStreamingBenchmark(benchmark: StreamingBenchmark, target: StreamingBenchmarkReportTarget): string {
	const debugDelta: Record<string, number> = benchmark.debug.delta ?? {};
	const debugAfter: StreamingDebugCounters = benchmark.debug.after ?? {};
	const lines = [
		`# Web Streaming Benchmark, ${(benchmark.durationMs / 1000).toFixed(1)}s`,
		`# target: ${target.id} ${target.url || benchmark.url}`,
		`debug: available=${benchmark.debug.available} reset=${benchmark.debug.reset}`,
		`events: text=${numberField(debugDelta, "textDeltaCount")} (${numberField(debugDelta, "textDeltaBytes")} bytes), reasoning=${numberField(debugDelta, "reasoningDeltaCount")}, enqueue=${numberField(debugDelta, "enqueueCount")}, flush=${numberField(debugDelta, "flushCount")}, overlayUpdates=${numberField(debugDelta, "overlayUpdateCount")}, liveOpen=${numberField(debugDelta, "liveOpenCount")}, liveError=${numberField(debugDelta, "liveErrorCount")}`,
		`markdown: count=${numberField(debugDelta, "markdownRenderCount")} plain=${numberField(debugDelta, "markdownRenderPlainCount")} commonmark=${numberField(debugDelta, "markdownRenderCommonMarkCount")} gfm=${numberField(debugDelta, "markdownRenderGfmCount")} gfmFast=${numberField(debugDelta, "markdownRenderGfmFastCount")} full=${numberField(debugDelta, "markdownRenderFullCount")} total=${jsonShort(numberField(debugDelta, "markdownRenderDurationMsTotal"))}ms max=${jsonShort(debugAfter.markdownRenderDurationMsMax)}ms`,
		`state: overlayEvents=${jsonShort(debugAfter.overlayEventCount)} currentOutput=${jsonShort(debugAfter.currentOutputLength)} traceBase=${jsonShort(debugAfter.traceBaseOutputLength)} durable=${jsonShort(debugAfter.lastDurableCursor)} transient=${jsonShort(debugAfter.lastTransientLiveId)}`,
		`score: smoothness=${benchmark.score.smoothness}, dom/provider updates=${benchmark.score.domPositiveUpdateCount}/${benchmark.score.textDeltaCount}`,
		`dom: targets=${benchmark.dom.targetCountStart}->${benchmark.dom.targetCountEnd}, length=${benchmark.dom.lengthStart}->${benchmark.dom.lengthEnd}, updates=${benchmark.dom.updateCount}, positive=${benchmark.dom.positiveUpdateCount}, firstPositive=${jsonShort(benchmark.dom.firstPositiveUpdateMs)}ms`,
		`dom gaps: ${formatStats(benchmark.dom.gapsMs)}`,
		`dom jumps: ${formatStats(benchmark.dom.positiveCharJumps)} chars`,
		`raf: count=${benchmark.raf.count}, gaps=${formatStats(benchmark.raf.gapsMs)}`,
		`longTasks: count=${benchmark.longTasks.count}, max=${benchmark.longTasks.maxMs}ms, total=${benchmark.longTasks.totalMs}ms`,
	];
	if (benchmark.negativeProfile) lines.push(`negative profile: ${benchmark.negativeProfile}`);
	if (benchmark.fixture) lines.push(`fixture: mode=${benchmark.fixture.mode} profile=${jsonShort(benchmark.fixture.profile)} mix=${jsonShort(benchmark.fixture.mix)} simulation=${jsonShort(benchmark.fixture.simulation)} available=${benchmark.fixture.available} started=${benchmark.fixture.started} deltas=${jsonShort(benchmark.fixture.deltaCount)} reasoningDeltas=${jsonShort(benchmark.fixture.reasoningDeltaCount)} cadence=${jsonShort(benchmark.fixture.cadenceMs)}ms prelude=${jsonShort(benchmark.fixture.preludeMessages)} scheduleGaps=${benchmark.fixture.scheduleGapsMs ? formatStats(benchmark.fixture.scheduleGapsMs) : "count=0"} session=${jsonShort(benchmark.fixture.piboSessionId)}${benchmark.fixture.error ? ` error=${benchmark.fixture.error}` : ""}`);
	if (benchmark.cadence) lines.push(`cadence: scheduleP90=${benchmark.cadence.fixtureScheduleGapP90Ms}ms, domP90=${jsonShort(benchmark.cadence.domGapP90Ms)}ms (lag=${jsonShort(benchmark.cadence.domLagOverScheduleP90Ms)}ms ratio=${jsonShort(benchmark.cadence.domToScheduleP90Ratio)}), sseTextP90=${jsonShort(benchmark.cadence.sseTextGapP90Ms)}ms (lag=${jsonShort(benchmark.cadence.sseTextLagOverScheduleP90Ms)}ms ratio=${jsonShort(benchmark.cadence.sseTextToScheduleP90Ratio)})`);
	if (benchmark.provider) lines.push(`provider: requested=${benchmark.provider.requested} available=${benchmark.provider.available} id=${benchmark.provider.providerRequestId} model=${jsonShort(benchmark.provider.model)} status=${jsonShort(benchmark.provider.status)} text=${benchmark.provider.textDeltaCount} reasoning=${benchmark.provider.reasoningDeltaCount} textBytes=${formatStats(benchmark.provider.textDeltaBytes)} textGaps=${formatStats(benchmark.provider.textDeltaGapsMs)} firstText=${jsonShort(benchmark.provider.firstTextLatencyMs)}ms parseErrors=${jsonShort(benchmark.provider.parseErrorCount)} unknown=${jsonShort(benchmark.provider.unknownEventCount)} pages=${benchmark.provider.eventPageCount} truncated=${benchmark.provider.truncated}${benchmark.provider.error ? ` error=${benchmark.provider.error}` : ""}`);
	if (benchmark.providerPreservation) lines.push(`provider preservation: sseTextRatio=${jsonShort(benchmark.providerPreservation.sseTextToProviderRatio)} selectedLiveTextRatio=${jsonShort(benchmark.providerPreservation.selectedLiveTextToProviderRatio)} domPositiveTextRatio=${jsonShort(benchmark.providerPreservation.domPositiveToProviderTextRatio)} sseReasoningRatio=${jsonShort(benchmark.providerPreservation.sseReasoningToProviderRatio)} selectedLiveReasoningRatio=${jsonShort(benchmark.providerPreservation.selectedLiveReasoningToProviderRatio)}`);
	if (benchmark.livePipeline) lines.push(`live pipeline ratios: source=${benchmark.livePipeline.expectedSource} inputExpected=${benchmark.livePipeline.expectedInputEventCount} overlayExpected=${jsonShort(benchmark.livePipeline.expectedPipelineEventCount)} enqueue/overlayExpected=${jsonShort(benchmark.livePipeline.enqueueToExpectedRatio)} flushed/overlayExpected=${jsonShort(benchmark.livePipeline.flushedEventsToExpectedRatio)} overlayEvents/inputExpected=${jsonShort(benchmark.livePipeline.overlayEventsToExpectedRatio)} currentText=${jsonShort(benchmark.livePipeline.currentOutputToExpectedTextBytesRatio)} flush/enqueue=${jsonShort(benchmark.livePipeline.flushToEnqueueRatio)} overlayUpdates/flushed=${jsonShort(benchmark.livePipeline.overlayUpdatesToFlushedEventsRatio)} firstText=${jsonShort(benchmark.livePipeline.firstTextDeltaMs)}ms firstEnqueue=${jsonShort(benchmark.livePipeline.firstEnqueueMs)}ms firstFlush=${jsonShort(benchmark.livePipeline.firstFlushMs)}ms`);
	if (benchmark.eventSource) {
		lines.push(`eventSource: requested=${benchmark.eventSource.requested} installed=${benchmark.eventSource.installed} forcedClose=${benchmark.eventSource.forcedCloseCountAfterStart} reconnectOpen=${benchmark.eventSource.openCountAfterStart} text=${benchmark.eventSource.textEventCount} afterStart=${benchmark.eventSource.textEventCountAfterStart} firstText=${jsonShort(benchmark.eventSource.firstTextEventMsAfterStart)}ms reasoning=${benchmark.eventSource.reasoningEventCount} reasoningAfterStart=${benchmark.eventSource.reasoningEventCountAfterStart} transient=${benchmark.eventSource.uniqueTransientIdCountAfterStart}/${benchmark.eventSource.transientIdCountAfterStart} reset=${benchmark.eventSource.transientIdResetObserved} droppedText=${benchmark.eventSource.textDropTextEventCount} last=${jsonShort(benchmark.eventSource.lastEventId)} reconnectObserved=${benchmark.eventSource.reconnectObserved}`);
		for (const stream of benchmark.eventSource.streams ?? []) {
			lines.push(`eventSource stream: role=${stream.role} mode=${jsonShort(stream.mode)} session=${jsonShort(stream.piboSessionId)} room=${jsonShort(stream.roomId)} text=${stream.textEventCount} afterStart=${stream.textEventCountAfterStart} firstText=${jsonShort(stream.firstTextEventMsAfterStart)}ms reasoning=${stream.reasoningEventCount} reasoningAfterStart=${stream.reasoningEventCountAfterStart} events=${stream.eventCount} opens=${stream.openCountAfterStart} forcedClose=${stream.forcedCloseCountAfterStart} transient=${stream.uniqueTransientIdCountAfterStart}/${stream.transientIdCountAfterStart} liveReplay=${jsonShort(stream.liveReplayEventCountAfterStart)} liveReplayLag=${jsonShort(stream.liveReplayCursorLagMaxAfterStart)} liveReplayDup=${jsonShort(stream.liveReplayDuplicateCountAfterStart)} liveReplayMiss=${jsonShort(stream.liveReplayMissedCountAfterStart)} liveReplayEvictedBefore=${jsonShort(stream.liveReplayEvictedBeforeMax)} liveSince=${jsonShort((stream.liveSinceValues ?? []).join(","))} since=${jsonShort(stream.sinceValues.join(","))} url=${stream.url}`);
		}
	}
	if (benchmark.sse) lines.push(`sse: requested=${benchmark.sse.requested} installed=${benchmark.sse.installed} status=${jsonShort(benchmark.sse.status)} firstChunk=${jsonShort(benchmark.sse.firstChunkMs)}ms firstText=${jsonShort(benchmark.sse.firstTextEventMs)}ms chunks=${benchmark.sse.chunkCount} chunkBytes=${formatStats(benchmark.sse.chunkBytes)} chunkGaps=${formatStats(benchmark.sse.chunkGapsMs)} textPerChunk=${formatStats(benchmark.sse.textEventsPerChunk)} text=${benchmark.sse.textEventCount} reasoning=${benchmark.sse.reasoningEventCount} textGaps=${formatStats(benchmark.sse.textEventGapsMs)} transient=${benchmark.sse.transientIdCount} durable=${benchmark.sse.durableIdCount} errors=${benchmark.sse.errors.length}`);
	if (benchmark.trace) lines.push(`trace: requested=${benchmark.trace.requested} samples=${benchmark.trace.sampleCount} fetches=${benchmark.trace.fetchCount} failed=${benchmark.trace.failedFetchCount} liveVersions=${benchmark.trace.liveVersionCount} firstLive=${jsonShort(benchmark.trace.firstLiveVersionMs)}ms assistantMax=${benchmark.trace.maxAssistantOutputLength} assistantFinal=${jsonShort(benchmark.trace.finalAssistantOutputLength)} durableEvents=${jsonShort(benchmark.trace.durableEventCountStart)}->${jsonShort(benchmark.trace.durableEventCountEnd)} session=${jsonShort(benchmark.trace.piboSessionId)}`);
	if (benchmark.regressions.length) {
		lines.push("", "Regressions:");
		for (const regression of benchmark.regressions) lines.push(`- ${regression}`);
	}
	if (benchmark.assertion) {
		lines.push("", formatStreamingBenchmarkAssertionSummary(benchmark.assertion));
		for (const pattern of benchmark.assertion.missingExpectedRegressionPatterns) lines.push(`- missing expected: ${pattern}`);
	}
	if (benchmark.warnings.length) {
		lines.push("", "Warnings:");
		for (const warning of benchmark.warnings) lines.push(`- ${warning}`);
	}
	return lines.join("\n");
}

function formatStreamingBenchmarkGroup(group: StreamingBenchmarkGroup, target: StreamingBenchmarkReportTarget): string {
	const lines = [
		`# Web Streaming Benchmark, ${group.runs.length} runs x ${(group.durationMs / 1000).toFixed(1)}s`,
		`# target: ${target.id} ${target.url || group.runs[0]?.url || ""}`,
		`summary: smoothness=${formatStats(group.summary.smoothness)}, regressions=${formatStats(group.summary.regressionCount)}`,
		`events: text=${formatStats(group.summary.textDeltaCount)}, reasoning=${formatStats(group.summary.reasoningDeltaCount)}, domPositive=${formatStats(group.summary.domPositiveUpdateCount)}`,
		`dom gaps p50=${formatStats(group.summary.domGapP50Ms)}, p90=${formatStats(group.summary.domGapP90Ms)}, max=${formatStats(group.summary.domGapMaxMs)}`,
		`dom jumps p90=${formatStats(group.summary.domJumpP90Chars)}, max=${formatStats(group.summary.domJumpMaxChars)} chars`,
		`firstVisible=${formatStats(group.summary.firstVisibleMs)}, longTaskMax=${formatStats(group.summary.longTaskMaxMs)}`,
	];
	if (group.negativeProfile) lines.push(`negative profile: ${group.negativeProfile}`);
	if (group.summary.fixtureScheduleGapP90Ms.count > 0) lines.push(`fixture: scheduleGapP90=${formatStats(group.summary.fixtureScheduleGapP90Ms)}`);
	if (group.summary.domLagOverFixtureScheduleP90Ms.count > 0 || group.summary.sseTextLagOverFixtureScheduleP90Ms.count > 0) lines.push(`cadence lag: domP90-scheduleP90=${formatStats(group.summary.domLagOverFixtureScheduleP90Ms)}ms, sseTextP90-scheduleP90=${formatStats(group.summary.sseTextLagOverFixtureScheduleP90Ms)}ms, domRatio=${formatStats(group.summary.domToFixtureScheduleP90Ratio)}, sseRatio=${formatStats(group.summary.sseTextToFixtureScheduleP90Ratio)}`);
	if (group.summary.debugEnqueueCount.count > 0 || group.summary.debugFlushCount.count > 0 || group.summary.debugOverlayUpdateCount.count > 0) lines.push(`live pipeline: enqueue=${formatStats(group.summary.debugEnqueueCount)}, flush=${formatStats(group.summary.debugFlushCount)}, flushedEvents=${formatStats(group.summary.debugFlushedEventCount)}, overlayUpdates=${formatStats(group.summary.debugOverlayUpdateCount)}, overlayEvents=${formatStats(group.summary.debugOverlayEventCount)}, currentOutput=${formatStats(group.summary.debugCurrentOutputLength)}, traceBase=${formatStats(group.summary.debugTraceBaseOutputLength)}`);
	if (group.summary.debugLiveTraceComputeCount.count > 0) lines.push(`live trace compute: count=${formatStats(group.summary.debugLiveTraceComputeCount)}, total=${formatStats(group.summary.debugLiveTraceComputeDurationTotalMs)}ms, max=${formatStats(group.summary.debugLiveTraceComputeDurationMaxMs)}ms`);
	if (group.summary.debugMarkdownRenderCount.count > 0) lines.push(`markdown render: count=${formatStats(group.summary.debugMarkdownRenderCount)}, plain=${formatStats(group.summary.debugMarkdownRenderPlainCount)}, commonmark=${formatStats(group.summary.debugMarkdownRenderCommonMarkCount)}, gfm=${formatStats(group.summary.debugMarkdownRenderGfmCount)}, gfmFast=${formatStats(group.summary.debugMarkdownRenderGfmFastCount)}, full=${formatStats(group.summary.debugMarkdownRenderFullCount)}, total=${formatStats(group.summary.debugMarkdownRenderDurationTotalMs)}ms, max=${formatStats(group.summary.debugMarkdownRenderDurationMaxMs)}ms`);
	if (group.summary.liveEnqueueToExpectedRatio.count > 0 || group.summary.liveFlushToEnqueueRatio.count > 0) lines.push(`live ratios: inputExpected=${formatStats(group.summary.liveExpectedInputEventCount)}, overlayExpected=${formatStats(group.summary.liveExpectedPipelineEventCount)}, enqueue/overlayExpected=${formatStats(group.summary.liveEnqueueToExpectedRatio)}, flushed/overlayExpected=${formatStats(group.summary.liveFlushedEventsToExpectedRatio)}, overlayEvents/inputExpected=${formatStats(group.summary.liveOverlayEventsToExpectedRatio)}, currentText/expected=${formatStats(group.summary.liveCurrentOutputToExpectedTextBytesRatio)}, flush/enqueue=${formatStats(group.summary.liveFlushToEnqueueRatio)}, overlayUpdates/flushed=${formatStats(group.summary.liveOverlayUpdatesToFlushedEventsRatio)}`);
	if (group.summary.liveFirstTextDeltaMs.count > 0 || group.summary.liveFirstEnqueueMs.count > 0 || group.summary.liveFirstFlushMs.count > 0 || group.summary.sseFirstTextEventMs.count > 0 || group.summary.selectedLiveFirstTextEventMsAfterStart.count > 0 || group.summary.firstVisibleMs.count > 0) lines.push(`first latency: selectedLiveText=${formatStats(group.summary.selectedLiveFirstTextEventMsAfterStart)}ms, sseText=${formatStats(group.summary.sseFirstTextEventMs)}ms, liveText=${formatStats(group.summary.liveFirstTextDeltaMs)}ms, liveEnqueue=${formatStats(group.summary.liveFirstEnqueueMs)}ms, liveFlush=${formatStats(group.summary.liveFirstFlushMs)}ms, firstVisible=${formatStats(group.summary.firstVisibleMs)}ms`);
	if (group.summary.debugTraceRefreshScheduledCount.count > 0 || group.summary.debugTraceRefreshCompletedCount.count > 0 || group.summary.debugTraceRefreshFailedCount.count > 0) lines.push(`trace refresh: scheduled=${formatStats(group.summary.debugTraceRefreshScheduledCount)}, completed=${formatStats(group.summary.debugTraceRefreshCompletedCount)}, failed=${formatStats(group.summary.debugTraceRefreshFailedCount)}, maxDuration=${formatStats(group.summary.debugTraceRefreshDurationMaxMs)}ms`);
	if (group.summary.providerTextDeltaCount.count > 0) lines.push(`provider: text=${formatStats(group.summary.providerTextDeltaCount)}, reasoning=${formatStats(group.summary.providerReasoningDeltaCount)}, textBytesP50=${formatStats(group.summary.providerTextDeltaBytesP50)}, textGapP90=${formatStats(group.summary.providerTextDeltaGapP90Ms)}ms, firstText=${formatStats(group.summary.providerFirstTextLatencyMs)}ms, parseErrors=${formatStats(group.summary.providerParseErrorCount)}, unknown=${formatStats(group.summary.providerUnknownEventCount)}`);
	if (group.summary.providerSseTextRatio.count > 0 || group.summary.providerSelectedLiveTextRatio.count > 0) lines.push(`provider preservation: sseTextRatio=${formatStats(group.summary.providerSseTextRatio)}, selectedLiveTextRatio=${formatStats(group.summary.providerSelectedLiveTextRatio)}, domPositiveTextRatio=${formatStats(group.summary.providerDomPositiveTextRatio)}, sseReasoningRatio=${formatStats(group.summary.providerSseReasoningRatio)}, selectedLiveReasoningRatio=${formatStats(group.summary.providerSelectedLiveReasoningRatio)}`);
	if (group.summary.eventSourceTextEventCountAfterStart.count > 0 || group.summary.eventSourceReasoningEventCountAfterStart.count > 0) lines.push(`eventSource: textAfterStart=${formatStats(group.summary.eventSourceTextEventCountAfterStart)}, reasoningAfterStart=${formatStats(group.summary.eventSourceReasoningEventCountAfterStart)}, forcedClose=${formatStats(group.summary.eventSourceForcedCloseCountAfterStart)}, reconnectOpen=${formatStats(group.summary.eventSourceReconnectOpenCountAfterStart)}, transient=${formatStats(group.summary.eventSourceTransientIdCountAfterStart)}`);
	if (group.summary.sseTextEventCount.count > 0 || group.summary.sseReasoningEventCount.count > 0) lines.push(`sse: text=${formatStats(group.summary.sseTextEventCount)}, reasoning=${formatStats(group.summary.sseReasoningEventCount)}, firstText=${formatStats(group.summary.sseFirstTextEventMs)}ms, chunkBytesP50=${formatStats(group.summary.sseChunkBytesP50)}, chunkGapP90=${formatStats(group.summary.sseChunkGapP90Ms)}, textPerChunkP90=${formatStats(group.summary.sseTextEventsPerChunkP90)}, textGapP90=${formatStats(group.summary.sseTextEventGapP90Ms)}`);
	if (group.summary.selectedLiveEventCountAfterStart.count > 0) lines.push(`selected-live: eventsAfterStart=${formatStats(group.summary.selectedLiveEventCountAfterStart)}, textAfterStart=${formatStats(group.summary.selectedLiveTextEventCountAfterStart)}, reasoningAfterStart=${formatStats(group.summary.selectedLiveReasoningEventCountAfterStart)}, firstText=${formatStats(group.summary.selectedLiveFirstTextEventMsAfterStart)}ms, forcedClose=${formatStats(group.summary.selectedLiveForcedCloseCountAfterStart)}, reconnectOpen=${formatStats(group.summary.selectedLiveReconnectOpenCountAfterStart)}, transient=${formatStats(group.summary.selectedLiveTransientIdCountAfterStart)}, liveReplay=${formatStats(group.summary.selectedLiveReplayEventCountAfterStart)}, liveReplayLag=${formatStats(group.summary.selectedLiveReplayCursorLagMaxAfterStart)}, liveReplayDup=${formatStats(group.summary.selectedLiveReplayDuplicateCountAfterStart)}, liveReplayMiss=${formatStats(group.summary.selectedLiveReplayMissedCountAfterStart)}, liveSince=${formatStats(group.summary.selectedLiveLiveSinceCount)}`);
	if (group.summary.roomSummaryEventCountAfterStart.count > 0) lines.push(`room-summary: eventsAfterStart=${formatStats(group.summary.roomSummaryEventCountAfterStart)}, textAfterStart=${formatStats(group.summary.roomSummaryTextEventCountAfterStart)}, reasoningAfterStart=${formatStats(group.summary.roomSummaryReasoningEventCountAfterStart)}`);
	if (group.summary.traceSampleCount.count > 0) lines.push(`trace: samples=${formatStats(group.summary.traceSampleCount)}, liveVersions=${formatStats(group.summary.traceLiveVersionCount)}, firstLive=${formatStats(group.summary.traceFirstLiveVersionMs)}ms, assistantMax=${formatStats(group.summary.traceMaxAssistantOutputLength)}, assistantFinal=${formatStats(group.summary.traceFinalAssistantOutputLength)}, durableEventDelta=${formatStats(group.summary.traceDurableEventDelta)}`);
	if (group.comparison) {
		let comparison = `comparison vs baseline (${group.comparison.baselineRuns} runs): smoothness ${signed(group.comparison.smoothnessDelta)}, domP90Gap ${signed(group.comparison.domGapP90DeltaMs)}ms, domPositive ${signed(group.comparison.domPositiveUpdateDelta)}, maxJump ${signed(group.comparison.domJumpMaxDeltaChars)} chars, longTaskMax ${signed(group.comparison.longTaskMaxDeltaMs)}ms`;
		if (group.summary.debugEnqueueCount.count > 0 || group.comparison.debugEnqueueCountDelta !== undefined || group.comparison.debugFlushCountDelta !== undefined || group.comparison.debugOverlayUpdateCountDelta !== undefined || group.comparison.debugTraceRefreshCompletedCountDelta !== undefined) comparison += `, enqueue ${signed(group.comparison.debugEnqueueCountDelta)}, flush ${signed(group.comparison.debugFlushCountDelta)}, overlayUpdates ${signed(group.comparison.debugOverlayUpdateCountDelta)}, traceRefreshCompleted ${signed(group.comparison.debugTraceRefreshCompletedCountDelta)}`;
		if (group.summary.liveEnqueueToExpectedRatio.count > 0 || group.comparison.liveEnqueueToExpectedRatioDelta !== undefined || group.comparison.liveFlushToEnqueueRatioDelta !== undefined) comparison += `, enqueue/overlayExpected ${signed(group.comparison.liveEnqueueToExpectedRatioDelta)}, flushed/overlayExpected ${signed(group.comparison.liveFlushedEventsToExpectedRatioDelta)}, overlayEvents/inputExpected ${signed(group.comparison.liveOverlayEventsToExpectedRatioDelta)}, flush/enqueue ${signed(group.comparison.liveFlushToEnqueueRatioDelta)}, overlayUpdates/flushed ${signed(group.comparison.liveOverlayUpdatesToFlushedEventsRatioDelta)}`;
		if (group.summary.traceSampleCount.count > 0 || group.comparison.traceLiveVersionCountDelta !== undefined || group.comparison.traceMaxAssistantOutputDelta !== undefined || group.comparison.traceDurableEventDeltaDelta !== undefined) comparison += `, traceLiveVersions ${signed(group.comparison.traceLiveVersionCountDelta)}, traceAssistantMax ${signed(group.comparison.traceMaxAssistantOutputDelta)}, traceDurableEventDelta ${signed(group.comparison.traceDurableEventDeltaDelta)}`;
		if (group.summary.fixtureScheduleGapP90Ms.count > 0 || group.comparison.fixtureScheduleGapP90DeltaMs !== undefined) comparison += `, fixtureScheduleP90 ${signed(group.comparison.fixtureScheduleGapP90DeltaMs)}ms, domLagVsSchedule ${signed(group.comparison.domLagOverFixtureScheduleP90DeltaMs)}ms, sseTextLagVsSchedule ${signed(group.comparison.sseTextLagOverFixtureScheduleP90DeltaMs)}ms`;
		if (group.summary.eventSourceTextEventCountAfterStart.count > 0 || group.summary.selectedLiveEventCountAfterStart.count > 0 || group.summary.sseTextEventCount.count > 0 || group.comparison.eventSourceTextEventDelta !== undefined || group.comparison.selectedLiveTextEventDelta !== undefined || group.comparison.sseTextEventDelta !== undefined) comparison += `, eventSourceText ${signed(group.comparison.eventSourceTextEventDelta)}, eventSourceReasoning ${signed(group.comparison.eventSourceReasoningEventDelta)}, sseText ${signed(group.comparison.sseTextEventDelta)}, sseP90Gap ${signed(group.comparison.sseChunkGapP90DeltaMs)}ms, selectedLiveEvents ${signed(group.comparison.selectedLiveEventDelta)}, selectedLiveText ${signed(group.comparison.selectedLiveTextEventDelta)}, selectedLiveReasoning ${signed(group.comparison.selectedLiveReasoningEventDelta)}`;
		if (group.summary.providerSseTextRatio.count > 0 || group.comparison.providerSseTextRatioDelta !== undefined || group.comparison.providerSelectedLiveTextRatioDelta !== undefined) comparison += `, providerSseTextRatio ${signed(group.comparison.providerSseTextRatioDelta)}, providerSelectedLiveTextRatio ${signed(group.comparison.providerSelectedLiveTextRatioDelta)}, providerSseReasoningRatio ${signed(group.comparison.providerSseReasoningRatioDelta)}, providerSelectedLiveReasoningRatio ${signed(group.comparison.providerSelectedLiveReasoningRatioDelta)}, providerDomPositiveTextRatio ${signed(group.comparison.providerDomPositiveTextRatioDelta)}`;
		lines.push(comparison);
	}
	if (group.regressions.length) {
		lines.push("", "Regressions:");
		for (const regression of group.regressions) lines.push(`- ${regression}`);
	}
	if (group.assertion) {
		lines.push("", formatStreamingBenchmarkAssertionSummary(group.assertion));
		for (const pattern of group.assertion.missingExpectedRegressionPatterns) lines.push(`- missing expected: ${pattern}`);
	}
	if (group.warnings.length) {
		lines.push("", "Warnings:");
		for (const warning of group.warnings) lines.push(`- ${warning}`);
	}
	return lines.join("\n");
}

export function formatStreamingBenchmarkUrlComparison(comparison: StreamingBenchmarkUrlComparison, target: StreamingBenchmarkReportTarget): string {
	const lines = [
		`# Web Streaming Benchmark URL Comparison, ${comparison.primary.runs.length} runs x ${(comparison.durationMs / 1000).toFixed(1)}s`,
		`# target: ${target.id} ${target.url || comparison.primaryUrl}`,
		`primary: ${comparison.primaryUrl}`,
		`compare: ${comparison.compareUrl}`,
		`primary summary: smoothness=${formatStats(comparison.primary.summary.smoothness)}, domP90=${formatStats(comparison.primary.summary.domGapP90Ms)}, sseTextP90=${formatStats(comparison.primary.summary.sseTextEventGapP90Ms)}, sseLag=${formatStats(comparison.primary.summary.sseTextLagOverFixtureScheduleP90Ms)}ms`,
		`compare summary: smoothness=${formatStats(comparison.compare.summary.smoothness)}, domP90=${formatStats(comparison.compare.summary.domGapP90Ms)}, sseTextP90=${formatStats(comparison.compare.summary.sseTextEventGapP90Ms)}, sseLag=${formatStats(comparison.compare.summary.sseTextLagOverFixtureScheduleP90Ms)}ms`,
		`comparison: smoothness ${signed(comparison.comparison.smoothnessDelta)}, domP90Gap ${signed(comparison.comparison.domGapP90DeltaMs)}ms, domLagVsSchedule ${signed(comparison.comparison.domLagOverFixtureScheduleP90DeltaMs)}ms, sseText ${signed(comparison.comparison.sseTextEventDelta)}, sseP90Gap ${signed(comparison.comparison.sseChunkGapP90DeltaMs)}ms, sseTextLagVsSchedule ${signed(comparison.comparison.sseTextLagOverFixtureScheduleP90DeltaMs)}ms`,
	];
	if (comparison.primary.summary.selectedLiveEventCountAfterStart.count > 0 || comparison.compare.summary.selectedLiveEventCountAfterStart.count > 0) {
		lines.push(
			`primary selected-live: events=${formatStats(comparison.primary.summary.selectedLiveEventCountAfterStart)}, text=${formatStats(comparison.primary.summary.selectedLiveTextEventCountAfterStart)}, reasoning=${formatStats(comparison.primary.summary.selectedLiveReasoningEventCountAfterStart)}, transient=${formatStats(comparison.primary.summary.selectedLiveTransientIdCountAfterStart)}`,
			`compare selected-live: events=${formatStats(comparison.compare.summary.selectedLiveEventCountAfterStart)}, text=${formatStats(comparison.compare.summary.selectedLiveTextEventCountAfterStart)}, reasoning=${formatStats(comparison.compare.summary.selectedLiveReasoningEventCountAfterStart)}, transient=${formatStats(comparison.compare.summary.selectedLiveTransientIdCountAfterStart)}`,
			`comparison selected-live: events ${signed(comparison.comparison.selectedLiveEventDelta)}, text ${signed(comparison.comparison.selectedLiveTextEventDelta)}, reasoning ${signed(comparison.comparison.selectedLiveReasoningEventDelta)}`,
		);
	}
	if (comparison.primary.summary.liveEnqueueToExpectedRatio.count > 0 || comparison.compare.summary.liveEnqueueToExpectedRatio.count > 0 || comparison.primary.summary.liveFlushedEventsToExpectedRatio.count > 0 || comparison.compare.summary.liveFlushedEventsToExpectedRatio.count > 0) {
		lines.push(
			`primary live ratios: inputExpected=${formatStats(comparison.primary.summary.liveExpectedInputEventCount)}, overlayExpected=${formatStats(comparison.primary.summary.liveExpectedPipelineEventCount)}, flushed/overlayExpected=${formatStats(comparison.primary.summary.liveFlushedEventsToExpectedRatio)}, overlayEvents/inputExpected=${formatStats(comparison.primary.summary.liveOverlayEventsToExpectedRatio)}, currentText/expected=${formatStats(comparison.primary.summary.liveCurrentOutputToExpectedTextBytesRatio)}, flush/enqueue=${formatStats(comparison.primary.summary.liveFlushToEnqueueRatio)}, overlayUpdates/flushed=${formatStats(comparison.primary.summary.liveOverlayUpdatesToFlushedEventsRatio)}`,
			`compare live ratios: inputExpected=${formatStats(comparison.compare.summary.liveExpectedInputEventCount)}, overlayExpected=${formatStats(comparison.compare.summary.liveExpectedPipelineEventCount)}, flushed/overlayExpected=${formatStats(comparison.compare.summary.liveFlushedEventsToExpectedRatio)}, overlayEvents/inputExpected=${formatStats(comparison.compare.summary.liveOverlayEventsToExpectedRatio)}, currentText/expected=${formatStats(comparison.compare.summary.liveCurrentOutputToExpectedTextBytesRatio)}, flush/enqueue=${formatStats(comparison.compare.summary.liveFlushToEnqueueRatio)}, overlayUpdates/flushed=${formatStats(comparison.compare.summary.liveOverlayUpdatesToFlushedEventsRatio)}`,
			`comparison live ratios: flushed/overlayExpected ${signed(comparison.comparison.liveFlushedEventsToExpectedRatioDelta)}, overlayEvents/inputExpected ${signed(comparison.comparison.liveOverlayEventsToExpectedRatioDelta)}, flush/enqueue ${signed(comparison.comparison.liveFlushToEnqueueRatioDelta)}, overlayUpdates/flushed ${signed(comparison.comparison.liveOverlayUpdatesToFlushedEventsRatioDelta)}`,
		);
	}
	if (hasFirstLatencySummary(comparison.primary.summary) || hasFirstLatencySummary(comparison.compare.summary)) {
		lines.push(
			`primary first latency: selectedLive=${formatStats(comparison.primary.summary.selectedLiveFirstTextEventMsAfterStart)}ms, sse=${formatStats(comparison.primary.summary.sseFirstTextEventMs)}ms, liveText=${formatStats(comparison.primary.summary.liveFirstTextDeltaMs)}ms, liveEnqueue=${formatStats(comparison.primary.summary.liveFirstEnqueueMs)}ms, liveFlush=${formatStats(comparison.primary.summary.liveFirstFlushMs)}ms, liveOverlay=${formatStats(comparison.primary.summary.liveFirstOverlayUpdateMs)}ms, domVisible=${formatStats(comparison.primary.summary.firstVisibleMs)}ms, provider=${formatStats(comparison.primary.summary.providerFirstTextLatencyMs)}ms`,
			`compare first latency: selectedLive=${formatStats(comparison.compare.summary.selectedLiveFirstTextEventMsAfterStart)}ms, sse=${formatStats(comparison.compare.summary.sseFirstTextEventMs)}ms, liveText=${formatStats(comparison.compare.summary.liveFirstTextDeltaMs)}ms, liveEnqueue=${formatStats(comparison.compare.summary.liveFirstEnqueueMs)}ms, liveFlush=${formatStats(comparison.compare.summary.liveFirstFlushMs)}ms, liveOverlay=${formatStats(comparison.compare.summary.liveFirstOverlayUpdateMs)}ms, domVisible=${formatStats(comparison.compare.summary.firstVisibleMs)}ms, provider=${formatStats(comparison.compare.summary.providerFirstTextLatencyMs)}ms`,
			`comparison first latency: selectedLive ${signedMs(comparison.comparison.selectedLiveFirstTextEventDeltaMs)}, sse ${signedMs(comparison.comparison.sseFirstTextEventDeltaMs)}, liveText ${signedMs(comparison.comparison.liveFirstTextDeltaDeltaMs)}, liveEnqueue ${signedMs(comparison.comparison.liveFirstEnqueueDeltaMs)}, liveFlush ${signedMs(comparison.comparison.liveFirstFlushDeltaMs)}, liveOverlay ${signedMs(comparison.comparison.liveFirstOverlayUpdateDeltaMs)}, domVisible ${signedMs(comparison.comparison.firstVisibleDeltaMs)}, provider ${signedMs(comparison.comparison.providerFirstTextLatencyDeltaMs)}`,
		);
	}
	if (comparison.negativeProfile) lines.push(`negative profile: ${comparison.negativeProfile}`);
	if (comparison.regressions.length) {
		lines.push("", "Regressions:");
		for (const regression of comparison.regressions) lines.push(`- ${regression}`);
	}
	if (comparison.assertion) lines.push("", formatStreamingBenchmarkAssertionSummary(comparison.assertion));
	if (comparison.warnings.length) {
		lines.push("", "Warnings:");
		for (const warning of comparison.warnings) lines.push(`- ${warning}`);
	}
	return lines.join("\n");
}

function hasFirstLatencySummary(summary: StreamingBenchmarkSummary): boolean {
	return summary.selectedLiveFirstTextEventMsAfterStart.count > 0
		|| summary.sseFirstTextEventMs.count > 0
		|| summary.liveFirstTextDeltaMs.count > 0
		|| summary.liveFirstEnqueueMs.count > 0
		|| summary.liveFirstFlushMs.count > 0
		|| summary.liveFirstOverlayUpdateMs.count > 0
		|| summary.firstVisibleMs.count > 0
		|| summary.providerFirstTextLatencyMs.count > 0;
}

function signed(value: number | undefined): string {
	if (value === undefined) return "n/a";
	return value > 0 ? `+${value}` : String(value);
}

function signedMs(value: number | undefined): string {
	return value === undefined ? "n/a" : `${signed(value)}ms`;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatStats(stats: NumberStats): string {
	if (!stats.count) return "count=0";
	return `count=${stats.count}, p50=${stats.p50}, p90=${stats.p90}, p99=${stats.p99}, max=${stats.max}, avg=${stats.avg}`;
}


function jsonShort(value: unknown): string {
	if (value === undefined) return "n/a";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
