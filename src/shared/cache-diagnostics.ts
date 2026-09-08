import { modelInferenceInputTokens, type ModelInferenceMetrics } from "./model-inference-metrics.js";

export const CACHE_COLLAPSE_RULE = "warm-80-cold-10-input-16384-v1";
export const CACHE_COLLAPSE_MIN_INPUT = 16_384;

export type CacheInferenceEvidence = {
	id: string;
	atMs: number;
	epoch?: string;
	prefixDigest?: string;
	configurationDigest?: string;
	cacheKeyDigest?: string;
	runtimeGeneration?: string;
	historyContinuity?: "verified" | "unknown";
	boundary?: "compaction" | "model-change" | "runtime-change" | "explicit-refresh";
};

export type CacheObservation = {
	rule: typeof CACHE_COLLAPSE_RULE;
	warning: "none" | "possible-cache-collapse" | "cache-collapse";
	causes: Array<"local-prefix-changed" | "cache-key-changed" | "configuration-changed" | "expected-epoch-change" | "unchanged-observed-input/unknown" | "insufficient-evidence">;
	inputTokens?: number;
	cacheReadTokens?: number;
	uncachedTokens?: number;
	previousInferenceId?: string;
	previousCacheRatio?: number;
	cacheRatio?: number;
	elapsedMs?: number;
	runtimeRestarted?: boolean;
	epoch?: string;
};

export type CacheInference = { evidence: CacheInferenceEvidence; metrics: ModelInferenceMetrics };

function count(value: number | undefined): number | undefined {
	return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}

/** Constant work over small metadata. Never scans, copies or hashes conversation history. */
export function diagnoseCacheInference(current: CacheInference, previous?: CacheInference): CacheObservation {
	const input = count(modelInferenceInputTokens(current.metrics));
	const read = count(current.metrics.cacheReadTokens);
	const valid = input !== undefined && input > 0 && read !== undefined && read <= input;
	const evidence = current.evidence;
	const result: CacheObservation = {
		rule: CACHE_COLLAPSE_RULE,
		warning: "none",
		causes: [],
		...(evidence.epoch ? { epoch: evidence.epoch } : {}),
		...(input !== undefined ? { inputTokens: input } : {}),
		...(valid ? { cacheReadTokens: read, uncachedTokens: input - read, cacheRatio: read / input } : {}),
	};
	if (!previous || previous.evidence.id === evidence.id || previous.evidence.atMs > evidence.atMs) {
		result.causes.push("insufficient-evidence");
		return result;
	}
	result.previousInferenceId = previous.evidence.id;
	result.elapsedMs = evidence.atMs - previous.evidence.atMs;
	const before = previous.evidence;
	if (before.runtimeGeneration && evidence.runtimeGeneration) result.runtimeRestarted = before.runtimeGeneration !== evidence.runtimeGeneration;
	if (evidence.boundary || (before.epoch !== undefined && evidence.epoch !== undefined && before.epoch !== evidence.epoch)) {
		result.causes.push("expected-epoch-change");
		return result;
	}
	for (const [field, cause] of [
		["prefixDigest", "local-prefix-changed"],
		["cacheKeyDigest", "cache-key-changed"],
		["configurationDigest", "configuration-changed"],
	] as const) {
		if (before[field] !== undefined && evidence[field] !== undefined && before[field] !== evidence[field]) result.causes.push(cause);
	}
	const previousInput = count(modelInferenceInputTokens(previous.metrics));
	const previousRead = count(previous.metrics.cacheReadTokens);
	if (!valid || previousInput === undefined || previousInput === 0 || previousRead === undefined || previousRead > previousInput) {
		result.causes.push("insufficient-evidence");
		return result;
	}
	result.previousCacheRatio = previousRead / previousInput;
	const verified = evidence.historyContinuity === "verified" && evidence.epoch !== undefined && evidence.epoch === before.epoch;
	if (result.causes.length === 0) result.causes.push(verified && evidence.prefixDigest && evidence.prefixDigest === before.prefixDigest
		? "unchanged-observed-input/unknown" : "insufficient-evidence");
	// A newly large prompt is not evidence of losing the old cached context.
	if (previousInput >= CACHE_COLLAPSE_MIN_INPUT && input >= CACHE_COLLAPSE_MIN_INPUT
		&& previousRead / previousInput >= 0.8 && read / input <= 0.1 && read < previousRead) {
		result.warning = verified ? "cache-collapse" : "possible-cache-collapse";
	}
	return result;
}

export function cacheWarningText(observation: CacheObservation): string | undefined {
	if (observation.warning === "none") return undefined;
	const prefix = observation.warning === "cache-collapse" ? "Cache strongly decreased" : "Possible cache collapse";
	return `${prefix}: ${observation.uncachedTokens} / ${observation.inputTokens} input tokens not read from cache. Cause: ${observation.causes.join(", ")}.`;
}
