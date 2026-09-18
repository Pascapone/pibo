import { InitialSessionContext } from "../core/profiles.js";
import { createDefaultPiboProfile, DEFAULT_PIBO_PROFILE_NAME } from "../core/default-profile.js";
import type { PiboCapabilityHost } from "../core/capability-host.js";
import { createAgentPluginSelectionForProfile } from "./selection.js";

export { createDefaultPiboProfile, DEFAULT_PIBO_PROFILE_NAME } from "../core/default-profile.js";
export { definePiboCoreContributions, provideCoreCapabilities } from "../core/capabilities.js";
export type { PiboCoreContributionSink } from "../core/capabilities.js";
export { CODEX_NATIVE_PROFILE_NAME, CODEX_NATIVE_RUNTIME_INSTANCE_ID } from "./codex-native.js";
export { MUSE_NATIVE_PROFILE_NAME, MUSE_NATIVE_RUNTIME_INSTANCE_ID } from "./muse-native.js";
export { OMP_PROFILE_NAME, OMP_RUNTIME_INSTANCE_ID } from "./omp.js";

export function selectDefaultPiboProfileName(registry: PiboCapabilityHost): string {
	const names = registry.getProfileNames();
	return names.includes(DEFAULT_PIBO_PROFILE_NAME) ? DEFAULT_PIBO_PROFILE_NAME : names[0] ?? DEFAULT_PIBO_PROFILE_NAME;
}

export function resolvePiboProfileNameFromCapabilitiesOrDefault(registry: PiboCapabilityHost, profileName?: string): string {
	const requestedProfileName = profileName ?? selectDefaultPiboProfileName(registry);
	try {
		return registry.resolveProfileName(requestedProfileName);
	} catch (error) {
		if (requestedProfileName === DEFAULT_PIBO_PROFILE_NAME) return DEFAULT_PIBO_PROFILE_NAME;
		if (requestedProfileName === "default") return selectDefaultPiboProfileName(registry);
		throw error;
	}
}

export function createPiboProfileFromCapabilitiesOrDefault(registry: PiboCapabilityHost, profileName?: string): InitialSessionContext {
	const resolvedProfileName = resolvePiboProfileNameFromCapabilitiesOrDefault(registry, profileName);
	const profile = resolvedProfileName === DEFAULT_PIBO_PROFILE_NAME && !registry.getProfileNames().includes(DEFAULT_PIBO_PROFILE_NAME)
		? createDefaultPiboProfile()
		: registry.createProfile(resolvedProfileName);
	if (profile.pluginSelection) return profile;
	const installations = registry.getPluginHost().inspect().plugins.filter((installation) =>
		installation.enabled
		&& ["active", "pending-activation"].includes(installation.state)
		&& installation.manifest.contributions.some((contribution) => contribution.scope === "agent"),
	);
	if (installations.length === 0) return profile;
	return new InitialSessionContext({
		...profile,
		pluginSelection: createAgentPluginSelectionForProfile(installations, profile),
		pluginSelectionRevision: installations.reduce((sum, installation) => sum + installation.stateRevision, 0),
	});
}
