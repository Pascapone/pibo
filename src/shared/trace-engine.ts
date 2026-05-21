import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PiboOutputEvent } from "../core/events.js";
import {
	childTraceOrder,
	compareTraceOrder,
	eventTraceOrder,
	liveTraceOrder,
	transcriptTraceOrder,
	type TraceOrderKey,
} from "./trace-order.js";
import type {
	ChatWebStoredEvent,
	PiboSessionTraceView,
	PiboTraceNode,
	PiboTraceNodeStatus,
	PiboWebSessionStatus,
} from "./trace-types.js";

// ── existing utilities ───────────────────────────────────────────

export function sortTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	return [...nodes]
		.sort(compareTraceNodes)
		.map((node) => (node.children.length ? { ...node, children: sortTraceNodes(node.children) } : node));
}

export function compareTraceNodes(left: PiboTraceNode, right: PiboTraceNode): number {
	const byStartTime = compareOptionalIsoTime(left.startedAt, right.startedAt);
	if (byStartTime !== 0) return byStartTime;
	const byOrder = compareTraceOrder(left.orderKey, right.orderKey);
	if (byOrder !== 0) return byOrder;
	return left.id.localeCompare(right.id);
}

function compareOptionalIsoTime(left?: string, right?: string): number {
	if (!left && !right) return 0;
	if (!left) return 1;
	if (!right) return -1;
	return left.localeCompare(right);
}

export function flattenTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children)]);
}

export function nestTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
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
	return sortTraceNodes(roots);
}

export function mapTraceNodesById(nodes: PiboTraceNode[]): Map<string, PiboTraceNode> {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of flattenTraceNodes(nodes)) byId.set(node.id, node);
	return byId;
}

// ── buildTraceViewFromEvents ─────────────────────────────────────

