import { existsSync, readFileSync } from "node:fs";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PiboOutputEvent, PiboSessionListItem } from "../../core/events.js";
import type { PiboSession } from "../../sessions/store.js";
import { childTraceOrder, compareTraceOrder, eventTraceOrder, transcriptTraceOrder, type TraceOrderKey, type TraceSource } from "../../shared/trace-order.js";
import type { ChatWebSessionIndexItem, ChatWebStoredEvent } from "./read-model.js";
import { isChatWebSessionArchived } from "./session-metadata.js";

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	profile: string;
	title: string;
	subtitle?: string;
	archived?: boolean;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
	unreadCount?: number;
	children: PiboWebSessionNode[];
};

export type PiboTraceNodeType =
	| "user.message"
	| "assistant.message"
	| "agent.turn"
	| "model.reasoning"
	| "tool.call"
	| "tool.result"
	| "agent.delegation"
	| "agent.async"
	| "execution.command"
	| "yielded.run"
	| "error";

export type PiboTraceNodeStatus = "running" | "done" | "error";

export type PiboTraceSource = TraceSource;

export type PiboTraceOrderKey = TraceOrderKey;

export type PiboTraceNode = {
	id: string;
	parentId?: string;
	entryId?: string;
	piboSessionId: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	type: PiboTraceNodeType;
	title: string;
	status: PiboTraceNodeStatus;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedPiboSessionId?: string;
	source?: PiboTraceSource;
	stableKey?: string;
	orderKey?: PiboTraceOrderKey;
	children: PiboTraceNode[];
};

export type PiboSessionTraceView = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	nodes: PiboTraceNode[];
	rawEvents: ChatWebStoredEvent[];
};

type SessionMetadata = {
	sessionPath?: string;
	name?: string;
	firstMessage?: string;
	modified?: string;
};

type TraceBuildInput = {
	session: PiboSession;
	sessions: PiboSession[];
	events: ChatWebStoredEvent[];
	status?: PiboWebSessionStatus;
	cwd?: string;
};

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

type RunNotificationRun = {
	runId?: unknown;
	kind?: unknown;
	status?: unknown;
	toolName?: unknown;
	summary?: unknown;
};

type RunNotificationPayload = {
	completed?: unknown;
	failed?: unknown;
	cancelled?: unknown;
	running?: unknown;
	instruction?: unknown;
};


export async function loadPiSessionMetadata(
	session: PiboSession,
	cwd = process.cwd(),
): Promise<SessionMetadata> {
	const piSession = await findPiSession(session, cwd);
	return metadataFromPiSession(piSession);
}

function metadataFromPiSession(piSession: PiboSessionListItem | undefined): SessionMetadata {
	if (!piSession) return {};
	return {
		sessionPath: piSession.path,
		name: piSession.name,
		firstMessage: piSession.firstMessage,
		modified: piSession.modified,
	};
}

export async function buildSessionNodes(
	sessions: PiboSession[],
	indexItems: ChatWebSessionIndexItem[],
	cwd = process.cwd(),
	unreadCounts: ReadonlyMap<string, number> = new Map(),
): Promise<PiboWebSessionNode[]> {
	const indexByKey = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	const nodes = new Map<string, PiboWebSessionNode>();
	const piSessionsByCwd = new Map<string, Promise<PiboSessionListItem[]>>();

	for (const session of sessions) {
		const sessionCwd = session.workspace ?? cwd;
		let piSessions = piSessionsByCwd.get(sessionCwd);
		if (!piSessions) {
			piSessions = listPiSessions(sessionCwd);
			piSessionsByCwd.set(sessionCwd, piSessions);
		}
		const metadata = metadataFromPiSession((await piSessions).find((piSession) => piSession.id === session.piSessionId));
		const indexed = indexByKey.get(session.id);
		nodes.set(session.id, {
			piboSessionId: session.id,
			piSessionId: session.piSessionId,
			parentId: session.parentId,
			profile: session.profile,
			title: createSessionTitle(session, metadata),
			subtitle: session.id,
			archived: isChatWebSessionArchived(session),
			status: indexed?.status ?? "idle",
			lastActivityAt: indexed?.lastActivityAt ?? metadata.modified ?? session.updatedAt,
			unreadCount: unreadCounts.get(session.id) || undefined,
			children: [],
		});
	}

	const roots: PiboWebSessionNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentId ? nodes.get(node.parentId) : undefined;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sortNodes = (items: PiboWebSessionNode[]): void => {
		items.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
		for (const item of items) sortNodes(item.children);
	};
	sortNodes(roots);
	return roots;
}

