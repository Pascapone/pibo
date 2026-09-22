import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PayloadStore, PreparedPayload, StoredPayload } from "../data/payload-store.js";
import { AttachmentDraftError, type AttachmentErrorCode } from "./errors.js";
import type { AttachmentMessage, AttachmentMessageMedia, AttachmentResourceBinding, ResolvedAttachmentResource } from "./message.js";
import { ATTACHMENT_MEDIA_MAX_BYTES, ATTACHMENT_MEDIA_RETENTION_CLASS, type AttachmentResourceDescriptor, type AttachmentResourceScope } from "./resources.js";

/** Private IPC data created by Core, never accepted from an HTTP body or a provider. */
export type PreparedAttachmentResource = { scope: AttachmentResourceScope; name: string; payload: PreparedPayload };
type Scope = Pick<AttachmentResourceScope, "sessionId" | "clientTxnId">;
/** Resource authority needs storage, not the complete product/runtime type graph. */
type ResourceStorage = { db: DatabaseSync; payloads: PayloadStore; transaction<T>(action: () => T): T };
type GrantRow = { id: string; session_id: string; client_txn_id: string; draft_resource_id: string; payload_ref: string; name: string; message_id: string | null; created_at: string };

function fail(code: AttachmentErrorCode, message: string): never {
	throw new AttachmentDraftError({ code, message, retryable: false });
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096; }
function assertScope(scope: Scope): void {
	if (!scope || !text(scope.sessionId) || !text(scope.clientTxnId) || scope.clientTxnId !== scope.clientTxnId.trim() || scope.clientTxnId.length > 160) fail("ATT_INVALID_JSON", "Invalid attachment resource scope.");
}
function assertResourceScope(scope: AttachmentResourceScope): void {
	assertScope(scope);
	if (!text(scope.draftResourceId)) fail("ATT_INVALID_JSON", "Invalid attachment draft resource identity.");
}
function assertMedia(mimeType: string, bytes: number): void {
	if (!text(mimeType) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/i.test(mimeType) || !Number.isSafeInteger(bytes) || bytes < 0) fail("ATT_INVALID_JSON", "Invalid attachment media metadata.");
	if (bytes > ATTACHMENT_MEDIA_MAX_BYTES) fail("ATT_LIMIT_EXCEEDED", "Attachment exceeds the durable media byte limit.");
}

/** One reference per immutable grant; promotion changes ownership, not the bytes or refcount. */
export class AttachmentResourceStore {
	constructor(private readonly store: ResourceStorage) {}

	prepare(scope: AttachmentResourceScope, bytes: Uint8Array, mimeType: string, name: string): PreparedAttachmentResource {
		assertResourceScope(scope);
		if (!(bytes instanceof Uint8Array) || !text(name)) fail("ATT_INVALID_JSON", "Invalid attachment upload.");
		assertMedia(mimeType, bytes.byteLength);
		const payload = this.store.payloads.preparePayload({ value: Buffer.from(bytes), contentType: mimeType, retentionClass: ATTACHMENT_MEDIA_RETENTION_CLASS, compress: false, privateFile: true, flush: true });
		const prepared = { scope: { ...scope }, name, payload };
		this.verifyPrepared(prepared);
		return prepared;
	}

	/** Full-byte verification precedes the short metadata transaction. */
	commitPrepared(prepared: PreparedAttachmentResource, checkBeforeCommit: () => void = () => {}): AttachmentResourceDescriptor {
		this.verifyPrepared(prepared);
		checkBeforeCommit();
		return this.store.transaction(() => {
			checkBeforeCommit();
			const { scope, payload, name } = prepared;
			this.assertSession(scope.sessionId);
			const previous = this.store.db.prepare("SELECT * FROM attachment_resource_grants WHERE session_id=? AND client_txn_id=? AND draft_resource_id=?").get(scope.sessionId, scope.clientTxnId, scope.draftResourceId) as GrantRow | undefined;
			if (previous) {
				const existing = this.payload(previous);
				if (existing.sha256 !== payload.sha256 || existing.byteSize !== payload.byteSize || existing.contentType !== payload.contentType || previous.name !== name) fail("ATT_STALE_REVISION", "Attachment preparation identity is already bound to different content.");
				return this.descriptor(previous, existing);
			}
			const stored = this.store.payloads.commitPreparedPayload(payload);
			const row: GrantRow = { id: `attres_${randomUUID()}`, session_id: scope.sessionId, client_txn_id: scope.clientTxnId, draft_resource_id: scope.draftResourceId, payload_ref: stored.id, name, message_id: null, created_at: new Date().toISOString() };
			this.store.db.prepare("INSERT INTO attachment_resource_grants (id,session_id,client_txn_id,draft_resource_id,payload_ref,name,message_id,created_at) VALUES (?,?,?,?,?,?,?,?)").run(row.id, row.session_id, row.client_txn_id, row.draft_resource_id, row.payload_ref, row.name, row.message_id, row.created_at);
			return this.descriptor(row, stored);
		});
	}