type TraceBuildInput = {
	session: { id: string; piSessionId: string; title?: string | null };
	events: ChatWebStoredEvent[];
	transcriptEntries?: SessionEntry[];
	sessions?: Array<{
		id: string;
		parentId?: string | null;
		originId?: string | null;
		updatedAt: string;
		title?: string | null;
		metadata?: Record<string, unknown>;
	}>;
	status?: PiboWebSessionStatus;
	latestStreamId?: number;
	includeRawEvents?: boolean;
	rawEventsLimit?: number;
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

export function buildTraceViewFromEvents(input: TraceBuildInput): PiboSessionTraceView {
	const sessionStatus = input.status ?? "idle";
	const events = dedupeTraceEvents(input.events);
	const allEntries = input.transcriptEntries ?? [];
	const openTranscriptEventIds = findOpenTranscriptEventIds(events, sessionStatus);
	const entries = projectTranscriptEntries(allEntries, sessionStatus, openTranscriptEventIds);
	const nodes = traceNodesFromEntries(input.session.id, entries);
	const byId = mapTraceNodesById(nodes);
	const childByParent = mapChildren(input.sessions ?? []);
	const linkedChildByToolCallId = mapSubagentSessionLinks(events);
	const hasPersistedTranscript = entries.some((entry) => entry.type === "message");

	for (const storedEvent of events) {
		applySingleEventToNodes(
			nodes,
			byId,
			input.session.id,
			storedEvent,
			childByParent,
			linkedChildByToolCallId,
			hasPersistedTranscript,
			openTranscriptEventIds,
			sessionStatus,
		);
	}

	const nestedNodes = nestTraceNodes(nodes);
	reconcileAsyncAgentRunStatuses(nestedNodes);

	return {
		piboSessionId: input.session.id,
		piSessionId: input.session.piSessionId,
		title: input.session.title ?? "Untitled Session",
		version: "",
		latestStreamId: latestTraceStreamId(events, input.latestStreamId),
		nodes: nestedNodes,
		rawEvents:
			input.includeRawEvents === true
				? events.slice(-(input.rawEventsLimit ?? events.length))
				: [],
	};
}

// ── transcript helpers ───────────────────────────────────────────

function applySingleEventToNodes(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	piboSessionId: string,
	storedEvent: ChatWebStoredEvent,
	childByParent: Map<string, Array<{ id: string; metadata?: Record<string, unknown> }>>,
	linkedChildByToolCallId: Map<string, string>,
	hasPersistedTranscript: boolean,
	openTranscriptEventIds: ReadonlySet<string>,
	sessionStatus: PiboWebSessionStatus,
): void {
	const payload = storedEvent.payload as PiboOutputEvent;
	if (
		hasPersistedTranscript &&
		isTranscriptEchoEvent(payload) &&
		!shouldKeepTranscriptEchoEvent(payload, openTranscriptEventIds)
	) {
		return;
	}
	if (hasPersistedTranscript && isStaleToolCallEchoEvent(payload, sessionStatus)) {
		return;
	}
	if (payload.type === "assistant_delta") {
		mergeAssistantDeltaEvent(
			nodes,
			byId,
			payload,
			sessionStatus,
			storedEvent.createdAt,
			storedEvent.eventSequence,
			storedEvent.streamId,
			storedEvent.streamFrameIndex,
		);
		return;
	}
	if (payload.type === "thinking_delta") {
		mergeThinkingDeltaEvent(
			nodes,
			byId,
			payload,
			sessionStatus,
			storedEvent.createdAt,
			storedEvent.eventSequence,
			storedEvent.streamId,
			storedEvent.streamFrameIndex,
		);
		return;
	}
	const node = traceNodeFromEvent(
		piboSessionId,
		payload,
		childByParent,
		linkedChildByToolCallId,
		sessionStatus,
		storedEvent.createdAt,
		storedEvent.eventSequence,
		storedEvent.streamId,
		storedEvent.streamFrameIndex,
	);
	if (!node) return;
	if (node.type === "agent.turn" && node.eventId) {
		const existingTurn = [...byId.values()].find(
			(candidate) => candidate.type === "agent.turn" && candidate.eventId === node.eventId,
		);
		if (existingTurn) {
			existingTurn.status = node.status;
			existingTurn.completedAt = node.completedAt ?? existingTurn.completedAt;
			return;
		}
	}
	if (node.type === "assistant.message") {
		const existing = byId.get(node.id);
		if (existing) {
			mergeAssistantMessageEvent(existing, node);
			closeParentTurnForFinalAssistant(byId, existing);
			return;
		}
		closeParentTurnForFinalAssistant(byId, node);
	}
	if (node.type === "execution.compaction") {
		const existing = findLatestCompactionNode(nodes);
		if (existing) {
			mergeCompactionEvent(existing, node);
			return;
		}
	}
	if (node.type === "model.reasoning") {
		const existing = byId.get(node.id);
		if (existing) {
			mergeReasoningEvent(existing, node);
			return;
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
				attachAsyncAgentRunNode(existing, piboSessionId, storedEvent.createdAt, node);
				return;
			}
			mergeToolEvent(existing, node);
			attachAsyncAgentRunNode(existing, piboSessionId, storedEvent.createdAt);
			return;
		}
	}
	if (node.eventId && byId.has(node.id)) return;
	attachExecutionCommandToOpenTurn(node, byId);
	attachAsyncAgentRunNode(node, piboSessionId, storedEvent.createdAt);
	nodes.push(node);
	for (const indexed of flattenTraceNodes([node])) byId.set(indexed.id, indexed);
}

function attachExecutionCommandToOpenTurn(
	node: PiboTraceNode,
	byId: Map<string, PiboTraceNode>,
): void {
	if (node.type !== "execution.command") return;
	if (node.parentId && byId.has(node.parentId)) return;

	const turn = [...byId.values()]
		.filter((candidate) => {
			if (candidate.type !== "agent.turn") return false;
			if (!candidate.startedAt || !node.startedAt) return false;
			if (candidate.startedAt > node.startedAt) return false;
			const closedAt = turnClosedAt(candidate, byId);
			return closedAt === undefined || node.startedAt <= closedAt;
		})
		.sort(compareTraceNodes)
		.at(-1);
	if (!turn) return;
	node.parentId = turn.id;
}

function turnClosedAt(turn: PiboTraceNode, byId: Map<string, PiboTraceNode>): string | undefined {
	if (turn.completedAt) return turn.completedAt;
	const error = [...byId.values()]
		.filter((candidate) =>
			candidate.type === "error" &&
			candidate.eventId !== undefined &&
			candidate.eventId === turn.eventId &&
			candidate.startedAt !== undefined
		)
		.sort(compareTraceNodes)
		.at(0);
	return error?.startedAt;
}

