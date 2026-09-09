export type ModelInferenceMetrics = {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	totalTokens: number;
	costUsd?: number;
};

export type ModelInferenceRecord = {
	id: string;
	metrics: ModelInferenceMetrics;
	completedAt?: string;
	cacheObservation?: import("./cache-observability.js").CacheUsageObservation;
};

export function modelInferenceInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const total = tokenCount(metrics?.totalTokens);
	const output = tokenCount(metrics?.outputTokens);
	if (total !== undefined && output !== undefined) return Math.max(0, total - output);
	return tokenCount(metrics?.inputTokens);
}

export function modelInferenceCachedInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	return tokenCount(metrics?.cacheReadTokens);
}

export function modelInferenceUncachedInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const input = modelInferenceInputTokens(metrics);
	const cached = modelInferenceCachedInputTokens(metrics);
	if (input === undefined || cached === undefined || cached > input) return undefined;
	return input - cached;
}

export function modelInferenceCacheReadRatio(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const input = modelInferenceInputTokens(metrics);
	const cached = modelInferenceCachedInputTokens(metrics);
	if (input === undefined || input === 0 || cached === undefined || cached > input) return undefined;
	return cached / input;
}

function tokenCount(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
