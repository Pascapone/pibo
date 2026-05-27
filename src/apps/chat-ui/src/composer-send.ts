import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";
import type { WebAnnotationMessageAttachment } from "./api-web-annotations";
import type { UploadedChatAttachment } from "./chat-upload-attachments";
import type { LiveTraceOverlay } from "./tracing/live-overlay";

type ComposerWebAnnotationRef = Pick<WebAnnotationMessageAttachment, "id">;
type ComposerUploadAttachmentRef = Pick<UploadedChatAttachment, "path">;

export type ComposerQueuedMessagePayload = {
	type: "message_queued";
	piboSessionId: string;
	eventId: string;
	clientTxnId: string;
	queuedMessages: number;
	text: string;
	fileAttachmentPaths?: string[];
	source: "user";
};

export type ComposerSendPlan = {
	text: string;
	webAnnotationIds: string[];
	fileAttachmentPaths: string[];
	clientTxnId: string;
	optimisticEvent: ChatWebStoredEvent<ComposerQueuedMessagePayload>;
};

export function createComposerSendPlan({
	piboSessionId,
	text,
	selectedWebAnnotations,
	selectedUploadAttachments,
	eventSequence,
	now,
	clientTxnId,
}: {
	piboSessionId: string;
	text: string;
	selectedWebAnnotations: readonly ComposerWebAnnotationRef[];
	selectedUploadAttachments: readonly ComposerUploadAttachmentRef[];
	eventSequence: number;
	now: string;
	clientTxnId: string;
}): ComposerSendPlan {
	const webAnnotationIds = selectedWebAnnotations.map((annotation) => annotation.id);
	const fileAttachmentPaths = selectedUploadAttachments.map((attachment) => attachment.path);
	const optimisticEvent: ChatWebStoredEvent<ComposerQueuedMessagePayload> = {
		id: clientTxnId,
		piboSessionId,
		eventSequence,
		eventId: clientTxnId,
		type: "message_queued",
		createdAt: now,
		payload: {
			type: "message_queued",
			piboSessionId,
			eventId: clientTxnId,
			clientTxnId,
			queuedMessages: 1,
			text,
			...(fileAttachmentPaths.length ? { fileAttachmentPaths } : {}),
			source: "user",
		},
	};
	return { text, webAnnotationIds, fileAttachmentPaths, clientTxnId, optimisticEvent };
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
