// Shared attachment error contract (D/I/C-shared, no DOM, no UI deps).
// Providers and Core use the identical error class. Worker/HTTP boundaries
// preserve only the explicit public codes, not arbitrary exception namespaces.
// The draft core re-exports the original error type and class.

export const ATTACHMENT_ERROR_CODES = Object.freeze([
	"ATT_INVALID_JSON", "ATT_SCHEMA_MISMATCH", "ATT_STALE_REVISION",
	"ATT_PROVIDER_MISSING", "ATT_ACCESS_DENIED", "ATT_NOT_PORTABLE",
	"ATT_BYTES_MISSING", "ATT_STORAGE_FAILED", "ATT_MATERIALIZE_FAILED",
	"ATT_ACCEPTANCE_UNKNOWN", "ATT_LIMIT_EXCEEDED",
] as const);
export type AttachmentErrorCode = typeof ATTACHMENT_ERROR_CODES[number];

export function isAttachmentErrorCode(value: unknown): value is AttachmentErrorCode {
	return typeof value === "string" && ATTACHMENT_ERROR_CODES.includes(value as AttachmentErrorCode);
}

export type AttachmentError = {
	code: AttachmentErrorCode;
	message: string;
	retryable: boolean;
};

export class AttachmentDraftError extends Error {
	readonly code: AttachmentErrorCode;
	readonly retryable: boolean;

	constructor(error: AttachmentError) {
		super(error.message);
		this.name = "AttachmentDraftError";
		this.code = error.code;
		this.retryable = error.retryable;
	}
}
