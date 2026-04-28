import { createPiboGatewayToolProfiles } from "../gateway/tool.js";
import type {
	PiboExecutionEvent,
	PiboJsonObject,
	PiboSessionForkParams,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboThinkingParams,
} from "../core/events.js";
import { InitialSessionContextBuilder, type InitialSessionContext } from "../core/profiles.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";
import { createPiboTestToolProfiles } from "./core-tools.js";
import { piboExamplePlugin } from "./example.js";
import { definePiboPlugin, PiboPluginRegistry } from "./registry.js";
import type { PiboPlugin, PiboProfileBuildContext } from "./types.js";

const CORE_PROFILE_TOOLS = ["pibo_echo", "pibo_workspace_info", "pibo_exec"] as const;
const GATEWAY_PROFILE_TOOLS = [...CORE_PROFILE_TOOLS, "pibo_gateway_send"] as const;
const RUN_YIELD_QA_SUBAGENTS = ["qa-researcher", "qa-reviewer"] as const;

function getObjectParams(event: PiboExecutionEvent): PiboJsonObject | undefined {
	const params = "params" in event ? event.params : undefined;
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	return params;
}

function requireForkParams(event: PiboExecutionEvent): PiboSessionForkParams {
	const params = getObjectParams(event);
	if (!params || typeof params.entryId !== "string" || params.entryId.length === 0) {
		throw new Error("session.fork requires params.entryId");
	}
	return { entryId: params.entryId };
}

function requireTreeNavigateParams(event: PiboExecutionEvent): PiboSessionTreeNavigateParams {
	const raw = getObjectParams(event);
	if (!raw || typeof raw.entryId !== "string" || raw.entryId.length === 0) {
		throw new Error("session.tree_navigate requires params.entryId");
	}

	const params: PiboSessionTreeNavigateParams = { entryId: raw.entryId };
	if (typeof raw.summarize === "boolean") params.summarize = raw.summarize;
	if (typeof raw.customInstructions === "string") params.customInstructions = raw.customInstructions;
	if (typeof raw.replaceInstructions === "boolean") params.replaceInstructions = raw.replaceInstructions;
	if (typeof raw.label === "string") params.label = raw.label;
	return params;
}

function requireSwitchParams(event: PiboExecutionEvent): PiboSessionSwitchParams {
	const raw = getObjectParams(event);
	if (!raw || typeof raw.sessionFile !== "string" || raw.sessionFile.length === 0) {
		throw new Error("session.switch requires params.sessionFile");
	}

	const params: PiboSessionSwitchParams = { sessionFile: raw.sessionFile };
	if (typeof raw.cwdOverride === "string") params.cwdOverride = raw.cwdOverride;
	return params;
}

function getThinkingParams(event: PiboExecutionEvent): PiboThinkingParams {
	const raw = getObjectParams(event);
	if (!raw || raw.level === undefined) return {};
	if (typeof raw.level !== "string") throw new Error("thinking requires params.level to be a string");
	return { level: parsePiboThinkingLevel(raw.level) };
}

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
		api.registerSubagents([
			{
				name: "qa-researcher",
				description:
					"QA helper subagent for run-yield testing. Use it for small research or inspection tasks.",
				targetProfile: "pibo-minimal",
				executionMode: "parallel",
			},
			{
				name: "qa-reviewer",
				description:
					"QA reviewer subagent for run-yield testing. Use it for independent review or validation tasks.",
				targetProfile: "pibo-minimal",
				executionMode: "parallel",
			},
		]);
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
		api.registerProfile({
			name: "pibo-run-yield-qa",
			aliases: ["run-yield-qa", "yield-qa"],
			description: "QA profile with two simple subagents for testing yielded run control.",
			create(context) {
				return createBaseProfileBuilder("pibo-run-yield-qa", context)
					.addTools(context.getTools(CORE_PROFILE_TOOLS))
					.addSubagents(context.getSubagents(RUN_YIELD_QA_SUBAGENTS))
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
		api.registerGatewayAction({
			name: "thinking",
			description: "Cycle or set the routed Pi thinking level.",
			slashCommands: ["thinking"],
			execute(context, event) {
				const params = getThinkingParams(event);
				return params.level ? context.setThinkingLevel(params.level) : context.cycleThinkingLevel();
			},
		});
		api.registerGatewayAction({
			name: "session.current",
			description: "Return the active Pi session metadata for this routed session.",
			slashCommands: ["session-current"],
			execute(context) {
				return context.getCurrentSession();
			},
		});
		api.registerGatewayAction({
			name: "session.list",
			description: "List persisted Pi sessions for this workspace.",
			slashCommands: ["sessions"],
			execute(context) {
				return context.listSessions();
			},
		});
		api.registerGatewayAction({
			name: "session.fork_candidates",
			description: "Return user messages that can be used as fork targets.",
			slashCommands: ["fork-candidates"],
			execute(context) {
				return { messages: context.getForkCandidates() };
			},
		});
		api.registerGatewayAction({
			name: "session.fork",
			description: "Fork before a selected user message and make the fork the active Pi session.",
			async execute(context, event) {
				const params = requireForkParams(event);
				return await context.forkSession(params.entryId);
			},
		});
		api.registerGatewayAction({
			name: "session.clone",
			description: "Clone the current leaf and make the clone the active Pi session.",
			slashCommands: ["clone"],
			execute(context) {
				return context.cloneSession();
			},
		});
		api.registerGatewayAction({
			name: "session.tree",
			description: "Return the current Pi session tree and active leaf.",
			slashCommands: ["tree"],
			execute(context) {
				return context.getSessionTree();
			},
		});
		api.registerGatewayAction({
			name: "session.tree_navigate",
			description: "Move the current Pi session leaf to a selected tree entry.",
			async execute(context, event) {
				return await context.navigateSessionTree(requireTreeNavigateParams(event));
			},
		});
		api.registerGatewayAction({
			name: "session.switch",
			description: "Switch the active Pi session to a persisted session file.",
			async execute(context, event) {
				return await context.switchSession(requireSwitchParams(event));
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
	return [piboCorePlugin, piboGatewayProducerPlugin, piboExamplePlugin];
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
