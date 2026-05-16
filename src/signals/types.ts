import type { PiboOutputEvent } from "../core/events.js";
import type { PiboRunSnapshot, PiboRunStatus } from "../runs/registry.js";
import type { PiboSession } from "../sessions/store.js";

export type PiboSignalKind =
	| "session"
	| "queue"
	| "message"
	| "turn"
	| "assistant_stream"
	| "thinking_stream"
	| "tool_call"
	| "subagent_session"
	| "yielded_run"
	| "compaction"
	| "retry"
	| string;

export type PiboSignalStatus =
	| "idle"
	| "queued"
	| "starting"
	| "running"
	| "streaming"
	| "waiting"
	| "blocked"
	| "retrying"
	| "compacting"
	| "pausing"
	| "paused"
	| "done"
	| "error"
	| "cancelled"
	| "disposed"
	| "interrupted"
	| "unknown"
	| string;

export type PiboSignalError = {
	message: string;
	code?: string;
	source?: "pi" | "pibo" | "tool" | "run" | "network" | "unknown";
	retryable?: boolean;
};

export type PiboSignalNode = {
	id: string;
	kind: PiboSignalKind;
	status: PiboSignalStatus;
	rootPiboSessionId: string;
	piboSessionId?: string;
	parentNodeId?: string;
	parentPiboSessionId?: string;
	childPiboSessionId?: string;
	createdAt: string;
	startedAt?: string;
	updatedAt: string;
	completedAt?: string;
	error?: PiboSignalError;
	metadata?: Record<string, unknown>;
};

export type ToolCallSignalSummary = {
	nodeId: string;
	toolCallId?: string;
	toolName?: string;
	status: PiboSignalStatus;
	startedAt?: string;
	updatedAt: string;
};

export type RunSignalSummary = {
	nodeId: string;
	runId: string;
	toolName?: string;
	status: PiboSignalStatus;
	completionPolicy?: string;
	consumed?: boolean;
	startedAt?: string;
	updatedAt: string;
};

export type ChildSessionSignalSummary = {
	nodeId: string;
	piboSessionId: string;
	status: PiboSignalStatus;
	isTreeActive: boolean;
	hasError: boolean;
	updatedAt: string;
};

export type PiboActiveTelemetrySignalHint = {
	source: "signals";
	activeTurnId?: string;
	activePhase?: string;
	lastProgressAt?: string;
	staleForMs?: number;
	isStale: boolean;
	queueDepth: number;
	thresholdMs: number;
};

export type PiboSessionSignalSnapshot = {
	piboSessionId: string;
	piSessionId?: string;
	parentPiboSessionId?: string;
	rootPiboSessionId: string;
	version: number;
	/** Time of the last semantic snapshot change. Patch generatedAt carries recompute time. */
	updatedAt: string;
	localStatus: PiboSignalStatus;
	aggregateStatus: PiboSignalStatus;
	phase?: "queued" | "prompting" | "streaming" | "tools" | "subagent" | "run" | "compaction" | "retry" | "blocked";
	queuedMessages: number;
	currentMessageId?: string;
	currentTurnId?: string;
	isLocalActive: boolean;
	hasActiveDescendant: boolean;
	isTreeActive: boolean;
	isSettled: boolean;
	hasError: boolean;
	hasErrorDescendant: boolean;
	hasBlockedDescendant: boolean;
	activeToolCalls: ToolCallSignalSummary[];
	activeRuns: RunSignalSummary[];
	activeChildren: ChildSessionSignalSummary[];
	activeTelemetry?: PiboActiveTelemetrySignalHint;
	errors: PiboSignalError[];
};

export type PiboSignalSnapshot = {
	rootPiboSessionId: string;
	version: number;
	generatedAt: string;
	sessions: Record<string, PiboSessionSignalSnapshot>;
	nodes: Record<string, PiboSignalNode>;
};

export type PiboSignalPatch = {
	type?: "signal_patch";
	rootPiboSessionId: string;
	fromVersion: number;
	toVersion: number;
	generatedAt: string;
	upserts: PiboSignalNode[];
	removes: string[];
	sessionSnapshots: PiboSessionSignalSnapshot[];
};

export type PiboSignalListener = (patch: PiboSignalPatch) => void;

export type PiboSignalInput =
	| { type: "pibo_output"; event: PiboOutputEvent; session?: PiboSession }
	| { type: "session_created"; session: PiboSession }
	| { type: "session_disposed"; piboSessionId: string; reason?: string }
	| { type: "session_processing_changed"; piboSessionId: string; processing: boolean; queuedMessages: number }
	| { type: "run_changed"; run: PiboRunSnapshot; previousStatus?: PiboRunStatus; reason?: string }
	| { type: "run_removed"; runId: string; ownerPiboSessionId: string }
	| { type: "queue_changed"; piboSessionId: string; queuedMessages: number }
	| { type: "recovery"; piboSessionId: string; reason: string }
	| { type: string; [key: string]: unknown };

export type PiboSignalMutation =
	| { type: "upsert_node"; node: PiboSignalNode }
	| { type: "patch_node"; nodeId: string; patch: Partial<PiboSignalNode> }
	| { type: "remove_node"; nodeId: string }
	| { type: "link_parent"; nodeId: string; parentNodeId: string }
	| { type: "set_session_queue"; piboSessionId: string; queuedMessages: number };

export type PiboSignalProjectorContext = {
	now(): string;
	getNode(nodeId: string): PiboSignalNode | undefined;
	getSessionNodes(piboSessionId: string): PiboSignalNode[];
	getSessionRoot(piboSessionId: string): string;
	getSessionParent(piboSessionId: string): string | undefined;
};

export interface PiboSignalProducer {
	readonly name: string;
	accepts(input: PiboSignalInput): boolean;
	project(input: PiboSignalInput, context: PiboSignalProjectorContext): PiboSignalMutation[];
}

export type PiboSignalRegistryPruneOptions = {
	nowMs?: number;
	terminalSuccessTtlMs?: number;
	terminalErrorTtlMs?: number;
};

export type PiboSignalRegistryDiagnostics = {
	nodeCount: number;
	sessionCount: number;
	rootCount: number;
	subscriberCount: number;
	subscribersByRootId: Record<string, number>;
	stuckActiveNodes: PiboSignalNode[];
};

export interface PiboSignalRegistry {
	project(event: PiboSignalInput): PiboSignalPatch | undefined;
	snapshotSession(piboSessionId: string): PiboSignalSnapshot;
	snapshotTree(rootPiboSessionId: string): PiboSignalSnapshot;
	subscribe(rootPiboSessionId: string, listener: PiboSignalListener): () => void;
	registerProducer(producer: PiboSignalProducer): void;
	pruneTerminalNodes?(options?: PiboSignalRegistryPruneOptions): number;
	diagnostics?(options?: { stuckActiveMs?: number; nowMs?: number }): PiboSignalRegistryDiagnostics;
}
