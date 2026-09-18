import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PiboRuntimeResourceSession } from "../../agent-runtime/resources.js";
import type { PiboPortableToolSession, PiboToolMcpAccess } from "../../tools/session-service.js";

const MAX_MCP_SERVERS = 32;
const MAX_MCP_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_SERVER_NAME_LENGTH = 128;
const MAX_URL_LENGTH = 4_096;
const MAX_COMMAND_LENGTH = 4_096;
const MAX_ARGS = 256;
const MAX_ARG_LENGTH = 4_096;
const MAX_ENV_ENTRIES = 256;
const MAX_ENV_VALUE_LENGTH = 16 * 1024;
const MAX_HEADER_ENTRIES = 64;
const MAX_HEADER_VALUE_LENGTH = 16 * 1024;
const PIBO_TOOL_TOKEN_TTL_MS = 5 * 60_000;
const PIBO_TOOL_TOKEN_EXPIRY_WARNING_MS = 60_000;
const PIBO_TOOL_TOKEN_ENVIRONMENT_VARIABLE = "PIBO_MUSE_NATIVE_TOOL_TOKEN";

export type MuseNativeSessionMcpServerConfig =
	| {
		transport: "stdio";
		command: string;
		args?: string[];
		env?: Record<string, string>;
		mode?: "required" | "optional";
	}
	| {
		transport: "streamableHttp";
		url: string;
		headers?: Record<string, string>;
		mode?: "required" | "optional";
	};

export type MuseNativeSessionMcpConfig = Record<string, MuseNativeSessionMcpServerConfig>;

export type MuseNativeResourceDeliveryInput = {
	workspace: string;
	portableTools?: PiboPortableToolSession;
	resources?: PiboRuntimeResourceSession;
};

export type MuseNativeResourceWarning = {
	code: "muse_native_tool_credential_expiring" | "muse_native_tool_credential_expired";
	message: string;
};

function boundedString(value: unknown, label: string, maxLength: number): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
	if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
	return value;
}

function safeServerName(value: string): string {
	if (!value.trim() || value.length > MAX_SERVER_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error("Selected MCP server name is not supported by native Muse delivery.");
	}
	return value;
}

function uniquePiboServerName(externalNames: ReadonlySet<string>): string {
	const base = "pibo-session-tools";
	if (!externalNames.has(base)) return base;
	const digest = createHash("sha256").update([...externalNames].sort().join("\0")).digest("hex").slice(0, 8);
	let candidate = `${base}-${digest}`;
	for (let counter = 2; externalNames.has(candidate); counter += 1) candidate = `${base}-${digest}-${counter}`;
	return candidate;
}

function boundedStringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded string array.`);
	return value.map((entry, index) => boundedString(entry, `${label}[${index}]`, maxLength));
}

function boundedStringRecord(
	value: unknown,
	label: string,
	maxEntries: number,
	maxLength: number,
): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a string record.`);
	const entries = Object.entries(value);
	if (entries.length > maxEntries) throw new Error(`${label} exceeds ${maxEntries} entries.`);
	const result: Record<string, string> = {};
	for (const [key, entry] of entries) {
		if (!key.trim() || key.length > 256) throw new Error(`${label} has an invalid key.`);
		result[key] = boundedString(entry, `${label}.${key}`, maxLength);
	}
	return result;
}

const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function referencedEnvironmentNames(value: string): string[] {
	ENV_REFERENCE_PATTERN.lastIndex = 0;
	const names: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = ENV_REFERENCE_PATTERN.exec(value)) !== null) names.push(match[1]!);
	return names;
}

