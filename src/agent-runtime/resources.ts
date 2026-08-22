import type { SkillSourceKind } from "../core/profiles.js";
import type { ServerConfig } from "../mcp/config.js";

export type AgentRuntimeDeliveryReport = {
	contributionId: string;
	status: "delivered" | "degraded" | "unsupported" | "failed";
	mode: string;
	fidelity: "exact" | "equivalent" | "lossy" | "none";
	target?: string;
	diagnostic?: string;
};

export type AgentRuntimeResourceDiagnostic = {
	severity: "info" | "warning" | "error";
	code: string;
	message: string;
	contributionId?: string;
};

export type AgentRuntimeContextContribution = {
	id: string;
	kind: "automatic" | "product" | "context-file" | "generated";
	source: "pibo-product" | "profile" | "plugin" | "managed" | "generated";
	intent: "developer" | "project" | "session" | "user-visible";
	label: string;
	required: boolean;
	order: number;
	/** Original runtime-facing path. Virtual pibo:// paths are preserved. */
	path?: string;
	/** Source file when the contribution originated on disk. */
	sourcePath?: string;
	/** Exact contribution text. Treat it as adapter input, not safe debug output. */
	content?: string;
	byteSize?: number;
	/** True when this exact source is already loaded by known native project discovery. */
	nativeDiscovered?: boolean;
	materializedPath?: string;
};

export type AgentRuntimeSkillResource = {
	contributionId: string;
	name: string;
	kind: SkillSourceKind;
	required: boolean;
	sourcePath: string;
	materializedPath?: string;
};

export type AgentRuntimeMcpToolInfo = {
	name: string;
	description?: string;
};

export type AgentRuntimeMcpResourceInfo = {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
};

export type AgentRuntimeMcpResourceTemplateInfo = {
	uriTemplate: string;
	name?: string;
	description?: string;
	mimeType?: string;
};

export type AgentRuntimeExternalMcpServerInspection = {
	contributionId: string;
	name: string;
	transport: "stdio" | "http";
	status: "configured" | "connected" | "failed";
	serverName?: string;
	serverVersion?: string;
	protocolVersion?: string;
	instructions?: string;
	tools: readonly AgentRuntimeMcpToolInfo[];
	resources: readonly AgentRuntimeMcpResourceInfo[];
	resourceTemplates: readonly AgentRuntimeMcpResourceTemplateInfo[];
	secretEnvironmentKeys: readonly string[];
	diagnostic?: string;
};

export type PiboRuntimeMcpVerificationResult = Omit<
	AgentRuntimeExternalMcpServerInspection,
	"contributionId" | "name" | "transport" | "secretEnvironmentKeys"
>;

export type PiboRuntimeMcpVerifier = (
	serverName: string,
	config: ServerConfig,
	options: { timeoutMs: number },
) => Promise<PiboRuntimeMcpVerificationResult>;

export type AgentRuntimeResourcePaths = {
	root: string;
	home: string;
	skills: string;
	context: string;
	config: string;
	protocol: string;
};

export type AgentRuntimeResourceInspection = {
	piboSessionId: string;
	runtimeInstanceId: string;
	adapterId: string;
	sessionGeneration: string;
	paths?: AgentRuntimeResourcePaths;
	skills: readonly AgentRuntimeSkillResource[];
	context: readonly Omit<AgentRuntimeContextContribution, "content">[];
	mcpServers: readonly AgentRuntimeExternalMcpServerInspection[];
	delivery: readonly AgentRuntimeDeliveryReport[];
	diagnostics: readonly AgentRuntimeResourceDiagnostic[];
};

export interface PiboRuntimeResourceSession {
	readonly piboSessionId: string;
	readonly runtimeInstanceId: string;
	readonly adapterId: string;
	readonly sessionGeneration: string;
	getContextContributions(): readonly AgentRuntimeContextContribution[];
	getSkillPaths(mode?: "source" | "materialized"): readonly string[];
	getMcpConfigPath(): string | undefined;
	/** Sensitive, session-scoped process environment. Never log or persist the values. */
	getAdapterEnvironment(): Readonly<NodeJS.ProcessEnv>;
	/** Sensitive resolved server configs for adapter-owned launch state. Never expose through inspection. */
	getExternalMcpServerConfigs(): Readonly<Record<string, ServerConfig>>;
	/** Replace generic capability-derived reports with adapter-observed delivery evidence. */
	recordAdapterDelivery?(
		reports: readonly AgentRuntimeDeliveryReport[],
		diagnostics?: readonly AgentRuntimeResourceDiagnostic[],
	): void;
	getInspection(): AgentRuntimeResourceInspection;
	dispose(): Promise<void>;
}
