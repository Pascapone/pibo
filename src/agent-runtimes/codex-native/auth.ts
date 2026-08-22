import { randomUUID } from "node:crypto";
import { AgentRuntimeAuthError } from "../../agent-runtime/errors.js";
import { protectPrivateTreeSync } from "../../core/private-path.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthPendingFlow,
	AgentRuntimeAuthStatus,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "../../agent-runtime/types.js";
import type { CodexNativeRuntimeConfig } from "./config.js";
import type { CodexNativeAppServerProcess } from "./process.js";
import type {
	CodexAppServerAccount,
	CodexAppServerAccountLoginCancelResponse,
	CodexAppServerAccountLoginCompletedNotification,
	CodexAppServerAccountLoginStartResponse,
	CodexAppServerAccountLogoutResponse,
	CodexAppServerAccountReadResponse,
} from "./protocol-types.js";

export const CODEX_NATIVE_AUTH_PROVIDER_ID = "openai-codex";
export const CODEX_NATIVE_AUTH_PROVIDER_DISPLAY_NAME = "OpenAI for native Codex";

const CODEX_DEVICE_METHOD = { id: "device_code", completion: "notification" } as const;
const CODEX_API_KEY_METHOD = { id: "api_key", completion: "immediate" } as const;
export const CODEX_NATIVE_AUTH_METHODS = [CODEX_DEVICE_METHOD, CODEX_API_KEY_METHOD] as const;

type StartAuthProcess = (sessionGeneration: string) => Promise<CodexNativeAppServerProcess>;

type PendingCodexAuth = {
	providerId: string;
	nativeLoginId: string;
	flow: AgentRuntimeAuthPendingFlow;
	process?: CodexNativeAppServerProcess;
	unsubscribe?: () => void;
	timer?: ReturnType<typeof setTimeout>;
	terminal?: AgentRuntimeAuthOperationResult;
	settling?: Promise<void>;
};

