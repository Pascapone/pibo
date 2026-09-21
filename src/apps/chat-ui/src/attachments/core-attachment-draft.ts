/**
 * Private Core attachment draft pilot (D1, NOT a finished public SDK export).
 *
 * Owns the session-bound draft side of K07-v0: add/update/remove with revision
 * compare-and-swap, reload-proof persistence through an injected storage
 * adapter, send snapshots frozen to a normalized clientTxnId, and controlled
 * acceptance that consumes only the frozen revisions.
 *
 * Storage model (single versioned state object, formatVersion 1, at the
 * existing key `pibo.chat.coreAttachments.draft.<sessionId>`): records plus
 * open-transaction bindings plus accepted transaction ids live in ONE
 * serialized object. Every mutation builds a complete validated candidate,
 * writes it with a SINGLE synchronous writeText, and only then publishes the
 * RAM state. A failed write leaves RAM exactly as before; recovery is simply
 * "heal, then retry the same call". RAM always holds the last persisted-good
 * state, so stored record status is always "ready" and no "saving" state is
 * ever persisted. Legacy bare-array entries (format 0) are adopted by a
 * tested compat reader; historic acceptances in that form are unknown and are
 * NOT invented. The storage seam is assumed to replace the full entry text on
 * success and to throw without partial effects on failure; multi-tab /
 * multi-process compare-and-swap is explicitly NOT provided (D2).
 *
 * Transaction rules: a normalized clientTxnId binds EXACTLY one internally
 * held original send snapshot (text plus ordered id/revision/type/schema/
 * JSON/media). Re-freezing the same id with identical send value is idempotent
 * (same original, same frozenAt, no extra write); a changed send value under
 * the same id is rejected. Caller-passed snapshots are validated for shape
 * and must match the bound original; forged or mutated objects never consume.
 * Accepted ids are persisted reload-proof and are never frozen again. Routine
 * duplicate handling on the accepted path consumes nothing.
 *
 * Pilot boundaries (pending RV-02/05/07 agreement with B/C, not wired to any
 * production composer, provider, or SDK surface yet): media holds an
 * UNRESOLVED draftResourceId reference (metadata round-trip only; byte
 * storage, resolvability, and preview regeneration are deferred to the B/C
 * resource decision). Text is opaque to the draft; server text requirements
 * apply at composition. Unknown attachment id on update behaves as
 * ATT_STALE_REVISION (no separate not-found code exists in K07-v0). remove()
 * is idempotent. Payload changes bump the revision; uiState-only changes
 * persist without bumping (presentation state is not model payload).
 * Attachment ids are never reused while live or referenced by an open
 * transaction; reissue after acceptance is allowed and harmless because
 * consumption only flows through open-transaction match plus revision
 * equality. Corrupt or foreign entries fail closed (empty draft plus a named
 * storageError); per-record quarantine is D2.
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

export type CoreAttachmentDraftPersistedState = {
	formatVersion: 1;
	sessionId: string;
	records: AttachmentDraftRecord[];
	openTransactions: Record<string, AttachmentSendSnapshot>;
	acceptedTransactions: string[];
};

export type CoreAttachmentDraftStoreOptions = {
	now?: () => string;
	createId?: () => string;
};

export const CORE_ATTACHMENT_DRAFT_STATE_VERSION = 1;
export const CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX = "pibo.chat.coreAttachments.draft.";
export const CORE_ATTACHMENT_CLIENT_TXN_ID_MAX = 160;
const CORE_ATTACHMENT_ADD_ID_ATTEMPTS = 5;

/**
 * Local clientTxnId normalizer. Must mirror the server oracle
 * normalizeClientTxnId (trim, then non-empty, then 160-char limit) and is
 * conformance-tested against it. Boundary difference: the server field is
 * optional (undefined passes through), the pilot always requires an id.
 */
export function normalizeDraftClientTxnId(value: unknown): string {
	if (typeof value !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "clientTxnId must be a string.",
			retryable: false,
		});
	}
	const id = value.trim();
	if (!id) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "clientTxnId must be a non-empty string.",
			retryable: false,
		});
	}
	if (id.length > CORE_ATTACHMENT_CLIENT_TXN_ID_MAX) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "clientTxnId is too long.",
			retryable: false,
		});
	}
	return id;
}

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
	if (!media || typeof media !== "object") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Media attachments must be objects.",
			retryable: false,
		});
	}
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

