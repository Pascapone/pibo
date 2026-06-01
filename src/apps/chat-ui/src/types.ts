import type {
	PiboTraceNode,
	PiboTraceNodeType,
	PiboTraceNodeStatus,
	PiboTraceSource,
	PiboTraceOrderKey,
	PiboWebSessionStatus,
} from "../../../shared/trace-types.js";

export type { PiboTraceNode, PiboTraceNodeType, PiboTraceNodeStatus, PiboTraceSource, PiboTraceOrderKey, PiboWebSessionStatus };

export type PiboWorkflowSessionKind = "main_workflow" | "nested_workflow" | "agent_node" | "subagent";

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	originId?: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
	workflowSessionKind?: PiboWorkflowSessionKind;
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
	workflowSessionKind?: PiboWorkflowSessionKind;
	title: string;
	status: "idle" | "running" | "error";
	lastActivityAt?: string;
};

export type PiboRoom = {
	id: string;
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

export type PiboProject = {
	id: string;
	ownerScope: string;
	name: string;
	description?: string;
	projectFolder: string;
	configurationStatus: "configured";
	currentMainSessionId?: string;
	archivedAt?: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type PiboProjectWorkflowSessionState = "configured" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type PiboProjectLegacySessionState = "simple_chat" | "workflow";
export type PiboProjectSessionState = PiboProjectWorkflowSessionState | PiboProjectLegacySessionState;

export type PiboProjectWorkflowSessionConfiguration = {
	inputValues: Record<string, unknown>;
	promptOverrides: Record<string, string>;
	promptOverrideEligibleNodeIds: string[];
	overrideScopes: {
		promptOverrides: "eligible_agent_node";
		model: "workflow";
		thinkingLevel: "workflow";
		fastMode: "workflow";
	};
	model?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	fastMode?: boolean;
};

export type PiboProjectWorkflowDefinitionLink = {
	status: "live" | "snapshot_only_definition_deleted";
	workflowId: "simple-chat" | "standard-project" | string;
	workflowVersion?: string;
	title?: string;
	definitionHash?: string;
	href?: string;
	tombstoneLabel?: string;
};

export type PiboProjectWorkflowPendingHumanActionRef = {
	id: string;
	kind?: string;
	displayName: string;
	description?: string;
	paramsSchema: Record<string, unknown> | null;
	registered: boolean;
};

export type PiboProjectWorkflowPendingHumanAction = {
	waitTokenId: string;
	workflowRunId: string;
	nodeAttemptId?: string;
	humanNodeId?: string;
	prompt: string;
	schema?: Record<string, unknown>;
	status: "pending";
	payloadRequirements: {
		required: boolean;
		schema?: Record<string, unknown>;
		description: string;
	};
	availableActions: PiboProjectWorkflowPendingHumanActionRef[];
	diagnostics: Array<{
		code: string;
		message: string;
		severity: "info" | "warning" | "error";
		path?: string;
		registryRef?: string;
		hint?: string;
	}>;
	createdAt: string;
	expiresAt?: string;
};

export type PiboProjectSession = {
	projectId: string;
	piboSessionId: string;
	kind: "main" | "sub";
	workflowId: "simple-chat" | "standard-project" | string;
	workflowVersion?: string;
	workflowRunId?: string;
	parentMainSessionId?: string;
	title?: string;
	state?: PiboProjectSessionState;
	configuration?: PiboProjectWorkflowSessionConfiguration;
	workflowDefinitionLink?: PiboProjectWorkflowDefinitionLink;
	pendingHumanActions?: PiboProjectWorkflowPendingHumanAction[];
	retryCount?: number;
	maxRetries?: number;
	archived?: boolean;
	createdAt: string;
	updatedAt: string;
};

export type WorkflowLifecycleEventRecord = {
	id: string;
	type: string;
	ownerScope: string;
	actorId?: string;
	workflowId?: string;
	workflowVersion?: string;
	draftId?: string;
	projectId?: string;
	piboSessionId?: string;
	workflowRunId?: string;
	status?: string;
	validation?: {
		trigger: string;
		checkedAt: string;
		ok: boolean;
		validationState: "valid" | "warning" | "error";
		errorCount: number;
		warningCount: number;
		infoCount: number;
		blocksPublish: boolean;
		blocksRun: boolean;
	};
	diagnostics: Array<{
		code: string;
		message: string;
		severity: "info" | "warning" | "error";
		path?: string;
		nodeId?: string;
		edgeId?: string;
		registryRef?: string;
		hint?: string;
	}>;
	payload?: Record<string, unknown>;
	createdAt: string;
};

export type PiboSession = {
	id: string;
	piSessionId: string;
	channel: string;
	kind: string;
	profile: string;
	parentId?: string;
	originId?: string;
	workspace?: string;
	title?: string;
	metadata?: Record<string, unknown>;
	activeModel?: ModelProfile;
	createdAt: string;
	updatedAt: string;
};

export type { PiboSessionTraceSummary, PiboSessionTraceView } from "../../../shared/trace-types.js";

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

export type ChatSessionPage = {
	roomId: string;
	archived: boolean;
	sessions: PiboWebSessionNode[];
	nextCursor?: string;
	totalCount?: number;
	version?: string;
};

export type PiboRuntimeStatus = {
	piboSessionId: string;
	thinkingLevel?: ThinkingLevel;
	fastMode?: boolean;
};

export type NavigationData = {
	identity: { userId: string; email?: string; name?: string };
	session: PiboSession;
	runtimeStatus?: PiboRuntimeStatus;
	room?: PiboRoom;
	selectedRoomId: string;
	selectedPiboSessionId: string;
	latestRoomStreamId?: number;
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

export type ProjectsBootstrapData = {
	identity: { userId: string; email?: string; name?: string };
	sharedDefaultProject: PiboProject;
	project?: PiboProject;
	projects: PiboProject[];
	projectSessions: PiboProjectSession[];
	workflowLifecycleEvents: WorkflowLifecycleEventRecord[];
	session?: PiboSession;
	selectedProjectId: string;
	selectedPiboSessionId?: string;
	sessions: PiboWebSessionNode[];
	agents: AgentProfile[];
	customAgents: CustomAgent[];
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	agentCatalog?: AgentCatalog;
	capabilities: { actions: Array<{ name: string; description?: string; slashCommands: string[] }> };
};


export type PiboCronTarget =
	| { kind: "room"; roomId: string }
	| { kind: "personal"; principalId?: string };

export type PiboCronSchedule =
	| { kind: "at"; at: string }
	| { kind: "every"; everyMs: number; anchorMs?: number }
	| { kind: "cron"; expr: string; tz?: string };

export type PiboCronScheduleUi =
	| { preset: "in"; amount: number; unit: "minutes" | "hours" | "days" }
	| { preset: "at"; localDateTime: string; tz?: string }
	| { preset: "every"; amount: number; unit: "minutes" | "hours" | "days" }
	| { preset: "daily"; time: string; tz?: string }
	| { preset: "weekly"; weekdays: number[]; time: string; tz?: string }
	| { preset: "monthly"; dayOfMonth: number; time: string; tz?: string }
	| { preset: "advanced"; expr: string; tz?: string };

export type PiboCronJob = {
	id: string;
	ownerScope?: string;
	name: string;
	description?: string;
	enabled: boolean;
	target: PiboCronTarget;
	profile: string;
	prompt: string;
	schedule: PiboCronSchedule;
	scheduleUi?: PiboCronScheduleUi;
	deleteAfterRun?: boolean;
	state: {
		nextRunAt?: string;
		runningAt?: string;
		lastRunAt?: string;
		lastStatus?: "ok" | "error" | "skipped";
		lastError?: string;
		lastRunId?: string;
		lastPiboSessionId?: string;
		consecutiveErrors?: number;
	};
	createdAt: string;
	updatedAt: string;
};

export type PiboCronRun = {
	id: string;
	jobId: string;
	ownerScope?: string;
	piboSessionId?: string;
	status: "queued" | "running" | "ok" | "error" | "skipped";
	reason?: string;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type PiboCronStatus = {
	enabled: boolean;
	jobs: number;
	running: number;
	nextRunAt?: string;
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
	mainThinking?: ThinkingLevel;
	subagentThinking?: ThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
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
	mainThinkingLevel?: ThinkingLevel;
	subagentThinkingLevel?: ThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
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
	mainThinkingLevel?: ThinkingLevel;
	subagentThinkingLevel?: ThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
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

export type PiboRalphTarget =
	| { kind: "room"; roomId: string }
	| { kind: "personal"; principalId?: string };
export type PiboRalphStopConditionInstance = { id: string; type: string; enabled?: boolean; options?: Record<string, unknown>; failClosed?: boolean; timeoutMs?: number };
export type PiboRalphStopPolicy = { mode: "any" | "all"; conditions: PiboRalphStopConditionInstance[] };
export type PiboRalphStopConditionInfo = { type: string; name: string; description?: string; phases: Array<"before-run" | "after-run">; optionsSchema?: Record<string, unknown>; defaultOptions?: Record<string, unknown>; pluginId?: string; pluginName?: string };
export type PiboRalphStopEvaluationSummary = { id: string; phase: "before-run" | "after-run"; at: string; mode: "any" | "all"; finalAction: "continue" | "stop-after-run" | "cancel-current-run"; reason?: string; decisions: Array<{ id: string; type: string; phase: "before-run" | "after-run"; action: "continue" | "stop-after-run" | "cancel-current-run"; reason?: string; details?: Record<string, unknown>; skipped?: boolean; error?: string }> };
export type PiboRalphJob = { id: string; ownerScope?: string; name: string; description?: string; enabled: boolean; target: PiboRalphTarget; profile: string; prompt: string; maxIterations?: number; stopPolicy?: PiboRalphStopPolicy; modelOverride?: ModelProfile; thinkingLevel?: ThinkingLevel; fastMode?: boolean; state: { runningAt?: string; lastRunAt?: string; lastStatus?: "ok" | "error" | "cancelled"; lastError?: string; lastRunId?: string; lastPiboSessionId?: string; consecutiveErrors?: number; stopRequestedAt?: string; cancelRequestedAt?: string; completedIterations?: number; conditionStates?: Record<string, Record<string, unknown>>; lastStopEvaluation?: PiboRalphStopEvaluationSummary }; createdAt: string; updatedAt: string };
export type PiboRalphRun = { id: string; jobId: string; ownerScope?: string; piboSessionId?: string; status: "running" | "ok" | "error" | "cancelled"; reason?: string; error?: string; startedAt?: string; completedAt?: string; createdAt: string; updatedAt: string };
export type PiboRalphStatus = { enabled: boolean; jobs: number; running: number };
export type PiboRalphJobTemplate = { id: string; name: string; description: string; category: "prd" | "general"; job: { name: string; description?: string; prompt: string; maxIterations?: number; stopPolicy?: PiboRalphStopPolicy } };
