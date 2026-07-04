import type { ReactNode } from "react";
import type { AgentProfile, PiboProjectSession, PiboSessionSignalSnapshot, PiboSessionTraceView, PiboWebSessionNode, PiboWebSessionStatus, ThinkingLevel, Trace, WorkflowLifecycleEventRecord } from "../types";
import type { SessionBreadcrumbItem, SessionDerivationLink, SessionOriginLink } from "../tracing/TraceTimeline";

export const chatSessionViewIds = ["terminal", "workflow"] as const;

export type ChatSessionViewId = (typeof chatSessionViewIds)[number];

export const DEFAULT_CHAT_SESSION_VIEW_ID: ChatSessionViewId = "terminal";

export function isChatSessionViewId(value: unknown): value is ChatSessionViewId {
	return typeof value === "string" && chatSessionViewIds.includes(value as ChatSessionViewId);
}

export function parseChatSessionViewId(value: unknown): ChatSessionViewId | undefined {
	return isChatSessionViewId(value) ? value : undefined;
}

export type ChatSessionViewProps = {
	traceView: PiboSessionTraceView | null;
	selectedTrace: Trace | null;
	isLoading: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	sessionAgentProfile?: string;
	sessionActiveModel?: string;
	selectedSessionStatus?: PiboWebSessionStatus;
	selectedSessionSignal?: PiboSessionSignalSnapshot;
	workflowProjectSession?: PiboProjectSession;
	workflowLifecycleEvents?: readonly WorkflowLifecycleEventRecord[];
	sessionNodes: readonly PiboWebSessionNode[];
	sessionBreadcrumbs: readonly SessionBreadcrumbItem[];
	originSession?: SessionOriginLink;
	derivedSessions: readonly SessionDerivationLink[];
	agentProfiles: readonly AgentProfile[];
	sessionProfileChangeDisabled: boolean;
	onSessionAgentProfileChange(profile: string): void;
	onFork(entryId: string): void;
	onOpenSession(piboSessionId: string): void;
	onLoadOlderTracePage?(): void;
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
