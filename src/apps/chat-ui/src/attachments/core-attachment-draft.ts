/**
 * Private Core attachment draft pilot (D1, NOT a finished public SDK export).
 *
 * Owns the session-bound draft side of K07-v0: add/update/remove with revision
 * compare-and-swap, reload-proof persistence through an injected storage
 * adapter, send snapshots frozen to a clientTxnId, and controlled acceptance
 * that consumes only the frozen revisions.
 *
 * Pilot decisions pending RV-02/05/07 agreement with B/C (not wired to any
 * production composer, provider, or SDK surface yet):
 * - Unknown attachment id on update behaves as ATT_STALE_REVISION (no
 *   separate not-found code exists in K07-v0).
 * - remove() is idempotent: removing an unknown id succeeds.
 * - Payload changes bump the revision; uiState-only changes persist without
 *   bumping the revision (presentation state is not model payload).
 * - clientTxnId reuses the existing 160-char message limit; no new JSON byte
 *   budgets are invented here.
 * - Accepted clientTxnIds are never frozen again (same id, changed payload
 *   is rejected with ATT_ACCEPTANCE_UNKNOWN).
 */

export type AttachmentId = string & { readonly brand: "AttachmentId" };
export type AttachmentRevision = number & { readonly brand: "AttachmentRevision" };
export type ClientTxnId = string & { readonly brand: "ClientTxnId" };

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

export type AttachmentEnvelope = {
	formatVersion: 1;
	id: AttachmentId;
	sessionId: string;
	type: string;
	schemaVersion: number;
	revision: AttachmentRevision;
	createdAt: string;
	updatedAt: string;
};

export type AttachmentDraftMedia = {
	draftResourceId: string;
	mimeType: string;
	bytes: number;
};

export type AttachmentDraftRecord = {
	envelope: AttachmentEnvelope;
	payload: unknown;
	uiState?: unknown;
	media?: AttachmentDraftMedia;
	status: "saving" | "ready" | "error";
	error?: AttachmentError;
};

export type AttachmentInput = {
	sessionId: string;
	type: string;
	schemaVersion: number;
	payload: unknown;
	uiState?: unknown;
	media?: AttachmentDraftMedia;
};

export type AttachmentEditableState = {
	payload?: unknown;
	uiState?: unknown;
};

export type CoreAttachmentDraftStorage = {
	readText(key: string): string | null;
	writeText(key: string, value: string): void;
	removeText(key: string): void;
};

export type FrozenAttachment = {
	id: AttachmentId;
	revision: AttachmentRevision;
	type: string;
	schemaVersion: number;
	payload: unknown;
	media?: AttachmentDraftMedia;
};

export type AttachmentSendSnapshot = {
	clientTxnId: ClientTxnId;
	sessionId: string;
	text: string;
	frozenAt: string;
	attachments: FrozenAttachment[];
};

export type AttachmentAcceptanceReceipt = {
	clientTxnId: string;
	accepted: boolean;
};

export type AttachmentAcceptanceResult = {
	consumed: AttachmentId[];
	duplicate: boolean;
};

export type CoreAttachmentDraftStoreOptions = {
	now?: () => string;
	createId?: () => string;
};

export const CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX = "pibo.chat.coreAttachments.draft.";
export const CORE_ATTACHMENT_CLIENT_TXN_ID_MAX = 160;

function draftKey(sessionId: string): string {
	return `${CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX}${sessionId}`;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, label: string): void {
	if (value === null || typeof value === "boolean" || typeof value === "string") return;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return;
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: `${label} must be finite JSON numbers.`,
			retryable: false,
		});
	}
	if (Array.isArray(value)) {
		for (const entry of value) assertJsonValue(entry, label);
		return;
	}
	if (isPlainJsonObject(value)) {
		for (const entry of Object.values(value)) assertJsonValue(entry, label);
		return;
	}
	throw new AttachmentDraftError({
		code: "ATT_INVALID_JSON",
		message: `${label} must be plain JSON (no functions, undefined, BigInt, symbols, or class instances).`,
		retryable: false,
	});
}

function cloneJson<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

function assertValidMedia(media: AttachmentDraftMedia): void {
	if (!media.draftResourceId || typeof media.draftResourceId !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_BYTES_MISSING",
			message: "Media attachments need a draft resource id.",
			retryable: false,
		});
	}
	if (!media.mimeType || typeof media.mimeType !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Media attachments need a MIME type.",
			retryable: false,
		});
	}
	if (!Number.isInteger(media.bytes) || media.bytes < 0) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Media byte size must be a non-negative integer.",
			retryable: false,
		});
	}
}

