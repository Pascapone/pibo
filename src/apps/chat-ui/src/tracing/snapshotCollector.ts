import type { ChatWebStoredEvent, PiboSessionTraceView, PiboTraceNode, PiboWebSessionStatus } from "../types";
import type { Span } from "../types";

export type TraceSnapshotNodeMeta = {
	id: string;
	type: string;
	status: string;
	parentId?: string;
	childIds: string[];
	entryId?: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	stableKey?: string;
	source?: string;
	orderKey?: PiboTraceNode["orderKey"];
	contentLength: number;
	contentKind: "message" | "pibo-run-notification" | "pibo-goal-continuation" | "pibo-system";
};

export type TraceSnapshotEventMeta = {
	id: string;
	type: string;
	eventId?: string;
	eventSequence?: number;
	streamId?: number;
	streamFrameIndex?: number;
};

export type TraceSnapshotTerminalRowMeta = {
	id: string;
	kind: string;
	status: string;
	sourceNodeIds: string[];
	eventId?: string;
	runId?: string;
	orderSource?: string;
	orderStreamId?: number;
	orderStreamFrameIndex?: number;
};

export type TraceSnapshotLayer =
	| { kind: "baseNodes" | "currentNodes" | "backendNodes"; ids: string[]; digest: string; meta: TraceSnapshotNodeMeta[] }
	| { kind: "overlayEvents"; ids: string[]; digest: string; meta: TraceSnapshotEventMeta[] }
	| { kind: "terminalRows"; ids: string[]; digest: string; meta: TraceSnapshotTerminalRowMeta[] }
	| { kind: "adaptedSpans"; ids: string[]; digest: string; meta: Array<{ id: string; spanType: string; startTime: number }> }
	| { kind: "processedTree"; ids: string[]; digest: string; meta: Array<{ id: string; spanType: string; depth: number }> }
	| { kind: "visibleRows"; ids: string[]; digest: string; meta: Array<{ id: string; depth: number; spanType: string; status: string; source?: string; stableKey?: string; orderKey?: PiboTraceNode["orderKey"] }> };

export type TraceSnapshot = {
	sequence: number;
	timestamp: number;
	piboSessionId: string;
	trigger: string;
	layers: TraceSnapshotLayer[];
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>;
	traceVersion?: string;
	baseTraceVersion?: string;
	latestStreamId?: number;
	lastRawEventId?: string;
	selectedSessionStatus?: PiboWebSessionStatus;
	overlayEventCount?: number;
};

type SessionSnapshotBuffer = {
	snapshots: TraceSnapshot[];
	pending: Partial<TraceSnapshot> | null;
	pendingTimer: ReturnType<typeof setTimeout> | null;
};

type TerminalRowLike = {
	id: string;
	kind: string;
	status: string;
	sourceNodeIds: string[];
	eventId?: string;
	runId?: string;
	orderSource?: string;
	orderStreamId?: number;
	orderStreamFrameIndex?: number;
};

const MAX_SNAPSHOTS_PER_SESSION = 5_000;
const PENDING_MERGE_MS = 0;
const buffers = new Map<string, SessionSnapshotBuffer>();
let snapshotSequence = 0;

function getBuffer(piboSessionId: string): SessionSnapshotBuffer {
	let buffer = buffers.get(piboSessionId);
	if (!buffer) {
		buffer = { snapshots: [], pending: null, pendingTimer: null };
		buffers.set(piboSessionId, buffer);
	}
	return buffer;
}

export function isTraceSnapshotCollectionEnabled(): boolean {
	if (typeof window !== "undefined") {
		const debugWindow = window as typeof window & { __piboTraceSnapshotCollectionEnabled?: boolean };
		if (debugWindow.__piboTraceSnapshotCollectionEnabled === true) return true;
	}
	try {
		return localStorage.getItem("pibo.chat.traceDebug") === "true";
	} catch {
		return false;
	}
}

function simpleDigest(values: readonly string[]): string {
	let hash = 0;
	for (const value of values) {
		for (let i = 0; i < value.length; i++) {
			hash = (hash << 5) - hash + value.charCodeAt(i);
			hash |= 0;
		}
	}
	return hash.toString(36);
}

