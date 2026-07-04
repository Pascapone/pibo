import { THINKING_LEVELS, type BootstrapData, type PiboProjectSession, type PiboSessionSignalSnapshot, type PiboSessionTraceView, type PiboTraceNode, type PiboWebSessionNode, type PiboWebSessionStatus, type ThinkingLevel, type WorkflowLifecycleEventRecord } from "./types";
import { findSessionNode, findSessionPath } from "./app-session-model";
import type { ChatSessionViewProps } from "./session-views/types";
import type { SessionBreadcrumbItem, SessionDerivationLink, SessionOriginLink } from "./tracing/TraceTimeline";

export type SessionTraceViewLinks = Pick<ChatSessionViewProps, "sessionBreadcrumbs" | "originSession" | "derivedSessions">;

export function createSessionTraceViewLinks(
	nodes: readonly PiboWebSessionNode[],
	piboSessionId: string | null,
): SessionTraceViewLinks {
	if (!piboSessionId) {
		return {
			sessionBreadcrumbs: [],
			originSession: undefined,
			derivedSessions: [],
		};
	}
	return {
		sessionBreadcrumbs: createSessionBreadcrumbs(nodes, piboSessionId),
		originSession: createOriginSessionLink(nodes, piboSessionId),
		derivedSessions: createDerivedSessionLinks(nodes, piboSessionId),
	};
}

export function resolveSessionTraceModelBadge(input: {
	bootstrap: BootstrapData;
	selectedPiboSessionId: string | null;
	selectedSessionProfile: string;
	selectedSessionActiveModel?: string;
	currentTraceView: PiboSessionTraceView | null;
}): string | undefined {
	const selectedSessionNode = input.selectedPiboSessionId
		? findSessionNode(input.bootstrap.sessions, input.selectedPiboSessionId)
		: undefined;
	const traceThinkingState = resolveTraceThinkingState(input.currentTraceView);
	return formatSessionModelBadge(
		input.selectedSessionActiveModel,
		input.bootstrap.runtimeStatus?.thinkingLevel
			?? traceThinkingState.level
			?? resolveSessionThinkingLevel(input.bootstrap, input.selectedSessionProfile, Boolean(selectedSessionNode?.parentId)),
		input.bootstrap.runtimeStatus?.fastMode
			?? traceThinkingState.fast
			?? resolveSessionFastMode(input.bootstrap, input.selectedSessionProfile, Boolean(selectedSessionNode?.parentId))
			?? false,
	);
}

