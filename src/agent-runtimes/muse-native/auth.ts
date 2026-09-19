import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentRuntimeAuthError } from "../../agent-runtime/errors.js";
import { protectPrivatePathsSync } from "../../core/private-path.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "../../agent-runtime/auth.js";
import type { MuseNativeRuntimeConfig } from "./config.js";
import { museNativeInstancePaths } from "./process.js";

const MAX_API_KEY_LENGTH = 4_096;
const AUTH_PROVIDER_ID = "meta";

type StoredMuseAuth = {
	providers?: {
		meta?: {
			api_key?: unknown;
		};
	};
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStoredApiKey(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const providers = (value as StoredMuseAuth).providers;
	if (!isRecord(providers)) return undefined;
	const meta = (providers as Record<string, unknown>).meta;
	if (!isRecord(meta)) return undefined;
	const apiKey = (meta as Record<string, unknown>).api_key;
	return typeof apiKey === "string" && apiKey.trim() ? apiKey : undefined;
}

export class MuseNativeAuthController {
	constructor(
		private readonly config: MuseNativeRuntimeConfig,
		private readonly runtimeInstanceId: string,
	) {}

	private authFile(): string {
		return museNativeInstancePaths(this.config, this.runtimeInstanceId).authFile;
	}

	async getStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		const authFile = this.authFile();
		let stored: string;
		try {
			stored = await readFile(authFile, "utf8");
		} catch {
			return [{
				id: AUTH_PROVIDER_ID,
				displayName: "Meta",
				state: "disconnected",
				configured: false,
				methods: [{ id: "api_key", completion: "immediate" }],
				message: "No stored Muse credential. Store an API key or complete `muse login` on this host.",
			}];
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(stored) as unknown;
		} catch {
			return [{
				id: AUTH_PROVIDER_ID,
				displayName: "Meta",
				state: "failed",
				configured: false,
				methods: [{ id: "api_key", completion: "immediate" }],
				message: "Stored Muse credential is not valid JSON.",
			}];
		}
		if (!readStoredApiKey(parsed)) {
			return [{
				id: AUTH_PROVIDER_ID,
				displayName: "Meta",
				state: "disconnected",
				configured: false,
				methods: [{ id: "api_key", completion: "immediate" }],
				message: "Stored Muse credential has no Meta API key.",
			}];
		}
		return [{
			id: AUTH_PROVIDER_ID,
			displayName: "Meta",
			state: "connected",
			configured: true,
			methods: [{ id: "api_key", completion: "immediate" }],
			details: { accountType: "api_key" },
		}];
	}

	async start(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		if (input.method !== "api_key") {
			throw new AgentRuntimeAuthError(
				"muse_auth_method_unsupported",
				`Muse sign-in via "${input.method}" is not supported; store an API key or complete \`muse login\` on this host and copy the resulting auth.json to the instance home.`,
			);
		}
		const apiKey = input.apiKey;
		if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > MAX_API_KEY_LENGTH) {
			throw new AgentRuntimeAuthError("muse_auth_api_key_invalid", "Muse API key must be a non-empty string.");
		}
		const authFile = this.authFile();
		await mkdir(dirname(authFile), { recursive: true, mode: 0o700 });
		protectPrivatePathsSync([{ path: dirname(authFile), kind: "directory" }]);
		let document: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(await readFile(authFile, "utf8"));
			if (isRecord(parsed)) document = { ...parsed };
		} catch {
			// Missing or unparseable state starts fresh below.
		}
		const storedProviders: unknown = document.providers;
		const providers: Record<string, unknown> = isRecord(storedProviders) ? { ...storedProviders } : {};
		const storedMeta: unknown = providers.meta;
		const meta: Record<string, unknown> = isRecord(storedMeta) ? { ...storedMeta } : {};
		meta.api_key = apiKey.trim();
		providers.meta = meta;
		document = { ...document, schema_version: document.schema_version ?? 1, providers };
		await writeFile(authFile, `${JSON.stringify(document)}\n`, { mode: 0o600 });
		return {
			providerId: input.providerId,
			state: "connected",
			configured: true,
			details: { accountType: "api_key" },
		};
	}

	async logout(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		const authFile = this.authFile();
		let stored: string;
		try {
			stored = await readFile(authFile, "utf8");
		} catch {
			return {
				providerId: input.providerId,
				state: "disconnected",
				configured: false,
			};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(stored) as unknown;
		} catch {
			throw new AgentRuntimeAuthError(
				"muse_auth_logout_unparseable",
				"Stored Muse credential is not valid JSON and was left untouched; delete it manually to complete logout.",
			);
		}
		if (isRecord(parsed) && isRecord(parsed.providers) && isRecord((parsed.providers as Record<string, unknown>).meta)) {
			const providers = { ...(parsed.providers as Record<string, unknown>) };
			const meta = { ...((providers.meta as Record<string, unknown>)) };
			if ("api_key" in meta) {
				delete meta.api_key;
				providers.meta = meta;
				await writeFile(authFile, `${JSON.stringify({ ...parsed, providers })}\n`, { mode: 0o600 });
			}
		}
		return {
			providerId: input.providerId,
			state: "disconnected",
			configured: false,
		};
	}

	async dispose(): Promise<void> {
		// No pending flows or timers are owned.
	}
}

export function museAuthConfigPath(config: MuseNativeRuntimeConfig, runtimeInstanceId: string): string {
	return join(museNativeInstancePaths(config, runtimeInstanceId).museHome, ".config", "muse");
}
