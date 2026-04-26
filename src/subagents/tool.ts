import { createHash, randomUUID } from "node:crypto";
import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { PiboAssistantMessageEvent } from "../core/events.js";
import type { SubagentProfile } from "../core/profiles.js";

export type PiboSubagentRunInput = {
	subagent: SubagentProfile;
	message: string;
	threadKey?: string;
};

export type PiboSubagentRunResult = {
	sessionKey: string;
	eventId: string;
	reply: PiboAssistantMessageEvent;
};

export type PiboSubagentRunner = {
	runSubagent(input: PiboSubagentRunInput): Promise<PiboSubagentRunResult>;
};

function hashPart(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sessionKeyPart(value: string): string {
	const trimmed = value.trim();
	if (/^[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
	return `key-${hashPart(value)}`;
}

function toolNamePart(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return normalized || `subagent_${hashPart(value)}`;
}

export function getSubagentSessionDepth(sessionKey: string): number {
	return sessionKey.split("::sub::").length - 1;
}

export function createSubagentSessionKey(
	parentSessionKey: string,
	subagentName: string,
	threadKey?: string,
): string {
	const resolvedThreadKey = threadKey?.trim() ? threadKey : randomUUID();
	return `${parentSessionKey}::sub::${sessionKeyPart(subagentName)}::${sessionKeyPart(resolvedThreadKey)}`;
}

export function createSubagentToolName(subagentName: string): string {
	return `pibo_subagent_${toolNamePart(subagentName)}`;
}

export function createSubagentToolDefinitions(
	subagents: readonly SubagentProfile[],
	runner: PiboSubagentRunner,
): ToolDefinition[] {
	const seen = new Set<string>();
	const definitions: ToolDefinition[] = [];

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
): ToolDefinition {
	const name = createSubagentToolName(subagent.name);

	return defineTool({
		name,
		label: `Pibo Subagent ${subagent.name}`,
		description:
			subagent.description ??
			`Send a message to the ${subagent.name} subagent. Use threadKey to continue the same subagent session.`,
		promptSnippet:
			subagent.description ??
			`Send a message to the ${subagent.name} subagent. Pass the same threadKey when you want to continue the same subagent session.`,
		executionMode: subagent.executionMode ?? "sequential",
		parameters: Type.Object({
			message: Type.String({ description: "Message to send to the subagent" }),
			threadKey: Type.Optional(
				Type.String({
					description:
						"Stable key for continuing a previous subagent conversation. Omit it to create a new subagent session.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const result = await runner.runSubagent({
				subagent,
				message: params.message,
				threadKey: params.threadKey,
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
