import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type {
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryReconciliationProof,
} from "../../agent-runtime/history.js";
import {
	PI_HISTORY_PAGE_MAX_BYTES,
	PI_HISTORY_SCAN_MAX_BYTES,
	PI_HISTORY_TAIL_MAX_BYTES,
	listPiHistorySessions,
	loadPiHistoryFastMetadata,
	loadPiHistoryMetadata,
	piSessionEntriesToAgentRuntimeHistoryEntries,
	readPiTranscriptHistoryPage,
	readPiTranscriptTailEntries,
	type PiHistoryMetadata,
	type PiTranscriptHistoryPage,
} from "../../agent-runtimes/pi/history.js";
import type { ModelProfile } from "../../core/profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import type { PiboSession } from "../../sessions/store.js";
import { isBuiltInHistoryReconciliationProof } from "../../agent-runtimes/history-proof.js";
import { buildTraceViewFromEvents, traceNodesFromHistoryEntries } from "../../shared/trace-engine.js";
import type { TraceMessageTurnTiming } from "../../shared/trace-event-projection.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../../shared/trace-types.js";
import type { ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "./read-model.js";
import { isChatWebSessionArchived } from "./session-metadata.js";
import { workflowSessionKindFromMetadata, type PiboWorkflowSessionKind } from "../../sessions/workflow-session-kind.js";

export type PiboWebSessionStatus = "idle" | "running" | "error";

export const TRACE_PROJECTION_VERSION = "runtime-history-v2-incomplete-status";

export type PiboWebDerivedSessionNode = {
	piboSessionId: string;
	profile: string;
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	runtimeBindingState?: "unbound" | "bound" | "missing" | "error";
	activeModel?: ModelProfile;
	subagentName?: string;
	workflowSessionKind?: PiboWorkflowSessionKind;
	title: string;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
};

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	runtimeBindingState?: "unbound" | "bound" | "missing" | "error";
	nativeSessionId?: string;
	parentId?: string;
	originId?: string;
	profile: string;
	activeModel?: ModelProfile;
	initialThinkingLevel?: PiboThinkingLevel;
	subagentName?: string;
	workflowSessionKind?: PiboWorkflowSessionKind;
	title: string;
	subtitle?: string;
	archived?: boolean;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
	unreadCount?: number;
	derivedSessions: PiboWebDerivedSessionNode[];
	children: PiboWebSessionNode[];
};

export type {
	PiboTraceNode,
	PiboTraceNodeType,
	PiboTraceNodeStatus,
	PiboTraceSource,
	PiboTraceOrderKey,
	PiboSessionTraceView,
} from "../../shared/trace-types.js";

export {
	compareTraceNodes,
	sortTraceNodes,
	nestTraceNodes,
	flattenTraceNodes,
	mapTraceNodesById,
	buildTraceViewFromEvents,
	traceNodesFromHistoryEntries,
} from "../../shared/trace-engine.js";

export type PiboHistoryMetadata = {
	title?: string;
	firstMessage?: string;
	createdAt?: string;
	updatedAt?: string;
	sizeBytes?: number;
	version?: string;
	locator?: AgentRuntimeHistoryInspection["locator"];
};

type TraceBuildInput = {
	session: PiboSession;
	sessions: PiboSession[];
	events: ChatWebStoredPiboEvent[];
	status?: PiboWebSessionStatus;
	cwd?: string;
	historyEntries?: readonly AgentRuntimeHistoryEntry[];
	historyReconciliationProof?: AgentRuntimeHistoryReconciliationProof;
	historyInspection?: AgentRuntimeHistoryInspection;
	historyOrderOffset?: number;
	/** @deprecated Pi compatibility input. Use historyEntries. */
	transcriptEntries?: readonly SessionEntry[];
	/** @deprecated Pi compatibility input. Use historyInspection. */
	metadata?: PiHistoryMetadata;
	/** @deprecated Pi compatibility input. Use historyOrderOffset. */
	transcriptOrderOffset?: number;
	turnTimings?: TraceMessageTurnTiming[];
	includeRawEvents?: boolean;
	rawEventsLimit?: number;
	latestStreamId?: number;
};

export const TRACE_TRANSCRIPT_TAIL_MAX_BYTES = PI_HISTORY_TAIL_MAX_BYTES;
export const TRACE_TRANSCRIPT_HISTORY_PAGE_MAX_BYTES = PI_HISTORY_PAGE_MAX_BYTES;
export const TRACE_TRANSCRIPT_HISTORY_SCAN_MAX_BYTES = PI_HISTORY_SCAN_MAX_BYTES;