function assertValidClientTxnId(clientTxnId: string): asserts clientTxnId is ClientTxnId {
	if (!clientTxnId || clientTxnId.length > CORE_ATTACHMENT_CLIENT_TXN_ID_MAX) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: `clientTxnId must be 1-${CORE_ATTACHMENT_CLIENT_TXN_ID_MAX} characters.`,
			retryable: false,
		});
	}
}

function isRecordShape(value: unknown): value is AttachmentDraftRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<AttachmentDraftRecord>;
	if (typeof record.envelope !== "object" || record.envelope === null) return false;
	const envelope = record.envelope as Partial<AttachmentEnvelope>;
	return (
		envelope.formatVersion === 1 &&
		typeof envelope.id === "string" &&
		typeof envelope.sessionId === "string" &&
		typeof envelope.type === "string" &&
		typeof envelope.schemaVersion === "number" &&
		typeof envelope.revision === "number" &&
		(record.status === "ready" || record.status === "saving" || record.status === "error")
	);
}

export class CoreAttachmentDraftStore {
	private readonly storage: CoreAttachmentDraftStorage;
	private readonly sessionId: string;
	private readonly now: () => string;
	private readonly createId: () => string;
	private records: AttachmentDraftRecord[] = [];
	private acceptedTransactions = new Set<string>();
	readonly storageError: AttachmentError | undefined;

	constructor(storage: CoreAttachmentDraftStorage, sessionId: string, options?: CoreAttachmentDraftStoreOptions) {
		if (!sessionId) {
			throw new AttachmentDraftError({
				code: "ATT_ACCESS_DENIED",
				message: "Attachment drafts require a session id.",
				retryable: false,
			});
		}
		this.storage = storage;
		this.sessionId = sessionId;
		this.now = options?.now ?? (() => new Date().toISOString());
		this.createId =
			options?.createId ??
			(() => `att_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffffff).toString(36)}`);
		let storageError: AttachmentError | undefined;
		try {
			const raw = storage.readText(draftKey(sessionId));
			if (raw !== null) {
				const parsed: unknown = JSON.parse(raw);
				if (!Array.isArray(parsed) || !parsed.every(isRecordShape)) {
					throw new Error("Draft entry is not a draft record array.");
				}
				for (const record of parsed) {
					if (record.envelope.sessionId !== sessionId) {
						throw new Error("Draft entry contains a foreign session record.");
					}
				}
				this.records = parsed.map((record) => ({
					...cloneJson(record),
					status: record.status === "error" ? ("error" as const) : ("ready" as const),
				}));
			}
		} catch {
			this.records = [];
			storageError = {
				code: "ATT_STORAGE_FAILED",
				message: "Stored attachment drafts could not be loaded; starting empty.",
				retryable: false,
			};
		}
		this.storageError = storageError;
	}

	get boundSessionId(): string {
		return this.sessionId;
	}

	list(): AttachmentDraftRecord[] {
		return this.records.map((record) => cloneJson(record));
	}

	get(id: AttachmentId): AttachmentDraftRecord | undefined {
		const record = this.records.find((candidate) => candidate.envelope.id === id);
		return record ? cloneJson(record) : undefined;
	}

