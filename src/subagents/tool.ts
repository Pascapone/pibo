import { createHash } from "node:crypto";
import { Type } from "typebox";
import { definePiboTool, type PiboToolDefinition } from "../tools/contract.js";
import type { PiboAssistantMessageEvent } from "../core/events.js";
import type { SubagentProfile } from "../core/profiles.js";

export type PiboSubagentRunInput = {
	subagent: SubagentProfile;
	message: string;
	threadKey?: string;
	toolCallId?: string;
};

export type PiboSubagentRunResult = {
	piboSessionId: string;
	eventId: string;
	reply: PiboAssistantMessageEvent;
};

export type PiboSubagentRunner = {
	runSubagent(input: PiboSubagentRunInput): Promise<PiboSubagentRunResult>;
};

function hashPart(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function toolNamePart(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return normalized || `subagent_${hashPart(value)}`;
}

export function createSubagentToolName(subagentName: string): string {
	return `pibo_subagent_${toolNamePart(subagentName)}`;
}

export function createSubagentToolDefinitions(
	subagents: readonly SubagentProfile[],
	runner: PiboSubagentRunner,
): PiboToolDefinition[] {
	const seen = new Set<string>();
	const definitions: PiboToolDefinition[] = [];

	for (const subagent of subagents) {
		if (subagent.enabled === false) continue;

		const toolName = createSubagentToolName(subagent.name);
		if (seen.has(toolName)) {
			throw new Error(`Duplicate subagent tool name "${toolName}"`);
		}
		seen.add(toolName);
		definitions.push(createSubagentToolDefinition(subagent, runner));
	}

	return definitions;
}

function createSubagentToolDefinition(
	subagent: SubagentProfile,
	runner: PiboSubagentRunner,
): PiboToolDefinition {
	const name = createSubagentToolName(subagent.name);

	return definePiboTool({
		name,
		title: `Pibo Subagent ${subagent.name}`,
		description:
			subagent.description ??
			`Send a message to the ${subagent.name} subagent. Use threadKey to continue the same subagent session.`,
		promptSnippet:
			subagent.description ??
			`Send a message to the ${subagent.name} subagent. Pass the same threadKey when you want to continue the same subagent session.`,
		executionMode: "parallel",
		inputSchema: Type.Object({
			message: Type.String({ description: "Message to send to the subagent" }),
			threadKey: Type.Optional(
				Type.String({
					description:
						"Stable key for continuing a previous subagent conversation. Omit it to create a new subagent session.",
				}),
			),
		}),
		async execute(toolCallId, params) {
			const result = await runner.runSubagent({
				subagent,
				message: params.message,
				threadKey: params.threadKey,
				toolCallId,
			});

			return {
				content: [
					{
						type: "text",
						text: result.reply.text,
					},
				],
				details: result,
			};
		},
	});
}
