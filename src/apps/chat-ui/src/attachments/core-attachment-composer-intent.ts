import { deterministicDigest } from "../../../../shared/deterministic-digest.js";
import type { AttachmentDraftRecord } from "./core-attachment-draft.js";

/** Retry-identity hint, not an admission proof. A note add/edit/remove or
 * login-owner switch must never silently reuse a legacy/different typed txn.
 * Server binding and independent receipt remain the authoritative gates. */
export function structuredComposerIntent(records: readonly AttachmentDraftRecord[], ownerUserId: string | undefined): string | undefined {
	if (!records.length) return undefined;
	if (!ownerUserId) return undefined;
	return `sha256:${deterministicDigest({ domain: "pibo.composer.attachment-intent.v1", ownerUserId,
		records: records.map((record) => ({ id: record.envelope.id, revision: record.envelope.revision,
			type: record.envelope.type, schemaVersion: record.envelope.schemaVersion,
			payload: record.payload, media: record.media ?? [] })) })}`;
}
