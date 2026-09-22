/** Private shared IndexedDB owner. Application callers use data-only repositories,
 * not transaction callbacks. Only IDB requests may be awaited inside the helpers. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";

export const ATTACHMENT_BLOB_DB_NAME = "pibo-attachments-v1";
export const ATTACHMENT_BLOB_DB_VERSION = 3;
export const ATTACHMENT_BLOB_STORE_NAME = "draft-blobs";
export const ATTACHMENT_BLOB_INDEX_NAME = "by-owner-session-draft";
export const ATTACHMENT_BLOB_OWNER_INDEX = "by-owner";
export const ATTACHMENT_COPY_STORE_NAME = "copy-buffers";
export const ATTACHMENT_DRAFT_STORE_NAME = "draft-states";
export const ATTACHMENT_DRAFT_OWNER_INDEX = "by-owner";
export const ATTACHMENT_LEGACY_CLAIM_STORE_NAME = "legacy-claims";
export const ATTACHMENT_LEGACY_BACKUP_STORE_NAME = "legacy-text-backups";
export type IndexedDbFactory = { open(name: string, version: number): IDBOpenDBRequest };
export type AttachmentDraftRow = {
	ownerUserId: string;
	sessionId: string;
	revision: number;
	writerEpoch: string;
	updatedAt: string;
	rawText: string | null;
};

export function nextAttachmentRevision(revision: number): number {
	if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
		throw new AttachmentDraftError({ code: "ATT_LIMIT_EXCEEDED", message: "Attachment storage revision limit reached.", retryable: false });
	}
	return revision + 1;
}

export function checkAttachmentDraftRow(value: AttachmentDraftRow, ownerUserId: string, sessionId: string): AttachmentDraftRow {
	if (value.ownerUserId !== ownerUserId || value.sessionId !== sessionId
		|| !Number.isSafeInteger(value.revision) || value.revision < 1
		|| (value.rawText !== null && typeof value.rawText !== "string")
		|| typeof value.writerEpoch !== "string" || !value.writerEpoch
		|| typeof value.updatedAt !== "string" || !value.updatedAt) {
		throw attachmentStorageFailed("Stored attachment draft scope or revision is invalid.");
	}
	return value;
}

export function attachmentStorageFailed(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_STORAGE_FAILED", message, retryable: true });
}

export function attachmentIdbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? attachmentStorageFailed("IndexedDB request failed."));
	});
}

export function openAttachmentDatabase(factory: IndexedDbFactory, name = ATTACHMENT_BLOB_DB_NAME): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (!factory || typeof factory.open !== "function" || typeof name !== "string" || !name) {
			reject(attachmentStorageFailed("Attachment storage factory or database name is unavailable."));
			return;
		}
		let request: IDBOpenDBRequest;
		try { request = factory.open(name, ATTACHMENT_BLOB_DB_VERSION); }
		catch { reject(attachmentStorageFailed("Attachment database could not be opened.")); return; }
		let settled = false;
		const fail = (message: string) => {
			if (settled) return;
			settled = true;
			reject(attachmentStorageFailed(message));
		};
		request.onblocked = () => fail("Attachment database upgrade is blocked by another open tab. Close or reload that tab and retry.");
		request.onerror = () => fail("Attachment database could not be opened.");
		request.onupgradeneeded = () => {
			// A blocked request cannot be cancelled. Do not upgrade later after
			// its caller has already observed failure and abandoned the request.
			if (settled) { request.transaction?.abort(); return; }
			const db = request.result;
			if (!db.objectStoreNames.contains(ATTACHMENT_BLOB_STORE_NAME)) {
				const store = db.createObjectStore(ATTACHMENT_BLOB_STORE_NAME, { keyPath: "blobId" });
				store.createIndex(ATTACHMENT_BLOB_INDEX_NAME, ["ownerUserId", "sessionId", "draftId"], { unique: false });
			}
			const blobs = request.transaction!.objectStore(ATTACHMENT_BLOB_STORE_NAME);
			if (!blobs.indexNames.contains(ATTACHMENT_BLOB_OWNER_INDEX)) {
				blobs.createIndex(ATTACHMENT_BLOB_OWNER_INDEX, "ownerUserId", { unique: false });
			}
			if (!db.objectStoreNames.contains(ATTACHMENT_COPY_STORE_NAME)) {
				db.createObjectStore(ATTACHMENT_COPY_STORE_NAME, { keyPath: "ownerUserId" });
			}
			if (!db.objectStoreNames.contains(ATTACHMENT_DRAFT_STORE_NAME)) {
				const store = db.createObjectStore(ATTACHMENT_DRAFT_STORE_NAME, { keyPath: ["ownerUserId", "sessionId"] });
				store.createIndex(ATTACHMENT_DRAFT_OWNER_INDEX, "ownerUserId", { unique: false });
			}
			if (!db.objectStoreNames.contains(ATTACHMENT_LEGACY_CLAIM_STORE_NAME)) {
				db.createObjectStore(ATTACHMENT_LEGACY_CLAIM_STORE_NAME, { keyPath: "sourceKey" });
			}
			if (!db.objectStoreNames.contains(ATTACHMENT_LEGACY_BACKUP_STORE_NAME)) {
				db.createObjectStore(ATTACHMENT_LEGACY_BACKUP_STORE_NAME, { keyPath: ["ownerUserId", "sourceKey"] });
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			if (settled) { db.close(); return; }
			settled = true;
			db.onversionchange = () => db.close();
			resolve(db);
		};
	});
}

/** Internal only: action must await IDB requests exclusively. Completion/error
 * listeners are installed BEFORE issuing requests, never after action returns. */
export async function attachmentIdbTransaction<T>(
	db: IDBDatabase, names: string[], mode: IDBTransactionMode,
	action: (stores: IDBObjectStore[]) => Promise<T>,
): Promise<T> {
	let transaction: IDBTransaction | undefined;
	let done: Promise<void> | undefined;
	try {
		transaction = db.transaction(names, mode);
		const active = transaction;
		done = new Promise<void>((resolve, reject) => {
			active.oncomplete = () => resolve();
			active.onabort = () => reject(active.error ?? attachmentStorageFailed("Attachment transaction aborted."));
			active.onerror = () => reject(active.error ?? attachmentStorageFailed("Attachment transaction failed."));
		});
		// Observe early transaction failure even while an individual request is pending.
		void done.catch(() => undefined);
		const result = await action(names.map((name) => active.objectStore(name)));
		await done;
		return result;
	} catch (error) {
		try { transaction?.abort(); } catch { /* already terminal */ }
		if (done) await done.catch(() => undefined);
		if (error instanceof AttachmentDraftError) throw error;
		throw attachmentStorageFailed("Attachment database operation failed; no success was confirmed.");
	}
}
