import type { ChatSessionView } from "./types";
import { DEFAULT_CHAT_SESSION_VIEW_ID, type ChatSessionViewId } from "./types";
import { TraceSessionView } from "./TraceSessionView";
import { CompactTerminalSessionView } from "./compact-terminal/CompactTerminalSessionView";

const builtinChatSessionViews = [
	{
		id: "trace",
		label: "Trace",
		description: "Existing nested execution flow view.",
		render: (props) => <TraceSessionView {...props} />,
	},
	{
		id: "terminal",
		label: "Terminal",
		description: "Compact Codex-style terminal transcript.",
		render: (props) => <CompactTerminalSessionView {...props} />,
	},
] satisfies readonly ChatSessionView[];

const builtinChatSessionViewById = new Map<ChatSessionViewId, ChatSessionView>(
	builtinChatSessionViews.map((view) => [view.id, view]),
);

export function listChatSessionViews(): readonly ChatSessionView[] {
	return builtinChatSessionViews;
}

export function getChatSessionView(viewId: ChatSessionViewId): ChatSessionView {
	return builtinChatSessionViewById.get(viewId) ?? builtinChatSessionViewById.get(DEFAULT_CHAT_SESSION_VIEW_ID)!;
}
