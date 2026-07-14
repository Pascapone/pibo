import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { transcriptTraceOrder } from "./trace-order.js";
import { attachAsyncAgentRunNode, reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import { sortTraceNodes } from "./trace-nodes.js";
import { createRunNotificationNode, parseRunNotificationText } from "./trace-run-notifications.js";
import { isSubagentToolName } from "./trace-subagent-links.js";
import type { TraceMessageTurnTiming } from "./trace-event-projection.js";
import type { PiboTraceNode, PiboTraceNodeStatus, PiboWebSessionStatus } from "./trace-types.js";

type MessageSessionEntry = Extract<SessionEntry, { type: "message" }>;

type IndexedMessageSessionEntry = {
	entry: MessageSessionEntry;
	index: number;
};

type MessagePart = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	result?: unknown;
	isError?: unknown;
};

export function projectTranscriptEntries(
	entries: SessionEntry[],
	sessionStatus: PiboWebSessionStatus,
	openTranscriptEventIds: ReadonlySet<string>,
): SessionEntry[] {
	if (sessionStatus !== "running" || openTranscriptEventIds.size === 0) return entries;
	let lastUserMessageIndex = -1;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.type === "message" && messageRole(entry) === "user") {
			lastUserMessageIndex = index;
			break;
		}
	}
	return lastUserMessageIndex === -1 ? entries : entries.slice(0, lastUserMessageIndex);
}

export function traceNodesFromEntries(
	piboSessionId: string,
	entries: SessionEntry[],
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): PiboTraceNode[] {
	const nodes: PiboTraceNode[] = [];
	const turnTimingAssignments = assignTranscriptTurnTimings(entries, turnTimings);
	let assistantTurnIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type === "message") {
			const role = messageRole(entry);
			if (role === "user") {
				nodes.push(createUserMessageNode(piboSessionId, entry, messageContent(entry), index));
			} else if (role === "assistant" || role === "toolResult") {
				const turn = collectAssistantTurn(entries, index);
				const hasAssistant = turn.entries.some(({ entry: turnEntry }) => messageRole(turnEntry) === "assistant");
				const timing = hasAssistant ? turnTimingAssignments[assistantTurnIndex] : undefined;
				nodes.push(...createAssistantTurnNodes(piboSessionId, turn.entries, timing));
				if (hasAssistant) assistantTurnIndex += 1;
				index = turn.nextIndex - 1;
			}
		} else if (entry.type === "session_info" && entry.name) {
			nodes.push({
				id: `entry:${entry.id}`,
				entryId: entry.id,
				piboSessionId,
				type: "execution.command",
				title: "Session Info",
				status: "done",
				startedAt: entry.timestamp,
				output: { name: entry.name },
				source: "transcript",
				stableKey: `entry:${entry.id}`,
				orderKey: transcriptTraceOrder(index, 0, "execution.command"),
				children: [],
			});
		}
	}
	reconcileAsyncAgentRunStatuses(nodes);
	sortTraceNodes(nodes);
	return nodes;
}

function messageRole(entry: MessageSessionEntry): unknown {
	return (entry.message as { role?: unknown }).role;
}

function messageContent(entry: MessageSessionEntry): unknown {
	return (entry.message as { content?: unknown }).content;
}

function messageParts(entry: MessageSessionEntry): unknown[] {
	const content = messageContent(entry);
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? content : [];
}

function assignTranscriptTurnTimings(
	entries: SessionEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
): Array<TraceMessageTurnTiming | undefined> {
	const transcriptTurns: Array<{ prompt?: string; assistantAt?: number }> = [];
	let latestUserText: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== "message") continue;
		const role = messageRole(entry);
		if (role === "user") {
			latestUserText = normalizedPrompt(extractText(messageContent(entry)));
			continue;
		}
		if (role !== "assistant" && role !== "toolResult") continue;
		const turn = collectAssistantTurn(entries, index);
		const lastAssistant = [...turn.entries].reverse().find(({ entry: turnEntry }) => messageRole(turnEntry) === "assistant");
		if (lastAssistant) {
			transcriptTurns.push({ prompt: latestUserText, assistantAt: parsedTimestamp(lastAssistant.entry.timestamp) });
		}
		index = turn.nextIndex - 1;
	}

	const assignments: Array<TraceMessageTurnTiming | undefined> = Array(transcriptTurns.length).fill(undefined);
	let timingCursor = turnTimings.length - 1;
	for (let turnIndex = transcriptTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
		const transcriptTurn = transcriptTurns[turnIndex];
		if (!transcriptTurn?.prompt) continue;
		let matchedIndex: number | undefined;
		let matchedDistance = Number.POSITIVE_INFINITY;
		for (let timingIndex = timingCursor; timingIndex >= 0; timingIndex -= 1) {
			const timing = turnTimings[timingIndex];
			if (normalizedPrompt(timing?.userText) !== transcriptTurn.prompt) continue;
			const completedAt = parsedTimestamp(timing?.completedAt);
			const distance = completedAt === undefined || transcriptTurn.assistantAt === undefined
				? Number.POSITIVE_INFINITY
				: Math.abs(completedAt - transcriptTurn.assistantAt);
			if (matchedIndex === undefined || distance < matchedDistance) {
				matchedIndex = timingIndex;
				matchedDistance = distance;
			}
		}
		if (matchedIndex === undefined) continue;
		assignments[turnIndex] = turnTimings[matchedIndex];
		timingCursor = matchedIndex - 1;
	}
	return assignments;
}

