import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { classifySessionErrorMessage } from "../../core/session-errors.js";

/** Pi-native assistant classification belongs to the adapter, not Core recovery scheduling. */
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
