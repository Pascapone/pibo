import { createRemoteAgentChannel } from "../remote/channel.js";
import { definePiboPlugin } from "./registry.js";

export const piboRemoteAgentPlugin = definePiboPlugin({
	id: "pibo.remote-agent",
	name: "Pibo Remote Agent",
	register(api) {
		api.registerChannel(createRemoteAgentChannel());
	},
});
