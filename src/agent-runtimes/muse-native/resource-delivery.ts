import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
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

/** Degraded delivery mode: selected skills and context ride the first turn text. */
export const MUSE_TURN_PREFIX_DELIVERY_MODE = "muse-turn-prefix";

const MAX_PREFIX_SECTIONS = 128;
const MAX_PREFIX_SECTION_BYTES = 256 * 1024;
const MAX_PREFIX_BYTES = 1024 * 1024;
const MAX_SKILL_SIBLINGS = 128;

export type MuseNativeSelectedSkill = {
	contributionId: string;
	name: string;
	sourcePath: string;
	/** SKILL.md body; undefined when the skill already failed resource preparation. */
	content?: string;
	/** Skill-directory entries besides SKILL.md; never delivered through the turn prefix. */
	siblingFiles: readonly string[];
};

export type MuseNativeTurnPrefix = {
	text: string;
	/** Canonical hash over the selected skills and context contents. */
	hash: string;
	skillContributionIds: readonly string[];
	contextContributionIds: readonly string[];
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

function resolveEnvironmentReferences(
	serverName: string,
	label: string,
	value: string,
	environment: Readonly<NodeJS.ProcessEnv>,
): string {
	ENV_REFERENCE_PATTERN.lastIndex = 0;
	return value.replace(ENV_REFERENCE_PATTERN, (match, name: string) => {
		const resolved = environment[name];
		if (resolved === undefined) {
			throw new Error(`Muse MCP server "${serverName}" references missing scoped environment value "${name}" (${label}).`);
		}
		return resolved;
	});
}

function resolveStringRecord(
	serverName: string,
	record: Record<string, string> | undefined,
	environment: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> | undefined {
	if (!record) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) resolved[key] = resolveEnvironmentReferences(serverName, key, value, environment);
	return resolved;
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

function singleLine(value: string, maxLength: number): string {
	return value.replace(/[\r\n]+/g, " ").slice(0, maxLength);
}

async function readSelectedSkills(resources: PiboRuntimeResourceSession | undefined): Promise<MuseNativeSelectedSkill[]> {
	if (!resources) return [];
	const inspection = resources.getInspection();
	const failed = new Set(
		inspection.diagnostics
			.filter((diagnostic) => diagnostic.severity === "error" && diagnostic.contributionId)
			.map((diagnostic) => diagnostic.contributionId as string),
	);
	const selected: MuseNativeSelectedSkill[] = [];
	for (const skill of inspection.skills) {
		const skillFile = basename(skill.sourcePath);
		const siblings = await readdir(dirname(skill.sourcePath)).then(
			(entries) => entries.filter((entry) => entry !== skillFile).slice(0, MAX_SKILL_SIBLINGS).sort(),
			() => [] as string[],
		);
		if (failed.has(skill.contributionId)) {
			selected.push({ contributionId: skill.contributionId, name: skill.name, sourcePath: skill.sourcePath, siblingFiles: siblings });
			continue;
		}
		let content: string;
		try {
			content = await readFile(skill.sourcePath, "utf8");
		} catch (error) {
			throw new Error(`Native Muse skill "${skill.name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!content.trim()) throw new Error(`Native Muse skill "${skill.name}" is empty.`);
		selected.push({ contributionId: skill.contributionId, name: skill.name, sourcePath: skill.sourcePath, content, siblingFiles: siblings });
	}
	return selected;
}

/**
 * MSP 1.3.0 session config carries only MCP servers, so selected skills and
 * context are rendered once as turn text. The canonical hash covers the exact
 * selection contents; resume compares it to detect changed selections.
 */
export function buildMuseNativeTurnPrefix(
	skills: readonly MuseNativeSelectedSkill[],
	context: ReturnType<PiboRuntimeResourceSession["getContextContributions"]>,
	kind: "initial" | "updated" = "initial",
): MuseNativeTurnPrefix | undefined {
	const skillSections = skills.filter((skill) => skill.content?.trim());
	const contextSections = context.filter((contribution) =>
		!contribution.nativeDiscovered && contribution.content?.trim());
	if (skillSections.length + contextSections.length === 0) return undefined;
	if (skillSections.length + contextSections.length > MAX_PREFIX_SECTIONS) {
		throw new Error(`Native Muse turn prefix exceeds ${MAX_PREFIX_SECTIONS} sections.`);
	}
	const hash = createHash("sha256").update(JSON.stringify({
		skills: skillSections.map((skill) => [skill.contributionId, skill.content]),
		context: contextSections.map((contribution) => [contribution.id, contribution.content]),
	})).digest("hex");
	let totalBytes = 0;
	const renderSection = (heading: string, content: string): string => {
		const bytes = Buffer.byteLength(content, "utf8");
		if (bytes > MAX_PREFIX_SECTION_BYTES) {
			throw new Error(`Native Muse turn prefix section "${heading}" exceeds ${MAX_PREFIX_SECTION_BYTES} bytes.`);
		}
		totalBytes += bytes;
		if (totalBytes > MAX_PREFIX_BYTES) throw new Error(`Native Muse turn prefix exceeds ${MAX_PREFIX_BYTES} bytes.`);
		return [`## ${singleLine(heading, 256)}`, "", content].join("\n");
	};
	const blocks: string[] = [];
	if (skillSections.length > 0) {
		blocks.push([
			"# Pibo-Selected Skills",
			"",
			kind === "updated"
				? "The skill selection changed since this session started; the following replaces the earlier injected skills. Skills listed here are Pibo knowledge, not host-invocable skills unless the host catalog matches them by name."
				: "The following Pibo-selected skills are injected because the Muse host exposes skills only as a read-only catalog with no delivery seam. Skills listed here are Pibo knowledge, not host-invocable skills unless the host catalog matches them by name.",
			"",
			...skillSections.map((skill) => renderSection(skill.name, skill.content as string)),
		].join("\n\n"));
	}
	if (contextSections.length > 0) {
		blocks.push([
			"# Pibo-Selected Context",
			"",
			kind === "updated"
				? "The context selection changed since this session started; the following replaces the earlier injected context. They do not replace Muse native system instructions or native tools."
				: "The following contributions are additive context selected by Pibo. They do not replace Muse native system instructions or native tools.",
			"",
			...contextSections.map((contribution) => renderSection(contribution.label, contribution.content as string)),
		].join("\n\n"));
	}
	return {
		text: blocks.join("\n\n---\n\n"),
		hash,
		skillContributionIds: skillSections.map((skill) => skill.contributionId),
		contextContributionIds: contextSections.map((contribution) => contribution.id),
	};
}

export class MuseNativeResourceDelivery {
	private constructor(
		private readonly access: PiboToolMcpAccess | undefined,
		private readonly portableTools: PiboPortableToolSession | undefined,
		readonly sessionMcpConfig: MuseNativeSessionMcpConfig | undefined,
		readonly environment: Readonly<NodeJS.ProcessEnv>,
		readonly enabledToolNames: readonly string[],
		readonly hasMcpServers: boolean,
		readonly selectedSkills: readonly MuseNativeSelectedSkill[],
		readonly turnPrefix: MuseNativeTurnPrefix | undefined,
		private readonly contextContributions: ReturnType<PiboRuntimeResourceSession["getContextContributions"]>,
		private expiresAtMs: number | undefined,
		private disposed = false,
	) {}

	/** Re-renders the armed prefix; the canonical hash is kind-independent. */
	renderTurnPrefix(kind: "initial" | "updated"): MuseNativeTurnPrefix | undefined {
		if (!this.turnPrefix) return undefined;
		if (kind === "initial") return this.turnPrefix;
		return buildMuseNativeTurnPrefix(this.selectedSkills, this.contextContributions, kind);
	}

	static async prepare(input: MuseNativeResourceDeliveryInput): Promise<MuseNativeResourceDelivery> {
		// Skills and context first: bounds and IO failures abort before any tool credential is issued.
		const selectedSkills = await readSelectedSkills(input.resources);
		const contextContributions = input.resources?.getContextContributions() ?? [];
		const turnPrefix = buildMuseNativeTurnPrefix(selectedSkills, contextContributions);
		const servers: MuseNativeSessionMcpConfig = {};
		const externalNames = new Set<string>();
		const resourceEnvironment = input.resources?.getAdapterEnvironment() ?? {};
		// The Muse host sends streamableHttp headers verbatim and does not interpolate
		// ${VAR} references, so values are resolved here against the scoped environment
		// before delivery. The child environment still carries the same values.
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
					url: resolveEnvironmentReferences(serverName, "url", url, resourceEnvironment),
					...(headers ? { headers: resolveStringRecord(serverName, headers, resourceEnvironment) } : {}),
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
					command: resolveEnvironmentReferences(serverName, "command", command, resourceEnvironment),
					...(args ? { args: args.map((value, index) => resolveEnvironmentReferences(serverName, `args[${index}]`, value, resourceEnvironment)) } : {}),
					...(env ? { env: resolveStringRecord(serverName, env, resourceEnvironment) } : {}),
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
			// The host does not interpolate ${VAR} references, so the credential is
			// embedded resolved. It stays scoped: 5-minute TTL, same-token renewal,
			// revoked on disposal, and the adapter never logs the delivered config.
			servers[uniquePiboServerName(externalNames)] = {
				transport: "streamableHttp",
				url: access.url,
				headers: { authorization: `Bearer ${access.token}` },
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
			selectedSkills,
			turnPrefix,
			contextContributions,
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
