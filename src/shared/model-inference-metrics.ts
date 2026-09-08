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
};

export function modelInferenceInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const total = tokenCount(metrics?.totalTokens);
	const output = tokenCount(metrics?.outputTokens);
	if (total !== undefined && output !== undefined) return Math.max(0, total - output);
	return tokenCount(metrics?.inputTokens);
}

export function modelInferenceCachedInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const cacheRead = tokenCount(metrics?.cacheReadTokens);
	const cacheWrite = tokenCount(metrics?.cacheWriteTokens);
	if (cacheRead === undefined && cacheWrite === undefined) return undefined;
	return (cacheRead ?? 0) + (cacheWrite ?? 0);
}

export function modelInferenceUncachedInputTokens(metrics: ModelInferenceMetrics | undefined): number | undefined {
	const input = modelInferenceInputTokens(metrics);
	if (input === undefined) return undefined;
	return Math.max(0, input - (modelInferenceCachedInputTokens(metrics) ?? 0));
}

function tokenCount(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
