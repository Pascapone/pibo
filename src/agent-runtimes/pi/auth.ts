import { randomBytes, randomUUID } from "node:crypto";
import { AgentRuntimeAuthError } from "../../agent-runtime/errors.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthPendingFlow,
	AgentRuntimeAuthStatus,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "../../agent-runtime/types.js";
import type { ModelCatalog } from "./model-catalog.js";
import {
	deletePiCredential,
	getPiProviderAuthStatus,
	listPiCredentials,
	writePiCredential,
} from "./credentials.js";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_ISSUER_URL = "https://auth.openai.com";
const OPENAI_DEVICE_USER_CODE_URL = `${OPENAI_ISSUER_URL}/api/accounts/deviceauth/usercode`;
const OPENAI_DEVICE_TOKEN_URL = `${OPENAI_ISSUER_URL}/api/accounts/deviceauth/token`;
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_ISSUER_URL}/codex/device`;
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_ISSUER_URL}/deviceauth/callback`;
const OPENAI_SCOPE = "openid profile email offline_access";
const OPENAI_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_DEVICE_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const challenge = base64urlEncode(new Uint8Array(hashBuffer));

	return { verifier, challenge };
}

export type PendingLogin = {
	type: "browser";
	verifier: string;
	state: string;
	provider: string;
	createdAt: number;
};

export type PendingDeviceLogin = {
	type: "device";
	deviceAuthId: string;
	userCode: string;
	intervalMs: number;
	state: string;
	provider: string;
	createdAt: number;
};

const pendingLogins = new Map<string, PendingLogin | PendingDeviceLogin>();

function decodeJwt(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = atob(payload);
		return JSON.parse(decoded) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function getOpenAiAccountId(accessToken: string): string | null {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[OPENAI_JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
	const accountId = auth?.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function requirePendingLogin(state: string, provider: string): PendingLogin | PendingDeviceLogin {
	const pending = pendingLogins.get(state);
	if (!pending) {
		throw new Error("Invalid or expired login state. Start a new login flow with /login-start.");
	}
	if (pending.provider !== provider) {
		throw new Error(`Login state mismatch: expected provider "${pending.provider}", got "${provider}".`);
	}
	// Expire after 10 minutes
	if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
		pendingLogins.delete(state);
		throw new Error("Login state expired. Start a new login flow with /login-start.");
	}
	return pending;
}

type DeviceUserCodeResponse = {
	device_auth_id?: string;
	user_code?: string;
	usercode?: string;
	interval?: string | number;
};

type DeviceTokenResponse = {
	authorization_code?: string;
	code_verifier?: string;
	code_challenge?: string;
};

async function readResponseText(response: Response): Promise<string> {
	return await response.text().catch(() => "");
}

function parseDeviceIntervalMs(value: string | number | undefined): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 5000;
}

export type PiLoginStartResult =
	| {
		type: "device_code";
		url: string;
		verificationUrl: string;
		userCode: string;
		state: string;
		provider: string;
		instructions: string;
	}
	| {
		type: "browser_oauth";
		url: string;
		state: string;
		provider: string;
		instructions: string;
	};

async function startOpenAiDeviceLogin(provider: string): Promise<Extract<PiLoginStartResult, { type: "device_code" }>> {
	const response = await fetch(OPENAI_DEVICE_USER_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
	});

	if (!response.ok) {
		const text = await readResponseText(response);
		const suffix = text ? ` ${text}` : "";
		if (response.status === 404) {
			throw new Error(
				`OpenAI device code login is not enabled for this account or Codex server.${suffix}`,
			);
		}
		throw new Error(`OpenAI device code request failed: ${response.status}${suffix}`);
	}

	const json = (await response.json()) as DeviceUserCodeResponse;
	const deviceAuthId = json.device_auth_id;
	const userCode = json.user_code ?? json.usercode;
	if (!deviceAuthId || !userCode) {
		throw new Error("Invalid device code response from OpenAI");
	}

	const state = randomBytes(16).toString("hex");
	pendingLogins.set(state, {
		type: "device",
		deviceAuthId,
		userCode,
		intervalMs: parseDeviceIntervalMs(json.interval),
		state,
		provider,
		createdAt: Date.now(),
	});

	return {
		type: "device_code",
		url: OPENAI_DEVICE_VERIFICATION_URL,
		verificationUrl: OPENAI_DEVICE_VERIFICATION_URL,
		userCode,
		state,
		provider,
		instructions:
			"Open the URL in any browser, enter the one-time code, finish sign-in, then return here and complete login.",
	};
}

