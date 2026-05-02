export type PiboTraceNodeType =
	| "user.message"
	| "assistant.message"
	| "agent.turn"
	| "model.reasoning"
	| "tool.call"
	| "tool.result"
	| "agent.delegation"
	| "agent.async"
	| "execution.command"
	| "yielded.run"
	| "error";

export type PiboTraceNodeStatus = "running" | "done" | "error";

export type PiboTraceSource = "transcript" | "event-log" | "live";

export type PiboTraceOrderKey = {
	sourceRank: number;
	turnSeq: number;
	transcriptIndex?: number;
	contentPartIndex?: number;
	eventSequence?: number;
	streamFrameIndex?: number;
	phaseRank: number;
};

export type PiboTraceNode = {
	id: string;
	parentId?: string;
	entryId?: string;
	piboSessionId: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	type: PiboTraceNodeType;
	title: string;
	status: PiboTraceNodeStatus;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedPiboSessionId?: string;
	source?: PiboTraceSource;
	stableKey?: string;
	orderKey?: PiboTraceOrderKey;
	children: PiboTraceNode[];
};

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	originId?: string;
	profile: string;
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
	createdAt: string;
	updatedAt: string;
};

export type PiboSessionTraceView = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	nodes: PiboTraceNode[];
	rawEvents: Array<{ id: string; type: string; createdAt: string; payload: unknown }>;
};

export type BootstrapData = {
	identity: { userId: string; email?: string; name?: string };
	session: PiboSession;
	room?: PiboRoom;
	selectedRoomId: string;
	selectedPiboSessionId: string;
	rooms: PiboRoom[];
	sessions: PiboWebSessionNode[];
	agents: AgentProfile[];
	customAgents: CustomAgent[];
	agentCatalog?: AgentCatalog;
	capabilities: { actions: Array<{ name: string; description?: string; slashCommands: string[] }> };
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
	builtinTools?: "default" | "disabled";
	autoContextFiles?: boolean;
	runControl?: boolean;
};

export type AgentCatalog = {
	nativeTools: Array<{ name: string; description?: string; yieldable: boolean; hasDefinition: boolean; pluginId?: string; pluginName?: string }>;
	skills: Array<{ name: string; path: string }>;
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
	builtinTools: "default" | "disabled";
	autoContextFiles: boolean;
	runControl: boolean;
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
	| "user_input";

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