	get(scope: AttachmentResourceScope, id: string): AttachmentResourceDescriptor {
		const row = this.require(scope, id);
		return this.descriptor(row, this.payload(row));
	}

	resolve(scope: Scope, binding: AttachmentResourceBinding, media: AttachmentMessageMedia): ResolvedAttachmentResource & { sha256: string } {
		if (binding.draftResourceId !== media.draftResourceId) fail("ATT_ACCESS_DENIED", "Attachment resource identity does not match its frozen media.");
		const row = this.require({ ...scope, draftResourceId: binding.draftResourceId }, binding.preparedUploadId);
		const payload = this.payload(row);
		if (payload.contentType !== media.mimeType || payload.byteSize !== media.bytes) fail("ATT_ACCESS_DENIED", "Attachment resource metadata does not match its frozen media.");
		let path: string;
		try { path = this.store.payloads.identityFilePath(payload); }
		catch { return fail("ATT_BYTES_MISSING", "Attachment media is missing or changed."); }
		return { resourceId: row.id, draftResourceId: row.draft_resource_id, mimeType: payload.contentType, bytes: payload.byteSize, sha256: payload.sha256, name: row.name, path };
	}

	/** Metadata-only history identity; receipt reconciliation must not read media files. */
	snapshotResources(scope: Scope, message: AttachmentMessage): Array<Omit<ResolvedAttachmentResource, "path"> & { sha256: string }> {
		const resources = new Map<string, Omit<ResolvedAttachmentResource, "path"> & { sha256: string }>();
		const bindings = new Map(message.resources.map((binding) => [binding.draftResourceId, binding]));
		for (const attachment of message.attachments) for (const media of attachment.media ?? []) {
			const binding = bindings.get(media.draftResourceId);
			if (!binding) fail("ATT_ACCESS_DENIED", "Attachment media has no resource binding.");
			const row = this.require({ ...scope, draftResourceId: binding.draftResourceId }, binding.preparedUploadId);
			const payload = this.payload(row);
			if (payload.contentType !== media.mimeType || payload.byteSize !== media.bytes) fail("ATT_ACCESS_DENIED", "Attachment resource metadata does not match its frozen media.");
			resources.set(media.draftResourceId, { resourceId: row.id, draftResourceId: row.draft_resource_id, mimeType: payload.contentType, bytes: payload.byteSize, sha256: payload.sha256, name: row.name });
		}
		return [...resources.values()];
	}

	/** Recheck every identity, but read each distinct immutable payload only once per admission. */
	verifyMessage(scope: Scope, message: AttachmentMessage, checkBudget: () => void = () => {}): void {
		const resources = this.snapshotResources(scope, message);
		const verified = new Set<string>();
		for (const resource of resources) {
			checkBudget();
			const resourceScope = { ...scope, draftResourceId: resource.draftResourceId };
			const row = this.require(resourceScope, resource.resourceId);
			if (!verified.has(row.payload_ref)) { this.read(resourceScope, row.id); verified.add(row.payload_ref); }
		}
		checkBudget();
	}

	/** Consumers still need an authorized scope; knowing a payload hash/path is never enough. */
	read(scope: AttachmentResourceScope, id: string): { descriptor: AttachmentResourceDescriptor; bytes: Uint8Array } {
		const row = this.require(scope, id); const payload = this.payload(row);
		try {
			this.store.payloads.identityFilePath(payload);
			return { descriptor: this.descriptor(row, payload), bytes: this.store.payloads.readPayloadBytesBounded(payload.id, ATTACHMENT_MEDIA_MAX_BYTES) };
		} catch { return fail("ATT_BYTES_MISSING", "Attachment media is missing or changed."); }
	}

	/** Must share the caller's message/receipt transaction. Files were verified beforehand. */
	promote(scope: Scope, bindings: readonly AttachmentResourceBinding[], messageId: string): void {
		if (!this.store.db.isTransaction) throw new Error("Attachment promotion requires the admission transaction.");
		assertScope(scope);
		const message = this.store.db.prepare("SELECT session_id,role FROM chat_messages WHERE id=?").get(messageId) as { session_id: string; role: string } | undefined;
		if (!message || message.session_id !== scope.sessionId || message.role !== "user") fail("ATT_ACCESS_DENIED", "Attachment history owner does not match its Session.");
		const rows = bindings.map((binding) => this.require({ ...scope, draftResourceId: binding.draftResourceId }, binding.preparedUploadId));
		if (rows.some((row) => row.message_id !== null && row.message_id !== messageId)) fail("ATT_STALE_REVISION", "Attachment resource already belongs to another accepted message.");
		for (const row of rows) this.store.db.prepare("UPDATE attachment_resource_grants SET message_id=? WHERE id=?").run(messageId, row.id);
	}

