import {
	chmod,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { PIBO_APP_CONTEXT } from "../app-context.js";
import type { InitialSessionContext } from "../core/profiles.js";
import { piboHomePath } from "../core/pibo-home.js";
import { DEFAULT_USER_TIMEZONE } from "../core/user-settings.js";
import {
	isHttpServer,
	loadConfigUnresolved,
	type McpServersConfig,
	type ServerConfig,
} from "../mcp/config.js";
import {
	redactMcpRuntimeError as redactResourceError,
	scopePiboMcpServerConfig,
	verifyPiboMcpServer,
	type ScopedPiboMcpServerConfig,
} from "../mcp/runtime-session.js";
import { getMcpAgentContextFileFromConfig } from "../mcp/agent-context.js";
import { getInstalledCliToolContextFile } from "../tools/registry.js";
import type { AgentRuntimeCapabilities, AgentRuntimeCapabilityDelivery } from "./capabilities.js";
import {
	copyAgentRuntimeSkillDirectory,
	createAgentRuntimeResourcePaths,
} from "./resource-files.js";
import type {
	AgentRuntimeContextContribution,
	AgentRuntimeDeliveryReport,
	AgentRuntimeExternalMcpServerInspection,
	AgentRuntimeResourceDiagnostic,
	AgentRuntimeResourceInspection,
	AgentRuntimeResourcePaths,
	AgentRuntimeSkillResource,
	PiboRuntimeMcpVerifier,
	PiboRuntimeResourceSession,
} from "./resources.js";

const DEFAULT_MCP_VERIFY_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SKILL_FILES = 2_048;
const DEFAULT_MAX_SKILL_BYTES = 64 * 1024 * 1024;
const MCP_CONFIG_FILE = "mcp-servers.json";
export type PiboRuntimeResourceServiceOptions = {
	rootDir?: string;
	mcpConfigPath?: string;
	environment?: NodeJS.ProcessEnv;
	verifyMcpServer?: PiboRuntimeMcpVerifier;
	mcpVerifyTimeoutMs?: number;
	maxSkillFiles?: number;
	maxSkillBytes?: number;
};

type ResolvedPiboRuntimeResourceServiceOptions = Required<Pick<
	PiboRuntimeResourceServiceOptions,
	"rootDir" | "environment" | "verifyMcpServer" | "mcpVerifyTimeoutMs" | "maxSkillFiles" | "maxSkillBytes"
>> & Pick<PiboRuntimeResourceServiceOptions, "mcpConfigPath">;

export type CreatePiboRuntimeResourceSessionInput = {
	piboSessionId: string;
	piboRoomId?: string;
	runtimeInstanceId: string;
	adapterId: string;
	sessionGeneration: string;
	profile: InitialSessionContext;
	cwd: string;
	timezone?: string;
	capabilities: AgentRuntimeCapabilities;
	/** Strict runtime start rejects failed or unsupported selected resources. Inspection uses false. */
	strict?: boolean;
	/** Defaults to true. Set false only for an explicit non-connecting inspection. */
	verifyMcp?: boolean;
};

export class PiboRuntimeResourceError extends Error {
	constructor(
		message: string,
		readonly diagnostics: readonly AgentRuntimeResourceDiagnostic[],
	) {
		super(message);
		this.name = "PiboRuntimeResourceError";
	}
}

type PreparedMcpServer = {
	name: string;
	contributionId: string;
	transport: "stdio" | "http";
	scoped?: ScopedPiboMcpServerConfig;
	inspection: AgentRuntimeExternalMcpServerInspection;
	error?: string;
};

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
	return resolved;
}

function normalizeIdentifier(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "resource";
}

function resolveProfilePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

function deliveryMode(delivery: AgentRuntimeCapabilityDelivery): string {
	if (delivery.support === "mcp") return `mcp:${delivery.transports.join(",")}`;
	if (delivery.support === "materialized") return `materialized:${delivery.modes.join(",")}`;
	if (delivery.support === "degraded") return `degraded:${delivery.mode}`;
	return delivery.support;
}

