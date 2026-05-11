import type { ChatSessionView } from "./types";
import { DEFAULT_CHAT_SESSION_VIEW_ID, type ChatSessionViewId } from "./types";
import { TraceSessionView } from "./TraceSessionView";
import { CompactTerminalSessionView } from "./compact-terminal/CompactTerminalSessionView";
import { WorkflowXStateSessionView } from "./WorkflowXStateSessionView";

export const inactiveChatSessionViews = [
	{
		id: "trace",
		label: "Trace",
		description: "Existing nested execution flow view. Kept as a dormant plugin, but not registered as an active session view.",
		render: (props) => <TraceSessionView {...props} />,
	},
] satisfies readonly ChatSessionView[];

const builtinChatSessionViews = [
	{
		id: "terminal",
		label: "Terminal",
		description: "Compact Codex-style terminal transcript.",
		render: (props) => <CompactTerminalSessionView {...props} />,
	},
	{
		id: "workflow",
		label: "Workflow",
		description: "Workflow/XState visualization for workflow-backed project sessions.",
		render: (props) => <WorkflowXStateSessionView {...props} />,
	},
] satisfies readonly (ChatSessionView & { id: ChatSessionViewId })[];

const builtinChatSessionViewById = new Map<ChatSessionViewId, ChatSessionView>(
	builtinChatSessionViews.map((view) => [view.id, view]),
);

export function listChatSessionViews(): readonly (ChatSessionView & { id: ChatSessionViewId })[] {
	return builtinChatSessionViews;
}

export function getChatSessionView(viewId: ChatSessionViewId): ChatSessionView {
	return builtinChatSessionViewById.get(viewId) ?? builtinChatSessionViewById.get(DEFAULT_CHAT_SESSION_VIEW_ID)!;
}
