import { createPiboGatewayToolProfiles } from "../gateway/tool.js";
import { InitialSessionContextBuilder, type InitialSessionContext } from "../core/profiles.js";
import { createPiboTestToolProfiles } from "./core-tools.js";
import { piboExamplePlugin } from "./example.js";
import { piboRemoteAgentPlugin } from "./remote-agent.js";
import { definePiboPlugin, PiboPluginRegistry } from "./registry.js";
import type { PiboPlugin, PiboProfileBuildContext } from "./types.js";

const CORE_PROFILE_TOOLS = ["pibo_echo", "pibo_workspace_info"] as const;
const GATEWAY_PROFILE_TOOLS = [...CORE_PROFILE_TOOLS, "pibo_gateway_send"] as const;

function createBaseProfileBuilder(
	profileName: string,
	context: PiboProfileBuildContext,
): InitialSessionContextBuilder {
	return new InitialSessionContextBuilder(profileName)
		.addSkill(context.getSkill("pi-agent-harness"))
		.addContextFile(context.getContextFile("V1 wrapper notes"))
		.addContextFile(context.getContextFile("Example workspace policy"));
}

export const piboCorePlugin = definePiboPlugin({
	id: "pibo.core",
	name: "Pibo Core",
	register(api) {
		api.registerSkill({
			name: "pi-agent-harness",
			path: ".codex/skills/pi-agent-harness/SKILL.md",
		});
		api.registerContextFile({
			label: "V1 wrapper notes",
			path: "examples/context/pibo-wrapper.md",
		});
		api.registerContextFile({
			label: "Example workspace policy",
			path: "examples/context/workspace-policy.md",
		});
		api.registerTools(createPiboTestToolProfiles());
		api.registerProfile({
			name: "pibo-minimal",
			aliases: ["minimal"],
			description: "Minimal pibo profile with the harness skill, example context, and test tools.",
			create(context) {
				return createBaseProfileBuilder("pibo-minimal", context)
					.addTools(context.getTools(CORE_PROFILE_TOOLS))
					.createSession();
			},
		});
		api.registerGatewayAction({
			name: "status",
			description: "Return current session status.",
			slashCommands: ["status"],
			execute(context) {
				return context.getStatus();
			},
		});
		api.registerGatewayAction({
			name: "session_id",
			description: "Return the routed session key.",
			slashCommands: ["session"],
			execute(context) {
				return { sessionKey: context.sessionKey };
			},
		});
		api.registerGatewayAction({
			name: "clear_queue",
			description: "Clear queued messages that have not started yet.",
			slashCommands: ["clear"],
			execute(context) {
				return { cleared: context.clearQueue() };
			},
		});
		api.registerGatewayAction({
			name: "abort",
			description: "Abort the active Pi agent run.",
			slashCommands: ["abort"],
			async execute(context) {
				await context.abort();
				return { aborted: true };
			},
		});
		api.registerGatewayAction({
			name: "dispose",
			description: "Dispose the routed session runtime.",
			hidden: true,
			async execute(context) {
				await context.dispose();
				return { disposed: true };
			},
		});
	},
});

export const piboGatewayProducerPlugin = definePiboPlugin({
	id: "pibo.gateway-producer",
	name: "Pibo Gateway Producer",
	register(api) {
		api.registerTools(createPiboGatewayToolProfiles());
		api.registerProfile({
			name: "pibo-gateway-producer",
			aliases: ["gateway-producer"],
			description: "Pibo profile that can send messages through the local gateway.",
			create(context) {
				return createBaseProfileBuilder("pibo-gateway-producer", context)
					.addTools(context.getTools(GATEWAY_PROFILE_TOOLS))
					.createSession();
			},
		});
	},
});

export function createDefaultPiboPlugins(): PiboPlugin[] {
	return [piboCorePlugin, piboGatewayProducerPlugin, piboExamplePlugin, piboRemoteAgentPlugin];
}

export function createDefaultPiboPluginRegistry(): PiboPluginRegistry {
	return PiboPluginRegistry.create({ plugins: createDefaultPiboPlugins() });
}

export function createDefaultPiboProfile(): InitialSessionContext {
	return createDefaultPiboPluginRegistry().createProfile("pibo-minimal");
}

export function createGatewayProducerPiboProfile(): InitialSessionContext {
	return createDefaultPiboPluginRegistry().createProfile("pibo-gateway-producer");
}