function deliveryFor(input: {
	contributionId: string;
	delivery: AgentRuntimeCapabilityDelivery;
	target?: string;
	failure?: string;
	fidelity?: AgentRuntimeDeliveryReport["fidelity"];
	modeOverride?: string;
}): AgentRuntimeDeliveryReport {
	if (input.failure) {
		return {
			contributionId: input.contributionId,
			status: "failed",
			mode: input.modeOverride ?? deliveryMode(input.delivery),
			fidelity: "none",
			diagnostic: input.failure,
		};
	}
	if (input.delivery.support === "unsupported") {
		return {
			contributionId: input.contributionId,
			status: "unsupported",
			mode: "unsupported",
			fidelity: "none",
			diagnostic: input.delivery.reason,
		};
	}
	if (input.delivery.support === "degraded") {
		return {
			contributionId: input.contributionId,
			status: "degraded",
			mode: input.modeOverride ?? input.delivery.mode,
			fidelity: input.fidelity ?? "lossy",
			...(input.target ? { target: input.target } : {}),
			diagnostic: input.delivery.reason,
		};
	}
	return {
		contributionId: input.contributionId,
		status: "delivered",
		mode: input.modeOverride ?? deliveryMode(input.delivery),
		fidelity: input.fidelity ?? "exact",
		...(input.target ? { target: input.target } : {}),
	};
}

function sessionContextContribution(input: CreatePiboRuntimeResourceSessionInput): AgentRuntimeContextContribution {
	const piboRoomId = input.piboRoomId?.trim() || "unknown";
	const timezone = input.timezone?.trim() || DEFAULT_USER_TIMEZONE;
	return {
		id: "context:pibo-session",
		kind: "product",
		source: "pibo-product",
		intent: "session",
		label: "Pibo Runtime Context",
		required: false,
		order: 100,
		path: "pibo://runtime/session-context.md",
		content: [
			"# Pibo Runtime Context",
			"",
			`- App context: ${PIBO_APP_CONTEXT.id}`,
			`- Pibo Session ID: ${input.piboSessionId}`,
			`- Pibo Room ID: ${piboRoomId}`,
			`- User timezone: ${timezone}`,
			"",
			"Login identity gates app access only. Use the Pibo Session ID or Room ID when scheduling jobs, correlating events, or referring to the current session or room.",
		].join("\n"),
	};
}

function contextSource(file: InitialSessionContext["contextFiles"][number]): AgentRuntimeContextContribution["source"] {
	if (file.source === "managed") return "managed";
	if (file.source === "plugin") return "plugin";
	return "profile";
}

class RuntimeResourceSession implements PiboRuntimeResourceSession {
	readonly piboSessionId: string;
	readonly runtimeInstanceId: string;
	readonly adapterId: string;
	readonly sessionGeneration: string;
	private context: AgentRuntimeContextContribution[] = [];
	private skills: AgentRuntimeSkillResource[] = [];
	private mcpServers: PreparedMcpServer[] = [];
	private delivery: AgentRuntimeDeliveryReport[] = [];
	private diagnostics: AgentRuntimeResourceDiagnostic[] = [];
	private requiredContributionIds = new Set<string>();
	private paths?: AgentRuntimeResourcePaths;
	private adapterEnvironment: NodeJS.ProcessEnv = {};
	private resolvedMcpConfigs: Record<string, ServerConfig> = {};
	private disposed = false;

	constructor(
		private readonly input: CreatePiboRuntimeResourceSessionInput,
		private readonly options: ResolvedPiboRuntimeResourceServiceOptions,
		private readonly onDispose: () => void,
	) {
		this.piboSessionId = input.piboSessionId;
		this.runtimeInstanceId = input.runtimeInstanceId;
		this.adapterId = input.adapterId;
		this.sessionGeneration = input.sessionGeneration;
	}

