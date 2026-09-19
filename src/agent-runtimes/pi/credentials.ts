import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthOperationOptions, AuthResult, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

type PiAuthStorageModule = {
	AuthStorage: {
		create(authPath?: string): CredentialStore;
	};
};

let authStorageModulePromise: Promise<PiAuthStorageModule> | undefined;

async function loadPiAuthStorageModule(): Promise<PiAuthStorageModule> {
	const vendored = new URL("./vendor/pi-auth-storage.mjs", import.meta.url);
	authStorageModulePromise ??= (existsSync(vendored)
		? import(vendored.href)
		: import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href)) as Promise<PiAuthStorageModule>;
	return await authStorageModulePromise;
}

async function createPiCredentialStore(): Promise<CredentialStore> {
	try {
		const { AuthStorage } = await loadPiAuthStorageModule();
		return AuthStorage.create();
	} catch {
		// Bundled plugin backends have no node_modules above them, so the pi loader's
		// runtime import.meta.resolve fails there. Fall back to a file-backed store
		// over the same auth.json; only stdlib is used so it bundles safely.
		return new PiboFileCredentialStore();
	}
}

function resolvePiAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

const ENV_REFERENCE_PATTERN = /\$(\$|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

function resolveApiKeyTemplate(value: string): string {
	// Env interpolation only; "!" shell-command values are left unresolved by design.
	if (value.startsWith("!")) return value;
	ENV_REFERENCE_PATTERN.lastIndex = 0;
	return value.replace(ENV_REFERENCE_PATTERN, (match: string, escape: string, bracedName: string, bareName: string) => {
		if (escape === "$") return "$";
		const name = bracedName ?? bareName;
		return process.env[name] ?? match;
	});
}

/** File-backed CredentialStore over the Pi auth.json, usable from bundled backends. */
export class PiboFileCredentialStore implements CredentialStore {
	private chain: Promise<unknown> = Promise.resolve();
	readonly authPath: string;

	constructor(authPath: string = join(resolvePiAgentDir(), "auth.json")) {
		this.authPath = authPath;
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.chain.then(task, task);
		this.chain = run.catch(() => {});
		return run;
	}

	private async readData(): Promise<Record<string, Credential>> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.authPath, "utf8"));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
			return parsed as Record<string, Credential>;
		} catch {
			return {};
		}
	}

	private async writeData(data: Record<string, Credential>): Promise<void> {
		await mkdir(dirname(this.authPath), { recursive: true, mode: 0o700 });
		const tmpPath = `${this.authPath}.${process.pid}.tmp`;
		await writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
		await rename(tmpPath, this.authPath);
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const credential = (await this.readData())[providerId];
		if (credential?.type !== "api_key") return credential;
		const key = (credential as { key?: unknown }).key;
		if (typeof key !== "string") return credential;
		return { ...credential, key: resolveApiKeyTemplate(key) };
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		return Object.entries(await this.readData()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return await this.enqueue(async () => {
			options?.signal?.throwIfAborted();
			const current = await this.readData();
			const next = await fn(current[providerId]);
			if (next === undefined) return current[providerId];
			await this.writeData({ ...current, [providerId]: next });
			return next;
		});
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		await this.enqueue(async () => {
			options?.signal?.throwIfAborted();
			const current = await this.readData();
			if (!(providerId in current)) return;
			delete current[providerId];
			await this.writeData(current);
		});
	}
}

export async function readPiCredential(providerId: string): Promise<Credential | undefined> {
	return await (await createPiCredentialStore()).read(providerId);
}

export async function writePiCredential(providerId: string, credential: Credential): Promise<void> {
	const store = await createPiCredentialStore();
	await store.modify(providerId, async () => credential);
}

export async function deletePiCredential(providerId: string): Promise<void> {
	await (await createPiCredentialStore()).delete(providerId);
}

export async function listPiCredentials(): Promise<readonly CredentialInfo[]> {
	return await (await createPiCredentialStore()).list();
}

const OAUTH_FALLBACK_VALIDITY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Derive request auth directly from a stored OAuth credential.
 * Pi resolves OAuth through lazily imported provider modules, and those
 * bundler-opaque dynamic imports fail inside bundled plugin backends. A
 * still-valid stored token derives to the same apiKey result pi returns, so
 * use it directly instead of failing the whole resolution.
 */
export function deriveStoredOAuthAuthResult(credential: Credential | undefined): AuthResult | undefined {
	if (credential?.type !== "oauth") return undefined;
	if (typeof credential.access !== "string" || !credential.access) return undefined;
	// Mirror pi's minimum-validity rule: expired or nearly-expired tokens must
	// go through the real refresh flow instead of this direct derivation.
	if (typeof credential.expires === "number" && credential.expires - Date.now() <= OAUTH_FALLBACK_VALIDITY_MARGIN_MS) {
		return undefined;
	}
	return { auth: { apiKey: credential.access }, source: "OAuth" };
}

export async function resolvePiProviderAuth(providerId: string): Promise<AuthResult | undefined> {
	const credentials = await createPiCredentialStore();
	try {
		const runtime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
		return await runtime.getAuth(providerId);
	} catch (error) {
		const stored = await credentials.read(providerId).catch(() => undefined);
		const fallback = deriveStoredOAuthAuthResult(stored);
		if (fallback) return fallback;
		throw error;
	}
}

export async function getPiProviderAuthStatus(providerId: string): Promise<{
	configured: boolean;
	source?: string;
	label?: string;
}> {
	const credentials = await createPiCredentialStore();
	const runtime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	const status = runtime.getProviderAuthStatus(providerId);
	if (status.configured) return status;
	const credential = (await credentials.list()).find((entry) => entry.providerId === providerId);
	if (!credential) return status;
	return {
		configured: true,
		source: "stored",
		label: credential.type === "oauth" ? "OAuth" : "API key",
	};
}
