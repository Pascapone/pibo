import { DEFAULT_TELEMETRY_STALE_THRESHOLD_MS } from "../core/telemetry-staleness.js";
import { errorFromNode, isActiveSignalStatus, isTerminalSignalStatus, phaseForStatus, strongestStatus } from "./aggregate.js";
import { createDefaultSignalProducers } from "./projector.js";
import type {
	ChildSessionSignalSummary,
	PiboSessionSignalSnapshot,
	PiboSignalError,
	PiboSignalInput,
	PiboSignalListener,
	PiboSignalMutation,
	PiboSignalNode,
	PiboSignalPatch,
	PiboSignalProducer,
	PiboSignalProjectorContext,
	PiboSignalRegistry,
	PiboSignalRegistryDiagnostics,
	PiboSignalRegistryPruneOptions,
	PiboSignalSnapshot,
	RunSignalSummary,
	ToolCallSignalSummary,
} from "./types.js";

function now(): string { return new Date().toISOString(); }

export type InMemoryPiboSignalRegistryOptions = {
	terminalSuccessTtlMs?: number;
	terminalErrorTtlMs?: number;
};

const DEFAULT_TERMINAL_SUCCESS_TTL_MS = 60_000;
const DEFAULT_TERMINAL_ERROR_TTL_MS = 10 * 60_000;

function jsonValueEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((value, index) => jsonValueEqual(value, b[index]));
	}
	if (typeof a === "object") {
		const aRecord = a as Record<string, unknown>;
		const bRecord = b as Record<string, unknown>;
		const aKeys = Object.keys(aRecord).sort();
		const bKeys = Object.keys(bRecord).sort();
		if (!arrayEqual(aKeys, bKeys, Object.is)) return false;
		return aKeys.every((key) => jsonValueEqual(aRecord[key], bRecord[key]));
	}
	return false;
}

function arrayEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined, equal: (a: T, b: T) => boolean): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, index) => equal(value, b[index]!));
}

function errorEqual(a: unknown, b: unknown): boolean {
	return jsonValueEqual(a, b);
}

function dedupeErrors(errors: readonly PiboSignalError[]): PiboSignalError[] {
	const seen = new Set<string>();
	const deduped: PiboSignalError[] = [];
	for (const error of errors) {
		const key = JSON.stringify({
			message: error.message,
			code: error.code,
			source: error.source,
			retryable: error.retryable,
		});
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(error);
	}
	return deduped;
}

function activeTelemetryHint(piboSessionId: string, activeNodes: PiboSignalNode[], queuedMessages: number, timestamp: string): PiboSessionSignalSnapshot["activeTelemetry"] {
	if (activeNodes.length === 0 && queuedMessages <= 0) return undefined;
	const lastProgressAt = latestNodeUpdate(activeNodes) ?? timestamp;
	const staleForMs = Math.max(0, Date.parse(timestamp) - Date.parse(lastProgressAt));
	const activeNode = activeNodes.find((node) => node.kind === "tool_call")
		?? activeNodes.find((node) => node.kind === "assistant_stream" || node.kind === "thinking_stream")
		?? activeNodes.find((node) => node.kind === "turn")
		?? activeNodes[0];
	return {
		source: "signals",
		activeTurnId: telemetryTurnIdFromNode(activeNode, piboSessionId),
		activePhase: activeSignalPhase(activeNode, queuedMessages),
		lastProgressAt,
		staleForMs,
		isStale: staleForMs >= DEFAULT_TELEMETRY_STALE_THRESHOLD_MS,
		queueDepth: queuedMessages,
		thresholdMs: DEFAULT_TELEMETRY_STALE_THRESHOLD_MS,
	};
}

function latestNodeUpdate(nodes: PiboSignalNode[]): string | undefined {
	let latest: string | undefined;
	for (const node of nodes) {
		if (!latest || Date.parse(node.updatedAt) > Date.parse(latest)) latest = node.updatedAt;
	}
	return latest;
}