	async prepare(): Promise<void> {
		await this.prepareMcpServers();
		await this.prepareContext();
		await this.prepareSkills();
		try {
			await this.materialize();
		} catch (error) {
			const message = `Runtime generation directory could not be materialized: ${redactResourceError(error)}`;
			const contributionIds = [
				...(this.input.capabilities.skills.support === "materialized" ? this.skills.map((skill) => skill.contributionId) : []),
				...(this.input.capabilities.context.support === "materialized" ? this.context.filter((item) => item.content !== undefined).map((item) => item.id) : []),
				...this.mcpServers.filter((server) => server.scoped).map((server) => server.contributionId),
			];
			for (const contributionId of contributionIds) {
				if (this.diagnostics.some((diagnostic) => diagnostic.contributionId === contributionId && diagnostic.severity === "error")) continue;
				this.diagnostics.push({ severity: "error", code: "runtime_resource_materialization_failed", message, contributionId });
			}
		}
		await this.verifyMcpServers();
		this.buildDeliveryReports();
		const blocking = this.delivery.filter((report) =>
			this.requiredContributionIds.has(report.contributionId)
			&& (report.status === "failed" || report.status === "unsupported"),
		);
		if (this.input.strict !== false && blocking.length > 0) {
			throw new PiboRuntimeResourceError(
				`Runtime resource preparation failed: ${blocking.map((report) => report.diagnostic ?? report.contributionId).join("; ")}`,
				this.diagnostics,
			);
		}
	}

	getContextContributions(): readonly AgentRuntimeContextContribution[] {
		this.assertActive();
		return this.context.map((contribution) => ({ ...contribution }));
	}

	getSkillPaths(mode: "source" | "materialized" = "source"): readonly string[] {
		this.assertActive();
		return this.skills.flatMap((skill) => {
			const path = mode === "materialized" ? skill.materializedPath : skill.sourcePath;
			return path ? [path] : [];
		});
	}

	getMcpConfigPath(): string | undefined {
		this.assertActive();
		return this.paths && Object.keys(this.resolvedMcpConfigs).length > 0
			? join(this.paths.config, MCP_CONFIG_FILE)
			: undefined;
	}

	getAdapterEnvironment(): Readonly<NodeJS.ProcessEnv> {
		this.assertActive();
		return { ...this.adapterEnvironment };
	}

	getExternalMcpServerConfigs(): Readonly<Record<string, ServerConfig>> {
		this.assertActive();
		return structuredClone(this.resolvedMcpConfigs);
	}

	getInspection(): AgentRuntimeResourceInspection {
		this.assertActive();
		return {
			piboSessionId: this.piboSessionId,
			runtimeInstanceId: this.runtimeInstanceId,
			adapterId: this.adapterId,
			sessionGeneration: this.sessionGeneration,
			...(this.paths ? { paths: { ...this.paths } } : {}),
			skills: this.skills.map((skill) => ({ ...skill })),
			context: this.context.map(({ content: _content, ...contribution }) => ({ ...contribution })),
			mcpServers: this.mcpServers.map((server) => structuredClone(server.inspection)),
			delivery: this.delivery.map((report) => ({ ...report })),
			diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		};
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.adapterEnvironment = {};
		this.resolvedMcpConfigs = {};
		try {
			if (this.paths) await rm(this.paths.root, { recursive: true, force: true });
		} finally {
			this.onDispose();
		}
	}

	private async prepareMcpServers(): Promise<void> {
		const selected = [...new Set(this.input.profile.mcpServers.map((name) => name.trim()).filter(Boolean))];
		for (const name of selected) this.requiredContributionIds.add(`mcp:${name}`);
		if (selected.length === 0) return;
		let config: McpServersConfig;
		try {
			config = await loadConfigUnresolved(this.options.mcpConfigPath);
		} catch (error) {
			const message = redactResourceError(error);
			for (const name of selected) this.addFailedMcp(name, message);
			return;
		}
		for (const name of selected) {
			const serverConfig = config.mcpServers[name];
			if (!serverConfig) {
				this.addFailedMcp(name, `Selected MCP server "${name}" is not present in the merged MCP configuration.`);
				continue;
			}
			try {
				const scoped = scopePiboMcpServerConfig(name, serverConfig, this.options.environment);
				this.mcpServers.push({
					name,
					contributionId: `mcp:${name}`,
					transport: isHttpServer(serverConfig) ? "http" : "stdio",
					scoped,
					inspection: {
						contributionId: `mcp:${name}`,
						name,
						transport: isHttpServer(serverConfig) ? "http" : "stdio",
						status: "configured",
						tools: [],
						resources: [],
						resourceTemplates: [],
						secretEnvironmentKeys: scoped.secretEnvironmentKeys,
					},
				});
			} catch (error) {
				this.addFailedMcp(name, redactResourceError(error));
			}
		}
		const mcpContext = getMcpAgentContextFileFromConfig(selected, {
			mcpServers: Object.fromEntries(
				selected.flatMap((name) => config.mcpServers[name] ? [[name, config.mcpServers[name]] as const] : []),
			),
		});
		if (mcpContext) {
			this.context.push({
				id: "context:enabled-mcp-servers",
				kind: "generated",
				source: "generated",
				intent: "developer",
				label: "Enabled MCP Servers",
				required: false,
				order: 400,
				path: mcpContext.path,
				content: mcpContext.content,
			});
		}
	}