async function pollOpenAiDeviceAuthorization(pending: PendingDeviceLogin): Promise<DeviceTokenResponse> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < OPENAI_DEVICE_LOGIN_TIMEOUT_MS) {
		const response = await fetch(OPENAI_DEVICE_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				device_auth_id: pending.deviceAuthId,
				user_code: pending.userCode,
			}),
		});

		if (response.ok) {
			const json = (await response.json()) as DeviceTokenResponse;
			if (!json.authorization_code || !json.code_verifier) {
				throw new Error("Invalid device authorization response from OpenAI");
			}
			return json;
		}

		if (response.status !== 403 && response.status !== 404) {
			const text = await readResponseText(response);
			throw new Error(`OpenAI device authorization failed: ${response.status}${text ? ` ${text}` : ""}`);
		}

		await new Promise((resolve) => setTimeout(resolve, pending.intervalMs));
	}

	throw new Error("OpenAI device authorization timed out after 15 minutes.");
}

async function exchangeOpenAiAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
	const response = await fetch(OPENAI_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});

	if (!response.ok) {
		const text = await readResponseText(response);
		throw new Error(`Token exchange failed: ${response.status} ${text}`);
	}

	const json = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		throw new Error("Invalid token response from OpenAI");
	}

	return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
}

export async function startLogin(provider: string): Promise<PiLoginStartResult> {
	if (provider === "openai-codex") {
		return await startOpenAiDeviceLogin(provider);
	}

	if (provider === "openai-codex-browser") {
		const { verifier, challenge } = await generatePKCE();
		const state = randomBytes(16).toString("hex");

		const url = new URL(OPENAI_AUTHORIZE_URL);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", OPENAI_CLIENT_ID);
		url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
		url.searchParams.set("scope", OPENAI_SCOPE);
		url.searchParams.set("code_challenge", challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("state", state);
		url.searchParams.set("id_token_add_organizations", "true");
		url.searchParams.set("codex_cli_simplified_flow", "true");
		url.searchParams.set("originator", "pibo");

		pendingLogins.set(state, { type: "browser", verifier, state, provider, createdAt: Date.now() });

		return {
			type: "browser_oauth",
			url: url.toString(),
			state,
			provider,
			instructions:
				"Open the URL in your browser, complete login, then paste the authorization code (or full redirect URL) via /login-complete.",
		};
	}

	throw new Error(`OAuth login start not supported for provider "${provider}". Supported: openai-codex.`);
}

export async function completeLogin(provider: string, code: string | undefined, state: string): Promise<{ success: true; provider: string; accountId: string | null }> {
	if (provider === "openai-codex") {
		const pending = requirePendingLogin(state, provider);
		if (pending.type !== "device") {
			throw new Error("Login flow mismatch. Start a new OpenAI device login.");
		}

		const deviceResult = await pollOpenAiDeviceAuthorization(pending);
		const tokenResult = await exchangeOpenAiAuthorizationCode(
			deviceResult.authorization_code!,
			deviceResult.code_verifier!,
			OPENAI_DEVICE_REDIRECT_URI,
		);
		const accountId = getOpenAiAccountId(tokenResult.accessToken);

		await writePiCredential(provider, {
			type: "oauth",
			access: tokenResult.accessToken,
			refresh: tokenResult.refreshToken,
			expires: Date.now() + tokenResult.expiresIn * 1000,
			accountId: accountId ?? undefined,
		});
		pendingLogins.delete(state);

		return { success: true, provider, accountId };
	}

	if (provider === "openai-codex-browser") {
		if (!code) throw new Error("login.complete requires params.code");
		const pending = requirePendingLogin(state, provider);
		pendingLogins.delete(state);
		if (pending.type !== "browser") {
			throw new Error("Login flow mismatch. Start a new OpenAI browser login.");
		}

		const tokenResult = await exchangeOpenAiAuthorizationCode(code, pending.verifier, OPENAI_REDIRECT_URI);
		const accountId = getOpenAiAccountId(tokenResult.accessToken);

		await writePiCredential("openai-codex", {
			type: "oauth",
			access: tokenResult.accessToken,
			refresh: tokenResult.refreshToken,
			expires: Date.now() + tokenResult.expiresIn * 1000,
			accountId: accountId ?? undefined,
		});

		return { success: true, provider: "openai-codex", accountId };
	}

	throw new Error(`OAuth login complete not supported for provider "${provider}". Supported: openai-codex.`);
}

export async function setApiKey(provider: string, apiKey: string): Promise<{ success: true; provider: string }> {
	await writePiCredential(provider, { type: "api_key", key: apiKey });
	return { success: true, provider };
}

export type LoginStatus = {
	id: string;
	provider: string;
	configured: boolean;
	source?: string;
	label?: string;
};

export async function getLoginStatus(provider?: string): Promise<LoginStatus[]> {
	const providerIds = provider
		? [provider]
		: (await listPiCredentials()).map((credential) => credential.providerId);
	return await Promise.all(providerIds.map(async (providerId) => ({
		id: providerId,
		provider: providerId,
		...(await getPiProviderAuthStatus(providerId)),
	})));
}

export function cancelLogin(provider: string, state: string): { success: true; provider: string } {
	requirePendingLogin(state, provider);
	pendingLogins.delete(state);
	return { success: true, provider };
}

export async function removeLogin(provider: string): Promise<{ success: true; provider: string }> {
	await deletePiCredential(provider);
	return { success: true, provider };
}

const PI_AUTH_FLOW_TTL_MS = 10 * 60 * 1_000;
const PI_API_KEY_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"kimi-coding",
	"google",
	"groq",
	"ollama",
	"minimax",
	"minimax-cn",
	"glm",
]);
const PI_DEVICE_METHOD = { id: "device_code", completion: "explicit" } as const;
const PI_BROWSER_METHOD = { id: "browser_oauth", completion: "explicit" } as const;
const PI_API_KEY_METHOD = { id: "api_key", completion: "immediate" } as const;

