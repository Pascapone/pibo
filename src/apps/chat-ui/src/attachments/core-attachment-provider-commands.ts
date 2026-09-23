/** Provider-aware commands for the private transactional browser draft. The
 * selected browser host supplies lookup/pins; no provider or network callback
 * runs inside the IndexedDB transaction. Composer wiring is separate. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { assertJsonValue, cloneJson, invalidJson } from "../../../../attachments/json.js";
import { createProviderRegistryClient, requireSynchronousProviderResult } from "../../../../attachments/providers.js";
import type { AttachmentProviderLookup, AttachmentProviderPin, AttachmentProviderScope, K07AttachmentProvider } from "../../../../attachments/types.js";
import { canonicalJson } from "../../../../shared/deterministic-digest.js";
import { normalizeDraftClientTxnId, type AttachmentDraftMedia, type AttachmentId, type AttachmentSendSnapshot } from "./core-attachment-draft.js";
import type { AttachmentDraftBlobInput } from "./core-attachment-indexed-draft.js";
import { ATTACHMENT_BLOB_MAX_BYTES } from "./core-attachment-persistence.js";
import { sameAttachmentProviderPin } from "../../../../attachments/provider-pins.js";
import type { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft.js";

type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
type PinLookup = (type: string, scope: AttachmentProviderScope) => AttachmentProviderPin | undefined;

type ProviderCommandContext = {
	draft: Draft;
	lookup: AttachmentProviderLookup;
	scope: AttachmentProviderScope;
};

function bound(input: ProviderCommandContext): void {
	if (!input.scope || typeof input.scope.sessionId !== "string" || !input.scope.sessionId || input.scope.sessionId !== input.draft.sessionId) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Provider selection and draft must belong to the same Pibo Session.", retryable: false });
	}
}
function expectedRevision(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw invalidJson("Expected draft revision must be a non-negative safe integer.");
}

/** The UI source is plain metadata. Bytes are acquired separately and never
 * passed to a plugin snapshot as an authority or stored in JSON. */
function sourceCopy(source: unknown): unknown {
	assertJsonValue(source, "Attachment source metadata");
	return cloneJson(source);
}

function payloadFor(input: ProviderCommandContext, type: string, schemaVersion: number, source: unknown): unknown {
	const providers = createProviderRegistryClient(input.lookup, input.scope);
	const provider = providers.require(type);
	const captured = sourceCopy(source);
	const payload = requireSynchronousProviderResult(provider.snapshot(captured), "snapshot");
	assertJsonValue(payload, "Provider snapshot");
	const detached = cloneJson(payload);
	// A plugin's validation callback may mutate its argument. Never store the
	// mutable validation argument in the canonical draft.
	providers.validatePayload(type, schemaVersion, cloneJson(detached));
	return detached;
}

function capturedMedia(media: readonly AttachmentDraftMedia[] | undefined, newBlobs: readonly AttachmentDraftBlobInput[] | undefined): {
	media: AttachmentDraftMedia[] | undefined;
	blobs: AttachmentDraftBlobInput[];
} {
	if (media !== undefined && !Array.isArray(media)) throw invalidJson("Attachment media must be a list.");
	if (newBlobs !== undefined && !Array.isArray(newBlobs)) throw invalidJson("Attachment bytes must be a list.");
	const seen = new Set<string>();
	const descriptors = (media ?? []).map((part) => {
		if (!part || typeof part.draftResourceId !== "string" || !part.draftResourceId || part.draftResourceId.length > 4096 || seen.has(part.draftResourceId)
			|| typeof part.mimeType !== "string" || part.mimeType.length > 4096
			|| !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/i.test(part.mimeType)
			|| !Number.isSafeInteger(part.bytes) || part.bytes < 0 || part.bytes > ATTACHMENT_BLOB_MAX_BYTES) {
			throw invalidJson("Attachment media must have unique byte ids, MIME types and bounded lengths.");
		}
		seen.add(part.draftResourceId);
		return { draftResourceId: part.draftResourceId, mimeType: part.mimeType, bytes: part.bytes };
	});
	const byId = new Map(descriptors.map((part) => [part.draftResourceId, part]));
	const supplied = new Set<string>();
	const blobs = (newBlobs ?? []).map((part) => {
		if (!part || typeof part.blobId !== "string" || supplied.has(part.blobId) || !(part.data instanceof Uint8Array)
			|| !byId.has(part.blobId) || byId.get(part.blobId)!.mimeType !== part.mimeType
			|| byId.get(part.blobId)!.bytes !== part.data.byteLength) {
			throw invalidJson("New attachment bytes must match exactly one scoped media descriptor.");
		}
		supplied.add(part.blobId);
		return { blobId: part.blobId, mimeType: part.mimeType, data: new Uint8Array(part.data) };
	});
	if (supplied.size !== descriptors.length) {
		throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Each new media descriptor needs acquired bytes.", retryable: false });
	}
	return { media: media === undefined ? undefined : descriptors, blobs };
}