	private addFailedMcp(name: string, message: string): void {
		const contributionId = `mcp:${name}`;
		this.mcpServers.push({
			name,
			contributionId,
			transport: "stdio",
			error: message,
			inspection: {
				contributionId,
				name,
				transport: "stdio",
				status: "failed",
				tools: [],
				resources: [],
				resourceTemplates: [],
				secretEnvironmentKeys: [],
				diagnostic: message,
			},
		});
		this.diagnostics.push({ severity: "error", code: "runtime_mcp_configuration_failed", message, contributionId });
	}

	private async prepareContext(): Promise<void> {
		if (this.input.profile.autoContextFiles) {
			this.requiredContributionIds.add("context:automatic-project-files");
			this.context.push({
				id: "context:automatic-project-files",
				kind: "automatic",
				source: "profile",
				intent: "project",
				label: "Automatic AGENTS.md / CLAUDE.md discovery",
				required: false,
				order: 0,
			});
		}
		this.context.push(sessionContextContribution(this.input));
		for (const [index, file] of this.input.profile.contextFiles.entries()) {
			if (file.enabled === false) continue;
			const id = `context:${file.key ?? file.path}`;
			this.requiredContributionIds.add(id);
			const sourcePath = resolveProfilePath(this.input.cwd, file.path);
			try {
				const content = await readFile(sourcePath, "utf8");
				this.context.push({
					id,
					kind: "context-file",
					source: contextSource(file),
					intent: file.scope === "agent" ? "developer" : "project",
					label: file.label ?? file.key ?? basename(file.path),
					required: true,
					order: 200 + index,
					path: sourcePath,
					sourcePath,
					content,
				});
			} catch (error) {
				const message = `Context file "${file.key ?? file.path}" could not be loaded: ${redactResourceError(error)}`;
				this.context.push({
					id,
					kind: "context-file",
					source: contextSource(file),
					intent: file.scope === "agent" ? "developer" : "project",
					label: file.label ?? file.key ?? basename(file.path),
					required: true,
					order: 200 + index,
					path: sourcePath,
					sourcePath,
				});
				this.diagnostics.push({ severity: "error", code: "runtime_context_file_failed", message, contributionId: id });
			}
		}
		const installedTools = getInstalledCliToolContextFile();
		if (installedTools) {
			this.context.push({
				id: "context:installed-pibo-tools",
				kind: "generated",
				source: "generated",
				intent: "developer",
				label: "Installed Pibo Tools",
				required: false,
				order: 300,
				path: installedTools.path,
				content: installedTools.content,
			});
		}
		for (const contribution of this.context) {
			if (contribution.content !== undefined) contribution.byteSize = Buffer.byteLength(contribution.content, "utf8");
		}
		this.context.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
	}

	private async prepareSkills(): Promise<void> {
		for (const skill of this.input.profile.skills) {
			if (skill.enabled === false) continue;
			const contributionId = `skill:${skill.name}`;
			this.requiredContributionIds.add(contributionId);
			const sourcePath = resolveProfilePath(this.input.cwd, skill.path);
			const resource: AgentRuntimeSkillResource = {
				contributionId,
				name: skill.name,
				kind: skill.kind ?? "plugin",
				required: true,
				sourcePath,
			};
			this.skills.push(resource);
			try {
				const metadata = await stat(sourcePath);
				if (!metadata.isFile()) throw new Error("skill path is not a file");
			} catch (error) {
				const message = `Skill "${skill.name}" could not be loaded: ${redactResourceError(error)}`;
				this.diagnostics.push({ severity: "error", code: "runtime_skill_failed", message, contributionId });
			}
		}
	}

