import type { PluginHookDescriptor, PluginHookResult } from "./contributions.js";
import type { PluginJsonObject, PluginJsonValue, PluginQualifiedId } from "./manifest.js";
import type { PiboToolDefinition, PiboToolDefinitionContext } from "../tools/contract.js";
import type {
	PiboRunAckResult,
	PiboRunCompletionPolicy,
	PiboRunReadResult,
	PiboRunSnapshot,
	PiboRunWaitResult,
	PiboToolRunResult,
} from "../runs/registry.js";
import type { PiboRunResourceUsage } from "../runs/resource-isolation.js";
import type { ModelProfile } from "../core/profiles.js";
import type { PiboJsonObject, PiboMessageEvent, PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";

/** Public session services supplied by the core without naming plugin implementations. */
export const PIBO_SESSION_CONTEXT_SERVICE = "pibo.session.context";
export const PIBO_SESSION_YIELDED_RUNS_SERVICE = "pibo.session.yielded-runs";
export const PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE = "pibo.session.child-orchestration";
export const PIBO_SESSION_AGENT_TARGETS_SERVICE = "pibo.session.agent-targets";
export const PIBO_SESSION_GOAL_STORE_SERVICE = "pibo.session.goal-store";
export const PIBO_YIELDED_RUN_REMINDER_MESSAGE_KIND = "yielded-run-reminder";

export type PluginYieldedRunStartInput = {
	toolName: string;
	params: unknown;
	completionPolicy?: PiboRunCompletionPolicy;
	retryable?: boolean;
	maxAttempts?: number;
	timeoutMs?: number;
	serviceWarning?: string;
	resources?: PiboRunResourceUsage;
	execute(runId: string): Promise<PiboToolRunResult>;
	cancel?(): Promise<void>;
};

/** Core-owned generic scheduling primitive; feature packages own concrete run tools and presentation. */
export type PluginYieldedRunControl = {
	startToolRun(input: PluginYieldedRunStartInput): PiboRunSnapshot;
	listRuns(options?: { includeConsumed?: boolean; includeDetached?: boolean }): PiboRunSnapshot[];
	getRunStatus(runId: string): PiboRunSnapshot;
	waitForRun(runId: string, timeoutMs: number): Promise<PiboRunWaitResult>;
	readRun(runId: string): PiboRunReadResult;
	cancelRun(runId: string): Promise<PiboRunSnapshot>;
	ackRun(runId: string): PiboRunAckResult;
};

export type PluginActiveChildRequestSettlement =
	| { status: "fulfilled" }
	| { status: "rejected"; reason: unknown };

export type PluginActiveChildRequest = {
	childPiboSessionId: string;
	requestId: string;
	abortController: AbortController;
	settled: Promise<PluginActiveChildRequestSettlement>;
};

export type PluginChildSessionQuery = {
	parentPiboSessionId: string;
	channel: string;
	kind: string;
};

export type PluginChildSessionState = {
	session: PiboSession;
	liveStatus?: PiboSessionStatus;
};

export type PluginResolveChildSessionInput = PluginChildSessionQuery & {
	profile: string;
	title?: string;
	identityMetadata: PiboJsonObject;
	metadata: PiboJsonObject;
	/** Metadata merged when reusing an existing child; omitted fields remain frozen. */
	reuseMetadata?: PiboJsonObject;
	/** Existing children matching every listed metadata field are not reusable. */
	excludeMetadata?: PiboJsonObject;
	activeModel?: ModelProfile;
};

export type PluginChildOutputRecord = {
	managingParentPiboSessionId: string;
	childSession: PiboSession;
	sequence: number;
	createdAt: string;
	requestId?: string;
	event: PiboOutputEvent;
};

export type PluginChildOutputPage = {
	records: readonly PluginChildOutputRecord[];
	highWaterSequence: number;
	evictedThroughSequence: number;
};

export type PluginChildSessionOrchestration = {
	getDepth(piboSessionId: string): number;
	resolveChildSession(input: PluginResolveChildSessionInput): PiboSession;
	listChildSessions(query: PluginChildSessionQuery): PluginChildSessionState[];
	requireChildSession(query: PluginChildSessionQuery & { childPiboSessionId: string }): PiboSession;
	associateRequest(childPiboSessionId: string, eventId: string, requestId: string): void;
	dissociateRequest(childPiboSessionId: string, eventId: string): void;
	emitOutput(event: PiboOutputEvent): void;
	emitMessageAndWaitForReply(event: PiboMessageEvent, signal: AbortSignal): Promise<Extract<PiboOutputEvent, { type: "assistant_message" }>>;
	trackActive(parentPiboSessionId: string, request: PluginActiveChildRequest): () => void;
	readChildOutputs(parentPiboSessionId: string): PluginChildOutputPage;
	getObservationCursor(parentPiboSessionId: string, scope: string): number | undefined;
	advanceObservationCursor(parentPiboSessionId: string, scope: string, sequence: number): number;
	killChildSession(input: PluginChildSessionQuery & { childPiboSessionId: string; terminalMetadata: PiboJsonObject; reason: string }): Promise<{ childPiboSessionId: string; killed: string[]; cancelledRuns: string[] }>;
};

export type PluginSystemPromptTransformContext = {
	cwd: string;
	shell: string;
	isChildSession: boolean;
};

export type PluginSystemPromptTransformer = {
	transform(baseSystemPrompt: string, context: PluginSystemPromptTransformContext): string;
};

export type PluginSystemPromptTransformerBinding = {
	contributionId: PluginQualifiedId;
	pluginId: string;
	transformer: PluginSystemPromptTransformer;
};

export function definePluginSystemPromptTransformer(transformer: PluginSystemPromptTransformer): PluginSystemPromptTransformer {
	return transformer;
}

export type PluginSessionServiceAccessor = {
	get<T = unknown>(id: string): T | undefined;
	require<T = unknown>(id: string): T;
};

export type PluginSessionAvailableTool = {
	contributionId?: PluginQualifiedId;
	definition: PiboToolDefinition;
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
		direct: boolean;
		yieldable: boolean;
		selectionReason: "required" | "explicit" | "dependency" | "infrastructure";
		dependencyPath: readonly string[];
		configuration: Readonly<PluginJsonObject>;
		contributionConfiguration: Readonly<PluginJsonObject>;
	}[];
	/** Yieldable definitions already materialized by base providers; populated only for augment providers. */
	availableTools: readonly PluginSessionAvailableTool[];
	services: PluginSessionServiceAccessor;
};

