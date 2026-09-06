import { createHash } from "node:crypto";
import { Type } from "typebox";
import { piboStringEnum } from "../tools/schema.js";
import { definePiboTool, type PiboToolDefinition } from "../tools/contract.js";
import type { PiboAssistantMessageEvent, PiboJsonValue, PiboMessageProvenance } from "../core/events.js";
import type { ModelProfile, SubagentProfile } from "../core/profiles.js";
import type {
	PiboAgentObservationCursorMode,
	PiboAgentObservationKind,
	PiboAgentObservationOrder,
	PiboAgentObservationToolDetail,
} from "./observations.js";

export type {
	PiboAgentObservationCursorMode,
	PiboAgentObservationKind,
	PiboAgentObservationOrder,
	PiboAgentObservationToolDetail,
} from "./observations.js";

export const PIBO_AGENT_TOOL_NAMES = [
	"pibo_agents_send_message",
	"pibo_agents_list_agents",
	"pibo_agents_observe",
	"pibo_agents_kill",
] as const;

export type PiboAgentToolName = (typeof PIBO_AGENT_TOOL_NAMES)[number];
export type PiboAgentStatus = "running" | "idle" | "killed";

export const PIBO_AGENT_SESSION_NAME_MAX_LENGTH = 40;

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
	sessionName?: string;
	threadKey?: string;
	status: PiboAgentStatus;
	createdAt: string;
	updatedAt: string;
	activeModel?: ModelProfile;
};

export type PiboAgentSendMessageInput = {
	subagent: SubagentProfile;
	/** Human-readable child Pibo Session title; trimmed and limited to 40 Unicode code points. */
	sessionName: string;
	message: string;
	threadKey?: string;
	toolCallId?: string;
	requestId?: string;
	parentProvenance?: PiboMessageProvenance;
	signal?: AbortSignal;
};

export type PiboAgentSendMessageResult = {
	requestId?: string;
	agentId: string;
	name: string;
	profile: string;
	threadKey: string;
	eventId: string;
	finalMessage?: string;
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
	toolCallIds?: string[];
	agentIds?: string[];
	names?: string[];
	threadKeys?: string[];
	eventTypes?: string[];
	kinds?: PiboAgentObservationKind[];
	roles?: string[];
	since?: string;
	until?: string;
	textContains?: string;
	textRegex?: string;
	cursorMode?: PiboAgentObservationCursorMode;
	afterSequence?: number;
	order?: PiboAgentObservationOrder;
	limit?: number;
	includeTools?: boolean;
	toolDetail?: PiboAgentObservationToolDetail;
	includeDetails?: boolean;
};

export type PiboAgentObserveResult = {
	filters: PiboAgentObserveInput;
	observations: PiboAgentObservation[];
	nextAfterSequence: number;
	autoCursorSequence?: number;
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
	sessionName: string;
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

export function normalizePiboAgentSessionName(value: unknown): string {
	if (typeof value !== "string") throw new Error("Agent session name is required.");
	const normalized = value.trim();
	if (!normalized) throw new Error("Agent session name must not be empty.");
	if ([...normalized].length > PIBO_AGENT_SESSION_NAME_MAX_LENGTH) {
		throw new Error(`Agent session name must be at most ${PIBO_AGENT_SESSION_NAME_MAX_LENGTH} characters.`);
	}
	return normalized;
}

type PiboAgentToolInput = {
	name: string;
	sessionName: string;
	message: string;
	threadKey?: string;
};

type PiboDeprecatedSubagentToolInput = Omit<PiboAgentToolInput, "name">;

function preparePiboAgentSessionNameInput(input: unknown): Record<string, unknown> & { sessionName: string } {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Agent session name is required.");
	}
	return {
		...input,
		sessionName: normalizePiboAgentSessionName((input as { sessionName?: unknown }).sessionName),
	};
}

function preparePiboAgentToolInput(input: unknown): PiboAgentToolInput {
	return preparePiboAgentSessionNameInput(input) as PiboAgentToolInput;
}

function preparePiboDeprecatedSubagentToolInput(input: unknown): PiboDeprecatedSubagentToolInput {
	return preparePiboAgentSessionNameInput(input) as PiboDeprecatedSubagentToolInput;
}

