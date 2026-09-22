/**
 * K07 v1 draft persistence (D1-G1, productive vertical).
 *
 * Split by seam shape: draft JSON keeps the existing synchronous text seam
 * (browser: localStorage) because the abgenommene draft core is sync; draft
 * BYTES live in durable browser-local blob storage (IndexedDB) behind a small
 * async seam. JSON references blobs by id only — never base64 in JSON or uiState.
 * Upload staging (`CHAT_UPLOAD_DIR`) stays a controlled legacy reader and is
 * used at send time through the existing upload endpoint; no new server
 * draft semantics in v1.
 *
 * Scope (I-K07-04): everything is namespaced by the existing login identity
 * (`NavigationData.identity.userId`); legacy un-namespaced entries are read
 * controlled (stored drafts preserved, no silent rewrite); identity change
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

export const ATTACHMENT_BLOB_DB_NAME = "pibo-attachments-v1";
export const ATTACHMENT_BLOB_DB_VERSION = 2;
export const ATTACHMENT_BLOB_STORE_NAME = "draft-blobs";
export const ATTACHMENT_BLOB_INDEX_NAME = "by-owner-session-draft";
export const ATTACHMENT_COPY_STORE_NAME = "copy-buffers";
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

export type CopyBufferEntry = {
	ownerUserId: string;
	copyId: string;
	stagedAt: string;
	sourceSessionId: string;
	sourceDraftId: string;
	sourceRevision: number;
	payload: unknown;
	media: AttachmentDraftMedia[];
};

export type AttachmentCopyBuffer = {
	readonly ownerUserId: string;
	stage(entry: { copyId: string; sourceSessionId: string; sourceDraftId: string; sourceRevision: number; payload: unknown; media: AttachmentDraftMedia[] }): Promise<void>;
	load(): Promise<CopyBufferEntry | undefined>;
	clear(): Promise<void>;
};

export type IndexedDbFactory = {
	open(name: string, version: number): IDBOpenDBRequest;
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

/** Deletes only blobs without holders; reports deleted and kept ids. */
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
		await store.deleteBlob(blobId);
		deleted.push(blobId);
	}
	return { deleted, keptHeld };
}

/**
 * Owner-scoped browser JSON-state adapter for the sync draft seam. New writes
 * use `owner:key`; reads fall back to the legacy un-namespaced key so already
 * stored drafts keep loading (no silent rewrite, no move).
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
				const scoped = storageOf().getItem(namespaced(key));
				if (scoped !== null) return scoped;
				return storageOf().getItem(key);
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

function createBlobId(): string {
	const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `fallback-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
	return `blob_${random}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
	});
}

async function openBlobDatabase(factory: IndexedDbFactory): Promise<IDBDatabase> {
	const request = factory.open(ATTACHMENT_BLOB_DB_NAME, ATTACHMENT_BLOB_DB_VERSION);
	request.onupgradeneeded = () => {
		const db = request.result;
		if (!db.objectStoreNames.contains(ATTACHMENT_BLOB_STORE_NAME)) {
			const store = db.createObjectStore(ATTACHMENT_BLOB_STORE_NAME, { keyPath: "blobId" });
			store.createIndex(ATTACHMENT_BLOB_INDEX_NAME, ["ownerUserId", "sessionId", "draftId"], { unique: false });
		}
		if (!db.objectStoreNames.contains(ATTACHMENT_COPY_STORE_NAME)) {
			db.createObjectStore(ATTACHMENT_COPY_STORE_NAME, { keyPath: "ownerUserId" });
		}
	};
	try {
		return await requestToPromise(request as unknown as IDBRequest<IDBDatabase>);
	} catch {
		throw storageFailed("Draft blob storage could not be opened.");
	}
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
 * dependency; real IDB is proven headful).
 */
