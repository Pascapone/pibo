import { createCustomAgentProfileDefinition } from "../apps/chat/agent-profiles.js";
import { CustomAgentStore, createDefaultCustomAgentStore } from "../apps/chat/agent-store.js";
import { definePiboPlugin } from "./registry.js";

export type PiboChatCustomAgentProfilesPluginOptions = {
	agentStorePath?: string;
};

export function createPiboChatCustomAgentProfilesPlugin(options: PiboChatCustomAgentProfilesPluginOptions = {}) {
	return definePiboPlugin({
		id: "pibo.chat-custom-agent-profiles",
		name: "Pibo Chat Custom Agent Profiles",
		register(api) {
			const store = options.agentStorePath ? new CustomAgentStore(options.agentStorePath) : createDefaultCustomAgentStore();
			try {
				for (const agent of store.list()) {
					api.upsertProfile(createCustomAgentProfileDefinition(agent));
				}
			} finally {
				store.close();
			}
		},
	});
}