/** Snapshot/validate synchronously before the first storage await. The draft
 * transaction alone decides the storage revision and atomically owns bytes. */
export async function addWithProvider(input: ProviderCommandContext & {
	expectedRevision: number;
	type: string;
	schemaVersion: number;
	source: unknown;
	uiState?: unknown;
	media?: readonly AttachmentDraftMedia[];
	newBlobs?: readonly AttachmentDraftBlobInput[];
}): Promise<{ attachmentId: AttachmentId; revision: number }> {
	bound(input); expectedRevision(input.expectedRevision);
	if (typeof input.type !== "string" || !input.type || !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) throw invalidJson("Attachment type/schema must be declared before provider snapshot.");
	const payload = payloadFor(input, input.type, input.schemaVersion, input.source);
	const { media, blobs } = capturedMedia(input.media, input.newBlobs);
	const outcome = await input.draft.execute(input.expectedRevision, { kind: "add", input: {
		sessionId: input.scope.sessionId, type: input.type, schemaVersion: input.schemaVersion, payload,
		...(input.uiState !== undefined ? { uiState: sourceCopy(input.uiState) } : {}),
		...(media !== undefined ? { media } : {}),
	} }, blobs);
	return { attachmentId: outcome.result, revision: outcome.current.revision };
}

/** Update keeps the record's existing media identity. Media replacement is
 * intentionally not represented as an update of an immutable blob row. */
export async function updateWithProvider(input: ProviderCommandContext & {
	expectedRevision: number;
	id: AttachmentId;
	expectedRecordRevision: number;
	source: unknown;
}): Promise<{ revision: number }> {
	bound(input); expectedRevision(input.expectedRevision);
	const captured = sourceCopy(input.source);
	const current = await input.draft.load();
	if (current.revision !== input.expectedRevision) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Draft changed; reload before editing.", retryable: false });
	const record = current.view.records.find((item) => item.envelope.id === input.id);
	if (!record || record.envelope.revision !== input.expectedRecordRevision) {
		throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Attachment revision changed; reload before editing.", retryable: false });
	}
	const payload = payloadFor(input, record.envelope.type, record.envelope.schemaVersion, captured);
	const result = await input.draft.execute(input.expectedRevision,
		{ kind: "update", id: input.id, expectedRevision: input.expectedRecordRevision, expectedType: record.envelope.type,
			expectedSchemaVersion: record.envelope.schemaVersion, next: { payload } });
	return { revision: result.current.revision };
}

function checkedPin(type: string, scope: AttachmentProviderScope, getPin: PinLookup): AttachmentProviderPin | undefined {
	if (type.startsWith("pibo.core/")) return undefined;
	const pin = getPin(type, scope);
	if (!pin || pin.type !== type || ![pin.pluginId, pin.contributionId, pin.revision, pin.contentHash].every((item) => typeof item === "string" && !!item)) {
		throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: `Provider pin unavailable for ${type}.`, retryable: false });
	}
	return { type: pin.type, pluginId: pin.pluginId, contributionId: pin.contributionId, revision: pin.revision, contentHash: pin.contentHash };
}

