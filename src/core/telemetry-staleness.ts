import type {
	StoredTelemetryProviderRequest,
	TelemetryPhaseName,
	TelemetryStaleWorkItem,
	TelemetryStore,
} from "../data/telemetry.js";

export const DEFAULT_TELEMETRY_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const MIN_TELEMETRY_STALE_THRESHOLD_MS = 1_000;
export const MAX_TELEMETRY_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type TelemetryStaleThresholdSource = "override" | "profile" | "provider" | "default";

export type TelemetryStaleThresholdSettings = {
	defaultThresholdMs?: number;
	providers?: Record<string, number>;
	profiles?: Record<string, number>;
};

export type TelemetryStaleThresholdResolution = {
	thresholdMs: number;
	source: TelemetryStaleThresholdSource;
	key?: string;
};

export type TelemetryStaleDetectorOptions = {
	limit?: number;
	now?: string;
	thresholdMs?: number;
	settings?: TelemetryStaleThresholdSettings;
};

export type ProviderAwareTelemetryStaleWorkItem = TelemetryStaleWorkItem & {
	appliedThresholdMs: number;
	thresholdSource: TelemetryStaleThresholdSource;
	thresholdKey?: string;
	provider?: string;
	model?: string;
	profile?: string;
	activePhase: TelemetryPhaseName | undefined;
	active: true;
};

export function sanitizeTelemetryStaleThresholdSettings(value: unknown): TelemetryStaleThresholdSettings {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const settings: TelemetryStaleThresholdSettings = {};
	const defaultThresholdMs = sanitizeTelemetryStaleThresholdMs(raw.defaultThresholdMs);
	if (defaultThresholdMs !== undefined) settings.defaultThresholdMs = defaultThresholdMs;
	const providers = sanitizeThresholdMap(raw.providers);
	if (Object.keys(providers).length > 0) settings.providers = providers;
	const profiles = sanitizeThresholdMap(raw.profiles);
	if (Object.keys(profiles).length > 0) settings.profiles = profiles;
	return settings;
}

export function resolveTelemetryStaleThreshold(input: {
	provider?: string;
	profile?: string;
	settings?: TelemetryStaleThresholdSettings;
	overrideThresholdMs?: number;
} = {}): TelemetryStaleThresholdResolution {
	const override = sanitizeTelemetryStaleThresholdMs(input.overrideThresholdMs);
	if (override !== undefined) return { thresholdMs: override, source: "override" };

	const settings = sanitizeTelemetryStaleThresholdSettings(input.settings);
	const profileKey = lookupKey(settings.profiles, input.profile);
	if (profileKey) return { thresholdMs: settings.profiles![profileKey], source: "profile", key: profileKey };

	const providerKey = lookupKey(settings.providers, input.provider);
	if (providerKey) return { thresholdMs: settings.providers![providerKey], source: "provider", key: providerKey };

	return {
		thresholdMs: settings.defaultThresholdMs ?? DEFAULT_TELEMETRY_STALE_THRESHOLD_MS,
		source: "default",
	};
}

export class TelemetryStaleDetector {
	constructor(private readonly store: TelemetryStore, private readonly settings: TelemetryStaleThresholdSettings = {}) {}

	listStaleWork(options: TelemetryStaleDetectorOptions = {}): ProviderAwareTelemetryStaleWorkItem[] {
		const candidates = this.store.listStaleWork({
			limit: 200,
			now: options.now,
			thresholdMs: 0,
		});
		const limit = normalizeLimit(options.limit);
		const rows: ProviderAwareTelemetryStaleWorkItem[] = [];
		for (const item of candidates) {
			const timeline = this.store.getTurnTimeline(item.turnId);
			if (!timeline || timeline.turn.status !== "queued" && timeline.turn.status !== "running") continue;
			const phase = item.phaseId ? timeline.phases.find((candidate) => candidate.phaseId === item.phaseId) : undefined;
			const providerRequest = providerForStaleItem(item, timeline.providerRequests);
			const profile = typeof timeline.turn.metadata.profile === "string" ? timeline.turn.metadata.profile : undefined;
			const threshold = resolveTelemetryStaleThreshold({
				provider: providerRequest?.provider,
				profile,
				settings: options.settings ?? this.settings,
				overrideThresholdMs: options.thresholdMs,
			});
			if (item.staleForMs < threshold.thresholdMs) continue;
			rows.push({
				...item,
				phase: phase?.name ?? item.phase,
				activePhase: phase?.name ?? item.phase,
				lastProgressAt: item.lastProgressAt ?? phase?.lastProgressAt ?? phase?.startedAt,
				thresholdMs: threshold.thresholdMs,
				appliedThresholdMs: threshold.thresholdMs,
				thresholdSource: threshold.source,
				thresholdKey: threshold.key,
				provider: providerRequest?.provider,
				model: providerRequest?.model,
				profile,
				active: true,
				nextCommands: item.nextCommands,
			});
			if (rows.length >= limit) break;
		}
		return rows;
	}
}

function providerForStaleItem(item: TelemetryStaleWorkItem, providers: StoredTelemetryProviderRequest[]): StoredTelemetryProviderRequest | undefined {
	if (item.phaseId) {
		const linked = providers.find((provider) => provider.phaseId === item.phaseId);
		if (linked) return linked;
	}
	return providers[0];
}

function sanitizeThresholdMap(value: unknown): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const output: Record<string, number> = {};
	for (const [rawKey, rawThreshold] of Object.entries(value)) {
		const key = rawKey.trim().toLowerCase();
		if (!key) continue;
		const threshold = sanitizeTelemetryStaleThresholdMs(rawThreshold);
		if (threshold === undefined) continue;
		output[key] = threshold;
	}
	return output;
}

function sanitizeTelemetryStaleThresholdMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const threshold = Math.floor(value);
	if (threshold < MIN_TELEMETRY_STALE_THRESHOLD_MS || threshold > MAX_TELEMETRY_STALE_THRESHOLD_MS) return undefined;
	return threshold;
}

function lookupKey(map: Record<string, number> | undefined, value: string | undefined): string | undefined {
	if (!map || !value) return undefined;
	const key = value.trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(map, key) ? key : undefined;
}

function normalizeLimit(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 20;
	return Math.max(1, Math.min(200, Math.floor(value)));
}
