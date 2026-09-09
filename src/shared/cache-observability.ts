import {
	modelInferenceCachedInputTokens,
	modelInferenceInputTokens,
	modelInferenceUncachedInputTokens,
	type ModelInferenceMetrics,
} from "./model-inference-metrics.js";

export const CACHE_READ_DROP_RULE = "provider-cache-read-drop-v1";
export const CACHE_READ_DROP_MIN_INPUT_TOKENS = 16_384;

export type CacheUsageObservation = {
	rule: typeof CACHE_READ_DROP_RULE;
	source: "provider-reported-usage";
	cacheState: "unknown" | "cold" | "partial" | "warm";
	warning: "none" | "possible-cache-read-drop";
	explanation: "insufficient-data" | "provider-usage" | "compaction-between-inferences" | "cache-read-ratio-dropped";
	inputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	uncachedInputTokens?: number;
	cacheReadRatio?: number;
	previousInferenceId?: string;
	previousCacheReadRatio?: number;
	elapsedMs?: number;
};

type CacheUsageInference = {
	id: string;
	completedAt?: string;
	metrics: ModelInferenceMetrics;
};

function cacheState(ratio: number | undefined): CacheUsageObservation["cacheState"] {
	if (ratio === undefined) return "unknown";
	if (ratio <= 0.1) return "cold";
	if (ratio >= 0.8) return "warm";
	return "partial";
}

function elapsedMs(current: CacheUsageInference, previous: CacheUsageInference | undefined): number | undefined {
	if (!previous?.completedAt || !current.completedAt) return undefined;
	const before = Date.parse(previous.completedAt);
	const after = Date.parse(current.completedAt);
	return Number.isFinite(before) && Number.isFinite(after) && after >= before ? after - before : undefined;
}

/**
 * Compares bounded provider usage counters. It does not inspect prompts, infer a
 * provider cache key, or identify why a cache read changed.
 */
export function observeCacheUsage(
	current: CacheUsageInference,
	previous?: CacheUsageInference,
	options: { compactionBetween?: boolean } = {},
): CacheUsageObservation {
	const inputTokens = modelInferenceInputTokens(current.metrics);
	const cacheReadTokens = modelInferenceCachedInputTokens(current.metrics);
	const uncachedInputTokens = modelInferenceUncachedInputTokens(current.metrics);
	const cacheWriteTokens = Number.isFinite(current.metrics.cacheWriteTokens) && Number(current.metrics.cacheWriteTokens) >= 0
		? Math.floor(Number(current.metrics.cacheWriteTokens))
		: undefined;
	const ratio = inputTokens !== undefined && inputTokens > 0 && cacheReadTokens !== undefined && cacheReadTokens <= inputTokens
		? cacheReadTokens / inputTokens
		: undefined;
	const previousInput = modelInferenceInputTokens(previous?.metrics);
	const previousRead = modelInferenceCachedInputTokens(previous?.metrics);
	const previousRatio = previousInput !== undefined && previousInput > 0 && previousRead !== undefined && previousRead <= previousInput
		? previousRead / previousInput
		: undefined;
	const elapsed = elapsedMs(current, previous);
	const observation: CacheUsageObservation = {
		rule: CACHE_READ_DROP_RULE,
		source: "provider-reported-usage",
		cacheState: cacheState(ratio),
		warning: "none",
		explanation: ratio === undefined ? "insufficient-data" : "provider-usage",
		...(inputTokens === undefined ? {} : { inputTokens }),
		...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
		...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
		...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }),
		...(ratio === undefined ? {} : { cacheReadRatio: ratio }),
		...(previous ? { previousInferenceId: previous.id } : {}),
		...(previousRatio === undefined ? {} : { previousCacheReadRatio: previousRatio }),
		...(elapsed === undefined ? {} : { elapsedMs: elapsed }),
	};
	if (options.compactionBetween) {
		observation.explanation = "compaction-between-inferences";
		return observation;
	}
	if (inputTokens !== undefined && previousInput !== undefined && cacheReadTokens !== undefined && previousRead !== undefined
		&& inputTokens >= CACHE_READ_DROP_MIN_INPUT_TOKENS && previousInput >= CACHE_READ_DROP_MIN_INPUT_TOKENS
		&& ratio !== undefined && previousRatio !== undefined && previousRatio >= 0.8 && ratio <= 0.1 && cacheReadTokens < previousRead) {
		observation.warning = "possible-cache-read-drop";
		observation.explanation = "cache-read-ratio-dropped";
	}
	return observation;
}

export function cacheUsageWarningText(observation: CacheUsageObservation): string | undefined {
	if (observation.warning === "none") return undefined;
	const current = observation.cacheReadRatio === undefined ? "unknown" : `${(observation.cacheReadRatio * 100).toFixed(1)}%`;
	const previous = observation.previousCacheReadRatio === undefined ? "unknown" : `${(observation.previousCacheReadRatio * 100).toFixed(1)}%`;
	return `Possible cache-read drop: provider-reported cached input fell from ${previous} to ${current}. The provider metrics do not identify the cause.`;
}
