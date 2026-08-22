import type { AuthResult, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

type PiAuthStorageModule = {
	AuthStorage: {
		create(authPath?: string): CredentialStore;
	};
};

let authStorageModulePromise: Promise<PiAuthStorageModule> | undefined;

async function loadPiAuthStorageModule(): Promise<PiAuthStorageModule> {
	authStorageModulePromise ??= import(
		new URL(
			"./core/auth-storage.js",
			import.meta.resolve("@earendil-works/pi-coding-agent"),
		).href
	) as Promise<PiAuthStorageModule>;
	return await authStorageModulePromise;
}

async function createPiCredentialStore(): Promise<CredentialStore> {
	const { AuthStorage } = await loadPiAuthStorageModule();
	return AuthStorage.create();
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

export async function resolvePiProviderAuth(providerId: string): Promise<AuthResult | undefined> {
	const credentials = await createPiCredentialStore();
	const runtime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	return await runtime.getAuth(providerId);
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
