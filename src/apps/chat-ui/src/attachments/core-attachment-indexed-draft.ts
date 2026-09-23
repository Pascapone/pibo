/** Private asynchronous owner/Session facade. Every write is a data-only command
 * executed on a fresh transaction-local engine, never a stale long-lived mirror. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { invalidJson, assertJsonValue, isPlainJsonObject } from "../../../../attachments/json.js";
import { deterministicDigest } from "../../../../shared/deterministic-digest.js";
import {
	CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX, normalizeDraftClientTxnId,
	type CoreAttachmentDraftCommand, type CoreAttachmentDraftCommandResult, type CoreAttachmentDraftView,
} from "./core-attachment-draft";
import { readCoreAttachmentDraft, transitionCoreAttachmentDraft } from "./core-attachment-transitions";
import {
	openAttachmentDatabase, attachmentIdbRequest as request, attachmentIdbTransaction as transact,
	attachmentStorageFailed, nextAttachmentRevision, checkAttachmentDraftRow,
	ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME,
	ATTACHMENT_LEGACY_CLAIM_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME, type IndexedDbFactory, type AttachmentDraftRow,
} from "./core-attachment-database";
import { ATTACHMENT_BLOB_MAX_BYTES, collectBlobHolders, createBlobId, readStoredBlobHolders, type StoredDraftBlob } from "./core-attachment-persistence";
import {
	assertCopyRevision, copyHolderDraftId, readCopyBufferState, rebaseCopyMedia, requireScopedCopyBlob,
	type CopyBufferEntry,
} from "./core-attachment-copy-state";

export type IndexedAttachmentDraftSnapshot = {
	revision: number;
	writerEpoch?: string;
	view: CoreAttachmentDraftView;
};
export type AttachmentDraftBlobInput = { blobId: string; mimeType: string; data: Uint8Array };
export type LegacyAttachmentClaim = {
	sourceKey: string;
	ownerUserId: string;
	sessionId: string;
	claimedAt: string;
	writerEpoch: string;
	/** Domain-separated digest of the exact retained JS string, not an owner proof. */
	sourceDigest: string;
};
export type LegacyAttachmentTextBackup = Pick<LegacyAttachmentClaim, "sourceKey" | "ownerUserId" | "sessionId" | "sourceDigest"> & { rawText: string };

export class AttachmentDraftConflict extends AttachmentDraftError {
	constructor(readonly expectedRevision: number, readonly currentRevision: number, readonly writerEpoch?: string) {
		super({ code: "ATT_STALE_REVISION", message: `Draft storage is at revision ${currentRevision}, not ${expectedRevision}. Reload before changing it.`, retryable: false });
	}
}

function denied(): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Attachment storage is closed or belongs to another login.", retryable: false });
}
function checkExpected(expected: number): void {
	if (!Number.isSafeInteger(expected) || expected < 0) throw invalidJson("Expected storage revision must be a non-negative safe integer.");
}
function heldBy(view: CoreAttachmentDraftView): Set<string> {
	return collectBlobHolders({ drafts: view.records.map((record) => ({ draftId: record.envelope.id, media: record.media })), openSnapshots: view.openSnapshots }).held;
}
function snapshot(row: AttachmentDraftRow | undefined, sessionId: string): IndexedAttachmentDraftSnapshot {
	return { revision: row?.revision ?? 0, ...(row ? { writerEpoch: row.writerEpoch } : {}), view: readCoreAttachmentDraft(row?.rawText ?? null, sessionId) };
}
function capturedBlobs(blobs: readonly AttachmentDraftBlobInput[]): AttachmentDraftBlobInput[] {
	const seen = new Set<string>();
	return blobs.map((blob) => {
		if (!blob || typeof blob.blobId !== "string" || !blob.blobId || seen.has(blob.blobId)
			|| typeof blob.mimeType !== "string" || !blob.mimeType || !(blob.data instanceof Uint8Array)) {
			throw invalidJson("Draft byte inputs require distinct ids, MIME types and byte arrays.");
		}
		if (blob.data.byteLength > ATTACHMENT_BLOB_MAX_BYTES) {
			throw new AttachmentDraftError({ code: "ATT_LIMIT_EXCEEDED", message: "Draft blob exceeds the 15 MiB stored-byte limit.", retryable: false });
		}
		seen.add(blob.blobId);
		return { blobId: blob.blobId, mimeType: blob.mimeType, data: new Uint8Array(blob.data) };
	});
}

