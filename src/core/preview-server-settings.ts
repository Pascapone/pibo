export const DEFAULT_PREVIEW_MAX_RUNNING_SERVERS = 3;
export const DEFAULT_PREVIEW_AUTO_STOP_MINUTES = 10;
export const MIN_PREVIEW_MAX_RUNNING_SERVERS = 1;
export const MAX_PREVIEW_MAX_RUNNING_SERVERS = 20;
export const MIN_PREVIEW_AUTO_STOP_MINUTES = 1;
export const MAX_PREVIEW_AUTO_STOP_MINUTES = 24 * 60;

export type PreviewServerSettings = {
	maxRunningServers: number;
	autoStopMinutes: number;
};

export function sanitizePreviewServerSettings(value: unknown): PreviewServerSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		maxRunningServers: boundedInteger(
			raw.maxRunningServers,
			MIN_PREVIEW_MAX_RUNNING_SERVERS,
			MAX_PREVIEW_MAX_RUNNING_SERVERS,
			DEFAULT_PREVIEW_MAX_RUNNING_SERVERS,
		),
		autoStopMinutes: boundedInteger(
			raw.autoStopMinutes,
			MIN_PREVIEW_AUTO_STOP_MINUTES,
			MAX_PREVIEW_AUTO_STOP_MINUTES,
			DEFAULT_PREVIEW_AUTO_STOP_MINUTES,
		),
	};
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
		? value
		: fallback;
}
