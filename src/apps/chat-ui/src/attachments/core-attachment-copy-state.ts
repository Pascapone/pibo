/** Private copy-row data contract. No provider hooks, storage or network here. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { assertJsonValue, cloneJson, invalidJson, isPlainJsonObject } from "../../../../attachments/json.js";
import { attachmentStorageFailed, nextAttachmentRevision } from "./core-attachment-database";
import { canonicalJson } from "../../../../shared/deterministic-digest.js";
import type { AttachmentDraftMedia } from "./core-attachment-draft";
import type { StoredDraftBlob } from "./core-attachment-persistence";

/** Historical v2/v3 row: deliberately has no invented provider type/schema. */
export type LegacyCopyBufferEntry = {
	ownerUserId: string;
	copyId: string;
	stagedAt: string;
	sourceSessionId: string;
	sourceDraftId: string;
	sourceRevision: number;
	payload: unknown;
	media: AttachmentDraftMedia[];
};
export type CopyBufferInput = Omit<LegacyCopyBufferEntry, "ownerUserId" | "stagedAt"> & { type: string; schemaVersion: number };
export type CopyBufferEntry = LegacyCopyBufferEntry & { type: string; schemaVersion: number };
export type CopyBufferState = { revision: number; entry?: CopyBufferEntry; legacy?: LegacyCopyBufferEntry };
export type CopyBufferRow = { formatVersion: 1; ownerUserId: string; revision: number; updatedAt: string; entry: CopyBufferEntry | null };
export type AttachmentCopyBuffer = {
	readonly ownerUserId: string;
	/** Bytes are acquired independently from the exact source scope. No provider
	 * is invoked here; callers capture/validate provider payloads before staging. */
	stage(expectedRevision: number, entry: CopyBufferInput): Promise<CopyBufferState>;
	load(): Promise<CopyBufferState>;
	clear(expectedRevision: number): Promise<CopyBufferState>;
};

export class AttachmentCopyConflict extends AttachmentDraftError {
	constructor(readonly expectedRevision: number, readonly currentRevision: number) {
		super({ code: "ATT_STALE_REVISION", message: `Copy buffer is at revision ${currentRevision}, not ${expectedRevision}. Reload before replacing or using it.`, retryable: false });
	}
}
export function assertCopyRevision(state: CopyBufferState, expected: number): void {
	if (!Number.isSafeInteger(expected) || expected < 0) throw invalidJson("Expected copy revision must be a non-negative safe integer.");
	if (state.revision !== expected) throw new AttachmentCopyConflict(expected, state.revision);
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function checkEntry(value: unknown, typed: boolean): asserts value is CopyBufferInput {
	if (!isPlainJsonObject(value) || !text(value.copyId) || !text(value.sourceSessionId) || !text(value.sourceDraftId)
		|| !positive(value.sourceRevision) || !Object.hasOwn(value, "payload") || !Array.isArray(value.media)
		|| (typed && (!text(value.type) || !positive(value.schemaVersion)))) throw invalidJson("Copy entries require source identity, revision, JSON, media and a provider type/schema.");
	assertJsonValue(value, "Copy entry");
	const ids = new Set<string>();
	for (const media of value.media) {
		if (!isPlainJsonObject(media) || !text(media.draftResourceId) || ids.has(media.draftResourceId) || !text(media.mimeType)
			|| !Number.isSafeInteger(media.bytes) || (media.bytes as number) < 0) throw invalidJson("Copy media must have distinct identities, MIME types and non-negative safe byte lengths.");
		ids.add(media.draftResourceId);
	}
}
export function captureCopyInput(value: CopyBufferInput): CopyBufferInput {
	checkEntry(value, true);
	return cloneJson({ copyId: value.copyId, sourceSessionId: value.sourceSessionId, sourceDraftId: value.sourceDraftId,
		sourceRevision: value.sourceRevision, type: value.type, schemaVersion: value.schemaVersion, payload: value.payload, media: value.media });
}
/** Read legacy values without rewriting, guessing their domain or granting them
 * typed replay. A present legacy row is revision 1; absence is revision 0. */
export function readCopyBufferState(value: unknown, ownerUserId: string): CopyBufferState {
	if (value === undefined) return { revision: 0 };
	try {
		if (!isPlainJsonObject(value) || value.ownerUserId !== ownerUserId) throw invalidJson("Copy scope mismatch.");
		if (!Object.hasOwn(value, "formatVersion")) {
			// v2 stage() accepted structured-cloneable payloads and repeated media
			// holders, not just JSON. Retain those exact values for explicit legacy
			// inspection/clear, but NEVER invent typed replay from them.
			if (!text(value.copyId) || !text(value.sourceSessionId) || !text(value.sourceDraftId)
				|| !text(value.stagedAt) || !Array.isArray(value.media)
				|| value.media.some((media) => !media || !text(media.draftResourceId))) throw invalidJson("Invalid legacy copy holder.");
			return { revision: 1, legacy: structuredClone(value) as LegacyCopyBufferEntry };
		}
		assertJsonValue(value, "Stored copy row");
		if (value.formatVersion !== 1 || !positive(value.revision) || !text(value.updatedAt) || !Object.hasOwn(value, "entry")) throw invalidJson("Invalid copy revision or format.");
		if (value.entry === null) return { revision: value.revision as number };
		checkEntry(value.entry, true);
		const entry = value.entry as unknown as CopyBufferEntry;
		if (entry.ownerUserId !== ownerUserId || !text(entry.stagedAt)) throw invalidJson("Invalid copy entry owner/timestamp.");
		return { revision: value.revision as number, entry: cloneJson(entry) };
	} catch { throw attachmentStorageFailed("Stored copy buffer is invalid; it was not changed."); }
}
export function copyBufferRow(ownerUserId: string, current: CopyBufferState, entry: CopyBufferEntry | null): CopyBufferRow {
	return { formatVersion: 1, ownerUserId, revision: nextAttachmentRevision(current.revision), updatedAt: new Date().toISOString(), entry };
}
export function copyHolderDraftId(copyId: string): string { return `pibo.copy-holder.${copyId}`; }
export function copyStateMedia(state: CopyBufferState): AttachmentDraftMedia[] { return state.entry?.media ?? state.legacy?.media ?? []; }

/** A byte identity never escapes its owner and logical source. */
export function requireScopedCopyBlob(blob: StoredDraftBlob | undefined, ownerUserId: string, sessionId: string, draftId: string, media: AttachmentDraftMedia, maxBytes: number): StoredDraftBlob {
	if (!blob || blob.blobId !== media.draftResourceId || blob.ownerUserId !== ownerUserId || blob.sessionId !== sessionId || blob.draftId !== draftId
		|| blob.mimeType !== media.mimeType || blob.size !== media.bytes || blob.size > maxBytes || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== blob.size) {
		throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Copy bytes are missing or do not match the expected owner, Session and draft.", retryable: false });
	}
	return blob;
}
/** Remap Core media identities only. Opaque provider JSON is preserved exactly;
 * it is never searched/re-written as if arbitrary strings were byte handles. */
export function sameCopyContent(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}
export function rebaseCopyMedia(media: AttachmentDraftMedia[], createId: () => string): AttachmentDraftMedia[] {
	const seen = new Set(media.map((entry) => entry.draftResourceId));
	return media.map((entry) => {
		const id = createId();
		if (!text(id) || seen.has(id)) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Could not allocate independent copy byte identities.", retryable: false });
		seen.add(id);
		return { ...entry, draftResourceId: id };
	});
}
