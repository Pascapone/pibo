import type { EffectivePluginPlan } from "../plugins/contributions.js";
import { AttachmentDraftError } from "./errors.js";
import { ATTACHMENT_PROVIDER_KIND, type AttachmentProviderPin } from "./types.js";

/** The effective list, not runtime delivery reports, owns selection at freeze. */
export function attachmentProviderPin(plan: EffectivePluginPlan | undefined, sessionId: string, type: string): AttachmentProviderPin {
	if (!plan?.valid || plan.piboSessionId !== sessionId) throw unavailable(type);
	const entries = plan.contributions.filter((entry) => entry.contribution.kind === ATTACHMENT_PROVIDER_KIND && entry.contribution.name === type);
	if (entries.length !== 1) throw unavailable(type);
	const entry = entries[0];
	const installation = plan.plugins.find((plugin) => plugin.pluginId === entry.pluginId && plugin.revision === entry.pluginRevision);
	if (!installation) throw unavailable(type);
	return { type, pluginId: entry.pluginId, contributionId: entry.id, revision: installation.revision, contentHash: installation.contentHash };
}

export function sameAttachmentProviderPin(left: AttachmentProviderPin, right: AttachmentProviderPin): boolean {
	return left.type === right.type && left.pluginId === right.pluginId && left.contributionId === right.contributionId
		&& left.revision === right.revision && left.contentHash === right.contentHash;
}

function unavailable(type: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: `Attachment provider is not selected for this session: ${type}`, retryable: false });
}
