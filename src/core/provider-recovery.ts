import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { classifySessionErrorMessage } from "./session-errors.js";

export const PIBO_PROVIDER_RECOVERY_MESSAGE_TYPE = "pibo-provider-recovery-resume";
export const PIBO_PROVIDER_RECOVERY_PROMPT = "Continue the interrupted task autonomously from the existing session state. The previous provider request failed transiently. Do not wait for more user input, ask the user to repeat the request, or mention this recovery message unless the failure affects the result.";

const DEFAULT_RECOVERY_BASE_DELAY_MS = 2_000;
const DEFAULT_RECOVERY_MAX_DELAY_MS = 60_000;

export type PiboProviderRecoverySettings = {
	enabled: boolean;
	baseDelayMs: number;
	maxDelayMs: number;
};

type RetrySettingsManager = {
	getRetrySettings(): { enabled: boolean; baseDelayMs: number };
	getProviderRetrySettings(): { maxRetryDelayMs: number };
};

export class PiboProviderRecoveryCancelledError extends Error {
	constructor(message = "Provider recovery cancelled") {
		super(message);
		this.name = "PiboProviderRecoveryCancelledError";
	}
}

export function resolvePiboProviderRecoverySettings(
	settingsManager: RetrySettingsManager | undefined,
): PiboProviderRecoverySettings {
	if (!settingsManager) {
		return {
			enabled: false,
			baseDelayMs: DEFAULT_RECOVERY_BASE_DELAY_MS,
			maxDelayMs: DEFAULT_RECOVERY_MAX_DELAY_MS,
		};
	}
	const retry = settingsManager.getRetrySettings();
	const provider = settingsManager.getProviderRetrySettings();
	return {
		enabled: retry.enabled,
		baseDelayMs: Math.max(0, retry.baseDelayMs),
		maxDelayMs: provider.maxRetryDelayMs > 0 ? provider.maxRetryDelayMs : DEFAULT_RECOVERY_MAX_DELAY_MS,
	};
}

export function piboProviderRecoveryDelayMs(
	attempt: number,
	settings: Pick<PiboProviderRecoverySettings, "baseDelayMs" | "maxDelayMs">,
): number {
	const exponent = Math.max(0, Math.floor(attempt) - 1);
	const uncapped = settings.baseDelayMs * 2 ** Math.min(exponent, 30);
	return Math.min(settings.maxDelayMs, Number.isFinite(uncapped) ? uncapped : settings.maxDelayMs);
}

export function isRetryablePiboAssistantError(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const assistantMessage = message as AssistantMessage;
	if (isRetryableAssistantError(assistantMessage)) return true;
	return typeof assistantMessage.errorMessage === "string"
		&& classifySessionErrorMessage(assistantMessage.errorMessage, { hasProviderContext: true }).retryable === true;
}

export function isRetryablePiboProviderError(error: unknown): boolean {
	const errorMessage = error instanceof Error ? error.message : String(error);
	return isRetryablePiboAssistantError({ stopReason: "error", errorMessage } as AssistantMessage);
}

export async function waitForPiboProviderRecovery(
	attempt: number,
	settings: PiboProviderRecoverySettings,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) throw new PiboProviderRecoveryCancelledError();
	const delayMs = piboProviderRecoveryDelayMs(attempt, settings);
	if (delayMs <= 0) return;

	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new PiboProviderRecoveryCancelledError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
