import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type { PiboRuntimeResourceSession } from "../../agent-runtime/resources.js";
import type { PiboPortableToolSession, PiboToolMcpAccess } from "../../tools/session-service.js";
import type { CodexAppServerClient } from "./client.js";
import type {
	CodexAppServerListMcpServerStatusResponse,
	CodexAppServerMcpServerStatus,
	CodexAppServerSkillsExtraRootsSetParams,
	CodexAppServerSkillsExtraRootsSetResponse,
	CodexAppServerSkillsListResponse,
} from "./protocol-types.js";

const MAX_CONTEXT_CONTRIBUTIONS = 128;
const MAX_CONTEXT_CONTRIBUTION_BYTES = 256 * 1024;
const MAX_CONTEXT_BYTES = 1024 * 1024;
const MAX_MCP_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_MCP_SERVERS = 32;
const MAX_MCP_STATUS_PAGES = 20;
const MCP_STATUS_PAGE_SIZE = 100;
const PIBO_TOOL_TOKEN_TTL_MS = 5 * 60_000;
const PIBO_TOOL_TOKEN_RENEW_LEAD_MS = 60_000;
const PIBO_TOOL_TOKEN_ROLLOVER_MS = 25 * 60_000;
const PIBO_TOOL_TOKEN_TURN_ROLLOVER_MS = 5 * 60_000;
const ENV_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const ENABLED_MCP_CONTEXT_ID = "context:enabled-mcp-servers";
const MCP_STDIO_LAUNCHER_PATH = fileURLToPath(new URL("./mcp-stdio-launcher.js", import.meta.url));
const MAX_STDIO_COMMAND_BYTES = 16 * 1024;
const MAX_STDIO_ARGS_BYTES = 256 * 1024;
const MAX_STDIO_ENVIRONMENT_BYTES = 512 * 1024;

export type CodexNativeResourceDeliveryInput = {
	workspace: string;
	portableTools?: PiboPortableToolSession;
	resources?: PiboRuntimeResourceSession;
};

type ExpectedMcpServer = {
	name: string;
	toolNames: string[];
};

type MaterializedMcpConfig = {
	mcpServers?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonValue(value: unknown): PiboJsonValue {
	return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
}

function safeServerName(value: string): string {
	if (!value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error("Selected MCP server name is not supported by native Codex delivery.");
	}
	return value;
}

function uniquePiboServerName(externalNames: ReadonlySet<string>): string {
	const base = "pibo-session-tools";
	if (!externalNames.has(base)) return base;
	return `${base}-${createHash("sha256").update([...externalNames].sort().join("\0")).digest("hex").slice(0, 8)}`;
}

function environmentReference(value: string): string | undefined {
	return ENV_REFERENCE_PATTERN.exec(value)?.[1];
}

function boundedString(value: unknown, label: string, maxLength = 4096): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
	if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
	return value;
}

function optionalStringArray(
	value: unknown,
	label: string,
	maxItems = 512,
	maxLength = 256,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded string array.`);
	return value.map((entry, index) => boundedString(entry, `${label}[${index}]`, maxLength));
}

function buildDeveloperInstructions(resources: PiboRuntimeResourceSession | undefined): string | undefined {
	if (!resources) return undefined;
	const contributions = resources.getContextContributions().filter((contribution) =>
		contribution.id !== ENABLED_MCP_CONTEXT_ID && contribution.content?.trim());
	if (contributions.length === 0) return undefined;
	if (contributions.length > MAX_CONTEXT_CONTRIBUTIONS) {
		throw new Error(`Native Codex context exceeds ${MAX_CONTEXT_CONTRIBUTIONS} contributions.`);
	}
	let totalBytes = 0;
	const sections = contributions.map((contribution, index) => {
		const content = contribution.content ?? "";
		const bytes = Buffer.byteLength(content, "utf8");
		if (bytes > MAX_CONTEXT_CONTRIBUTION_BYTES) {
			throw new Error(`Native Codex context contribution ${index + 1} exceeds ${MAX_CONTEXT_CONTRIBUTION_BYTES} bytes.`);
		}
		totalBytes += bytes;
		if (totalBytes > MAX_CONTEXT_BYTES) throw new Error(`Native Codex context exceeds ${MAX_CONTEXT_BYTES} bytes.`);
		const label = contribution.label.replace(/[\r\n]+/g, " ").slice(0, 256);
		return [`## ${label}`, "", content].join("\n");
	});
	return [
		"# Pibo-Selected Context",
		"",
		"The following contributions are additive developer context selected by Pibo. They do not replace Codex native system instructions or native tools.",
		"",
		...sections,
	].join("\n\n");
}

