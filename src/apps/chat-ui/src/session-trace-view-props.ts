import { THINKING_LEVELS, type BootstrapData, type PiboLoopJob, type PiboSessionSignalSnapshot, type PiboSessionTraceView, type PiboSignalSnapshot, type PiboTraceNode, type PiboWebSessionNode, type PiboWebSessionStatus, type RuntimeSessionBinding, type ThinkingLevel } from "./types";
import { findSessionNode, findSessionPath } from "./app-session-model";
import type { ChatSessionViewProps } from "./session-views/types";
import type { SessionBreadcrumbItem, SessionDerivationLink, SessionOriginLink } from "./tracing/TraceTimeline";
import { adaptTrace } from "./tracing/adapt";

export type SessionTraceViewLinks = Pick<ChatSessionViewProps, "sessionBreadcrumbs" | "originSession" | "derivedSessions">;
export type SessionForkCandidate = { entryId: string; text: string };

export function sessionSupportsFork(
	bootstrap: BootstrapData,
	piboSessionId: string | null,
	profileName: string,
): boolean {
	return sessionRuntime(bootstrap, piboSessionId, profileName)?.capabilities.lifecycle.fork === true;
}

export function sessionSupportsForkWhileRunning(
	bootstrap: BootstrapData,
	piboSessionId: string | null,
	profileName: string,
): boolean {
	return sessionRuntime(bootstrap, piboSessionId, profileName)?.capabilities.lifecycle.forkWhileRunning === true;
}

export function traceUserMessageRevision(traceView: PiboSessionTraceView | null): string {
	if (!traceView) return "none";
	const users = flattenTraceNodes(traceView.nodes).filter((node) => node.type === "user.message");
	return `${users.length}:${users.at(-1)?.id ?? ""}`;
}

export function withSessionForkCandidates(
	traceView: PiboSessionTraceView | null,
	candidates: readonly SessionForkCandidate[],
): PiboSessionTraceView | null {
	if (!traceView) return traceView;
	const userNodes = flattenTraceNodes(traceView.nodes).filter((node) => node.type === "user.message");
	const seenEntryIds = new Set<string>();
	const usableCandidates = candidates.filter((candidate) => {
		if (!candidate.entryId.trim() || seenEntryIds.has(candidate.entryId)) return false;
		seenEntryIds.add(candidate.entryId);
		return true;
	});
	const authoritativeEntryIds = new Set(usableCandidates.map((candidate) => candidate.entryId));
	const currentEntryId = (node: PiboTraceNode): string | undefined =>
		node.entryId && authoritativeEntryIds.has(node.entryId) ? node.entryId : undefined;
	const assignments = new Map<string, string>();
	const positionalIdentityIsConsistent = userNodes.length === usableCandidates.length
		&& userNodes.every((node, index) => !currentEntryId(node) || currentEntryId(node) === usableCandidates[index]!.entryId);
	const completedPrefixIsConsistent = usableCandidates.length < userNodes.length
		&& usableCandidates.every((candidate, index) => {
			const node = userNodes[index]!;
			const entryId = currentEntryId(node);
			return entryId ? entryId === candidate.entryId : traceUserMessageText(node) === candidate.text;
		});
	if (positionalIdentityIsConsistent || completedPrefixIsConsistent) {
		for (let index = 0; index < usableCandidates.length; index += 1) {
			assignments.set(userNodes[index]!.id, usableCandidates[index]!.entryId);
		}
	} else {
		const claimedEntryIds = new Set(userNodes.flatMap((node) => {
			const entryId = currentEntryId(node);
			return entryId ? [entryId] : [];
		}));
		const unassignedNodes = userNodes.filter((node) => !currentEntryId(node));
		const nodeTextCounts = new Map<string, number>();
		const candidatesByText = new Map<string, SessionForkCandidate[]>();
		for (const node of unassignedNodes) {
			const text = traceUserMessageText(node);
			nodeTextCounts.set(text, (nodeTextCounts.get(text) ?? 0) + 1);
		}
		for (const candidate of usableCandidates) {
			if (claimedEntryIds.has(candidate.entryId)) continue;
			const matches = candidatesByText.get(candidate.text);
			if (matches) matches.push(candidate);
			else candidatesByText.set(candidate.text, [candidate]);
		}
		for (const node of unassignedNodes) {
			const text = traceUserMessageText(node);
			const matchingCandidates = candidatesByText.get(text) ?? [];
			if (nodeTextCounts.get(text) !== 1 || matchingCandidates.length !== 1) continue;
			assignments.set(node.id, matchingCandidates[0]!.entryId);
		}
	}
	const nodes = reconcileForkEntryIds(traceView.nodes, assignments, authoritativeEntryIds);
	return nodes.every((node, index) => node === traceView.nodes[index]) ? traceView : { ...traceView, nodes };
}

function traceUserMessageText(node: PiboTraceNode): string {
	if (typeof node.output === "string") return node.output;
	if (typeof node.summary === "string") return node.summary;
	return node.title;
}

