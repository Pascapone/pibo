import type {
	PiboTraceNode,
	PiboTraceNodeType,
	PiboTraceNodeStatus,
	PiboTraceSource,
	PiboTraceOrderKey,
	PiboWebSessionStatus,
} from "../../../shared/trace-types.js";

export type { PiboTraceNode, PiboTraceNodeType, PiboTraceNodeStatus, PiboTraceSource, PiboTraceOrderKey, PiboWebSessionStatus };

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	originId?: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
	title: string;
	subtitle?: string;
	archived?: boolean;
	status: "idle" | "running" | "error";
	lastActivityAt?: string;
	unreadCount?: number;
	derivedSessions: PiboWebDerivedSessionNode[];
	children: PiboWebSessionNode[];
};

export type PiboWebDerivedSessionNode = {
	piboSessionId: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
	title: string;
	status: "idle" | "running" | "error";
	lastActivityAt?: string;
};

export type PiboRoom = {
	id: string;
	ownerScope: string;
	name: string;
	topic?: string;
	workspace?: string;
	type: "space" | "chat" | "agent";
	parentRoomId?: string;
	createdAt: string;
	updatedAt: string;
	retentionPolicyId?: string;
	metadata: Record<string, unknown>;
	unreadCount?: number;
	children?: PiboRoom[];
};

export type PiboSession = {
	id: string;
	piSessionId: string;
	channel: string;
	kind: string;
	profile: string;
	ownerScope?: string;
	parentId?: string;
	originId?: string;
	workspace?: string;
	title?: string;
	metadata?: Record<string, unknown>;
	activeModel?: ModelProfile;
	createdAt: string;
	updatedAt: string;
};

export type { PiboSessionTraceView } from "../../../shared/trace-types.js";

export type PiboSignalStatus = string;

export type PiboSignalError = {
	message: string;
	code?: string;
	source?: string;
	retryable?: boolean;
};

export type PiboSignalNode = {
	id: string;
	kind: string;
	status: PiboSignalStatus;
	rootPiboSessionId: string;
	piboSessionId?: string;
	parentNodeId?: string;
	parentPiboSessionId?: string;
	childPiboSessionId?: string;
	createdAt: string;
	startedAt?: string;
	updatedAt: string;
	completedAt?: string;
	error?: PiboSignalError;
	metadata?: Record<string, unknown>;
};

export type PiboSessionSignalSnapshot = {
	piboSessionId: string;
	piSessionId?: string;
	parentPiboSessionId?: string;
	rootPiboSessionId: string;
	version: number;
	updatedAt: string;
	localStatus: PiboSignalStatus;
	aggregateStatus: PiboSignalStatus;
	phase?: string;
	queuedMessages: number;
	currentMessageId?: string;
	currentTurnId?: string;
	isLocalActive: boolean;
	hasActiveDescendant: boolean;
	isTreeActive: boolean;
	isSettled: boolean;
	hasError: boolean;
	hasErrorDescendant: boolean;
	hasBlockedDescendant: boolean;
	activeToolCalls: Array<Record<string, unknown>>;
	activeRuns: Array<Record<string, unknown>>;
	activeChildren: Array<Record<string, unknown>>;
	errors: PiboSignalError[];
};

export type PiboSignalSnapshot = {
	rootPiboSessionId: string;
	version: number;
	generatedAt: string;
	sessions: Record<string, PiboSessionSignalSnapshot>;
	nodes: Record<string, PiboSignalNode>;
};

export type PiboSignalPatch = {
	type?: "signal_patch";
	rootPiboSessionId: string;
	fromVersion: number;
	toVersion: number;
	generatedAt: string;
	upserts: PiboSignalNode[];
	removes: string[];
	sessionSnapshots: PiboSessionSignalSnapshot[];
};

export type NavigationData = {
	identity: { userId: string; email?: string; name?: string };
	session: PiboSession;
	room?: PiboRoom;
	selectedRoomId: string;
	selectedPiboSessionId: string;
	rooms: PiboRoom[];
	sessions: PiboWebSessionNode[];
};

export type BootstrapData = NavigationData & {
	agents: AgentProfile[];
	customAgents: CustomAgent[];
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	agentCatalog?: AgentCatalog;
	capabilities: { actions: Array<{ name: string; description?: string; slashCommands: string[] }> };
};

export type ModelProfile = {
	provider: string;
	id: string;
};

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type ModelDefaults = {
	main?: ModelProfile;
	subagent?: ModelProfile;
	thinking?: ThinkingLevel;
};

export type ModelCatalog = {
	providers: ProviderCatalogEntry[];
};

