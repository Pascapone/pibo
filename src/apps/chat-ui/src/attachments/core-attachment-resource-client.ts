/** Stage only exact frozen owner/Session bytes through the server's scoped
 * attachment-resource route. This is private orchestration, not Composer UI.
 * Reads finish their IDB transactions before any hash, multipart or fetch. */
import { AttachmentDraftError, isAttachmentErrorCode } from "../../../../attachments/errors.js";
import { invalidJson } from "../../../../attachments/json.js";
import type { AttachmentResourceDescriptor } from "../../../../attachments/resources.js";
import { MAX_WEB_REQUEST_BODY_BYTES } from "../../../../shared/web-body-limit.js";
import { normalizeDraftClientTxnId, type AttachmentSendSnapshot } from "./core-attachment-draft.js";
import type { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft.js";

type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
function fail(code: "ATT_STORAGE_FAILED" | "ATT_BYTES_MISSING" | "ATT_LIMIT_EXCEEDED" | "ATT_ACCEPTANCE_UNKNOWN", message: string): never {
	throw new AttachmentDraftError({ code, message, retryable: code === "ATT_STORAGE_FAILED" || code === "ATT_ACCEPTANCE_UNKNOWN" });
}
function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function stageFrozenAttachmentResources(input: {
	draft: Draft;
	snapshot: AttachmentSendSnapshot;
	/** Injected for focused tests; production uses the browser's same-origin fetch. */
	fetchImpl?: typeof fetch;
}): Promise<AttachmentResourceDescriptor[]> {
	const { draft, snapshot } = input;
	if (!snapshot || snapshot.sessionId !== draft.sessionId || typeof snapshot.clientTxnId !== "string"
		|| normalizeDraftClientTxnId(snapshot.clientTxnId) !== snapshot.clientTxnId || !Array.isArray(snapshot.attachments)) {
		throw invalidJson("Staging requires this draft's exact frozen Pibo Session and normalized transaction.");
	}
	const sessionId = snapshot.sessionId;
	const clientTxnId = snapshot.clientTxnId;
	// Capture plain scope/descriptor scalars before the first storage await;
	// a caller editing the view cannot change the identity of an in-flight POST.
	const media = snapshot.attachments.flatMap((record) => (record.media ?? []).map((part) => ({
		recordId: record.id, part: { draftResourceId: part.draftResourceId, mimeType: part.mimeType, bytes: part.bytes },
	})));
	const seen = new Set<string>();
	for (const { recordId, part } of media) {
		if (!recordId || !part?.draftResourceId || seen.has(part.draftResourceId)) throw invalidJson("Frozen media identities must be unique across the whole submission.");
		seen.add(part.draftResourceId);
	}
	const descriptors: AttachmentResourceDescriptor[] = [];
	const fetchResource = input.fetchImpl ?? fetch;
	for (const { recordId, part } of media) {
		// Exact transaction-held byte authority, not owner-wide getBlob(). The
		// method returns a detached byte copy after its readonly IDB txn closes.
		const { mimeType, data } = await draft.readFrozenMedia(clientTxnId, recordId, part.draftResourceId);
		if (mimeType !== part.mimeType || data.byteLength !== part.bytes) fail("ATT_BYTES_MISSING", "Frozen media changed before preparation.");
		// The stored/blob ceiling is 15 MiB, but the *entire multipart request*
		// remains 4 MiB. No chunk or stream transport exists in this slice.
		if (data.byteLength >= MAX_WEB_REQUEST_BODY_BYTES) fail("ATT_LIMIT_EXCEEDED", "Attachment needs chunk transport; the whole HTTP request is limited to 4 MiB.");
		const byteCopy = new Uint8Array(new ArrayBuffer(data.byteLength));
		byteCopy.set(data);
		const form = new FormData();
		form.set("piboSessionId", sessionId);
		form.set("clientTxnId", clientTxnId);
		form.set("draftResourceId", part.draftResourceId);
		form.set("file", new File([byteCopy], "attachment", { type: mimeType }));
		const url = new URL("/api/chat/attachment-resources", typeof location === "undefined" ? "http://localhost" : location.origin);
		const request = new Request(url, { method: "POST", body: form });
		// Count the exact encoded envelope that fetch will send (including the
		// filename, boundaries and scope), not just the raw media byte length.
		if ((await request.clone().arrayBuffer()).byteLength > MAX_WEB_REQUEST_BODY_BYTES) {
			fail("ATT_LIMIT_EXCEEDED", "Attachment multipart body exceeds the unchanged 4 MiB HTTP limit.");
		}
		let response: Response;
		try { response = await fetchResource(request); }
		catch { fail("ATT_STORAGE_FAILED", "Attachment preparation response is unknown; retry the same scoped bytes."); }
		let body: unknown;
		try { body = await response.json(); }
		catch { body = undefined; }
		if (response.status !== 201 || !response.ok) {
			const issue = body && typeof body === "object" ? body as { code?: unknown; error?: unknown } : {};
			if (isAttachmentErrorCode(issue.code)) {
				throw new AttachmentDraftError({ code: issue.code, message: typeof issue.error === "string" ? issue.error : "Attachment preparation was rejected.", retryable: issue.code === "ATT_STORAGE_FAILED" });
			}
			const code = response.status === 400 ? "ATT_INVALID_JSON" : response.status === 403 ? "ATT_ACCESS_DENIED"
				: response.status === 404 ? "ATT_BYTES_MISSING" : response.status === 409 ? "ATT_STALE_REVISION"
				: response.status === 413 ? "ATT_LIMIT_EXCEEDED" : "ATT_STORAGE_FAILED";
			throw new AttachmentDraftError({ code, message: `Attachment preparation returned HTTP ${response.status}; retry only when storage is unavailable.`, retryable: code === "ATT_STORAGE_FAILED" });
		}
		if (body === undefined) fail("ATT_STORAGE_FAILED", "Attachment preparation response was unreadable; retry the same scoped bytes.");
		const value = body && typeof body === "object" && !Array.isArray(body) ? body as { attachmentVersion?: unknown; resource?: unknown } : {};
		const resource = value.resource && typeof value.resource === "object" && !Array.isArray(value.resource) ? value.resource as Partial<AttachmentResourceDescriptor> : {};
		const expectedHash = hex(await crypto.subtle.digest("SHA-256", byteCopy));
		if (value.attachmentVersion !== 1 || resource.draftResourceId !== part.draftResourceId
			|| resource.mimeType !== mimeType || resource.bytes !== data.byteLength || resource.sha256 !== expectedHash
			|| typeof resource.preparedUploadId !== "string" || !/^attres_[a-f0-9-]+$/.test(resource.preparedUploadId)
			|| typeof resource.name !== "string" || resource.name !== "attachment") {
			fail("ATT_BYTES_MISSING", "Prepared descriptor does not match this frozen media's server-derived bytes.");
		}
		if (resource.state !== "prepared") fail("ATT_ACCEPTANCE_UNKNOWN", "Resource is already accepted; reconcile the original transaction's receipt before retry.");
		descriptors.push({ draftResourceId: part.draftResourceId, preparedUploadId: resource.preparedUploadId,
			mimeType, bytes: data.byteLength, sha256: expectedHash, name: resource.name, state: "prepared" });
	}
	return descriptors;
}
