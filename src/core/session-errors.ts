import type { PiboSessionErrorDetails } from "./events.js";

const PROVIDER_NETWORK_ERROR_MARKERS = [
	"fetch failed",
	"network error",
	"connection error",
	"connection refused",
	"connection lost",
	"connection reset",
	"other side closed",
	"upstream connect",
	"reset before headers",
	"socket hang up",
	"socket connection was closed",
	"eai_again",
	"enotfound",
	"econnreset",
	"econnrefused",
	"etimedout",
];

export function classifySessionErrorMessage(
	message: string,
	options: { hasProviderContext?: boolean } = {},
): Pick<PiboSessionErrorDetails, "category" | "errorClass" | "code" | "origin" | "retryable" | "userMessage"> {
	const normalized = message.toLowerCase();
	if (normalized.includes("context_length_exceeded") || normalized.includes("context window")) {
		return { category: "context_overflow", errorClass: "provider_context", code: "context_length_exceeded", origin: "provider", retryable: false, userMessage: "The model context window was exceeded." };
	}
	if (normalized.includes("websocket")) {
		return { category: "provider_transport", errorClass: "provider_transport", code: "websocket_error", origin: "provider", retryable: true, userMessage: "The provider WebSocket connection failed." };
	}
	if (normalized.includes("request was aborted") || normalized.includes("aborted")) {
		return { category: "runtime_abort", errorClass: "runtime_abort", code: "request_aborted", origin: "runtime", retryable: false, userMessage: "The active model request was aborted." };
	}
	if (
		normalized.includes("insufficient_quota")
		|| normalized.includes("quota exceeded")
		|| normalized.includes("out of budget")
		|| normalized.includes("billing")
		|| normalized.includes("usage limit")
		|| normalized.includes("available balance")
	) {
		return { category: "quota_exhausted", errorClass: "provider_rate_limit", code: "quota_exhausted", origin: "provider", retryable: false, userMessage: "The provider quota or billing limit was reached." };
	}
	if (normalized.includes("rate limit") || normalized.includes("429")) {
		return { category: "rate_limit", errorClass: "provider_rate_limit", code: "rate_limited", origin: "provider", retryable: true, userMessage: "The provider rate limit was reached." };
	}
	if (normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("api key") || normalized.includes("401") || normalized.includes("403")) {
		return { category: "auth", errorClass: "provider_auth", code: "provider_auth_failed", origin: "provider", retryable: false, userMessage: "Provider authentication failed." };
	}
	if (normalized.includes("timeout") || normalized.includes("timed out")) {
		return { category: "provider_transport", errorClass: "provider_transport", code: "timeout", origin: "provider", retryable: true, userMessage: "The provider request timed out." };
	}
	if (PROVIDER_NETWORK_ERROR_MARKERS.some((marker) => normalized.includes(marker))) {
		return { category: "provider_transport", errorClass: "provider_transport", code: "network_error", origin: "provider", retryable: true, userMessage: "The provider network connection failed." };
	}
	if (/\b5\d\d\b/.test(normalized)) {
		return { category: "provider_server", errorClass: "provider_server", code: "provider_server_error", origin: "provider", retryable: true, userMessage: "The provider returned a server error." };
	}
	if (options.hasProviderContext) {
		return { category: "provider_error", errorClass: "provider_error", code: "provider_error", origin: "provider", retryable: undefined, userMessage: "The provider request failed." };
	}
	return { category: "runtime_error", errorClass: "runtime_error", code: "runtime_error", origin: "runtime", retryable: undefined, userMessage: "The session runtime failed." };
}

export function normalizeSessionErrorDetails(message: string, details: PiboSessionErrorDetails | undefined): PiboSessionErrorDetails {
	const classification = classifySessionErrorMessage(details?.providerCode ?? details?.providerMessage ?? message, {
		hasProviderContext: Boolean(details?.api || details?.provider || details?.model || details?.providerCode || details?.providerMessage),
	});
	return {
		...classification,
		...details,
		category: details?.category ?? classification.category,
		errorClass: details?.errorClass ?? classification.errorClass,
		code: details?.code ?? details?.providerCode ?? classification.code,
		origin: details?.origin ?? classification.origin,
		retryable: details?.retryable ?? classification.retryable,
		userMessage: details?.userMessage ?? classification.userMessage,
		severity: details?.severity ?? "error",
	};
}

export function runtimeSessionErrorDetails(message: string): PiboSessionErrorDetails {
	return normalizeSessionErrorDetails(message, undefined);
}