	async add(input: AttachmentInput): Promise<AttachmentId> {
		if (input.sessionId !== this.sessionId) {
			throw new AttachmentDraftError({
				code: "ATT_ACCESS_DENIED",
				message: "Attachment drafts belong to exactly one session.",
				retryable: false,
			});
		}
		if (!input.type) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Attachment drafts require a type.",
				retryable: false,
			});
		}
		assertJsonValue(input.payload, "Attachment payload");
		if (input.uiState !== undefined) assertJsonValue(input.uiState, "Attachment UI state");
		if (input.media !== undefined) assertValidMedia(input.media);
		const timestamp = this.now();
		const record: AttachmentDraftRecord = {
			envelope: {
				formatVersion: 1,
				id: this.createId() as AttachmentId,
				sessionId: this.sessionId,
				type: input.type,
				schemaVersion: input.schemaVersion,
				revision: 1 as AttachmentRevision,
				createdAt: timestamp,
				updatedAt: timestamp,
			},
			payload: cloneJson(input.payload),
			...(input.uiState !== undefined ? { uiState: cloneJson(input.uiState) } : {}),
			...(input.media !== undefined ? { media: { ...input.media } } : {}),
			status: "saving",
		};
		this.records.push(record);
		try {
			this.persist();
		} catch {
			record.status = "error";
			record.error = {
				code: "ATT_STORAGE_FAILED",
				message: "Attachment draft could not be stored; it is not reload-proof.",
				retryable: true,
			};
			throw new AttachmentDraftError(record.error);
		}
		record.status = "ready";
		return record.envelope.id;
	}

	async update(id: AttachmentId, expectedRevision: number, next: AttachmentEditableState): Promise<void> {
		const record = this.records.find((candidate) => candidate.envelope.id === id);
		if (!record || record.envelope.revision !== expectedRevision) {
			throw new AttachmentDraftError({
				code: "ATT_STALE_REVISION",
				message: record
					? `Attachment ${id} is at revision ${record.envelope.revision}, not ${expectedRevision}.`
					: `Attachment ${id} is unknown in this session.`,
				retryable: false,
			});
		}
		const touchesPayload = next.payload !== undefined;
		if (touchesPayload) assertJsonValue(next.payload, "Attachment payload");
		if (next.uiState !== undefined) assertJsonValue(next.uiState, "Attachment UI state");
		if (touchesPayload) {
			record.payload = cloneJson(next.payload);
			record.envelope.revision = (record.envelope.revision + 1) as AttachmentRevision;
		}
		if (next.uiState !== undefined) record.uiState = cloneJson(next.uiState);
		record.envelope.updatedAt = this.now();
		record.status = "saving";
		try {
			this.persist();
		} catch {
			record.status = "error";
			record.error = {
				code: "ATT_STORAGE_FAILED",
				message: "Attachment draft change could not be stored.",
				retryable: true,
			};
			throw new AttachmentDraftError(record.error);
		}
		record.status = "ready";
		delete record.error;
	}

	async remove(id: AttachmentId): Promise<void> {
		const index = this.records.findIndex((candidate) => candidate.envelope.id === id);
		if (index === -1) return;
		const [removed] = this.records.splice(index, 1);
		try {
			this.persist();
		} catch {
			this.records.splice(index, 0, removed);
			throw new AttachmentDraftError({
				code: "ATT_STORAGE_FAILED",
				message: "Attachment removal could not be stored.",
				retryable: true,
			});
		}
	}

	freezeForSend(clientTxnId: string, text: string): AttachmentSendSnapshot {
		assertValidClientTxnId(clientTxnId);
		if (this.acceptedTransactions.has(clientTxnId)) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Accepted transaction ids are never frozen again with new content.",
				retryable: false,
			});
		}
		const blocked = this.records.filter((record) => record.status !== "ready");
		if (blocked.length > 0) {
			throw new AttachmentDraftError({
				code: "ATT_MATERIALIZE_FAILED",
				message: `Attachments not ready for send: ${blocked.map((record) => record.envelope.id).join(", ")}.`,
				retryable: true,
			});
		}
		return {
			clientTxnId: clientTxnId as ClientTxnId,
			sessionId: this.sessionId,
			text,
			frozenAt: this.now(),
			attachments: this.records.map((record) => ({
				id: record.envelope.id,
				revision: record.envelope.revision,
				type: record.envelope.type,
				schemaVersion: record.envelope.schemaVersion,
				payload: cloneJson(record.payload),
				...(record.media !== undefined ? { media: { ...record.media } } : {}),
			})),
		};
	}

	applyAcceptance(snapshot: AttachmentSendSnapshot, receipt: AttachmentAcceptanceReceipt): AttachmentAcceptanceResult {
		if (receipt.clientTxnId !== snapshot.clientTxnId || snapshot.sessionId !== this.sessionId) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Receipt does not match this send snapshot.",
				retryable: true,
			});
		}
		if (this.acceptedTransactions.has(snapshot.clientTxnId)) {
			return { consumed: [], duplicate: true };
		}
		if (!receipt.accepted) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Acceptance is unknown; reconcile the receipt and retry unchanged.",
				retryable: true,
			});
		}
		const consumed: AttachmentId[] = [];
		this.records = this.records.filter((record) => {
			const frozen = snapshot.attachments.find((candidate) => candidate.id === record.envelope.id);
			if (frozen && frozen.revision === record.envelope.revision) {
				consumed.push(record.envelope.id);
				return false;
			}
			return true;
		});
		this.acceptedTransactions.add(snapshot.clientTxnId);
		try {
			this.persist();
		} catch {
			throw new AttachmentDraftError({
				code: "ATT_STORAGE_FAILED",
				message: "Acceptance was recorded but the remaining drafts could not be stored.",
				retryable: true,
			});
		}
		return { consumed, duplicate: false };
	}

	private persist(): void {
		this.storage.writeText(draftKey(this.sessionId), JSON.stringify(this.records));
	}
}
