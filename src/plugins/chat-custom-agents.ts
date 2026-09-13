import { createCustomAgentProfileDefinition } from "../apps/chat/agent-profiles.js";
import { CustomAgentStore, createDefaultCustomAgentStore } from "../apps/chat/agent-store.js";

export type PiboChatCustomAgentProfilesPluginOptions = {
	agentStorePath?: string;
};

export type PiboCustomAgentProfileContributionSink = {
	upsertProfile(profile: ReturnType<typeof createCustomAgentProfileDefinition>): void;
};

export function definePiboChatCustomAgentProfileContributions(
	sink: PiboCustomAgentProfileContributionSink,
	options: PiboChatCustomAgentProfilesPluginOptions = {},
): void {
	const store = options.agentStorePath ? new CustomAgentStore(options.agentStorePath) : createDefaultCustomAgentStore();
	try {
		for (const agent of store.list()) sink.upsertProfile(createCustomAgentProfileDefinition(agent));
	} finally {
		store.close();
	}
}