function activeSignalPhase(node: PiboSignalNode | undefined, queuedMessages: number): string | undefined {
	if (!node) return queuedMessages > 0 ? "queued" : undefined;
	if (node.kind === "assistant_stream") return "assistant_text";
	if (node.kind === "thinking_stream") return "reasoning";
	if (node.kind === "tool_call") return node.status === "running" ? "tool_execution" : "tool_args";
	if (node.kind === "message") return "queued";
	if (node.kind === "turn") return "message_started";
	return node.kind;
}

function telemetryTurnIdFromNode(node: PiboSignalNode | undefined, piboSessionId: string): string | undefined {
	if (!node) return undefined;
	const prefix = `turn:${piboSessionId}:`;
	if (!node.id.startsWith(prefix)) {
		return node.parentNodeId?.startsWith(prefix) ? `turn_${node.parentNodeId.slice(prefix.length)}` : undefined;
	}
	return `turn_${node.id.slice(prefix.length)}`;
}

function signalNodeEqual(a: PiboSignalNode | undefined, b: PiboSignalNode): boolean {
	if (!a) return false;
	return a.id === b.id
		&& a.kind === b.kind
		&& a.status === b.status
		&& a.rootPiboSessionId === b.rootPiboSessionId
		&& a.piboSessionId === b.piboSessionId
		&& a.parentNodeId === b.parentNodeId
		&& a.parentPiboSessionId === b.parentPiboSessionId
		&& a.childPiboSessionId === b.childPiboSessionId
		&& a.createdAt === b.createdAt
		&& a.startedAt === b.startedAt
		&& a.completedAt === b.completedAt
		&& errorEqual(a.error, b.error)
		&& jsonValueEqual(a.metadata, b.metadata);
}

function toolCallSummaryEqual(a: ToolCallSignalSummary, b: ToolCallSignalSummary): boolean {
	return a.nodeId === b.nodeId
		&& a.toolCallId === b.toolCallId
		&& a.toolName === b.toolName
		&& a.status === b.status
		&& a.startedAt === b.startedAt
		&& a.updatedAt === b.updatedAt;
}

function runSummaryEqual(a: RunSignalSummary, b: RunSignalSummary): boolean {
	return a.nodeId === b.nodeId
		&& a.runId === b.runId
		&& a.toolName === b.toolName
		&& a.status === b.status
		&& a.completionPolicy === b.completionPolicy
		&& a.consumed === b.consumed
		&& a.startedAt === b.startedAt
		&& a.updatedAt === b.updatedAt;
}

function childSummaryEqual(a: ChildSessionSignalSummary, b: ChildSessionSignalSummary): boolean {
	return a.nodeId === b.nodeId
		&& a.piboSessionId === b.piboSessionId
		&& a.status === b.status
		&& a.isTreeActive === b.isTreeActive
		&& a.hasError === b.hasError
		&& a.updatedAt === b.updatedAt;
}

function sessionSnapshotSemanticallyEqual(a: PiboSessionSignalSnapshot | undefined, b: PiboSessionSignalSnapshot): boolean {
	if (!a) return false;
	return a.piboSessionId === b.piboSessionId
		&& a.piSessionId === b.piSessionId
		&& a.parentPiboSessionId === b.parentPiboSessionId
		&& a.rootPiboSessionId === b.rootPiboSessionId
		&& a.localStatus === b.localStatus
		&& a.aggregateStatus === b.aggregateStatus
		&& a.phase === b.phase
		&& a.queuedMessages === b.queuedMessages
		&& a.currentMessageId === b.currentMessageId
		&& a.currentTurnId === b.currentTurnId
		&& a.isLocalActive === b.isLocalActive
		&& a.hasActiveDescendant === b.hasActiveDescendant
		&& a.isTreeActive === b.isTreeActive
		&& a.isSettled === b.isSettled
		&& a.hasError === b.hasError
		&& a.hasErrorDescendant === b.hasErrorDescendant
		&& a.hasBlockedDescendant === b.hasBlockedDescendant
		&& arrayEqual(a.activeToolCalls, b.activeToolCalls, toolCallSummaryEqual)
		&& arrayEqual(a.activeRuns, b.activeRuns, runSummaryEqual)
		&& arrayEqual(a.activeChildren, b.activeChildren, childSummaryEqual)
		&& jsonValueEqual(a.activeTelemetry, b.activeTelemetry)
		&& arrayEqual(a.errors, b.errors, errorEqual);
}

