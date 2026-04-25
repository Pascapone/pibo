import { runGatewayClient } from "./gateway/client.js";
import { runGatewayServer } from "./gateway/server.js";
import { runRemoteAgentClient } from "./remote/client.js";
import { runRemoteAgentTui } from "./remote/examples/tui-controller.js";
import { createDefaultPiboPluginRegistry } from "./plugins/builtin.js";
import type { InitialSessionContext } from "./core/profiles.js";
import { inspectPiboProfile, runPiboTui } from "./core/runtime.js";
import { PiboSessionRouter } from "./core/session-router.js";

export {
	createDefaultPiboProfile,
	createDefaultPiboPluginRegistry,
	createDefaultPiboPlugins,
	createGatewayProducerPiboProfile,
	piboCorePlugin,
	piboGatewayProducerPlugin,
} from "./plugins/builtin.js";
export { piboExamplePlugin } from "./plugins/example.js";
export { piboRemoteAgentPlugin } from "./plugins/remote-agent.js";
export {
	InitialSessionContext,
	InitialSessionContextBuilder,
} from "./core/profiles.js";
export type { BuiltinToolsMode, ContextFileProfile, InitialSessionContextOptions, SkillProfile, ToolProfile } from "./core/profiles.js";
export { definePiboPlugin, PiboPluginRegistry } from "./plugins/registry.js";
export type { PiboPluginRegistryOptions } from "./plugins/registry.js";
export type {
	PiboChannel,
	PiboChannelAuth,
	PiboChannelAuthMode,
	PiboChannelContext,
	PiboChannelKind,
} from "./channels/types.js";
export type {
	PiboGatewayAction,
	PiboGatewayActionContext,
	PiboGatewayActionInfo,
	PiboPlugin,
	PiboPluginApi,
	PiboPluginEventListener,
	PiboProfileBuildContext,
	PiboProfileDefinition,
} from "./plugins/types.js";
export { createPiboGatewayToolProfiles } from "./gateway/tool.js";
export { createPiboTestToolProfiles } from "./plugins/core-tools.js";
export { createPiboRuntime, inspectPiboProfile, runPiboTui } from "./core/runtime.js";
export type { PiboProfileInspection, PiboRuntimeOptions } from "./core/runtime.js";
export { PiboSessionRouter } from "./core/session-router.js";
export { PiboGatewayServer, runGatewayServer } from "./gateway/server.js";
export { runGatewayClient } from "./gateway/client.js";
export { runRemoteAgentClient } from "./remote/client.js";
export {
	createRemoteSlashCommandMap,
	RemoteAgentSessionClient,
} from "./remote/session-client.js";
export type {
	AttachedRemoteAgent,
	RemoteAgentEventListener,
	RemoteAgentSessionClientOptions,
} from "./remote/session-client.js";
export { createRemoteAgentChannel } from "./remote/channel.js";
export type { RemoteAgentChannel, RemoteAgentChannelOptions } from "./remote/channel.js";
export {
	DEFAULT_REMOTE_AGENT_HOST,
	DEFAULT_REMOTE_AGENT_PORT,
	REMOTE_AGENT_CHANNEL_NAME,
} from "./remote/protocol.js";
export type {
	RemoteAgentAttachRequestFrame,
	RemoteAgentAttachedPayload,
	RemoteAgentCapabilities,
	RemoteAgentCapabilitiesRequestFrame,
	RemoteAgentEventFrame,
	RemoteAgentFrame,
	RemoteAgentInput,
	RemoteAgentInputRequestFrame,
	RemoteAgentRequestFrame,
	RemoteAgentResponseFrame,
} from "./remote/protocol.js";
export { sendGatewayEvent, sendGatewayMessageAndWaitForReply } from "./gateway/request.js";
export type {
	BuiltinPiboExecutionAction,
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./core/events.js";
export type {
	PiboSessionBinding,
	PiboSessionBindingStore,
	ResolveSessionBindingInput,
} from "./sessions/bindings.js";
export type { PiboSessionRouterOptions } from "./core/session-router.js";

function createCliProfile(profileName?: string): InitialSessionContext {
	return createDefaultPiboPluginRegistry().createProfile(profileName ?? "pibo-minimal");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const command = process.argv[2] ?? "profile";

	if (command === "tui") {
		await runPiboTui({ profile: createCliProfile(process.argv[3]) });
	} else if (command === "profile") {
		const inspection = await inspectPiboProfile({ profile: createCliProfile(process.argv[3]) });
		console.log(JSON.stringify(inspection, null, 2));
	} else if (command === "router") {
		const router = new PiboSessionRouter({ persistSession: false });
		const event = await router.emit({
			type: "execution",
			sessionKey: process.argv[3] ?? "demo",
			action: "status",
		});
		console.log(JSON.stringify(event, null, 2));
		await router.disposeAll();
	} else if (command === "gateway") {
		await runGatewayServer();
	} else if (command === "client") {
		await runGatewayClient({ sessionKey: process.argv[3] ?? "default" });
	} else if (command === "remote") {
		await runRemoteAgentTui({
			sessionName: process.argv[3] ?? "default",
			profile: process.argv[4],
		});
	} else if (command === "remote-line") {
		await runRemoteAgentClient({
			sessionName: process.argv[3] ?? "default",
			profile: process.argv[4],
		});
	} else {
		console.error(`Unknown command: ${command}`);
		process.exitCode = 1;
	}
}
