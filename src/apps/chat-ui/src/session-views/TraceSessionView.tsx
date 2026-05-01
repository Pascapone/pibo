import { TraceTimeline } from "../tracing/TraceTimeline";
import type { ChatSessionViewProps } from "./types";

export function TraceSessionView({
	selectedTrace,
	isLoading,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	agentProfiles,
	sessionProfileChangeDisabled,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
}: ChatSessionViewProps) {
	return (
		<TraceTimeline
			trace={selectedTrace}
			isLoading={isLoading}
			showThinking={showThinking}
			expandThinking={expandThinking}
			sessionAgentProfile={sessionAgentProfile}
			sessionBreadcrumbs={sessionBreadcrumbs}
			originSession={originSession}
			derivedSessions={derivedSessions}
			agentProfiles={agentProfiles}
			sessionProfileChangeDisabled={sessionProfileChangeDisabled}
			onSessionAgentProfileChange={onSessionAgentProfileChange}
			onFork={onFork}
			onOpenSession={onOpenSession}
		/>
	);
}
