import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_PIBO_CONFIG_PATH = ".pibo/config.json";

export type PiboConfig = {
	auth?: {
		baseURL?: string;
		secret?: string;
		googleClientId?: string;
		googleClientSecret?: string;
		allowedEmails?: string[];
		trustedOrigins?: string[];
		databasePath?: string;
	};
};

export type PiboConfigKeyDefinition = {
	key: string;
	description: string;
	type: "string" | "string[]";
	secret?: boolean;
};

export const PIBO_CONFIG_KEYS: PiboConfigKeyDefinition[] = [
	{
		key: "auth.baseURL",
		type: "string",
		description: "Better Auth base URL, for example http://localhost:4788.",
	},
	{
		key: "auth.secret",
		type: "string",
		secret: true,
		description: "Better Auth secret. Must be at least 32 characters.",
	},
	{
		key: "auth.googleClientId",
		type: "string",
		description: "Google OAuth client id.",
	},
	{
		key: "auth.googleClientSecret",
		type: "string",
		secret: true,
		description: "Google OAuth client secret.",
	},
	{
		key: "auth.allowedEmails",
		type: "string[]",
		description: "Allowed Google account emails. Use comma-separated values.",
	},
	{
		key: "auth.trustedOrigins",
		type: "string[]",
		description: "Additional trusted Better Auth origins. Use comma-separated values.",
	},
	{
		key: "auth.databasePath",
		type: "string",
		description: "SQLite path for Better Auth data.",
	},
];

function getKeyDefinition(key: string): PiboConfigKeyDefinition {
	const definition = PIBO_CONFIG_KEYS.find((candidate) => candidate.key === key);
	if (!definition) throw new Error(`Unknown config key "${key}"`);
	return definition;
}

function findKeyDefinition(key: string): PiboConfigKeyDefinition | undefined {
	return PIBO_CONFIG_KEYS.find((candidate) => candidate.key === key);
}

function maskSecretValue(value: string): string {
	if (value.length <= 8) return "********";
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseListValue(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
			throw new Error("Expected a JSON string array");
		}
		return parsed.map((item) => item.trim()).filter(Boolean);
	}
	return trimmed
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseConfigValue(definition: PiboConfigKeyDefinition, value: string): string | string[] {
	if (definition.type === "string[]") return parseListValue(value);
	if (definition.key === "auth.secret" && value.length < 32) {
		throw new Error("auth.secret must be at least 32 characters");
	}
	return value;
}

function assertObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Pibo config must be a JSON object");
	}
	return value as Record<string, unknown>;
}

export function loadPiboConfig(path = DEFAULT_PIBO_CONFIG_PATH): PiboConfig {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) return {};
	const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
	return assertObject(parsed) as PiboConfig;
}

export function savePiboConfig(config: PiboConfig, path = DEFAULT_PIBO_CONFIG_PATH): void {
	const resolvedPath = resolve(path);
	mkdirSync(dirname(resolvedPath), { recursive: true });
	writeFileSync(resolvedPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function getPiboConfigValue(config: PiboConfig, key: string): unknown {
	getKeyDefinition(key);
	const segments = key.split(".");
	let current: unknown = config;
	for (const segment of segments) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

export function getDisplayPiboConfigValue(config: PiboConfig, key: string): unknown {
	const definition = getKeyDefinition(key);
	const value = getPiboConfigValue(config, key);
	if (definition.secret && typeof value === "string") return maskSecretValue(value);
	return value;
}

export function redactPiboConfig(config: PiboConfig): PiboConfig {
	const redacted = structuredClone(config) as Record<string, unknown>;
	for (const definition of PIBO_CONFIG_KEYS) {
		if (!definition.secret) continue;
		const value = getPiboConfigValue(config, definition.key);
		if (typeof value !== "string") continue;

		const segments = definition.key.split(".");
		let current = redacted;
		for (const segment of segments.slice(0, -1)) {
			const next = current[segment];
			if (!next || typeof next !== "object" || Array.isArray(next)) {
				current = {};
				break;
			}
			current = next as Record<string, unknown>;
		}
		current[segments[segments.length - 1]!] = maskSecretValue(value);
	}
	return redacted as PiboConfig;
}

export function setPiboConfigValue(config: PiboConfig, key: string, rawValue: string): PiboConfig {
	const definition = getKeyDefinition(key);
	const value = parseConfigValue(definition, rawValue);
	const [section, name] = key.split(".");
	if (section !== "auth" || !name) throw new Error(`Unsupported config key "${key}"`);
	return {
		...config,
		auth: {
			...config.auth,
			[name]: value,
		},
	};
}

export function isPiboConfigKeySecret(key: string): boolean {
	return findKeyDefinition(key)?.secret === true;
}

export function deletePiboConfigValue(config: PiboConfig, key: string): PiboConfig {
	getKeyDefinition(key);
	const [section, name] = key.split(".");
	if (section !== "auth" || !name) throw new Error(`Unsupported config key "${key}"`);
	if (!config.auth || !(name in config.auth)) return config;

	const auth = { ...config.auth };
	delete (auth as Record<string, unknown>)[name];
	return {
		...config,
		auth: Object.keys(auth).length > 0 ? auth : undefined,
	};
}