export class InMemoryPiboSignalRegistry implements PiboSignalRegistry {
	private readonly nodesById = new Map<string, PiboSignalNode>();
	private readonly nodeIdsBySessionId = new Map<string, Set<string>>();
	private readonly childSessionIdsByParentId = new Map<string, Set<string>>();
	private readonly parentSessionIdByChildId = new Map<string, string>();
	private readonly rootSessionIdBySessionId = new Map<string, string>();
	private readonly sessionDepthById = new Map<string, number>();
	private readonly versionByRootId = new Map<string, number>();
	private readonly sessionSnapshotById = new Map<string, PiboSessionSignalSnapshot>();
	private readonly queuedMessagesBySessionId = new Map<string, number>();
	private readonly subscribersByRootId = new Map<string, Set<PiboSignalListener>>();
	private readonly producers: PiboSignalProducer[] = createDefaultSignalProducers();

	constructor(private readonly options: InMemoryPiboSignalRegistryOptions = {}) {}

	registerProducer(producer: PiboSignalProducer): void {
		this.producers.push(producer);
	}

	pruneTerminalNodes(options: PiboSignalRegistryPruneOptions = {}): number {
		const nowMs = options.nowMs ?? Date.now();
		const successTtlMs = options.terminalSuccessTtlMs ?? this.options.terminalSuccessTtlMs ?? DEFAULT_TERMINAL_SUCCESS_TTL_MS;
		const errorTtlMs = options.terminalErrorTtlMs ?? this.options.terminalErrorTtlMs ?? DEFAULT_TERMINAL_ERROR_TTL_MS;
		let pruned = 0;
		for (const node of [...this.nodesById.values()]) {
			if (node.kind === "session" || isActiveSignalStatus(node.status)) continue;
			const completedMs = Date.parse(node.completedAt ?? node.updatedAt);
			if (!Number.isFinite(completedMs)) continue;
			const ttlMs = node.status === "error" ? errorTtlMs : successTtlMs;
			if (nowMs - completedMs < ttlMs) continue;
			if (this.project({ type: "signal_node_pruned", nodeId: node.id })) pruned += 1;
		}
		return pruned;
	}

	diagnostics(options: { stuckActiveMs?: number; nowMs?: number } = {}): PiboSignalRegistryDiagnostics {
		const nowMs = options.nowMs ?? Date.now();
		const thresholdMs = options.stuckActiveMs ?? 10 * 60_000;
		const subscribersByRootId = Object.fromEntries([...this.subscribersByRootId].map(([rootId, listeners]) => [rootId, listeners.size]));
		return {
			nodeCount: this.nodesById.size,
			sessionCount: this.rootSessionIdBySessionId.size,
			rootCount: this.versionByRootId.size,
			subscriberCount: [...this.subscribersByRootId.values()].reduce((sum, listeners) => sum + listeners.size, 0),
			subscribersByRootId,
			stuckActiveNodes: [...this.nodesById.values()].filter((node) => isActiveSignalStatus(node.status) && nowMs - Date.parse(node.startedAt ?? node.createdAt) >= thresholdMs),
		};
	}

