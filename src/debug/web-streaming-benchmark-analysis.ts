import { readFile } from "node:fs/promises";
import { summarizeStreamingSelectedLiveEventSource } from "./web-streaming-report.js";
import type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkCadence,
	StreamingBenchmarkComparison,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkLivePipeline,
	StreamingBenchmarkProviderPreservation,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkSseProbe,
	StreamingBenchmarkSummary,
	StreamingBenchmarkTraceProbe,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
	StreamingNegativeProfile,
	StreamingSmoothnessScore,
} from "./web-streaming-types.js";

const LIVE_PIPELINE_MIN_PRESERVATION_RATIO = 0.95;
const LIVE_PIPELINE_MIN_FLUSH_RATIO = 0.75;
const URL_COMPARISON_MAX_SMOOTHNESS_DROP = 15;
const URL_COMPARISON_MAX_DOM_LAG_DELTA_MS = 150;
const URL_COMPARISON_MAX_SSE_LAG_DELTA_MS = 100;
const URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS = 100;
const URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS = 300;
const PROVIDER_MIN_TEXT_PRESERVATION_RATIO = 0.95;
const PROVIDER_MIN_REASONING_PRESERVATION_RATIO = 0.95;

export function scoreStreamingBenchmark(benchmark: Omit<StreamingBenchmark, "score">): StreamingSmoothnessScore {
	const debugDelta = benchmark.debug.delta ?? {};
	const textDeltaCount = numberField(debugDelta, "textDeltaCount");
	const domGapP50Ms = finiteNumber(benchmark.dom.gapsMs.p50);
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const domJumpP90Chars = finiteNumber(benchmark.dom.positiveCharJumps.p90);
	const firstVisibleMs = finiteNumber(benchmark.dom.firstPositiveUpdateMs);
	const providerToDomRatio = textDeltaCount > 0 ? Math.min(1, benchmark.dom.positiveUpdateCount / textDeltaCount) : 0;
	const smoothness =
		0.30 * clampScore(100 - (domGapP50Ms ?? 100))
		+ 0.25 * clampScore(((300 - (domGapP90Ms ?? 300)) / 3))
		+ 0.20 * clampScore(((120 - (domJumpP90Chars ?? 120)) / 1.2))
		+ 0.15 * clampScore(providerToDomRatio * 100)
		+ 0.10 * clampScore(100 - ((firstVisibleMs ?? 500) / 5));
	return {
		smoothness: round3(smoothness),
		domGapP50Ms,
		domGapP90Ms,
		domJumpP90Chars,
		textDeltaCount,
		domPositiveUpdateCount: benchmark.dom.positiveUpdateCount,
		firstVisibleMs,
	};
}

export function summarizeStreamingCadence(benchmark: Pick<StreamingBenchmark, "fixture" | "dom" | "sse">): StreamingBenchmarkCadence | undefined {
	const fixtureScheduleGapP90Ms = finiteNumber(benchmark.fixture?.scheduleGapsMs?.p90);
	if (fixtureScheduleGapP90Ms === undefined) return undefined;
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const sseTextGapP90Ms = finiteNumber(benchmark.sse?.textEventGapsMs.p90);
	return {
		fixtureScheduleGapP90Ms,
		domGapP90Ms,
		sseTextGapP90Ms,
		domLagOverScheduleP90Ms: domGapP90Ms === undefined ? undefined : round3(domGapP90Ms - fixtureScheduleGapP90Ms),
		sseTextLagOverScheduleP90Ms: sseTextGapP90Ms === undefined ? undefined : round3(sseTextGapP90Ms - fixtureScheduleGapP90Ms),
		domToScheduleP90Ratio: domGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(domGapP90Ms / fixtureScheduleGapP90Ms),
		sseTextToScheduleP90Ratio: sseTextGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(sseTextGapP90Ms / fixtureScheduleGapP90Ms),
	};
}

export function summarizeStreamingProviderPreservation(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "streams">; dom?: Pick<StreamingBenchmark["dom"], "positiveUpdateCount"> }): StreamingBenchmarkProviderPreservation | undefined {
	const provider = benchmark.provider;
	if (!provider?.available) return undefined;
	const selectedLive = summarizeStreamingSelectedLiveEventSource(benchmark);
	return {
		providerTextDeltaCount: provider.textDeltaCount,
		providerReasoningDeltaCount: provider.reasoningDeltaCount,
		sseTextEventCount: benchmark.sse?.textEventCount,
		sseReasoningEventCount: benchmark.sse?.reasoningEventCount,
		selectedLiveTextEventCountAfterStart: selectedLive?.textEventCountAfterStart,
		selectedLiveReasoningEventCountAfterStart: selectedLive?.reasoningEventCountAfterStart,
		domPositiveUpdateCount: benchmark.dom?.positiveUpdateCount,
		sseTextToProviderRatio: ratioToProvider(benchmark.sse?.textEventCount, provider.textDeltaCount),
		sseReasoningToProviderRatio: ratioToProvider(benchmark.sse?.reasoningEventCount, provider.reasoningDeltaCount),
		selectedLiveTextToProviderRatio: ratioToProvider(selectedLive?.textEventCountAfterStart, provider.textDeltaCount),
		selectedLiveReasoningToProviderRatio: ratioToProvider(selectedLive?.reasoningEventCountAfterStart, provider.reasoningDeltaCount),
		domPositiveToProviderTextRatio: ratioToProvider(benchmark.dom?.positiveUpdateCount, provider.textDeltaCount),
	};
}

