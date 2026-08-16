import { randomUUID } from "node:crypto";
import { aggregateAgentRuntimeAuthState, redactAgentRuntimeAuthText } from "../../agent-runtime/auth.js";
import {
	AgentRuntimeAuthError,
	AgentRuntimeCapabilityUnavailableError,
	AgentRuntimeContractError,
	AgentRuntimeUnavailableError,
} from "../../agent-runtime/errors.js";
import type {
	AgentRuntimeAuthCatalog,
	AgentRuntimeInstanceInspection,
	StartAgentRuntimeAuthInput,
} from "../../agent-runtime/types.js";
import type { PiboChannelContext } from "../../channels/types.js";
import { PiboWebHttpError, responseJson } from "../../web/http.js";

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeInstanceId(input: Record<string, unknown>): string {
	if (typeof input.runtimeInstanceId !== "string" || !input.runtimeInstanceId.trim()) {
		throw new PiboWebHttpError("runtimeInstanceId is required for provider authentication", 400);
	}
	return input.runtimeInstanceId.trim();
}

function providerId(input: Record<string, unknown>, action: string): string {
	const provider = typeof input.providerId === "string" ? input.providerId : input.provider;
	if (typeof provider !== "string" || !provider.trim()) {
		throw new PiboWebHttpError(`${action} requires providerId`, 400);
	}
	return provider.trim();
}

function flowId(input: Record<string, unknown>, action: string): string {
	const value = typeof input.flowId === "string" && input.flowId.trim()
		? input.flowId
		: typeof input.state === "string" && input.state.trim()
			? input.state
			: undefined;
	if (!value) throw new PiboWebHttpError(`${action} requires flowId`, 400);
	return value;
}

function safeRuntimeAuthError(error: unknown): never {
	if (error instanceof PiboWebHttpError) throw error;
	if (
		error instanceof AgentRuntimeAuthError
		|| error instanceof AgentRuntimeCapabilityUnavailableError
		|| error instanceof AgentRuntimeContractError
		|| error instanceof AgentRuntimeUnavailableError
	) {
		throw new PiboWebHttpError(redactAgentRuntimeAuthText(error.message), error instanceof AgentRuntimeUnavailableError ? 404 : 409);
	}
	throw new PiboWebHttpError("Runtime provider authentication failed safely. Retry after checking the selected runtime.", 502);
}

export function isProviderAuthAction(action: string): boolean {
	return action === "login.status"
		|| action === "login.start"
		|| action === "login.complete"
		|| action === "login.apikey"
		|| action === "login.cancel"
		|| action === "logout";
}

export function buildProviderAuthCatalog(
	inspections: readonly AgentRuntimeInstanceInspection[],
	defaultRuntimeInstanceId?: string,
): AgentRuntimeAuthCatalog {
	return {
		...(defaultRuntimeInstanceId ? { defaultRuntimeInstanceId } : {}),
		targets: inspections.map((runtime) => {
			const supported = runtime.capabilities.auth.status;
			const providers = runtime.auth ?? [];
			const state = !supported
				? "unsupported"
				: !runtime.enabled || !runtime.available
					? "failed"
					: aggregateAgentRuntimeAuthState(providers, true);
			return {
				runtimeInstanceId: runtime.id,
				adapterId: runtime.adapterId,
				displayName: runtime.displayName,
				enabled: runtime.enabled,
				available: runtime.available,
				isDefault: runtime.id === defaultRuntimeInstanceId,
				credentialScope: runtime.capabilities.auth.credentialScope,
				cancelSupported: runtime.capabilities.auth.cancel,
				logoutSupported: runtime.capabilities.auth.logout,
				state,
				providers: providers.map((provider) => structuredClone(provider)),
				diagnostics: runtime.diagnostics.map(({ severity, code, message }) => ({ severity, code, message })),
			};
		}),
	};
}

