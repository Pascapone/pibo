/**
 * Private browser-local attachment persistence (not yet Composer-wired).
 *
 * Shared browser-local byte storage and compatibility seams. Transactional
 * draft JSON shares IndexedDB with bytes; the synchronous text adapter is
 * legacy-only. JSON references bytes by id, never base64 or model paths.
 * Production Composer integration and headful acceptance are separate work.
 *
 * Scope (I-K07-04): everything is namespaced by the existing login identity
 * (`NavigationData.identity.userId`); unowned legacy entries require explicit
 * custody recovery (no automatic fallback or silent rewrite); identity change
 * hides foreign data fail-closed; explicit clear APIs, no auto-wipe.
 * Deletion is holder-aware (I-K07-05): live drafts, open snapshots, and the
 * reserved copy-holder kind keep blobs alive; removals delete only unheld
 * blobs and report both sets. Copy buffer: exactly one confirmed buffer per
 * login context, cross-session, until replace/clear.
 *
 * Limits: blob ≤15 MiB (mirrors TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES).
 * Quota/IDB failures → ATT_STORAGE_FAILED (retryable), never false success.
 */

import { AttachmentDraftError } from "../../../../attachments/errors.js";
import type { AttachmentDraftMedia, CoreAttachmentDraftStorage } from "./core-attachment-draft";
import { readCoreAttachmentDraft } from "./core-attachment-transitions";
import {
	assertCopyRevision, captureCopyInput, copyBufferRow, copyHolderDraftId, copyStateMedia,
	readCopyBufferState, rebaseCopyMedia, requireScopedCopyBlob, sameCopyContent,
	type AttachmentCopyBuffer, type CopyBufferEntry, type CopyBufferState,
} from "./core-attachment-copy-state";
export type { AttachmentCopyBuffer, CopyBufferEntry, CopyBufferInput, CopyBufferState, LegacyCopyBufferEntry } from "./core-attachment-copy-state";
import {
	ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_BLOB_INDEX_NAME, ATTACHMENT_COPY_STORE_NAME,
	ATTACHMENT_BLOB_OWNER_INDEX, ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_DRAFT_OWNER_INDEX,
	checkAttachmentDraftRow, nextAttachmentRevision, type AttachmentDraftRow,
	openAttachmentDatabase, attachmentIdbRequest as requestToPromise,
	attachmentIdbTransaction, type IndexedDbFactory,
} from "./core-attachment-database";
export {
	ATTACHMENT_BLOB_DB_NAME, ATTACHMENT_BLOB_DB_VERSION, ATTACHMENT_BLOB_STORE_NAME,
	ATTACHMENT_BLOB_INDEX_NAME, ATTACHMENT_COPY_STORE_NAME, type IndexedDbFactory,
} from "./core-attachment-database";
export const ATTACHMENT_BLOB_MAX_BYTES = 15 * 1024 * 1024;

export type DraftBlobRecord = {
	blobId: string;
	ownerUserId: string;
	sessionId: string;
	draftId: string;
	mimeType: string;
	size: number;
	createdAt: string;
};

export type StoredDraftBlob = DraftBlobRecord & {
	data: ArrayBuffer;
};

export type AttachmentBlobStore = {
	readonly ownerUserId: string;
	putBlob(input: { sessionId: string; draftId: string; mimeType: string; data: Uint8Array; blobId?: string }): Promise<{ blobId: string; bytes: number }>;
	getBlob(blobId: string): Promise<{ mimeType: string; data: Uint8Array } | undefined>;
	deleteBlob(blobId: string): Promise<boolean>;
	listBlobs(sessionId: string, draftId?: string): Promise<DraftBlobRecord[]>;
};

export type BlobHolderKind = "draft" | "snapshot" | "copy";

export type BlobHolder = {
	kind: BlobHolderKind;
	id: string;
	blobIds: string[];
};

function storageFailed(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_STORAGE_FAILED", message, retryable: true });
}