	/** Explicit discard is for unadmitted preparations, never accepted history. */
	discard(scope: Scope, bindings: readonly AttachmentResourceBinding[]): number {
		const released: StoredPayload[] = [];
		const count = this.store.transaction(() => {
			assertScope(scope); this.assertSession(scope.sessionId);
			const rows: GrantRow[] = [];
			for (const binding of bindings) {
				if (!text(binding.draftResourceId) || !text(binding.preparedUploadId)) fail("ATT_INVALID_JSON", "Invalid attachment resource binding.");
				const existing = this.store.db.prepare("SELECT * FROM attachment_resource_grants WHERE id=?").get(binding.preparedUploadId) as GrantRow | undefined;
				if (!existing) continue;
				const row = this.require({ ...scope, draftResourceId: binding.draftResourceId }, binding.preparedUploadId);
				if (row.message_id !== null) fail("ATT_ACCESS_DENIED", "Accepted attachment resources belong to product history.");
				if (!rows.some((candidate) => candidate.id === row.id)) rows.push(row);
			}
			for (const row of rows) this.release(row, released);
			return rows.length;
		});
		this.store.payloads.removeReleasedFiles(released);
		return count;
	}

	/** Caller owns the deletion transaction and unlinks returned files only after commit. */
	releaseSessions(sessionIds: readonly string[]): StoredPayload[] {
		if (!this.store.db.isTransaction) throw new Error("Attachment release requires the history deletion transaction.");
		const released: StoredPayload[] = [];
		for (const id of new Set(sessionIds)) {
			const rows = this.store.db.prepare("SELECT * FROM attachment_resource_grants WHERE session_id=?").all(id) as GrantRow[];
			for (const row of rows) this.release(row, released);
		}
		return released;
	}

	private release(row: GrantRow, released: StoredPayload[]): void {
		this.store.db.prepare("DELETE FROM attachment_resource_grants WHERE id=?").run(row.id);
		const payload = this.store.payloads.releaseReferences(row.payload_ref);
		if (payload) released.push(payload);
	}
	private verifyPrepared(prepared: PreparedAttachmentResource): void {
		if (!prepared || !prepared.scope || !prepared.payload || !text(prepared.name)) fail("ATT_INVALID_JSON", "Invalid Core attachment preparation.");
		assertResourceScope(prepared.scope);
		const p = prepared.payload;
		assertMedia(p.contentType, p.byteSize);
		if (!text(p.id) || p.retentionClass !== ATTACHMENT_MEDIA_RETENTION_CLASS || p.storageKind !== "file" || p.encoding !== "identity" || p.status !== "staged" || p.refCount !== 1 || !/^[a-f0-9]{64}$/.test(p.sha256)) fail("ATT_ACCESS_DENIED", "Invalid Core attachment payload identity.");
		try { this.store.payloads.identityFilePath(p); this.store.payloads.readPreparedPayloadBytesBounded(p, ATTACHMENT_MEDIA_MAX_BYTES); }
		catch { fail("ATT_BYTES_MISSING", "Attachment preparation has no verified durable bytes."); }
	}
	private assertSession(id: string): void {
		if (!this.store.db.prepare("SELECT 1 FROM sessions WHERE id=? AND deleted_at IS NULL").get(id)) fail("ATT_ACCESS_DENIED", "Attachment Session is unavailable.");
	}
	private require(scope: AttachmentResourceScope, id: string): GrantRow {
		assertResourceScope(scope); this.assertSession(scope.sessionId);
		if (!text(id)) fail("ATT_INVALID_JSON", "Invalid attachment resource identity.");
		const row = this.store.db.prepare("SELECT * FROM attachment_resource_grants WHERE id=?").get(id) as GrantRow | undefined;
		if (!row) return fail("ATT_BYTES_MISSING", "Attachment resource is unavailable.");
		if (row.session_id !== scope.sessionId || row.client_txn_id !== scope.clientTxnId || row.draft_resource_id !== scope.draftResourceId) fail("ATT_ACCESS_DENIED", "Attachment resource does not belong to this submission.");
		return row;
	}
	private payload(row: GrantRow): StoredPayload {
		const payload = this.store.payloads.getPayload(row.payload_ref);
		if (!payload || payload.retentionClass !== ATTACHMENT_MEDIA_RETENTION_CLASS || payload.status !== "committed" || payload.encoding !== "identity") return fail("ATT_BYTES_MISSING", "Attachment payload is unavailable.");
		assertMedia(payload.contentType, payload.byteSize);
		return payload;
	}
	private descriptor(row: GrantRow, payload: StoredPayload): AttachmentResourceDescriptor {
		return { preparedUploadId: row.id, draftResourceId: row.draft_resource_id, mimeType: payload.contentType, bytes: payload.byteSize, sha256: payload.sha256, name: row.name, state: row.message_id === null ? "prepared" : "accepted" };
	}
}
