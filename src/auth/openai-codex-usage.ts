import { createHash } from "node:crypto";
import {
	readPiCredential,
	resolvePiProviderAuth,
} from "../agent-runtimes/pi/credentials.js";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_JWT_CLAIM_PATH = "https://api.openai.com/auth";

export type PiboProviderUsageWindow = {
	label: string;
	usedPercent: number;
	remainingPercent: number;
	windowMinutes?: number;
	resetsAt?: string;
};

export type PiboProviderUsageStatus = {
	provider: "openai-codex";
	planType?: string;
	limits: PiboProviderUsageWindow[];
	credits?: {
		unlimited: boolean;
		balance?: string;
	};
	fetchedAt: string;
};

const USAGE_REFRESH_MS = 30_000;
const USAGE_MAX_STALE_MS = 5 * 60_000;
const USAGE_REQUEST_TIMEOUT_MS = 2_000;

// One bounded, credential-scoped snapshot shared by sessions. Never retain raw credentials.
let usageCache: {
	key: string;
	value?: PiboProviderUsageStatus;
	refreshAfter: number;
	pending?: Promise<PiboProviderUsageStatus | undefined>;
} | undefined;

type RawObject = Record<string, unknown>;

function isRecord(value: unknown): value is RawObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): RawObject | undefined {
	return isRecord(value) ? value : undefined;
}

function optionalBoxedObject(value: unknown): RawObject | undefined {
	if (isRecord(value)) return value;
	return undefined;
}

function getField(obj: RawObject, snake: string, camel: string): unknown {
	return obj[snake] ?? obj[camel];
}

function decodeJwt(token: string): RawObject | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		const decoded = Buffer.from(padded, "base64").toString("utf8");
		const parsed = JSON.parse(decoded) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function getOpenAiAccountId(accessToken: string, storedAccountId: unknown): string | undefined {
	const stored = stringValue(storedAccountId);
	if (stored) return stored;
	const payload = decodeJwt(accessToken);
	const auth = payload ? objectValue(payload[OPENAI_JWT_CLAIM_PATH]) : undefined;
	return auth ? stringValue(auth.chatgpt_account_id) : undefined;
}

function formatLimitLabel(window: RawObject, fallback: string): string {
	const seconds = numberValue(getField(window, "limit_window_seconds", "limitWindowSeconds"));
	if (!seconds || seconds <= 0) return fallback;
	const minutes = Math.round(seconds / 60);
	if (minutes % (7 * 24 * 60) === 0) return `${minutes / (7 * 24 * 60)}w`;
	if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

function normalizeWindow(value: unknown, fallbackLabel: string): PiboProviderUsageWindow | undefined {
	const window = optionalBoxedObject(value);
	if (!window) return undefined;
	const usedPercent = numberValue(getField(window, "used_percent", "usedPercent"));
	if (usedPercent === undefined) return undefined;
	const seconds = numberValue(getField(window, "limit_window_seconds", "limitWindowSeconds"));
	const resetAt = numberValue(getField(window, "reset_at", "resetAt"));
	return {
		label: `${formatLimitLabel(window, fallbackLabel)} limit`,
		usedPercent,
		remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
		windowMinutes: seconds && seconds > 0 ? Math.round(seconds / 60) : undefined,
		resetsAt: resetAt ? new Date(resetAt * 1000).toISOString() : undefined,
	};
}

function normalizeRateLimit(rateLimit: RawObject | undefined): PiboProviderUsageWindow[] {
	if (!rateLimit) return [];
	return [
		normalizeWindow(getField(rateLimit, "primary_window", "primaryWindow"), "5h"),
		normalizeWindow(getField(rateLimit, "secondary_window", "secondaryWindow"), "weekly"),
	].filter((entry): entry is PiboProviderUsageWindow => Boolean(entry));
}

function normalizeCredits(value: unknown): PiboProviderUsageStatus["credits"] | undefined {
	const credits = objectValue(value);
	if (!credits) return undefined;
	if (credits.has_credits !== true && credits.hasCredits !== true) return undefined;
	return {
		unlimited: credits.unlimited === true,
		balance: stringValue(credits.balance),
	};
}

function normalizeUsagePayload(payload: unknown): PiboProviderUsageStatus | undefined {
	if (!isRecord(payload)) return undefined;
	const planType = stringValue(getField(payload, "plan_type", "planType"));
	const limits = normalizeRateLimit(objectValue(getField(payload, "rate_limit", "rateLimit")));
	const additional = getField(payload, "additional_rate_limits", "additionalRateLimits");
	if (Array.isArray(additional)) {
		for (const item of additional) {
			const detail = objectValue(item);
			const rateLimit = detail ? objectValue(getField(detail, "rate_limit", "rateLimit")) : undefined;
			const limitName = detail ? stringValue(getField(detail, "limit_name", "limitName")) : undefined;
			for (const window of normalizeRateLimit(rateLimit)) {
				limits.push(limitName ? { ...window, label: `${limitName} ${window.label}` } : window);
			}
		}
	}
	const credits = normalizeCredits(getField(payload, "credits", "credits"));
	if (limits.length === 0 && !credits) return undefined;
	return {
		provider: OPENAI_CODEX_PROVIDER,
		planType,
		limits,
		credits,
		fetchedAt: new Date().toISOString(),
	};
}

export async function getOpenAiCodexProviderUsageForActiveModel(activeModel: { provider: string } | undefined): Promise<PiboProviderUsageStatus | undefined> {
	if (activeModel?.provider !== OPENAI_CODEX_PROVIDER) return undefined;

	const credential = await readPiCredential(OPENAI_CODEX_PROVIDER);
	if (credential?.type !== "oauth") {
		usageCache = undefined;
		return undefined;
	}

	const key = createHash("sha256").update(JSON.stringify(credential)).digest("hex");
	if (usageCache?.key !== key) usageCache = { key, refreshAfter: 0 };
	const cache = usageCache;
	const now = Date.now();
	const usable = () => cache.value && Date.now() - Date.parse(cache.value.fetchedAt) < USAGE_MAX_STALE_MS
		? cache.value
		: undefined;
	if (now < cache.refreshAfter) return usable();
	cache.pending ??= fetchOpenAiCodexProviderUsage(credential.accountId)
		.then((value) => { cache.value = value; return value; })
		.catch(() => usable())
		.finally(() => {
			cache.refreshAfter = Date.now() + USAGE_REFRESH_MS;
			cache.pending = undefined;
		});
	// Quota is advisory: stale-while-revalidate keeps repeat status commands local.
	return usable() ?? await cache.pending;
}

async function fetchOpenAiCodexProviderUsage(storedAccountId: unknown): Promise<PiboProviderUsageStatus | undefined> {
	const resolvedAuth = await resolvePiProviderAuth(OPENAI_CODEX_PROVIDER);
	const accessToken = resolvedAuth?.auth.apiKey;
	if (!accessToken) return undefined;

	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		"User-Agent": "codex-cli",
	};
	const accountId = getOpenAiAccountId(accessToken, storedAccountId);
	if (accountId) headers["ChatGPT-Account-Id"] = accountId;

	const response = await fetch(OPENAI_CODEX_USAGE_URL, { headers, signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS) });
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`OpenAI Codex usage request failed: ${response.status}`);
	}
	return normalizeUsagePayload(await response.json());
}
