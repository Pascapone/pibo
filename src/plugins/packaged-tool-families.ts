import type { PluginSetupContext } from "./host.js";
import {
	definePluginSessionToolProvider,
	definePluginSystemPromptTransformer,
	type PluginSessionToolProviderContext,
	type PluginSessionToolRegistration,
} from "./runtime.js";
import { buildCodexCompatSystemPrompt } from "../core/codex-compat.js";
import { createRuntimeToolDefinition } from "../tools/runtime/tool.js";
import { RuntimeSessionRegistry } from "../tools/runtime/registry.js";
import { createHashlineToolDefinition } from "../tools/hashline.js";
import { createPiboGatewaySendTool } from "../gateway/tool.js";
import {
	CodexBrowserSessionController,
	createCodexBrowserToolDefinitions,
	type CodexBrowserToolName,
} from "../tools/codex-browser.js";
import { createCodexCompatToolDefinitions } from "../tools/codex-compat.js";
import { createCodexImageGenerationToolDefinition } from "../tools/codex-image-generation.js";
import { createWebSearchToolProfile } from "../tools/web-search.js";
import { normalizePiboToolDefinition, type PiboToolDefinition } from "../tools/contract.js";

const SESSION_TOOL_PROVIDER_CONTRIBUTION_ID = "session-tools";

type SessionDefinitionFactory = (context: PluginSessionToolProviderContext) => readonly PiboToolDefinition[];

function registrationsForSelectedTools(context: PluginSessionToolProviderContext, definitions: readonly PiboToolDefinition[]): PluginSessionToolRegistration[] {
	const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition] as const));
	return context.selectedTools.map((selected) => {
		const definition = definitionsByName.get(selected.name);
		if (!definition) throw new Error(`First-party provider ${context.plugin.contributionId} cannot materialize selected tool ${selected.contributionId}`);
		return { contributionId: selected.contributionId, definition };
	});
}

function registerSessionTools(context: PluginSetupContext, createDefinitions: SessionDefinitionFactory): void {
	context.register(SESSION_TOOL_PROVIDER_CONTRIBUTION_ID, definePluginSessionToolProvider({
		createSession(providerContext) {
			return { tools: registrationsForSelectedTools(providerContext, createDefinitions(providerContext)) };
		},
	}));
	context.register("settings", {});
}

export function setupCodeRuntime(context: PluginSetupContext): void {
	context.register(SESSION_TOOL_PROVIDER_CONTRIBUTION_ID, definePluginSessionToolProvider({
		createSession(providerContext) {
			const registry = new RuntimeSessionRegistry({ cwd: providerContext.cwd });
			return {
				tools: registrationsForSelectedTools(providerContext, [createRuntimeToolDefinition(registry.createController(providerContext.piboSessionId))]),
				dispose: () => registry.closeAll({ force: true }),
			};
		},
	}));
	context.register("settings", {});
}

export function setupFileEditing(context: PluginSetupContext): void {
	registerSessionTools(context, (providerContext) => [normalizePiboToolDefinition(createHashlineToolDefinition(providerContext.cwd))]);
}

export function setupWebSearch(context: PluginSetupContext): void {
	context.register("web_search", createWebSearchToolProfile());
	context.register("settings", {});
}

export function setupBrowserTools(context: PluginSetupContext): void {
	context.register(SESSION_TOOL_PROVIDER_CONTRIBUTION_ID, definePluginSessionToolProvider({
		createSession(providerContext) {
			const controller = new CodexBrowserSessionController({ cwd: providerContext.cwd, piboSessionId: providerContext.piboSessionId });
			return {
				tools: registrationsForSelectedTools(providerContext, createCodexBrowserToolDefinitions(controller, providerContext.selectedTools.map((tool) => tool.name as CodexBrowserToolName))),
				dispose: () => controller.dispose(),
			};
		},
	}));
	context.register("settings", {});
}

export function setupGatewayTools(context: PluginSetupContext): void {
	registerSessionTools(context, () => [createPiboGatewaySendTool()]);
}

export function setupCodexCompat(context: PluginSetupContext): void {
	registerSessionTools(context, (providerContext) => [
		...createCodexCompatToolDefinitions(),
		createCodexImageGenerationToolDefinition(providerContext),
	]);
	context.register("base-prompt", definePluginSystemPromptTransformer({
		transform(baseSystemPrompt, transformContext) {
			return buildCodexCompatSystemPrompt({ baseSystemPrompt, ...transformContext });
		},
	}));
}
