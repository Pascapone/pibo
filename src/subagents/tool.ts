import { createHash } from "node:crypto";
import { Type } from "typebox";
import { piboStringEnum } from "../tools/schema.js";
import { definePiboTool, type PiboToolDefinition } from "../tools/contract.js";
import type { PiboAssistantMessageEvent, PiboJsonValue, PiboMessageProvenance } from "../core/events.js";
import type { ModelProfile, SubagentProfile } from "../core/profiles.js";
import type { PiboAgentObservationKind, PiboAgentObservationOrder } from "./observations.js";

export type { PiboAgentObservationKind, PiboAgentObservationOrder } from "./observations.js";

export const PIBO_AGENT_TOOL_NAMES = [
	"pibo_agents_send_message",
	"pibo_agents_list_agents",
	"pibo_agents_observe",
	"pibo_agents_kill",
] as const;

export type PiboAgentToolName = (typeof PIBO_AGENT_TOOL_NAMES)[number];
export type PiboAgentStatus = "running" | "idle" | "killed";

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
	requestId: string;
	parentProvenance?: PiboMessageProvenance;
	signal?: AbortSignal;
};

export type PiboAgentSendMessageResult = {
	requestId: string;
	agentId: string;
	name: string;
	profile: string;
	threadKey: string;
	eventId: string;
	finalMessage: string;
	reply: PiboAssistantMessageEvent;
};

export type PiboAgentObservation = {
	sequence: number;
	createdAt: string;
	requestId?: string;
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
	requestIds?: string[];
	agentIds?: string[];
	names?: string[];
	threadKeys?: string[];
	eventTypes?: string[];
	kinds?: PiboAgentObservationKind[];
	roles?: string[];
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

/** @deprecated Use PiboAgentSendMessageInput with PiboAgentsController. */
export type PiboSubagentRunInput = {
	subagent: SubagentProfile;
	message: string;
	threadKey?: string;
	toolCallId?: string;
	signal?: AbortSignal;
};

/** @deprecated Use PiboAgentSendMessageResult with PiboAgentsController. */
export type PiboSubagentRunResult = {
	piboSessionId: string;
	eventId: string;
	reply: PiboAssistantMessageEvent;
};

/** @deprecated Use PiboAgentsController. */
export type PiboSubagentRunner = {
	runSubagent(input: PiboSubagentRunInput): Promise<PiboSubagentRunResult>;
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
				"Yielded-only delegated send. Start this tool through pibo_run_start; bounded waits do not limit the child lifetime.",
				"Available agents:",
				catalog,
			].join("\n"),
			promptSnippet: "Start pibo_agents_send_message through pibo_run_start. Reuse threadKey to continue its child session, and use run wait/status/read/cancel plus agent observe for lifecycle control.",
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
			async execute(toolCallId, params, signal, _onUpdate, context) {
				const subagent = byName.get(params.name);
				if (!subagent) throw new Error(`Unknown delegated agent "${params.name}"`);
				if (!context.yieldedRunId) {
					throw new Error("pibo_agents_send_message is yielded-only. Start it through pibo_run_start.");
				}
				const result = await controller.sendMessage({
					subagent,
					message: params.message,
					threadKey: params.threadKey,
					toolCallId,
					requestId: context.yieldedRunId,
					parentProvenance: context.getActiveMessage?.()?.provenance,
					signal,
				});
				return {
					content: [{
						type: "text",
						text: `Agent request ${result.requestId} completed (${result.name}, ${result.agentId}, thread ${result.threadKey}).\n\n${result.finalMessage}`,
					}],
					structuredContent: {
						status: "completed",
						requestId: result.requestId,
						agentId: result.agentId,
						threadKey: result.threadKey,
						eventId: result.eventId,
						finalMessage: result.finalMessage,
					},
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
			promptSnippet: "Observe child-agent activity. Array filters use OR within a field and different fields combine with AND. For cursor polling, pass afterSequence from the previous result; pages consume the oldest unseen observations even when order is desc.",
			executionMode: "parallel",
			annotations: { readOnly: true },
			inputSchema: Type.Object({
				requestIds: Type.Optional(Type.Array(Type.String({ description: "Exact yielded run/request ID" }), { maxItems: 50 })),
				agentIds: Type.Optional(Type.Array(Type.String({ description: "Owned child agentId" }), { maxItems: 50 })),
				names: Type.Optional(Type.Array(piboStringEnum(names), { maxItems: 50 })),
				threadKeys: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
				eventTypes: Type.Optional(Type.Array(Type.String({ description: "Exact Pibo output event type" }), { maxItems: 50 })),
				kinds: Type.Optional(Type.Array(piboStringEnum(["message", "thinking", "tool", "error", "lifecycle", "event"]), { maxItems: 6 })),
				roles: Type.Optional(Type.Array(Type.String({ description: "Exact normalized role, for example assistant" }), { maxItems: 20 })),
				since: Type.Optional(Type.String({ description: "Inclusive ISO-8601 lower timestamp bound" })),
				until: Type.Optional(Type.String({ description: "Inclusive ISO-8601 upper timestamp bound" })),
				textContains: Type.Optional(Type.String({ description: "Case-insensitive substring match against normalized observation text" })),
				afterSequence: Type.Optional(Type.Integer({ description: "Exclusive live observation cursor. Cursor pages consume the oldest unseen observations; desc reverses only the returned page.", minimum: 0 })),
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

function legacySubagentToolHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * @deprecated Runtime-generated per-agent tools are no longer assembled by Pibo runtimes.
 * This helper remains source-compatible for integrations migrating to PIBO_AGENT_TOOL_NAMES.
 */
export function createSubagentToolName(subagentName: string): string {
	const normalized = subagentName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return `pibo_subagent_${normalized || `subagent_${legacySubagentToolHash(subagentName)}`}`;
}

/**
 * @deprecated Use createAgentToolDefinitions with a PiboAgentsController.
 * Pibo runtimes expose only the four pibo_agents_* tools, but this legacy factory remains available
 * for external callers during migration.
 */
export function createSubagentToolDefinitions(
	subagents: readonly SubagentProfile[],
	runner: PiboSubagentRunner,
): PiboToolDefinition[] {
	const seen = new Set<string>();
	const definitions: PiboToolDefinition[] = [];
	for (const subagent of subagents) {
		if (subagent.enabled === false) continue;
		const toolName = createSubagentToolName(subagent.name);
		if (seen.has(toolName)) throw new Error(`Duplicate subagent tool name "${toolName}"`);
		seen.add(toolName);
		definitions.push(definePiboTool({
			name: toolName,
			title: `Pibo Subagent ${subagent.name}`,
			description: subagent.description ?? `Send a message to the ${subagent.name} subagent. Use threadKey to continue the same subagent session.`,
			promptSnippet: subagent.description ?? `Send a message to the ${subagent.name} subagent. Pass the same threadKey when you want to continue the same subagent session.`,
			executionMode: "parallel",
			inputSchema: Type.Object({
				message: Type.String({ description: "Message to send to the subagent" }),
				threadKey: Type.Optional(Type.String({
					description: "Stable key for continuing a previous subagent conversation. Omit it to create a new subagent session.",
					maxLength: 256,
				})),
			}),
			async execute(toolCallId, params, signal) {
				const result = await runner.runSubagent({ subagent, message: params.message, threadKey: params.threadKey, toolCallId, signal });
				return { content: [{ type: "text", text: result.reply.text }], details: result };
			},
		}));
	}
	return definitions;
}