export async function buildTraceView(input: TraceBuildInput): Promise<PiboSessionTraceView> {
	const metadata = await loadPiSessionMetadata(input.session, input.session.workspace ?? input.cwd);
	const entries = metadata.sessionPath ? readEntries(metadata.sessionPath) : [];
	const nodes = traceNodesFromEntries(input.session.id, entries);
	const byId = mapTraceNodesById(nodes);
	const childByParent = mapChildren(input.sessions);
	const linkedChildByToolCallId = mapSubagentSessionLinks(input.events);
	const hasPersistedTranscript = entries.some((entry) => entry.type === "message");
	const sessionStatus = input.status ?? "idle";
	const openTranscriptEventIds = findOpenTranscriptEventIds(input.events, sessionStatus);

	for (const storedEvent of input.events) {
		if (
			hasPersistedTranscript &&
			isTranscriptEchoEvent(storedEvent.payload) &&
			!shouldKeepTranscriptEchoEvent(storedEvent.payload, openTranscriptEventIds)
		) {
			continue;
		}
		if (hasPersistedTranscript && isStaleToolCallEchoEvent(storedEvent.payload, sessionStatus)) {
			continue;
		}
		if (storedEvent.payload.type === "assistant_delta") {
			mergeAssistantDeltaEvent(nodes, byId, storedEvent.payload, sessionStatus, storedEvent.createdAt, storedEvent.eventSequence);
			continue;
		}
		if (storedEvent.payload.type === "thinking_delta") {
			mergeThinkingDeltaEvent(nodes, byId, storedEvent.payload, sessionStatus, storedEvent.createdAt, storedEvent.eventSequence);
			continue;
		}
		const node = traceNodeFromEvent(
			input.session.id,
			storedEvent.payload,
			childByParent,
			linkedChildByToolCallId,
			sessionStatus,
			storedEvent.createdAt,
			storedEvent.eventSequence,
		);
		if (!node) continue;
		if (node.type === "agent.turn" && node.eventId) {
			const existingTurn = [...byId.values()].find(
				(candidate) => candidate.type === "agent.turn" && candidate.eventId === node.eventId,
			);
			if (existingTurn) {
				existingTurn.status = node.status;
				existingTurn.completedAt = node.completedAt ?? existingTurn.completedAt;
				continue;
			}
		}
		if (node.type === "assistant.message") {
			const existing = byId.get(node.id);
			if (existing) {
				mergeAssistantMessageEvent(existing, node);
				closeParentTurnForFinalAssistant(byId, existing);
				continue;
			}
			closeParentTurnForFinalAssistant(byId, node);
		}
		if (node.type === "model.reasoning") {
			const existing = byId.get(node.id);
			if (existing) {
				mergeReasoningEvent(existing, node);
				continue;
			}
		}
		if (node.toolCallId) {
			const existing = [...byId.values()].find(
				(candidate) =>
					candidate.toolCallId === node.toolCallId &&
					(candidate.type === "tool.call" || candidate.type === "agent.delegation"),
			);
			if (existing) {
				if (isRunStartToolNode(existing) && node.type === "agent.delegation") {
					attachAsyncAgentRunNode(existing, input.session.id, storedEvent.createdAt, node);
					continue;
				}
				mergeToolEvent(existing, node);
				attachAsyncAgentRunNode(existing, input.session.id, storedEvent.createdAt);
				continue;
			}
		}
		if (node.eventId && byId.has(node.id)) continue;
		attachAsyncAgentRunNode(node, input.session.id, storedEvent.createdAt);
		nodes.push(node);
		for (const indexed of flattenTraceNodes([node])) byId.set(indexed.id, indexed);
	}

	const nestedNodes = nestTraceNodes(nodes);
	reconcileAsyncAgentRunStatuses(nestedNodes);
	sortTraceNodes(nestedNodes);

	return {
		piboSessionId: input.session.id,
		piSessionId: input.session.piSessionId,
		title: createSessionTitle(input.session, metadata),
		nodes: nestedNodes,
		rawEvents: input.events,
	};
}