export function summarizeStreamingLivePipeline(benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta" | "stateBeforeReset" | "after">; fixture?: StreamingBenchmark["fixture"]; provider?: StreamingBenchmarkProviderTelemetry }): StreamingBenchmarkLivePipeline | undefined {
	const debugDelta = benchmark.debug?.delta ?? {};
	const debugStateBeforeReset = benchmark.debug?.stateBeforeReset ?? {};
	const debugAfter = benchmark.debug?.after ?? {};
	const fixtureTextCount = finiteNumber(benchmark.fixture?.deltaCount);
	const fixtureReasoningCount = finiteNumber(benchmark.fixture?.reasoningDeltaCount);
	const provider = benchmark.provider?.available ? benchmark.provider : undefined;
	const debugTextCount = finiteNumber(debugDelta.textDeltaCount);
	const debugReasoningCount = finiteNumber(debugDelta.reasoningDeltaCount);
	const expectedSource = fixtureTextCount !== undefined || fixtureReasoningCount !== undefined ? "fixture" : provider ? "provider" : "debug";
	const expectedTextDeltaCount = expectedSource === "fixture" ? (fixtureTextCount ?? 0) : expectedSource === "provider" ? provider?.textDeltaCount ?? 0 : debugTextCount ?? 0;
	const expectedReasoningDeltaCount = expectedSource === "fixture" ? (fixtureReasoningCount ?? 0) : expectedSource === "provider" ? provider?.reasoningDeltaCount ?? 0 : debugReasoningCount ?? 0;
	const expectedInputEventCount = expectedTextDeltaCount + expectedReasoningDeltaCount;
	if (expectedInputEventCount <= 0) return undefined;
	const expectedPipelineEventCount = expectedStreamingPipelineEventCount(benchmark, expectedInputEventCount);
	const enqueueCount = finiteNumber(debugDelta.enqueueCount);
	const flushCount = finiteNumber(debugDelta.flushCount);
	const flushedEventCount = finiteNumber(debugDelta.flushedEventCount);
	const overlayUpdateCount = finiteNumber(debugDelta.overlayUpdateCount);
	const overlayEventCount = stateWindowNumber(debugAfter.overlayEventCount, debugStateBeforeReset.overlayEventCount);
	const currentOutputLength = stateWindowNumber(debugAfter.currentOutputLength, debugStateBeforeReset.currentOutputLength);
	const expectedTextBytes = finiteNumber(benchmark.fixture?.textBytes);
	const debugStartedAt = typeof debugAfter.startedAt === "string" ? debugAfter.startedAt : undefined;
	return {
		expectedSource,
		expectedTextDeltaCount,
		expectedReasoningDeltaCount,
		expectedInputEventCount,
		expectedPipelineEventCount,
		enqueueCount,
		flushCount,
		flushedEventCount,
		overlayUpdateCount,
		overlayEventCount,
		currentOutputLength,
		expectedTextBytes,
		enqueueToExpectedRatio: ratioToProvider(enqueueCount, expectedPipelineEventCount),
		flushedEventsToExpectedRatio: ratioToProvider(flushedEventCount, expectedPipelineEventCount),
		overlayEventsToExpectedRatio: ratioToProvider(overlayEventCount, expectedInputEventCount),
		currentOutputToExpectedTextBytesRatio: ratioToProvider(currentOutputLength, expectedTextBytes),
		flushToEnqueueRatio: ratioToProvider(flushCount, enqueueCount),
		overlayUpdatesToFlushedEventsRatio: ratioToProvider(overlayUpdateCount, flushedEventCount),
		firstEventMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEventAt),
		firstTextDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstTextDeltaAt),
		firstReasoningDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstReasoningDeltaAt),
		firstEnqueueMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEnqueueAt),
		firstFlushMs: elapsedIsoMs(debugStartedAt, debugAfter.firstFlushAt),
		firstOverlayUpdateMs: elapsedIsoMs(debugStartedAt, debugAfter.firstOverlayUpdateAt),
	};
}