type PendingPiRuntimeAuth = {
	providerId: string;
	nativeProviderId: string;
	nativeState: string;
	flow: AgentRuntimeAuthPendingFlow;
};

export function piAuthMethodsForProvider(providerId: string) {
	if (providerId === "openai-codex") return [PI_DEVICE_METHOD, PI_BROWSER_METHOD] as const;
	if (PI_API_KEY_PROVIDERS.has(providerId)) return [PI_API_KEY_METHOD] as const;
	return [] as const;
}

export class PiAgentRuntimeAuthController {
	private readonly pending = new Map<string, PendingPiRuntimeAuth>();

	constructor(
		private readonly loadCatalog: () => Promise<ModelCatalog>,
		private readonly invalidateCatalog: () => void,
		private readonly now: () => number = Date.now,
		private readonly createFlowId: () => string = randomUUID,
	) {}

	async getStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		try {
			this.cleanupExpired();
			const catalog = await this.loadCatalog();
			const storedStatuses = await getLoginStatus();
			const providers = new Map(catalog.providers.map((provider) => [provider.id, {
				id: provider.id,
				displayName: provider.label,
				configured: provider.authConfigured,
			}]));
			for (const stored of storedStatuses) {
				const existing = providers.get(stored.id);
				if (existing) {
					existing.configured = stored.configured;
					continue;
				}
				providers.set(stored.id, {
					id: stored.id,
					displayName: stored.id,
					configured: stored.configured,
				});
			}
			return [...providers.values()].map((provider) => {
				const pending = [...this.pending.values()].find((entry) => entry.providerId === provider.id);
				return {
					id: provider.id,
					displayName: provider.displayName,
					state: pending ? "pending" : provider.configured ? "connected" : "disconnected",
					configured: provider.configured,
					methods: [...piAuthMethodsForProvider(provider.id)],
					...(pending ? { pending: { ...pending.flow } } : {}),
				};
			});
		} catch (error) {
			if (error instanceof AgentRuntimeAuthError) throw error;
			throw new AgentRuntimeAuthError("pi_auth_failed", "Pi provider authentication status is unavailable.", true);
		}
	}

	async start(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.cleanupExpired();
		const supported = piAuthMethodsForProvider(input.providerId).some((method) => method.id === input.method);
		if (!supported) throw new Error(`Pi does not support ${input.method} authentication for provider "${input.providerId}".`);
		if (input.method === "api_key") {
			try {
				await setApiKey(input.providerId, input.apiKey);
			} catch {
				throw new AgentRuntimeAuthError("pi_auth_failed", "Pi API-key authentication failed safely.", true);
			}
			this.invalidateCatalog();
			return { providerId: input.providerId, state: "connected", configured: true, details: { accountType: "api_key" } };
		}

		const nativeProviderId = input.method === "browser_oauth" ? "openai-codex-browser" : input.providerId;
		let started: PiLoginStartResult;
		try {
			started = await startLogin(nativeProviderId);
		} catch {
			throw new AgentRuntimeAuthError("pi_auth_failed", "Pi provider login could not be started safely.", true);
		}
		const flowId = this.createFlowId();
		const startedAt = this.now();
		const flow: AgentRuntimeAuthPendingFlow = {
			flowId,
			method: input.method,
			completion: "explicit",
			startedAt: new Date(startedAt).toISOString(),
			expiresAt: new Date(startedAt + PI_AUTH_FLOW_TTL_MS).toISOString(),
			verificationUrl: started.url,
			...(started.type === "device_code" ? { userCode: started.userCode } : {}),
			instructions: started.instructions,
		};
		this.pending.set(flowId, {
			providerId: input.providerId,
			nativeProviderId,
			nativeState: started.state,
			flow,
		});
		return { providerId: input.providerId, state: "pending", configured: false, flow: { ...flow } };
	}

	async complete(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.cleanupExpired();
		const pending = this.requirePending(input.providerId, input.flowId);
		try {
			await completeLogin(pending.nativeProviderId, input.code, pending.nativeState);
			this.pending.delete(input.flowId);
			this.invalidateCatalog();
			return { providerId: input.providerId, state: "connected", configured: true, details: { accountType: "oauth" } };
		} catch {
			if (pending.flow.method === "browser_oauth") this.pending.delete(input.flowId);
			throw new AgentRuntimeAuthError("pi_auth_failed", "Pi provider login could not be completed safely.", true);
		}
	}

	async cancel(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		try {
			const pending = this.requirePending(input.providerId, input.flowId);
			cancelLogin(pending.nativeProviderId, pending.nativeState);
			this.pending.delete(input.flowId);
			const configured = (await getLoginStatus(input.providerId))[0]?.configured ?? false;
			return {
				providerId: input.providerId,
				state: configured ? "connected" : "disconnected",
				configured,
				message: "Login was canceled.",
			};
		} catch (error) {
			if (error instanceof AgentRuntimeAuthError) throw error;
			throw new AgentRuntimeAuthError("pi_auth_failed", "Pi provider login could not be canceled safely.", true);
		}
	}

	async logout(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		for (const [flowId, pending] of this.pending) {
			if (pending.providerId !== input.providerId) continue;
			try {
				cancelLogin(pending.nativeProviderId, pending.nativeState);
			} catch {
				// The legacy pending flow may already have expired.
			}
			this.pending.delete(flowId);
		}
		try {
			await removeLogin(input.providerId);
		} catch {
			throw new AgentRuntimeAuthError("pi_auth_failed", "Pi provider logout failed safely.", true);
		}
		this.invalidateCatalog();
		return { providerId: input.providerId, state: "disconnected", configured: false };
	}

	async dispose(): Promise<void> {
		for (const pending of this.pending.values()) {
			try {
				cancelLogin(pending.nativeProviderId, pending.nativeState);
			} catch {
				// Best-effort cleanup of legacy in-memory state.
			}
		}
		this.pending.clear();
	}

	private requirePending(providerId: string, flowId: string): PendingPiRuntimeAuth {
		const pending = this.pending.get(flowId);
		if (!pending) throw new Error("Invalid or expired login flow. Start a new login.");
		if (pending.providerId !== providerId) throw new Error("Login flow does not match the selected provider.");
		return pending;
	}

	private cleanupExpired(): void {
		const now = this.now();
		for (const [flowId, pending] of this.pending) {
			if (Date.parse(pending.flow.expiresAt ?? pending.flow.startedAt) > now) continue;
			try {
				cancelLogin(pending.nativeProviderId, pending.nativeState);
			} catch {
				// Expiry is terminal even when the legacy state already disappeared.
			}
			this.pending.delete(flowId);
		}
	}
}