	project(input: PiboSignalInput): PiboSignalPatch | undefined {
		const mutations = this.producers.flatMap((producer) => producer.accepts(input) ? producer.project(input, this.context()) : []);
		if (mutations.length === 0) return undefined;

		const changedSessionIds = new Set<string>();
		const upserts: PiboSignalNode[] = [];
		const removes: string[] = [];
		for (const mutation of mutations) this.applyMutation(mutation, changedSessionIds, upserts, removes);
		if (changedSessionIds.size === 0 && upserts.length === 0 && removes.length === 0) return undefined;

		const affectedRoots = new Set<string>();
		for (const sessionId of changedSessionIds) affectedRoots.add(this.getSessionRoot(sessionId));
		for (const node of upserts) affectedRoots.add(node.rootPiboSessionId);
		const patches: PiboSignalPatch[] = [];
		for (const rootId of affectedRoots) {
			const before = this.versionByRootId.get(rootId) ?? 0;
			const changedSnapshots = this.recomputeAncestors([...changedSessionIds].filter((id) => this.getSessionRoot(id) === rootId), before + 1);
			const patch: PiboSignalPatch = {
				type: "signal_patch",
				rootPiboSessionId: rootId,
				fromVersion: before,
				toVersion: before + 1,
				generatedAt: now(),
				upserts: upserts.filter((node) => node.rootPiboSessionId === rootId),
				removes: removes.filter((id) => this.removedNodeBelongsToRoot(id, rootId, upserts)),
				sessionSnapshots: changedSnapshots,
			};
			this.versionByRootId.set(rootId, patch.toVersion);
			this.notify(rootId, patch);
			patches.push(patch);
		}
		return patches[0];
	}

	snapshotSession(piboSessionId: string): PiboSignalSnapshot {
		this.ensureSession(piboSessionId);
		const rootId = this.getSessionRoot(piboSessionId);
		const session = this.sessionSnapshotById.get(piboSessionId) ?? this.computeSessionSnapshot(piboSessionId, this.versionByRootId.get(rootId) ?? 0);
		const nodes = Object.fromEntries([...this.nodesForSession(piboSessionId)].map((node) => [node.id, node]));
		return { rootPiboSessionId: rootId, version: this.versionByRootId.get(rootId) ?? 0, generatedAt: now(), sessions: { [piboSessionId]: session }, nodes };
	}

	snapshotTree(rootPiboSessionId: string): PiboSignalSnapshot {
		const rootId = this.getSessionRoot(rootPiboSessionId);
		this.ensureSession(rootId);
		const sessionIds = this.collectSessionTree(rootId);
		const sessions: Record<string, PiboSessionSignalSnapshot> = {};
		const nodes: Record<string, PiboSignalNode> = {};
		const version = this.versionByRootId.get(rootId) ?? 0;
		for (const sessionId of sessionIds) {
			sessions[sessionId] = this.sessionSnapshotById.get(sessionId) ?? this.computeSessionSnapshot(sessionId, version);
			for (const node of this.nodesForSession(sessionId)) nodes[node.id] = node;
		}
		return { rootPiboSessionId: rootId, version, generatedAt: now(), sessions, nodes };
	}

	subscribe(rootPiboSessionId: string, listener: PiboSignalListener): () => void {
		const rootId = this.getSessionRoot(rootPiboSessionId);
		const listeners = this.subscribersByRootId.get(rootId) ?? new Set<PiboSignalListener>();
		listeners.add(listener);
		this.subscribersByRootId.set(rootId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.subscribersByRootId.delete(rootId);
		};
	}

	private context(): PiboSignalProjectorContext {
		return {
			now,
			getNode: (id) => this.nodesById.get(id),
			getSessionNodes: (id) => this.nodesForSession(id),
			getSessionRoot: (id) => this.getSessionRoot(id),
			getSessionParent: (id) => this.parentSessionIdByChildId.get(id),
		};
	}