async function readMaterializedMcpConfig(resources: PiboRuntimeResourceSession | undefined): Promise<Record<string, unknown>> {
	const configPath = resources?.getMcpConfigPath();
	if (!configPath) return {};
	const bytes = await readFile(configPath);
	if (bytes.byteLength > MAX_MCP_CONFIG_BYTES) throw new Error(`Native Codex MCP configuration exceeds ${MAX_MCP_CONFIG_BYTES} bytes.`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("Native Codex MCP configuration is invalid JSON.");
	}
	if (!isRecord(parsed)) throw new Error("Native Codex MCP configuration is invalid.");
	const config = parsed as MaterializedMcpConfig;
	if (config.mcpServers === undefined) return {};
	if (!isRecord(config.mcpServers)) throw new Error("Native Codex MCP server configuration is invalid.");
	if (Object.keys(config.mcpServers).length > MAX_MCP_SERVERS) {
		throw new Error(`Native Codex MCP configuration exceeds ${MAX_MCP_SERVERS} servers.`);
	}
	return config.mcpServers;
}

function toolSelectionFields(
	name: string,
	value: Record<string, unknown>,
	verifiedToolNames: readonly string[],
): PiboJsonObject {
	const allowedTools = optionalStringArray(value.allowedTools, `MCP server ${name} allowedTools`);
	const disabledTools = optionalStringArray(value.disabledTools, `MCP server ${name} disabledTools`);
	if (verifiedToolNames.length > 512) throw new Error(`Selected MCP server "${name}" exposes too many tools.`);
	const enabledTools = [...new Set(verifiedToolNames.map((toolName, index) => boundedString(toolName, `MCP server ${name} tool ${index}`, 256)))];
	return enabledTools.length > 0 || allowedTools !== undefined || disabledTools !== undefined
		? { enabled_tools: enabledTools }
		: {};
}

function convertHttpMcpServer(
	name: string,
	value: unknown,
	environment: Readonly<NodeJS.ProcessEnv>,
	verifiedToolNames: readonly string[],
): PiboJsonObject {
	if (!isRecord(value) || typeof value.url !== "string") {
		throw new Error(`Selected MCP server "${name}" requires Streamable HTTP for native Codex delivery.`);
	}
	if (value.url.includes("${")) {
		throw new Error(`Selected MCP server "${name}" has a sensitive or environment-derived URL that native Codex cannot receive safely.`);
	}
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(value.url);
	} catch {
		throw new Error(`Selected MCP server "${name}" has an invalid URL.`);
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(`Selected MCP server "${name}" must use HTTP or HTTPS.`);
	}
	const httpHeaders: Record<string, string> = Object.create(null) as Record<string, string>;
	const envHttpHeaders: Record<string, string> = Object.create(null) as Record<string, string>;
	if (value.headers !== undefined) {
		if (!isRecord(value.headers) || Object.keys(value.headers).length > 128) {
			throw new Error(`Selected MCP server "${name}" has invalid headers.`);
		}
		for (const [header, rawValue] of Object.entries(value.headers)) {
			const headerValue = boundedString(rawValue, `MCP header ${header}`, 8192);
			const environmentName = environmentReference(headerValue);
			if (environmentName) {
				if (environment[environmentName] === undefined) throw new Error(`Selected MCP server "${name}" is missing a scoped header value.`);
				envHttpHeaders[header] = environmentName;
			} else {
				httpHeaders[header] = headerValue;
			}
		}
	}
	const toolSelection = toolSelectionFields(name, value, verifiedToolNames);
	let toolTimeoutSeconds: number | undefined;
	if (value.timeout !== undefined) {
		if (typeof value.timeout !== "number" || !Number.isFinite(value.timeout) || value.timeout <= 0) {
			throw new Error(`Selected MCP server "${name}" has an invalid timeout.`);
		}
		toolTimeoutSeconds = value.timeout / 1000;
	}
	return {
		url: parsedUrl.toString(),
		enabled: true,
		required: true,
		...(Object.keys(httpHeaders).length > 0 ? { http_headers: httpHeaders } : {}),
		...(Object.keys(envHttpHeaders).length > 0 ? { env_http_headers: envHttpHeaders } : {}),
		...toolSelection,
		...(toolTimeoutSeconds !== undefined ? { tool_timeout_sec: toolTimeoutSeconds } : {}),
	};
}