function layerDigest(meta: unknown): string {
	return simpleDigest([JSON.stringify(meta)]);
}

function snapshotSignature(snapshot: TraceSnapshot): string {
	return JSON.stringify({
		trigger: snapshot.trigger,
		traceVersion: snapshot.traceVersion,
		baseTraceVersion: snapshot.baseTraceVersion,
		latestStreamId: snapshot.latestStreamId,
		lastRawEventId: snapshot.lastRawEventId,
		selectedSessionStatus: snapshot.selectedSessionStatus,
		overlayEventCount: snapshot.overlayEventCount,
		layers: snapshot.layers.map((layer) => [layer.kind, layer.digest]),
	});
}

function finalizePending(buffer: SessionSnapshotBuffer): void {
	if (!buffer.pending) return;
	const snapshot = buffer.pending as TraceSnapshot;
	if (snapshot.layers.length === 0) {
		buffer.pending = null;
		return;
	}
	const last = buffer.snapshots.at(-1);
	if (!last || snapshotSignature(last) !== snapshotSignature(snapshot)) {
		buffer.snapshots.push(snapshot);
		if (buffer.snapshots.length > MAX_SNAPSHOTS_PER_SESSION) buffer.snapshots.shift();
	}
	buffer.pending = null;
}

export function collectSnapshot(partial: {
	piboSessionId: string;
	trigger: string;
	layer?: TraceSnapshotLayer;
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>;
	traceVersion?: string;
	baseTraceVersion?: string;
	latestStreamId?: number;
	lastRawEventId?: string;
	selectedSessionStatus?: PiboWebSessionStatus;
	overlayEventCount?: number;
}): void {
	if (!isTraceSnapshotCollectionEnabled()) return;
	const buffer = getBuffer(partial.piboSessionId);
	if (buffer.pendingTimer) {
		clearTimeout(buffer.pendingTimer);
		buffer.pendingTimer = null;
	}
	const pendingLayer = partial.layer && buffer.pending?.layers?.find((layer) => layer.kind === partial.layer!.kind);
	const metadataCompatible = buffer.pending
		&& compatibleValue(buffer.pending.traceVersion, partial.traceVersion)
		&& compatibleValue(buffer.pending.baseTraceVersion, partial.baseTraceVersion)
		&& compatibleValue(buffer.pending.latestStreamId, partial.latestStreamId)
		&& compatibleValue(buffer.pending.lastRawEventId, partial.lastRawEventId)
		&& compatibleValue(buffer.pending.selectedSessionStatus, partial.selectedSessionStatus)
		&& compatibleValue(buffer.pending.overlayEventCount, partial.overlayEventCount);
	const sameSnapshot = buffer.pending
		&& buffer.pending.trigger === partial.trigger
		&& buffer.pending.piboSessionId === partial.piboSessionId
		&& metadataCompatible
		&& (!pendingLayer || pendingLayer.digest === partial.layer?.digest);
	if (!sameSnapshot) finalizePending(buffer);
	if (!buffer.pending) {
		buffer.pending = {
			sequence: ++snapshotSequence,
			timestamp: Date.now(),
			piboSessionId: partial.piboSessionId,
			trigger: partial.trigger,
			layers: [],
			expansionOverrides: partial.expansionOverrides,
			traceVersion: partial.traceVersion,
			baseTraceVersion: partial.baseTraceVersion,
			latestStreamId: partial.latestStreamId,
			lastRawEventId: partial.lastRawEventId,
			selectedSessionStatus: partial.selectedSessionStatus,
			overlayEventCount: partial.overlayEventCount,
		};
	}
	if (partial.layer) {
		const existing = buffer.pending.layers!.findIndex((layer) => layer.kind === partial.layer!.kind);
		if (existing >= 0) buffer.pending.layers![existing] = partial.layer;
		else buffer.pending.layers!.push(partial.layer);
	}
	if (partial.expansionOverrides !== undefined) buffer.pending.expansionOverrides = partial.expansionOverrides;
	if (partial.traceVersion !== undefined) buffer.pending.traceVersion = partial.traceVersion;
	if (partial.baseTraceVersion !== undefined) buffer.pending.baseTraceVersion = partial.baseTraceVersion;
	if (partial.latestStreamId !== undefined) buffer.pending.latestStreamId = partial.latestStreamId;
	if (partial.lastRawEventId !== undefined) buffer.pending.lastRawEventId = partial.lastRawEventId;
	if (partial.selectedSessionStatus !== undefined) buffer.pending.selectedSessionStatus = partial.selectedSessionStatus;
	if (partial.overlayEventCount !== undefined) buffer.pending.overlayEventCount = partial.overlayEventCount;
	buffer.pendingTimer = setTimeout(() => {
		finalizePending(buffer);
		buffer.pendingTimer = null;
	}, PENDING_MERGE_MS);
}