export type TranscriptHistoryPage = PiTranscriptHistoryPage;

export async function buildSessionNodes(
	sessions: PiboSession[],
	indexItems: ChatWebSessionIndexItem[],
	_cwd = process.cwd(),
	unreadCounts: ReadonlyMap<string, number> = new Map(),
	options: {
		skipPiMetadataFallback?: boolean;
		loadHistoryInspection?: (session: PiboSession) => Promise<AgentRuntimeHistoryInspection | undefined>;
	} = {},
): Promise<PiboWebSessionNode[]> {
	const indexByKey = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	const nodes = new Map<string, PiboWebSessionNode>();

	for (const session of sessions) {
		const inspection = !session.title && !options.skipPiMetadataFallback && options.loadHistoryInspection
			? await options.loadHistoryInspection(session)
			: undefined;
		const indexed = indexByKey.get(session.id);
		nodes.set(session.id, {
			piboSessionId: session.id,
			piSessionId: session.piSessionId,
			runtimeInstanceId: session.runtimeBinding?.runtimeInstanceId ?? indexed?.runtimeInstanceId,
			runtimeAdapterId: session.runtimeBinding?.adapterId ?? indexed?.runtimeAdapterId,
			runtimeBindingState: session.runtimeBinding?.state ?? indexed?.runtimeBindingState,
			nativeSessionId: session.runtimeBinding?.nativeSessionId ?? indexed?.nativeSessionId,
			parentId: session.parentId,
			originId: session.originId,
			profile: session.profile,
			activeModel: session.activeModel,
			initialThinkingLevel: thinkingLevelValue(session.metadata?.initialThinkingLevel),
			subagentName: stringValue(session.metadata?.subagentName),
			workflowSessionKind: workflowSessionKindFromMetadata(session.metadata),
			title: createSessionTitle(session, historyMetadataFromInspection(inspection)),
			subtitle: session.id,
			archived: isChatWebSessionArchived(session),
			status: sessionNodeStatus(indexed?.status),
			lastActivityAt: indexed?.lastActivityAt ?? indexed?.createdAt ?? session.createdAt,
			unreadCount: unreadCounts.get(session.id) || undefined,
			derivedSessions: [],
			children: [],
		});
	}

	const roots: PiboWebSessionNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentId ? nodes.get(node.parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}

	for (const node of nodes.values()) {
		if (!node.originId) continue;
		const origin = nodes.get(node.originId);
		if (!origin) continue;
		origin.derivedSessions.push({
			piboSessionId: node.piboSessionId,
			profile: node.profile,
			runtimeInstanceId: node.runtimeInstanceId,
			runtimeAdapterId: node.runtimeAdapterId,
			runtimeBindingState: node.runtimeBindingState,
			subagentName: node.subagentName,
			workflowSessionKind: node.workflowSessionKind,
			title: node.title,
			status: node.status,
			lastActivityAt: node.lastActivityAt,
		});
	}

	const sortNodes = (items: PiboWebSessionNode[]): void => {
		items.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
		for (const item of items) {
			item.derivedSessions.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
			sortNodes(item.children);
		}
	};
	sortNodes(roots);
	return roots;
}

function sessionNodeStatus(indexedStatus: PiboWebSessionStatus | undefined): PiboWebSessionStatus {
	return indexedStatus ?? "idle";
}