/** Validate a bound frozen value using only the selected Pibo Session's
 * current provider authority. The returned assertion rechecks executable and
 * pin identity after each network boundary, never inside an IDB transaction. */
export function preflightFrozenProviderPins(input: {
	snapshot: Pick<AttachmentSendSnapshot, "sessionId" | "attachments">;
	lookup: AttachmentProviderLookup;
	scope: AttachmentProviderScope;
	getPin: PinLookup;
}): { pins: AttachmentProviderPin[]; assertCurrent(): void } {
	if (input.snapshot.sessionId !== input.scope.sessionId || !Array.isArray(input.snapshot.attachments)) {
		throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Frozen attachments belong to another Pibo Session.", retryable: false });
	}
	const providers = createProviderRegistryClient(input.lookup, input.scope);
	const pins = new Map<string, AttachmentProviderPin>();
	const executables = new Map<string, K07AttachmentProvider>();
	for (const record of input.snapshot.attachments) {
		const type = record.type;
		const provider = providers.require(type);
		const earlier = executables.get(type);
		if (earlier && earlier !== provider) throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Provider implementation changed during freeze.", retryable: false });
		executables.set(type, provider);
		providers.validatePayload(type, record.schemaVersion, cloneJson(record.payload));
		const pin = checkedPin(type, input.scope, input.getPin);
		if (pin) {
			const old = pins.get(type);
			if (old && !sameAttachmentProviderPin(old, pin)) throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Provider selection changed during freeze.", retryable: false });
			pins.set(type, pin);
		}
	}
	const assertCurrent = () => {
		for (const [type, provider] of executables) {
			if (providers.require(type) !== provider) throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Provider implementation changed after freeze.", retryable: false });
			const pin = pins.get(type);
			if (pin) {
				const after = checkedPin(type, input.scope, input.getPin);
				if (!after || !sameAttachmentProviderPin(pin, after)) throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Provider selection changed after freeze; do not send this transaction.", retryable: false });
			}
		}
	};
	return { pins: [...pins.values()], assertCurrent };
}

/** Preflight selected providers outside IDB. Never splice new pins into an
 * existing prepared body; retry its original captured request unchanged. */
export async function freezeWithProviderPins(input: ProviderCommandContext & {
	expectedRevision: number;
	getPin: PinLookup;
	clientTxnId: string;
	text: string;
}): Promise<{ snapshot: AttachmentSendSnapshot; pins: AttachmentProviderPin[]; revision: number }> {
	bound(input); expectedRevision(input.expectedRevision);
	normalizeDraftClientTxnId(input.clientTxnId);
	if (typeof input.text !== "string") throw invalidJson("Frozen message text must be a string.");
	const current = await input.draft.load();
	if (current.revision !== input.expectedRevision) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Draft changed before provider validation; reload before freezing.", retryable: false });
	const original = current.view.records.map((record) => ({ id: record.envelope.id, revision: record.envelope.revision,
		type: record.envelope.type, schemaVersion: record.envelope.schemaVersion, payload: record.payload,
		...(record.media !== undefined ? { media: record.media } : {}) }));
	const authority = preflightFrozenProviderPins({ snapshot: { sessionId: input.scope.sessionId, attachments: original },
		lookup: input.lookup, scope: input.scope, getPin: input.getPin });
	const result = await input.draft.execute(input.expectedRevision, { kind: "freeze", clientTxnId: input.clientTxnId, text: input.text });
	if (result.result.sessionId !== input.scope.sessionId || result.result.text !== input.text
		|| canonicalJson(original) !== canonicalJson(result.result.attachments)) {
		throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Frozen content changed after provider validation; do not send this transaction.", retryable: false });
	}
	authority.assertCurrent();
	return { snapshot: result.result, pins: authority.pins, revision: result.current.revision };
}
