import { PiboCapabilityHost } from "../../dist/core/capability-host.js";

export function defineTestCapabilitySetup(setup) {
	return setup;
}

function setupApi(host, owner) {
	return {
		registerAgentRuntimeDriver: (driver) => host.registerAgentRuntimeDriver(driver),
		registerAgentRuntimeInstance: (instance) => host.registerAgentRuntimeInstance(instance),
		registerTool: (tool) => host.registerTool({ ...tool, pluginId: owner }),
		registerTools: (tools) => host.registerTools(tools.map((tool) => ({ ...tool, pluginId: owner }))),
		registerSubagent: (subagent) => host.registerSubagent(subagent),
		registerSubagents: (subagents) => host.registerSubagents(subagents),
		registerSkill: (skill) => host.registerSkill(skill.kind === "user" ? skill : { ...skill, kind: skill.kind ?? "plugin", pluginId: owner }),
		registerContextFile: (contextFile) => host.registerContextFile(contextFile.source === "managed" ? contextFile : { ...contextFile, source: contextFile.source ?? "plugin", pluginId: owner }),
		upsertContextFile: (contextFile) => host.upsertContextFile(contextFile.source === "managed" ? contextFile : { ...contextFile, source: contextFile.source ?? "plugin", pluginId: owner }),
		removeContextFile: (key) => host.removeContextFile(key),
		registerProfile: (profile) => host.registerProfile(profile),
		upsertProfile: (profile) => host.upsertProfile(profile),
		registerGatewayAction: (action) => host.registerGatewayAction(action),
		upsertGatewayAction: (action) => host.upsertGatewayAction(action),
		registerChannel: (channel) => host.registerChannel(channel),
		registerAuthService: (service) => host.registerAuthService(service),
		registerTranscriptionProvider: (provider) => host.registerTranscriptionProvider({ ...provider, pluginId: owner }),
		registerSpeechProvider: (provider) => host.registerSpeechProvider({ ...provider, pluginId: owner }),
		registerWebApp: (app) => host.registerWebApp(app),
		registerLoopStopCondition: (condition) => host.registerLoopStopCondition(condition, owner),
		registerRalphStopCondition: (condition) => host.registerLoopStopCondition(condition, owner),
		onEvent: (listener) => host.onEvent(listener),
		emitProductEvent: (event) => host.emitProductEvent(event),
		onProductEvent: (listener) => host.onProductEvent(listener),
	};
}

export function applyTestCapabilitySetup(host, setup) {
	if (setup.name) host.registerCapabilityOwnerName(setup.id, setup.name);
	setup.register(setupApi(host, setup.id));
	return host;
}

export function createTestCapabilityHost({ setups = [], ...options } = {}) {
	const host = PiboCapabilityHost.create(options);
	for (const setup of setups) applyTestCapabilitySetup(host, setup);
	return host;
}
