import { InitialSessionContextBuilder, type InitialSessionContext } from "./profiles.js";

export const PIBO_RUNTIME_UNASSIGNED_INSTANCE_ID = "pibo.runtime-unassigned";
export const PIBO_RUNTIME_UNASSIGNED_ADAPTER_ID = "unassigned";
export const PIBO_MINIMAL_CORE_PROFILE_NAME = "core";

export function createRuntimeUnassignedProfile(profileName = PIBO_MINIMAL_CORE_PROFILE_NAME): InitialSessionContext {
	return new InitialSessionContextBuilder(profileName)
		.withAgentRuntime(PIBO_RUNTIME_UNASSIGNED_INSTANCE_ID, { reason: "no-runtime-installed" })
		.withBuiltinTools("disabled")
		.withBuiltinToolNames([])
		.withAutoContextFiles(false)
		.createSession();
}
