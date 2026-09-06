export type ToolMetricThresholdBand = {
	elevated: number;
	high: number;
	critical: number;
};

export type ToolMetricThresholds = {
	durationMs: ToolMetricThresholdBand;
	inputTokens: ToolMetricThresholdBand;
	outputTokens: ToolMetricThresholdBand;
};

export const DEFAULT_TOOL_METRIC_THRESHOLDS: ToolMetricThresholds = {
	durationMs: { elevated: 1_000, high: 5_000, critical: 15_000 },
	inputTokens: { elevated: 8_000, high: 20_000, critical: 50_000 },
	outputTokens: { elevated: 2_000, high: 10_000, critical: 50_000 },
};

const STORAGE_KEY = "pibo.chat.toolMetricThresholds";

export function isValidToolMetricThresholds(value: unknown): value is ToolMetricThresholds {
	if (!isRecord(value)) return false;
	return isValidBand(value.durationMs) && isValidBand(value.inputTokens) && isValidBand(value.outputTokens);
}

export function readStoredToolMetricThresholds(): ToolMetricThresholds {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return DEFAULT_TOOL_METRIC_THRESHOLDS;
		const parsed: unknown = JSON.parse(stored);
		return isValidToolMetricThresholds(parsed) ? parsed : DEFAULT_TOOL_METRIC_THRESHOLDS;
	} catch {
		return DEFAULT_TOOL_METRIC_THRESHOLDS;
	}
}

export function writeStoredToolMetricThresholds(value: ToolMetricThresholds): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function isValidBand(value: unknown): value is ToolMetricThresholdBand {
	if (!isRecord(value)) return false;
	const elevated = value.elevated;
	const high = value.high;
	const critical = value.critical;
	return typeof elevated === "number" && Number.isSafeInteger(elevated) && elevated > 0
		&& typeof high === "number" && Number.isSafeInteger(high) && high > elevated
		&& typeof critical === "number" && Number.isSafeInteger(critical) && critical > high;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
