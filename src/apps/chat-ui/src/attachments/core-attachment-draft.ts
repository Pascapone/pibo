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
 * Media is plural per record/snapshot (several resources per attachment are
 * normal); legacy single-object media keeps loading via normalization.
 * Uploads prepared at send freeze are persisted per open transaction and
 * reused by retries; acceptance drops them. `writerEpoch` names the writing
 * instance for future multi-tab conflict work (written, v1-ignored).
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
 *
 * Writer/loader self-consistency (R2): no successful write may produce a
 * state the loader rejects. Freeze text must be a string (empty stays allowed
 * and opaque); clock results and generated ids must be non-empty strings
 * exactly as the loader requires (no ISO/date or id-service rules added).
 * Violations fail with ATT_INVALID_JSON before any write, RAM, or transaction
 * change. Null/array/mistyped add/update inputs are rejected the same way;
 * addressing (unknown/stale) is still checked first.
 *
 * JSON boundary (R2): structural checks run on an iterative walker with
 * active-ancestor cycle detection — shared acyclic references are valid,
 * true cycles fail with ATT_INVALID_JSON. No global depth cap is imposed;
 * clone, canonicalization, and commit serialization each fail controlled as
 * ATT_INVALID_JSON instead, strictly before any storage write (storage
 * failures keep their own ATT_STORAGE_FAILED contract).
 */

import {
	AttachmentDraftError,
	type AttachmentError,
	type AttachmentErrorCode,
} from "../../../../attachments/errors.js";

import { isPlainJsonObject, invalidJson, assertJsonValue, toJsonText, cloneJson } from "../../../../attachments/json.js";

import {
	captureMessageRequestBody, createMessageContentBinding, sameMessageContentBinding,
	type MessageContentBinding, type MessageRequestBody,
} from "../../../../shared/message-content-binding.js";

export { AttachmentDraftError };
export type { AttachmentError, AttachmentErrorCode };

export type AttachmentId = string & { readonly brand: "AttachmentId" };
export type AttachmentRevision = number & { readonly brand: "AttachmentRevision" };
export type ClientTxnId = string & { readonly brand: "ClientTxnId" };

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
	media?: AttachmentDraftMedia[];
	status: "saving" | "ready" | "error";
	error?: AttachmentError;
};

export type AttachmentInput = {
	sessionId: string;
	type: string;
	schemaVersion: number;
	payload: unknown;
	uiState?: unknown;
	media?: AttachmentDraftMedia | AttachmentDraftMedia[];
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
	media?: AttachmentDraftMedia[];
};

/**
 * One upload prepared at send freeze. `path` is an OPAQUE provider-scoped
 * handle, never a trusted filesystem path: only URL-safe relative tokens
 * (no leading `/`, no traversal, no separators outside `/`) are accepted,
 * and the core never joins it to a filesystem location.
 */
export type K07PreparedUpload = {
	blobId: string;
	path: string;
	bytes: number;
	mimeType: string;
};

/** Legacy POST echo, retained for readability; never sufficient to consume. */
export type K07AdmissionProof = {
	fingerprint: string;
	receiptId: string;
};

/** Locally captured BEFORE POST; retries resend this exact JSON body. */
export type AttachmentPreparedSubmission = {
	body: MessageRequestBody;
	contentBinding: MessageContentBinding;
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
	writerEpoch: string;
	preparedUploads: Record<string, K07PreparedUpload[]>;
	admissionProofs: Record<string, K07AdmissionProof>;
	preparedSubmissions: Record<string, AttachmentPreparedSubmission>;
};

export type CoreAttachmentDraftStoreOptions = {
	now?: () => string;
	createId?: () => string;
};

/** Data-only synchronous transitions for transaction-local storage adapters.
 * Network work and provider hooks must finish before constructing a command. */