export function patchTraceViewWithEvent(
	view: PiboSessionTraceView,
	event: ChatWebStoredEvent,
	sessionStatus: PiboWebSessionStatus,
): PiboSessionTraceView {
	if (view.rawEvents.some((re) => traceEventDedupeKey(re) === traceEventDedupeKey(event))) {
		return view;
	}

	const allNodes = flattenTraceNodes(view.nodes).map((node) => ({ ...node, children: [] }));
	const byId = mapTraceNodesById(allNodes);

	applySingleEventToNodes(
		allNodes,
		byId,
		view.piboSessionId,
		event,
		new Map(),
		new Map(),
		false,
		new Set(),
		sessionStatus,
	);

	const nestedNodes = nestTraceNodes(allNodes);
	reconcileAsyncAgentRunStatuses(nestedNodes);
	const sharedNodes = shareUnchangedTraceNodes(view.nodes, nestedNodes);

	return {
		...view,
		rawEvents: [...view.rawEvents, event],
		nodes: sharedNodes,
		latestStreamId: latestTraceStreamId([event], view.latestStreamId),
	};
}

function shareUnchangedTraceNodes(
	previousNodes: readonly PiboTraceNode[],
	nextNodes: readonly PiboTraceNode[],
): PiboTraceNode[] {
	const previousById = mapTraceNodesById(previousNodes as PiboTraceNode[]);
	return nextNodes.map((node) => shareUnchangedTraceNode(previousById, node));
}

function shareUnchangedTraceNode(
	previousById: ReadonlyMap<string, PiboTraceNode>,
	nextNode: PiboTraceNode,
): PiboTraceNode {
	const previousNode = previousById.get(nextNode.id);
	const sharedChildren = nextNode.children.map((child) => shareUnchangedTraceNode(previousById, child));
	const childrenUnchanged =
		previousNode !== undefined &&
		previousNode.children.length === sharedChildren.length &&
		previousNode.children.every((child, index) => child === sharedChildren[index]);

	if (previousNode && childrenUnchanged && traceNodeShallowEqual(previousNode, nextNode)) {
		return previousNode;
	}

	return childrenUnchanged ? { ...nextNode, children: previousNode?.children ?? sharedChildren } : { ...nextNode, children: sharedChildren };
}

function traceNodeShallowEqual(left: PiboTraceNode, right: PiboTraceNode): boolean {
	return (
		left.id === right.id &&
		left.parentId === right.parentId &&
		left.entryId === right.entryId &&
		left.piboSessionId === right.piboSessionId &&
		left.eventId === right.eventId &&
		left.toolCallId === right.toolCallId &&
		left.runId === right.runId &&
		left.type === right.type &&
		left.title === right.title &&
		left.status === right.status &&
		left.startedAt === right.startedAt &&
		left.completedAt === right.completedAt &&
		left.durationMs === right.durationMs &&
		left.summary === right.summary &&
		left.input === right.input &&
		left.output === right.output &&
		left.error === right.error &&
		left.linkedPiboSessionId === right.linkedPiboSessionId &&
		left.source === right.source &&
		left.stableKey === right.stableKey &&
		traceOrderKeyEqual(left.orderKey, right.orderKey)
	);
}

function traceOrderKeyEqual(left: PiboTraceNode["orderKey"], right: PiboTraceNode["orderKey"]): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return JSON.stringify(left) === JSON.stringify(right);
}

export function dedupeTraceEvents<T extends ChatWebStoredEvent>(events: readonly T[]): T[] {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const event of events) {
		const key = traceEventDedupeKey(event);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(event);
	}
	return deduped;
}

export function traceEventDedupeKey(event: ChatWebStoredEvent): string {
	if (event.streamId !== undefined) {
		const payload = event.payload as PiboOutputEvent;
		if (event.streamFrameIndex !== undefined) {
			return `stream:${event.streamId}:${event.streamFrameIndex}:${payload.type}`;
		}
		return `stream:${event.streamId}:${payload.type}`;
	}
	if (event.eventSequence !== undefined) return `sequence:${event.piboSessionId ?? ""}:${event.eventSequence}`;
	return `id:${event.id}`;
}

export function latestTraceStreamId(
	events: readonly ChatWebStoredEvent[],
	initial?: number,
): number | undefined {
	let latest = initial;
	for (const event of events) {
		if (event.streamId === undefined) continue;
		latest = latest === undefined ? event.streamId : Math.max(latest, event.streamId);
	}
	return latest;
}