function stdioEnvironmentName(name: string, suffix: "COMMAND" | "ARGS" | "ENV" | "CWD"): string {
	const hash = createHash("sha256").update(name).digest("hex").slice(0, 16).toUpperCase();
	return `PIBO_CODEX_MCP_STDIO_${hash}_${suffix}`;
}

function convertStdioMcpServer(
	name: string,
	materialized: unknown,
	resolved: unknown,
	environment: NodeJS.ProcessEnv,
	verifiedToolNames: readonly string[],
): PiboJsonObject {
	if (!isRecord(materialized) || !isRecord(resolved) || typeof resolved.command !== "string") {
		throw new Error(`Selected MCP server "${name}" has an invalid stdio configuration.`);
	}
	const command = boundedString(resolved.command, `MCP server ${name} command`, MAX_STDIO_COMMAND_BYTES);
	if (command.includes("\u0000") || Buffer.byteLength(command, "utf8") > MAX_STDIO_COMMAND_BYTES) {
		throw new Error(`Selected MCP server "${name}" has an invalid command.`);
	}
	const args = optionalStringArray(resolved.args, `MCP server ${name} args`, 512, 16 * 1024) ?? [];
	if (args.some((value) => value.includes("\u0000"))) throw new Error(`Selected MCP server "${name}" has invalid arguments.`);
	const argsJson = JSON.stringify(args);
	if (Buffer.byteLength(argsJson, "utf8") > MAX_STDIO_ARGS_BYTES) {
		throw new Error(`Selected MCP server "${name}" has oversized arguments.`);
	}
	const childEnvironment: Record<string, string> = Object.create(null) as Record<string, string>;
	if (resolved.env !== undefined) {
		if (!isRecord(resolved.env) || Object.keys(resolved.env).length > 512) {
			throw new Error(`Selected MCP server "${name}" has an invalid environment.`);
		}
		for (const [key, rawValue] of Object.entries(resolved.env)) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof rawValue !== "string" || rawValue.includes("\u0000")) {
				throw new Error(`Selected MCP server "${name}" has an invalid environment entry.`);
			}
			childEnvironment[key] = rawValue;
		}
	}
	const environmentJson = JSON.stringify(childEnvironment);
	if (Buffer.byteLength(environmentJson, "utf8") > MAX_STDIO_ENVIRONMENT_BYTES) {
		throw new Error(`Selected MCP server "${name}" has an oversized environment.`);
	}
	const cwd = resolved.cwd === undefined
		? ""
		: boundedString(resolved.cwd, `MCP server ${name} cwd`, MAX_STDIO_COMMAND_BYTES);
	if (cwd.includes("\u0000") || Buffer.byteLength(cwd, "utf8") > MAX_STDIO_COMMAND_BYTES) {
		throw new Error(`Selected MCP server "${name}" has an invalid working directory.`);
	}
	const commandEnvironment = stdioEnvironmentName(name, "COMMAND");
	const argsEnvironment = stdioEnvironmentName(name, "ARGS");
	const childEnvironmentName = stdioEnvironmentName(name, "ENV");
	const cwdEnvironment = stdioEnvironmentName(name, "CWD");
	environment[commandEnvironment] = command;
	environment[argsEnvironment] = argsJson;
	environment[childEnvironmentName] = environmentJson;
	environment[cwdEnvironment] = cwd;
	const environmentNames = [commandEnvironment, argsEnvironment, childEnvironmentName, cwdEnvironment];
	return {
		command: process.execPath,
		args: [MCP_STDIO_LAUNCHER_PATH, ...environmentNames],
		env_vars: environmentNames,
		enabled: true,
		required: true,
		...toolSelectionFields(name, materialized, verifiedToolNames),
	};
}