function normalizedPrompt(value: string | undefined): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

function parsedTimestamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function collectAssistantTurn(
	entries: SessionEntry[],
	startIndex: number,
): { entries: IndexedMessageSessionEntry[]; nextIndex: number } {
	const turnEntries: IndexedMessageSessionEntry[] = [];
	let index = startIndex;
	while (index < entries.length) {
		const entry = entries[index];
		if (entry.type !== "message") break;
		const role = messageRole(entry);
		if (role !== "assistant" && role !== "toolResult") break;
		turnEntries.push({ entry, index });
		index += 1;
	}
	return { entries: turnEntries, nextIndex: index };
}

function createUserMessageNode(
	piboSessionId: string,
	entry: MessageSessionEntry,
	content: unknown,
	entryIndex: number,
): PiboTraceNode {
	const text = extractText(content);
	const notification = parseRunNotificationText(text);
	if (notification) {
		return createRunNotificationNode({
			id: `entry:${entry.id}`,
			entryId: entry.id,
			piboSessionId,
			startedAt: entry.timestamp,
			orderKey: transcriptTraceOrder(entryIndex, 0, "yielded.run"),
			source: "transcript",
			stableKey: `entry:${entry.id}`,
			notification,
		});
	}
	return {
		id: `entry:${entry.id}`,
		entryId: entry.id,
		piboSessionId,
		type: "user.message",
		title: "User Message",
		status: "done",
		startedAt: entry.timestamp,
		summary: text,
		output: text,
		source: "transcript",
		stableKey: `entry:${entry.id}`,
		orderKey: transcriptTraceOrder(entryIndex, 0, "user.message"),
		children: [],
	};
}

function createAssistantTurnNodes(
	piboSessionId: string,
	entries: IndexedMessageSessionEntry[],
	timing?: TraceMessageTurnTiming,
): PiboTraceNode[] {
	const firstAssistant = entries.find(({ entry }) => messageRole(entry) === "assistant");
	if (!firstAssistant) return [];

	const orderedNodes: PiboTraceNode[] = [];
	const toolsByCallId = new Map<string, PiboTraceNode>();

	for (const { entry, index: entryIndex } of entries) {
		if (messageRole(entry) === "toolResult") {
			mergePersistedToolResult(toolsByCallId, orderedNodes, entry, piboSessionId, entryIndex);
			continue;
		}

		const responseStatus = messageStatus(entry.message);
		const responseError = messageError(entry.message);
		let responseNode: PiboTraceNode | undefined;

		for (const [index, part] of messageParts(entry).entries()) {
			const typed = part as MessagePart;
			if (typed.type === "thinking" && typeof typed.thinking === "string" && hasVisibleText(typed.thinking)) {
				orderedNodes.push(createReasoningNode(piboSessionId, entry, entryIndex, index, typed.thinking));
			} else if (typed.type === "text" && typeof typed.text === "string" && typed.text !== "") {
				if (!responseNode) {
					responseNode = createAssistantMessageNode({
						id: `entry:${entry.id}:response`,
						piboSessionId,
						entry,
						entryIndex,
						contentPartIndex: index,
						status: responseStatus,
						text: typed.text,
						error: responseError,
						children: [],
						startedAt: entry.timestamp,
					});
					orderedNodes.push(responseNode);
				} else {
					responseNode.summary = `${typeof responseNode.summary === "string" ? responseNode.summary : ""}${typed.text}`;
					responseNode.output = `${typeof responseNode.output === "string" ? responseNode.output : ""}${typed.text}`;
				}
			} else if (typed.type === "toolCall" && typeof typed.id === "string" && typeof typed.name === "string") {
				const toolNode = createToolCallNode(piboSessionId, entry, entryIndex, index, typed);
				orderedNodes.push(toolNode);
				toolsByCallId.set(typed.id, toolNode);
			}
		}

		if (responseNode) {
			responseNode.status = responseStatus;
			responseNode.error = responseError;
		}
	}
	const finalNode = orderedNodes.at(-1);
	if (finalNode?.type === "assistant.message" && finalNode.status === "done") {
		finalNode.completedAt = timing?.completedAt ?? finalNode.startedAt;
		finalNode.durationMs = timing?.durationMs;
	}
	return orderedNodes;
}

