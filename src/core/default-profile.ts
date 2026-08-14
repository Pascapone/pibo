import { InitialSessionContextBuilder, type InitialSessionContext } from "./profiles.js";

export const DEFAULT_PIBO_PROFILE_NAME = "base";

export function createDefaultPiboProfile(): InitialSessionContext {
	return new InitialSessionContextBuilder(DEFAULT_PIBO_PROFILE_NAME)
		.withBuiltinToolNames(["read", "bash", "edit", "write"])
		.withToolPackages({ goalControl: true })
		.createSession();
}