function assertScopedReferences(
	serverName: string,
	values: readonly (readonly [string, string])[],
	environment: Readonly<NodeJS.ProcessEnv>,
): void {
	for (const [label, value] of values) {
		for (const name of referencedEnvironmentNames(value)) {
			if (environment[name] === undefined) {
				throw new Error(`Muse MCP server "${serverName}" references missing scoped environment value "${name}" (${label}).`);
			}
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readMaterializedMcpServers(resources: PiboRuntimeResourceSession | undefined): Promise<Record<string, unknown>> {
	const configPath = resources?.getMcpConfigPath();
	if (!configPath) return {};
	const bytes = await readFile(configPath);
	if (bytes.byteLength > MAX_MCP_CONFIG_BYTES) throw new Error(`Native Muse MCP configuration exceeds ${MAX_MCP_CONFIG_BYTES} bytes.`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("Native Muse MCP configuration is invalid JSON.");
	}
	if (!isRecord(parsed)) throw new Error("Native Muse MCP configuration is invalid.");
	const servers = (parsed as { mcpServers?: unknown }).mcpServers;
	if (servers === undefined) return {};
	if (!isRecord(servers)) throw new Error("Native Muse MCP server configuration is invalid.");
	if (Object.keys(servers).length > MAX_MCP_SERVERS) {
		throw new Error(`Native Muse MCP configuration exceeds ${MAX_MCP_SERVERS} servers.`);
	}
	return servers;
}

export class MuseNativeResourceDelivery {
	private constructor(
		private readonly access: PiboToolMcpAccess | undefined,
		private readonly portableTools: PiboPortableToolSession | undefined,
		readonly sessionMcpConfig: MuseNativeSessionMcpConfig | undefined,
		readonly environment: Readonly<NodeJS.ProcessEnv>,
		readonly enabledToolNames: readonly string[],
		readonly hasMcpServers: boolean,
		private expiresAtMs: number | undefined,
		private disposed = false,
	) {}

	static async prepare(input: MuseNativeResourceDeliveryInput): Promise<MuseNativeResourceDelivery> {
		const servers: MuseNativeSessionMcpConfig = {};
		const externalNames = new Set<string>();
		const resourceEnvironment = input.resources?.getAdapterEnvironment() ?? {};
		// The materialized config carries ${VAR} references; resolved values stay in the scoped child
		// environment and are interpolated by the Muse host, never embedded in the delivered config.
		const materialized = await readMaterializedMcpServers(input.resources);
		for (const [name, entry] of Object.entries(materialized)) {
			const serverName = safeServerName(name);
			if (Object.keys(servers).length >= MAX_MCP_SERVERS) {
				throw new Error(`Native Muse MCP delivery exceeds ${MAX_MCP_SERVERS} servers.`);
			}
			if (!isRecord(entry)) throw new Error(`Muse MCP server "${serverName}" configuration is invalid.`);
			if (typeof entry.url === "string") {
				const url = boundedString(entry.url, `MCP server "${serverName}" url`, MAX_URL_LENGTH);
				if (!/^https?:\/\//.test(url)) throw new Error(`Muse MCP server "${serverName}" url must use http(s).`);
				const headers = boundedStringRecord(entry.headers, `MCP server "${serverName}" headers`, MAX_HEADER_ENTRIES, MAX_HEADER_VALUE_LENGTH);
				assertScopedReferences(serverName, [...Object.entries(headers ?? {}), ["url", url]], resourceEnvironment);
				servers[serverName] = {
					transport: "streamableHttp",
					url,
					...(headers ? { headers } : {}),
					mode: "required",
				};
			} else {
				const command = boundedString(entry.command, `MCP server "${serverName}" command`, MAX_COMMAND_LENGTH);
				const args = boundedStringArray(entry.args, `MCP server "${serverName}" args`, MAX_ARGS, MAX_ARG_LENGTH);
				const env = boundedStringRecord(entry.env, `MCP server "${serverName}" env`, MAX_ENV_ENTRIES, MAX_ENV_VALUE_LENGTH);
				assertScopedReferences(
					serverName,
					[["command", command], ...(args ?? []).map((value, index): [string, string] => [`args[${index}]`, value]), ...Object.entries(env ?? {})],
					resourceEnvironment,
				);
				servers[serverName] = {
					transport: "stdio",
					command,
					...(args ? { args } : {}),
					...(env ? { env } : {}),
					mode: "required",
				};
			}
			externalNames.add(serverName);
		}
		let access: PiboToolMcpAccess | undefined;
		let enabledToolNames: readonly string[] = [];
		const portableDefinitions = input.portableTools?.createDefinitions().filter((tool) => tool.portable !== false) ?? [];
		if (input.portableTools && portableDefinitions.length > 0) {
			if (Object.keys(servers).length >= MAX_MCP_SERVERS) {
				throw new Error(`Native Muse MCP delivery exceeds ${MAX_MCP_SERVERS} servers.`);
			}
			access = await input.portableTools.issueMcpAccess({ ttlMs: PIBO_TOOL_TOKEN_TTL_MS });
			enabledToolNames = [...access.allowedToolNames];
			// The credential travels as an environment reference resolved from
			// the scoped child environment; the delivered config never carries
			// the resolved token.
			servers[uniquePiboServerName(externalNames)] = {
				transport: "streamableHttp",
				url: access.url,
				headers: { authorization: `Bearer \${${PIBO_TOOL_TOKEN_ENVIRONMENT_VARIABLE}}` },
				mode: "required",
			};
		}
		const configBytes = Buffer.byteLength(JSON.stringify(servers), "utf8");
		if (configBytes > MAX_MCP_CONFIG_BYTES) {
			if (access) input.portableTools?.revokeMcpAccess(access.token);
			throw new Error(`Native Muse MCP delivery exceeds ${MAX_MCP_CONFIG_BYTES} bytes.`);
		}
		const expiresAtMs = access ? Date.parse(access.expiresAt) : undefined;
		const baseEnvironment = input.resources?.getAdapterEnvironment() ?? {};
		const environment: NodeJS.ProcessEnv = access
			? { ...baseEnvironment, [PIBO_TOOL_TOKEN_ENVIRONMENT_VARIABLE]: access.token }
			: { ...baseEnvironment };
		return new MuseNativeResourceDelivery(
			access,
			input.portableTools,
			Object.keys(servers).length > 0 ? servers : undefined,
			environment,
			enabledToolNames,
			Object.keys(servers).length > 0,
			Number.isSafeInteger(expiresAtMs) ? (expiresAtMs as number) : undefined,
		);
	}

	get warnings(): readonly MuseNativeResourceWarning[] {
		if (!this.access || this.expiresAtMs === undefined || this.disposed) return [];
		const remaining = this.expiresAtMs - Date.now();
		if (remaining <= 0) {
			return [{
				code: "muse_native_tool_credential_expired",
				message: "Native Muse portable-tool access expired; reopen the runtime session to restore Pibo-managed tools.",
			}];
		}
		if (remaining <= PIBO_TOOL_TOKEN_EXPIRY_WARNING_MS) {
			return [{
				code: "muse_native_tool_credential_expiring",
				message: "Native Muse portable-tool access is about to expire; Pibo will attempt a renewal while idle.",
			}];
		}
		return [];
	}

	renewCredential(): void {
		if (this.disposed || !this.access || !this.portableTools) return;
		const renewed = this.portableTools.renewMcpAccess(this.access.token, PIBO_TOOL_TOKEN_TTL_MS);
		const expiresAtMs = Date.parse(renewed.expiresAt);
		if (Number.isSafeInteger(expiresAtMs)) this.expiresAtMs = expiresAtMs;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.access) this.portableTools?.revokeMcpAccess(this.access.token);
	}
}
