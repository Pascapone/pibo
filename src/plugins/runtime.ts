import type { PluginHookDescriptor, PluginHookResult } from "./contributions.js";
import type { PluginJsonObject, PluginJsonValue, PluginQualifiedId } from "./manifest.js";
import type { PiboToolDefinition, PiboToolDefinitionContext } from "../tools/contract.js";

/** Public session services supplied by the core without naming plugin implementations. */
export const PIBO_SESSION_CONTEXT_SERVICE = "pibo.session.context";
export const PIBO_SESSION_RUN_CONTROL_SERVICE = "pibo.session.run-control";
export const PIBO_SESSION_DELEGATION_SERVICE = "pibo.session.delegation";
export const PIBO_SESSION_CODE_RUNTIME_SERVICE = "pibo.session.code-runtime";

export type PluginSessionServiceAccessor = {
	get<T = unknown>(id: string): T | undefined;
	require<T = unknown>(id: string): T;
};

/** Immutable generation-pinned context passed to a selected session tool provider. */
export type PluginSessionToolProviderContext = PiboToolDefinitionContext & {
	piboSessionId: string;
	runtimeInstanceId: string;
	adapterId: string;
	sessionGeneration: string;
	cwd: string;
	plugin: {
		id: string;
		contributionId: PluginQualifiedId;
		revision: string;
		configuration: Readonly<PluginJsonObject>;
		contributionConfiguration: Readonly<PluginJsonObject>;
	};
	/** Exact tool contributions selected and validated for this runtime generation. */
	selectedTools: readonly {
		contributionId: PluginQualifiedId;
		name: string;
		configuration: Readonly<PluginJsonObject>;
		contributionConfiguration: Readonly<PluginJsonObject>;
	}[];
	services: PluginSessionServiceAccessor;
};

export type PluginSessionToolRegistration = {
	/** Must name one selected tool contribution declared against this provider. */
	contributionId: PluginQualifiedId;
	definition: PiboToolDefinition;
};

export type PluginSessionToolSet = {
	tools: readonly PluginSessionToolRegistration[];
	/** Generation cleanup is awaited and failures remain visible to draining/rollback. */
	dispose?(): void | Promise<void>;
};

/** One provider may materialize many tools, but every tool remains an independently selected contribution. */
export type PluginSessionToolProvider = {
	createSession(context: PluginSessionToolProviderContext): PluginSessionToolSet;
};

export function definePluginSessionToolProvider(provider: PluginSessionToolProvider): PluginSessionToolProvider {
	return provider;
}

/** Host-resolved provider identity retained across the generation boundary. */
export type PluginSessionToolProviderBinding = {
	pluginId: string;
	pluginRevision: string;
	providerContributionId: PluginQualifiedId;
	configuration: Readonly<PluginJsonObject>;
	contributionConfiguration: Readonly<PluginJsonObject>;
	selectedTools: readonly {
		contributionId: PluginQualifiedId;
		name: string;
		configuration: Readonly<PluginJsonObject>;
		contributionConfiguration: Readonly<PluginJsonObject>;
	}[];
	provider: PluginSessionToolProvider;
};

/** Public runtime hook contract. Hook execution and evidence persistence remain core-owned. */
export type PluginRuntimeHook = {
	descriptor: PluginHookDescriptor;
	run(value: PluginJsonValue, context: {
		piboSessionId: string;
		generation: string;
		toolName?: string;
		toolCallId?: string;
		signal: AbortSignal;
	}): Promise<PluginHookResult> | PluginHookResult;
};

export type PluginHookEvidence = {
	id: string;
	hookId: string;
	phase: PluginHookDescriptor["phase"];
	order: number;
	status: "continued" | "transformed" | "rejected" | "failed";
	generation: string;
	piboSessionId: string;
	executed?: boolean;
	diagnostic?: string;
	provenance?: Extract<PluginHookResult, { action: "transform" }>["provenance"];
};

export type PluginHookScope = {
	piboSessionId: string;
	generation: string;
	toolName?: string;
	toolCallId?: string;
	signal?: AbortSignal;
	record: (evidence: PluginHookEvidence) => void;
};

export type {
	PiboToolAnnotations,
	PiboToolContent,
	PiboToolDefinition,
	PiboToolDefinitionContext,
	PiboToolExecutionContext,
	PiboToolImageContent,
	PiboToolInputSchema,
	PiboToolProgress,
	PiboToolResult,
	PiboToolTextContent,
	PiboToolUpdateCallback,
} from "../tools/contract.js";
export { definePiboTool, piboToolTerminalStatus, piboToolTimeoutPhase } from "../tools/contract.js";
