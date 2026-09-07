import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";
import type { ChatMessageDelivery } from "./api-chat-sessions";
import type { WebAnnotationMessageAttachment } from "./api-web-annotations";
import type { UploadedChatAttachment } from "./chat-upload-attachments";
import type { LiveTraceOverlay } from "./tracing/live-overlay";

type ComposerWebAnnotationRef = Pick<WebAnnotationMessageAttachment, "id">;
type ComposerUploadAttachmentRef = Pick<UploadedChatAttachment, "path">;

export type ComposerUserMessagePayload = {
	type: "message_queued" | "message_steered";
	piboSessionId: string;
	eventId: string;
	clientTxnId: string;
	delivery: ChatMessageDelivery;
	queuedMessages?: number;
	text: string;
	fileAttachmentPaths?: string[];
	source: "user";
};

export type ComposerSendPlan = {
	piboSessionId: string;
	text: string;
	webAnnotationIds: string[];
	fileAttachmentPaths: string[];
	clientTxnId: string;
	delivery: ChatMessageDelivery;
	optimisticEvent: ChatWebStoredEvent<ComposerUserMessagePayload>;
};

export function createComposerSendPlan({
	piboSessionId,
	text,
	selectedWebAnnotations,
	selectedUploadAttachments,
	eventSequence,
	now,
	clientTxnId,
	delivery = "queue",
}: {
	piboSessionId: string;
	text: string;
	selectedWebAnnotations: readonly ComposerWebAnnotationRef[];
	selectedUploadAttachments: readonly ComposerUploadAttachmentRef[];
	eventSequence: number;
	now: string;
	clientTxnId: string;
	delivery?: ChatMessageDelivery;
}): ComposerSendPlan {
	const webAnnotationIds = selectedWebAnnotations.map((annotation) => annotation.id);
	const fileAttachmentPaths = selectedUploadAttachments.map((attachment) => attachment.path);
	const eventType = delivery === "steer" ? "message_steered" : "message_queued";
	const optimisticEvent: ChatWebStoredEvent<ComposerUserMessagePayload> = {
		id: clientTxnId,
		piboSessionId,
		eventSequence,
		eventId: clientTxnId,
		type: eventType,
		createdAt: now,
		payload: {
			type: eventType,
			piboSessionId,
			eventId: clientTxnId,
			clientTxnId,
			delivery,
			...(delivery === "queue" ? { queuedMessages: 1 } : {}),
			text,
			...(fileAttachmentPaths.length ? { fileAttachmentPaths } : {}),
			source: "user",
		},
	};
	return { piboSessionId, text, webAnnotationIds, fileAttachmentPaths, clientTxnId, delivery, optimisticEvent };
}

export function withComposerSendDelivery(plan: ComposerSendPlan, delivery: ChatMessageDelivery): ComposerSendPlan {
	if (plan.delivery === delivery) return plan;
	const eventType = delivery === "steer" ? "message_steered" : "message_queued";
	const payload = { ...plan.optimisticEvent.payload };
	delete payload.queuedMessages;
	return {
		...plan,
		delivery,
		optimisticEvent: {
			...plan.optimisticEvent,
			type: eventType,
			payload: {
				...payload,
				type: eventType,
				delivery,
				...(delivery === "queue" ? { queuedMessages: 1 } : {}),
			},
		},
	};
}

export function appendComposerOptimisticEvent(
	current: LiveTraceOverlay | null,
	piboSessionId: string,
	optimisticEvent: ChatWebStoredEvent,
): LiveTraceOverlay {
	return {
		piboSessionId,
		events: [...(current?.piboSessionId === piboSessionId ? current.events : []), optimisticEvent],
	};
}


const pendingTransactionKey = "pibo.chat.pending-message-transaction.v2";
type PendingTransaction = Pick<ComposerSendPlan, "piboSessionId" | "text" | "webAnnotationIds" | "fileAttachmentPaths" | "clientTxnId" | "delivery">;

export function readPendingMessageTransaction(): PendingTransaction | null {
 try {
  const value: unknown = JSON.parse(window.sessionStorage.getItem(pendingTransactionKey) ?? "null");
  if (!value || typeof value !== "object") return null;
  const row = value as PendingTransaction;
  return typeof row.piboSessionId === "string" && typeof row.text === "string" && typeof row.clientTxnId === "string" && (row.delivery === "queue" || row.delivery === "steer") && Array.isArray(row.webAnnotationIds) && row.webAnnotationIds.every(id => typeof id === "string") && Array.isArray(row.fileAttachmentPaths) && row.fileAttachmentPaths.every(path => typeof path === "string") ? row : null;
 } catch { return null; }
}

export function rememberPendingMessageTransaction(plan: PendingTransaction | null): void {
 try {
  if (!plan) window.sessionStorage.removeItem(pendingTransactionKey);
  else { const { piboSessionId, text, webAnnotationIds, fileAttachmentPaths, clientTxnId, delivery } = plan; window.sessionStorage.setItem(pendingTransactionKey, JSON.stringify({piboSessionId,text,webAnnotationIds,fileAttachmentPaths,clientTxnId,delivery})); }
 } catch { /* In-memory identity still protects retries if browser storage is unavailable. */ }
}

export function samePendingMessageIntent(prior: PendingTransaction | null, input: Pick<PendingTransaction,"piboSessionId"|"text"|"webAnnotationIds"|"fileAttachmentPaths">): boolean {
 return prior !== null && prior.piboSessionId === input.piboSessionId && prior.text === input.text && JSON.stringify(prior.webAnnotationIds) === JSON.stringify(input.webAnnotationIds) && JSON.stringify(prior.fileAttachmentPaths) === JSON.stringify(input.fileAttachmentPaths);
}
