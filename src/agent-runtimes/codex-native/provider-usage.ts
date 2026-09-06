import type { AgentRuntimeProviderUsage } from "../../agent-runtime/types.js";
import type { CodexAppServerClient } from "./client.js";
import type {
	CodexAppServerAccountRateLimitsResponse,
	CodexAppServerRateLimitSnapshot,
	CodexAppServerRateLimitWindow,
} from "./protocol-types.js";

const PROVIDER_ID = "openai-codex";
const MAX_RATE_LIMIT_BUCKETS = 32;
const RATE_LIMIT_REQUEST_TIMEOUT_MS = 5_000;
type ProviderUsageLimit = NonNullable<NonNullable<AgentRuntimeProviderUsage>["limits"]>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`Codex ${label} is invalid.`);
	return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Codex ${label} is invalid.`);
	return value;
}

function formatWindowDuration(minutes: number | undefined, fallback: string): string {
	if (minutes === undefined || minutes <= 0) return fallback;
	if (minutes % (7 * 24 * 60) === 0) return `${minutes / (7 * 24 * 60)}w`;
	if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

function normalizeWindow(
	value: CodexAppServerRateLimitWindow | null | undefined,
	fallbackLabel: string,
	prefix?: string,
): ProviderUsageLimit | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error("Codex rate-limit window is invalid.");
	const used = optionalNumber(value.usedPercent, "rate-limit percentage");
	if (used === undefined) throw new Error("Codex rate-limit percentage is missing.");
	const usedPercent = Math.max(0, Math.min(100, used));
	const duration = optionalNumber(value.windowDurationMins, "rate-limit duration");
	const resetsAtSeconds = optionalNumber(value.resetsAt, "rate-limit reset time");
	const windowLabel = `${formatWindowDuration(duration, fallbackLabel)} limit`;
	return {
		label: prefix ? `${prefix} ${windowLabel}` : windowLabel,
		usedPercent,
		remainingPercent: 100 - usedPercent,
		...(resetsAtSeconds !== undefined ? { resetsAt: new Date(resetsAtSeconds * 1_000).toISOString() } : {}),
	};
}

function snapshotLabel(snapshot: CodexAppServerRateLimitSnapshot, fallback?: string): string | undefined {
	return optionalString(snapshot.limitName, "rate-limit name") ?? fallback;
}

function snapshotLimits(snapshot: CodexAppServerRateLimitSnapshot, prefix?: string) {
	return [
		normalizeWindow(snapshot.primary, "primary", prefix),
		normalizeWindow(snapshot.secondary, "weekly", prefix),
	].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function snapshotCredits(snapshot: CodexAppServerRateLimitSnapshot): NonNullable<AgentRuntimeProviderUsage>["credits"] | undefined {
	if (snapshot.credits === undefined || snapshot.credits === null) return undefined;
	if (!isRecord(snapshot.credits) || typeof snapshot.credits.hasCredits !== "boolean" || typeof snapshot.credits.unlimited !== "boolean") {
		throw new Error("Codex credit snapshot is invalid.");
	}
	if (!snapshot.credits.hasCredits) return undefined;
	return {
		unlimited: snapshot.credits.unlimited,
		balance: optionalString(snapshot.credits.balance, "credit balance"),
	};
}

export function normalizeCodexNativeProviderUsage(value: unknown): AgentRuntimeProviderUsage | undefined {
	if (!isRecord(value) || !isRecord(value.rateLimits)) throw new Error("Codex rate-limit response is invalid.");
	const response = value as unknown as CodexAppServerAccountRateLimitsResponse;
	const primary = response.rateLimits;
	const limits = [...snapshotLimits(primary)];
	let planType = optionalString(primary.planType, "plan type");
	let credits = snapshotCredits(primary);
	const primaryLimitId = optionalString(primary.limitId, "rate-limit id");
	const additional = response.rateLimitsByLimitId;
	if (additional !== undefined && additional !== null) {
		if (!isRecord(additional)) throw new Error("Codex rate-limit bucket map is invalid.");
		const entries = Object.entries(additional);
		if (entries.length > MAX_RATE_LIMIT_BUCKETS) throw new Error("Codex returned too many rate-limit buckets.");
		for (const [limitId, rawSnapshot] of entries) {
			if (limitId === primaryLimitId) continue;
			if (!isRecord(rawSnapshot)) throw new Error("Codex rate-limit bucket is invalid.");
			const snapshot = rawSnapshot as CodexAppServerRateLimitSnapshot;
			const prefix = snapshotLabel(snapshot, limitId);
			limits.push(...snapshotLimits(snapshot, prefix));
			planType ??= optionalString(snapshot.planType, "plan type");
			credits ??= snapshotCredits(snapshot);
		}
	}
	if (limits.length === 0 && !credits) return undefined;
	return {
		provider: PROVIDER_ID,
		...(planType ? { planType } : {}),
		limits,
		...(credits ? { credits } : {}),
	};
}

export async function readCodexNativeProviderUsage(client: CodexAppServerClient): Promise<AgentRuntimeProviderUsage | undefined> {
	return normalizeCodexNativeProviderUsage(await client.request("account/rateLimits/read", null, {
		timeoutMs: RATE_LIMIT_REQUEST_TIMEOUT_MS,
		retryOverloaded: false,
	}));
}