export function attachStreamingProviderTelemetryToBenchmark(benchmark: StreamingBenchmark, providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark {
	if (!providerTelemetry) return benchmark;
	const baseRegressions = benchmark.regressions.filter((regression) => !regression.startsWith("provider ") && !regression.startsWith("live pipeline "));
	const withProvider = { ...benchmark, provider: providerTelemetry };
	const providerPreservation = summarizeStreamingProviderPreservation(withProvider);
	const withProviderMetrics = { ...withProvider, providerPreservation, livePipeline: summarizeStreamingLivePipeline(withProvider) };
	return {
		...withProviderMetrics,
		regressions: [...baseRegressions, ...evaluateStreamingLivePipelineRegressions(withProviderMetrics), ...evaluateStreamingProviderRegressions(withProviderMetrics)],
	};
}

export function attachStreamingProviderTelemetryToBenchmarks(benchmarks: StreamingBenchmark[], providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark[] {
	return providerTelemetry ? benchmarks.map((benchmark) => attachStreamingProviderTelemetryToBenchmark(benchmark, providerTelemetry)) : benchmarks;
}
function expectedStreamingPipelineEventCount(_benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta">; fixture?: StreamingBenchmark["fixture"] }, fallbackInputEventCount: number): number {
	return fallbackInputEventCount;
}

export function evaluateStreamingLivePipelineRegressions(benchmark: { livePipeline?: StreamingBenchmarkLivePipeline; fixture?: StreamingBenchmark["fixture"] }): string[] {
	const pipeline = benchmark.livePipeline;
	if (!pipeline || pipeline.expectedSource === "debug" || pipeline.expectedInputEventCount <= 0 || benchmark.fixture?.simulation === "trace-catchup") return [];
	const hasLiveCounters = [pipeline.enqueueCount, pipeline.flushCount, pipeline.flushedEventCount, pipeline.overlayUpdateCount, pipeline.overlayEventCount].some((value) => value !== undefined);
	if (!hasLiveCounters) return [];
	const regressions: string[] = [];
	pushMinimumRatioRegression(regressions, pipeline.flushedEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline flushed events/overlay expected ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline overlay events/input expected ratio");
	if (pipeline.expectedTextDeltaCount > 0 && pipeline.expectedTextBytes !== undefined) {
		pushMinimumRatioRegression(regressions, pipeline.currentOutputToExpectedTextBytesRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline current text/expected bytes ratio");
	}
	pushMinimumRatioRegression(regressions, pipeline.flushToEnqueueRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline flush/enqueue ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayUpdatesToFlushedEventsRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline overlay updates/flushed ratio");
	return regressions;
}

export function evaluateStreamingProviderRegressions(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; providerPreservation?: StreamingBenchmarkProviderPreservation; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "requested"> }): string[] {
	const provider = benchmark.provider;
	if (!provider?.available) return [];
	const regressions: string[] = [];
	if ((provider.parseErrorCount ?? 0) > 0) regressions.push(`provider parse errors ${provider.parseErrorCount} > 0`);
	if ((provider.unknownEventCount ?? 0) > 0) regressions.push(`provider unknown events ${provider.unknownEventCount} > 0`);
	if (provider.truncated) regressions.push("provider telemetry events were truncated");
	const preservation = benchmark.providerPreservation;
	if (provider.textDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider SSE text preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider selected-live text preservation ratio");
	}
	if (provider.reasoningDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider SSE reasoning preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider selected-live reasoning preservation ratio");
	}
	return regressions;
}

function pushProviderRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	pushMinimumRatioRegression(regressions, ratio, minimum, label);
}

function pushMinimumRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	if (ratio === undefined) regressions.push(`${label} unavailable`);
	else if (ratio < minimum) regressions.push(`${label} ${ratio} < ${minimum}`);
}

function ratioToProvider(numerator: number | undefined, denominator: number | undefined): number | undefined {
	if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
	return round3(numerator / denominator);
}

function commonStreamingNegativeProfile(runs: readonly StreamingBenchmark[]): StreamingNegativeProfile | undefined {
	const profile = runs[0]?.negativeProfile;
	return profile && runs.every((run) => run.negativeProfile === profile) ? profile : undefined;
}

export function summarizeStreamingBenchmarkGroup(runs: StreamingBenchmark[], baselineRuns?: StreamingBenchmark[]): StreamingBenchmarkGroup {
	const summary = summarizeStreamingBenchmarks(runs);
	return {
		kind: "streaming-benchmark-runs",
		createdAt: new Date().toISOString(),
		durationMs: runs[0]?.durationMs ?? 0,
		runs,
		negativeProfile: commonStreamingNegativeProfile(runs),
		summary,
		comparison: baselineRuns?.length ? compareStreamingBenchmarkSummaries(summarizeStreamingBenchmarks(baselineRuns), summary) : undefined,
		regressions: runs.flatMap((run, index) => run.regressions.map((regression) => `run ${index + 1}: ${regression}`)),
		warnings: runs.flatMap((run, index) => run.warnings.map((warning) => `run ${index + 1}: ${warning}`)),
	};
}

export function summarizeStreamingBenchmarkUrlComparison(primaryUrl: string, compareUrl: string, primary: StreamingBenchmarkGroup, compare: StreamingBenchmarkGroup): StreamingBenchmarkUrlComparison {
	const summaryComparison = compareStreamingBenchmarkSummaries(primary.summary, compare.summary);
	const negativeProfile = primary.negativeProfile && primary.negativeProfile === compare.negativeProfile ? primary.negativeProfile : undefined;
	return {
		kind: "streaming-benchmark-url-comparison",
		createdAt: new Date().toISOString(),
		durationMs: primary.durationMs,
		primaryUrl,
		compareUrl,
		primary,
		compare,
		negativeProfile,
		comparison: summaryComparison,
		regressions: [
			...primary.regressions.map((regression) => `primary: ${regression}`),
			...compare.regressions.map((regression) => `compare: ${regression}`),
			...evaluateStreamingBenchmarkUrlComparisonRegressions(summaryComparison).map((regression) => `comparison: ${regression}`),
		],
		warnings: [
			...primary.warnings.map((warning) => `primary: ${warning}`),
			...compare.warnings.map((warning) => `compare: ${warning}`),
		],
	};
}

export function evaluateStreamingBenchmarkUrlComparisonRegressions(comparison: StreamingBenchmarkComparison): string[] {
	const regressions: string[] = [];
	if (comparison.smoothnessDelta !== undefined && comparison.smoothnessDelta < -URL_COMPARISON_MAX_SMOOTHNESS_DROP) {
		regressions.push(`compare smoothness delta ${comparison.smoothnessDelta} below -${URL_COMPARISON_MAX_SMOOTHNESS_DROP}`);
	}
	if (comparison.domLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.domLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_DOM_LAG_DELTA_MS) {
		regressions.push(`compare DOM lag over schedule delta ${comparison.domLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_DOM_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseTextLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.sseTextLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_SSE_LAG_DELTA_MS) {
		regressions.push(`compare SSE text lag over schedule delta ${comparison.sseTextLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseChunkGapP90DeltaMs !== undefined && comparison.sseChunkGapP90DeltaMs > URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS) {
		regressions.push(`compare SSE chunk p90 gap delta ${comparison.sseChunkGapP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS}ms`);
	}
	if (comparison.selectedLiveFirstTextEventDeltaMs !== undefined && comparison.selectedLiveFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare selected-live first text latency delta ${comparison.selectedLiveFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseFirstTextEventDeltaMs !== undefined && comparison.sseFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare SSE first text latency delta ${comparison.sseFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstTextDeltaDeltaMs !== undefined && comparison.liveFirstTextDeltaDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first text latency delta ${comparison.liveFirstTextDeltaDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstEnqueueDeltaMs !== undefined && comparison.liveFirstEnqueueDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first enqueue latency delta ${comparison.liveFirstEnqueueDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstFlushDeltaMs !== undefined && comparison.liveFirstFlushDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first flush latency delta ${comparison.liveFirstFlushDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstOverlayUpdateDeltaMs !== undefined && comparison.liveFirstOverlayUpdateDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first overlay latency delta ${comparison.liveFirstOverlayUpdateDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.firstVisibleDeltaMs !== undefined && comparison.firstVisibleDeltaMs > URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS) {
		regressions.push(`compare DOM first visible latency delta ${comparison.firstVisibleDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseTextEventDelta !== undefined && comparison.sseTextEventDelta < 0) regressions.push(`compare SSE text events delta ${comparison.sseTextEventDelta} below 0`);
	if (comparison.selectedLiveTextEventDelta !== undefined && comparison.selectedLiveTextEventDelta < 0) regressions.push(`compare selected-live text events delta ${comparison.selectedLiveTextEventDelta} below 0`);
	if (comparison.selectedLiveReasoningEventDelta !== undefined && comparison.selectedLiveReasoningEventDelta < 0) regressions.push(`compare selected-live reasoning events delta ${comparison.selectedLiveReasoningEventDelta} below 0`);
	return regressions;
}

export function applyExpectedStreamingRegressions(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const assertion = evaluateStreamingBenchmarkAssertion(benchmark.regressions, expectedPatterns);
	if (expectedPatterns.length > 0) benchmark.assertion = assertion;
	return assertion;
}

export function evaluateStreamingBenchmarkAssertion(regressions: readonly string[], expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const expectedRegressionPatterns = expectedPatterns.filter((pattern) => pattern.length > 0);
	const expectedRegressions: string[] = [];
	const unexpectedRegressions: string[] = [];
	const matchedPatterns = new Set<string>();
	for (const regression of regressions) {
		const matches = expectedRegressionPatterns.filter((pattern) => regression.includes(pattern));
		if (matches.length > 0) {
			expectedRegressions.push(regression);
			for (const pattern of matches) matchedPatterns.add(pattern);
		} else {
			unexpectedRegressions.push(regression);
		}
	}
	const missingExpectedRegressionPatterns = expectedRegressionPatterns.filter((pattern) => !matchedPatterns.has(pattern));
	return {
		expectedRegressionPatterns,
		expectedRegressions,
		unexpectedRegressions,
		missingExpectedRegressionPatterns,
		passed: unexpectedRegressions.length === 0 && missingExpectedRegressionPatterns.length === 0,
	};
}

export function summarizeStreamingBenchmarks(runs: StreamingBenchmark[]): StreamingBenchmarkSummary {
	return {
		runs: runs.length,
		smoothness: numericStats(runs.map((run) => run.score.smoothness)),
		textDeltaCount: numericStats(runs.map((run) => run.score.textDeltaCount)),
		reasoningDeltaCount: numericStats(runs.map((run) => numberField(run.debug.delta ?? {}, "reasoningDeltaCount"))),
		domPositiveUpdateCount: numericStats(runs.map((run) => run.score.domPositiveUpdateCount)),
		domGapP50Ms: numericStats(runs.map((run) => run.dom.gapsMs.p50)),
		domGapP90Ms: numericStats(runs.map((run) => run.dom.gapsMs.p90)),
		domGapMaxMs: numericStats(runs.map((run) => run.dom.gapsMs.max)),
		domJumpP90Chars: numericStats(runs.map((run) => run.dom.positiveCharJumps.p90)),
		domJumpMaxChars: numericStats(runs.map((run) => run.dom.positiveCharJumps.max)),
		firstVisibleMs: numericStats(runs.map((run) => run.dom.firstPositiveUpdateMs)),
		longTaskMaxMs: numericStats(runs.map((run) => run.longTasks.maxMs)),
		regressionCount: numericStats(runs.map((run) => run.regressions.length)),
		debugEnqueueCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "enqueueCount"))),
		debugFlushCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushCount"))),
		debugFlushedEventCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushedEventCount"))),
		debugOverlayUpdateCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "overlayUpdateCount"))),
		debugOverlayEventCount: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "overlayEventCount"))),
		debugLiveTraceComputeCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeCount"))),
		debugLiveTraceComputeDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeDurationMsTotal"))),
		debugLiveTraceComputeDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "liveTraceComputeDurationMsMax"))),
		debugMarkdownRenderCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCount"))),
		debugMarkdownRenderPlainCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderPlainCount"))),
		debugMarkdownRenderFullCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderFullCount"))),
		debugMarkdownRenderCommonMarkCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCommonMarkCount"))),
		debugMarkdownRenderGfmCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmCount"))),
		debugMarkdownRenderGfmFastCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmFastCount"))),
		debugMarkdownRenderDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderDurationMsTotal"))),
		debugMarkdownRenderDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderDurationMsMax"))),
		debugMarkdownRenderPlainDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderPlainDurationMsMax"))),
		debugMarkdownRenderFullDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderFullDurationMsMax"))),
		debugMarkdownRenderCommonMarkDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderCommonMarkDurationMsMax"))),
		debugMarkdownRenderGfmDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmDurationMsMax"))),
		debugMarkdownRenderGfmFastDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmFastDurationMsMax"))),
		debugTraceRefreshScheduledCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshScheduledCount"))),
		debugTraceRefreshCompletedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshCompletedCount"))),
		debugTraceRefreshFailedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshFailedCount"))),
		debugTraceRefreshDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceRefreshDurationMsMax"))),
		debugCurrentOutputLength: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "currentOutputLength"))),
		debugTraceBaseOutputLength: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceBaseOutputLength"))),
		liveExpectedInputEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedInputEventCount)),
		liveExpectedPipelineEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedPipelineEventCount)),
		liveEnqueueToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.enqueueToExpectedRatio)),
		liveFlushedEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushedEventsToExpectedRatio)),
		liveOverlayEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayEventsToExpectedRatio)),
		liveCurrentOutputToExpectedTextBytesRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.currentOutputToExpectedTextBytesRatio)),
		liveFlushToEnqueueRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushToEnqueueRatio)),
		liveOverlayUpdatesToFlushedEventsRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayUpdatesToFlushedEventsRatio)),
		liveFirstEventMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEventMs)),
		liveFirstTextDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstTextDeltaMs)),
		liveFirstReasoningDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstReasoningDeltaMs)),
		liveFirstEnqueueMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEnqueueMs)),
		liveFirstFlushMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstFlushMs)),
		liveFirstOverlayUpdateMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstOverlayUpdateMs)),
		traceSampleCount: numericStats(runs.map((run) => run.trace?.sampleCount)),
		traceLiveVersionCount: numericStats(runs.map((run) => run.trace?.liveVersionCount)),
		traceFirstLiveVersionMs: numericStats(runs.map((run) => run.trace?.firstLiveVersionMs)),
		traceMaxAssistantOutputLength: numericStats(runs.map((run) => run.trace?.maxAssistantOutputLength)),
		traceFinalAssistantOutputLength: numericStats(runs.map((run) => run.trace?.finalAssistantOutputLength)),
		traceDurableEventDelta: numericStats(runs.map((run) => traceDurableEventDelta(run.trace))),
		fixtureScheduleGapP90Ms: numericStats(runs.map((run) => run.fixture?.scheduleGapsMs?.p90)),
		domLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.domLagOverScheduleP90Ms)),
		sseTextLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.sseTextLagOverScheduleP90Ms)),
		domToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.domToScheduleP90Ratio)),
		sseTextToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.sseTextToScheduleP90Ratio)),
		eventSourceTextEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.textEventCountAfterStart)),
		eventSourceReasoningEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.reasoningEventCountAfterStart)),
		eventSourceForcedCloseCountAfterStart: numericStats(runs.map((run) => run.eventSource?.forcedCloseCountAfterStart)),
		eventSourceReconnectOpenCountAfterStart: numericStats(runs.map((run) => run.eventSource?.openCountAfterStart)),
		eventSourceTransientIdCountAfterStart: numericStats(runs.map((run) => run.eventSource?.transientIdCountAfterStart)),
		sseTextEventCount: numericStats(runs.map((run) => run.sse?.textEventCount)),
		sseReasoningEventCount: numericStats(runs.map((run) => run.sse?.reasoningEventCount)),
		sseChunkBytesP50: numericStats(runs.map((run) => run.sse?.chunkBytes.p50)),
		sseChunkGapP90Ms: numericStats(runs.map((run) => run.sse?.chunkGapsMs.p90)),
		sseTextEventsPerChunkP90: numericStats(runs.map((run) => run.sse?.textEventsPerChunk.p90)),
		sseTextEventGapP90Ms: numericStats(runs.map((run) => run.sse?.textEventGapsMs.p90)),
		sseFirstTextEventMs: numericStats(runs.map((run) => run.sse?.firstTextEventMs)),
		selectedLiveTextEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.textEventCountAfterStart)),
		selectedLiveReasoningEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.reasoningEventCountAfterStart)),
		selectedLiveEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.eventCountAfterStart)),
		selectedLiveForcedCloseCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.forcedCloseCountAfterStart)),
		selectedLiveReconnectOpenCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.openCountAfterStart)),
		selectedLiveTransientIdCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.transientIdCountAfterStart)),
		selectedLiveLiveSinceCount: numericStats(runs.map((run) => selectedLiveStream(run)?.liveSinceValues?.length)),
		selectedLiveReplayEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayEventCountAfterStart)),
		selectedLiveReplayCursorLagMaxAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayCursorLagMaxAfterStart)),
		selectedLiveReplayDuplicateCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayDuplicateCountAfterStart)),
		selectedLiveReplayMissedCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayMissedCountAfterStart)),
		selectedLiveFirstTextEventMsAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.firstTextEventMsAfterStart)),
		roomSummaryEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.eventCountAfterStart)),
		roomSummaryTextEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.textEventCountAfterStart)),
		roomSummaryReasoningEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.reasoningEventCountAfterStart)),
		providerTextDeltaCount: numericStats(runs.map((run) => run.provider?.textDeltaCount)),
		providerReasoningDeltaCount: numericStats(runs.map((run) => run.provider?.reasoningDeltaCount)),
		providerTextDeltaBytesP50: numericStats(runs.map((run) => run.provider?.textDeltaBytes.p50)),
		providerTextDeltaGapP90Ms: numericStats(runs.map((run) => run.provider?.textDeltaGapsMs.p90)),
		providerFirstTextLatencyMs: numericStats(runs.map((run) => run.provider?.firstTextLatencyMs)),
		providerParseErrorCount: numericStats(runs.map((run) => run.provider?.parseErrorCount)),
		providerUnknownEventCount: numericStats(runs.map((run) => run.provider?.unknownEventCount)),
		providerSseTextRatio: numericStats(runs.map((run) => run.providerPreservation?.sseTextToProviderRatio)),
		providerSseReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.sseReasoningToProviderRatio)),
		providerSelectedLiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveTextToProviderRatio)),
		providerSelectedLiveReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveReasoningToProviderRatio)),
		providerDomPositiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.domPositiveToProviderTextRatio)),
	};
}

function compareStreamingBenchmarkSummaries(baseline: StreamingBenchmarkSummary, current: StreamingBenchmarkSummary): StreamingBenchmarkComparison {
	return {
		baselineRuns: baseline.runs,
		currentRuns: current.runs,
		smoothnessDelta: statDelta(current.smoothness, baseline.smoothness),
		domGapP90DeltaMs: statDelta(current.domGapP90Ms, baseline.domGapP90Ms),
		domPositiveUpdateDelta: statDelta(current.domPositiveUpdateCount, baseline.domPositiveUpdateCount),
		domJumpMaxDeltaChars: statDelta(current.domJumpMaxChars, baseline.domJumpMaxChars),
		longTaskMaxDeltaMs: statDelta(current.longTaskMaxMs, baseline.longTaskMaxMs),
		firstVisibleDeltaMs: statDelta(current.firstVisibleMs, baseline.firstVisibleMs),
		liveFirstTextDeltaDeltaMs: statDelta(current.liveFirstTextDeltaMs, baseline.liveFirstTextDeltaMs),
		liveFirstEnqueueDeltaMs: statDelta(current.liveFirstEnqueueMs, baseline.liveFirstEnqueueMs),
		liveFirstFlushDeltaMs: statDelta(current.liveFirstFlushMs, baseline.liveFirstFlushMs),
		liveFirstOverlayUpdateDeltaMs: statDelta(current.liveFirstOverlayUpdateMs, baseline.liveFirstOverlayUpdateMs),
		sseFirstTextEventDeltaMs: statDelta(current.sseFirstTextEventMs, baseline.sseFirstTextEventMs),
		selectedLiveFirstTextEventDeltaMs: statDelta(current.selectedLiveFirstTextEventMsAfterStart, baseline.selectedLiveFirstTextEventMsAfterStart),
		providerFirstTextLatencyDeltaMs: statDelta(current.providerFirstTextLatencyMs, baseline.providerFirstTextLatencyMs),
		debugEnqueueCountDelta: statDelta(current.debugEnqueueCount, baseline.debugEnqueueCount),
		debugFlushCountDelta: statDelta(current.debugFlushCount, baseline.debugFlushCount),
		debugOverlayUpdateCountDelta: statDelta(current.debugOverlayUpdateCount, baseline.debugOverlayUpdateCount),
		debugTraceRefreshCompletedCountDelta: statDelta(current.debugTraceRefreshCompletedCount, baseline.debugTraceRefreshCompletedCount),
		liveEnqueueToExpectedRatioDelta: statDelta(current.liveEnqueueToExpectedRatio, baseline.liveEnqueueToExpectedRatio),
		liveFlushedEventsToExpectedRatioDelta: statDelta(current.liveFlushedEventsToExpectedRatio, baseline.liveFlushedEventsToExpectedRatio),
		liveOverlayEventsToExpectedRatioDelta: statDelta(current.liveOverlayEventsToExpectedRatio, baseline.liveOverlayEventsToExpectedRatio),
		liveFlushToEnqueueRatioDelta: statDelta(current.liveFlushToEnqueueRatio, baseline.liveFlushToEnqueueRatio),
		liveOverlayUpdatesToFlushedEventsRatioDelta: statDelta(current.liveOverlayUpdatesToFlushedEventsRatio, baseline.liveOverlayUpdatesToFlushedEventsRatio),
		traceLiveVersionCountDelta: statDelta(current.traceLiveVersionCount, baseline.traceLiveVersionCount),
		traceMaxAssistantOutputDelta: statDelta(current.traceMaxAssistantOutputLength, baseline.traceMaxAssistantOutputLength),
		traceDurableEventDeltaDelta: statDelta(current.traceDurableEventDelta, baseline.traceDurableEventDelta),
		fixtureScheduleGapP90DeltaMs: statDelta(current.fixtureScheduleGapP90Ms, baseline.fixtureScheduleGapP90Ms),
		domLagOverFixtureScheduleP90DeltaMs: statDelta(current.domLagOverFixtureScheduleP90Ms, baseline.domLagOverFixtureScheduleP90Ms),
		sseTextLagOverFixtureScheduleP90DeltaMs: statDelta(current.sseTextLagOverFixtureScheduleP90Ms, baseline.sseTextLagOverFixtureScheduleP90Ms),
		eventSourceTextEventDelta: statDelta(current.eventSourceTextEventCountAfterStart, baseline.eventSourceTextEventCountAfterStart),
		eventSourceReasoningEventDelta: statDelta(current.eventSourceReasoningEventCountAfterStart, baseline.eventSourceReasoningEventCountAfterStart),
		sseTextEventDelta: statDelta(current.sseTextEventCount, baseline.sseTextEventCount),
		sseChunkGapP90DeltaMs: statDelta(current.sseChunkGapP90Ms, baseline.sseChunkGapP90Ms),
		selectedLiveTextEventDelta: statDelta(current.selectedLiveTextEventCountAfterStart, baseline.selectedLiveTextEventCountAfterStart),
		selectedLiveReasoningEventDelta: statDelta(current.selectedLiveReasoningEventCountAfterStart, baseline.selectedLiveReasoningEventCountAfterStart),
		selectedLiveEventDelta: statDelta(current.selectedLiveEventCountAfterStart, baseline.selectedLiveEventCountAfterStart),
		providerSseTextRatioDelta: statDelta(current.providerSseTextRatio, baseline.providerSseTextRatio),
		providerSelectedLiveTextRatioDelta: statDelta(current.providerSelectedLiveTextRatio, baseline.providerSelectedLiveTextRatio),
		providerSseReasoningRatioDelta: statDelta(current.providerSseReasoningRatio, baseline.providerSseReasoningRatio),
		providerSelectedLiveReasoningRatioDelta: statDelta(current.providerSelectedLiveReasoningRatio, baseline.providerSelectedLiveReasoningRatio),
		providerDomPositiveTextRatioDelta: statDelta(current.providerDomPositiveTextRatio, baseline.providerDomPositiveTextRatio),
	};
}

function streamingLivePipeline(run: StreamingBenchmark): StreamingBenchmarkLivePipeline | undefined {
	return run.livePipeline ?? summarizeStreamingLivePipeline(run);
}

function streamingDebugDeltaNumber(run: StreamingBenchmark, key: string): number | undefined {
	const value = run.debug.delta?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugAfterNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	const value = run.debug.after?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugStateWindowNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	return stateWindowNumber(run.debug.after?.[key], run.debug.stateBeforeReset?.[key]);
}

function selectedLiveStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return summarizeStreamingSelectedLiveEventSource(run);
}

function roomSummaryStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return run.eventSource?.streams.find((stream) => stream.role === "room-summary");
}

function traceDurableEventDelta(trace: StreamingBenchmarkTraceProbe | undefined): number | undefined {
	if (!trace || trace.durableEventCountStart === undefined || trace.durableEventCountEnd === undefined) return undefined;
	return trace.durableEventCountEnd - trace.durableEventCountStart;
}

export async function readStreamingBenchmarkArtifact(file: string): Promise<StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison> {
	const parsed = JSON.parse(await readFile(file, "utf8"));
	const value = parsed.benchmark ?? parsed;
	if (value?.kind === "streaming-benchmark") return normalizeStreamingBenchmarkRun(value as StreamingBenchmark);
	if (value?.kind === "streaming-benchmark-runs") {
		const runs = Array.isArray(value.runs) ? value.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		return normalizeStreamingBenchmarkGroupArtifact(value as Partial<StreamingBenchmarkGroup>, runs);
	}
	if (value?.kind === "streaming-benchmark-url-comparison") {
		const primaryRuns = Array.isArray(value.primary?.runs) ? value.primary.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const compareRuns = Array.isArray(value.compare?.runs) ? value.compare.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const primary = normalizeStreamingBenchmarkGroupArtifact(value.primary as Partial<StreamingBenchmarkGroup> | undefined, primaryRuns);
		const compare = normalizeStreamingBenchmarkGroupArtifact(value.compare as Partial<StreamingBenchmarkGroup> | undefined, compareRuns);
		return {
			...(value as StreamingBenchmarkUrlComparison),
			primary,
			compare,
			comparison: compareStreamingBenchmarkSummaries(primary.summary, compare.summary),
			regressions: Array.isArray(value.regressions) ? value.regressions : [],
			warnings: Array.isArray(value.warnings) ? value.warnings : [],
		};
	}
	throw new Error(`File is not a streaming benchmark artifact: ${file}`);
}

function normalizeStreamingBenchmarkGroupArtifact(value: Partial<StreamingBenchmarkGroup> | undefined, runs: StreamingBenchmark[]): StreamingBenchmarkGroup {
	return {
		...(value as StreamingBenchmarkGroup | undefined),
		kind: "streaming-benchmark-runs",
		createdAt: value?.createdAt ?? new Date().toISOString(),
		durationMs: value?.durationMs ?? runs[0]?.durationMs ?? 0,
		runs,
		summary: summarizeStreamingBenchmarks(runs),
		regressions: Array.isArray(value?.regressions) ? value.regressions : [],
		warnings: Array.isArray(value?.warnings) ? value.warnings : [],
	};
}

function normalizeStreamingBenchmarkRun(run: StreamingBenchmark): StreamingBenchmark {
	const scored = { ...run, regressions: Array.isArray(run.regressions) ? run.regressions : [], warnings: Array.isArray(run.warnings) ? run.warnings : [], score: run.score ?? scoreStreamingBenchmark(run) };
	const withProviderPreservation = { ...scored, providerPreservation: run.providerPreservation ?? summarizeStreamingProviderPreservation(scored) };
	const withLivePipeline = { ...withProviderPreservation, livePipeline: run.livePipeline ?? summarizeStreamingLivePipeline(withProviderPreservation) };
	return { ...withLivePipeline, cadence: run.cadence ?? summarizeStreamingCadence(withLivePipeline) };
}

export function streamingBenchmarkReportTarget(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison): { id: string; url: string; title: string } {
	const url = benchmark.kind === "streaming-benchmark-url-comparison"
		? benchmark.primaryUrl
		: benchmark.kind === "streaming-benchmark-runs"
			? benchmark.runs[0]?.url ?? ""
			: benchmark.url;
	return { id: "artifact", url, title: "streaming benchmark artifact" };
}

export async function readStreamingBenchmarkRuns(file: string): Promise<StreamingBenchmark[]> {
	const value = await readStreamingBenchmarkArtifact(file);
	const runs = value.kind === "streaming-benchmark-runs"
		? value.runs
		: value.kind === "streaming-benchmark-url-comparison"
			? [...value.primary.runs, ...value.compare.runs]
			: [value];
	return runs.filter((run): run is StreamingBenchmark => run.kind === "streaming-benchmark");
}

function numericStats(values: readonly unknown[]): NumberStats {
	const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).slice().sort((a, b) => a - b);
	if (!nums.length) return { count: 0 };
	const pick = (q: number) => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
	const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
	return {
		count: nums.length,
		min: round3(nums[0]),
		p50: round3(pick(0.50)),
		p90: round3(pick(0.90)),
		p99: round3(pick(0.99)),
		max: round3(nums[nums.length - 1]),
		avg: round3(avg),
	};
}

function statDelta(current: NumberStats, baseline: NumberStats): number | undefined {
	if (current.p50 === undefined || baseline.p50 === undefined) return undefined;
	return round3(current.p50 - baseline.p50);
}

function clampScore(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stateWindowNumber(afterValue: unknown, beforeValue: unknown): number | undefined {
	const after = finiteNumber(afterValue);
	if (after === undefined) return undefined;
	const before = finiteNumber(beforeValue);
	if (before === undefined || before <= 0 || after < before) return after;
	return round3(after - before);
}

function elapsedIsoMs(startedAt: unknown, value: unknown): number | undefined {
	if (typeof startedAt !== "string" || typeof value !== "string") return undefined;
	const start = Date.parse(startedAt);
	const end = Date.parse(value);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
	return round3(end - start);
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}