type CodexNativeAuthControllerOptions = {
	config: CodexNativeRuntimeConfig;
	startProcess: StartAuthProcess;
	now?: () => number;
	createFlowId?: () => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function protocolFailure(operation: string): AgentRuntimeAuthError {
	return new AgentRuntimeAuthError(
		"codex_auth_protocol_error",
		`Native Codex ${operation} returned an invalid response.`,
		true,
	);
}

function operationFailure(operation: string, retryable = true): AgentRuntimeAuthError {
	return new AgentRuntimeAuthError(
		"codex_auth_failed",
		`Native Codex ${operation} failed safely.`,
		retryable,
	);
}

function validateAccountRead(value: unknown): CodexAppServerAccountReadResponse {
	if (!isRecord(value) || typeof value.requiresOpenaiAuth !== "boolean") throw protocolFailure("account status");
	const account = value.account;
	if (account !== undefined && account !== null) {
		if (!isRecord(account) || typeof account.type !== "string") throw protocolFailure("account status");
		if (account.type === "apiKey") {
			return { account: { type: "apiKey" }, requiresOpenaiAuth: value.requiresOpenaiAuth };
		}
		if (account.type === "chatgpt") {
			if ((account.email !== null && typeof account.email !== "string") || typeof account.planType !== "string") {
				throw protocolFailure("account status");
			}
			return {
				account: { type: "chatgpt", email: account.email, planType: account.planType },
				requiresOpenaiAuth: value.requiresOpenaiAuth,
			};
		}
		if (account.type === "amazonBedrock") {
			if (account.usesCodexManagedCredentials !== undefined && typeof account.usesCodexManagedCredentials !== "boolean") {
				throw protocolFailure("account status");
			}
			return {
				account: {
					type: "amazonBedrock",
					...(typeof account.usesCodexManagedCredentials === "boolean"
						? { usesCodexManagedCredentials: account.usesCodexManagedCredentials }
						: {}),
				},
				requiresOpenaiAuth: value.requiresOpenaiAuth,
			};
		}
		throw protocolFailure("account status");
	}
	return { account: null, requiresOpenaiAuth: value.requiresOpenaiAuth };
}

function validateDeviceStart(value: unknown): Extract<CodexAppServerAccountLoginStartResponse, { type: "chatgptDeviceCode" }> {
	if (
		!isRecord(value)
		|| value.type !== "chatgptDeviceCode"
		|| typeof value.loginId !== "string"
		|| value.loginId.length === 0
		|| value.loginId.length > 512
		|| typeof value.userCode !== "string"
		|| value.userCode.length === 0
		|| value.userCode.length > 128
		|| typeof value.verificationUrl !== "string"
		|| value.verificationUrl.length === 0
		|| value.verificationUrl.length > 2_048
	) {
		throw protocolFailure("device login start");
	}
	let verificationUrl: URL;
	try {
		verificationUrl = new URL(value.verificationUrl);
	} catch {
		throw protocolFailure("device login start");
	}
	if (verificationUrl.protocol !== "https:" && verificationUrl.protocol !== "http:") {
		throw protocolFailure("device login start");
	}
	return {
		type: "chatgptDeviceCode",
		loginId: value.loginId,
		userCode: value.userCode,
		verificationUrl: value.verificationUrl,
	};
}

function validateApiKeyStart(value: unknown): void {
	if (!isRecord(value) || value.type !== "apiKey") throw protocolFailure("API-key login");
}

function validateLoginNotification(value: unknown): CodexAppServerAccountLoginCompletedNotification | undefined {
	if (!isRecord(value) || typeof value.success !== "boolean") return undefined;
	if (value.loginId !== undefined && value.loginId !== null && typeof value.loginId !== "string") return undefined;
	if (value.error !== undefined && value.error !== null && typeof value.error !== "string") return undefined;
	return {
		success: value.success,
		...(value.loginId === null || typeof value.loginId === "string" ? { loginId: value.loginId } : {}),
		...(value.error === null || typeof value.error === "string" ? { error: value.error } : {}),
	};
}

function validateCancelResponse(value: unknown): CodexAppServerAccountLoginCancelResponse {
	if (!isRecord(value) || (value.status !== "canceled" && value.status !== "notFound")) {
		throw protocolFailure("login cancellation");
	}
	return { status: value.status };
}

function validateLogoutResponse(value: unknown): CodexAppServerAccountLogoutResponse {
	if (!isRecord(value)) throw protocolFailure("logout");
	return {};
}

function accountResult(account: CodexAppServerAccountReadResponse): AgentRuntimeAuthOperationResult {
	if (!account.account) {
		if (!account.requiresOpenaiAuth) {
			return {
				providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
				state: "partial",
				configured: true,
				message: "Native Codex reports that managed OpenAI authentication is not required.",
				details: { accountType: "unknown" },
			};
		}
		return {
			providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
			state: "disconnected",
			configured: false,
		};
	}
	if (account.account.type === "apiKey") {
		return {
			providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
			state: "connected",
			configured: true,
			details: { accountType: "api_key" },
		};
	}
	if (account.account.type === "chatgpt") {
		return {
			providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
			state: "connected",
			configured: true,
			details: {
				accountType: "chatgpt",
				planType: account.account.planType,
			},
		};
	}
	return {
		providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
		state: "partial",
		configured: true,
		message: "Native Codex reports an account type that Pibo does not configure.",
		details: { accountType: "unknown" },
	};
}

function statusFromResult(result: AgentRuntimeAuthOperationResult): AgentRuntimeAuthStatus {
	return {
		id: result.providerId,
		displayName: CODEX_NATIVE_AUTH_PROVIDER_DISPLAY_NAME,
		state: result.state,
		configured: result.configured,
		methods: [...CODEX_NATIVE_AUTH_METHODS],
		...(result.flow ? { pending: { ...result.flow } } : {}),
		...(result.message ? { message: result.message } : {}),
		...(result.details ? { details: { ...result.details } } : {}),
	};
}

export class CodexNativeAuthController {
	private readonly config: CodexNativeRuntimeConfig;
	private readonly startProcess: StartAuthProcess;
	private readonly now: () => number;
	private readonly createFlowId: () => string;
	private readonly flows = new Map<string, PendingCodexAuth>();

	constructor(options: CodexNativeAuthControllerOptions) {
		this.config = options.config;
		this.startProcess = options.startProcess;
		this.now = options.now ?? Date.now;
		this.createFlowId = options.createFlowId ?? randomUUID;
	}

	async getStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		const flow = this.latestFlow();
		if (flow) {
			await this.failIfProcessStopped(flow);
			if (flow.terminal && !flow.terminal.configured) return [statusFromResult(flow.terminal)];
			if (!flow.terminal) {
				return [statusFromResult({
					providerId: flow.providerId,
					state: "pending",
					configured: false,
					flow: { ...flow.flow },
				})];
			}
		}
		try {
			const result = await this.withProcess("status", async (process) => accountResult(await this.readAccount(process)));
			return [statusFromResult(result)];
		} catch {
			return [statusFromResult({
				providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
				state: "failed",
				configured: false,
				message: "Native Codex authentication status is unavailable. Retry after checking the runtime.",
			})];
		}
	}

	async start(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.assertProvider(input.providerId);
		const active = [...this.flows.values()].find((flow) => !flow.terminal);
		if (active) throw new AgentRuntimeAuthError("codex_auth_pending", "A native Codex login is already pending.", true);
		this.flows.clear();
		if (input.method === "api_key") return await this.startApiKey(input.apiKey);
		if (input.method !== "device_code") {
			throw new AgentRuntimeAuthError("codex_auth_method_unsupported", `Native Codex does not support ${input.method} login.`, false);
		}
		return await this.startDeviceCode();
	}

	async complete(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.assertProvider(input.providerId);
		const flow = this.requireFlow(input.flowId);
		if (flow.providerId !== input.providerId) throw new AgentRuntimeAuthError("codex_auth_flow_mismatch", "Login flow does not match the selected provider.");
		await this.failIfProcessStopped(flow);
		if (flow.settling) await flow.settling;
		if (flow.terminal) return { ...flow.terminal, ...(flow.terminal.details ? { details: { ...flow.terminal.details } } : {}) };
		return {
			providerId: flow.providerId,
			state: "pending",
			configured: false,
			flow: { ...flow.flow },
		};
	}

	async cancel(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.assertProvider(input.providerId);
		const flow = this.requireFlow(input.flowId);
		if (flow.providerId !== input.providerId) throw new AgentRuntimeAuthError("codex_auth_flow_mismatch", "Login flow does not match the selected provider.");
		if (flow.settling) await flow.settling;
		if (flow.terminal) return { ...flow.terminal };
		const process = flow.process;
		if (process) {
			try {
				validateCancelResponse(await process.client.request("account/login/cancel", { loginId: flow.nativeLoginId }));
			} catch {
				// Closing the owned process is the cancellation fallback.
			}
		}
		await this.settle(flow, async () => ({
			providerId: flow.providerId,
			state: "disconnected",
			configured: false,
			message: "Login was canceled.",
		}));
		this.flows.delete(input.flowId);
		try {
			const current = await this.withProcess("cancel-status", async (currentProcess) => accountResult(await this.readAccount(currentProcess)));
			return { ...current, message: "Login was canceled." };
		} catch {
			return { ...flow.terminal! };
		}
	}

	async logout(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		this.assertProvider(input.providerId);
		for (const flow of this.flows.values()) {
			if (!flow.terminal) await this.cancel({ providerId: flow.providerId, flowId: flow.flow.flowId });
		}
		this.flows.clear();
		try {
			await this.withProcess("logout", async (process) => {
				validateLogoutResponse(await process.client.request("account/logout"));
				const status = accountResult(await this.readAccount(process));
				if (status.configured || status.state !== "disconnected") throw protocolFailure("logout verification");
			});
		} catch (error) {
			if (error instanceof AgentRuntimeAuthError) throw error;
			throw operationFailure("logout");
		}
		return { providerId: input.providerId, state: "disconnected", configured: false };
	}

	async dispose(): Promise<void> {
		const flows = [...this.flows.values()];
		this.flows.clear();
		await Promise.allSettled(flows.map(async (flow) => {
			if (flow.timer) clearTimeout(flow.timer);
			flow.unsubscribe?.();
			await this.closeProcess(flow.process);
			flow.process = undefined;
		}));
	}

	private async startApiKey(apiKey: string): Promise<AgentRuntimeAuthOperationResult> {
		try {
			return await this.withProcess("api-key", async (process) => {
				validateApiKeyStart(await process.client.request("account/login/start", { type: "apiKey", apiKey }));
				const result = accountResult(await this.readAccount(process));
				if (!result.configured || result.details?.accountType !== "api_key") throw protocolFailure("API-key login verification");
				return result;
			});
		} catch (error) {
			if (error instanceof AgentRuntimeAuthError) throw error;
			throw operationFailure("API-key login");
		}
	}

	private async startDeviceCode(): Promise<AgentRuntimeAuthOperationResult> {
		let process: CodexNativeAppServerProcess | undefined;
		let unsubscribe: (() => void) | undefined;
		const flowId = this.createFlowId();
		let queuedNotification: CodexAppServerAccountLoginCompletedNotification | undefined;
		try {
			process = await this.startProcess(`auth-device-${flowId}`);
			unsubscribe = process.client.subscribeNotifications((notification) => {
				if (notification.method !== "account/login/completed") return;
				const parsed = validateLoginNotification(notification.params);
				if (!parsed) return;
				const flow = this.flows.get(flowId);
				if (!flow) {
					queuedNotification = parsed;
					return;
				}
				void this.handleLoginCompleted(flow, parsed);
			});
			const started = validateDeviceStart(await process.client.request("account/login/start", { type: "chatgptDeviceCode" }));
			const now = this.now();
			const flow: AgentRuntimeAuthPendingFlow = {
				flowId,
				method: "device_code",
				completion: "notification",
				startedAt: new Date(now).toISOString(),
				expiresAt: new Date(now + this.config.authLoginTimeoutMs).toISOString(),
				verificationUrl: started.verificationUrl,
				userCode: started.userCode,
				instructions: "Open the verification URL, enter the one-time code, and finish sign-in. Pibo will detect completion automatically.",
			};
			const pending: PendingCodexAuth = {
				providerId: CODEX_NATIVE_AUTH_PROVIDER_ID,
				nativeLoginId: started.loginId,
				flow,
				process,
				unsubscribe,
			};
			pending.timer = setTimeout(() => {
				void this.settle(pending, async () => ({
					providerId: pending.providerId,
					state: "failed",
					configured: false,
					message: "Native Codex login timed out. Start a new login.",
				}));
			}, this.config.authLoginTimeoutMs);
			pending.timer.unref?.();
			this.flows.set(flowId, pending);
			if (queuedNotification) void this.handleLoginCompleted(pending, queuedNotification);
			return {
				providerId: pending.providerId,
				state: "pending",
				configured: false,
				flow: { ...flow },
			};
		} catch (error) {
			unsubscribe?.();
			await this.closeProcess(process).catch(() => {});
			if (error instanceof AgentRuntimeAuthError) throw error;
			throw operationFailure("device login start");
		}
	}

	private async handleLoginCompleted(
		flow: PendingCodexAuth,
		notification: CodexAppServerAccountLoginCompletedNotification,
	): Promise<void> {
		if (notification.loginId && notification.loginId !== flow.nativeLoginId) return;
		await this.settle(flow, async () => {
			if (!notification.success) {
				return {
					providerId: flow.providerId,
					state: "failed",
					configured: false,
					message: "Native Codex login was not completed. Retry the login flow.",
				};
			}
			const process = flow.process;
			if (!process) throw operationFailure("login completion");
			const result = accountResult(await this.readAccount(process));
			if (!result.configured) throw protocolFailure("login completion verification");
			return result;
		});
	}

	private async settle(
		flow: PendingCodexAuth,
		operation: () => Promise<AgentRuntimeAuthOperationResult>,
	): Promise<void> {
		if (flow.terminal) return;
		if (!flow.settling) {
			flow.settling = (async () => {
				let result: AgentRuntimeAuthOperationResult;
				try {
					result = await operation();
				} catch {
					result = {
						providerId: flow.providerId,
						state: "failed",
						configured: false,
						message: "Native Codex login completion failed safely. Start a new login.",
					};
				}
				flow.terminal = result;
				if (flow.timer) clearTimeout(flow.timer);
				flow.timer = undefined;
				flow.unsubscribe?.();
				flow.unsubscribe = undefined;
				try {
					await this.closeProcess(flow.process);
				} catch {
					flow.terminal = {
						providerId: flow.providerId,
						state: "failed",
						configured: false,
						message: "Native Codex login state could not be secured. Start a new login.",
					};
				}
				flow.process = undefined;
			})();
		}
		await flow.settling;
	}

	private async failIfProcessStopped(flow: PendingCodexAuth): Promise<void> {
		if (flow.terminal || flow.settling) return;
		const state = flow.process?.client.snapshot.state;
		if (state === "ready" || state === "starting" || state === "initializing") return;
		await this.settle(flow, async () => ({
			providerId: flow.providerId,
			state: "failed",
			configured: false,
			message: "Native Codex login process stopped. Start a new login.",
		}));
	}

	private async readAccount(process: CodexNativeAppServerProcess): Promise<CodexAppServerAccountReadResponse> {
		return validateAccountRead(await process.client.request("account/read", { refreshToken: false }));
	}

	private async withProcess<T>(label: string, operation: (process: CodexNativeAppServerProcess) => Promise<T>): Promise<T> {
		const process = await this.startProcess(`auth-${label}-${randomUUID()}`);
		try {
			return await operation(process);
		} finally {
			await this.closeProcess(process);
		}
	}

	private async closeProcess(process: CodexNativeAppServerProcess | undefined): Promise<void> {
		if (!process) return;
		try {
			await process.close();
		} finally {
			protectPrivateTreeSync(process.paths.codexHome);
		}
	}

	private latestFlow(): PendingCodexAuth | undefined {
		return [...this.flows.values()].at(-1);
	}

	private requireFlow(flowId: string): PendingCodexAuth {
		const flow = this.flows.get(flowId);
		if (!flow) throw new AgentRuntimeAuthError("codex_auth_flow_missing", "Invalid or expired native Codex login flow. Start a new login.", true);
		return flow;
	}

	private assertProvider(providerId: string): void {
		if (providerId !== CODEX_NATIVE_AUTH_PROVIDER_ID) {
			throw new AgentRuntimeAuthError("codex_auth_provider_unsupported", `Native Codex does not support provider "${providerId}".`, false);
		}
	}

}
