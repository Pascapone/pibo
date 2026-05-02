import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { definePiboPlugin } from "./registry.js";

const CODEX_COMPAT_TOOL_NAMES = [
	"apply_patch",
	"web_search",
	"view_image",
] as const;
const CODEX_COMPAT_PROVIDER_TOOL_NAMES = [
	"apply_patch",
	"view_image",
] as const;

const CODEX_COMPAT_SUBAGENTS = ["default", "explorer", "worker"] as const;

const CODEX_BASE_PROMPT_CONTEXT_FILE_KEY = "Codex Base Prompt";
const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CODEX_BASE_PROMPT_CONTEXT_FILE_PATH = resolve(PROJECT_ROOT, "context/codex-base-prompt.md");

const toolDescriptions: Record<(typeof CODEX_COMPAT_TOOL_NAMES)[number], string> = {
	apply_patch: "Applies a Codex-style patch to workspace files.",
	web_search: "Searches the web and returns compact result titles, URLs, and snippets.",
	view_image: "Reads a local image path and returns it for visual inspection.",
};

export const piboCodexCompatPlugin = definePiboPlugin({
	id: "pibo.codex-compat",
	name: "Pibo Codex Compatibility",
	register(api) {
		for (const name of CODEX_COMPAT_TOOL_NAMES) {
			api.registerTool({
				name,
				description: toolDescriptions[name],
			});
		}

		api.registerContextFile({
			key: CODEX_BASE_PROMPT_CONTEXT_FILE_KEY,
			label: "Codex Base Prompt",
			path: CODEX_BASE_PROMPT_CONTEXT_FILE_PATH,
		});

		api.registerSubagents([
			{
				name: "default",
				description: "General delegated Codex-compatible child agent.",
				targetProfile: "codex-compat-openai-web",
			},
			{
				name: "explorer",
				description: "Read-focused delegated agent for scoped codebase questions.",
				targetProfile: "codex-compat-openai-web",
			},
			{
				name: "worker",
				description: "Execution-focused delegated agent for bounded implementation work.",
				targetProfile: "codex-compat-openai-web",
			},
		]);

		api.registerProfile({
			name: "codex-compat-openai-web",
			aliases: ["codex"],
			description: "Codex-compatible Pibo profile with OpenAI Responses hosted web_search.",
			create(context) {
				return new InitialSessionContextBuilder("codex-compat-openai-web")
					.withBuiltinToolNames(["read", "edit", "write"])
					.withToolPackages({
						codexCompat: true,
						providerWebSearch: true,
						providerWebSearchOptions: {
							externalWebAccess: true,
							searchContextSize: "medium",
							includeSources: true,
						},
						runControl: true,
					})
					.addTools(context.getTools(CODEX_COMPAT_PROVIDER_TOOL_NAMES))
					.addSubagents(context.getSubagents(CODEX_COMPAT_SUBAGENTS))
					.addContextFile(context.getContextFile(CODEX_BASE_PROMPT_CONTEXT_FILE_KEY))
					.createSession();
			},
		});

		api.registerProfile({
			name: "codex-compat-local-web",
			aliases: ["codex-local", "codex-duckduckgo"],
			description: "Codex-compatible Pibo profile with local DuckDuckGo-backed web_search.",
			create(context) {
				return new InitialSessionContextBuilder("codex-compat-local-web")
					.withBuiltinToolNames(["read", "edit", "write"])
					.withToolPackages({
						codexCompat: true,
						providerWebSearch: false,
						runControl: true,
					})
					.addTools(context.getTools(CODEX_COMPAT_TOOL_NAMES))
					.addSubagents(context.getSubagents(CODEX_COMPAT_SUBAGENTS).map((subagent) => ({
						...subagent,
						targetProfile: "codex-compat-local-web",
					})))
					.addContextFile(context.getContextFile(CODEX_BASE_PROMPT_CONTEXT_FILE_KEY))
					.createSession();
			},
		});
	},
});
