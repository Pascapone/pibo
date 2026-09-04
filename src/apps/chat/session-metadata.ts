import type { PiboJsonObject } from "../../core/events.js";
import type { PiboSession } from "../../sessions/store.js";

const CHAT_WEB_ARCHIVED_AT_KEY = "chatWebArchivedAt";
const CHAT_WEB_PINNED_AT_KEY = "chatWebPinnedAt";
const CHAT_WEB_SIDEBAR_ORDER_KEY = "chatWebSidebarOrder";

export function isChatWebSessionArchived(session: Pick<PiboSession, "metadata">): boolean {
	return typeof session.metadata?.[CHAT_WEB_ARCHIVED_AT_KEY] === "string";
}

export function isChatWebSessionPinned(session: Pick<PiboSession, "metadata">): boolean {
	return typeof session.metadata?.[CHAT_WEB_PINNED_AT_KEY] === "string";
}

export function chatWebSessionSidebarOrder(session: Pick<PiboSession, "metadata">): number | undefined {
	const value = session.metadata?.[CHAT_WEB_SIDEBAR_ORDER_KEY];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function compareChatWebSessionsBySidebarOrder(left: PiboSession, right: PiboSession): number {
	const pinnedDifference = Number(isChatWebSessionPinned(right)) - Number(isChatWebSessionPinned(left));
	if (pinnedDifference !== 0) return pinnedDifference;
	const leftOrder = chatWebSessionSidebarOrder(left) ?? (Date.parse(left.createdAt) || 0);
	const rightOrder = chatWebSessionSidebarOrder(right) ?? (Date.parse(right.createdAt) || 0);
	if (leftOrder !== rightOrder) return rightOrder - leftOrder;
	return right.id.localeCompare(left.id);
}

export function withChatWebArchived(metadata: PiboJsonObject | undefined, archived: boolean): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}) };
	if (archived) {
		next[CHAT_WEB_ARCHIVED_AT_KEY] = new Date().toISOString();
	} else {
		delete next[CHAT_WEB_ARCHIVED_AT_KEY];
	}
	return next;
}

export function withChatWebSessionPinned(metadata: PiboJsonObject | undefined, pinned: boolean, order = Date.now()): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}), [CHAT_WEB_SIDEBAR_ORDER_KEY]: order };
	if (pinned) next[CHAT_WEB_PINNED_AT_KEY] = new Date().toISOString();
	else delete next[CHAT_WEB_PINNED_AT_KEY];
	return next;
}

export function withChatWebSessionSidebarOrder(metadata: PiboJsonObject | undefined, order: number): PiboJsonObject {
	return { ...(metadata ?? {}), [CHAT_WEB_SIDEBAR_ORDER_KEY]: order };
}