	private async materialize(): Promise<void> {
		const materializeSkills = this.input.capabilities.skills.support === "materialized" && this.skills.length > 0;
		const materializeContext = this.input.capabilities.context.support === "materialized" && this.context.some((item) => item.content !== undefined);
		const materializeMcp = this.mcpServers.some((server) => server.scoped !== undefined);
		if (!materializeSkills && !materializeContext && !materializeMcp) return;
		this.paths = await createAgentRuntimeResourcePaths(this.options.rootDir, this.input);

		if (materializeSkills) {
			for (const skill of this.skills) {
				if (this.diagnostics.some((diagnostic) => diagnostic.contributionId === skill.contributionId && diagnostic.severity === "error")) continue;
				try {
					skill.materializedPath = await copyAgentRuntimeSkillDirectory(skill, this.paths.skills, {
						maxFiles: this.options.maxSkillFiles,
						maxBytes: this.options.maxSkillBytes,
					});
				} catch (error) {
					const message = `Skill "${skill.name}" could not be materialized: ${redactResourceError(error)}`;
					this.diagnostics.push({ severity: "error", code: "runtime_skill_materialization_failed", message, contributionId: skill.contributionId });
				}
			}
		}

		if (materializeContext) {
			let materializedIndex = 0;
			for (const contribution of this.context) {
				if (contribution.content === undefined) continue;
				const target = join(
					this.paths.context,
					`${String(materializedIndex++).padStart(3, "0")}-${slug(contribution.label)}.md`,
				);
				try {
					await writeFile(target, contribution.content, { encoding: "utf8", mode: 0o600 });
					await chmod(target, 0o600);
					contribution.materializedPath = target;
				} catch (error) {
					const message = `Context contribution "${contribution.label}" could not be materialized: ${redactResourceError(error)}`;
					this.diagnostics.push({ severity: "error", code: "runtime_context_materialization_failed", message, contributionId: contribution.id });
				}
			}
		}

		if (materializeMcp) {
			const materializedConfigs: Record<string, ServerConfig> = {};
			for (const server of this.mcpServers) {
				if (!server.scoped) continue;
				materializedConfigs[server.name] = server.scoped.materialized;
				this.resolvedMcpConfigs[server.name] = server.scoped.resolved;
				Object.assign(this.adapterEnvironment, server.scoped.secretEnvironment);
			}
			const configPath = join(this.paths.config, MCP_CONFIG_FILE);
			await writeFile(configPath, `${JSON.stringify({ mcpServers: materializedConfigs }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
			await chmod(configPath, 0o600);
			this.adapterEnvironment.MCP_CONFIG_PATH = configPath;
			this.adapterEnvironment.MCP_NO_DAEMON = "1";
			this.adapterEnvironment.MCP_STRICT_ENV = "true";
			this.adapterEnvironment.PIBO_MCP_ISOLATED_ENV = "1";
		}
	}

	private async verifyMcpServers(): Promise<void> {
		const shouldVerify = this.input.verifyMcp !== false;
		if (!shouldVerify) return;
		for (const server of this.mcpServers) {
			if (!server.scoped || server.error) continue;
			try {
				const result = await this.options.verifyMcpServer(server.name, server.scoped.resolved, {
					timeoutMs: this.options.mcpVerifyTimeoutMs,
				});
				server.inspection = {
					...server.inspection,
					...result,
					status: "connected",
				};
			} catch (error) {
				const message = redactResourceError(error, Object.values(server.scoped.secretEnvironment));
				server.error = message;
				server.inspection = { ...server.inspection, status: "failed", diagnostic: message };
				this.diagnostics.push({ severity: "error", code: "runtime_mcp_verification_failed", message, contributionId: server.contributionId });
			}
		}
	}

	private buildDeliveryReports(): void {
		for (const skill of this.skills) {
			const failure = this.diagnosticFor(skill.contributionId);
			this.delivery.push(deliveryFor({
				contributionId: skill.contributionId,
				delivery: this.input.capabilities.skills,
				target: this.input.capabilities.skills.support === "materialized" ? skill.materializedPath : skill.sourcePath,
				failure,
			}));
		}
		for (const contribution of this.context) {
			const failure = this.diagnosticFor(contribution.id);
			if (contribution.kind === "automatic" && this.input.capabilities.context.support === "materialized") {
				const supportsNativeDiscovery = this.input.capabilities.context.modes.includes("native-project-discovery");
				this.delivery.push(supportsNativeDiscovery
					? {
						contributionId: contribution.id,
						status: "delivered",
						mode: "native-project-discovery",
						fidelity: "equivalent",
						target: this.input.cwd,
					}
					: {
						contributionId: contribution.id,
						status: "unsupported",
						mode: "unsupported:auto-context-discovery",
						fidelity: "none",
						diagnostic: "This runtime materializes explicit context but does not declare native-project-discovery for automatic AGENTS.md / CLAUDE.md context.",
					});
				continue;
			}
			this.delivery.push(deliveryFor({
				contributionId: contribution.id,
				delivery: this.input.capabilities.context,
				target: this.input.capabilities.context.support === "materialized"
					? contribution.materializedPath
					: contribution.path ?? contribution.sourcePath ?? this.input.cwd,
				failure,
				fidelity: contribution.kind === "automatic" ? "equivalent" : "exact",
				modeOverride: contribution.kind === "automatic" ? "native-discovery" : undefined,
			}));
		}
		for (const server of this.mcpServers) {
			const requiresInspection = this.input.verifyMcp !== false;
			const unverified = requiresInspection && server.inspection.status !== "connected" && !server.error
				? `MCP server "${server.name}" was not verified as connected.`
				: undefined;
			this.delivery.push(deliveryFor({
				contributionId: server.contributionId,
				delivery: this.input.capabilities.mcp.externalServers,
				target: this.getMcpConfigPath(),
				failure: server.error ?? unverified,
				fidelity: "exact",
			}));
		}
	}

	private diagnosticFor(contributionId: string): string | undefined {
		return this.diagnostics.find((diagnostic) => diagnostic.contributionId === contributionId && diagnostic.severity === "error")?.message;
	}

	private assertActive(): void {
		if (this.disposed) throw new Error(`Runtime resources for Pibo session "${this.piboSessionId}" are disposed.`);
	}
}

export class PiboRuntimeResourceService {
	private readonly sessions = new Map<string, RuntimeResourceSession>();
	private readonly options: ResolvedPiboRuntimeResourceServiceOptions;

	constructor(options: PiboRuntimeResourceServiceOptions = {}) {
		this.options = {
			rootDir: options.rootDir ?? piboHomePath("agent-runtimes"),
			mcpConfigPath: options.mcpConfigPath ?? options.environment?.MCP_CONFIG_PATH,
			environment: { ...(options.environment ?? process.env) },
			verifyMcpServer: options.verifyMcpServer ?? verifyPiboMcpServer,
			mcpVerifyTimeoutMs: positiveInteger(options.mcpVerifyTimeoutMs, DEFAULT_MCP_VERIFY_TIMEOUT_MS, "mcpVerifyTimeoutMs"),
			maxSkillFiles: positiveInteger(options.maxSkillFiles, DEFAULT_MAX_SKILL_FILES, "maxSkillFiles"),
			maxSkillBytes: positiveInteger(options.maxSkillBytes, DEFAULT_MAX_SKILL_BYTES, "maxSkillBytes"),
		};
	}

	async createSession(input: CreatePiboRuntimeResourceSessionInput): Promise<PiboRuntimeResourceSession> {
		const normalized: CreatePiboRuntimeResourceSessionInput = {
			...input,
			piboSessionId: normalizeIdentifier(input.piboSessionId, "piboSessionId"),
			runtimeInstanceId: normalizeIdentifier(input.runtimeInstanceId, "runtimeInstanceId"),
			adapterId: normalizeIdentifier(input.adapterId, "adapterId"),
			sessionGeneration: normalizeIdentifier(input.sessionGeneration, "sessionGeneration"),
			cwd: normalizeIdentifier(input.cwd, "cwd"),
		};
		const key = `${normalized.piboSessionId}\0${normalized.sessionGeneration}`;
		if (this.sessions.has(key)) throw new Error(`Runtime resource session already exists for generation "${normalized.sessionGeneration}".`);
		const session = new RuntimeResourceSession(normalized, this.options, () => {
			if (this.sessions.get(key) === session) this.sessions.delete(key);
		});
		try {
			await session.prepare();
			this.sessions.set(key, session);
			return session;
		} catch (error) {
			await session.dispose().catch(() => {});
			throw error;
		}
	}

	async dispose(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((session) => session.dispose()));
	}
}