function assertValidEnvelopeInput(type: unknown, schemaVersion: unknown): asserts type is string {
	if (!type || typeof type !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Attachment drafts require a non-empty string type.",
			retryable: false,
		});
	}
	if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 0) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Attachment schemaVersion must be a finite integer >= 0.",
			retryable: false,
		});
	}
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validateStoredRecord(value: unknown, sessionId: string, index: number): AttachmentDraftRecord {
	const label = `record ${index}`;
	if (typeof value !== "object" || value === null) throw new Error(`${label} is not an object.`);
	const record = value as Partial<AttachmentDraftRecord>;
	const envelope = record.envelope as Partial<AttachmentEnvelope> | undefined;
	if (!envelope || typeof envelope !== "object") throw new Error(`${label} has no envelope.`);
	if (envelope.formatVersion !== 1) throw new Error(`${label} has unsupported envelope formatVersion.`);
	if (!nonEmptyString(envelope.id)) throw new Error(`${label} has no string id.`);
	if (envelope.sessionId !== sessionId) throw new Error(`${label} belongs to a foreign session.`);
	if (!nonEmptyString(envelope.type)) throw new Error(`${label} has no string type.`);
	if (!Number.isInteger(envelope.schemaVersion) || (envelope.schemaVersion as number) < 0) {
		throw new Error(`${label} has invalid schemaVersion.`);
	}
	if (!Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 1) {
		throw new Error(`${label} has invalid revision.`);
	}
	if (!nonEmptyString(envelope.createdAt) || !nonEmptyString(envelope.updatedAt)) {
		throw new Error(`${label} has invalid timestamps.`);
	}
	if (record.status !== "ready" && record.status !== "saving" && record.status !== "error") {
		throw new Error(`${label} has invalid status.`);
	}
	if (record.status === "error") throw new Error(`${label} carries an unconfirmed error status.`);
	try {
		assertJsonValue(record.payload, `${label} payload`);
		if (record.uiState !== undefined) assertJsonValue(record.uiState, `${label} UI state`);
		if (record.media !== undefined) assertValidMedia(record.media);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : `${label} is invalid.`);
	}
	return {
		envelope: {
			formatVersion: 1,
			id: envelope.id as AttachmentId,
			sessionId,
			type: envelope.type,
			schemaVersion: envelope.schemaVersion as number,
			revision: envelope.revision as AttachmentRevision,
			createdAt: envelope.createdAt,
			updatedAt: envelope.updatedAt,
		},
		payload: cloneJson(record.payload),
		...(record.uiState !== undefined ? { uiState: cloneJson(record.uiState) } : {}),
		...(record.media !== undefined ? { media: { ...record.media } } : {}),
		status: "ready",
	};
}

function validateSnapshotShape(value: unknown): AttachmentSendSnapshot {
	if (typeof value !== "object" || value === null) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Send snapshots must be objects.",
			retryable: false,
		});
	}
	const snapshot = value as Partial<AttachmentSendSnapshot>;
	if (typeof snapshot.clientTxnId !== "string" || typeof snapshot.sessionId !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Send snapshots require string clientTxnId and sessionId.",
			retryable: false,
		});
	}
	if (typeof snapshot.text !== "string" || typeof snapshot.frozenAt !== "string") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Send snapshots require string text and frozenAt.",
			retryable: false,
		});
	}
	if (!Array.isArray(snapshot.attachments)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Send snapshots require an attachments array.",
			retryable: false,
		});
	}
	for (const [index, entry] of snapshot.attachments.entries()) {
		const candidate = entry as Partial<FrozenAttachment> | undefined;
		if (!candidate || typeof candidate !== "object") {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: `Snapshot attachment ${index} is not an object.`,
				retryable: false,
			});
		}
		if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.type)) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: `Snapshot attachment ${index} requires string id and type.`,
				retryable: false,
			});
		}
		if (!Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 1) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: `Snapshot attachment ${index} has invalid revision.`,
				retryable: false,
			});
		}
		if (!Number.isInteger(candidate.schemaVersion) || (candidate.schemaVersion as number) < 0) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: `Snapshot attachment ${index} has invalid schemaVersion.`,
				retryable: false,
			});
		}
		assertJsonValue(candidate.payload, `Snapshot attachment ${index} payload`);
		if (candidate.media !== undefined) assertValidMedia(candidate.media);
	}
	return snapshot as AttachmentSendSnapshot;
}

