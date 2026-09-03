import { useCallback, useMemo, useState } from "react";

import type { ChatUploadedFile } from "./api-chat-files";

export type UploadedChatAttachment = ChatUploadedFile & {
	id: string;
};

export type UploadedChatAttachmentsBySession = Record<string, UploadedChatAttachment[]>;

export const MAX_SELECTED_UPLOAD_ATTACHMENTS = 10;

export function assertChatUploadCapacity(selectedCount: number, newFileCount: number): void {
	const remaining = Math.max(0, MAX_SELECTED_UPLOAD_ATTACHMENTS - selectedCount);
	if (newFileCount <= remaining) return;
	throw new Error(remaining === 0
		? `At most ${MAX_SELECTED_UPLOAD_ATTACHMENTS} uploaded files can be attached; remove an attachment before uploading another file`
		: `At most ${MAX_SELECTED_UPLOAD_ATTACHMENTS} uploaded files can be attached; only ${remaining} attachment slot${remaining === 1 ? " is" : "s are"} available`);
}

export function addUploadedChatAttachmentsForSession(
	current: UploadedChatAttachmentsBySession,
	sessionId: string | null,
	files: readonly ChatUploadedFile[],
	createAttachmentId: () => string,
): UploadedChatAttachmentsBySession {
	if (!sessionId || !files.length) return current;
	const existing = current[sessionId] ?? [];
	const existingPaths = new Set(existing.map((file) => file.path));
	const additions = files
		.filter((file) => file.path && !existingPaths.has(file.path))
		.map((file): UploadedChatAttachment => ({ ...file, id: createAttachmentId() }));
	if (!additions.length) return current;
	assertChatUploadCapacity(existing.length, additions.length);
	return {
		...current,
		[sessionId]: [...existing, ...additions],
	};
}

export function detachUploadedChatAttachmentForSession(
	current: UploadedChatAttachmentsBySession,
	sessionId: string | null,
	attachmentId: string,
): UploadedChatAttachmentsBySession {
	if (!sessionId) return current;
	const existing = current[sessionId] ?? [];
	const next = existing.filter((attachment) => attachment.id !== attachmentId);
	if (next.length === existing.length) return current;
	return { ...current, [sessionId]: next };
}

export function clearUploadedChatAttachmentsForSession(
	current: UploadedChatAttachmentsBySession,
	sessionId: string | null,
): UploadedChatAttachmentsBySession {
	if (!sessionId) return current;
	if (!(current[sessionId]?.length)) return current;
	return { ...current, [sessionId]: [] };
}

export function useSessionUploadAttachments(selectedPiboSessionId: string | null, createAttachmentId: () => string) {
	const [selectedUploadAttachmentsBySession, setSelectedUploadAttachmentsBySession] = useState<UploadedChatAttachmentsBySession>({});
	const selectedUploadAttachments = useMemo(
		() => selectedPiboSessionId ? selectedUploadAttachmentsBySession[selectedPiboSessionId] ?? [] : [],
		[selectedPiboSessionId, selectedUploadAttachmentsBySession],
	);

	const attachUploadedFiles = useCallback((files: readonly ChatUploadedFile[]) => {
		setSelectedUploadAttachmentsBySession((current) => addUploadedChatAttachmentsForSession(current, selectedPiboSessionId, files, createAttachmentId));
	}, [createAttachmentId, selectedPiboSessionId]);

	const detachUploadAttachment = useCallback((attachmentId: string) => {
		setSelectedUploadAttachmentsBySession((current) => detachUploadedChatAttachmentForSession(current, selectedPiboSessionId, attachmentId));
	}, [selectedPiboSessionId]);

	const clearSelectedUploadAttachments = useCallback(() => {
		setSelectedUploadAttachmentsBySession((current) => clearUploadedChatAttachmentsForSession(current, selectedPiboSessionId));
	}, [selectedPiboSessionId]);

	return {
		selectedUploadAttachments,
		attachUploadedFiles,
		detachUploadAttachment,
		clearSelectedUploadAttachments,
	};
}
