export const DEFAULT_TELEMETRY_RETENTION_DAYS = 30;
export const MIN_TELEMETRY_RETENTION_DAYS = 1;
export const MAX_TELEMETRY_RETENTION_DAYS = 365;

export type TelemetryRetentionSettings = {
	enabled: boolean;
	days: number;
	lastPrunedAt?: string;
};

export function sanitizeTelemetryRetentionSettings(value: unknown): TelemetryRetentionSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const lastPrunedAt = sanitizeTelemetryRetentionTimestamp(raw.lastPrunedAt);
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
		days: sanitizeTelemetryRetentionDays(raw.days) ?? DEFAULT_TELEMETRY_RETENTION_DAYS,
		...(lastPrunedAt ? { lastPrunedAt } : {}),
	};
}

export function sanitizeTelemetryRetentionDays(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const days = Math.trunc(value);
	if (days < MIN_TELEMETRY_RETENTION_DAYS || days > MAX_TELEMETRY_RETENTION_DAYS) return undefined;
	return days;
}

export function sanitizeTelemetryRetentionTimestamp(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const timestamp = value.trim();
	if (!timestamp) return undefined;
	const ms = Date.parse(timestamp);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function telemetryRetentionCutoff(days: number, now: Date = new Date()): string {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