export async function listPiSessions(cwd = process.cwd()): Promise<PiboSessionListItem[]> {
	const sessions = await SessionManager.list(cwd);
	return sessions.map((session) => ({
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	}));
}

function createSessionTitle(session: PiboSession, metadata: SessionMetadata): string {
	const candidate = session.title || metadata.name || metadata.firstMessage || session.id;
	return truncateTitle(candidate);
}

function truncateTitle(title: string, maxLength = 56): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized || "Untitled Session";
	return `${normalized.slice(0, maxLength - 1)}…`;
}

async function findPiSession(piboSession: PiboSession, cwd: string): Promise<PiboSessionListItem | undefined> {
	const sessions = await listPiSessions(cwd);
	return sessions.find((session) => session.id === piboSession.piSessionId);
}

function readEntries(path: string): SessionEntry[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	return parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
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

export function traceNodesFromEntries(piboSessionId: string, entries: SessionEntry[]): PiboTraceNode[] {
	const nodes: PiboTraceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type === "message") {
			const role = messageRole(entry);
			if (role === "user") {
				nodes.push(createUserMessageNode(piboSessionId, entry, messageContent(entry), index));
			} else if (role === "assistant" || role === "toolResult") {
				const turn = collectAssistantTurn(entries, index);
				nodes.push(...createAssistantTurnNodes(piboSessionId, turn.entries));
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

function collectAssistantTurn(entries: SessionEntry[], startIndex: number): { entries: IndexedMessageSessionEntry[]; nextIndex: number } {
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

function createAssistantTurnNodes(piboSessionId: string, entries: IndexedMessageSessionEntry[]): PiboTraceNode[] {
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
						completedAt: entry.timestamp,
					});
					orderedNodes.push(responseNode);
				} else {
					responseNode.summary = `${typeof responseNode.summary === "string" ? responseNode.summary : ""}${typed.text}`;
					responseNode.output = `${typeof responseNode.output === "string" ? responseNode.output : ""}${typed.text}`;
					responseNode.completedAt = entry.timestamp;
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
		orderKey: transcriptTraceOrder(entryIndex, contentPartIndex, isSubagentToolName(name) ? "agent.delegation" : "tool.call"),
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

function traceNodeFromEvent(
	piboSessionId: string,
	event: PiboOutputEvent,
	childByParent: Map<string, PiboSession[]>,
	linkedChildByToolCallId: Map<string, string>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
): PiboTraceNode | undefined {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const id = `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
	const turnParentId = eventId ? messageTurnNodeId(eventId) : undefined;
	const base = {
		id,
		piboSessionId,
		eventId,
		startedAt: createdAt,
		source: "event-log" as const,
		stableKey: eventStableKey(event),
		orderKey: eventTraceNodeOrder(eventSequence, event.type),
		children: [] as PiboTraceNode[],
	};

	switch (event.type) {
		case "message_queued": {
			const notification = parseRunNotificationText(event.text);
			if (event.source === "service" && notification) {
				return createRunNotificationNode({
					id,
					piboSessionId,
					eventId,
					startedAt: createdAt,
					source: "event-log",
					stableKey: eventId ? `run-notification:${eventId}` : id,
					orderKey: eventTraceNodeOrder(eventSequence, event.type),
					notification,
				});
			}
			return {
				...base,
				type: "user.message",
				title: "User Message",
				status: "done",
				summary: event.text,
				output: event.text,
			};
		}
		case "message_started":
		case "message_finished":
			if (event.source === "service") return undefined;
			return {
				...base,
				id: eventId ? messageTurnNodeId(eventId) : id,
				type: "agent.turn",
				title: "Agent Turn",
				status: event.type === "message_finished" || sessionStatus !== "running" ? "done" : "running",
				completedAt: event.type === "message_finished" ? createdAt : undefined,
				summary: event.type === "message_started" ? event.text : undefined,
				input: event.type === "message_started" ? { text: event.text, source: event.source } : undefined,
				stableKey: eventId ? `turn:${eventId}` : base.stableKey,
			};
		case "thinking_finished":
			if (!hasVisibleText(event.text)) return undefined;
			return {
				...base,
				id: eventId ? thinkingNodeId(eventId) : id,
				parentId: turnParentId,
				type: "model.reasoning",
				title: "Thinking",
				status: "done",
				summary: event.text,
				output: event.text,
				stableKey: eventId ? `reasoning:${eventId}` : base.stableKey,
			};
		case "assistant_message":
			return {
				...base,
				id: eventId ? assistantMessageNodeId(eventId) : id,
				parentId: turnParentId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				summary: event.text,
				output: event.text,
				stableKey: eventId ? `assistant:${eventId}` : base.stableKey,
			};
			case "tool_call":
			case "tool_execution_started":
			case "tool_execution_updated":
			case "tool_execution_finished": {
				const subagentTool = isSubagentToolName(event.toolName);
				const linkedPiboSessionId =
					linkedChildByToolCallId.get(event.toolCallId) ??
					(subagentTool ? findLikelyChildSession(piboSessionId, event.toolName, event, childByParent) : undefined);
				return {
				...base,
				id: `tool:${event.toolCallId}`,
				parentId: turnParentId,
				toolCallId: event.toolCallId,
				type: subagentTool ? "agent.delegation" : "tool.call",
				title: event.toolName,
				status:
					event.type === "tool_execution_finished"
						? event.isError
							? "error"
							: "done"
						: sessionStatus === "running" &&
							  (event.type === "tool_execution_started" || event.type === "tool_execution_updated")
							? "running"
							: "done",
				completedAt: event.type === "tool_execution_finished" ? createdAt : undefined,
				input: "args" in event ? event.args : undefined,
				output:
					event.type === "tool_execution_finished"
						? event.result
						: event.type === "tool_execution_updated"
							? event.partialResult
							: undefined,
				error:
					event.type === "tool_execution_finished" && event.isError ? stringifyPreview(event.result) : undefined,
				linkedPiboSessionId,
				stableKey: `tool:${event.toolCallId}`,
				children: [],
			};
		}
		case "subagent_session":
			return {
				...base,
				id: event.toolCallId ? `tool:${event.toolCallId}` : id,
				eventId,
				toolCallId: event.toolCallId,
				type: "agent.delegation",
				title: event.toolName,
				status: sessionStatus === "running" ? "running" : "done",
				summary: event.subagentName,
				input: { subagentName: event.subagentName, threadKey: event.threadKey },
				linkedPiboSessionId: event.childPiboSessionId,
				stableKey: event.toolCallId ? `tool:${event.toolCallId}` : `subagent:${event.childPiboSessionId}`,
				children: [],
			};
		case "execution_result":
			if (isInternalSessionOperation(event.action)) return undefined;
			return {
				...base,
				type: "execution.command",
				title: event.action,
				status: "done",
				input: { action: event.action },
				output: event.result,
			};
		case "session_error":
			return {
				...base,
				type: "error",
				title: "Error",
				status: "error",
				error: event.error,
				output: event.error,
			};
		default:
			return undefined;
	}
}

function mergeAssistantDeltaEvent(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	event: Extract<PiboOutputEvent, { type: "assistant_delta" }>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
): void {
	if (event.text.length === 0) return;

	const id = event.eventId ? assistantMessageNodeId(event.eventId) : `event:assistant_delta:${cryptoSafeId(event)}`;
	const existing = byId.get(id);
	if (existing) {
		const text = `${typeof existing.output === "string" ? existing.output : ""}${event.text}`;
		existing.status = sessionStatus === "running" ? "running" : "done";
		existing.summary = text;
		existing.output = text;
		return;
	}

	const node: PiboTraceNode = {
		id,
		parentId: event.eventId ? messageTurnNodeId(event.eventId) : undefined,
		piboSessionId: event.piboSessionId,
		eventId: event.eventId,
		type: "assistant.message",
		title: "Agent Message",
		status: sessionStatus === "running" ? "running" : "done",
		startedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey: event.eventId ? `assistant:${event.eventId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type),
		children: [],
	};
	nodes.push(node);
	byId.set(node.id, node);
}

function mergeAssistantMessageEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
}

function mergeThinkingDeltaEvent(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	event: Extract<PiboOutputEvent, { type: "thinking_delta" }>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
): void {
	if (event.text.length === 0) return;

	const id = event.eventId ? thinkingNodeId(event.eventId) : `event:thinking_delta:${cryptoSafeId(event)}`;
	const existing = byId.get(id);
	if (existing) {
		const text = `${typeof existing.output === "string" ? existing.output : ""}${event.text}`;
		existing.status = sessionStatus === "running" ? "running" : "done";
		existing.summary = text;
		existing.output = text;
		return;
	}

	const node: PiboTraceNode = {
		id,
		parentId: event.eventId ? messageTurnNodeId(event.eventId) : undefined,
		piboSessionId: event.piboSessionId,
		eventId: event.eventId,
		type: "model.reasoning",
		title: "Thinking",
		status: sessionStatus === "running" ? "running" : "done",
		startedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey: event.eventId ? `reasoning:${event.eventId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type),
		children: [],
	};
	nodes.push(node);
	byId.set(node.id, node);
}

function mergeReasoningEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.output = update.output ?? target.output;
	target.completedAt = update.completedAt ?? target.completedAt;
}

function closeParentTurnForFinalAssistant(byId: Map<string, PiboTraceNode>, assistant: PiboTraceNode): void {
	if (!assistant.parentId || assistant.status !== "done") return;
	const parent = byId.get(assistant.parentId);
	if (!parent || parent.type !== "agent.turn") return;
	parent.status = "done";
	parent.completedAt = assistant.completedAt ?? assistant.startedAt ?? parent.completedAt;
}

function isInternalSessionOperation(action: string): boolean {
	return action === "session.fork" || action === "session.clone" || action === "session.switch";
}

function isTranscriptEchoEvent(event: PiboOutputEvent): boolean {
	return (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "message_finished" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	);
}

function shouldKeepTranscriptEchoEvent(event: PiboOutputEvent, openTranscriptEventIds: ReadonlySet<string>): boolean {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	return Boolean(eventId && openTranscriptEventIds.has(eventId));
}

function isStaleToolCallEchoEvent(event: PiboOutputEvent, sessionStatus: PiboWebSessionStatus): boolean {
	return sessionStatus !== "running" && event.type === "tool_call";
}

function findOpenTranscriptEventIds(events: ChatWebStoredEvent[], sessionStatus: PiboWebSessionStatus): Set<string> {
	if (sessionStatus !== "running") return new Set();

	const open = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload;
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId) continue;
		if (isOpenTranscriptEvent(event)) {
			open.add(eventId);
		} else if (event.type === "message_finished" || event.type === "session_error") {
			open.delete(eventId);
		}
	}
	return open;
}

function isOpenTranscriptEvent(event: PiboOutputEvent): boolean {
	return (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	);
}

function eventTraceNodeOrder(eventSequence: number | undefined, type: PiboOutputEvent["type"]): PiboTraceOrderKey {
	return eventTraceOrder(eventSequence, eventNodeKind(type));
}

function eventNodeKind(type: PiboOutputEvent["type"]): PiboTraceNodeType {
	switch (type) {
		case "message_queued":
			return "user.message";
		case "message_started":
		case "message_finished":
			return "agent.turn";
		case "thinking_started":
		case "thinking_delta":
		case "thinking_finished":
			return "model.reasoning";
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished":
		case "subagent_session":
			return "tool.call";
		case "assistant_delta":
		case "assistant_message":
			return "assistant.message";
		case "execution_result":
			return "execution.command";
		case "session_error":
			return "error";
		default:
			return "execution.command";
	}
}

function eventStableKey(event: PiboOutputEvent): string {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	if (event.type === "tool_call" || event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") {
		return `tool:${event.toolCallId}`;
	}
	if (event.type === "subagent_session" && event.toolCallId) return `tool:${event.toolCallId}`;
	if (eventId && (event.type === "message_started" || event.type === "message_finished")) return `turn:${eventId}`;
	if (eventId && (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished")) return `reasoning:${eventId}`;
	if (eventId && (event.type === "assistant_delta" || event.type === "assistant_message")) return `assistant:${eventId}`;
	return `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
}

function messageTurnNodeId(eventId: string): string {
	return `event:message:${eventId}`;
}

function assistantMessageNodeId(eventId: string): string {
	return `event:assistant:${eventId}`;
}

function thinkingNodeId(eventId: string): string {
	return `event:thinking:${eventId}`;
}

function mapTraceNodesById(nodes: PiboTraceNode[]): Map<string, PiboTraceNode> {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of flattenTraceNodes(nodes)) byId.set(node.id, node);
	return byId;
}

function sortTraceNodes(nodes: PiboTraceNode[]): void {
	nodes.sort(compareTraceNodes);
	for (const node of nodes) sortTraceNodes(node.children);
}

function compareTraceNodes(left: PiboTraceNode, right: PiboTraceNode): number {
	const byOrder = compareTraceOrder(left.orderKey, right.orderKey);
	if (byOrder !== 0) return byOrder;
	return (left.startedAt ?? "").localeCompare(right.startedAt ?? "") || left.id.localeCompare(right.id);
}

function flattenTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children)]);
}

function nestTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of nodes) {
		byId.set(node.id, { ...node, children: [...node.children] });
	}

	const nestedChildIds = new Set<string>();
	for (const node of byId.values()) {
		if (!node.parentId) continue;
		const parent = byId.get(node.parentId);
		if (!parent) continue;
		parent.children.push(node);
		nestedChildIds.add(node.id);
	}

	const roots = [...byId.values()].filter((node) => !nestedChildIds.has(node.id));
	sortTraceNodes(roots);
	return roots;
}

function mergeToolEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
	target.linkedPiboSessionId = update.linkedPiboSessionId ?? target.linkedPiboSessionId;
}

function attachAsyncAgentRunNode(
	parent: PiboTraceNode,
	piboSessionId: string,
	startedAt?: string,
	delegation?: PiboTraceNode,
): void {
	const node = createAsyncAgentRunNode(parent, piboSessionId, startedAt, delegation);
	if (!node) return;
	const existing = parent.children.find((child) => child.id === node.id);
	if (existing) {
		mergeToolEvent(existing, node);
		existing.runId = node.runId ?? existing.runId;
		return;
	}
	parent.children.push(node);
}

function reconcileAsyncAgentRunStatuses(nodes: PiboTraceNode[]): void {
	const runSnapshots = new Map<string, { snapshot: Record<string, unknown>; completedAt?: string }>();
	for (const node of flattenTraceNodes(nodes)) {
		const snapshot = extractRunSnapshot(node.output);
		if (!snapshot) continue;
		const runId = stringValue(snapshot.runId);
		if (!runId) continue;
		runSnapshots.set(runId, {
			snapshot,
			completedAt: stringValue(snapshot.completedAt) ?? stringValue(snapshot.updatedAt) ?? node.completedAt,
		});
	}

	for (const node of flattenTraceNodes(nodes)) {
		if (node.type !== "agent.async" || !node.runId) continue;
		const latest = runSnapshots.get(node.runId);
		if (!latest) continue;
		const status = stringValue(latest.snapshot.status);
		if (status !== "completed" && status !== "cancelled" && status !== "failed") continue;
		node.status = status === "failed" ? "error" : "done";
		node.completedAt = latest.completedAt ?? node.completedAt;
		node.output = latest.snapshot;
		if (status === "failed") node.error = stringValue(latest.snapshot.summary) ?? node.error;
	}
}