	private applyMutation(mutation: PiboSignalMutation, changedSessionIds: Set<string>, upserts: PiboSignalNode[], removes: string[]): void {
		if (mutation.type === "set_session_queue") {
			const previous = this.queuedMessagesBySessionId.get(mutation.piboSessionId) ?? 0;
			this.ensureSession(mutation.piboSessionId);
			if (previous === mutation.queuedMessages) return;
			this.queuedMessagesBySessionId.set(mutation.piboSessionId, mutation.queuedMessages);
			changedSessionIds.add(mutation.piboSessionId);
			return;
		}
		if (mutation.type === "remove_node") {
			const existing = this.nodesById.get(mutation.nodeId);
			if (!existing) return;
			if (existing.piboSessionId) changedSessionIds.add(existing.piboSessionId);
			this.nodesById.delete(mutation.nodeId);
			if (existing.piboSessionId) this.nodeIdsBySessionId.get(existing.piboSessionId)?.delete(mutation.nodeId);
			removes.push(mutation.nodeId);
			return;
		}
		if (mutation.type === "link_parent") {
			const existing = this.nodesById.get(mutation.nodeId);
			if (!existing || existing.parentNodeId === mutation.parentNodeId) return;
			this.nodesById.set(existing.id, { ...existing, parentNodeId: mutation.parentNodeId, updatedAt: now() });
			if (existing.piboSessionId) changedSessionIds.add(existing.piboSessionId);
			return;
		}
		const incoming = mutation.type === "upsert_node"
			? mutation.node
			: this.patchExistingNode(mutation.nodeId, mutation.patch);
		if (!incoming) return;
		const existing = this.nodesById.get(incoming.id);
		const merged = existing ? { ...existing, ...incoming, metadata: incoming.metadata ?? existing.metadata } : incoming;
		if (signalNodeEqual(existing, merged)) return;
		this.nodesById.set(merged.id, merged);
		if (merged.piboSessionId) {
			this.ensureSession(merged.piboSessionId, merged.kind === "session" ? merged.parentPiboSessionId : undefined, merged.rootPiboSessionId);
			const ids = this.nodeIdsBySessionId.get(merged.piboSessionId) ?? new Set<string>();
			ids.add(merged.id);
			this.nodeIdsBySessionId.set(merged.piboSessionId, ids);
			changedSessionIds.add(merged.piboSessionId);
		}
		if (merged.kind === "session" && merged.piboSessionId) this.ensureSession(merged.piboSessionId, merged.parentPiboSessionId, merged.rootPiboSessionId);
		if (merged.childPiboSessionId && merged.piboSessionId) this.ensureSession(merged.childPiboSessionId, merged.piboSessionId, this.getSessionRoot(merged.piboSessionId));
		upserts.push(merged);
	}

	private patchExistingNode(nodeId: string, patch: Partial<PiboSignalNode>): PiboSignalNode | undefined {
		const existing = this.nodesById.get(nodeId);
		if (!existing) return undefined;
		return { ...existing, ...patch, id: existing.id, updatedAt: now() };
	}

	private ensureSession(piboSessionId: string, parentPiboSessionId?: string, rootPiboSessionId?: string): void {
		const previousParent = this.parentSessionIdByChildId.get(piboSessionId);
		if (parentPiboSessionId && previousParent !== parentPiboSessionId) {
			if (previousParent) this.childSessionIdsByParentId.get(previousParent)?.delete(piboSessionId);
			this.parentSessionIdByChildId.set(piboSessionId, parentPiboSessionId);
			const children = this.childSessionIdsByParentId.get(parentPiboSessionId) ?? new Set<string>();
			children.add(piboSessionId);
			this.childSessionIdsByParentId.set(parentPiboSessionId, children);
		}
		const effectiveParent = parentPiboSessionId ?? this.parentSessionIdByChildId.get(piboSessionId);
		const rootId = rootPiboSessionId ?? (effectiveParent ? this.getSessionRoot(effectiveParent) : piboSessionId);
		this.rootSessionIdBySessionId.set(piboSessionId, rootId);
		this.refreshSessionDepth(piboSessionId);
		if (!this.versionByRootId.has(rootId)) this.versionByRootId.set(rootId, 0);
		if (!this.nodesById.has(`session:${piboSessionId}`)) {
			const timestamp = now();
			const sessionNode: PiboSignalNode = { id: `session:${piboSessionId}`, kind: "session", status: "idle", rootPiboSessionId: rootId, piboSessionId, parentPiboSessionId, createdAt: timestamp, updatedAt: timestamp };
			this.nodesById.set(sessionNode.id, sessionNode);
			this.nodeIdsBySessionId.set(piboSessionId, new Set([sessionNode.id]));
		}
	}