export function collectTraceState(input: {
	piboSessionId: string;
	trigger: string;
	baseTraceView: PiboSessionTraceView | null;
	currentTraceView: PiboSessionTraceView;
	overlayEvents: readonly ChatWebStoredEvent[];
	selectedSessionStatus?: PiboWebSessionStatus;
}): void {
	const meta = {
		traceVersion: input.currentTraceView.version,
		baseTraceVersion: input.baseTraceView?.version,
		latestStreamId: input.currentTraceView.latestStreamId,
		lastRawEventId: input.currentTraceView.rawEvents.at(-1)?.id,
		selectedSessionStatus: input.selectedSessionStatus,
		overlayEventCount: input.overlayEvents.length,
	};
	collectNodeLayer(input.piboSessionId, input.trigger, "baseNodes", input.baseTraceView?.nodes ?? [], meta);
	collectOverlayLayer(input.piboSessionId, input.trigger, input.overlayEvents, meta);
	collectNodeLayer(input.piboSessionId, input.trigger, "currentNodes", input.currentTraceView.nodes, meta);
}

export function collectBackendNodes(
	piboSessionId: string,
	trigger: string,
	nodes: readonly PiboTraceNode[],
	meta?: { traceVersion?: string; latestStreamId?: number; lastRawEventId?: string },
): void {
	collectNodeLayer(piboSessionId, trigger, "backendNodes", nodes, meta);
}

function collectNodeLayer(
	piboSessionId: string,
	trigger: string,
	kind: "baseNodes" | "currentNodes" | "backendNodes",
	nodes: readonly PiboTraceNode[],
	meta?: Omit<Parameters<typeof collectSnapshot>[0], "piboSessionId" | "trigger" | "layer">,
): void {
	const flat = flattenTraceNodes(nodes);
	const nodeMeta = flat.map(traceNodeMeta);
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: { kind, ids: nodeMeta.map((node) => node.id), digest: layerDigest(nodeMeta), meta: nodeMeta },
		...meta,
	});
}

function collectOverlayLayer(
	piboSessionId: string,
	trigger: string,
	events: readonly ChatWebStoredEvent[],
	meta?: Omit<Parameters<typeof collectSnapshot>[0], "piboSessionId" | "trigger" | "layer">,
): void {
	const eventMeta = events.map((event) => ({
		id: event.id,
		type: event.type,
		eventId: event.eventId,
		eventSequence: event.eventSequence,
		streamId: event.streamId,
		streamFrameIndex: event.streamFrameIndex,
	}));
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: { kind: "overlayEvents", ids: eventMeta.map((event) => event.id), digest: layerDigest(eventMeta), meta: eventMeta },
		...meta,
	});
}

export function collectTerminalRows(
	piboSessionId: string,
	trigger: string,
	rows: readonly TerminalRowLike[],
	meta?: { traceVersion?: string; latestStreamId?: number; lastRawEventId?: string; selectedSessionStatus?: PiboWebSessionStatus },
): void {
	const rowMeta = rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		status: row.status,
		sourceNodeIds: [...row.sourceNodeIds],
		eventId: row.eventId,
		runId: row.runId,
		orderSource: row.orderSource,
		orderStreamId: row.orderStreamId,
		orderStreamFrameIndex: row.orderStreamFrameIndex,
	}));
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: { kind: "terminalRows", ids: rowMeta.map((row) => row.id), digest: layerDigest(rowMeta), meta: rowMeta },
		...meta,
	});
}

