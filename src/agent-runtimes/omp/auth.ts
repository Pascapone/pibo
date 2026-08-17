import { AgentRuntimeAuthError } from "../../agent-runtime/errors.js";
import {
	type AgentRuntimeAuthMethodCapability,
	type AgentRuntimeAuthOperationResult,
	type AgentRuntimeAuthPendingFlow,
	type AgentRuntimeAuthState,
	type AgentRuntimeAuthStatus,
	type CancelAgentRuntimeAuthInput,
	type CompleteAgentRuntimeAuthInput,
	type LogoutAgentRuntimeAuthInput,
	type StartAgentRuntimeAuthInput,
} from "../../agent-runtime/auth.js";
import { OmpRpcClient } from "./client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const OMP_AUTH_METHODS: readonly AgentRuntimeAuthMethodCapability[] = [
	{ id: "api_key", completion: "immediate" },
];

/**
 * OMP auth status/surface.
 *
 * V1 truthfulness: OMP's RPC exposes `get_login_providers`/`login`. We declare
 * `api_key` (immediate, env / models.yml configured keys) as the supported
 * method. OAuth / device-code browser-step methods are surfaced only when the
 * `open_url` extension_ui_request bridge is wired; until then they are not
 * advertised.
 */
export class OmpAuthController {
	private flowCounter = 0;

	constructor(private readonly client: OmpRpcClient) {}

	async getStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		try {
			const result = await this.client.request({ type: "get_login_providers" }, "get_login_providers");
			const data = result["data" as keyof typeof result];
			if (!isRecord(data) || !Array.isArray(data.providers)) {
				return [unknownOmpStatus()];
			}
			const statuses: AgentRuntimeAuthStatus[] = [];
			for (const provider of data.providers) {
				if (!isRecord(provider) || typeof provider.id !== "string") continue;
				const authenticated = provider.authenticated === true;
				const available = provider.available === true;
				statuses.push({
					id: provider.id,
					displayName: typeof provider.name === "string" ? provider.name : provider.id,
					state: ompAuthState(authenticated, available),
					configured: authenticated,
					methods: OMP_AUTH_METHODS,
					details: { accountType: authenticated ? "unknown" : "api_key" },
				});
			}
			return statuses.length > 0 ? statuses : [unknownOmpStatus()];
		} catch {
			return [unknownOmpStatus()];
		}
	}

	async start(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		if (input.method === "api_key") {
			// API-key auth is configured via provider config (env / models.yml);
			// report as connected when a provider is selected.
			return {
				providerId: input.providerId,
				state: "connected",
				configured: true,
				details: { accountType: "api_key" },
			};
		}
		// OAuth/device-code: the browser step is surfaced via an open_url
		// extension_ui_request only when the bridge is wired. Until then, report
		// as unsupported rather than inventing support (truthful capability).
		throw new AgentRuntimeAuthError(
			"orp_auth_unsupported",
			`OMP OAuth/device-code authentication (${input.method}) is not wired in the OMP adapter; use an API key.`,
		);
	}

	async complete(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		throw new AgentRuntimeAuthError(
			"orp_auth_unsupported",
			"OMP API-key auth completes via provider configuration, not an RPC completion step.",
		);
	}

	async cancel(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return { providerId: input.providerId, state: "disconnected", configured: false, message: "Login canceled." };
	}

	async logout(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		// OMP persists credentials in its own store; Pibo reports the action
		// without deleting user-global OMP state.
		return { providerId: input.providerId, state: "disconnected", configured: false };
	}

	async dispose(): Promise<void> {
		// no owned resources
	}
}

function ompAuthState(authenticated: boolean, available: boolean): AgentRuntimeAuthState {
	if (authenticated) return "connected";
	if (!available) return "unsupported";
	return "disconnected";
}

function unknownOmpStatus(): AgentRuntimeAuthStatus {
	return {
		id: "orp",
		displayName: "OMP providers",
		state: "unsupported" as AgentRuntimeAuthState,
		configured: false,
		methods: OMP_AUTH_METHODS,
		details: { accountType: "api_key" },
	};
}

export type { AgentRuntimeAuthPendingFlow as OmpAuthPendingFlow };