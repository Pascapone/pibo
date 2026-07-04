import { TraceTimeline } from "../tracing/TraceTimeline";
import type { ChatSessionViewProps } from "./types";

export function TraceSessionView({
	selectedTrace,
	isLoading,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionActiveModel,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	agentProfiles,
	sessionProfileChangeDisabled,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onLoadOlderTracePage,
	hasOlderTraceEvents,
	isFetchingOlderTracePage,
}: ChatSessionViewProps) {
	return (
		<TraceTimeline
			trace={selectedTrace}
			isLoading={isLoading}
			showThinking={showThinking}
			expandThinking={expandThinking}
			sessionAgentProfile={sessionAgentProfile}
			sessionActiveModel={sessionActiveModel}
			sessionBreadcrumbs={sessionBreadcrumbs}
			originSession={originSession}
			derivedSessions={derivedSessions}
			agentProfiles={agentProfiles}
			sessionProfileChangeDisabled={sessionProfileChangeDisabled}
			onSessionAgentProfileChange={onSessionAgentProfileChange}
			onFork={onFork}
			onOpenSession={onOpenSession}
			onLoadOlderTracePage={onLoadOlderTracePage}
			hasOlderTraceEvents={hasOlderTraceEvents}
			isFetchingOlderTracePage={isFetchingOlderTracePage}
		/>
	);
}
