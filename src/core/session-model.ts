import { selectRequestedModelProfile, sanitizeModelProfile, type PiboModelDefaults } from "./model-defaults.js";
import type { PiboJsonObject } from "./events.js";
import { InitialSessionContext, type ModelProfile } from "./profiles.js";
import type { PiboSession } from "../sessions/store.js";

export const PIBO_INITIAL_MODEL_FALLBACKS_METADATA_KEY = "initialModelFallbacks";

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

export function resolvePiboSessionModelFallbacks(input: {
	profile: InitialSessionContext;
	piboSession: PiboSession;
	parentPiSessionId?: string;
	activeModel?: ModelProfile;
}): ModelProfile[] {
	const persisted = input.piboSession.metadata?.[PIBO_INITIAL_MODEL_FALLBACKS_METADATA_KEY];
	const configured = persisted !== undefined
		? sanitizeModelFallbacks(persisted)
		: input.parentPiSessionId
			? []
			: sanitizeModelFallbacks(input.profile.mainModelFallbacks);
	return configured.filter((model) => !sameModel(model, input.activeModel));
}

export function withPiboSessionModelFallbacksMetadata(
	metadata: PiboJsonObject | undefined,
	models: readonly ModelProfile[],
): PiboJsonObject {
	return {
		...(metadata ?? {}),
		[PIBO_INITIAL_MODEL_FALLBACKS_METADATA_KEY]: sanitizeModelFallbacks(models),
	};
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
		mainModelFallbacks: profile.mainModelFallbacks,
		subagentModel: profile.subagentModel,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel,
		fast: profile.fast,
		mainFast: profile.mainFast,
		subagentFast: profile.subagentFast,
		skills: profile.skills,
		tools: profile.tools,
		subagents: profile.subagents,
		mcpServers: profile.mcpServers,
		contextFiles: profile.contextFiles,
		piPackages: profile.piPackages,
		builtinTools: profile.builtinTools,
		builtinToolNames: profile.builtinToolNames,
		autoContextFiles: profile.autoContextFiles,
		nativeSubagents: profile.nativeSubagents,
		toolPackages: profile.toolPackages,
	});
}

function cloneModelProfile(model: ModelProfile): ModelProfile {
	return { provider: model.provider, id: model.id };
}

function sanitizeModelFallbacks(value: unknown): ModelProfile[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.flatMap((item) => {
		const model = sanitizeModelProfile(item);
		if (!model) return [];
		const key = `${model.provider}\u0000${model.id}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [model];
	});
}

function sameModel(left: ModelProfile, right: ModelProfile | undefined): boolean {
	return Boolean(right && left.provider === right.provider && left.id === right.id);
}