export type ProviderCatalogEntry = {
	id: string;
	label: string;
	authConfigured: boolean;
	models: ModelCatalogEntry[];
};

export type ModelCatalogEntry = {
	provider: string;
	id: string;
	label: string;
	authConfigured?: boolean;
	supportsReasoning?: boolean;
};

export type AgentProfile = {
	name: string;
	description?: string;
	aliases: string[];
	nativeTools?: string[];
	skills?: string[];
	contextFiles?: string[];
	subagents?: CustomAgentSubagent[];
	mcpServers?: string[];
	piPackages?: string[];
	model?: ModelProfile;
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	builtinTools?: "default" | "disabled";
	builtinToolNames?: string[];
	autoContextFiles?: boolean;
	runControl?: boolean;
};

export type UserSkill = {
	id: string;
	name: string;
	description: string;
	path: string;
	enabled: boolean;
	source: "user-created" | "skills.sh" | "github";
	sourceUrl?: string;
	createdAt: string;
	updatedAt: string;
};

export type AgentCatalog = {
	nativeTools: Array<{ name: string; description?: string; yieldable: boolean; hasDefinition: boolean; pluginId?: string; pluginName?: string }>;
	skills: Array<{ name: string; path: string; kind: "builtin" | "plugin" | "user"; pluginId?: string; pluginName?: string }>;
	subagents: Array<{
		name: string;
		description?: string;
		targetProfile: string;
		timeoutMs?: number;
		maxDepth?: number;
	}>;
	contextFiles: Array<{
		key: string;
		label?: string;
		path: string;
		scope?: "global" | "agent";
		source?: "plugin" | "managed";
		pluginId?: string;
		pluginName?: string;
		agentProfileName?: string;
	}>;
	packages: Array<{ name: string; description: string; toolNames: string[] }>;
	piboTools: Array<{ name: string; description: string; snippet: string }>;
	mcpServers: Array<{
		name: string;
		transport: "stdio" | "http";
		description?: string;
		descriptionSource?: "user" | "registry";
		hasDescription: boolean;
		editable: boolean;
	}>;
	piPackages: Array<{
		id: string;
		name: string;
		description?: string;
		source: string;
		installSpec: string;
		version?: string;
		repositoryUrl?: string;
		resourceTypes: Array<"extension" | "skill" | "prompt" | "theme">;
		extensionPaths?: string[];
		skillNames?: string[];
		promptNames?: string[];
		themeNames?: string[];
		discoveredToolNames?: string[];
		installStatus: "registered" | "installed" | "missing" | "error";
		installPath?: string;
		enabled: boolean;
		diagnostics: Array<{ type: "info" | "warning" | "error"; message: string }>;
		addedAt?: string;
		updatedAt?: string;
	}>;
	userSkills: UserSkill[];
};

export type CustomAgentSubagent = {
	name: string;
	description?: string;
	targetProfile: string;
	timeoutMs?: number;
	maxDepth?: number;
};

export type CustomAgent = {
	id: string;
	profileName: string;
	ownerScope: string;
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgentSubagent[];
	mcpServers: string[];
	piPackages: string[];
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	builtinTools: "default" | "disabled";
	builtinToolNames: string[];
	autoContextFiles: boolean;
	runControl: boolean;
	brokenContextFiles?: string[];
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
};

export type CreateSessionData = {
	session: PiboSession;
};

export type SpanType =
	| "agent.run"
	| "tool.call"
	| "tool.result"
	| "model.request"
	| "model.response"
	| "model.reasoning"
	| "agent.delegation"
	| "agent.async"
	| "yielded.run"
	| "user.prompt"
	| "user_input"
	| "execution.command";

export type SpanStatus = "UNSET" | "OK" | "ERROR";

export type Span = {
	id: string;
	parentId?: string;
	name: string;
	spanType: SpanType;
	startTime: number;
	endTime?: number;
	durationUs?: number;
	attributes: Record<string, unknown>;
	status: SpanStatus;
	statusMessage?: string;
	events: Array<{ name: string; timestamp: number; attributes: Record<string, unknown> }>;
	children?: Span[];
	pibo?: {
		entryId?: string;
		linkedPiboSessionId?: string;
		traceNodeType: PiboTraceNodeType;
		traceOrder?: PiboTraceOrderKey;
		stableKey?: string;
		source?: PiboTraceSource;
	};
};

export type Trace = {
	id: string;
	name: string;
	status: SpanStatus;
	spans: Span[];
	startedAt: Date;
	completedAt?: Date;
	totalDurationMs: number;
};