export type CoreAttachmentDraftCommand =
	| { kind: "add"; input: AttachmentInput }
	| { kind: "update"; id: AttachmentId; expectedRevision: number; next: AttachmentEditableState }
	| { kind: "remove"; id: AttachmentId }
	| { kind: "freeze"; clientTxnId: string; text: string }
	| { kind: "accept"; snapshot: AttachmentSendSnapshot; receipt: AttachmentAcceptanceReceipt }
	| { kind: "prepare"; snapshot: AttachmentSendSnapshot; body: unknown }
	| { kind: "uploads"; clientTxnId: string; uploads: K07PreparedUpload[] }
	| { kind: "legacyProof"; clientTxnId: string; proof: K07AdmissionProof };

export type CoreAttachmentDraftCommandResult<C extends CoreAttachmentDraftCommand> =
	C extends { kind: "add" } ? AttachmentId
	: C extends { kind: "freeze" } ? AttachmentSendSnapshot
	: C extends { kind: "accept" } ? AttachmentAcceptanceResult
	: C extends { kind: "prepare" } ? AttachmentPreparedSubmission
	: void;

export type CoreAttachmentDraftView = {
	records: AttachmentDraftRecord[];
	openSnapshots: AttachmentSendSnapshot[];
	acceptedTransactions: string[];
	preparedUploads: Record<string, K07PreparedUpload[]>;
	preparedSubmissions: Record<string, AttachmentPreparedSubmission>;
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

/**
 * Media is plural in v1 (annotation screenshots/files need several resources).
 * A single object is accepted as legacy input/storage form and normalized to
 * a one-entry array, so already stored drafts keep loading unchanged.
 */
function normalizeMediaInput(value: unknown): AttachmentDraftMedia[] | undefined {
	if (value === undefined) return undefined;
	const entries = Array.isArray(value) ? value : [value];
	for (const entry of entries) assertValidMedia(entry as AttachmentDraftMedia);
	return entries.map((entry) => ({ ...(entry as AttachmentDraftMedia) }));
}

function assertValidPreparedUpload(upload: K07PreparedUpload): K07PreparedUpload {
	if (!upload || typeof upload !== "object" || Array.isArray(upload)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Prepared uploads must be objects.",
			retryable: false,
		});
	}
	if (!isSafePreparedBlobId(upload.blobId) || !nonEmptyString(upload.mimeType)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Prepared uploads require a URL-safe blobId string and a mimeType string.",
			retryable: false,
		});
	}
	if (!isSafePreparedPath(upload.path)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Prepared upload paths must be URL-safe relative tokens without traversal.",
			retryable: false,
		});
	}
	if (!Number.isInteger(upload.bytes) || upload.bytes < 0) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Prepared upload byte size must be a non-negative integer.",
			retryable: false,
		});
	}
	return { blobId: upload.blobId, path: upload.path, bytes: upload.bytes, mimeType: upload.mimeType };
}

