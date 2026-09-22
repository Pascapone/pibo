/** Browser-safe media identities. Login identity is not a server tenant key. */
export const ATTACHMENT_MEDIA_RETENTION_CLASS = "chat_attachment_media_v1";
/** Mirrors the existing durable browser-blob ceiling; HTTP request limits remain separate. */
export const ATTACHMENT_MEDIA_MAX_BYTES = 15 * 1024 * 1024;
export type AttachmentResourceScope = { sessionId: string; clientTxnId: string; draftResourceId: string };
export type AttachmentResourceDescriptor = {
	preparedUploadId: string;
	draftResourceId: string;
	mimeType: string;
	bytes: number;
	sha256: string;
	name: string;
	state: "prepared" | "accepted";
};