function projectTranscriptEntries(
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

// ── event → node helpers ─────────────────────────────────────────

function traceNodeFromEvent(
	piboSessionId: string,
	event: PiboOutputEvent,
	childByParent: Map<string, Array<{ id: string; metadata?: Record<string, unknown> }>>,
	linkedChildByToolCallId: Map<string, string>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
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
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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
					orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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
				status:
					event.type === "message_finished" || sessionStatus !== "running" ? "done" : "running",
				completedAt: event.type === "message_finished" ? createdAt : undefined,
				stableKey: eventId ? `turn:${eventId}` : base.stableKey,
			};
		case "thinking_finished": {
			if (!hasVisibleText(event.text)) return undefined;
			const thinkingId = thinkingEventNodeId(event);
			return {
				...base,
				id: thinkingId ? thinkingNodeId(thinkingId) : id,
				parentId: turnParentId,
				type: "model.reasoning",
				title: "Thinking",
				status: "done",
				summary: event.text,
				output: event.text,
				stableKey: thinkingId ? `reasoning:${thinkingId}` : base.stableKey,
			};
		}
		case "assistant_message": {
			const assistantId = assistantEventNodeId(event);
			return {
				...base,
				id: assistantId ? assistantMessageNodeId(assistantId) : id,
				parentId: turnParentId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				summary: event.text,
				output: event.text,
				stableKey: assistantId ? `assistant:${assistantId}` : base.stableKey,
			};
		}
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished": {
			const subagentTool = isSubagentToolName(event.toolName);
			const linkedPiboSessionId =
				linkedChildByToolCallId.get(event.toolCallId) ??
				(subagentTool
					? findLikelyChildSession(piboSessionId, event.toolName, event, childByParent)
					: undefined);
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
					event.type === "tool_execution_finished" && event.isError
						? stringifyPreview(event.result)
						: undefined,
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
		case "compaction_start":
			return {
				...base,
				id: `event:compaction:${eventSequence ?? streamId ?? cryptoSafeId(event)}`,
				type: "execution.compaction",
				title: "compact",
				status: "running",
				summary: "Compacting",
				input: { reason: event.reason },
				stableKey: "compaction:active",
			};
		case "compaction_end":
			return {
				...base,
				id: `event:compaction:end:${eventSequence ?? streamId ?? cryptoSafeId(event)}`,
				type: "execution.compaction",
				title: "compact",
				status: event.errorMessage ? "error" : "done",
				completedAt: createdAt,
				summary: event.aborted ? "Compaction skipped" : event.errorMessage ? "Compaction failed" : "Compacted",
				input: { reason: event.reason },
				output: event.result,
				error: event.errorMessage,
				stableKey: "compaction:active",
			};
		case "session_error":
			return {
				...base,
				type: "error",
				title: "Session Error",
				status: "error",
				summary: event.errorDetails?.userMessage,
				input: event.errorDetails,
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
	streamId?: number,
	streamFrameIndex?: number,
): void {
	if (event.text.length === 0) return;

	const assistantId = assistantEventNodeId(event);
	const id = assistantId ? assistantMessageNodeId(assistantId) : `event:assistant_delta:${cryptoSafeId(event)}`;
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
		stableKey: assistantId ? `assistant:${assistantId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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
	streamId?: number,
	streamFrameIndex?: number,
): void {
	if (event.text.length === 0) return;

	const thinkingId = thinkingEventNodeId(event);
	const id = thinkingId ? thinkingNodeId(thinkingId) : `event:thinking_delta:${cryptoSafeId(event)}`;
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
		stableKey: thinkingId ? `reasoning:${thinkingId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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

function shouldKeepTranscriptEchoEvent(
	event: PiboOutputEvent,
	openTranscriptEventIds: ReadonlySet<string>,
): boolean {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	return Boolean(eventId && openTranscriptEventIds.has(eventId));
}

function isStaleToolCallEchoEvent(event: PiboOutputEvent, sessionStatus: PiboWebSessionStatus): boolean {
	return sessionStatus !== "running" && event.type === "tool_call";
}

function findOpenTranscriptEventIds(
	events: ChatWebStoredEvent[],
	sessionStatus: PiboWebSessionStatus,
): Set<string> {
	if (sessionStatus !== "running") return new Set();

	const open = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
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

function eventTraceNodeOrder(
	eventSequence: number | undefined,
	type: PiboOutputEvent["type"],
	streamId?: number,
	streamFrameIndex?: number,
): TraceOrderKey {
	if (eventSequence === undefined && (streamId !== undefined || streamFrameIndex !== undefined)) {
		return liveTraceOrder(streamId, streamFrameIndex, eventNodeKind(type));
	}
	return eventTraceOrder(eventSequence, eventNodeKind(type));
}

function eventNodeKind(type: PiboOutputEvent["type"]): PiboTraceNode["type"] {
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
		case "compaction_start":
		case "compaction_end":
			return "execution.compaction";
		case "session_error":
			return "error";
		default:
			return "execution.command";
	}
}

function eventStableKey(event: PiboOutputEvent): string {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	if (
		event.type === "tool_call" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated" ||
		event.type === "tool_execution_finished"
	) {
		return `tool:${event.toolCallId}`;
	}
	if (event.type === "subagent_session" && event.toolCallId) return `tool:${event.toolCallId}`;
	if (eventId && (event.type === "message_started" || event.type === "message_finished"))
		return `turn:${eventId}`;
	if (
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	) {
		const thinkingId = thinkingEventNodeId(event);
		if (thinkingId) return `reasoning:${thinkingId}`;
	}
	if (event.type === "assistant_delta" || event.type === "assistant_message") {
		const assistantId = assistantEventNodeId(event);
		if (assistantId) return `assistant:${assistantId}`;
	}
	return `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
}

export function messageTurnNodeId(eventId: string): string {
	return `event:message:${eventId}`;
}

export function assistantMessageNodeId(eventId: string): string {
	return `event:assistant:${eventId}`;
}

function assistantEventNodeId(
	event: Extract<PiboOutputEvent, { type: "assistant_delta" | "assistant_message" }>,
): string | undefined {
	if (!event.eventId) return undefined;
	const partIndex = typeof event.assistantIndex === "number" ? event.assistantIndex : event.contentIndex;
	return typeof partIndex === "number" ? `${event.eventId}:assistant:${partIndex}` : event.eventId;
}

export function thinkingNodeId(eventId: string): string {
	return `event:thinking:${eventId}`;
}

function thinkingEventNodeId(
	event: Extract<PiboOutputEvent, { type: "thinking_started" | "thinking_delta" | "thinking_finished" }>,
): string | undefined {
	if (!event.eventId) return undefined;
	const partIndex = typeof event.thinkingIndex === "number" ? event.thinkingIndex : event.contentIndex;
	return typeof partIndex === "number" ? `${event.eventId}:thinking:${partIndex}` : event.eventId;
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

function findLatestCompactionNode(nodes: readonly PiboTraceNode[]): PiboTraceNode | undefined {
	return flattenTraceNodes([...nodes]).reverse().find((node) => node.type === "execution.compaction" && node.status === "running");
}

function mergeCompactionEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
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

export function isRunStartToolNode(node: PiboTraceNode): boolean {
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

function mapChildren(
	sessions: Array<{ id: string; parentId?: string | null }>,
): Map<string, Array<{ id: string; metadata?: Record<string, unknown> }>> {
	const result = new Map<string, Array<{ id: string; metadata?: Record<string, unknown> }>>();
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
		const event = storedEvent.payload as PiboOutputEvent;
		if (event.type !== "subagent_session" || !event.toolCallId) continue;
		result.set(event.toolCallId, event.childPiboSessionId);
	}
	return result;
}

function findLikelyChildSession(
	piboSessionId: string,
	toolName: string,
	event: Extract<
		PiboOutputEvent,
		{
			type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished";
		}
	>,
	childByParent: Map<string, Array<{ id: string; metadata?: Record<string, unknown> }>>,
): string | undefined {
	if (!isSubagentToolName(toolName)) return undefined;
	const candidates =
		childByParent
			.get(piboSessionId)
			?.filter((session) => session.metadata?.subagentToolName === toolName) ?? [];
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
	event: Extract<
		PiboOutputEvent,
		{
			type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished";
		}
	>,
): string | undefined {
	const args =
		"args" in event && event.args && typeof event.args === "object" && !Array.isArray(event.args)
			? event.args
			: undefined;
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

function parseRunNotificationText(text: string | undefined): RunNotificationPayload | undefined {
	// Legacy history support only: live yielded-run state is projected from Session Signals.
	const trimmed = (text ?? "").trim();
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
	source?: PiboTraceNode["source"];
	stableKey?: string;
	orderKey?: TraceOrderKey;
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
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value))).slice(0, 48);
}

function base64UrlEncode(bytes: Uint8Array): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let output = "";
	let index = 0;
	for (; index + 2 < bytes.length; index += 3) {
		const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
		output += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63] + alphabet[(value >> 6) & 63] + alphabet[value & 63];
	}
	if (index < bytes.length) {
		const first = bytes[index];
		const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
		const value = (first << 16) | (second << 8);
		output += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63];
		if (index + 1 < bytes.length) output += alphabet[(value >> 6) & 63];
	}
	return output;
}