function validateStoredPreparedUpload(upload: unknown, txnId: string): K07PreparedUpload {
	try {
		return assertValidPreparedUpload(upload as K07PreparedUpload);
	} catch (error) {
		throw new Error(`stored prepared uploads for ${txnId} are invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
	}
}

function assertValidAdmissionProof(proof: K07AdmissionProof): K07AdmissionProof {
	if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Admission proofs must be objects.",
			retryable: false,
		});
	}
	if (!nonEmptyString(proof.fingerprint) || !nonEmptyString(proof.receiptId)) {
		throw new AttachmentDraftError({
			code: "ATT_INVALID_JSON",
			message: "Admission proofs require string fingerprint and receiptId.",
			retryable: false,
		});
	}
	return { fingerprint: proof.fingerprint, receiptId: proof.receiptId };
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

/** I-K07-REVIEW-01 F1 / I-K07-DECISION-01 §1: ids and paths are JSON- and URL-safe. */
function isSafePreparedBlobId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[^\s/?#\\]+$/.test(value);
}

function isSafePreparedPath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
	if (value.startsWith("/") || value.includes("\\")) return false;
	const segments = value.split("/");
	return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
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
	let media: AttachmentDraftMedia[] | undefined;
	try {
		assertJsonValue(record.payload, `${label} payload`);
		if (record.uiState !== undefined) assertJsonValue(record.uiState, `${label} UI state`);
		media = normalizeMediaInput(record.media);
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
		...(media !== undefined ? { media } : {}),
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
	const attachments: FrozenAttachment[] = [];
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
		const media = normalizeMediaInput(candidate.media);
		attachments.push({
			id: candidate.id as AttachmentId,
			revision: candidate.revision as AttachmentRevision,
			type: candidate.type as string,
			schemaVersion: candidate.schemaVersion as number,
			payload: cloneJson(candidate.payload),
			...(media !== undefined ? { media } : {}),
		});
	}
	return {
		clientTxnId: snapshot.clientTxnId as ClientTxnId,
		sessionId: snapshot.sessionId as string,
		text: snapshot.text as string,
		frozenAt: snapshot.frozenAt as string,
		attachments,
	};
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

function canonicalSendStructure(text: string, attachments: FrozenAttachment[]): unknown {
	return {
		text,
		attachments: attachments.map((entry) => ({
			id: entry.id,
			revision: entry.revision,
			type: entry.type,
			schemaVersion: entry.schemaVersion,
			payload: entry.payload,
			media: entry.media ?? null,
		})),
	};
}

function canonicalSendValue(text: string, attachments: FrozenAttachment[]): string {
	return toJsonText(canonicalSendStructure(text, attachments), "Send value");
}

function canonicalSnapshot(snapshot: AttachmentSendSnapshot): string {
	return toJsonText(
		{
			clientTxnId: snapshot.clientTxnId,
			sessionId: snapshot.sessionId,
			text: snapshot.text,
			frozenAt: snapshot.frozenAt,
			send: canonicalSendStructure(snapshot.text, snapshot.attachments),
		},
		"Send snapshot",
	);
}

function prepareSnapshotSubmission(snapshot: AttachmentSendSnapshot, value: unknown): AttachmentPreparedSubmission {
	let body: MessageRequestBody;
	try { body = captureMessageRequestBody(value); }
	catch { throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Submission must be a JSON body.", retryable: false }); }
	const submitted = validateSnapshotShape({ ...snapshot, text: body.text, attachments: body.attachments });
	if (body.piboSessionId !== snapshot.sessionId || body.clientTxnId !== snapshot.clientTxnId
		|| canonicalSendValue(submitted.text, submitted.attachments) !== canonicalSendValue(snapshot.text, snapshot.attachments)) {
		throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Submission does not contain the frozen transaction, text and attachment revisions.", retryable: false });
	}
	try {
		const delivery = body.delivery === undefined ? "queue" : body.delivery;
		return { body, contentBinding: createMessageContentBinding({ sessionId: snapshot.sessionId, delivery: delivery as "queue" | "steer", body }) };
	} catch {
		throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Submission requires durable content binding and a valid delivery mode.", retryable: false });
	}
}

type DraftStateCandidate = {
	records: AttachmentDraftRecord[];
	openTransactions: Map<string, AttachmentSendSnapshot>;
	acceptedTransactions: Set<string>;
	preparedUploads: Map<string, K07PreparedUpload[]>;
	admissionProofs: Map<string, K07AdmissionProof>;
	preparedSubmissions?: Map<string, AttachmentPreparedSubmission>;
};

export class CoreAttachmentDraftStore {
	private readonly storage: CoreAttachmentDraftStorage;
	private readonly sessionId: string;
	private readonly now: () => string;
	private readonly createId: () => string;
	private records: AttachmentDraftRecord[] = [];
	private openTransactions = new Map<string, AttachmentSendSnapshot>();
	private acceptedTransactions = new Set<string>();
	private preparedUploads = new Map<string, K07PreparedUpload[]>();
	private admissionProofs = new Map<string, K07AdmissionProof>();
	private preparedSubmissions = new Map<string, AttachmentPreparedSubmission>();
	private readonly writerEpoch: string;
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
		this.writerEpoch = `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
		try {
			const loaded = this.load(draftKey(sessionId));
			this.records = loaded.records;
			this.openTransactions = loaded.openTransactions;
			this.acceptedTransactions = loaded.acceptedTransactions;
			this.preparedUploads = loaded.preparedUploads;
			this.admissionProofs = loaded.admissionProofs;
			this.preparedSubmissions = loaded.preparedSubmissions ?? new Map();
		} catch (error) {
			this.records = [];
			this.openTransactions = new Map();
			this.acceptedTransactions = new Set();
			this.preparedUploads = new Map();
			this.admissionProofs = new Map();
			this.preparedSubmissions = new Map();
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

	/** Detached read view; never exposes the engine held by a transaction. */
	view(): CoreAttachmentDraftView {
		return cloneJson({
			records: this.records,
			openSnapshots: [...this.openTransactions.values()],
			acceptedTransactions: [...this.acceptedTransactions],
			preparedUploads: Object.fromEntries(this.preparedUploads),
			preparedSubmissions: Object.fromEntries(this.preparedSubmissions),
		});
	}

	executeCommand<C extends CoreAttachmentDraftCommand>(command: C): CoreAttachmentDraftCommandResult<C>;
	executeCommand(command: CoreAttachmentDraftCommand): CoreAttachmentDraftCommandResult<CoreAttachmentDraftCommand> {
		if (!command || typeof command !== "object" || Array.isArray(command)) throw invalidJson("Draft command must be an object.");
		switch (command.kind) {
			case "add": return this.addSync(command.input);
			case "update": return this.updateSync(command.id, command.expectedRevision, command.next);
			case "remove": return this.removeSync(command.id);
			case "freeze": return this.freezeForSend(command.clientTxnId, command.text);
			case "accept": return this.applyAcceptance(command.snapshot, command.receipt);
			case "prepare": return this.prepareSubmission(command.snapshot, command.body);
			case "uploads": return this.setPreparedUploads(command.clientTxnId, command.uploads);
			case "legacyProof": return this.setAdmissionProof(command.clientTxnId, command.proof);
			default: throw invalidJson("Unknown attachment draft command.");
		}
	}

	async add(input: AttachmentInput): Promise<AttachmentId> {
		return this.addSync(input);
	}

	private addSync(input: AttachmentInput): AttachmentId {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Attachment input must be an object.",
				retryable: false,
			});
		}
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
		const media = normalizeMediaInput(input.media);
		const timestamp = this.timestamp();
		const reserved = new Set<string>(this.records.map((record) => record.envelope.id));
		for (const snapshot of this.openTransactions.values()) {
			for (const entry of snapshot.attachments) reserved.add(entry.id);
		}
		let id = "";
		let attempts = 0;
		do {
			const generated: unknown = this.createId();
			if (!nonEmptyString(generated)) {
				throw new AttachmentDraftError({
					code: "ATT_INVALID_JSON",
					message: "Attachment id generator must produce a non-empty string id.",
					retryable: false,
				});
			}
			id = generated;
			attempts += 1;
		} while (reserved.has(id) && attempts < CORE_ATTACHMENT_ADD_ID_ATTEMPTS);
		if (reserved.has(id)) {
			throw new AttachmentDraftError({
				code: "ATT_STORAGE_FAILED",
				message: "Attachment id generator produced only duplicate ids.",
				retryable: true,
			});
		}
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
			...(media !== undefined ? { media } : {}),
			status: "ready",
		};
		this.commit({ records: [...this.records, record], openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs }, "Attachment draft could not be stored; it is not reload-proof.");
		return record.envelope.id;
	}

	async update(id: AttachmentId, expectedRevision: number, next: AttachmentEditableState): Promise<void> {
		this.updateSync(id, expectedRevision, next);
	}

	private updateSync(id: AttachmentId, expectedRevision: number, next: AttachmentEditableState): void {
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
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Attachment changes must be an object.",
				retryable: false,
			});
		}
		if (next.payload === undefined && next.uiState === undefined) return;
		const touchesPayload = next.payload !== undefined;
		const nextRevision = touchesPayload ? record.envelope.revision + 1 : record.envelope.revision;
		// The writer must never persist a revision rejected by the loader.
		// Do not wrap or clamp: either would break snapshot/CAS identity.
		if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
			throw new AttachmentDraftError({
				code: "ATT_LIMIT_EXCEEDED",
				message: "Attachment revision limit reached; the existing draft is unchanged.",
				retryable: false,
			});
		}
		if (touchesPayload) assertJsonValue(next.payload, "Attachment payload");
		if (next.uiState !== undefined) assertJsonValue(next.uiState, "Attachment UI state");
		const timestamp = this.timestamp();
		const candidate: AttachmentDraftRecord = {
			...cloneJson(record),
			payload: touchesPayload ? cloneJson(next.payload) : cloneJson(record.payload),
			...(next.uiState !== undefined || record.uiState !== undefined
				? { uiState: cloneJson(next.uiState !== undefined ? next.uiState : record.uiState) }
				: {}),
			envelope: {
				...record.envelope,
				revision: nextRevision as AttachmentRevision,
				updatedAt: timestamp,
			},
			status: "ready",
		};
		if (candidate.uiState === undefined) delete candidate.uiState;
		this.commit(
			{
				records: this.records.map((entry) => (entry.envelope.id === id ? candidate : entry)),
				openTransactions: this.openTransactions,
				acceptedTransactions: this.acceptedTransactions,
				preparedUploads: this.preparedUploads,
				admissionProofs: this.admissionProofs,
			},
			"Attachment draft change could not be stored.",
		);
	}

	async remove(id: AttachmentId): Promise<void> {
		this.removeSync(id);
	}

	private removeSync(id: AttachmentId): void {
		if (!this.records.some((candidate) => candidate.envelope.id === id)) return;
		this.commit(
			{
				records: this.records.filter((candidate) => candidate.envelope.id !== id),
				openTransactions: this.openTransactions,
				acceptedTransactions: this.acceptedTransactions,
				preparedUploads: this.preparedUploads,
				admissionProofs: this.admissionProofs,
			},
			"Attachment removal could not be stored.",
		);
	}

	freezeForSend(clientTxnId: string, text: string): AttachmentSendSnapshot {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		if (typeof text !== "string") {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Send text must be a string.",
				retryable: false,
			});
		}
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
			...(record.media !== undefined ? { media: record.media.map((entry) => ({ ...entry })) } : {}),
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
			frozenAt: this.timestamp(),
			attachments,
		};
		const openTransactions = new Map(this.openTransactions);
		openTransactions.set(txn, snapshot);
		this.commit(
			{ records: this.records, openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs },
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
		const preparedUploads = new Map(this.preparedUploads);
		preparedUploads.delete(checkedReceipt.clientTxnId);
		const admissionProofs = new Map(this.admissionProofs);
		admissionProofs.delete(checkedReceipt.clientTxnId);
		this.commit(
			{ records: remaining, openTransactions, acceptedTransactions, preparedUploads, admissionProofs },
			"Acceptance could not be stored; nothing was consumed.",
		);
		return { consumed, duplicate: false };
	}

	private load(key: string): DraftStateCandidate {
		const raw = this.storage.readText(key);
		if (raw === null) {
			return { records: [], openTransactions: new Map(), acceptedTransactions: new Set(), preparedUploads: new Map(), admissionProofs: new Map() };
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
				preparedUploads: new Map(),
				admissionProofs: new Map(),
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
		const preparedUploads = new Map<string, K07PreparedUpload[]>();
		if (state.preparedUploads !== undefined) {
			if (typeof state.preparedUploads !== "object" || state.preparedUploads === null || Array.isArray(state.preparedUploads)) {
				throw new Error("stored prepared uploads are invalid.");
			}
			for (const [txnId, uploads] of Object.entries(state.preparedUploads)) {
				if (!openTransactions.has(txnId)) throw new Error(`stored prepared uploads reference unknown transaction ${txnId}.`);
				if (!Array.isArray(uploads)) throw new Error(`stored prepared uploads for ${txnId} are invalid.`);
				preparedUploads.set(txnId, uploads.map((upload) => validateStoredPreparedUpload(upload, txnId)));
			}
		}
		const admissionProofs = new Map<string, K07AdmissionProof>();
		if (state.admissionProofs !== undefined) {
			if (typeof state.admissionProofs !== "object" || state.admissionProofs === null || Array.isArray(state.admissionProofs)) {
				throw new Error("stored admission proofs are invalid.");
			}
			for (const [txnId, proof] of Object.entries(state.admissionProofs)) {
				if (!openTransactions.has(txnId)) throw new Error(`stored admission proof references unknown transaction ${txnId}.`);
				try {
					admissionProofs.set(txnId, assertValidAdmissionProof(proof as K07AdmissionProof));
				} catch (error) {
					throw new Error(`stored admission proof for ${txnId} is invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
				}
			}
		}
		const preparedSubmissions = new Map<string, AttachmentPreparedSubmission>();
		if (state.preparedSubmissions !== undefined) {
			if (!isPlainJsonObject(state.preparedSubmissions)) throw new Error("stored submissions are invalid.");
			for (const [txnId, value] of Object.entries(state.preparedSubmissions)) {
				const snapshot = openTransactions.get(txnId);
				if (!snapshot || !isPlainJsonObject(value)) throw new Error("stored submission has no open transaction.");
				const checked = prepareSnapshotSubmission(snapshot, value.body);
				if (!sameMessageContentBinding(checked.contentBinding, value.contentBinding)) throw new Error("stored submission binding is invalid.");
				preparedSubmissions.set(txnId, checked);
			}
		}
		return { records, openTransactions, acceptedTransactions, preparedUploads, admissionProofs, preparedSubmissions };
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

	private timestamp(): string {
		const stamped: unknown = this.now();
		if (!nonEmptyString(stamped)) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Clock must produce a non-empty string timestamp.",
				retryable: false,
			});
		}
		return stamped;
	}

	private commit(candidate: DraftStateCandidate, failureMessage: string): void {
		const preparedSubmissions = new Map([...(candidate.preparedSubmissions ?? this.preparedSubmissions)]
			.filter(([txnId]) => candidate.openTransactions.has(txnId)));
		const text = toJsonText(
			{
				formatVersion: CORE_ATTACHMENT_DRAFT_STATE_VERSION,
				sessionId: this.sessionId,
				records: candidate.records,
				openTransactions: Object.fromEntries(candidate.openTransactions),
				acceptedTransactions: [...candidate.acceptedTransactions],
				writerEpoch: this.writerEpoch,
				preparedUploads: Object.fromEntries(candidate.preparedUploads),
				admissionProofs: Object.fromEntries(candidate.admissionProofs),
				preparedSubmissions: Object.fromEntries(preparedSubmissions),
			} satisfies CoreAttachmentDraftPersistedState,
			"Draft state",
		);
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
		this.preparedUploads = candidate.preparedUploads;
		this.admissionProofs = candidate.admissionProofs;
		this.preparedSubmissions = preparedSubmissions;
		this.storageError = undefined;
	}

	/** Persist the exact submission before the network can accept it. Never
	 * replace it under the same transaction, even after a lost response. */
	prepareSubmission(snapshot: AttachmentSendSnapshot, body: unknown): AttachmentPreparedSubmission {
		const checkedSnapshot = validateSnapshotShape(snapshot);
		const txn = normalizeDraftClientTxnId(checkedSnapshot.clientTxnId);
		const bound = this.openTransactions.get(txn);
		if (!bound || canonicalSnapshot(bound) !== canonicalSnapshot(checkedSnapshot)) {
			throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Submission requires the bound original snapshot.", retryable: false });
		}
		const checked = prepareSnapshotSubmission(bound, body);
		const prior = this.preparedSubmissions.get(txn);
		if (prior) {
			if (!sameMessageContentBinding(prior.contentBinding, checked.contentBinding)) {
				throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Transaction already has a different prepared submission; retry its original body.", retryable: false });
			}
			return cloneJson(prior);
		}
		const preparedSubmissions = new Map(this.preparedSubmissions);
		preparedSubmissions.set(txn, checked);
		this.commit({ records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs, preparedSubmissions }, "Submission could not be stored; do not send it.");
		return cloneJson(checked);
	}

	getPreparedSubmission(clientTxnId: string): AttachmentPreparedSubmission | undefined {
		const prepared = this.preparedSubmissions.get(normalizeDraftClientTxnId(clientTxnId));
		return prepared ? cloneJson(prepared) : undefined;
	}

	wasAccepted(clientTxnId: string): boolean {
		return this.acceptedTransactions.has(normalizeDraftClientTxnId(clientTxnId));
	}

	getPreparedUploads(clientTxnId: string): K07PreparedUpload[] {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		return cloneJson(this.preparedUploads.get(txn) ?? []);
	}

	/**
	 * Records uploads prepared at send freeze so retries reuse the same
	 * frozen content and prepared resources instead of re-uploading. The
	 * transaction must be open; entries are validated and persisted with the
	 * same candidate→write→publish rule. Removed automatically on acceptance.
	 */
	setPreparedUploads(clientTxnId: string, uploads: K07PreparedUpload[]): void {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		if (!this.openTransactions.has(txn)) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Prepared uploads require an open transaction.",
				retryable: false,
			});
		}
		if (!Array.isArray(uploads)) {
			throw new AttachmentDraftError({
				code: "ATT_INVALID_JSON",
				message: "Prepared uploads must be an array.",
				retryable: false,
			});
		}
		const checked = uploads.map((upload) => assertValidPreparedUpload(upload));
		if (this.preparedSubmissions.has(txn) && toJsonText(checked, "Prepared uploads") !== toJsonText(this.preparedUploads.get(txn) ?? [], "Prepared uploads")) {
			throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Prepared submission resources cannot change; retry the original body and uploads.", retryable: false });
		}
		const preparedUploads = new Map(this.preparedUploads);
		preparedUploads.set(txn, checked);
		this.commit(
			{ records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads, admissionProofs: this.admissionProofs },
			"Prepared uploads could not be stored.",
		);
	}

	getAdmissionProof(clientTxnId: string): K07AdmissionProof | undefined {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		const proof = this.admissionProofs.get(txn);
		return proof ? { ...proof } : undefined;
	}

	/**
	 * Retains a legacy POST echo for old stored-state readability. This echo
	 * is NOT evidence of the locally frozen request after a lost conflict.
	 * Only prepareSubmission supplies the independently derived binding.
	 * Requires an open transaction; dropped automatically on acceptance.
	 */
	setAdmissionProof(clientTxnId: string, proof: K07AdmissionProof): void {
		const txn = normalizeDraftClientTxnId(clientTxnId);
		if (!this.openTransactions.has(txn)) {
			throw new AttachmentDraftError({
				code: "ATT_ACCEPTANCE_UNKNOWN",
				message: "Admission proofs require an open transaction.",
				retryable: false,
			});
		}
		const checked = assertValidAdmissionProof(proof);
		const admissionProofs = new Map(this.admissionProofs);
		admissionProofs.set(txn, checked);
		this.commit(
			{ records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs },
			"Admission proof could not be stored.",
		);
	}
}