export async function openAttachmentStores(factory: IndexedDbFactory, ownerUserId: string): Promise<{ blobs: AttachmentBlobStore; copy: AttachmentCopyBuffer; clearOwner(): Promise<void> }> {
	if (!ownerUserId) throw storageFailed("Draft blob storage requires an owner user id.");
	if (!factory || typeof factory.open !== "function") throw storageFailed("Draft blob storage factory is unavailable.");
	const db = await openBlobDatabase(factory);
	const withStores = async <T>(storeNames: string[], mode: IDBTransactionMode, run: (stores: IDBObjectStore[]) => Promise<T>): Promise<T> => {
		const transaction = db.transaction(storeNames, mode);
		try {
			const result = await run(storeNames.map((name) => transaction.objectStore(name)));
			await transactionDone(transaction);
			return result;
		} catch (error) {
			try {
				transaction.abort();
			} catch {
				/* abort is best-effort after failure */
			}
			if (error instanceof AttachmentDraftError) throw error;
			throw storageFailed("Draft blob storage operation failed.");
		}
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
				await requestToPromise(store.put(record));
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
			return withStores([ATTACHMENT_BLOB_STORE_NAME], "readwrite", async ([store]) => {
				const found = await requestToPromise(store.get(blobId) as IDBRequest<StoredDraftBlob | undefined>);
				if (!found || found.ownerUserId !== ownerUserId) return false;
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
	const copy: AttachmentCopyBuffer = {
		ownerUserId,
		stage: async (entry) => {
			if (!entry.copyId || !entry.sourceSessionId || !entry.sourceDraftId) {
				throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Copy entries require copy, session, and draft ids.", retryable: false });
			}
			await withStores([ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store]) => {
				await requestToPromise(store.put({
					ownerUserId,
					copyId: entry.copyId,
					stagedAt: new Date().toISOString(),
					sourceSessionId: entry.sourceSessionId,
					sourceDraftId: entry.sourceDraftId,
					sourceRevision: entry.sourceRevision,
					payload: entry.payload,
					media: entry.media,
				} satisfies CopyBufferEntry));
			});
		},
		load: async () => {
			return withStores([ATTACHMENT_COPY_STORE_NAME], "readonly", async ([store]) => {
				const found = await requestToPromise(store.get(ownerUserId) as IDBRequest<CopyBufferEntry | undefined>);
				return found ?? undefined;
			});
		},
		clear: async () => {
			await withStores([ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store]) => {
				await requestToPromise(store.delete(ownerUserId));
			});
		},
	};
	return {
		blobs,
		copy,
		clearOwner: async () => {
			await withStores([ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([blobStore, copyStore]) => {
				const index = blobStore.index(ATTACHMENT_BLOB_INDEX_NAME);
				const rows = await requestToPromise(index.getAll(IDBKeyRange.bound([ownerUserId, "", ""], [ownerUserId, "￿", "￿"])) as IDBRequest<StoredDraftBlob[]>);
				for (const row of rows) {
					if (row.ownerUserId === ownerUserId) await requestToPromise(blobStore.delete(row.blobId));
				}
				await requestToPromise(copyStore.delete(ownerUserId));
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
 * In-memory stores implementing the same seams. Used by Node tests; NOT a
 * durability claim.
 */
export function createMemoryAttachmentStores(ownerUserId: string): { blobs: AttachmentBlobStore & { blobs: Map<string, StoredDraftBlob> }; copy: AttachmentCopyBuffer } {
	if (!ownerUserId) throw storageFailed("Draft blob storage requires an owner user id.");
	const blobs = new Map<string, StoredDraftBlob>();
	let copyEntry: CopyBufferEntry | undefined;
	return {
		blobs: {
			ownerUserId,
			blobs,
			putBlob: async (input) => {
				assertBlobInput(input);
				const blobId = input.blobId ?? createBlobId();
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
				return { mimeType: found.mimeType, data: new Uint8Array(found.data) };
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
			stage: async (entry) => {
				if (!entry.copyId || !entry.sourceSessionId || !entry.sourceDraftId) {
					throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Copy entries require copy, session, and draft ids.", retryable: false });
				}
				copyEntry = { ownerUserId, copyId: entry.copyId, stagedAt: new Date().toISOString(), sourceSessionId: entry.sourceSessionId, sourceDraftId: entry.sourceDraftId, sourceRevision: entry.sourceRevision, payload: entry.payload, media: entry.media };
			},
			load: async () => copyEntry,
			clear: async () => {
				copyEntry = undefined;
			},
		},
	};
}
