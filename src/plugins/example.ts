import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { InitialSessionContextBuilder, type ToolProfile } from "../core/profiles.js";
import { definePiboPlugin } from "./registry.js";

const EXAMPLE_SKILL = "pibo-example-plugin";
const EXAMPLE_TOOL = "pibo_example_plugin_note";

const piboExamplePluginTool = defineTool({
	name: EXAMPLE_TOOL,
	label: "Pibo Example Plugin Note",
	description: "Return a short note from the minimal pibo example plugin.",
	promptSnippet: "Use this tool to verify that a pibo plugin can add a custom tool.",
	parameters: Type.Object({
		note: Type.String({ description: "Short note to return from the example plugin tool" }),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: `Example plugin note: ${params.note}` }],
			details: {
				plugin: "pibo.example",
				note: params.note,
			},
		};
	},
});

export const piboExamplePlugin = definePiboPlugin({
	id: "pibo.example",
	name: "Pibo Example Plugin",
	register(api) {
		let stopExampleChannel: (() => void) | undefined;

		api.registerSkill({
			name: EXAMPLE_SKILL,
			path: "examples/skills/pibo-example-plugin/SKILL.md",
		});
		api.registerTool(createToolProfile(piboExamplePluginTool));
		api.registerProfile({
			name: "pibo-example-plugin",
			aliases: ["example-plugin"],
			description: "Minimal profile that demonstrates plugin-provided skills and tools.",
			create(context) {
				return new InitialSessionContextBuilder("pibo-example-plugin")
					.addSkill(context.getSkill(EXAMPLE_SKILL))
					.addTool(context.getTool(EXAMPLE_TOOL))
					.createSession();
			},
		});
		api.registerChannel({
			name: "pibo-example-channel",
			kind: "custom",
			description: "Minimal no-op channel that demonstrates plugin channel registration.",
			auth: { mode: "trusted-local" },
			start(context) {
				stopExampleChannel = context.subscribe(() => {});
			},
			stop() {
				stopExampleChannel?.();
				stopExampleChannel = undefined;
			},
		});
	},
});

function createToolProfile(definition: ToolDefinition): ToolProfile {
	return {
		name: definition.name,
		description: definition.description,
		definition,
	};
}