function createAsyncAgentRunNode(
	parent: PiboTraceNode,
	piboSessionId: string,
	startedAt?: string,
	delegation?: PiboTraceNode,
): PiboTraceNode | undefined {
	if (!isRunStartToolNode(parent)) return undefined;

	const run = extractRunSnapshot(parent.output);
	const input = isRecord(parent.input) ? parent.input : {};
	const toolName = stringValue(run?.toolName) ?? stringValue(input.toolName) ?? delegation?.title;
	if (!toolName || !isSubagentToolName(toolName)) return undefined;

	const subagentName = stringValue(delegation?.summary) ?? subagentNameFromToolName(toolName);
	const runId = stringValue(run?.runId);
	const runStatus = stringValue(run?.status);
	const delegatedArguments = input.arguments;
	const completionPolicy = stringValue(run?.completionPolicy) ?? stringValue(input.completionPolicy);

	return {
		id: `${parent.id}:async-agent`,
		parentId: parent.id,
		piboSessionId,
		eventId: parent.eventId,
		toolCallId: parent.toolCallId,
		runId,
		type: "agent.async",
		title: subagentName,
		status: asyncAgentStatus(parent, runStatus),
		startedAt: delegation?.startedAt ?? startedAt ?? parent.startedAt,
		completedAt: runStatus === "completed" || runStatus === "cancelled" ? parent.completedAt : undefined,
		summary: `Started by ${parent.title}`,
		input: {
			startedBy: parent.title,
			startToolCallId: parent.toolCallId,
			toolName,
			subagentName,
			runId,
			completionPolicy,
			arguments: delegatedArguments,
			threadKey: isRecord(delegation?.input) ? delegation.input.threadKey : undefined,
		},
		output: run,
		error: parent.error,
		linkedPiboSessionId: delegation?.linkedPiboSessionId ?? parent.linkedPiboSessionId,
		source: parent.source,
		stableKey: runId ? `async-agent:${runId}` : `${parent.stableKey ?? parent.id}:async-agent`,
		orderKey: childTraceOrder(parent.orderKey, "agent.async"),
		children: [],
	};
}