export function createSessionTraceViewProps(input: {
	currentTraceView: PiboSessionTraceView | null;
	isLoading: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	selectedSessionProfile: string;
	sessionActiveModelBadge?: string;
	selectedSessionStatus?: PiboWebSessionStatus;
	selectedSessionSignal?: PiboSessionSignalSnapshot;
	workflowProjectSession?: PiboProjectSession;
	workflowLifecycleEvents?: readonly WorkflowLifecycleEventRecord[];
	sessionNodes: readonly PiboWebSessionNode[];
	sessionLinks: SessionTraceViewLinks;
	agentProfiles: ChatSessionViewProps["agentProfiles"];
	sessionProfileChangeDisabled: boolean;
	onSessionAgentProfileChange: ChatSessionViewProps["onSessionAgentProfileChange"];
	onFork: ChatSessionViewProps["onFork"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
	onLoadOlderTracePage: ChatSessionViewProps["onLoadOlderTracePage"];
	hasOlderTraceEvents: boolean;
	isFetchingOlderTracePage: boolean;
	onThinkingLevelChange: ChatSessionViewProps["onThinkingLevelChange"];
	onRefreshTrace: () => Promise<void>;
	onRefreshBootstrap: () => Promise<unknown>;
	onError: ChatSessionViewProps["onError"];
}): ChatSessionViewProps {
	return {
		traceView: input.currentTraceView,
		selectedTrace: null,
		isLoading: input.isLoading,
		showThinking: input.showThinking,
		expandThinking: input.expandThinking,
		sessionAgentProfile: input.selectedSessionProfile,
		sessionActiveModel: input.sessionActiveModelBadge,
		selectedSessionStatus: input.selectedSessionStatus,
		selectedSessionSignal: input.selectedSessionSignal,
		workflowProjectSession: input.workflowProjectSession,
		workflowLifecycleEvents: input.workflowLifecycleEvents,
		sessionNodes: input.sessionNodes,
		sessionBreadcrumbs: input.sessionLinks.sessionBreadcrumbs,
		originSession: input.sessionLinks.originSession,
		derivedSessions: input.sessionLinks.derivedSessions,
		agentProfiles: input.agentProfiles,
		sessionProfileChangeDisabled: input.sessionProfileChangeDisabled,
		onSessionAgentProfileChange: input.onSessionAgentProfileChange,
		onFork: input.onFork,
		onOpenSession: input.onOpenSession,
		onLoadOlderTracePage: input.onLoadOlderTracePage,
		hasOlderTraceEvents: input.hasOlderTraceEvents,
		isFetchingOlderTracePage: input.isFetchingOlderTracePage,
		onThinkingLevelChange: input.onThinkingLevelChange,
		onModelChanged: async () => {
			await input.onRefreshBootstrap();
			await input.onRefreshTrace();
		},
		onRefreshBootstrap: input.onRefreshBootstrap,
		onError: input.onError,
	};
}

function createOriginSessionLink(nodes: readonly PiboWebSessionNode[], piboSessionId: string): SessionOriginLink | undefined {
	const selected = findSessionNode(nodes, piboSessionId);
	if (!selected?.originId) return undefined;
	const origin = findSessionNode(nodes, selected.originId);
	return {
		piboSessionId: selected.originId,
		label: origin ? sessionBreadcrumbLabel(origin, 0) : selected.originId,
	};
}

function createDerivedSessionLinks(nodes: readonly PiboWebSessionNode[], piboSessionId: string): SessionDerivationLink[] {
	const selected = findSessionNode(nodes, piboSessionId);
	return selected?.derivedSessions.map((session) => ({
		piboSessionId: session.piboSessionId,
		label: sessionLabel(session),
		profile: session.profile,
		status: session.status,
	})) ?? [];
}

function createSessionBreadcrumbs(nodes: readonly PiboWebSessionNode[], piboSessionId: string): SessionBreadcrumbItem[] {
	const path = findSessionPath(nodes, piboSessionId);
	return path.map((node, index) => ({
		piboSessionId: node.piboSessionId,
		label: sessionBreadcrumbLabel(node, index),
	}));
}

function resolveSessionThinkingLevel(bootstrap: BootstrapData, profileName: string, isSubagent = false): ThinkingLevel | undefined {
	const staticAgent = bootstrap.agents.find((agent) => agent.name === profileName);
	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = staticAgent ?? customAgent;
	if (isSubagent) return profile?.subagentThinkingLevel ?? profile?.thinkingLevel ?? bootstrap.modelDefaults?.subagentThinking ?? bootstrap.modelDefaults?.thinking;
	return profile?.mainThinkingLevel ?? profile?.thinkingLevel ?? bootstrap.modelDefaults?.mainThinking ?? bootstrap.modelDefaults?.thinking;
}

function resolveSessionFastMode(bootstrap: BootstrapData, profileName: string, isSubagent = false): boolean | undefined {
	const staticAgent = bootstrap.agents.find((agent) => agent.name === profileName);
	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = staticAgent ?? customAgent;
	if (isSubagent) return profile?.subagentFast ?? profile?.fast ?? bootstrap.modelDefaults?.subagentFast ?? bootstrap.modelDefaults?.fast;
	return profile?.mainFast ?? profile?.fast ?? bootstrap.modelDefaults?.mainFast ?? bootstrap.modelDefaults?.fast;
}

function formatSessionModelBadge(modelLabel: string | undefined, thinkingLevel: ThinkingLevel | undefined, fast: boolean): string | undefined {
	if (!modelLabel) return undefined;
	return [modelLabel, thinkingLevel, fast ? "fast" : undefined].filter(Boolean).join(" ");
}

function resolveTraceThinkingState(traceView: PiboSessionTraceView | null): { level?: ThinkingLevel; fast?: boolean } {
	let state: { level?: ThinkingLevel; fast?: boolean } = {};
	if (!traceView) return state;
	for (const node of flattenTraceNodes(traceView.nodes)) {
		if (node.type !== "execution.command" || (node.title !== "thinking" && node.title !== "fast_mode")) continue;
		const output = node.output && typeof node.output === "object" ? node.output as Record<string, unknown> : undefined;
		const level = typeof output?.level === "string" && isThinkingLevel(output.level) ? output.level : undefined;
		state = {
			level: level ?? state.level,
			fast: node.title === "fast_mode" ? output?.mode === "fast" : state.fast,
		};
	}
	return state;
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children)]);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.includes(value as ThinkingLevel);
}

function sessionBreadcrumbLabel(node: PiboWebSessionNode, index: number): string {
	if (!index) return node.profile || node.title;
	if (node.subagentName && node.subagentName !== node.profile) return `${node.subagentName} (${node.profile})`;
	return node.profile || node.subagentName || node.title;
}

function sessionLabel(session: Pick<PiboWebSessionNode, "title" | "profile" | "subagentName">): string {
	if (session.subagentName && session.subagentName !== session.profile) return `${session.subagentName} (${session.profile})`;
	return session.title || session.profile || session.subagentName || "Untitled Session";
}
