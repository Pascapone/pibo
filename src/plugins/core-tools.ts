import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolProfile } from "../core/profiles.js";

const piboEchoTool = defineTool({
	name: "pibo_echo",
	label: "Pibo Echo",
	description: "Echo a short message. Use this only to verify that pibo custom tools are available.",
	promptSnippet: "Echo a short message to verify pibo custom tool wiring.",
	parameters: Type.Object({
		message: Type.String({ description: "Message to echo back" }),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: params.message }],
			details: { echoed: params.message },
		};
	},
});

const piboWorkspaceInfoTool = defineTool({
	name: "pibo_workspace_info",
	label: "Pibo Workspace Info",
	description: "Return the current pibo workspace path and basic runtime metadata.",
	promptSnippet: "Return the current pibo workspace path and basic runtime metadata.",
	parameters: Type.Object({}),
	async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							cwd: ctx.cwd,
							hasUI: ctx.hasUI,
						},
						null,
						2,
					),
				},
			],
			details: {
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
			},
		};
	},
});

export function createPiboTestToolProfiles(): ToolProfile[] {
	return [
		createToolProfile(piboEchoTool),
		createToolProfile(piboWorkspaceInfoTool),
	];
}

function createToolProfile(definition: ToolDefinition): ToolProfile {
	return {
		name: definition.name,
		description: definition.description,
		definition,
	};
}
