import { buildCodexCompatSystemPrompt } from "../core/codex-compat.js";
import { createCodexCompatToolDefinitions } from "../tools/codex-compat.js";
import { createCodexImageGenerationToolDefinition } from "../tools/codex-image-generation.js";
import type { PluginSetupContext } from "./host.js";
import { definePluginSessionToolProvider, definePluginSystemPromptTransformer } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupCodexCompat(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			return { tools: registrationsForSelectedTools(providerContext, [...createCodexCompatToolDefinitions(), createCodexImageGenerationToolDefinition(providerContext)]) };
		},
	}));
	context.register("settings", {});
	context.register("base-prompt", definePluginSystemPromptTransformer({
		transform(baseSystemPrompt, transformContext) {
			return buildCodexCompatSystemPrompt({ baseSystemPrompt, ...transformContext });
		},
	}));
}
