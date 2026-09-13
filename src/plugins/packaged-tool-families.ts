import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginSetupContext } from "./host.js";
import { createRuntimeToolProfile } from "../tools/runtime/tool.js";
import { createHashlineToolProfile } from "../tools/hashline.js";
import { createPiboGatewayToolProfiles } from "../gateway/tool.js";
import { createWebSearchToolProfile } from "../tools/web-search.js";
import { createCodexBrowserToolProfiles } from "../tools/codex-browser.js";
import { createCodexImageGenerationToolProfile } from "../tools/codex-image-generation.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function register(context: PluginSetupContext, profiles: readonly { name: string }[]): void {
	for (const profile of profiles) context.register(profile.name, profile);
}

export function setupCodeRuntime(context: PluginSetupContext): void {
	register(context, [createRuntimeToolProfile()]);
	context.register("settings", {});
}

export function setupFileEditing(context: PluginSetupContext): void {
	register(context, [createHashlineToolProfile()]);
	context.register("settings", {});
}

export function setupWebSearch(context: PluginSetupContext): void {
	register(context, [createWebSearchToolProfile()]);
	context.register("settings", {});
}

export function setupBrowserTools(context: PluginSetupContext): void {
	register(context, createCodexBrowserToolProfiles());
	context.register("settings", {});
	context.register("native-tooling-context", {
		key: "Pibo Native Tooling",
		label: "Pibo Native Tooling",
		path: resolve(PACKAGE_ROOT, "context", "pibo-native-tooling.md"),
	});
}

export function setupGatewayTools(context: PluginSetupContext): void {
	register(context, createPiboGatewayToolProfiles());
	context.register("settings", {});
}

export function setupCodexCompat(context: PluginSetupContext): void {
	context.register("apply_patch", { name: "apply_patch", description: "Applies a Codex-style patch to workspace files." });
	context.register("view_image", { name: "view_image", description: "Reads a local image path and returns it for visual inspection." });
	const imageGeneration = createCodexImageGenerationToolProfile();
	context.register(imageGeneration.name, imageGeneration);
	context.register("settings", {});
	context.register("base-prompt", {
		key: "Codex Base Prompt",
		label: "Codex Base Prompt",
		path: resolve(PACKAGE_ROOT, "context", "codex-base-prompt.md"),
	});
}
