import { AttachmentResourceStore } from "../../attachments/resource-store.js";
import { isAttachmentErrorCode } from "../../attachments/errors.js";
import type { AttachmentResourceScope } from "../../attachments/resources.js";
import type { PiboDataStore } from "../../data/pibo-store.js";
import type { AsyncChatStorage } from "../../data/async-chat-storage.js";
import { PiboWebHttpError, responseJson } from "../../web/http.js";
import { imageMimeTypeFromBytes, TRACE_IMAGE_MAX_DECODED_BYTES } from "./trace-v2.js";

/** Caller enforces login and same-origin mutation guards before entering this route. */
export async function handleAttachmentResourceRequest(input: {
	request: Request; url: URL; prefix: string; store: PiboDataStore; storage: AsyncChatStorage;
	authorizeSession: (sessionId: string, mutation: boolean) => Promise<{ roomId: string }>;
}): Promise<Response> {
	try {
		const { request, url } = input; const resources = new AttachmentResourceStore(input.store);
		if (url.pathname === input.prefix && request.method === "POST") {
			const form = await request.formData();
			for (const key of form.keys()) if (!["piboSessionId", "clientTxnId", "draftResourceId", "file"].includes(key) || form.getAll(key).length !== 1) throw new PiboWebHttpError("Invalid attachment upload fields", 400);
			const field = (key: string) => { const value = form.get(key); if (typeof value !== "string" || !value) throw new PiboWebHttpError("Attachment upload scope is required", 400); return value; };
			const scope: AttachmentResourceScope = { sessionId: field("piboSessionId"), clientTxnId: field("clientTxnId"), draftResourceId: field("draftResourceId") };
			const { roomId } = await input.authorizeSession(scope.sessionId, true);
			const file = form.get("file");
			if (!(file instanceof File)) throw new PiboWebHttpError("Exactly one attachment file is required", 400);
			const prepared = resources.prepare(scope, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream", file.name || "attachment");
			const resource = await input.storage.stageAttachment(prepared, roomId);
			return responseJson({ attachmentVersion: 1, resource }, { status: 201, headers: { "cache-control": "no-store" } });
		}
		if (!url.pathname.startsWith(`${input.prefix}/`) || !["GET", "DELETE"].includes(request.method)) throw new PiboWebHttpError("Attachment resource route not found", 404);
		const id = url.pathname.slice(input.prefix.length + 1);
		if (!/^attres_[a-f0-9-]+$/.test(id)) throw new PiboWebHttpError("Attachment resource not found", 404);
		for (const key of url.searchParams.keys()) if (!["piboSessionId", "clientTxnId", "draftResourceId", "metadata", "preview"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new PiboWebHttpError("Invalid attachment resource scope", 400);
		const scope = { sessionId: url.searchParams.get("piboSessionId") ?? "", clientTxnId: url.searchParams.get("clientTxnId") ?? "", draftResourceId: url.searchParams.get("draftResourceId") ?? "" };
		if (!scope.sessionId || !scope.clientTxnId || !scope.draftResourceId) throw new PiboWebHttpError("Attachment resource scope is required", 400);
		await input.authorizeSession(scope.sessionId, request.method !== "GET");
		if (request.method === "DELETE") {
			const removed = await input.storage.discardAttachments(scope, [{ draftResourceId: scope.draftResourceId, preparedUploadId: id }]);
			return responseJson({ removed }, { headers: { "cache-control": "no-store" } });
		}
		if (url.searchParams.get("metadata") === "1") return responseJson({ attachmentVersion: 1, resource: resources.get(scope, id) }, { headers: { "cache-control": "no-store" } });
		const { descriptor, bytes } = resources.read(scope, id);
		const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
		if (url.searchParams.get("preview") === "1") {
			if (bytes.byteLength > TRACE_IMAGE_MAX_DECODED_BYTES) throw new PiboWebHttpError("Attachment image is too large for preview", 413);
			const detected = imageMimeTypeFromBytes(Buffer.from(bytes));
			if (!detected || detected !== descriptor.mimeType) throw new PiboWebHttpError("Attachment image preview is unavailable", 415);
			headers["content-type"] = detected; headers["content-disposition"] = "inline";
		} else {
			// Untrusted HTML/SVG and other active formats are never served inline.
			const name = Buffer.from([...descriptor.name].slice(0, 200).join("")).toString("utf8");
			const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
			headers["content-type"] = "application/octet-stream"; headers["content-disposition"] = `attachment; filename*=UTF-8''${encoded}`;
		}
		return new Response(new Uint8Array(bytes), { headers });
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
		if (isAttachmentErrorCode(code)) {
			const status = code === "ATT_ACCESS_DENIED" ? 403 : code === "ATT_BYTES_MISSING" ? 404 : code === "ATT_STALE_REVISION" ? 409 : code === "ATT_LIMIT_EXCEEDED" ? 413 : code === "ATT_STORAGE_FAILED" ? 503 : 400;
			return responseJson({ error: error instanceof Error ? error.message : "Attachment resource is unavailable.", code }, { status, headers: { "cache-control": "no-store" } });
		}
		if (code === "room_not_found") throw new PiboWebHttpError("Room not found", 404);
		if (code === "room_read_only") throw new PiboWebHttpError("Archived rooms are read-only", 403);
		if (code.startsWith("storage_")) return responseJson({ error: "Attachment storage unavailable; retry the same preparation identity.", code }, { status: 503, headers: { "retry-after": "1", "cache-control": "no-store" } });
		throw error;
	}
}