function validateReceiptShape(value: unknown): { clientTxnId: string; accepted: boolean } {
	if (typeof value !== "object" || value === null) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Acceptance receipts must be objects.",
			retryable: false,
		});
	}
	const receipt = value as Partial<AttachmentAcceptanceReceipt>;
	if (typeof receipt.accepted !== "boolean") {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Acceptance receipts require a boolean accepted flag.",
			retryable: false,
		});
	}
	return { clientTxnId: normalizeDraftClientTxnId(receipt.clientTxnId), accepted: receipt.accepted };
}

function canonicalSendValue(text: string, attachments: FrozenAttachment[]): string {
	return JSON.stringify({
		text,
		attachments: attachments.map((entry) => ({
			id: entry.id,
			revision: entry.revision,
			type: entry.type,
			schemaVersion: entry.schemaVersion,
			payload: entry.payload,
			media: entry.media ?? null,
		})),
	});
}

function canonicalSnapshot(snapshot: AttachmentSendSnapshot): string {
	return JSON.stringify({
		clientTxnId: snapshot.clientTxnId,
		sessionId: snapshot.sessionId,
		text: snapshot.text,
		frozenAt: snapshot.frozenAt,
		attachments: JSON.parse(canonicalSendValue(snapshot.text, snapshot.attachments)) as unknown,
	});
}

type DraftStateCandidate = {
	records: AttachmentDraftRecord[];
	openTransactions: Map<string, AttachmentSendSnapshot>;
	acceptedTransactions: Set<string>;
};

export class CoreAttachmentDraftStore {
	private readonly storage: CoreAttachmentDraftStorage;
	private readonly sessionId: string;
	private readonly now: () => string;
	private readonly createId: () => string;
	private records: AttachmentDraftRecord[] = [];
	private openTransactions = new Map<string, AttachmentSendSnapshot>();
	private acceptedTransactions = new Set<string>();
	storageError: AttachmentError | undefined;

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
		try {
			const loaded = this.load(draftKey(sessionId));
			this.records = loaded.records;
			this.openTransactions = loaded.openTransactions;
			this.acceptedTransactions = loaded.acceptedTransactions;
		} catch (error) {
			this.records = [];
			this.openTransactions = new Map();
			this.acceptedTransactions = new Set();
			this.storageError = {
				code: "ATT_STORAGE_FAILED",
				message: `Stored attachment drafts could not be loaded: ${error instanceof Error ? error.message : "unknown cause"}`,
				retryable: false,
			};
		}
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
		assertValidEnvelopeInput(input.type, input.schemaVersion);
		assertJsonValue(input.payload, "Attachment payload");
		if (input.uiState !== undefined) assertJsonValue(input.uiState, "Attachment UI state");
		if (input.media !== undefined) assertValidMedia(input.media);
		const reserved = new Set<string>(this.records.map((record) => record.envelope.id));
		for (const snapshot of this.openTransactions.values()) {
			for (const entry of snapshot.attachments) reserved.add(entry.id);
		}
		let id = "";
		let attempts = 0;
		do {
			id = this.createId();
			attempts += 1;
		} while (reserved.has(id) && attempts < CORE_ATTACHMENT_ADD_ID_ATTEMPTS);
		if (reserved.has(id)) {
			throw new AttachmentDraftError({
				code: "ATT_STORAGE_FAILED",
				message: "Attachment id generator produced only duplicate ids.",
				retryable: true,
			});
		}
		const timestamp = this.now();
		const record: AttachmentDraftRecord = {
			envelope: {
				formatVersion: 1,
				id: id as AttachmentId,
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
			status: "ready",
		};
		this.commit({ records: [...this.records, record], openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions }, "Attachment draft could not be stored; it is not reload-proof.");
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
		if (next.payload === undefined && next.uiState === undefined) return;
		const touchesPayload = next.payload !== undefined;
		if (touchesPayload) assertJsonValue(next.payload, "Attachment payload");
		if (next.uiState !== undefined) assertJsonValue(next.uiState, "Attachment UI state");
		const candidate: AttachmentDraftRecord = {
			...cloneJson(record),
			payload: touchesPayload ? cloneJson(next.payload) : cloneJson(record.payload),
			...(next.uiState !== undefined || record.uiState !== undefined
				? { uiState: cloneJson(next.uiState !== undefined ? next.uiState : record.uiState) }
				: {}),
			envelope: {
				...record.envelope,
				revision: (touchesPayload ? record.envelope.revision + 1 : record.envelope.revision) as AttachmentRevision,
				updatedAt: this.now(),
			},
			status: "ready",
		};
		if (candidate.uiState === undefined) delete candidate.uiState;
		this.commit(
			{
				records: this.records.map((entry) => (entry.envelope.id === id ? candidate : entry)),
				openTransactions: this.openTransactions,
				acceptedTransactions: this.acceptedTransactions,
			},
			"Attachment draft change could not be stored.",
		);
	}