export function formatAgentObservationsForModel(result: PiboAgentObserveResult): string {
	const includeTools = result.filters.includeTools === true;
	const toolDetail = result.filters.toolDetail ?? "summary";
	const cursorMode = result.filters.cursorMode ?? "auto";
	const lines = [
		`Agent observations (${result.observations.length}; cursor=${cursorMode}; tools=${includeTools ? toolDetail : "hidden"}; order=${result.filters.order ?? "desc"}; limit=${result.filters.limit ?? 20})`,
		`afterSequence=${result.filters.afterSequence ?? "initial"}; nextAfterSequence=${result.nextAfterSequence}${result.autoCursorSequence === undefined ? "" : `; autoCursorSequence=${result.autoCursorSequence}`}; truncated=${result.truncated}`,
	];
	if (result.observations.length === 0) {
		lines.push("", cursorMode === "auto"
			? "No new delegated-agent messages matched since the automatic cursor. Use cursorMode=\"history\" only when you need to reread earlier observations."
			: "No historical delegated-agent observations matched the filters.");
		return lines.join("\n");
	}
	for (const observation of result.observations) {
		const scope = [
			observation.name,
			observation.threadKey ? `thread=${observation.threadKey}` : undefined,
			observation.requestId ? `request=${observation.requestId}` : undefined,
		].filter(Boolean).join("; ");
		const event = observation.kind === "tool"
			? `${observation.eventType}${observation.toolName ? ` ${observation.toolName}` : ""}`
			: observation.eventType;
		const toolCall = observation.kind === "tool" && observation.toolCallId
			? `; toolCallId=${observation.toolCallId}`
			: "";
		lines.push("", `#${observation.sequence} ${scope} — ${event}${toolCall}${observation.isError ? " [error]" : ""}`);
		if (observation.text) lines.push(observation.text);
	}
	return lines.join("\n");
}

