import type { EffectivePluginPlan } from "../plugins/contributions.js";
import type { PluginHost } from "../plugins/host.js";
import type { PluginContribution, PluginInstallation } from "../plugins/manifest.js";
import type { PluginScope } from "../plugins/scope.js";
import { getCoreAttachmentProvider } from "./core-providers.js";
import { AttachmentDraftError } from "./errors.js";
import { attachmentProviderPin, sameAttachmentProviderPin } from "./provider-pins.js";
import { assertValidAttachmentProvider } from "./providers.js";
import { ATTACHMENT_PROVIDER_KIND, ATTACHMENT_PROVIDER_RESOURCE_KIND, type AttachmentProviderLookup, type AttachmentProviderPin, type K07AttachmentProvider } from "./types.js";

export type AttachmentProviderLease = {
	lookup: AttachmentProviderLookup;
	/** Recheck after asynchronous preparation, before storage admission. */
	assertCurrent(plan?: EffectivePluginPlan): void;
	release(): Promise<void>;
};

function unavailable(message: string, stale = false): AttachmentDraftError {
	return new AttachmentDraftError({ code: stale ? "ATT_STALE_REVISION" : "ATT_PROVIDER_MISSING", message, retryable: false });
}

/**
 * A read-through of the existing host ownership index, never a provider registry.
 * Raw resource registrations must match a selected manifest declaration just as
 * declared executable contributions do. Store concurrency revisions are NOT
 * plugin artifact revisions. No runtime or generation admission is created.
 */
export async function acquireAttachmentProviders(input: {
	host?: PluginHost;
	plan?: EffectivePluginPlan;
	sessionId: string;
	transactionId: string;
	types: readonly string[];
	pins: readonly AttachmentProviderPin[];
}): Promise<AttachmentProviderLease> {
	const pins = new Map<string, AttachmentProviderPin>();
	for (const pin of input.pins) {
		if (pins.has(pin.type) || !input.types.includes(pin.type) || getCoreAttachmentProvider(pin.type)) throw unavailable("Unexpected or duplicate attachment provider pin.");
		pins.set(pin.type, { ...pin });
	}
	const bindings = new Map<string, { pin: AttachmentProviderPin; provider: K07AttachmentProvider; scopeId: string }>();
	const scopes = new Map<string, PluginScope>();
	let released = false;
	let allowDrain!: () => void;
	const drained = new Promise<void>((resolve) => { allowDrain = resolve; });

	const resolve = (type: string, plan: EffectivePluginPlan | undefined) => {
		const pin = pins.get(type);
		if (!pin || !input.host || type.startsWith("pibo.core/")) throw unavailable(`No pinned attachment provider for ${type}.`);
		const effective = attachmentProviderPin(plan, input.sessionId, type);
		if (!sameAttachmentProviderPin(pin, effective)) throw unavailable(`Attachment provider selection changed for ${type}.`, true);
		const state = input.host.inspect();
		const installation = state.plugins.find((entry) => entry.pluginId === pin.pluginId);
		if (state.state !== "active" || !installation || installation.revision !== pin.revision || installation.contentHash !== pin.contentHash) throw unavailable(`Attachment provider revision is not active for ${type}.`, true);
		const declared = installation.manifest.contributions.find((entry) => `${installation.pluginId}/${entry.id}` === pin.contributionId);
		if (declared?.kind !== ATTACHMENT_PROVIDER_KIND || declared.name !== type) throw unavailable(`Attachment provider declaration does not match ${type}.`);
		const resources = input.host.contributions.list<K07AttachmentProvider>(ATTACHMENT_PROVIDER_RESOURCE_KIND).filter((entry) => entry.key === type);
		const contributions = input.host.contributions.list<{ contribution: PluginContribution; installation: PluginInstallation; value: K07AttachmentProvider }>("contribution")
			.filter((entry) => entry.value.contribution.kind === ATTACHMENT_PROVIDER_KIND && entry.value.contribution.name === type);
		if (resources.length + contributions.length !== 1) throw unavailable(`Attachment provider is missing or ambiguous: ${type}.`);
		const registration = resources[0] ?? contributions[0];
		const executable = resources[0]?.value ?? contributions[0]?.value.value;
		if (registration.owner !== pin.pluginId || contributions.some((entry) => entry.key !== pin.contributionId || entry.value.installation.revision !== pin.revision || entry.value.installation.contentHash !== pin.contentHash)) throw unavailable(`Attachment provider owner does not match ${type}.`, true);
		if (!executable || executable.type !== type) throw unavailable(`Attachment provider identity does not match ${type}.`);
		assertValidAttachmentProvider(executable);
		return { pin, provider: executable, scopeId: registration.scopeId };
	};
	const release = async () => {
		if (!released) { released = true; allowDrain(); }
		await Promise.all([...scopes.values()].map((scope) => scope.dispose()));
	};
	try {
		for (const type of new Set(input.types)) {
			if (getCoreAttachmentProvider(type)) continue;
			const binding = resolve(type, input.plan);
			bindings.set(type, binding);
			if (!scopes.has(binding.pin.pluginId)) {
				const scope = input.host!.createSessionScope(binding.pin.pluginId, input.sessionId, `attachment-admission/${input.transactionId}`);
				// Host shutdown drains in-flight admission; ordinary removal rejects an
				// active child. Neither may dispose a provider under this request.
				scope.defer(() => drained);
				scopes.set(binding.pin.pluginId, scope);
			}
		}
		return {
			lookup(type, scope) {
				if (released || scope.sessionId !== input.sessionId || !input.types.includes(type)) return undefined;
				const core = getCoreAttachmentProvider(type);
				if (core) return core;
				const binding = bindings.get(type);
				if (!binding) return undefined;
				scopes.get(binding.pin.pluginId)!.assertOpen();
				const current = resolve(type, input.plan);
				if (current.provider !== binding.provider || current.scopeId !== binding.scopeId) throw unavailable(`Attachment provider was replaced for ${type}.`, true);
				return current.provider;
			},
			assertCurrent(plan = input.plan) {
				if (released) throw unavailable("Attachment provider admission scope has closed.");
				for (const [type, binding] of bindings) {
					scopes.get(binding.pin.pluginId)!.assertOpen();
					const current = resolve(type, plan);
					if (current.provider !== binding.provider || current.scopeId !== binding.scopeId) throw unavailable(`Attachment provider was replaced for ${type}.`, true);
				}
			},
			release,
		};
	} catch (error) {
		await release();
		throw error;
	}
}