	async remove(id: AttachmentId): Promise<void> {
		if (!this.records.some((candidate) => candidate.envelope.id === id)) return;
		this.commit(
			{
				records: this.records.filter((candidate) => candidate.envelope.id !== id),
				openTransactions: this.openTransactions,
				acceptedTransactions: this.acceptedTransactions,
			},
			"Attachment removal could not be stored.",
		);
	}

	freezeForSend(clientTxnId: string, text: string): AttachmentSendSnapshot {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		if (this.acceptedTransactions.has(txn)) {
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
		const attachments: FrozenAttachment[] = this.records.map((record) => ({
			id: record.envelope.id,
			revision: record.envelope.revision,
			type: record.envelope.type,
			schemaVersion: record.envelope.schemaVersion,
			payload: cloneJson(record.payload),
			...(record.media !== undefined ? { media: { ...record.media } } : {}),
		}));
		const sendValue = canonicalSendValue(text, attachments);
		const bound = this.openTransactions.get(txn);
		if (bound) {
			if (canonicalSendValue(bound.text, bound.attachments) === sendValue) return cloneJson(bound);
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Transaction id is already bound to a different send value.",
				retryable: false,
			});
		}
		const snapshot: AttachmentSendSnapshot = {
			clientTxnId: txn as ClientTxnId,
			sessionId: this.sessionId,
			text,
			frozenAt: this.now(),
			attachments,
		};
		const openTransactions = new Map(this.openTransactions);
		openTransactions.set(txn, snapshot);
		this.commit(
			{ records: this.records, openTransactions, acceptedTransactions: this.acceptedTransactions },
			"Send snapshot could not be stored; the transaction was not bound.",
		);
		return cloneJson(snapshot);
	}

	applyAcceptance(snapshot: AttachmentSendSnapshot, receipt: AttachmentAcceptanceReceipt): AttachmentAcceptanceResult {
		const checkedReceipt = validateReceiptShape(receipt);
		const checkedSnapshot = validateSnapshotShape(snapshot);
		if (checkedSnapshot.sessionId !== this.sessionId) {
			throw new AttachmentDraftError({
				code: "ATT_ACCESS_DENIED",
				message: "Send snapshots belong to exactly one session.",
				retryable: false,
			});
		}
		if (normalizeDraftClientTxnId(checkedSnapshot.clientTxnId) !== checkedReceipt.clientTxnId) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Receipt does not match this send snapshot.",
				retryable: true,
			});
		}
		const bound = this.openTransactions.get(checkedReceipt.clientTxnId);
		if (!bound) {
			if (this.acceptedTransactions.has(checkedReceipt.clientTxnId)) return { consumed: [], duplicate: true };
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Transaction was never frozen in this session.",
				retryable: true,
			});
		}
		if (canonicalSnapshot(checkedSnapshot) !== canonicalSnapshot(bound)) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Snapshot does not match the bound original send.",
				retryable: false,
			});
		}
		if (!checkedReceipt.accepted) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Acceptance is unknown; reconcile the receipt and retry unchanged.",
				retryable: true,
			});
		}
		const consumed: AttachmentId[] = [];
		const remaining = this.records.filter((record) => {
			const frozen = bound.attachments.find((candidate) => candidate.id === record.envelope.id);
			if (frozen && frozen.revision === record.envelope.revision) {
				consumed.push(record.envelope.id);
				return false;
			}
			return true;
		});
		const openTransactions = new Map(this.openTransactions);
		openTransactions.delete(checkedReceipt.clientTxnId);
		const acceptedTransactions = new Set(this.acceptedTransactions);
		acceptedTransactions.add(checkedReceipt.clientTxnId);
		this.commit(
			{ records: remaining, openTransactions, acceptedTransactions },
			"Acceptance could not be stored; nothing was consumed.",
		);
		return { consumed, duplicate: false };
	}

	private load(key: string): DraftStateCandidate {
		const raw = this.storage.readText(key);
		if (raw === null) {
			return { records: [], openTransactions: new Map(), acceptedTransactions: new Set() };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error("entry is not valid JSON.");
		}
		if (Array.isArray(parsed)) {
			return {
				records: this.validateRecordArray(parsed),
				openTransactions: new Map(),
				acceptedTransactions: new Set(),
			};
		}
		if (typeof parsed !== "object" || parsed === null) throw new Error("unsupported stored draft format.");
		const state = parsed as Partial<CoreAttachmentDraftPersistedState>;
		if (state.formatVersion !== CORE_ATTACHMENT_DRAFT_STATE_VERSION) {
			throw new Error(`unsupported stored draft formatVersion ${String(state.formatVersion)}.`);
		}
		if (state.sessionId !== this.sessionId) throw new Error("stored state belongs to a foreign session.");
		if (!Array.isArray(state.records)) throw new Error("stored state has no records array.");
		if (typeof state.openTransactions !== "object" || state.openTransactions === null || Array.isArray(state.openTransactions)) {
			throw new Error("stored state has no open-transactions object.");
		}
		if (!Array.isArray(state.acceptedTransactions)) throw new Error("stored state has no accepted-transactions array.");
		const records = this.validateRecordArray(state.records);
		const openTransactions = new Map<string, AttachmentSendSnapshot>();
		for (const [keyName, entry] of Object.entries(state.openTransactions)) {
			let checked: AttachmentSendSnapshot;
			try {
				checked = validateSnapshotShape(entry);
			} catch (error) {
				throw new Error(`stored open transaction is invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
			}
			if (checked.sessionId !== this.sessionId) throw new Error("stored open transaction belongs to a foreign session.");
			let normalizedKey: string;
			try {
				normalizedKey = normalizeDraftClientTxnId(checked.clientTxnId);
			} catch {
				throw new Error("stored open transaction has an invalid id.");
			}
			if (keyName !== normalizedKey) throw new Error("stored open transaction key mismatches its snapshot.");
			openTransactions.set(keyName, {
				clientTxnId: keyName as ClientTxnId,
				sessionId: this.sessionId,
				text: checked.text,
				frozenAt: checked.frozenAt,
				attachments: cloneJson(checked.attachments),
			});
		}
		const acceptedTransactions = new Set<string>();
		for (const entry of state.acceptedTransactions) {
			if (typeof entry !== "string" || entry !== entry.trim() || entry.length === 0 || entry.length > CORE_ATTACHMENT_CLIENT_TXN_ID_MAX) {
				throw new Error("stored accepted transaction id is invalid.");
			}
			if (acceptedTransactions.has(entry) || openTransactions.has(entry)) {
				throw new Error("stored accepted transaction id is duplicated or still open.");
			}
			acceptedTransactions.add(entry);
		}
		return { records, openTransactions, acceptedTransactions };
	}

	private validateRecordArray(entries: unknown[]): AttachmentDraftRecord[] {
		const records = entries.map((entry, index) => validateStoredRecord(entry, this.sessionId, index));
		const ids = new Set<string>();
		for (const record of records) {
			if (ids.has(record.envelope.id)) throw new Error(`duplicate attachment id ${record.envelope.id}.`);
			ids.add(record.envelope.id);
		}
		return records;
	}

	private commit(candidate: DraftStateCandidate, failureMessage: string): void {
		const text = JSON.stringify({
			formatVersion: CORE_ATTACHMENT_DRAFT_STATE_VERSION,
			sessionId: this.sessionId,
			records: candidate.records,
			openTransactions: Object.fromEntries(candidate.openTransactions),
			acceptedTransactions: [...candidate.acceptedTransactions],
		} satisfies CoreAttachmentDraftPersistedState);
		try {
			this.storage.writeText(draftKey(this.sessionId), text);
		} catch {
			const failure: AttachmentError = { code: "ATT_STORAGE_FAILED", message: failureMessage, retryable: true };
			this.storageError = failure;
			throw new AttachmentDraftError(failure);
		}
		this.records = candidate.records;
		this.openTransactions = candidate.openTransactions;
		this.acceptedTransactions = candidate.acceptedTransactions;
		this.storageError = undefined;
	}
}
