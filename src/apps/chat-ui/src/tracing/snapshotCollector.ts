/**
 * Trace Render Snapshot Collector
 *
 * Erfasst den Zustand der Trace-Timeline auf allen 5 Transformationsebenen
 * für programmatisches Debugging von Render- und Sortierfehlern.
 *
 * Aktivierung: localStorage.setItem('pibo.chat.traceDebug', 'true')
 */

import type { PiboSessionTraceView, PiboTraceNode } from "../types";
import type { Span } from "../types";

export type TraceSnapshotLayer =
	| { kind: "backendNodes"; ids: string[]; digest: string; meta: Array<{ id: string; type: string; orderKey?: string; parentId?: string }> }
	| { kind: "adaptedSpans"; ids: string[]; digest: string; meta: Array<{ id: string; spanType: string; startTime: number }> }
	| { kind: "processedTree"; ids: string[]; digest: string; meta: Array<{ id: string; spanType: string; depth: number }> }
	| { kind: "visibleRows"; ids: string[]; digest: string; meta: Array<{ id: string; depth: number; spanType: string; status: string }> };

export type TraceSnapshot = {
	timestamp: number;
	piboSessionId: string;
	trigger: string;
	layers: TraceSnapshotLayer[];
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>;
	traceVersion?: string;
	latestStreamId?: number;
	lastRawEventId?: string;
};

type SessionSnapshotBuffer = {
	snapshots: TraceSnapshot[];
	pending: Partial<TraceSnapshot> | null;
	pendingTimer: ReturnType<typeof setTimeout> | null;
};

const MAX_SNAPSHOTS_PER_SESSION = 5000;
const PENDING_MERGE_MS = 50;
const buffers = new Map<string, SessionSnapshotBuffer>();

function getBuffer(piboSessionId: string): SessionSnapshotBuffer {
	let buffer = buffers.get(piboSessionId);
	if (!buffer) {
		buffer = { snapshots: [], pending: null, pendingTimer: null };
		buffers.set(piboSessionId, buffer);
	}
	return buffer;
}

function isEnabled(): boolean {
	try {
		return localStorage.getItem("pibo.chat.traceDebug") === "true";
	} catch {
		return false;
	}
}

function simpleDigest(values: string[]): string {
	let hash = 0;
	for (const value of values) {
		for (let i = 0; i < value.length; i++) {
			const char = value.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash |= 0;
		}
	}
	return hash.toString(36);
}

function finalizePending(buffer: SessionSnapshotBuffer): void {
	if (!buffer.pending) return;
	const snapshot = buffer.pending as TraceSnapshot;
	if (snapshot.layers.length === 0) {
		buffer.pending = null;
		return;
	}
	const last = buffer.snapshots.at(-1);
	const isDuplicate =
		last &&
		last.trigger === snapshot.trigger &&
		last.traceVersion === snapshot.traceVersion &&
		JSON.stringify(last.layers.map((l) => l.ids)) === JSON.stringify(snapshot.layers.map((l) => l.ids));
	if (!isDuplicate) {
		buffer.snapshots.push(snapshot);
		if (buffer.snapshots.length > MAX_SNAPSHOTS_PER_SESSION) {
			buffer.snapshots.shift();
		}
	}
	buffer.pending = null;
}

export function collectSnapshot(partial: {
	piboSessionId: string;
	trigger: string;
	layer?: TraceSnapshotLayer;
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>;
	traceVersion?: string;
	latestStreamId?: number;
	lastRawEventId?: string;
}): void {
	if (!isEnabled()) return;
	const buffer = getBuffer(partial.piboSessionId);
	if (buffer.pendingTimer) {
		clearTimeout(buffer.pendingTimer);
		buffer.pendingTimer = null;
	}
	if (!buffer.pending || buffer.pending.trigger !== partial.trigger || buffer.pending.piboSessionId !== partial.piboSessionId) {
		finalizePending(buffer);
		buffer.pending = {
			timestamp: Date.now(),
			piboSessionId: partial.piboSessionId,
			trigger: partial.trigger,
			layers: [],
			expansionOverrides: partial.expansionOverrides,
			traceVersion: partial.traceVersion,
			latestStreamId: partial.latestStreamId,
			lastRawEventId: partial.lastRawEventId,
		};
	}
	if (partial.layer) {
		const existing = buffer.pending.layers!.findIndex((l) => l.kind === partial.layer!.kind);
		if (existing >= 0) {
			buffer.pending.layers![existing] = partial.layer;
		} else {
			buffer.pending.layers!.push(partial.layer);
		}
	}
	if (partial.expansionOverrides !== undefined) {
		buffer.pending.expansionOverrides = partial.expansionOverrides;
	}
	buffer.pendingTimer = setTimeout(() => {
		finalizePending(buffer);
		buffer.pendingTimer = null;
	}, PENDING_MERGE_MS);
}

export function collectBackendNodes(
	piboSessionId: string,
	trigger: string,
	nodes: readonly PiboTraceNode[],
	meta?: { traceVersion?: string; latestStreamId?: number; lastRawEventId?: string },
): void {
	const flat = flattenTraceNodes(nodes);
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: {
			kind: "backendNodes",
			ids: flat.map((n) => n.id),
			digest: simpleDigest(flat.map((n) => n.id)),
			meta: flat.map((n) => ({ id: n.id, type: n.type, orderKey: JSON.stringify(n.orderKey), parentId: n.parentId })),
		},
		...meta,
	});
}

export function collectVisibleRows(
	piboSessionId: string,
	trigger: string,
	rows: Array<{ id: string; depth: number; span: Span }>,
	expansionOverrides?: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>,
): void {
	collectSnapshot({
		piboSessionId,
		trigger,
		layer: {
			kind: "visibleRows",
			ids: rows.map((r) => r.id),
			digest: simpleDigest(rows.map((r) => r.id)),
			meta: rows.map((r) => ({ id: r.id, depth: r.depth, spanType: r.span.spanType, status: r.span.status })),
		},
		expansionOverrides,
	});
}

export function getSnapshots(piboSessionId: string): readonly TraceSnapshot[] {
	const buffer = buffers.get(piboSessionId);
	if (!buffer) return [];
	finalizePending(buffer);
	return buffer.snapshots;
}

export function exportSnapshots(piboSessionId?: string): string {
	if (piboSessionId) {
		const snapshots = getSnapshots(piboSessionId);
		return JSON.stringify({ piboSessionId, snapshots }, null, 2);
	}
	const result: Record<string, TraceSnapshot[]> = {};
	for (const [id, buffer] of buffers) {
		finalizePending(buffer);
		result[id] = buffer.snapshots;
	}
	return JSON.stringify(result, null, 2);
}

export function clearSnapshots(piboSessionId?: string): void {
	if (piboSessionId) {
		buffers.delete(piboSessionId);
	} else {
		buffers.clear();
	}
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((n) => [n, ...flattenTraceNodes(n.children ?? [])]);
}

// Globaler Export für manuelle Konsolen-Nutzung
if (typeof window !== "undefined") {
	// @ts-expect-error Dev-Tool
	window.__piboTraceSnapshots = {
		exportAsJson: (piboSessionId?: string) => {
			const json = exportSnapshots(piboSessionId);
			const blob = new Blob([json], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `trace-snapshots-${piboSessionId ?? "all"}-${Date.now()}.json`;
			a.click();
			URL.revokeObjectURL(url);
		},
		getSnapshots,
		clearSnapshots,
		exportSnapshots,
	};
}
