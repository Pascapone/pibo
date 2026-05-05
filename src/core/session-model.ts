import { selectRequestedModelProfile, type PiboModelDefaults } from "./model-defaults.js";
import { InitialSessionContext, type ModelProfile } from "./profiles.js";
import type { PiboSession } from "../sessions/store.js";

export function resolvePiboSessionActiveModel(input: {
	profile: InitialSessionContext;
	piboSession: PiboSession;
	parentPiSessionId?: string;
	modelDefaults?: PiboModelDefaults;
}): ModelProfile | undefined {
	if (input.piboSession.activeModel) return cloneModelProfile(input.piboSession.activeModel);
	const sessionProfile = input.parentPiSessionId
		? profileWithSessionIds(input.profile, input.piboSession.piSessionId, input.parentPiSessionId)
		: profileWithSessionIds(input.profile, input.piboSession.piSessionId);
	return selectRequestedModelProfile(sessionProfile, input.modelDefaults ?? {});
}

function profileWithSessionIds(
	profile: InitialSessionContext,
	piSessionId: string,
	parentPiSessionId?: string,
): InitialSessionContext {
	return new InitialSessionContext({
		profileName: profile.profileName,
		sessionId: piSessionId,
		parentSessionId: parentPiSessionId,
		model: profile.model,
		mainModel: profile.mainModel,
		subagentModel: profile.subagentModel,
		thinkingLevel: profile.thinkingLevel,
		skills: profile.skills,
		tools: profile.tools,
		subagents: profile.subagents,
		mcpServers: profile.mcpServers,
		contextFiles: profile.contextFiles,
		piPackages: profile.piPackages,
		builtinTools: profile.builtinTools,
		builtinToolNames: profile.builtinToolNames,
		autoContextFiles: profile.autoContextFiles,
		toolPackages: profile.toolPackages,
	});
}

function cloneModelProfile(model: ModelProfile): ModelProfile {
	return { provider: model.provider, id: model.id };
}
