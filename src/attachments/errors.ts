// Shared attachment error contract (D/I/C-shared, no DOM, no UI deps).
// Moved verbatim from the chat-ui draft core so providers living OUTSIDE the
// browser core (I-K07-DECISION-01 §1) throw the identical class the core
// catches with `instanceof`. The draft core re-exports these symbols.

export type AttachmentErrorCode =
	| "ATT_INVALID_JSON"
	| "ATT_SCHEMA_MISMATCH"
	| "ATT_STALE_REVISION"
	| "ATT_PROVIDER_MISSING"
	| "ATT_ACCESS_DENIED"
	| "ATT_NOT_PORTABLE"
	| "ATT_BYTES_MISSING"
	| "ATT_STORAGE_FAILED"
	| "ATT_MATERIALIZE_FAILED"
	| "ATT_ACCEPTANCE_UNKNOWN"
	| "ATT_LIMIT_EXCEEDED";

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
