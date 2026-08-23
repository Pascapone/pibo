import { Type } from "typebox";
import { piboStringEnum } from "../tools/schema.js";
import { definePiboTool, type PiboToolDefinition } from "../tools/contract.js";
import type { PiboAssistantMessageEvent, PiboJsonValue } from "../core/events.js";
import type { ModelProfile, SubagentProfile } from "../core/profiles.js";

export const PIBO_AGENT_TOOL_NAMES = [
	"pibo_agents_send_message",
	"pibo_agents_list_agents",
	"pibo_agents_observe",
	"pibo_agents_kill",
] as const;

export type PiboAgentToolName = (typeof PIBO_AGENT_TOOL_NAMES)[number];
export type PiboAgentStatus = "running" | "idle" | "killed";
export type PiboAgentObservationKind = "message" | "thinking" | "tool" | "error" | "lifecycle" | "event";
export type PiboAgentObservationOrder = "asc" | "desc";

export type PiboAvailableAgent = {
	name: string;
	description: string;
	profile: string;
	model?: ModelProfile;
	thinkingLevel?: string;
};

export type PiboManagedAgent = {
	agentId: string;
	name: string;
	profile: string;
	threadKey?: string;
	status: PiboAgentStatus;
	createdAt: string;
	updatedAt: string;
	activeModel?: ModelProfile;
};

export type PiboAgentSendMessageInput = {
	subagent: SubagentProfile;
	message: string;
	threadKey?: string;
	toolCallId?: string;
	signal?: AbortSignal;
};

export type PiboAgentSendMessageResult = {
	agentId: string;
	name: string;
	profile: string;
	threadKey: string;
	eventId: string;
	reply: PiboAssistantMessageEvent;
};

export type PiboAgentObservation = {
	sequence: number;
	createdAt: string;
	agentId: string;
	name: string;
	threadKey?: string;
	eventType: string;
	kind: PiboAgentObservationKind;
	role?: string;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	details?: PiboJsonValue;
};

export type PiboAgentObserveInput = {
	agentIds?: string[];
	names?: string[];
	threadKeys?: string[];
	eventTypes?: string[];
	kinds?: PiboAgentObservationKind[];
	since?: string;
	until?: string;
	textContains?: string;
	afterSequence?: number;
	order?: PiboAgentObservationOrder;
	limit?: number;
	includeDetails?: boolean;
};

export type PiboAgentObserveResult = {
	filters: PiboAgentObserveInput;
	observations: PiboAgentObservation[];
	nextAfterSequence: number;
	truncated: boolean;
};

export type PiboAgentKillResult = {
	agentId: string;
	killed: string[];
	cancelledRuns: string[];
};

export type PiboAgentsController = {
	sendMessage(input: PiboAgentSendMessageInput): Promise<PiboAgentSendMessageResult>;
	listAgents(): PiboManagedAgent[];
	observe(input: PiboAgentObserveInput): PiboAgentObserveResult;
	killAgent(agentId: string): Promise<PiboAgentKillResult>;
};

function availableAgentDescription(subagent: SubagentProfile): string {
	return subagent.description?.trim() || `Targets profile ${subagent.targetProfile}.`;
}

export function listAvailableAgents(subagents: readonly SubagentProfile[]): PiboAvailableAgent[] {
	return subagents
		.filter((subagent) => subagent.enabled !== false)
		.map((subagent) => ({
			name: subagent.name,
			description: availableAgentDescription(subagent),
			profile: subagent.targetProfile,
			...(subagent.model ? { model: { ...subagent.model } } : {}),
			...(subagent.thinkingLevel ? { thinkingLevel: subagent.thinkingLevel } : {}),
		}));
}

export function formatAvailableAgentsForPrompt(subagents: readonly SubagentProfile[]): string {
	return listAvailableAgents(subagents)
		.map((agent) => `- ${agent.name}: ${agent.description}`)
		.join("\n");
}

function resultText(prefix: string, value: unknown): string {
	return `${prefix}\n${JSON.stringify(value, null, 2)}`;
}