export function collectVisibleRows(
	piboSessionId: string,
	trigger: string,
	rows: Array<{ id: string; depth: number; span: Span }>,
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>,
	meta?: { traceVersion?: string; latestStreamId?: number; lastRawEventId?: string },
): void {
	const rowMeta = rows.map((row) => ({
		id: row.id,
		depth: row.depth,
		spanType: row.span.spanType,
		status: row.span.status,
		source: row.span.pibo?.source,
		stableKey: row.span.pibo?.stableKey,
		orderKey: row.span.pibo?.traceOrder,
	}));
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: { kind: "visibleRows", ids: rowMeta.map((row) => row.id), digest: layerDigest(rowMeta), meta: rowMeta },
		expansionOverrides,
		...meta,
	});
}

export function getSnapshots(piboSessionId: string): readonly TraceSnapshot[] {
	const buffer = buffers.get(piboSessionId);
	if (!buffer) return [];
	finalizePending(buffer);
	return buffer.snapshots;
}

export function getLatestSnapshotSequence(piboSessionId: string): number | undefined {
	const buffer = buffers.get(piboSessionId);
	return buffer?.pending?.sequence ?? buffer?.snapshots.at(-1)?.sequence;
}

export function exportSnapshots(piboSessionId?: string): string {
	if (piboSessionId) return JSON.stringify({ piboSessionId, snapshots: getSnapshots(piboSessionId) }, null, 2);
	const result: Record<string, TraceSnapshot[]> = {};
	for (const [id, buffer] of buffers) {
		finalizePending(buffer);
		result[id] = buffer.snapshots;
	}
	return JSON.stringify(result, null, 2);
}

export function clearSnapshots(piboSessionId?: string): void {
	if (piboSessionId) {
		clearSnapshotBuffer(buffers.get(piboSessionId));
		buffers.delete(piboSessionId);
		return;
	}
	for (const buffer of buffers.values()) clearSnapshotBuffer(buffer);
	buffers.clear();
}

function clearSnapshotBuffer(buffer: SessionSnapshotBuffer | undefined): void {
	if (!buffer?.pendingTimer) return;
	clearTimeout(buffer.pendingTimer);
	buffer.pendingTimer = null;
}

function compatibleValue(left: unknown, right: unknown): boolean {
	return right === undefined || left === undefined || left === right;
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children ?? [])]);
}

function traceNodeMeta(node: PiboTraceNode): TraceSnapshotNodeMeta {
	const content = traceNodeContent(node);
	return {
		id: node.id,
		type: node.type,
		status: node.status,
		parentId: node.parentId,
		childIds: node.children.map((child) => child.id),
		entryId: node.entryId,
		eventId: node.eventId,
		toolCallId: node.toolCallId,
		runId: node.runId,
		stableKey: node.stableKey,
		source: node.source,
		orderKey: node.orderKey,
		contentLength: content.length,
		contentKind: traceNodeContentKind(content),
	};
}

function traceNodeContentKind(content: string): TraceSnapshotNodeMeta["contentKind"] {
	if (content.startsWith("<pibo_run_notification>")) return "pibo-run-notification";
	if (content.startsWith("<pibo_goal_continuation>")) return "pibo-goal-continuation";
	if (content.startsWith("<pibo_")) return "pibo-system";
	return "message";
}

function traceNodeContent(node: PiboTraceNode): string {
	if (typeof node.output === "string") return node.output;
	if (typeof node.summary === "string") return node.summary;
	if (node.output && typeof node.output === "object" && "text" in node.output && typeof node.output.text === "string") return node.output.text;
	return "";
}

if (typeof window !== "undefined") {
	// @ts-expect-error Debug-only browser API.
	window.__piboTraceSnapshots = {
		exportAsJson: (piboSessionId?: string) => {
			const json = exportSnapshots(piboSessionId);
			const blob = new Blob([json], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `trace-snapshots-${piboSessionId ?? "all"}-${Date.now()}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		},
		getSnapshots,
		getLatestSequence: getLatestSnapshotSequence,
		clearSnapshots,
		exportSnapshots,
	};
}
