import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	AgentRuntimeMcpResourceInfo,
	AgentRuntimeMcpResourceTemplateInfo,
	PiboRuntimeMcpVerificationResult,
} from "../agent-runtime/resources.js";
import {
	filterTools,
	isHttpServer,
	type ServerConfig,
} from "./config.js";

const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|cookie|credential|oauth|password|secret|token)/i;
const ENV_REFERENCE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export type ScopedPiboMcpServerConfig = {
	materialized: ServerConfig;
	resolved: ServerConfig;
	secretEnvironment: Record<string, string>;
	secretEnvironmentKeys: string[];
};

function resolveEnvironmentString(value: string, environment: NodeJS.ProcessEnv): string {
	const missing = new Set<string>();
	const resolved = value.replace(ENV_REFERENCE_RE, (_match, name: string) => {
		const replacement = environment[name];
		if (replacement === undefined) {
			missing.add(name);
			return "";
		}
		return replacement;
	});
	if (missing.size > 0) throw new Error(`Missing environment variables: ${[...missing].sort().join(", ")}`);
	return resolved;
}

function generatedSecretName(serverName: string, path: readonly string[], value: string): string {
	const readable = [serverName, ...path]
		.join("_")
		.toUpperCase()
		.replace(/[^A-Z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 72);
	const hash = createHash("sha256").update(`${serverName}\0${path.join(".")}\0${value}`).digest("hex").slice(0, 12).toUpperCase();
	return `PIBO_RUNTIME_MCP_${readable || "VALUE"}_${hash}`;
}

function urlLooksSensitive(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password) return true;
		for (const key of url.searchParams.keys()) {
			if (SECRET_KEY_RE.test(key)) return true;
		}
	} catch {
		return false;
	}
	return false;
}

function scopeConfigValue(
	serverName: string,
	value: unknown,
	path: readonly string[],
	environment: NodeJS.ProcessEnv,
	secretEnvironment: Record<string, string>,
	forceSecret = false,
): { materialized: unknown; resolved: unknown } {
	if (typeof value === "string") {
		const hasReference = ENV_REFERENCE_RE.test(value);
		ENV_REFERENCE_RE.lastIndex = 0;
		const secret = forceSecret || hasReference || SECRET_KEY_RE.test(path.at(-1) ?? "") || (path.at(-1) === "url" && urlLooksSensitive(value));
		if (!secret) return { materialized: value, resolved: value };
		const resolved = resolveEnvironmentString(value, environment);
		const environmentName = generatedSecretName(serverName, path, value);
		secretEnvironment[environmentName] = resolved;
		return { materialized: `\${${environmentName}}`, resolved };
	}
	if (Array.isArray(value)) {
		const materialized: unknown[] = [];
		const resolved: unknown[] = [];
		for (const [index, item] of value.entries()) {
			const scoped = scopeConfigValue(serverName, item, [...path, String(index)], environment, secretEnvironment, forceSecret);
			materialized.push(scoped.materialized);
			resolved.push(scoped.resolved);
		}
		return { materialized, resolved };
	}
	if (value && typeof value === "object") {
		const materialized: Record<string, unknown> = {};
		const resolved: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			const scoped = scopeConfigValue(
				serverName,
				item,
				[...path, key],
				environment,
				secretEnvironment,
				forceSecret || path.at(-1) === "env" || path.at(-1) === "headers" || path.at(-1) === "args",
			);
			materialized[key] = scoped.materialized;
			resolved[key] = scoped.resolved;
		}
		return { materialized, resolved };
	}
	return { materialized: value, resolved: value };
}

export function scopePiboMcpServerConfig(
	serverName: string,
	config: ServerConfig,
	environment: NodeJS.ProcessEnv,
): ScopedPiboMcpServerConfig {
	const secretEnvironment: Record<string, string> = {};
	const scoped = scopeConfigValue(serverName, config, [], environment, secretEnvironment);
	return {
		materialized: scoped.materialized as ServerConfig,
		resolved: scoped.resolved as ServerConfig,
		secretEnvironment,
		secretEnvironmentKeys: Object.keys(secretEnvironment).sort(),
	};
}

export function redactMcpRuntimeError(error: unknown, secretValues: readonly string[] = []): string {
	let message = error instanceof Error ? error.message : String(error);
	for (const value of secretValues) {
		if (value) message = message.split(value).join("[REDACTED]");
	}
	return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

export async function verifyPiboMcpServer(
	serverName: string,
	config: ServerConfig,
	options: { timeoutMs: number },
): Promise<PiboRuntimeMcpVerificationResult> {
	const client = new Client({ name: "pibo-runtime-resource-verifier", version: "1.0.0" }, { capabilities: {} });
	let transport: Transport;
	if (isHttpServer(config)) {
		transport = new StreamableHTTPClientTransport(new URL(config.url), {
			requestInit: { headers: config.headers },
		});
	} else {
		const env: Record<string, string> = {
			...getDefaultEnvironment(),
			...(config.env ?? {}),
		};
		transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env,
			cwd: config.cwd,
			stderr: "pipe",
		});
	}
	const signal = AbortSignal.timeout(options.timeoutMs);
	try {
		await client.connect(transport, { signal, timeout: options.timeoutMs, maxTotalTimeout: options.timeoutMs });
		const capabilities = client.getServerCapabilities();
		const listedTools = capabilities?.tools
			? (await client.listTools(undefined, { signal, timeout: options.timeoutMs, maxTotalTimeout: options.timeoutMs })).tools
			: [];
		const tools = filterTools(listedTools.map((tool) => ({
			name: tool.name,
			...(tool.description ? { description: tool.description } : {}),
		})), config);
		let resources: AgentRuntimeMcpResourceInfo[] = [];
		let resourceTemplates: AgentRuntimeMcpResourceTemplateInfo[] = [];
		if (capabilities?.resources) {
			const listed = await client.listResources(undefined, { signal, timeout: options.timeoutMs, maxTotalTimeout: options.timeoutMs });
			resources = listed.resources.map((resource) => ({
				uri: resource.uri,
				...(resource.name ? { name: resource.name } : {}),
				...(resource.description ? { description: resource.description } : {}),
				...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
			}));
			const templates = await client.listResourceTemplates(undefined, { signal, timeout: options.timeoutMs, maxTotalTimeout: options.timeoutMs });
			resourceTemplates = templates.resourceTemplates.map((template) => ({
				uriTemplate: template.uriTemplate,
				...(template.name ? { name: template.name } : {}),
				...(template.description ? { description: template.description } : {}),
				...(template.mimeType ? { mimeType: template.mimeType } : {}),
			}));
		}
		const version = client.getServerVersion();
		return {
			status: "connected",
			...(version?.name ? { serverName: version.name } : {}),
			...(version?.version ? { serverVersion: version.version } : {}),
			...(client.getInstructions() ? { instructions: client.getInstructions() } : {}),
			tools,
			resources,
			resourceTemplates,
		};
	} catch (error) {
		throw new Error(`MCP server "${serverName}" verification failed: ${redactMcpRuntimeError(error)}`);
	} finally {
		await client.close().catch(async () => transport.close().catch(() => {}));
	}
}