	private getSessionRoot(piboSessionId: string): string {
		const known = this.rootSessionIdBySessionId.get(piboSessionId);
		if (known) return known;
		const parent = this.parentSessionIdByChildId.get(piboSessionId);
		return parent ? this.getSessionRoot(parent) : piboSessionId;
	}

	private nodesForSession(piboSessionId: string): PiboSignalNode[] {
		return [...(this.nodeIdsBySessionId.get(piboSessionId) ?? [])].flatMap((id) => {
			const node = this.nodesById.get(id);
			return node ? [node] : [];
		});
	}

	private collectSessionTree(rootId: string): string[] {
		const output = [rootId];
		for (const child of this.childSessionIdsByParentId.get(rootId) ?? []) output.push(...this.collectSessionTree(child));
		return output;
	}

	private recomputeAncestors(sessionIds: string[], version: number): PiboSessionSignalSnapshot[] {
		const toRecompute = new Set<string>();
		for (const sessionId of sessionIds) {
			let current: string | undefined = sessionId;
			while (current) {
				toRecompute.add(current);
				current = this.parentSessionIdByChildId.get(current);
			}
		}
		const ordered = [...toRecompute].sort((a, b) => this.depth(b) - this.depth(a));
		const changed: PiboSessionSignalSnapshot[] = [];
		for (const sessionId of ordered) {
			const previous = this.sessionSnapshotById.get(sessionId);
			const candidate = this.computeSessionSnapshot(sessionId, version, previous?.updatedAt);
			if (!sessionSnapshotSemanticallyEqual(previous, candidate)) {
				const snapshot = { ...candidate, version, updatedAt: now() };
				this.sessionSnapshotById.set(sessionId, snapshot);
				changed.push(snapshot);
			}
		}
		return changed;
	}

	private depth(sessionId: string): number {
		const cached = this.sessionDepthById.get(sessionId);
		if (cached !== undefined) return cached;
		return this.refreshSessionDepth(sessionId);
	}

	private refreshSessionDepth(sessionId: string): number {
		const parentId = this.parentSessionIdByChildId.get(sessionId);
		const depth = parentId ? this.depth(parentId) + 1 : 0;
		this.sessionDepthById.set(sessionId, depth);
		for (const childId of this.childSessionIdsByParentId.get(sessionId) ?? []) this.refreshSessionDepth(childId);
		return depth;
	}