function createReasoningNode(
	piboSessionId: string,
	entry: MessageSessionEntry,
	entryIndex: number,
	index: number,
	thinking: string,
): PiboTraceNode {
	return {
		id: `entry:${entry.id}:thinking:${index}`,
		entryId: entry.id,
		piboSessionId,
		type: "model.reasoning",
		title: "Thinking",
		status: "done",
		startedAt: entry.timestamp,
		summary: thinking,
		output: thinking,
		source: "transcript",
		stableKey: `entry:${entry.id}:thinking:${index}`,
		orderKey: transcriptTraceOrder(entryIndex, index, "model.reasoning"),
		children: [],
	};
}

function createToolCallNode(
	piboSessionId: string,
	entry: MessageSessionEntry,
	entryIndex: number,
	contentPartIndex: number,
	part: MessagePart,
): PiboTraceNode {
	const name = typeof part.name === "string" ? part.name : "Tool Call";
	const toolCallId = typeof part.id === "string" ? part.id : undefined;
	return {
		id: `entry:${entry.id}:tool:${String(part.id)}`,
		entryId: entry.id,
		piboSessionId,
		toolCallId,
		type: isSubagentToolName(name) ? "agent.delegation" : "tool.call",
		title: name,
		status: "done",
		startedAt: entry.timestamp,
		input: part.arguments ?? {},
		source: "transcript",
		stableKey: toolCallId ? `tool:${toolCallId}` : `entry:${entry.id}:tool:${contentPartIndex}`,
		orderKey: transcriptTraceOrder(
			entryIndex,
			contentPartIndex,
			isSubagentToolName(name) ? "agent.delegation" : "tool.call",
		),
		children: [],
	};
}

function mergePersistedToolResult(
	toolsByCallId: Map<string, PiboTraceNode>,
	childNodes: PiboTraceNode[],
	entry: MessageSessionEntry,
	piboSessionId: string,
	entryIndex: number,
): void {
	const message = entry.message as {
		toolCallId?: unknown;
		toolName?: unknown;
		content?: unknown;
		details?: unknown;
		isError?: unknown;
	};
	const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
	if (!toolCallId) return;

	let toolNode = toolsByCallId.get(toolCallId);
	if (!toolNode) {
		toolNode = createMissingToolResultNode(piboSessionId, entry, entryIndex, toolCallId);
		childNodes.push(toolNode);
		toolsByCallId.set(toolCallId, toolNode);
	}
	toolNode.status = message.isError === true ? "error" : "done";
	toolNode.completedAt = entry.timestamp;
	toolNode.output = toolResultOutput(message);
	toolNode.error = message.isError === true ? stringifyPreview(toolNode.output) : undefined;
	attachAsyncAgentRunNode(toolNode, piboSessionId, entry.timestamp);
}

function createMissingToolResultNode(
	piboSessionId: string,
	entry: MessageSessionEntry,
	entryIndex: number,
	toolCallId: string,
): PiboTraceNode {
	const message = entry.message as { toolName?: unknown };
	return {
		id: `entry:${entry.id}:tool-result:${toolCallId}`,
		entryId: entry.id,
		piboSessionId,
		toolCallId,
		type: "tool.result",
		title: typeof message.toolName === "string" ? message.toolName : "Tool Result",
		status: "done",
		startedAt: entry.timestamp,
		source: "transcript",
		stableKey: `tool:${toolCallId}`,
		orderKey: transcriptTraceOrder(entryIndex, 0, "tool.result"),
		children: [],
	};
}

function toolResultOutput(message: { content?: unknown; details?: unknown }): unknown {
	if (message.details === undefined) return { content: message.content };
	return { content: message.content, details: message.details };
}

function createAssistantMessageNode(input: {
	id: string;
	piboSessionId: string;
	entry: MessageSessionEntry;
	entryIndex: number;
	contentPartIndex: number;
	status: PiboTraceNodeStatus;
	text: string;
	error?: string;
	children?: PiboTraceNode[];
	startedAt?: string;
	completedAt?: string;
}): PiboTraceNode {
	return {
		id: input.id,
		entryId: input.entry.id,
		piboSessionId: input.piboSessionId,
		type: "assistant.message",
		title: "Agent Message",
		status: input.status,
		startedAt: input.startedAt ?? input.entry.timestamp,
		completedAt: input.completedAt,
		summary: input.text,
		output: input.text,
		error: input.error,
		source: "transcript",
		stableKey: `entry:${input.entry.id}:response:${input.contentPartIndex}`,
		orderKey: transcriptTraceOrder(input.entryIndex, input.contentPartIndex, "assistant.message"),
		children: input.children ?? [],
	};
}

function messageStatus(message: unknown): PiboTraceNodeStatus {
	if (message && typeof message === "object") {
		const stopReason = (message as { stopReason?: unknown }).stopReason;
		const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
		if (stopReason === "error" || typeof errorMessage === "string") return "error";
	}
	return "done";
}

function messageError(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
	return typeof errorMessage === "string" ? errorMessage : undefined;
}

function hasVisibleText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const typed = part as MessagePart;
			if (typed.type === "text" && typeof typed.text === "string") return typed.text;
			return "";
		})
		.join("");
}

function stringifyPreview(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