export function createAgentToolDefinitions(
	subagents: readonly SubagentProfile[],
	controller: PiboAgentsController,
): PiboToolDefinition[] {
	const enabled = subagents.filter((subagent) => subagent.enabled !== false);
	if (enabled.length === 0) return [];
	const byName = new Map<string, SubagentProfile>();
	for (const subagent of enabled) {
		if (byName.has(subagent.name)) throw new Error(`Duplicate agent name "${subagent.name}"`);
		byName.set(subagent.name, subagent);
	}
	const names = [...byName.keys()];
	const availableAgents = listAvailableAgents(enabled);
	const catalog = formatAvailableAgentsForPrompt(enabled);

	return [
		definePiboTool({
			name: "pibo_agents_send_message",
			title: "Pibo Agents Send Message",
			description: [
				"Send a message to an available delegated agent. Foreground execution waits for the reply; use pibo_run_start for asynchronous delegation.",
				"Available agents:",
				catalog,
			].join("\n"),
			promptSnippet: "Send work to an available delegated agent by name. Reuse threadKey to continue its child session. Use pibo_run_start with this tool for asynchronous work. The tool definition lists the available names and parent-visible descriptions.",
			executionMode: "parallel",
			inputSchema: Type.Object({
				name: piboStringEnum(names, { description: "Available delegated agent name" }),
				message: Type.String({ description: "Message to send to the delegated agent" }),
				threadKey: Type.Optional(
					Type.String({
						description: "Stable key for continuing one delegated-agent conversation. Omit it to create a new child session.",
						maxLength: 256,
					}),
				),
			}),
			async execute(toolCallId, params, signal) {
				const subagent = byName.get(params.name);
				if (!subagent) throw new Error(`Unknown delegated agent "${params.name}"`);
				const result = await controller.sendMessage({
					subagent,
					message: params.message,
					threadKey: params.threadKey,
					toolCallId,
					signal,
				});
				return {
					content: [{
						type: "text",
						text: `Agent ${result.name} (${result.agentId}, thread ${result.threadKey}) replied:\n${result.reply.text}`,
					}],
					details: result,
				};
			},
		}),
		definePiboTool({
			name: "pibo_agents_list_agents",
			title: "Pibo Agents List Agents",
			description: "List available delegated-agent profiles and child agent instances owned by this session.",
			promptSnippet: "List available delegated agents and existing child instances with their agentId, thread, profile, and running, idle, or killed status.",
			executionMode: "parallel",
			annotations: { readOnly: true },
			inputSchema: Type.Object({}),
			async execute() {
				const result = { availableAgents, agents: controller.listAgents() };
				return {
					content: [{ type: "text", text: resultText("Delegated agents:", result) }],
					details: result,
				};
			},
		}),
		definePiboTool({
			name: "pibo_agents_observe",
			title: "Pibo Agents Observe",
			description: "Read bounded delegated-agent observations with exact agent, thread, event, kind, time, text, cursor, order, and limit filters.",
			promptSnippet: "Observe child-agent activity. Array filters use OR within a field and different fields combine with AND. Use afterSequence to poll without duplicates.",
			executionMode: "parallel",
			annotations: { readOnly: true },
			inputSchema: Type.Object({
				agentIds: Type.Optional(Type.Array(Type.String({ description: "Owned child agentId" }), { maxItems: 50 })),
				names: Type.Optional(Type.Array(piboStringEnum(names), { maxItems: 50 })),
				threadKeys: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
				eventTypes: Type.Optional(Type.Array(Type.String({ description: "Exact Pibo output event type" }), { maxItems: 50 })),
				kinds: Type.Optional(Type.Array(piboStringEnum(["message", "thinking", "tool", "error", "lifecycle", "event"]), { maxItems: 6 })),
				since: Type.Optional(Type.String({ description: "Inclusive ISO-8601 lower timestamp bound" })),
				until: Type.Optional(Type.String({ description: "Inclusive ISO-8601 upper timestamp bound" })),
				textContains: Type.Optional(Type.String({ description: "Case-insensitive substring match against normalized observation text" })),
				afterSequence: Type.Optional(Type.Integer({ description: "Exclusive live observation cursor", minimum: 0 })),
				order: Type.Optional(piboStringEnum(["asc", "desc"], { default: "asc" })),
				limit: Type.Optional(Type.Integer({ description: "Maximum observations to return", minimum: 1, maximum: 200, default: 50 })),
				includeDetails: Type.Optional(Type.Boolean({ description: "Include the normalized source event in each observation" })),
			}),
			async execute(_toolCallId, params) {
				const result = controller.observe(params as PiboAgentObserveInput);
				return {
					content: [{ type: "text", text: resultText("Agent observations:", result) }],
					details: result,
				};
			},
		}),
		definePiboTool({
			name: "pibo_agents_kill",
			title: "Pibo Agents Kill",
			description: "Terminate one owned child agent session subtree and cancel its yielded runs.",
			promptSnippet: "Kill an owned child agent by agentId when its work is no longer needed. Use pibo_agents_list_agents to find the exact agentId.",
			executionMode: "parallel",
			annotations: { destructive: true, idempotent: true },
			inputSchema: Type.Object({
				agentId: Type.String({ description: "Exact child agentId returned by send_message or list_agents" }),
			}),
			async execute(_toolCallId, params) {
				const result = await controller.killAgent(params.agentId);
				return {
					content: [{ type: "text", text: resultText(`Killed delegated agent ${params.agentId}.`, result) }],
					details: result,
				};
			},
		}),
	];
}