export async function openIndexedAttachmentDraft(options: {
	factory: IndexedDbFactory;
	ownerUserId: string;
	sessionId: string;
	/** Isolated fixtures must supply a uniquely owned database name. */
	databaseName?: string;
}) {
	const { ownerUserId, sessionId } = options;
	if (typeof ownerUserId !== "string" || !ownerUserId || typeof sessionId !== "string" || !sessionId) throw denied();
	const db = await openAttachmentDatabase(options.factory, options.databaseName);
	const writerEpoch = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
	let closed = false;
	const close = () => { closed = true; db.close(); };
	db.addEventListener("versionchange", close);
	const active = () => { if (closed) throw denied(); };
	const key = [ownerUserId, sessionId];
	const readRow = async (store: IDBObjectStore) => {
		const value = await request(store.get(key)) as AttachmentDraftRow | undefined;
		return value ? checkAttachmentDraftRow(value, ownerUserId, sessionId) : undefined;
	};
	const compare = (row: AttachmentDraftRow | undefined, expected: number) => {
		if ((row?.revision ?? 0) !== expected) throw new AttachmentDraftConflict(expected, row?.revision ?? 0, row?.writerEpoch);
	};
	const rowFor = (rawText: string | null, revision: number): AttachmentDraftRow => ({
		ownerUserId, sessionId, revision, writerEpoch, rawText, updatedAt: new Date().toISOString(),
	});
	const legacySourceKey = (kind: "unowned" | "owner-scoped") => {
		if (kind !== "unowned" && kind !== "owner-scoped") throw denied();
		const draftKey = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + sessionId;
		return kind === "unowned" ? draftKey : `pibo.attachments.owner.${ownerUserId}.${draftKey}`;
	};
	const readBackup = async (backups: IDBObjectStore, sourceKey: string) => {
		const backup = await request(backups.get([ownerUserId, sourceKey])) as LegacyAttachmentTextBackup | undefined;
		if (!backup) return undefined;
		if (backup.ownerUserId !== ownerUserId || backup.sessionId !== sessionId || backup.sourceKey !== sourceKey
			|| typeof backup.rawText !== "string" || backup.sourceDigest !== deterministicDigest({ domain: "pibo.attachment-legacy-text.v1", rawText: backup.rawText })) {
			throw attachmentStorageFailed("Legacy recovery backup is invalid; it was not changed.");
		}
		return backup;
	};

	return {
		ownerUserId, sessionId, close,
		async load(): Promise<IndexedAttachmentDraftSnapshot> {
			active();
			const result = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => snapshot(await readRow(store), sessionId));
			active();
			return result;
		},
		/** Read only a byte row still held by this owner's exact frozen Pibo
		 * Session/transaction/record. Do not use the owner-wide preview getter
		 * for typed staging. Provider and network work happen after this closes. */
		async readFrozenMedia(clientTxnId: string, recordId: string, draftResourceId: string): Promise<{ mimeType: string; data: Uint8Array }> {
			active();
			const txn = normalizeDraftClientTxnId(clientTxnId);
			if (txn !== clientTxnId || typeof recordId !== "string" || !recordId || typeof draftResourceId !== "string" || !draftResourceId) {
				throw invalidJson("Frozen media requires exact transaction, record and resource identities.");
			}
			const found = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME], "readonly", async ([drafts, bytes]) => {
				active();
				const view = snapshot(await readRow(drafts), sessionId).view;
				const frozen = view.openSnapshots.find((entry) => entry.clientTxnId === txn);
				const record = frozen?.attachments.find((entry) => entry.id === recordId);
				const media = record?.media?.find((entry) => entry.draftResourceId === draftResourceId);
				if (!media) throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "No frozen media is held by this transaction and draft.", retryable: false });
				const blob = await request(bytes.get(draftResourceId)) as StoredDraftBlob | undefined;
				if (!blob || blob.ownerUserId !== ownerUserId || blob.sessionId !== sessionId || blob.draftId !== recordId
					|| blob.mimeType !== media.mimeType || blob.size !== media.bytes || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== blob.size
					|| blob.size > ATTACHMENT_BLOB_MAX_BYTES) {
					throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Frozen bytes are missing or differ from the exact scope.", retryable: false });
				}
				return { mimeType: blob.mimeType, data: new Uint8Array(blob.data.slice(0)) };
			});
			active();
			return found;
		},
		async execute<C extends CoreAttachmentDraftCommand>(expectedRevision: number, value: C, newBlobs: readonly AttachmentDraftBlobInput[] = []): Promise<{
			result: CoreAttachmentDraftCommandResult<C>; current: IndexedAttachmentDraftSnapshot;
		}> {
			active(); checkExpected(expectedRevision);
			// Plain data only; validate before structuredClone can erase custom
			// prototypes. Capture before any IDB wait or caller mutation.
			if (!isPlainJsonObject(value) || typeof value.kind !== "string") throw invalidJson("Draft command must be a plain object with a kind.");
			assertJsonValue(value, "Draft command");
			let command: C;
			try { command = structuredClone(value); } catch { throw invalidJson("Draft command could not be captured."); }
			const blobs = capturedBlobs(newBlobs);
			if (blobs.length && command.kind !== "add") throw invalidJson("New bytes must be acquired atomically with a new draft record.");
			const outcome = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([drafts, bytes, copies]) => {
				active();
				const current = await readRow(drafts);
				compare(current, expectedRevision);
				const before = readCoreAttachmentDraft(current?.rawText ?? null, sessionId);
				const next = transitionCoreAttachmentDraft(current?.rawText ?? null, sessionId, command);
				if (command.kind === "add") {
					const added = next.view.records.find((record) => record.envelope.id === next.result)!;
					for (const blob of blobs) {
						const media = added.media?.find((media) => media.draftResourceId === blob.blobId);
						if (!media || media.mimeType !== blob.mimeType || media.bytes !== blob.data.byteLength) throw invalidJson("New bytes must match a new attachment's frozen media descriptor.");
						const row: StoredDraftBlob = { blobId: blob.blobId, ownerUserId, sessionId, draftId: added.envelope.id,
							mimeType: blob.mimeType, size: blob.data.byteLength, createdAt: new Date().toISOString(), data: blob.data.buffer as ArrayBuffer };
						try { await request(bytes.add(row)); }
						catch (error) {
							if (error instanceof DOMException && error.name === "ConstraintError") throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Blob id already exists; immutable bytes were not replaced.", retryable: false });
							throw error;
						}
					}
				}
				// Admission reconciliation must not depend on local byte availability.
				// New records and new freezes, however, cannot acquire unknown bytes.
				if (command.kind === "add" || command.kind === "freeze") {
					const records = command.kind === "add" ? next.view.records.filter((record) => record.envelope.id === next.result) : next.view.records;
					for (const record of records) for (const media of record.media ?? []) {
						const blob = await request(bytes.get(media.draftResourceId)) as StoredDraftBlob | undefined;
						if (!blob || blob.ownerUserId !== ownerUserId || blob.sessionId !== sessionId || blob.draftId !== record.envelope.id
							|| blob.mimeType !== media.mimeType || blob.size !== media.bytes || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== blob.size) {
							throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Attachment bytes are missing or do not match this login and Session draft.", retryable: false });
						}
					}
				}
				if (next.text === (current?.rawText ?? null)) return { result: next.result, current: snapshot(current, sessionId) };
				const row = rowFor(next.text, nextAttachmentRevision(expectedRevision));
				await request(drafts.put(row));
				const previousIds = heldBy(before);
				if (previousIds.size) {
					const held = await readStoredBlobHolders(drafts, copies, ownerUserId);
					const priorDraftIds = new Set<string>([...before.records.map((record) => record.envelope.id), ...before.openSnapshots.flatMap((snapshot) => snapshot.attachments.map((entry) => entry.id))]);
					for (const id of previousIds) if (!held.has(id)) {
						const blob = await request(bytes.get(id)) as StoredDraftBlob | undefined;
						if (blob?.ownerUserId === ownerUserId && blob.sessionId === sessionId && priorDraftIds.has(blob.draftId)) await request(bytes.delete(id));
					}
				}
				return { result: next.result, current: { revision: row.revision, writerEpoch, view: next.view } };
			});
			// Logout may have closed this adapter while its old-owner transaction
			// completed. Keep its data, but never publish that view to a new login.
			active();
			return outcome;
		},
		/** Re-acquire independently owned copy bytes under NEW target-session/draft
		 * identities, in the same transaction as adding the target draft. Legacy
		 * untyped copy rows cannot invent a provider type/schema for replay. */
		async pasteCopy(expectedRevision: number, expectedCopyRevision: number): Promise<{ result: string; current: IndexedAttachmentDraftSnapshot }> {
			active(); checkExpected(expectedRevision); checkExpected(expectedCopyRevision);
			const outcome = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME], "readwrite", async ([drafts, copies, bytes]) => {
				active();
				const current = await readRow(drafts);
				compare(current, expectedRevision);
				const copy = readCopyBufferState(await request(copies.get(ownerUserId)), ownerUserId);
				assertCopyRevision(copy, expectedCopyRevision);
				const entry: CopyBufferEntry | undefined = copy.entry;
				if (!entry) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "No typed copy is available for insertion.", retryable: false });
				const media = rebaseCopyMedia(entry.media, createBlobId);
				const next = transitionCoreAttachmentDraft(current?.rawText ?? null, sessionId,
					{ kind: "add", input: { sessionId, type: entry.type, schemaVersion: entry.schemaVersion, payload: entry.payload, media } });
				const staged: StoredDraftBlob[] = [];
				for (let index = 0; index < entry.media.length; index++) {
					const sourceMedia = entry.media[index]!;
					const blob = requireScopedCopyBlob(await request(bytes.get(sourceMedia.draftResourceId)) as StoredDraftBlob | undefined,
						ownerUserId, entry.sourceSessionId, copyHolderDraftId(entry.copyId), sourceMedia, ATTACHMENT_BLOB_MAX_BYTES);
					staged.push({ ...blob, blobId: media[index]!.draftResourceId, sessionId, draftId: next.result, createdAt: new Date().toISOString(), data: blob.data.slice(0) });
				}
				for (const blob of staged) {
					try { await request(bytes.add(blob)); }
					catch (error) {
						if (error instanceof DOMException && error.name === "ConstraintError") throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Pasted byte identity collided; the target draft was not changed.", retryable: false });
						throw error;
					}
				}
				const row = rowFor(next.text, nextAttachmentRevision(expectedRevision));
				await request(drafts.put(row));
				return { result: next.result, current: { revision: row.revision, writerEpoch, view: next.view } };
			});
			active();
			return outcome;
		},
		async readLegacyBackup(kind: "unowned" | "owner-scoped"): Promise<{ rawText: string; sourceDigest: string } | undefined> {
			active();
			const sourceKey = legacySourceKey(kind);
			const result = await transact(db, [ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readonly", async ([backups]) => {
				const backup = await readBackup(backups, sourceKey);
				return backup ? { rawText: backup.rawText, sourceDigest: backup.sourceDigest } : undefined;
			});
			active();
			return result;
		},
		/** Explicit text-state recovery into an absent/cleared entry, with CAS.
		 * This restores metadata and proofs, NOT deleted binary bytes. Freeze
		 * still checks byte availability; it cannot invent a media recovery. */
		async restoreLegacyText(expectedRevision: number, kind: "unowned" | "owner-scoped"): Promise<IndexedAttachmentDraftSnapshot> {
			active(); checkExpected(expectedRevision);
			const sourceKey = legacySourceKey(kind);
			const result = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([drafts, backups]) => {
				active();
				const current = await readRow(drafts);
				compare(current, expectedRevision);
				if (current?.rawText != null) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Text recovery requires an absent or explicitly cleared draft; existing state was not replaced.", retryable: false });
				const backup = await readBackup(backups, sourceKey);
				if (!backup) throw denied();
				readCoreAttachmentDraft(backup.rawText, sessionId);
				const row = rowFor(backup.rawText, nextAttachmentRevision(expectedRevision));
				await request(drafts.put(row));
				return snapshot(row, sessionId);
			});
			active();
			return result;
		},
		/** Explicit custody recovery only. No automatic reads, fallback, deletion
		 * or claim that the current login was the original author. */
		async adoptLegacy(input: { confirmCustody: true; kind: "unowned" | "owner-scoped"; storage: Pick<Storage, "getItem"> }): Promise<IndexedAttachmentDraftSnapshot> {
			active();
			if (input.confirmCustody !== true || !["unowned", "owner-scoped"].includes(input.kind)) throw denied();
			const sourceKey = legacySourceKey(input.kind);
			const outcome = await transact(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_LEGACY_CLAIM_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([drafts, claims, backups]) => {
				active();
				const prior = await request(claims.get(sourceKey)) as LegacyAttachmentClaim | undefined;
				if (prior && prior.ownerUserId !== ownerUserId) throw denied(); // before reading any legacy content
				const existing = await readRow(drafts);
				compare(existing, 0); // never overwrite an existing entry or tombstone
				if (prior) throw attachmentStorageFailed("Legacy custody already exists; recover its retained copy instead of re-adopting changed text.");
				const rawText = input.storage.getItem(sourceKey);
				if (typeof rawText !== "string") throw attachmentStorageFailed("No recoverable legacy entry was found.");
				readCoreAttachmentDraft(rawText, sessionId); // corrupt/foreign source remains untouched
				const sourceDigest = deterministicDigest({ domain: "pibo.attachment-legacy-text.v1", rawText });
				const claim: LegacyAttachmentClaim = { sourceKey, ownerUserId, sessionId, claimedAt: new Date().toISOString(), writerEpoch, sourceDigest };
				const backup: LegacyAttachmentTextBackup = { sourceKey, ownerUserId, sessionId, sourceDigest, rawText };
				const row = rowFor(rawText, 1);
				await request(claims.add(claim));
				await request(backups.add(backup));
				await request(drafts.add(row));
				const verified = await readRow(drafts);
				if (verified?.rawText !== rawText || (await readBackup(backups, sourceKey))?.rawText !== rawText) throw attachmentStorageFailed("Recovered draft text did not round-trip exactly.");
				return snapshot(verified, sessionId);
			});
			active();
			return outcome;
		},
	};
}

export type IndexedAttachmentDraft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
