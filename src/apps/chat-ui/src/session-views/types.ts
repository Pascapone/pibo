import type { ReactNode } from "react";
import type { AgentProfile, PiboSessionTraceView, ThinkingLevel, Trace } from "../types";
import type { SessionBreadcrumbItem, SessionDerivationLink, SessionOriginLink } from "../tracing/TraceTimeline";

export const chatSessionViewIds = ["trace", "terminal"] as const;

export type ChatSessionViewId = (typeof chatSessionViewIds)[number];

export const DEFAULT_CHAT_SESSION_VIEW_ID: ChatSessionViewId = "trace";

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
	sessionBreadcrumbs: readonly SessionBreadcrumbItem[];
	originSession?: SessionOriginLink;
	derivedSessions: readonly SessionDerivationLink[];
	agentProfiles: readonly AgentProfile[];
	sessionProfileChangeDisabled: boolean;
	onSessionAgentProfileChange(profile: string): void;
	onFork(entryId: string): void;
	onOpenSession(piboSessionId: string): void;
	onThinkingLevelChange(level: ThinkingLevel): void;
};

export type ChatSessionView = {
	id: ChatSessionViewId;
	label: string;
	description?: string;
	render(props: ChatSessionViewProps): ReactNode;
};
