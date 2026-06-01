import type { PiboJsonValue } from "../../../core/events.js";

export type ChatRetentionClass = "live_delta" | "trace_event" | "chat_message" | "audit_event";

export type ChatEventActorType = "user" | "assistant" | "system" | "agent";

export type ChatEventAppendInput = {
	roomId?: string;
	piboSessionId?: string;
	eventId?: string;
	eventType: string;
	actorType?: ChatEventActorType;
	actorId?: string;
	clientTxnId?: string;
	retentionClass: ChatRetentionClass;
	payload: PiboJsonValue;
	createdAt?: string;
};

export type StoredChatEvent = {
	streamId: number;
	roomId?: string;
	piboSessionId?: string;
	eventId: string;
	eventType: string;
	actorType?: ChatEventActorType;
	actorId?: string;
	clientTxnId?: string;
	createdAt: string;
	retentionClass: ChatRetentionClass;
	payload: PiboJsonValue;
};

export type ChatEventListInput = {
	roomId?: string;
	piboSessionId?: string;
	afterStreamId?: number;
	limit?: number;
};

export type ChatRetentionPolicy = {
	id: string;
	deleteLiveDeltasAfterMs?: number;
	deleteTraceEventsAfterMs?: number;
	deleteChatMessagesAfterMs?: number;
};
