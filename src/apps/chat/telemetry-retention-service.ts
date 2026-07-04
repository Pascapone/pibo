import type { PiboWebAppContext } from "../../web/types.js";
import type { PiboDataStore } from "../../data/pibo-store.js";
import {
	telemetryRetentionCutoff,
	type TelemetryRetentionSettings,
} from "../../core/telemetry-retention-settings.js";
import type { TelemetryRetentionClass, TelemetryPruneResult } from "../../data/telemetry-retention.js";

export type TelemetryRetentionRunResult = {
	cutoff: string;
	days: number;
	applied: boolean;
	results: TelemetryPruneResult[];
	rowsDeleted: number;
	bytesMatched: number;
};

export const TELEMETRY_RETENTION_CLASSES: TelemetryRetentionClass[] = [
	"live",
	"diagnostic",
	"provider_event",
	"payload_preview",
	"incident",
];

export const DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TelemetryRetentionMaintenanceState = {
	lastCheckedAt?: number;
	running?: boolean;
};

export function pruneTelemetryOlderThan(input: {
	dataStore: PiboDataStore;
	days: number;
	now?: Date;
	apply?: boolean;
}): TelemetryRetentionRunResult {
	const cutoff = telemetryRetentionCutoff(input.days, input.now);
	const results = TELEMETRY_RETENTION_CLASSES.map((retentionClass) =>
		input.dataStore.telemetry.prune({ retentionClass, before: cutoff, apply: input.apply }),
	);
	return {
		cutoff,
		days: input.days,
		applied: input.apply === true,
		results,
		rowsDeleted: results.reduce((sum, result) => sum + result.rowsDeleted, 0),
		bytesMatched: results.reduce((sum, result) => sum + result.bytesMatched, 0),
	};
}

export function isTelemetryRetentionMaintenanceDue(input: {
	state: TelemetryRetentionMaintenanceState;
	now?: Date;
	intervalMs?: number;
}): boolean {
	if (input.state.running) return false;
	const now = input.now ?? new Date();
	const intervalMs = input.intervalMs ?? DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS;
	return !(input.state.lastCheckedAt && now.getTime() - input.state.lastCheckedAt < intervalMs);
}

export function maybeRunTelemetryRetentionMaintenance(input: {
	state: TelemetryRetentionMaintenanceState;
	dataStore: PiboDataStore;
	settings: TelemetryRetentionSettings;
	context: PiboWebAppContext;
	now?: Date;
	intervalMs?: number;
	onPruned?: (lastPrunedAt: string) => void;
}): void {
	if (!input.settings.enabled) return;
	if (input.state.running) return;
	const now = input.now ?? new Date();
	const intervalMs = input.intervalMs ?? DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS;
	if (input.state.lastCheckedAt && now.getTime() - input.state.lastCheckedAt < intervalMs) return;
	if (!isPersistentRetentionDue(input.settings.lastPrunedAt, now, intervalMs)) {
		input.state.lastCheckedAt = now.getTime();
		return;
	}
	if (hasActiveRuntimeWork(input.context)) return;
	input.state.lastCheckedAt = now.getTime();
	input.state.running = true;
	setTimeout(() => {
		try {
			pruneTelemetryOlderThan({ dataStore: input.dataStore, days: input.settings.days, now, apply: true });
			input.onPruned?.(now.toISOString());
		} finally {
			input.state.running = false;
		}
	}, 0).unref?.();
}

export function isPersistentRetentionDue(lastPrunedAt: string | undefined, now: Date, intervalMs: number): boolean {
	if (!lastPrunedAt) return true;
	const lastPrunedMs = Date.parse(lastPrunedAt);
	if (!Number.isFinite(lastPrunedMs)) return true;
	return now.getTime() - lastPrunedMs >= intervalMs;
}

export function hasActiveRuntimeWork(context: PiboWebAppContext): boolean {
	const statuses = context.channelContext.listSessionRuntimeStatuses?.()
		?? context.channelContext.listSessions?.().map((session) => context.channelContext.getSessionRuntimeStatus?.(session.id)).filter((status) => status !== undefined)
		?? [];
	return statuses.some((status) => Boolean(status?.processing || status?.streaming || (status?.queuedMessages ?? 0) > 0));
}