function isRunStartToolNode(node: PiboTraceNode): boolean {
	return node.type === "tool.call" && node.title === "pibo_run_start";
}

function extractRunSnapshot(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	if (isRunSnapshot(value)) return value;
	if (isRecord(value.details) && isRunSnapshot(value.details)) return value.details;
	return undefined;
}

function isRunSnapshot(value: Record<string, unknown>): boolean {
	return typeof value.runId === "string" && typeof value.toolName === "string";
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function subagentNameFromToolName(toolName: string): string {
	return toolName.slice("pibo_subagent_".length);
}

function asyncAgentStatus(parent: PiboTraceNode, runStatus?: string): PiboTraceNodeStatus {
	if (parent.status === "error" || runStatus === "failed") return "error";
	if (runStatus === "completed" || runStatus === "cancelled") return "done";
	return "running";
}

function mapChildren(sessions: PiboSession[]): Map<string, PiboSession[]> {
	const result = new Map<string, PiboSession[]>();
	for (const session of sessions) {
		if (!session.parentId) continue;
		const children = result.get(session.parentId) ?? [];
		children.push(session);
		result.set(session.parentId, children);
	}
	return result;
}

function mapSubagentSessionLinks(events: ChatWebStoredEvent[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload;
		if (event.type !== "subagent_session" || !event.toolCallId) continue;
		result.set(event.toolCallId, event.childPiboSessionId);
	}
	return result;
}

function findLikelyChildSession(
	piboSessionId: string,
	toolName: string,
	event: Extract<PiboOutputEvent, { type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" }>,
	childByParent: Map<string, PiboSession[]>,
): string | undefined {
	if (!isSubagentToolName(toolName)) return undefined;
	const candidates =
		childByParent.get(piboSessionId)?.filter((session) => session.metadata?.subagentToolName === toolName) ?? [];
	const threadKey = toolEventThreadKey(event);
	if (threadKey) {
		return candidates.find((session) => session.metadata?.threadKey === threadKey)?.id;
	}
	return candidates.length === 1 ? candidates[0].id : undefined;
}

function isSubagentToolName(name: string): boolean {
	return name.startsWith("pibo_subagent_");
}

function toolEventThreadKey(
	event: Extract<PiboOutputEvent, { type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" }>,
): string | undefined {
	const args = "args" in event && event.args && typeof event.args === "object" && !Array.isArray(event.args) ? event.args : undefined;
	const threadKey = args && "threadKey" in args ? args.threadKey : undefined;
	return typeof threadKey === "string" && threadKey.trim() ? threadKey.trim() : undefined;
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

function parseRunNotificationText(text: string): RunNotificationPayload | undefined {
	const trimmed = text.trim();
	const start = "<pibo_run_notification>";
	const end = "</pibo_run_notification>";
	if (!trimmed.startsWith(start) || !trimmed.endsWith(end)) return undefined;

	const jsonText = trimmed.slice(start.length, trimmed.length - end.length).trim();
	try {
		const parsed = JSON.parse(jsonText) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as RunNotificationPayload;
	} catch {
		return undefined;
	}
}

function createRunNotificationNode(input: {
	id: string;
	piboSessionId: string;
	eventId?: string;
	entryId?: string;
	startedAt?: string;
	source?: PiboTraceSource;
	stableKey?: string;
	orderKey?: PiboTraceOrderKey;
	notification: RunNotificationPayload;
}): PiboTraceNode {
	const runs = runNotificationRuns(input.notification);
	const singleRun = runs.length === 1 ? runs[0] : undefined;
	const failedCount = countRunGroup(input.notification.failed);
	const runningCount = countRunGroup(input.notification.running);
	return {
		id: input.id,
		entryId: input.entryId,
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		runId: typeof singleRun?.runId === "string" ? singleRun.runId : undefined,
		type: "yielded.run",
		title: "Run Notification",
		status: failedCount > 0 ? "error" : runningCount > 0 ? "running" : "done",
		startedAt: input.startedAt,
		summary: runNotificationSummary(input.notification),
		output: input.notification,
		source: input.source,
		stableKey: input.stableKey ?? input.id,
		orderKey: input.orderKey,
		children: [],
	};
}

function runNotificationRuns(notification: RunNotificationPayload): RunNotificationRun[] {
	return [
		...runGroup(notification.completed),
		...runGroup(notification.failed),
		...runGroup(notification.cancelled),
		...runGroup(notification.running),
	];
}

function runGroup(value: unknown): RunNotificationRun[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function countRunGroup(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function runNotificationSummary(notification: RunNotificationPayload): string {
	const parts = [
		[countRunGroup(notification.completed), "completed"],
		[countRunGroup(notification.failed), "failed"],
		[countRunGroup(notification.cancelled), "cancelled"],
		[countRunGroup(notification.running), "running"],
	]
		.filter(([count]) => Number(count) > 0)
		.map(([count, label]) => `${count} ${label}`);
	return parts.length ? parts.join(", ") : "No yielded run updates";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cryptoSafeId(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url").slice(0, 48);
}
