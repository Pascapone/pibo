import {
	AGENT_RUNTIME_AUTH_COMPLETION_MODES,
	AGENT_RUNTIME_AUTH_METHOD_IDS,
	redactAgentRuntimeAuthText,
	type AgentRuntimeAuthDetails,
	type AgentRuntimeAuthMethodCapability,
	type AgentRuntimeAuthOperationResult,
	type AgentRuntimeAuthPendingFlow,
	type AgentRuntimeAuthState,
	type AgentRuntimeAuthStatus,
} from "./auth.js";
import {
	AgentRuntimeAuthError,
	AgentRuntimeContractError,
	AgentRuntimeRegistrationError,
} from "./errors.js";
import type { AgentRuntimeAdapter } from "./types.js";

const AUTH_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const AUTH_STATES = new Set<AgentRuntimeAuthState>([
	"connected",
	"disconnected",
	"pending",
	"partial",
	"unsupported",
	"failed",
]);

export function assertAuthId(value: string, label: string, runtimeInstanceId = "auth"): void {
	if (!AUTH_ID_PATTERN.test(value)) {
		throw new AgentRuntimeContractError(runtimeInstanceId, `${label} must match ${AUTH_ID_PATTERN}.`);
	}
}

export function scopedAuthContractError(error: AgentRuntimeContractError, runtimeInstanceId: string): AgentRuntimeContractError {
	return error.runtimeInstanceId === runtimeInstanceId
		? error
		: new AgentRuntimeContractError(runtimeInstanceId, error.message, { cause: error });
}

function boundedAuthText(value: unknown, label: string, maxLength: number): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new AgentRuntimeContractError("auth", `${label} must be a non-empty string no longer than ${maxLength} characters.`);
	}
	return redactAgentRuntimeAuthText(value, maxLength);
}

export function safeAdapterAuthError(error: unknown, operation: string): AgentRuntimeAuthError {
	if (error instanceof AgentRuntimeAuthError) {
		const code = /^[a-z][a-z0-9._-]{0,63}$/.test(error.code) ? error.code : "runtime_auth_failed";
		return new AgentRuntimeAuthError(code, redactAgentRuntimeAuthText(error.message), error.retryable === true);
	}
	return new AgentRuntimeAuthError(
		"runtime_auth_failed",
		`Runtime provider authentication ${operation} failed safely.`,
		true,
	);
}

function cloneAuthDetails(value: AgentRuntimeAuthDetails | undefined): AgentRuntimeAuthDetails | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AgentRuntimeContractError("auth", "Auth details must be an object when provided.");
	}
	const details: AgentRuntimeAuthDetails = {};
	if (value.accountType !== undefined) {
		if (!["api_key", "oauth", "chatgpt", "unknown"].includes(value.accountType)) {
			throw new AgentRuntimeContractError("auth", "Auth details contain an invalid account type.");
		}
		details.accountType = value.accountType;
	}
	if (value.planType !== undefined) {
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.planType)) {
			throw new AgentRuntimeContractError("auth", "Auth details contain an invalid plan type.");
		}
		details.planType = value.planType;
	}
	return Object.keys(details).length > 0 ? details : undefined;
}

function declaredAuthMethod(
	methods: readonly AgentRuntimeAuthMethodCapability[],
	methodId: string,
): AgentRuntimeAuthMethodCapability {
	const method = methods.find((candidate) => candidate.id === methodId);
	if (!method) throw new AgentRuntimeContractError("auth", `Auth method "${methodId}" was not declared by the runtime adapter.`);
	return method;
}

function cloneAuthFlow(
	value: AgentRuntimeAuthPendingFlow,
	methods: readonly AgentRuntimeAuthMethodCapability[],
): AgentRuntimeAuthPendingFlow {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AgentRuntimeContractError("auth", "Auth flow must be an object.");
	}
	assertAuthId(value.flowId, "Auth flow id");
	if (!AGENT_RUNTIME_AUTH_METHOD_IDS.includes(value.method)) {
		throw new AgentRuntimeContractError("auth", `Auth flow method "${String(value.method)}" is invalid.`);
	}
	if (!AGENT_RUNTIME_AUTH_COMPLETION_MODES.includes(value.completion)) {
		throw new AgentRuntimeContractError("auth", `Auth flow completion mode "${String(value.completion)}" is invalid.`);
	}
	const declared = declaredAuthMethod(methods, value.method);
	if (declared.completion !== value.completion) {
		throw new AgentRuntimeContractError("auth", `Auth flow completion mode does not match declared method "${value.method}".`);
	}
	if (typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
		throw new AgentRuntimeContractError("auth", "Auth flow startedAt must be an ISO timestamp.");
	}
	if (
		value.expiresAt !== undefined
		&& (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)))
	) {
		throw new AgentRuntimeContractError("auth", "Auth flow expiresAt must be an ISO timestamp.");
	}
	const verificationUrl = boundedAuthText(value.verificationUrl, "Auth verification URL", 2_048);
	if (verificationUrl) {
		let parsed: URL;
		try {
			parsed = new URL(verificationUrl);
		} catch {
			throw new AgentRuntimeContractError("auth", "Auth verification URL is invalid.");
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			throw new AgentRuntimeContractError("auth", "Auth verification URL must use HTTP or HTTPS.");
		}
	}
	return {
		flowId: value.flowId,
		method: value.method,
		completion: value.completion,
		startedAt: new Date(value.startedAt).toISOString(),
		...(value.expiresAt ? { expiresAt: new Date(value.expiresAt).toISOString() } : {}),
		...(verificationUrl ? { verificationUrl } : {}),
		...(value.userCode ? { userCode: boundedAuthText(value.userCode, "Auth user code", 128)! } : {}),
		...(value.instructions ? { instructions: boundedAuthText(value.instructions, "Auth instructions", 1_000)! } : {}),
	};
}