function validateSkillsListResponse(value: unknown): CodexAppServerSkillsListResponse {
	if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 128) {
		throw new Error("Codex skills/list returned an invalid response.");
	}
	return value as unknown as CodexAppServerSkillsListResponse;
}

function validateMcpStatusResponse(value: unknown): CodexAppServerListMcpServerStatusResponse {
	if (
		!isRecord(value)
		|| !Array.isArray(value.data)
		|| value.data.length > MAX_MCP_SERVERS
		|| (value.nextCursor !== undefined && value.nextCursor !== null && typeof value.nextCursor !== "string")
	) {
		throw new Error("Codex mcpServerStatus/list returned an invalid response.");
	}
	return value as unknown as CodexAppServerListMcpServerStatusResponse;
}

export class CodexNativeResourceDelivery {
	private constructor(
		readonly environment: Readonly<NodeJS.ProcessEnv>,
		readonly threadConfig: Record<string, PiboJsonValue> | undefined,
		readonly developerInstructions: string | undefined,
		private readonly skillRoots: string[],
		private readonly skillPaths: string[],
		private readonly expectedMcpServers: ExpectedMcpServer[],
		private readonly portableTools?: PiboPortableToolSession,
		private readonly mcpAccess?: PiboToolMcpAccess,
		private readonly credentialIssuedAtMs?: number,
		private credentialExpiresAtMs?: number,
	) {}