function normalizeAgentSendMessageResult(
	result: PiboAgentSendMessageResult,
	fallbackRequestId: string,
): PiboAgentSendMessageResult & { requestId: string; finalMessage: string } {
	return {
		...result,
		requestId: result.requestId?.trim() || fallbackRequestId,
		finalMessage: typeof result.finalMessage === "string" ? result.finalMessage : result.reply.text,
	};
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
				"Yielded-only delegated send with a required sessionName. It must be a nonblank string of at most 40 Unicode code points and is trimmed before use. name selects the configured agent, sessionName is the human-readable child-session title, and threadKey controls conversation reuse. Invalid arguments fail before a run or child session is created. Start this tool through pibo_run_start; bounded waits do not limit the child lifetime.",
				"Available agents:",
				catalog,
			].join("\n"),
			promptSnippet: "Start pibo_agents_send_message through pibo_run_start. Provide a nonblank sessionName of at most 40 Unicode code points on every call; Pibo trims it and rejects invalid input before creating a run. Follow-up calls update the reused child title without changing identity. Reuse threadKey to continue its child session, and use run wait/status/read/cancel plus agent observe for lifecycle control.",
			executionMode: "parallel",
			inputSchema: Type.Object({
				name: piboStringEnum(names, { description: "Configured delegated-agent selector; not the child title or reuse key" }),
				sessionName: Type.String({
					description: "Required nonblank human-readable child Pibo Session title, trimmed before use and limited to 40 Unicode code points. Follow-up calls update the title without changing thread identity.",
					minLength: 1,
					maxLength: PIBO_AGENT_SESSION_NAME_MAX_LENGTH,
					pattern: "\\S",
				}),
				message: Type.String({ description: "Message to send to the delegated agent" }),
				threadKey: Type.Optional(
					Type.String({
						description: "Stable reuse key for one delegated-agent conversation; independent of sessionName. Omit it to create a new child session.",
						maxLength: 256,
					}),
				),
			}),
			prepareInput: preparePiboAgentToolInput,
			async execute(toolCallId, params, signal, _onUpdate, context) {
				const subagent = byName.get(params.name);
				if (!subagent) throw new Error(`Unknown delegated agent "${params.name}"`);
				if (!context.yieldedRunId) {
					throw new Error("pibo_agents_send_message is yielded-only. Start it through pibo_run_start.");
				}
				const preparedParams = preparePiboAgentToolInput(params);
				const result = normalizeAgentSendMessageResult(await controller.sendMessage({
					subagent,
					sessionName: preparedParams.sessionName,
					message: preparedParams.message,
					threadKey: preparedParams.threadKey,
					toolCallId,
					requestId: context.yieldedRunId,
					parentProvenance: context.getActiveMessage?.()?.provenance,
					signal,
				}), context.yieldedRunId);
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
			description: "List available delegated-agent profiles and child agent instances owned by this session, including each current sessionName when available.",
			promptSnippet: "List available delegated agents and existing child instances with their agentId, current sessionName, threadKey, profile, and running, idle, or killed status.",
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
			description: [
				"Read completed delegated-agent messages with bounded cursor, identity, event, time, substring, regex, order, and limit filters.",
				"Default cursorMode=auto: the first equivalent query returns the newest 20 completed assistant messages; later calls return only unread messages. Streaming deltas, duplicate tool progress events, and tools stay hidden.",
				"Use cursorMode=history only to reread earlier observations. Inspect tools only when an agent appears stuck, reports a problem, or needs targeted diagnosis; prefer exact toolCallIds, then includeTools=true, and use toolDetail=full only when compact summaries are insufficient.",
			].join("\n"),
			promptSnippet: "Observe child progress through completed assistant messages. cursorMode=auto is the default and remembers each equivalent query, so repeated calls return only unread messages; use cursorMode=history to reread earlier observations. Streaming deltas, duplicate tool progress events, and tools are hidden by default. Inspect tools only for stalls, errors, or targeted diagnosis: prefer exact toolCallIds, use includeTools=true only when broader context is needed, and use toolDetail=full only when summaries are insufficient. Use textContains or textRegex for focused matching; different filters use separate automatic cursors. An explicit afterSequence overrides the stored cursor and advances that automatic query cursor.",
			executionMode: "parallel",
			annotations: { readOnly: true },
			inputSchema: Type.Object({
				requestIds: Type.Optional(Type.Array(Type.String({ description: "Exact yielded run/request ID" }), { maxItems: 50 })),
				toolCallIds: Type.Optional(Type.Array(Type.String({ description: "Exact existing toolCallId. Multiple values use OR semantics and return only matching tool observations." }), { maxItems: 50 })),
				agentIds: Type.Optional(Type.Array(Type.String({ description: "Owned child agentId" }), { maxItems: 50 })),
				names: Type.Optional(Type.Array(piboStringEnum(names), { maxItems: 50 })),
				threadKeys: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
				eventTypes: Type.Optional(Type.Array(Type.String({ description: "Exact Pibo output event type. Explicit filters can retrieve progress events hidden by the default view." }), { maxItems: 50 })),
				kinds: Type.Optional(Type.Array(piboStringEnum(["message", "thinking", "tool", "error", "lifecycle", "event"], { description: "Optional broad event kinds, including progress events. Omit eventTypes and kinds for the compact default view." }), { maxItems: 6 })),
				roles: Type.Optional(Type.Array(Type.String({ description: "Exact normalized role, for example assistant" }), { maxItems: 20 })),
				since: Type.Optional(Type.String({ description: "Inclusive ISO-8601 lower timestamp bound" })),
				until: Type.Optional(Type.String({ description: "Inclusive ISO-8601 upper timestamp bound" })),
				textContains: Type.Optional(Type.String({ description: "Case-insensitive substring match against normalized observation text" })),
				textRegex: Type.Optional(Type.String({ description: "Case-sensitive rg/Rust-regex match against normalized observation text. Use inline flags such as (?i) to change case behavior. Combines with textContains using AND semantics. NUL text and literal or escaped NUL patterns are rejected; regex use requires the optional rg platform binary." })),
				cursorMode: Type.Optional(piboStringEnum(["auto", "history"], { default: "auto", description: "auto remembers this normalized query and returns only unread observations after its first newest-message snapshot. history ignores and does not change the saved cursor, allowing deliberate rereads." })),
				afterSequence: Type.Optional(Type.Integer({ description: "Explicit exclusive cursor override. In auto mode it replaces and advances the saved cursor for this normalized query; cursor pages consume the oldest unseen matches and desc reverses only the returned page.", minimum: 0 })),
				order: Type.Optional(piboStringEnum(["asc", "desc"], { default: "desc", description: "Newest first by default when no cursor is supplied" })),
				limit: Type.Optional(Type.Integer({ description: "Maximum completed messages or activity records to return. Use 50 explicitly when needed.", minimum: 1, maximum: 200, default: 20 })),
				includeTools: Type.Optional(Type.Boolean({ description: "Include compact tool calls and terminal results. Default false; enable only for stalls, errors, or targeted diagnosis. Prefer exact toolCallIds when known.", default: false })),
				toolDetail: Type.Optional(piboStringEnum(["summary", "full"], { default: "summary", description: "Tool text detail when tools are included. summary is compact; full remains bounded to the observation text limit." })),
				includeDetails: Type.Optional(Type.Boolean({ description: "Include the normalized source event in structured details. Default false; use only for diagnostics.", default: false })),
			}),
			async execute(_toolCallId, params) {
				const result = controller.observe(params as PiboAgentObserveInput);
				return {
					content: [{ type: "text", text: formatAgentObservationsForModel(result) }],
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
			description: `${subagent.description ?? `Send a message to the ${subagent.name} subagent.`} sessionName is required, trimmed, nonblank, and limited to 40 Unicode code points.`,
			promptSnippet: `Provide a nonblank sessionName of at most 40 Unicode code points. ${subagent.description ?? `Send a message to the ${subagent.name} subagent.`} Pass the same threadKey when you want to continue the same subagent session.`,
			executionMode: "parallel",
			inputSchema: Type.Object({
				sessionName: Type.String({
					description: "Required human-readable delegated-session title, trimmed before use and limited to 40 Unicode code points.",
					minLength: 1,
					maxLength: PIBO_AGENT_SESSION_NAME_MAX_LENGTH,
					pattern: "\\S",
				}),
				message: Type.String({ description: "Message to send to the subagent" }),
				threadKey: Type.Optional(Type.String({
					description: "Stable key for continuing a previous subagent conversation. Omit it to create a new subagent session.",
					maxLength: 256,
				})),
			}),
			prepareInput: preparePiboDeprecatedSubagentToolInput,
			async execute(toolCallId, params, signal) {
				const preparedParams = preparePiboDeprecatedSubagentToolInput(params);
				const result = await runner.runSubagent({
					subagent,
					sessionName: preparedParams.sessionName,
					message: preparedParams.message,
					threadKey: preparedParams.threadKey,
					toolCallId,
					signal,
				});
				return { content: [{ type: "text", text: result.reply.text }], details: result };
			},
		}));
	}
	return definitions;
}