export type PluginSessionToolRegistration = {
	/** Must name one selected tool contribution declared against this provider. */
	contributionId: PluginQualifiedId;
	definition: PiboToolDefinition;
};

export type PluginSessionServiceMessageHandler = {
	/** Semantic host capability, not a plugin or concrete tool identifier. */
	kind: string;
	format(payload: unknown, context: { maxDurationMs: number }): string;
	matches(message: { source?: string; text: string }): boolean;
};

export type PluginSessionToolSet = {
	tools: readonly PluginSessionToolRegistration[];
	/** Optional package-owned rendering and recognition for queued service messages. */
	serviceMessages?: readonly PluginSessionServiceMessageHandler[];
	/** Generation cleanup is awaited and failures remain visible to draining/rollback. */
	dispose?(): void | Promise<void>;
};

/** One provider may materialize many tools, but every tool remains an independently selected contribution. */
export type PluginSessionToolProvider = {
	/** Base providers run first. Augment providers may create meta-tools from availableTools. */
	phase?: "base" | "augment";
	/** Requests adapter-native yieldable definitions in the augment catalog without naming them. */
	includeNativeTools?: boolean;
	/** Package-owned service-message handling available before adapter tool materialization. */
	serviceMessages?: readonly PluginSessionServiceMessageHandler[];
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
		direct: boolean;
		yieldable: boolean;
		selectionReason: "required" | "explicit" | "dependency" | "infrastructure";
		dependencyPath: readonly string[];
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