export async function buildTraceView(input: TraceBuildInput): Promise<PiboSessionTraceView> {
	const historyMetadata = input.historyInspection
		? historyMetadataFromInspection(input.historyInspection)
		: historyMetadataFromPiCompatibility(input.metadata);
	const entries = [...(input.historyEntries ?? (input.transcriptEntries
		? piSessionEntriesToAgentRuntimeHistoryEntries(input.transcriptEntries)
		: []))];
	const sessionStatus = input.status ?? "idle";
	const view = buildTraceViewFromEvents({
		session: {
			id: input.session.id,
			piSessionId: input.session.piSessionId,
			title: createSessionTitle(input.session, historyMetadata),
		},
		events: input.events as unknown as import("../../shared/trace-types.js").ChatWebStoredEvent[],
		turnTimings: input.turnTimings,
		historyEntries: entries,
		historyReconciliationProof: input.historyReconciliationProof,
		historyReconciliationAuthoritative: isBuiltInHistoryReconciliationProof(input.historyReconciliationProof),
		sessions: input.sessions.map((session) => ({
			id: session.id,
			parentId: session.parentId ?? null,
			originId: session.originId ?? null,
			updatedAt: session.updatedAt,
			title: session.title ?? null,
			metadata: session.metadata,
		})),
		status: sessionStatus,
		latestStreamId: input.latestStreamId,
		includeRawEvents: input.includeRawEvents,
		rawEventsLimit: input.rawEventsLimit,
	});
	const historyOrderOffset = input.historyOrderOffset ?? input.transcriptOrderOffset;
	if (historyOrderOffset && historyOrderOffset > 0) offsetHistoryTraceOrder(view.nodes, historyOrderOffset);
	annotateForkableUserMessageNodes(view.nodes, entries);
	return {
		...view,
		runtimeBinding: traceRuntimeBinding(input.session),
		version: createTraceViewVersion({
			session: input.session,
			sessions: input.sessions,
			events: input.events,
			status: sessionStatus,
			history: historyMetadata,
			latestStreamId: input.latestStreamId,
		}),
	};
}

export function createTraceViewVersion(input: {
	session: PiboSession;
	sessions: PiboSession[];
	events: Pick<ChatWebStoredPiboEvent, "id" | "eventSequence" | "createdAt">[];
	status?: PiboWebSessionStatus;
	history?: PiboHistoryMetadata;
	/** @deprecated Pi compatibility input. Use history. */
	metadata?: PiHistoryMetadata;
	latestStreamId?: number;
}): string {
	const history = input.history ?? historyMetadataFromPiCompatibility(input.metadata);
	const relevantSessions = input.sessions.map((session) => ({
		id: session.id,
		parentId: session.parentId ?? null,
		originId: session.originId ?? null,
		updatedAt: session.updatedAt,
		title: session.title ?? null,
	})).sort((left, right) => left.id.localeCompare(right.id));
	const eventTail = input.events.at(-1);
	return createHash("sha1").update(JSON.stringify({
		traceProjection: TRACE_PROJECTION_VERSION,
		session: {
			id: input.session.id,
			piSessionId: input.session.piSessionId,
			profile: input.session.profile,
			title: input.session.title ?? null,
			updatedAt: input.session.updatedAt,
			runtimeBinding: traceRuntimeBinding(input.session),
		},
		history: {
			version: history.version ?? null,
			sizeBytes: history.sizeBytes ?? null,
			updatedAt: history.updatedAt ?? null,
			title: history.title ?? null,
			firstMessage: history.firstMessage ?? null,
		},
		status: input.status ?? "idle",
		events: {
			lastSequence: eventTail?.eventSequence ?? null,
			lastCreatedAt: eventTail?.createdAt ?? null,
			latestStreamId: input.latestStreamId ?? null,
		},
		sessions: relevantSessions,
	})).digest("hex");
}

function traceRuntimeBinding(session: PiboSession): PiboSessionTraceView["runtimeBinding"] {
	const binding = session.runtimeBinding;
	return binding ? {
		runtimeInstanceId: binding.runtimeInstanceId,
		adapterId: binding.adapterId,
		nativeSessionId: binding.nativeSessionId,
		state: binding.state,
		protocol: binding.protocol,
		protocolVersion: binding.protocolVersion,
		adapterVersion: binding.adapterVersion,
		revision: binding.revision,
	} : undefined;
}

function historyMetadataFromPiCompatibility(metadata: PiHistoryMetadata | undefined): PiboHistoryMetadata {
	if (!metadata) return {};
	return {
		title: metadata.name,
		firstMessage: metadata.firstMessage,
		createdAt: metadata.created,
		updatedAt: metadata.modified,
		sizeBytes: metadata.sessionSize,
		version: metadata.sessionPath ? createHash("sha1").update(JSON.stringify({
			path: metadata.sessionPath,
			size: metadata.sessionSize ?? null,
			mtime: metadata.sessionMtimeMs ?? null,
		})).digest("hex") : undefined,
		locator: metadata.sessionPath ? { kind: "local-file", value: metadata.sessionPath } : undefined,
	};
}

