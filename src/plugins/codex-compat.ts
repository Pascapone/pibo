import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexImageGenerationToolProfile } from "../tools/codex-image-generation.js";
import { definePiboPlugin } from "./registry.js";

const CODEX_COMPAT_REGISTERED_TOOL_NAMES = [
	"apply_patch",
	"view_image",
] as const;

const CODEX_BASE_PROMPT_CONTEXT_FILE_KEY = "Codex Base Prompt";
const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CODEX_BASE_PROMPT_CONTEXT_FILE_PATH = resolve(PROJECT_ROOT, "context/codex-base-prompt.md");

const toolDescriptions: Record<(typeof CODEX_COMPAT_REGISTERED_TOOL_NAMES)[number], string> = {
	apply_patch: "Applies a Codex-style patch to workspace files.",
	view_image: "Reads a local image path and returns it for visual inspection.",
};

export const piboCodexCompatPlugin = definePiboPlugin({
	id: "pibo.codex-compat",
	name: "Pibo Codex Compatibility",
	register(api) {
		for (const name of CODEX_COMPAT_REGISTERED_TOOL_NAMES) {
			api.registerTool({
				name,
				description: toolDescriptions[name],
			});
		}
		api.registerTool(createCodexImageGenerationToolProfile());

		api.registerContextFile({
			key: CODEX_BASE_PROMPT_CONTEXT_FILE_KEY,
			label: "Codex Base Prompt",
			path: CODEX_BASE_PROMPT_CONTEXT_FILE_PATH,
		});
	},
});