	private computeSessionSnapshot(piboSessionId: string, version: number, updatedAt: string = now()): PiboSessionSignalSnapshot {
		this.ensureSession(piboSessionId);
		const rootPiboSessionId = this.getSessionRoot(piboSessionId);
		const nodes = this.nodesForSession(piboSessionId);
		const activeLocalNodes = nodes.filter((node) => node.kind !== "session" && node.kind !== "queue" && isActiveSignalStatus(node.status));
		const sessionNode = this.nodesById.get(`session:${piboSessionId}`);
		const queueNode = this.nodesById.get(`queue:${piboSessionId}`);
		const queuedMessages = this.queuedMessagesBySessionId.get(piboSessionId) ?? Number(queueNode?.metadata?.queuedMessages ?? 0);
		const localStatuses = [...activeLocalNodes.map((node) => node.status)];
		if (queuedMessages > 0) localStatuses.push("queued");
		if (sessionNode && isActiveSignalStatus(sessionNode.status)) localStatuses.push(sessionNode.status);
		const localStatus = sessionNode && (sessionNode.status === "unknown" || isTerminalSignalStatus(sessionNode.status))
			? sessionNode.status
			: strongestStatus(localStatuses);
		const childSnapshots = [...(this.childSessionIdsByParentId.get(piboSessionId) ?? [])].map((id) => this.sessionSnapshotById.get(id) ?? this.computeSessionSnapshot(id, version));
		const aggregateStatus = strongestStatus([localStatus, ...childSnapshots.map((snapshot) => snapshot.aggregateStatus)]);
		const activeToolCalls: ToolCallSignalSummary[] = nodes.filter((node) => node.kind === "tool_call" && isActiveSignalStatus(node.status)).map((node) => ({ nodeId: node.id, toolCallId: typeof node.metadata?.toolCallId === "string" ? node.metadata.toolCallId : undefined, toolName: typeof node.metadata?.toolName === "string" ? node.metadata.toolName : undefined, status: node.status, startedAt: node.startedAt, updatedAt: node.updatedAt }));
		const activeRuns: RunSignalSummary[] = nodes.filter((node) => node.kind === "yielded_run" && isActiveSignalStatus(node.status)).map((node) => ({ nodeId: node.id, runId: String(node.metadata?.runId ?? node.id.replace(/^run:/, "")), toolName: typeof node.metadata?.toolName === "string" ? node.metadata.toolName : undefined, status: node.status, completionPolicy: typeof node.metadata?.completionPolicy === "string" ? node.metadata.completionPolicy : undefined, consumed: typeof node.metadata?.consumed === "boolean" ? node.metadata.consumed : undefined, startedAt: node.startedAt, updatedAt: node.updatedAt }));
		const activeChildren: ChildSessionSignalSummary[] = childSnapshots.filter((snapshot) => snapshot.isTreeActive).map((snapshot) => ({ nodeId: `session:${snapshot.piboSessionId}`, piboSessionId: snapshot.piboSessionId, status: snapshot.aggregateStatus, isTreeActive: snapshot.isTreeActive, hasError: snapshot.hasError || snapshot.hasErrorDescendant, updatedAt: snapshot.updatedAt }));
		const activeTelemetry = activeTelemetryHint(piboSessionId, activeLocalNodes, queuedMessages, now());
		const localErrors = nodes.flatMap((node) => {
			if (node.kind === "tool_call" || node.kind === "yielded_run") return [];
			return errorFromNode(node) ?? [];
		});
		const childErrors = childSnapshots.flatMap((snapshot) => snapshot.errors);
		const errors = dedupeErrors([...localErrors, ...childErrors]);
		const isLocalActive = isActiveSignalStatus(localStatus);
		const hasActiveDescendant = childSnapshots.some((snapshot) => snapshot.isTreeActive);
		return {
			piboSessionId,
			parentPiboSessionId: this.parentSessionIdByChildId.get(piboSessionId),
			rootPiboSessionId,
			version,
			updatedAt,
			localStatus,
			aggregateStatus,
			phase: phaseForStatus(aggregateStatus, nodes),
			queuedMessages,
			currentMessageId: activeLocalNodes.find((node) => node.kind === "message")?.id,
			currentTurnId: activeLocalNodes.find((node) => node.kind === "turn")?.id,
			isLocalActive,
			hasActiveDescendant,
			isTreeActive: isLocalActive || hasActiveDescendant,
			isSettled: !(isLocalActive || hasActiveDescendant) && aggregateStatus !== "blocked" && aggregateStatus !== "paused",
			hasError: localErrors.length > 0 || localStatus === "error",
			hasErrorDescendant: childSnapshots.some((snapshot) => snapshot.hasError || snapshot.hasErrorDescendant),
			hasBlockedDescendant: childSnapshots.some((snapshot) => snapshot.aggregateStatus === "blocked" || snapshot.hasBlockedDescendant),
			activeToolCalls,
			activeRuns,
			activeChildren,
			activeTelemetry,
			errors,
		};
	}

	private removedNodeBelongsToRoot(_id: string, _rootId: string, _upserts: PiboSignalNode[]): boolean {
		// Remove patches are already scoped by affected root. This method exists so the
		// patch construction keeps the same shape if per-root removal metadata is added later.
		return true;
	}

	private notify(rootId: string, patch: PiboSignalPatch): void {
		for (const listener of this.subscribersByRootId.get(rootId) ?? []) queueMicrotask(() => listener(patch));
	}
}

export function createPiboSignalRegistry(options?: InMemoryPiboSignalRegistryOptions): PiboSignalRegistry {
	return new InMemoryPiboSignalRegistry(options);
}
