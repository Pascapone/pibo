import type { ReactNode } from "react";
import type { AgentProfile, PiboLoopJob, PiboSessionSignalSnapshot, PiboSessionTraceView, PiboSignalSnapshot, PiboWebSessionNode, PiboWebSessionStatus, RuntimeSessionBinding, ThinkingLevel, Trace } from "../types";
import type { SessionBreadcrumbItem, SessionDerivationLink, SessionOriginLink } from "../tracing/TraceTimeline";

export const chatSessionViewIds = ["terminal", "workflow"] as const;
export const toolDisplayModes = ["default", "hide", "slim", "intent"] as const;

export type ChatSessionViewId = (typeof chatSessionViewIds)[number];
export type ToolDisplayMode = (typeof toolDisplayModes)[number];

export const DEFAULT_CHAT_SESSION_VIEW_ID: ChatSessionViewId = "terminal";

export function isChatSessionViewId(value: unknown): value is ChatSessionViewId {
	return typeof value === "string" && chatSessionViewIds.includes(value as ChatSessionViewId);
}

export function parseChatSessionViewId(value: unknown): ChatSessionViewId | undefined {
	return isChatSessionViewId(value) ? value : undefined;
}

export type ChatSessionViewProps = {
	traceView: PiboSessionTraceView | null;
	selectedPiboSessionId: string | null;
	workflowSessionLinked: boolean;
	selectedTrace: Trace | null;
	isLoading: boolean;
	terminalFullscreen?: boolean;
	showThinking: boolean;
	debugMode?: boolean;
	expandThinking: boolean;
	toolDisplayMode: ToolDisplayMode;
	sessionAgentProfile?: string;
	sessionActiveModel?: string;
	sessionRuntimeBinding?: RuntimeSessionBinding;
	selectedSessionStatus?: PiboWebSessionStatus;
	selectedSessionSignal?: PiboSessionSignalSnapshot;
	signals?: PiboSignalSnapshot;
	sessionGoal?: PiboLoopJob | null;
	sessionNodes: readonly PiboWebSessionNode[];
	sessionBreadcrumbs: readonly SessionBreadcrumbItem[];
	originSession?: SessionOriginLink;
	derivedSessions: readonly SessionDerivationLink[];
	agentProfiles: readonly AgentProfile[];
	sessionProfileChangeDisabled: boolean;
	onSessionAgentProfileChange(profile: string): void;
	onFork(entryId: string): void;
	onOpenSession(piboSessionId: string): void;
	onLoadOlderTracePage?(): void | Promise<void>;
	hasOlderTraceEvents?: boolean;
	isFetchingOlderTracePage?: boolean;
	onThinkingLevelChange(level: ThinkingLevel): void;
	onModelChanged?(): Promise<void>;
	onRefreshBootstrap?(): Promise<unknown>;
	onError?(message: string | null): void;
};

export type ChatSessionView = {
	id: string;
	label: string;
	description?: string;
	render(props: ChatSessionViewProps): ReactNode;
};