function reconcileForkEntryIds(
	nodes: readonly PiboTraceNode[],
	assignments: ReadonlyMap<string, string>,
	authoritativeEntryIds: ReadonlySet<string>,
): PiboTraceNode[] {
	return nodes.map((node) => {
		const children = reconcileForkEntryIds(node.children, assignments, authoritativeEntryIds);
		const assignedEntryId = assignments.get(node.id);
		const entryId = node.type === "user.message"
			? assignedEntryId ?? (node.entryId && authoritativeEntryIds.has(node.entryId) ? node.entryId : undefined)
			: node.entryId;
		const childrenChanged = children.some((child, index) => child !== node.children[index]);
		if (entryId === node.entryId && !childrenChanged) return node;
		const { entryId: _discardedEntryId, ...withoutEntryId } = node;
		return { ...withoutEntryId, ...(entryId ? { entryId } : {}), children };
	});
}

function sessionRuntime(
	bootstrap: BootstrapData,
	piboSessionId: string | null,
	profileName: string,
) {
	const session = piboSessionId ? findSessionNode(bootstrap.sessions, piboSessionId) : undefined;
	const staticProfile = bootstrap.agents.find((agent) => agent.name === profileName);
	const customProfile = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = customProfile ?? staticProfile;
	const activeBinding = bootstrap.session?.id === piboSessionId ? bootstrap.session.runtimeBinding : undefined;
	const runtimeInstanceId = session?.runtimeInstanceId ?? activeBinding?.runtimeInstanceId ?? profile?.runtimeInstanceId;
	return bootstrap.agentCatalog?.agentRuntimes.find((candidate) =>
		runtimeInstanceId ? candidate.id === runtimeInstanceId : session?.runtimeAdapterId ? candidate.adapterId === session.runtimeAdapterId : false,
	);
}

export function sessionCanSteer(
	bootstrap: BootstrapData,
	piboSessionId: string | null,
	profileName: string,
	signal: PiboSessionSignalSnapshot | undefined,
): boolean {
	if (signal?.latestTurn?.state !== "running") return false;
	const runtime = sessionRuntime(bootstrap, piboSessionId, profileName);
	return runtime?.enabled !== false
		&& runtime?.available !== false
		&& runtime?.capabilities.input?.steering === true;
}

export function sessionSupportsToolIntent(
	bootstrap: BootstrapData,
	piboSessionId: string | null,
	profileName: string,
): boolean {
	const session = piboSessionId ? findSessionNode(bootstrap.sessions, piboSessionId) : undefined;
	const staticProfile = bootstrap.agents.find((agent) => agent.name === profileName);
	const customProfile = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = customProfile ?? staticProfile;
	const runtime = sessionRuntime(bootstrap, piboSessionId, profileName);
	const capability = runtime?.capabilities.tools.intentTracing;
	if (!capability?.supported) return false;
	if (!capability.configurable) return true;
	const activeBinding = bootstrap.session?.id === piboSessionId ? bootstrap.session.runtimeBinding : undefined;
	const boundConfiguration = activeBinding?.metadata?.intentTracing;
	if (typeof boundConfiguration === "boolean") return boundConfiguration;
	const configured = profile?.runtimeOptions?.intentTracing;
	return typeof configured === "boolean" ? configured : capability.enabledByDefault;
}

export function resolveSessionTraceTitle(input: {
	sessionNodes: readonly PiboWebSessionNode[];
	selectedPiboSessionId: string | null;
	traceTitle?: string;
	fallback?: string;
}): string | undefined {
	const selectedSession = input.selectedPiboSessionId
		? findSessionNode(input.sessionNodes, input.selectedPiboSessionId)
		: undefined;
	return selectedSession?.title || input.traceTitle || input.selectedPiboSessionId || input.fallback;
}

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
			?? selectedSessionNode?.initialThinkingLevel
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
	debugMode?: boolean;
	expandThinking: boolean;
	toolDisplayMode: ChatSessionViewProps["toolDisplayMode"];
	selectedSessionProfile: string;
	sessionActiveModelBadge?: string;
	sessionRuntimeBinding?: RuntimeSessionBinding;
	selectedSessionStatus?: PiboWebSessionStatus;
	selectedSessionSignal?: PiboSessionSignalSnapshot;
	signals?: PiboSignalSnapshot;
	sessionGoal?: PiboLoopJob | null;
	selectedPiboSessionId: string | null;
	workflowSessionLinked: boolean;
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
		selectedTrace: input.currentTraceView
			? adaptTrace(input.currentTraceView.piboSessionId, input.currentTraceView.title, input.currentTraceView.nodes)
			: null,
		isLoading: input.isLoading,
		showThinking: input.showThinking,
		debugMode: input.debugMode,
		expandThinking: input.expandThinking,
		toolDisplayMode: input.toolDisplayMode,
		sessionAgentProfile: input.selectedSessionProfile,
		sessionActiveModel: input.sessionActiveModelBadge,
		sessionRuntimeBinding: input.sessionRuntimeBinding,
		selectedSessionStatus: input.selectedSessionStatus,
		selectedSessionSignal: input.selectedSessionSignal,
		signals: input.signals,
		sessionGoal: input.sessionGoal,
		selectedPiboSessionId: input.selectedPiboSessionId,
		workflowSessionLinked: input.workflowSessionLinked,
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