export async function readProviderAuthCatalog(
	context: PiboChannelContext,
	defaultRuntimeInstanceId?: string,
): Promise<AgentRuntimeAuthCatalog> {
	const configured = context.getCapabilityCatalog?.().agentRuntimes;
	const inspections: AgentRuntimeInstanceInspection[] = configured
		? configured.map((runtime) => ({ ...runtime, available: runtime.enabled, diagnostics: [] }))
		: context.inspectAgentRuntimeInstances
			? await context.inspectAgentRuntimeInstances()
			: (() => { throw new PiboWebHttpError("Runtime authentication inspection is not available", 501); })();
	const refreshed = await Promise.all(inspections.map(async (runtime): Promise<AgentRuntimeInstanceInspection> => {
		if (!runtime.enabled || !runtime.capabilities.auth.status || !context.getAgentRuntimeAuthStatus) return runtime;
		try {
			return { ...runtime, auth: [...await context.getAgentRuntimeAuthStatus(runtime.id)] };
		} catch {
			return {
				...runtime,
				available: false,
				auth: undefined,
				diagnostics: [
					...runtime.diagnostics,
					{
						severity: "warning",
						code: "runtime_auth_status_failed",
						message: `Authentication status is unavailable for runtime instance "${runtime.id}".`,
					},
				],
			};
		}
	}));
	return buildProviderAuthCatalog(refreshed, defaultRuntimeInstanceId);
}

export async function executeProviderAuthAction(
	context: PiboChannelContext,
	action: string,
	params: unknown,
): Promise<unknown> {
	const input = isJsonObject(params) ? params : {};
	try {
		const selectedRuntime = runtimeInstanceId(input);
		if (action === "login.status") {
			if (!context.getAgentRuntimeAuthStatus) throw new PiboWebHttpError("Runtime authentication status is not available", 501);
			const selectedProvider = typeof input.providerId === "string"
				? input.providerId
				: typeof input.provider === "string"
					? input.provider
					: undefined;
			const providers = await context.getAgentRuntimeAuthStatus(selectedRuntime);
			return {
				runtimeInstanceId: selectedRuntime,
				providers: selectedProvider ? providers.filter((provider) => provider.id === selectedProvider) : providers,
			};
		}
		const selectedProvider = providerId(input, action);
		if (action === "login.start") {
			if (!context.startAgentRuntimeAuth) throw new PiboWebHttpError("Runtime authentication login is not available", 501);
			let method = input.method;
			if (method === undefined) {
				if (!context.getAgentRuntimeAuthStatus) throw new PiboWebHttpError("Runtime authentication status is not available", 501);
				const status = (await context.getAgentRuntimeAuthStatus(selectedRuntime)).find((provider) => provider.id === selectedProvider);
				method = status?.methods.find((candidate) => candidate.id !== "api_key")?.id;
			}
			if (method !== "device_code" && method !== "browser_oauth") {
				throw new PiboWebHttpError("login.start requires a supported interactive method", 400);
			}
			return await context.startAgentRuntimeAuth(selectedRuntime, { providerId: selectedProvider, method });
		}
		if (action === "login.apikey") {
			if (!context.startAgentRuntimeAuth) throw new PiboWebHttpError("Runtime API-key authentication is not available", 501);
			if (typeof input.apiKey !== "string" || input.apiKey.length === 0) {
				throw new PiboWebHttpError("login.apikey requires apiKey", 400);
			}
			const start: StartAgentRuntimeAuthInput = { providerId: selectedProvider, method: "api_key", apiKey: input.apiKey };
			return await context.startAgentRuntimeAuth(selectedRuntime, start);
		}
		if (action === "login.complete") {
			if (!context.completeAgentRuntimeAuth) throw new PiboWebHttpError("Runtime authentication completion is not available", 501);
			if (input.code !== undefined && typeof input.code !== "string") {
				throw new PiboWebHttpError("login.complete code must be a string when provided", 400);
			}
			return await context.completeAgentRuntimeAuth(selectedRuntime, {
				providerId: selectedProvider,
				flowId: flowId(input, action),
				...(typeof input.code === "string" ? { code: input.code } : {}),
			});
		}
		if (action === "login.cancel") {
			if (!context.cancelAgentRuntimeAuth) throw new PiboWebHttpError("Runtime authentication cancellation is not available", 501);
			return await context.cancelAgentRuntimeAuth(selectedRuntime, {
				providerId: selectedProvider,
				flowId: flowId(input, action),
			});
		}
		if (action === "logout") {
			if (!context.logoutAgentRuntimeAuth) throw new PiboWebHttpError("Runtime authentication logout is not available", 501);
			return await context.logoutAgentRuntimeAuth(selectedRuntime, { providerId: selectedProvider });
		}
		throw new PiboWebHttpError(`Unsupported provider auth action ${action}`, 400);
	} catch (error) {
		safeRuntimeAuthError(error);
	}
}

export function providerAuthActionResponse(input: { piboSessionId?: string; action: string; result: unknown }): Response {
	return responseJson({
		type: "execution_result",
		piboSessionId: input.piboSessionId ?? "",
		eventId: randomUUID(),
		action: input.action,
		result: input.result,
	});
}