function validateAuthConfiguredState(state: AgentRuntimeAuthState, configured: boolean): void {
	if (state === "connected" && !configured) {
		throw new AgentRuntimeContractError("auth", "Connected auth status must be configured.");
	}
	if ((state === "disconnected" || state === "unsupported") && configured) {
		throw new AgentRuntimeContractError("auth", `${state} auth status cannot be configured.`);
	}
}

export function cloneAuthStatus(
	value: AgentRuntimeAuthStatus,
	declaredMethods: readonly AgentRuntimeAuthMethodCapability[],
): AgentRuntimeAuthStatus {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AgentRuntimeContractError("auth", "Auth provider status must be an object.");
	}
	assertAuthId(value.id, "Auth provider id");
	if (!AUTH_STATES.has(value.state)) {
		throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" reported invalid state "${String(value.state)}".`);
	}
	if (typeof value.configured !== "boolean") {
		throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" must report configured as a boolean.`);
	}
	validateAuthConfiguredState(value.state, value.configured);
	if (!Array.isArray(value.methods)) {
		throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" must report methods.`);
	}
	const seen = new Set<string>();
	const methods = value.methods.map((method) => {
		if (!method || typeof method !== "object" || Array.isArray(method)) {
			throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" reported an invalid method.`);
		}
		if (seen.has(method.id)) throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" repeats method "${method.id}".`);
		seen.add(method.id);
		const declared = declaredAuthMethod(declaredMethods, method.id);
		if (declared.completion !== method.completion) {
			throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" method "${method.id}" has a mismatched completion mode.`);
		}
		return { ...declared };
	});
	if (value.state === "pending" && !value.pending) {
		throw new AgentRuntimeContractError("auth", `Pending auth provider "${value.id}" must include a flow.`);
	}
	if (value.state !== "pending" && value.pending) {
		throw new AgentRuntimeContractError("auth", `Auth provider "${value.id}" includes a flow while state is "${value.state}".`);
	}
	return {
		id: value.id,
		...(value.displayName ? { displayName: boundedAuthText(value.displayName, "Auth provider display name", 160)! } : {}),
		state: value.state,
		configured: value.configured,
		methods,
		...(value.pending ? { pending: cloneAuthFlow(value.pending, declaredMethods) } : {}),
		...(value.message ? { message: boundedAuthText(value.message, "Auth status message", 1_000)! } : {}),
		...(value.details ? { details: cloneAuthDetails(value.details)! } : {}),
	};
}

export function cloneAuthOperationResult(
	value: AgentRuntimeAuthOperationResult,
	inputProviderId: string,
	declaredMethods: readonly AgentRuntimeAuthMethodCapability[],
): AgentRuntimeAuthOperationResult {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AgentRuntimeContractError("auth", "Auth operation result must be an object.");
	}
	assertAuthId(value.providerId, "Auth result provider id");
	if (value.providerId !== inputProviderId) {
		throw new AgentRuntimeContractError("auth", `Auth result provider "${value.providerId}" does not match requested provider "${inputProviderId}".`);
	}
	if (!AUTH_STATES.has(value.state)) {
		throw new AgentRuntimeContractError("auth", `Auth result reported invalid state "${String(value.state)}".`);
	}
	if (typeof value.configured !== "boolean") {
		throw new AgentRuntimeContractError("auth", "Auth result configured must be a boolean.");
	}
	validateAuthConfiguredState(value.state, value.configured);
	if (value.state === "pending" && !value.flow) {
		throw new AgentRuntimeContractError("auth", "Pending auth result must include a flow.");
	}
	if (value.state !== "pending" && value.flow) {
		throw new AgentRuntimeContractError("auth", `Auth result includes a flow while state is "${value.state}".`);
	}
	return {
		providerId: value.providerId,
		state: value.state,
		configured: value.configured,
		...(value.flow ? { flow: cloneAuthFlow(value.flow, declaredMethods) } : {}),
		...(value.message ? { message: boundedAuthText(value.message, "Auth result message", 1_000)! } : {}),
		...(value.details ? { details: cloneAuthDetails(value.details)! } : {}),
	};
}

export function assertAdapterAuthContract(adapter: AgentRuntimeAdapter): void {
	const auth = adapter.descriptor.capabilities.auth;
	if (auth.status !== Boolean(adapter.getAuthStatus)) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" auth.status must match getAuthStatus().`,
		);
	}
	if ((auth.methods.length > 0) !== Boolean(adapter.startAuth)) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" declared auth methods must match startAuth().`,
		);
	}
	const needsCompletion = auth.methods.some((method) => method.completion !== "immediate");
	if (needsCompletion !== Boolean(adapter.completeAuth)) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" non-immediate auth methods must match completeAuth().`,
		);
	}
	if (needsCompletion && !adapter.disposeAuth) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" non-immediate auth methods require disposeAuth().`,
		);
	}
	if (auth.cancel !== Boolean(adapter.cancelAuth)) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" auth.cancel must match cancelAuth().`,
		);
	}
	if (auth.logout !== Boolean(adapter.logoutAuth)) {
		throw new AgentRuntimeRegistrationError(
			`Agent runtime instance "${adapter.instanceId}" auth.logout must match logoutAuth().`,
		);
	}
}