function historyMetadataFromInspection(inspection: AgentRuntimeHistoryInspection | undefined): PiboHistoryMetadata {
	if (!inspection) return {};
	return {
		title: inspection.title,
		firstMessage: inspection.firstMessage,
		createdAt: inspection.createdAt,
		updatedAt: inspection.updatedAt,
		sizeBytes: inspection.sizeBytes,
		version: inspection.version,
		locator: inspection.locator,
	};
}

function createSessionTitle(session: PiboSession, metadata: PiboHistoryMetadata): string {
	return truncateTitle(session.title || metadata.title || metadata.firstMessage || session.id);
}

function truncateTitle(title: string, maxLength = 56): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized || "Untitled Session";
	return `${normalized.slice(0, maxLength - 1)}…`;
}

function offsetHistoryTraceOrder(nodes: PiboTraceNode[], offset: number): void {
	for (const node of nodes) {
		if ((node.source === "transcript" || node.source === "product-history") && node.orderKey) {
			const transcriptIndex = node.orderKey.transcriptIndex;
			node.orderKey = {
				...node.orderKey,
				turnSeq: node.orderKey.turnSeq + offset,
				transcriptIndex: transcriptIndex === undefined ? undefined : transcriptIndex + offset,
			};
		}
		offsetHistoryTraceOrder(node.children, offset);
	}
}

function annotateForkableUserMessageNodes(nodes: PiboTraceNode[], entries: readonly AgentRuntimeHistoryEntry[]): void {
	const candidates = entries.flatMap((entry) => entry.type === "message" && entry.role === "user" && entry.nativeEntryId
		? [{ entryId: entry.nativeEntryId, text: historyMessageText(entry) }]
		: []);
	if (!candidates.length) return;
	const used = new Set<string>();
	for (const node of flattenTraceNodesForForkAnnotation(nodes)) {
		if (node.type !== "user.message" || node.entryId) continue;
		const text = stringValue(node.output) ?? stringValue(node.summary) ?? "";
		const candidate = candidates.find((item) => !used.has(item.entryId) && item.text === text);
		if (!candidate) continue;
		node.entryId = candidate.entryId;
		used.add(candidate.entryId);
	}
}

function flattenTraceNodesForForkAnnotation(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const visit = (items: PiboTraceNode[]): void => {
		for (const item of items) {
			flattened.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return flattened;
}

function historyMessageText(entry: Extract<AgentRuntimeHistoryEntry, { type: "message" }>): string {
	if (typeof entry.content === "string") return entry.content;
	return entry.content.map((part) => part.type === "text" ? part.text : "").join("");
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function thinkingLevelValue(value: unknown): PiboThinkingLevel | undefined {
	return typeof value === "string" && isPiboThinkingLevel(value) ? value : undefined;
}

// Pi compatibility exports. Normal Chat Web history resolves through the selected runtime adapter.
export async function loadPiSessionMetadata(session: PiboSession, cwd = process.cwd()): Promise<PiHistoryMetadata> {
	return await loadPiHistoryMetadata(session.runtimeBinding?.nativeSessionId ?? session.piSessionId, cwd);
}

export async function loadPiSessionFastMetadata(session: PiboSession, cwd = process.cwd()): Promise<PiHistoryMetadata> {
	return loadPiHistoryFastMetadata(session.runtimeBinding?.nativeSessionId ?? session.piSessionId, cwd);
}

export async function loadPiSessionTailEntries(
	session: PiboSession,
	cwd = process.cwd(),
	maxBytes = TRACE_TRANSCRIPT_TAIL_MAX_BYTES,
): Promise<{ metadata: PiHistoryMetadata; entries: SessionEntry[] }> {
	const metadata = await loadPiSessionMetadata(session, cwd);
	if (!metadata.sessionPath) return { metadata, entries: [] };
	return { metadata, entries: readPiTranscriptTailEntries(metadata.sessionPath, maxBytes) };
}

export const listPiSessions = listPiHistorySessions;
export const readTailEntries = readPiTranscriptTailEntries;
export const readTranscriptHistoryPage = readPiTranscriptHistoryPage;

/** @deprecated Pi compatibility helper. Use traceNodesFromHistoryEntries. */
export function traceNodesFromEntries(
	piboSessionId: string,
	entries: readonly SessionEntry[],
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): PiboTraceNode[] {
	return traceNodesFromHistoryEntries(piboSessionId, piSessionEntriesToAgentRuntimeHistoryEntries(entries), turnTimings);
}