function mediaBlobIds(media: AttachmentDraftMedia[] | undefined): string[] {
	return (media ?? []).map((entry) => entry.draftResourceId).filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * Collects every blob id still referenced by live drafts, open snapshots, or
 * the confirmed copy buffer. Deletion paths must keep held blobs.
 */
export function collectBlobHolders(input: {
	drafts: Array<{ draftId: string; media?: AttachmentDraftMedia[] }>;
	openSnapshots: Array<{ clientTxnId: string; attachments: Array<{ id: string; media?: AttachmentDraftMedia[] }> }>;
	copyBuffer?: { copyId: string; media: AttachmentDraftMedia[] } | undefined;
}): { held: Set<string>; holders: BlobHolder[] } {
	const held = new Set<string>();
	const holders: BlobHolder[] = [];
	for (const draft of input.drafts) {
		const blobIds = mediaBlobIds(draft.media);
		for (const blobId of blobIds) held.add(blobId);
		if (blobIds.length > 0) holders.push({ kind: "draft", id: draft.draftId, blobIds });
	}
	for (const snapshot of input.openSnapshots) {
		const blobIds = snapshot.attachments.flatMap((entry) => mediaBlobIds(entry.media));
		for (const blobId of blobIds) held.add(blobId);
		if (blobIds.length > 0) holders.push({ kind: "snapshot", id: snapshot.clientTxnId, blobIds });
	}
	if (input.copyBuffer) {
		const blobIds = mediaBlobIds(input.copyBuffer.media);
		for (const blobId of blobIds) held.add(blobId);
		if (blobIds.length > 0) holders.push({ kind: "copy", id: input.copyBuffer.copyId, blobIds });
	}
	return { held, holders };
}

/** Authoritative holder scan, inside the SAME transaction as deletion. Invalid
 * sibling entries fail closed rather than turning unreadable references into GC. */
export async function readStoredBlobHolders(drafts: IDBObjectStore, copies: IDBObjectStore, ownerUserId: string): Promise<Set<string>> {
	const held = new Set<string>();
	const rows = await requestToPromise(drafts.index(ATTACHMENT_DRAFT_OWNER_INDEX).getAll(ownerUserId)) as AttachmentDraftRow[];
	for (const row of rows) {
		checkAttachmentDraftRow(row, ownerUserId, row.sessionId);
		const view = readCoreAttachmentDraft(row.rawText, row.sessionId);
		const holders = collectBlobHolders({
			drafts: view.records.map((record) => ({ draftId: record.envelope.id, media: record.media })),
			openSnapshots: view.openSnapshots,
		});
		for (const id of holders.held) held.add(id);
	}
	const copy = readCopyBufferState(await requestToPromise(copies.get(ownerUserId)), ownerUserId);
	for (const id of mediaBlobIds(copyStateMedia(copy))) held.add(id);
	return held;
}

/** The supplied set is an advisory fast path; the durable store also checks
 * transaction-current holders. A missing/foreign/held row is never 'deleted'. */
export async function deleteUnheldBlobs(
	store: AttachmentBlobStore,
	blobIds: string[],
	held: Set<string>,
): Promise<{ deleted: string[]; keptHeld: string[] }> {
	const deleted: string[] = [];
	const keptHeld: string[] = [];
	for (const blobId of blobIds) {
		if (held.has(blobId)) {
			keptHeld.push(blobId);
			continue;
		}
		if (await store.deleteBlob(blobId)) deleted.push(blobId);
	}
	return { deleted, keptHeld };
}

/**
 * Owner-scoped browser JSON-state adapter for the sync draft seam. New writes
 * use the historical scoped key only. Unowned text requires explicit IndexedDB
 * custody/adoption; opening this adapter never exposes an unowned fallback.
 */
export function createLocalStorageDraftTextStorage(ownerUserId: string): CoreAttachmentDraftStorage & { readonly ownerUserId: string; clearOwnerText(): void } {
	if (!ownerUserId) throw storageFailed("Draft text storage requires an owner user id.");
	const storageOf = (): Storage => {
		if (typeof localStorage === "undefined") throw storageFailed("Draft text storage is unavailable in this context.");
		return localStorage;
	};
	const namespaced = (key: string): string => `pibo.attachments.owner.${ownerUserId}.${key}`;
	return {
		ownerUserId,
		readText(key: string): string | null {
			try {
				return storageOf().getItem(namespaced(key));
			} catch {
				throw storageFailed("Draft text could not be read.");
			}
		},
		writeText(key: string, value: string): void {
			try {
				storageOf().setItem(namespaced(key), value);
			} catch {
				throw storageFailed("Draft text could not be written; quota may be exceeded.");
			}
		},
		removeText(key: string): void {
			try {
				storageOf().removeItem(namespaced(key));
			} catch {
				throw storageFailed("Draft text could not be removed.");
			}
		},
		clearOwnerText(): void {
			try {
				const storage = storageOf();
				const prefix = `pibo.attachments.owner.${ownerUserId}.`;
				const doomed: string[] = [];
				for (let index = 0; index < storage.length; index++) {
					const key = storage.key(index);
					if (key !== null && key.startsWith(prefix)) doomed.push(key);
				}
				for (const key of doomed) storage.removeItem(key);
			} catch {
				throw storageFailed("Draft text could not be cleared.");
			}
		},
	};
}

export function createBlobId(): string {
	const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `fallback-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
	return `blob_${random}`;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function assertBlobInput(input: { sessionId: string; draftId: string; mimeType: string; data: Uint8Array }): void {
	if (!input.sessionId || !input.draftId) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Blobs belong to exactly one session draft.", retryable: false });
	}
	if (!input.mimeType || !(input.data instanceof Uint8Array)) {
		throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Blobs require a MIME type and byte data.", retryable: false });
	}
	if (input.data.byteLength > ATTACHMENT_BLOB_MAX_BYTES) {
		throw new AttachmentDraftError({
			code: "ATT_LIMIT_EXCEEDED",
			message: `Draft blob exceeds the ${ATTACHMENT_BLOB_MAX_BYTES}-byte limit.`,
			retryable: false,
		});
	}
}

/**
 * Real IndexedDB blob store + copy buffer, owner-scoped. `factory` is
 * `indexedDB` in the browser and an injected fake in Node tests (no new
 * dependency). Model tests do not establish real-browser transaction behavior.
 * clearOwner resets active drafts/bytes/copy only: custody text backups and
 * legacy localStorage remain. It is NOT an account/browser-erasure API and
 * must not be used on logout; close() hides the active connection instead.
 * Invalid copy rows fail the whole reset closed; even an absent copy receives
 * a revision-1 tombstone, so callers must reload before staging again.
 */
export async function openAttachmentStores(factory: IndexedDbFactory, ownerUserId: string, databaseName?: string): Promise<{ blobs: AttachmentBlobStore; copy: AttachmentCopyBuffer; close(): void; clearOwner(): Promise<void> }> {
	if (!ownerUserId) throw storageFailed("Draft blob storage requires an owner user id.");
	if (!factory || typeof factory.open !== "function") throw storageFailed("Draft blob storage factory is unavailable.");
	const db = await openAttachmentDatabase(factory, databaseName);
	let closed = false;
	const close = () => { closed = true; db.close(); };
	const active = () => {
		if (closed) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Attachment byte storage is closed for this login.", retryable: false });
	};
	db.addEventListener("versionchange", close);
	const withStores = async <T>(names: string[], mode: IDBTransactionMode, run: (stores: IDBObjectStore[]) => Promise<T>): Promise<T> => {
		active();
		const result = await attachmentIdbTransaction(db, names, mode, run);
		active(); // retain an in-flight old-owner commit, but hide its result after logout
		return result;
	};
	const blobs: AttachmentBlobStore = {
		ownerUserId,
		putBlob: async (input) => {
			assertBlobInput(input);
			const blobId = input.blobId ?? createBlobId();
			const record: StoredDraftBlob = {
				blobId,
				ownerUserId,
				sessionId: input.sessionId,
				draftId: input.draftId,
				mimeType: input.mimeType,
				size: input.data.byteLength,
				createdAt: new Date().toISOString(),
				data: toArrayBuffer(input.data),
			};
			await withStores([ATTACHMENT_BLOB_STORE_NAME], "readwrite", async ([store]) => {
				try { await requestToPromise(store.add(record)); }
				catch (error) {
					if (error instanceof DOMException && error.name === "ConstraintError") {
						throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Blob ids are immutable and cannot be replaced.", retryable: false });
					}
					throw error;
				}
			});
			return { blobId, bytes: record.size };
		},
		getBlob: async (blobId) => {
			return withStores([ATTACHMENT_BLOB_STORE_NAME], "readonly", async ([store]) => {
				const found = await requestToPromise(store.get(blobId) as IDBRequest<StoredDraftBlob | undefined>);
				if (!found || found.ownerUserId !== ownerUserId) return undefined;
				return { mimeType: found.mimeType, data: new Uint8Array(found.data) };
			});
		},
		deleteBlob: async (blobId) => {
			return withStores([ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store, drafts, copies]) => {
				const found = await requestToPromise(store.get(blobId) as IDBRequest<StoredDraftBlob | undefined>);
				if (!found || found.ownerUserId !== ownerUserId) return false;
				if ((await readStoredBlobHolders(drafts, copies, ownerUserId)).has(blobId)) return false;
				await requestToPromise(store.delete(blobId));
				return true;
			});
		},
		listBlobs: async (sessionId, draftId) => {
			return withStores([ATTACHMENT_BLOB_STORE_NAME], "readonly", async ([store]) => {
				const index = store.index(ATTACHMENT_BLOB_INDEX_NAME);
				const range = draftId !== undefined
					? IDBKeyRange.only([ownerUserId, sessionId, draftId])
					: IDBKeyRange.bound([ownerUserId, sessionId, ""], [ownerUserId, sessionId, "￿"]);
				const rows = await requestToPromise(index.getAll(range) as IDBRequest<StoredDraftBlob[]>);
				return rows
					.filter((row) => row.ownerUserId === ownerUserId)
					.map((row) => ({ blobId: row.blobId, ownerUserId: row.ownerUserId, sessionId: row.sessionId, draftId: row.draftId, mimeType: row.mimeType, size: row.size, createdAt: row.createdAt }));
			});
		},
	};
	// Cleanup is in the same transaction as replacement. Legacy rows never
	// established independent byte ownership, so their source bytes are not GC'd here.
	const releaseCopyBytes = async (previous: CopyBufferState, bytes: IDBObjectStore, drafts: IDBObjectStore, copies: IDBObjectStore) => {
		if (!previous.entry?.media.length) return;
		const entry = previous.entry;
		const held = await readStoredBlobHolders(drafts, copies, ownerUserId);
		for (const media of entry.media) if (!held.has(media.draftResourceId)) {
			const blob = await requestToPromise(bytes.get(media.draftResourceId)) as StoredDraftBlob | undefined;
			if (blob?.ownerUserId === ownerUserId && blob.sessionId === entry.sourceSessionId && blob.draftId === copyHolderDraftId(entry.copyId)) await requestToPromise(bytes.delete(blob.blobId));
		}
	};
	const copy: AttachmentCopyBuffer = {
		ownerUserId,
		stage: async (expectedRevision, value) => {
			const input = captureCopyInput(value); // before the first IDB wait
			return withStores([ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([copies, bytes, drafts]) => {
				const current = readCopyBufferState(await requestToPromise(copies.get(ownerUserId)), ownerUserId);
				assertCopyRevision(current, expectedRevision);
				const rawSource = await requestToPromise(drafts.get([ownerUserId, input.sourceSessionId])) as AttachmentDraftRow | undefined;
				if (!rawSource) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Copy source draft is no longer available.", retryable: false });
				const sourceView = readCoreAttachmentDraft(checkAttachmentDraftRow(rawSource, ownerUserId, input.sourceSessionId).rawText, input.sourceSessionId);
				const source = sourceView.records.find((record) => record.envelope.id === input.sourceDraftId);
				if (!source || source.envelope.revision !== input.sourceRevision || source.envelope.type !== input.type
					|| source.envelope.schemaVersion !== input.schemaVersion || !sameCopyContent(source.payload, input.payload)
					|| !sameCopyContent(source.media ?? [], input.media)) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Copy source changed; reload before staging it.", retryable: false });
				const entry: CopyBufferEntry = { ...input, ownerUserId, stagedAt: new Date().toISOString(), media: rebaseCopyMedia(input.media, createBlobId) };
				for (let index = 0; index < input.media.length; index++) {
					const media = input.media[index]!;
					const source = requireScopedCopyBlob(await requestToPromise(bytes.get(media.draftResourceId)) as StoredDraftBlob | undefined, ownerUserId, input.sourceSessionId, input.sourceDraftId, media, ATTACHMENT_BLOB_MAX_BYTES);
					try {
						await requestToPromise(bytes.add({ ...source, blobId: entry.media[index]!.draftResourceId, draftId: copyHolderDraftId(entry.copyId), createdAt: entry.stagedAt, data: source.data.slice(0) } satisfies StoredDraftBlob));
					} catch (error) {
						if (error instanceof DOMException && error.name === "ConstraintError") throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Copy byte identity collided; reload and retry without replacing existing bytes.", retryable: false });
						throw error;
					}
				}
				const row = copyBufferRow(ownerUserId, current, entry);
				await requestToPromise(copies.put(row));
				await releaseCopyBytes(current, bytes, drafts, copies);
				return readCopyBufferState(row, ownerUserId);
			});
		},
		load: async () => withStores([ATTACHMENT_COPY_STORE_NAME], "readonly", async ([store]) => readCopyBufferState(await requestToPromise(store.get(ownerUserId)), ownerUserId)),
		clear: async (expectedRevision) => withStores([ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([copies, bytes, drafts]) => {
			const current = readCopyBufferState(await requestToPromise(copies.get(ownerUserId)), ownerUserId);
			assertCopyRevision(current, expectedRevision);
			const row = copyBufferRow(ownerUserId, current, null);
			await requestToPromise(copies.put(row));
			await releaseCopyBytes(current, bytes, drafts, copies);
			return readCopyBufferState(row, ownerUserId);
		}),
	};
	return {
		blobs,
		copy,
		close,
		// Preserve recovery text and custody; reset active data with no CAS ABA.
		clearOwner: async () => {
			await withStores([ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([blobStore, copyStore, draftStore]) => {
				const drafts = await requestToPromise(draftStore.index(ATTACHMENT_DRAFT_OWNER_INDEX).getAll(ownerUserId)) as AttachmentDraftRow[];
				for (const row of drafts) {
					checkAttachmentDraftRow(row, ownerUserId, row.sessionId);
					await requestToPromise(draftStore.put({ ...row, revision: nextAttachmentRevision(row.revision), rawText: null, updatedAt: new Date().toISOString() }));
				}
				const rows = await requestToPromise(blobStore.index(ATTACHMENT_BLOB_OWNER_INDEX).getAll(ownerUserId)) as StoredDraftBlob[];
				for (const row of rows) {
					if (row.ownerUserId === ownerUserId) await requestToPromise(blobStore.delete(row.blobId));
				}
				const copy = readCopyBufferState(await requestToPromise(copyStore.get(ownerUserId)), ownerUserId);
				await requestToPromise(copyStore.put(copyBufferRow(ownerUserId, copy, null)));
			});
		},
	};
}

/** Preview object-URL lifecycle: create from secured bytes, always revoke. */
export function createBlobPreviewUrl(data: Uint8Array, mimeType: string): string {
	try {
		const bytes = new Uint8Array(data);
		const blob = new Blob([bytes as BlobPart], { type: mimeType });
		return URL.createObjectURL(blob);
	} catch {
		throw storageFailed("Preview URL could not be created.");
	}
}

export function revokeBlobPreviewUrl(url: string): void {
	try {
		URL.revokeObjectURL(url);
	} catch {
		/* revoke is best-effort by platform contract */
	}
}

/**
 * In-memory byte-scope model for Node tests. It does not own the persisted
 * draft index: unlike IndexedDB stage it cannot check source-record freshness
 * or scan other drafts for holders. Browser tests cover those guarantees; this
 * helper is NOT a durability or full parity claim.
 */
export function createMemoryAttachmentStores(ownerUserId: string): { blobs: AttachmentBlobStore & { blobs: Map<string, StoredDraftBlob> }; copy: AttachmentCopyBuffer } {
	if (!ownerUserId) throw storageFailed("Draft blob storage requires an owner user id.");
	const blobs = new Map<string, StoredDraftBlob>();
	let copyState: CopyBufferState = { revision: 0 };
	const releaseCopyBytes = (previous: CopyBufferState) => {
		if (!previous.entry) return;
		for (const media of previous.entry.media) {
			const blob = blobs.get(media.draftResourceId);
			if (blob?.ownerUserId === ownerUserId && blob.sessionId === previous.entry.sourceSessionId && blob.draftId === copyHolderDraftId(previous.entry.copyId)) blobs.delete(blob.blobId);
		}
	};
	return {
		blobs: {
			ownerUserId,
			blobs,
			putBlob: async (input) => {
				assertBlobInput(input);
				const blobId = input.blobId ?? createBlobId();
				if (blobs.has(blobId)) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Blob ids are immutable and cannot be replaced.", retryable: false });
				blobs.set(blobId, {
					blobId, ownerUserId, sessionId: input.sessionId, draftId: input.draftId,
					mimeType: input.mimeType, size: input.data.byteLength,
					createdAt: new Date().toISOString(), data: toArrayBuffer(input.data),
				});
				return { blobId, bytes: input.data.byteLength };
			},
			getBlob: async (blobId) => {
				const found = blobs.get(blobId);
				if (!found || found.ownerUserId !== ownerUserId) return undefined;
				return { mimeType: found.mimeType, data: new Uint8Array(found.data.slice(0)) };
			},
			deleteBlob: async (blobId) => {
				const found = blobs.get(blobId);
				if (!found || found.ownerUserId !== ownerUserId) return false;
				blobs.delete(blobId);
				return true;
			},
			listBlobs: async (sessionId, draftId) => {
				const rows: DraftBlobRecord[] = [];
				for (const blob of blobs.values()) {
					if (blob.ownerUserId !== ownerUserId || blob.sessionId !== sessionId) continue;
					if (draftId !== undefined && blob.draftId !== draftId) continue;
					rows.push({ blobId: blob.blobId, ownerUserId: blob.ownerUserId, sessionId: blob.sessionId, draftId: blob.draftId, mimeType: blob.mimeType, size: blob.size, createdAt: blob.createdAt });
				}
				return rows;
			},
		},
		copy: {
			ownerUserId,
			stage: async (expectedRevision, value) => {
				const input = captureCopyInput(value);
				assertCopyRevision(copyState, expectedRevision);
				const entry: CopyBufferEntry = { ...input, ownerUserId, stagedAt: new Date().toISOString(), media: rebaseCopyMedia(input.media, createBlobId) };
				const acquired = input.media.map((media, index) => {
					const source = requireScopedCopyBlob(blobs.get(media.draftResourceId), ownerUserId, input.sourceSessionId, input.sourceDraftId, media, ATTACHMENT_BLOB_MAX_BYTES);
					const blobId = entry.media[index]!.draftResourceId;
					if (blobs.has(blobId)) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Copy byte identity already exists.", retryable: false });
					return { ...source, blobId, draftId: copyHolderDraftId(entry.copyId), createdAt: entry.stagedAt, data: source.data.slice(0) };
				});
				const next = readCopyBufferState(copyBufferRow(ownerUserId, copyState, entry), ownerUserId);
				for (const blob of acquired) blobs.set(blob.blobId, blob);
				releaseCopyBytes(copyState);
				copyState = next;
				return structuredClone(copyState);
			},
			load: async () => structuredClone(copyState),
			clear: async (expectedRevision) => {
				assertCopyRevision(copyState, expectedRevision);
				const next = readCopyBufferState(copyBufferRow(ownerUserId, copyState, null), ownerUserId);
				releaseCopyBytes(copyState);
				copyState = next;
				return structuredClone(copyState);
			},
		},
	};
}
