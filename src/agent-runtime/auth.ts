import { redactSensitiveText } from "../core/sensitive-data-redaction.js";

export const AGENT_RUNTIME_AUTH_METHOD_IDS = ["device_code", "browser_oauth", "api_key"] as const;
export type AgentRuntimeAuthMethodId = (typeof AGENT_RUNTIME_AUTH_METHOD_IDS)[number];

export const AGENT_RUNTIME_AUTH_COMPLETION_MODES = ["immediate", "explicit", "notification"] as const;
export type AgentRuntimeAuthCompletionMode = (typeof AGENT_RUNTIME_AUTH_COMPLETION_MODES)[number];

export type AgentRuntimeAuthCredentialScope = "runtime-instance" | "adapter-shared";

export type AgentRuntimeAuthMethodCapability = {
	id: AgentRuntimeAuthMethodId;
	completion: AgentRuntimeAuthCompletionMode;
};

export type AgentRuntimeAuthState =
	| "connected"
	| "disconnected"
	| "pending"
	| "partial"
	| "unsupported"
	| "failed";

export type AgentRuntimeAuthPendingFlow = {
	flowId: string;
	method: AgentRuntimeAuthMethodId;
	completion: AgentRuntimeAuthCompletionMode;
	startedAt: string;
	expiresAt?: string;
	verificationUrl?: string;
	userCode?: string;
	instructions?: string;
};

export type AgentRuntimeAuthDetails = {
	accountType?: "api_key" | "oauth" | "chatgpt" | "unknown";
	planType?: string;
};

/** Product-safe status; details intentionally exclude account identifiers. */
export type AgentRuntimeAuthStatus = {
	id: string;
	displayName?: string;
	state: AgentRuntimeAuthState;
	configured: boolean;
	methods: readonly AgentRuntimeAuthMethodCapability[];
	pending?: AgentRuntimeAuthPendingFlow;
	message?: string;
	details?: AgentRuntimeAuthDetails;
};

export type StartAgentRuntimeAuthInput =
	| { providerId: string; method: "api_key"; apiKey: string }
	| { providerId: string; method: "device_code" | "browser_oauth" };

export type CompleteAgentRuntimeAuthInput = {
	providerId: string;
	flowId: string;
	code?: string;
};

export type CancelAgentRuntimeAuthInput = {
	providerId: string;
	flowId: string;
};

export type LogoutAgentRuntimeAuthInput = {
	providerId: string;
};

export type AgentRuntimeAuthOperationResult = {
	providerId: string;
	state: AgentRuntimeAuthState;
	configured: boolean;
	flow?: AgentRuntimeAuthPendingFlow;
	message?: string;
	details?: AgentRuntimeAuthDetails;
};

export type AgentRuntimeAuthTargetOperationResult = AgentRuntimeAuthOperationResult & {
	runtimeInstanceId: string;
};

export type AgentRuntimeAuthTarget = {
	runtimeInstanceId: string;
	adapterId: string;
	displayName: string;
	enabled: boolean;
	available: boolean;
	isDefault: boolean;
	credentialScope: AgentRuntimeAuthCredentialScope;
	cancelSupported: boolean;
	logoutSupported: boolean;
	state: AgentRuntimeAuthState;
	providers: readonly AgentRuntimeAuthStatus[];
	diagnostics: readonly {
		severity: "info" | "warning" | "error";
		code: string;
		message: string;
	}[];
};

export type AgentRuntimeAuthCatalog = {
	defaultRuntimeInstanceId?: string;
	targets: readonly AgentRuntimeAuthTarget[];
};

export function redactAgentRuntimeAuthText(value: string, maxLength = 1_000): string {
	return redactSensitiveText(value)
		.replace(/\b(account[_-]?id)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi, "$1$2[redacted]")
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted account]")
		.replace(/`(?:\/|[A-Za-z]:[\\/])[^`\r\n]+`/g, "`[redacted path]`")
		.replace(/\bfile:\/\/\/?[^\s"'`,)]+/gi, "file://[redacted path]")
		.slice(0, maxLength);
}

export function isConfiguredAgentRuntimeAuthState(state: AgentRuntimeAuthState): boolean {
	return state === "connected" || state === "partial";
}

export function aggregateAgentRuntimeAuthState(
	providers: readonly Pick<AgentRuntimeAuthStatus, "state">[],
	supported: boolean,
): AgentRuntimeAuthState {
	if (!supported) return "unsupported";
	if (providers.length === 0) return "failed";
	const states = new Set(providers.map((provider) => provider.state));
	if (states.size === 1) return providers[0]!.state;
	if (states.has("pending")) return "pending";
	return "partial";
}
