import type { PiboSessionTraceView } from "../shared/trace-types.js";

type ActiveTurnSignalSession = {
	piboSessionId: string;
	updatedAt: string;
	localStatus: string;
	aggregateStatus: string;
	currentTurnId?: string;
	isTreeActive: boolean;
};

type ActiveTurnSignalTree = {
	nodes: Record<string, {
		kind: string;
		status: string;
		piboSessionId?: string;
		createdAt: string;
		startedAt?: string;
	}>;
};

export type ActiveTurnTerminal = {
	key: string;
	at: string;
};

export type StableActiveTurnState = {
	sessionId?: string;
	active: boolean;
	startedAt?: string;
	terminalBaselineKey?: string;
	endedByTerminalKey?: string;
};

export type ActiveTurnObservation = {
	sessionId?: string;
	startedAt?: string;
	activeEvidence: boolean;
	terminal?: ActiveTurnTerminal;
};

export const EMPTY_STABLE_ACTIVE_TURN: StableActiveTurnState = { active: false };

export function resolveStableActiveTurn(
	previous: StableActiveTurnState,
	observation: ActiveTurnObservation,
): StableActiveTurnState {
	const sessionId = observation.sessionId ?? previous.sessionId;
	const sameSession = !previous.sessionId || !sessionId || previous.sessionId === sessionId;
	const current = sameSession ? previous : { active: false, sessionId };
	const terminalKey = observation.terminal?.key;
	const observedStartedAt = validTimestamp(observation.startedAt) ? observation.startedAt : undefined;

	if (observedStartedAt && terminalClosesTurn(observation.terminal, observedStartedAt)) {
		return inactiveState(current, sessionId, terminalKey);
	}

	if (observedStartedAt) {
		if (
			current.active &&
			current.sessionId === sessionId &&
			current.startedAt === observedStartedAt &&
			current.terminalBaselineKey === terminalKey
		) return current;
		return {
			sessionId,
			active: true,
			startedAt: observedStartedAt,
			terminalBaselineKey: terminalKey,
		};
	}

	if (current.active) {
		if (terminalKey && terminalKey !== current.terminalBaselineKey) {
			return inactiveState(current, sessionId, terminalKey);
		}
		return current;
	}

	if (observation.activeEvidence && terminalKey !== current.endedByTerminalKey) {
		return {
			sessionId,
			active: true,
			terminalBaselineKey: terminalKey,
		};
	}

	if (current.sessionId === sessionId) return current;
	return { ...current, sessionId };
}

export function findLatestActiveTurnTerminal(traceView: PiboSessionTraceView | null): ActiveTurnTerminal | undefined {
	if (!traceView) return undefined;
	let latest: ActiveTurnTerminal | undefined;
	for (const event of traceView.rawEvents) {
		const payload = record(event.payload);
		const type = typeof payload?.type === "string" ? payload.type : event.type;
		const isTerminal = type === "message_finished" || type === "session_error" ||
			(type === "execution_result" && isTurnStoppingAction(payload?.action));
		if (!isTerminal) continue;
		latest = latestActiveTurnTerminal(latest, {
			key: `${type}:${event.eventSequence ?? event.streamId ?? event.id}`,
			at: event.createdAt,
		});
	}
	for (const node of flattenTraceNodes(traceView.nodes)) {
		const terminalAt = node.type === "agent.turn" ? node.completedAt : node.type === "error" ? node.completedAt ?? node.startedAt : undefined;
		if (!terminalAt) continue;
		latest = latestActiveTurnTerminal(latest, { key: `node:${node.id}:${node.status}`, at: terminalAt });
	}
	return latest;
}

export function findSignalActiveTurnStartedAt(
	sessionSignal: ActiveTurnSignalSession | undefined,
	signalTree: ActiveTurnSignalTree | undefined,
): string | undefined {
	if (!sessionSignal?.isTreeActive || !signalTree) return undefined;
	const currentTurn = sessionSignal.currentTurnId ? signalTree.nodes[sessionSignal.currentTurnId] : undefined;
	if (currentTurn?.startedAt) return currentTurn.startedAt;
	return Object.values(signalTree.nodes)
		.filter((node) => node.piboSessionId === sessionSignal.piboSessionId && node.kind === "turn" && isActiveSignalStatus(node.status) && node.startedAt)
		.sort((left, right) => Date.parse(left.startedAt ?? left.createdAt) - Date.parse(right.startedAt ?? right.createdAt))
		.at(-1)?.startedAt;
}

export function findSignalActiveTurnTerminal(sessionSignal: ActiveTurnSignalSession | undefined): ActiveTurnTerminal | undefined {
	if (!sessionSignal || sessionSignal.isTreeActive) return undefined;
	const status = [sessionSignal.localStatus, sessionSignal.aggregateStatus].find(isTerminalSignalStatus);
	return status ? { key: `signal:${status}:${sessionSignal.updatedAt}`, at: sessionSignal.updatedAt } : undefined;
}

export function latestActiveTurnTerminal(
	left: ActiveTurnTerminal | undefined,
	right: ActiveTurnTerminal | undefined,
): ActiveTurnTerminal | undefined {
	if (!left) return right;
	if (!right) return left;
	return Date.parse(right.at) >= Date.parse(left.at) ? right : left;
}

function flattenTraceNodes(nodes: PiboSessionTraceView["nodes"]): PiboSessionTraceView["nodes"] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children)]);
}

function inactiveState(
	current: StableActiveTurnState,
	sessionId: string | undefined,
	terminalKey: string | undefined,
): StableActiveTurnState {
	if (
		!current.active &&
		current.sessionId === sessionId &&
		current.endedByTerminalKey === terminalKey
	) return current;
	return {
		sessionId,
		active: false,
		endedByTerminalKey: terminalKey,
	};
}

function terminalClosesTurn(terminal: ActiveTurnTerminal | undefined, startedAt: string): boolean {
	if (!terminal) return false;
	const terminalMs = Date.parse(terminal.at);
	const startedMs = Date.parse(startedAt);
	return Number.isFinite(terminalMs) && Number.isFinite(startedMs) && terminalMs >= startedMs;
}

function isTurnStoppingAction(value: unknown): boolean {
	return value === "abort" || value === "kill" || value === "kill_all" || value === "dispose";
}

function isActiveSignalStatus(status: string): boolean {
	return status === "queued" || status === "starting" || status === "running" || status === "streaming" || status === "compacting" || status === "blocked" || status === "paused";
}

function isTerminalSignalStatus(status: string): boolean {
	return status === "error" || status === "failed" || status === "cancelled" || status === "interrupted" || status === "disposed";
}

function validTimestamp(value: string | undefined): value is string {
	return Boolean(value && Number.isFinite(Date.parse(value)));
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