	static async prepare(input: CodexNativeResourceDeliveryInput): Promise<CodexNativeResourceDelivery> {
		const resourceEnvironment = { ...(input.resources?.getAdapterEnvironment() ?? {}) };
		const materializedMcpServers = await readMaterializedMcpConfig(input.resources);
		const externalNames = new Set(Object.keys(materializedMcpServers).map(safeServerName));
		const resolvedMcpServers = input.resources?.getExternalMcpServerConfigs() ?? {};
		const codexMcpServers: Record<string, PiboJsonValue> = Object.create(null) as Record<string, PiboJsonValue>;
		const expectedMcpServers: ExpectedMcpServer[] = [];
		const inspectionByName = new Map(
			(input.resources?.getInspection().mcpServers ?? []).map((server) => [server.name, server]),
		);
		for (const [name, config] of Object.entries(materializedMcpServers)) {
			const safeName = safeServerName(name);
			const toolNames = inspectionByName.get(name)?.tools.map((tool) => tool.name) ?? [];
			codexMcpServers[safeName] = isRecord(config) && typeof config.url === "string"
				? convertHttpMcpServer(safeName, config, resourceEnvironment, toolNames)
				: convertStdioMcpServer(safeName, config, resolvedMcpServers[name], resourceEnvironment, toolNames);
			expectedMcpServers.push({ name: safeName, toolNames });
		}

		let mcpAccess: PiboToolMcpAccess | undefined;
		let credentialIssuedAtMs: number | undefined;
		let credentialExpiresAtMs: number | undefined;
		try {
			const portableDefinitions = input.portableTools?.createDefinitions().filter((tool) => tool.portable !== false) ?? [];
			if (portableDefinitions.length > 0 && input.portableTools) {
				const allowedToolNames = [...new Set(portableDefinitions.map((tool) => tool.name))];
				credentialIssuedAtMs = Date.now();
				mcpAccess = await input.portableTools.issueMcpAccess({
					allowedToolNames,
					ttlMs: PIBO_TOOL_TOKEN_TTL_MS,
				});
				credentialExpiresAtMs = Date.parse(mcpAccess.expiresAt);
				if (!Number.isFinite(credentialExpiresAtMs) || credentialExpiresAtMs <= credentialIssuedAtMs) {
					throw new Error("Pibo tool MCP returned an invalid credential expiry.");
				}
				const environmentName = `PIBO_CODEX_MCP_TOKEN_${mcpAccess.credentialId.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
				resourceEnvironment[environmentName] = mcpAccess.token;
				const serverName = uniquePiboServerName(externalNames);
				codexMcpServers[serverName] = {
					url: mcpAccess.url,
					bearer_token_env_var: environmentName,
					enabled: true,
					required: true,
					enabled_tools: [...mcpAccess.allowedToolNames],
					// These are explicitly selected, session-scoped Pibo tools. Codex's native
					// prompt path otherwise rejects model-initiated MCP calls when no MCP
					// approval UI is active for the turn.
					default_tools_approval_mode: "approve",
				};
				expectedMcpServers.push({ name: serverName, toolNames: [...mcpAccess.allowedToolNames] });
			}

			const skillPaths = input.resources
				? await Promise.all(input.resources.getSkillPaths("materialized").map(async (path) => await realpath(path)))
				: [];
			const materializedSkillsRoot = input.resources?.getInspection().paths?.skills;
			const skillRoots = skillPaths.length > 0 && materializedSkillsRoot
				? [await realpath(materializedSkillsRoot)]
				: [];
			const threadConfig = Object.keys(codexMcpServers).length > 0
				? { mcp_servers: asJsonValue(codexMcpServers) }
				: undefined;
			return new CodexNativeResourceDelivery(
				resourceEnvironment,
				threadConfig,
				buildDeveloperInstructions(input.resources),
				skillRoots,
				skillPaths,
				expectedMcpServers,
				input.portableTools,
				mcpAccess,
				credentialIssuedAtMs,
				credentialExpiresAtMs,
			);
		} catch (error) {
			if (mcpAccess && input.portableTools) input.portableTools.revokeMcpAccess(mcpAccess.token);
			throw error;
		}
	}

	get hasMcpServers(): boolean {
		return this.expectedMcpServers.length > 0;
	}

	get enabledToolNames(): readonly string[] {
		return this.expectedMcpServers
			.flatMap((server) => server.toolNames.map((toolName) => `${server.name}/${toolName}`))
			.sort();
	}

	get nextCredentialMaintenanceAt(): number | undefined {
		if (!this.mcpAccess || this.credentialIssuedAtMs === undefined || this.credentialExpiresAtMs === undefined) return undefined;
		return Math.min(
			this.credentialExpiresAtMs - PIBO_TOOL_TOKEN_RENEW_LEAD_MS,
			this.credentialIssuedAtMs + PIBO_TOOL_TOKEN_ROLLOVER_MS,
		);
	}

	needsCredentialRolloverForTurn(now = Date.now()): boolean {
		return this.credentialIssuedAtMs !== undefined
			&& now >= this.credentialIssuedAtMs + PIBO_TOOL_TOKEN_TURN_ROLLOVER_MS;
	}

	shouldRolloverCredential(now = Date.now()): boolean {
		return this.credentialIssuedAtMs !== undefined
			&& now >= this.credentialIssuedAtMs + PIBO_TOOL_TOKEN_ROLLOVER_MS;
	}

	renewCredential(): void {
		if (!this.mcpAccess || !this.portableTools) return;
		const renewed = this.portableTools.renewMcpAccess(this.mcpAccess.token, PIBO_TOOL_TOKEN_TTL_MS);
		const expiresAt = Date.parse(renewed.expiresAt);
		if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
			throw new Error("Pibo tool MCP credential renewal returned an invalid expiry.");
		}
		this.credentialExpiresAtMs = expiresAt;
	}

	async configureProcess(client: CodexAppServerClient, workspace: string): Promise<void> {
		if (this.skillRoots.length === 0) return;
		let response: CodexAppServerSkillsListResponse;
		try {
			await client.request<CodexAppServerSkillsExtraRootsSetResponse, CodexAppServerSkillsExtraRootsSetParams>(
				"skills/extraRoots/set",
				{ extraRoots: [...this.skillRoots] },
			);
			response = validateSkillsListResponse(await client.request<unknown>("skills/list", {
				cwds: [workspace],
				forceReload: true,
			}));
		} catch {
			throw new Error("Codex could not load the selected Pibo skills.");
		}
		const loadedPaths = new Set<string>();
		for (const entry of response.data) {
			if (!isRecord(entry) || !Array.isArray(entry.skills) || !Array.isArray(entry.errors)) {
				throw new Error("Codex skills/list returned an invalid entry.");
			}
			for (const skill of entry.skills) {
				if (!isRecord(skill) || typeof skill.path !== "string" || typeof skill.enabled !== "boolean") {
					throw new Error("Codex skills/list returned an invalid skill.");
				}
				if (skill.enabled) loadedPaths.add(await realpath(skill.path).catch(() => skill.path));
			}
		}
		if (this.skillPaths.some((path) => !loadedPaths.has(path))) {
			throw new Error("Codex did not load every selected Pibo skill.");
		}
	}

	async verifyThread(client: CodexAppServerClient, threadId: string): Promise<void> {
		if (this.expectedMcpServers.length === 0) return;
		const statuses: CodexAppServerMcpServerStatus[] = [];
		const cursors = new Set<string>();
		let cursor: string | null | undefined;
		for (let page = 0; page < MAX_MCP_STATUS_PAGES; page++) {
			let response: CodexAppServerListMcpServerStatusResponse;
			try {
				response = validateMcpStatusResponse(await client.request<unknown>("mcpServerStatus/list", {
					threadId,
					cursor: cursor ?? null,
					limit: MCP_STATUS_PAGE_SIZE,
					detail: "full",
				}));
			} catch {
				throw new Error("Codex could not inspect selected MCP server status.");
			}
			statuses.push(...response.data);
			cursor = response.nextCursor;
			if (!cursor) break;
			if (cursors.has(cursor)) throw new Error("Codex MCP status repeated a pagination cursor.");
			cursors.add(cursor);
			if (page === MAX_MCP_STATUS_PAGES - 1) throw new Error(`Codex MCP status exceeded ${MAX_MCP_STATUS_PAGES} pages.`);
		}
		const byName = new Map(statuses.flatMap((status) =>
			isRecord(status) && typeof status.name === "string" ? [[status.name, status] as const] : []));
		for (const expected of this.expectedMcpServers) {
			const status = byName.get(expected.name);
			if (!status || !isRecord(status.tools)) throw new Error("Codex did not initialize every selected MCP server.");
			const toolNames = new Set(Object.keys(status.tools));
			if (expected.toolNames.some((name) => !toolNames.has(name))) {
				throw new Error("Codex did not expose every selected MCP tool.");
			}
		}
	}

	dispose(): void {
		if (this.mcpAccess && this.portableTools) this.portableTools.revokeMcpAccess(this.mcpAccess.token);
	}
}
