import assert from "node:assert/strict";
import test from "node:test";
import {
	EMPTY_STABLE_ACTIVE_TURN,
	findLatestActiveTurnTerminal,
	findSignalActiveTurnStartedAt,
	findSignalActiveTurnTerminal,
	resolveStableActiveTurn,
} from "../dist/session-ui/activeTurn.js";

function terminal(key, at) {
	return { key, at };
}

function trace(rawEvents, nodes = []) {
	return {
		piboSessionId: "ps-turn",
		piSessionId: "pi-turn",
		title: "Turn",
		version: "1",
		nodes,
		rawEvents,
	};
}

function event(sequence, type, createdAt, payload = {}) {
	return {
		id: `event-${sequence}`,
		piboSessionId: "ps-turn",
		eventSequence: sequence,
		type,
		createdAt,
		payload: { type, piboSessionId: "ps-turn", ...payload },
	};
}

test("stable active turn survives temporary trace and signal gaps", () => {
	const startedAt = "2026-07-15T07:00:00.000Z";
	const active = resolveStableActiveTurn(EMPTY_STABLE_ACTIVE_TURN, {
		sessionId: "ps-turn",
		startedAt,
		activeEvidence: true,
	});
	assert.deepEqual(active, {
		sessionId: "ps-turn",
		active: true,
		startedAt,
		terminalBaselineKey: undefined,
	});

	const traceGap = resolveStableActiveTurn(active, {
		sessionId: "ps-turn",
		activeEvidence: true,
	});
	assert.equal(traceGap, active, "dropping message_started from the trace page must preserve the timer origin");

	const signalGap = resolveStableActiveTurn(traceGap, {
		sessionId: "ps-turn",
		activeEvidence: false,
	});
	assert.equal(signalGap, active, "temporary loss of every activity signal must not hide Working");
});

test("stable active turn stops only on explicit success, error, or abort terminals", () => {
	const startedAt = "2026-07-15T07:00:00.000Z";
	for (const [kind, turnTerminal] of [
		["success", terminal("message_finished:2", "2026-07-15T07:00:10.000Z")],
		["error", terminal("session_error:2", "2026-07-15T07:00:10.000Z")],
		["abort", terminal("execution_result:2", "2026-07-15T07:00:10.000Z")],
	]) {
		const active = resolveStableActiveTurn(EMPTY_STABLE_ACTIVE_TURN, {
			sessionId: `ps-${kind}`,
			startedAt,
			activeEvidence: true,
		});
		const stopped = resolveStableActiveTurn(active, {
			sessionId: `ps-${kind}`,
			activeEvidence: false,
			terminal: turnTerminal,
		});
		assert.equal(stopped.active, false, `${kind} must stop Working`);
		assert.equal(stopped.endedByTerminalKey, turnTerminal.key);

		const staleRunningStatus = resolveStableActiveTurn(stopped, {
			sessionId: `ps-${kind}`,
			activeEvidence: true,
			terminal: turnTerminal,
		});
		assert.equal(staleRunningStatus.active, false, `${kind} must not be undone by stale running evidence`);
	}
});

test("a later turn starts after the prior terminal without inheriting its stopped state", () => {
	const ended = {
		sessionId: "ps-turn",
		active: false,
		endedByTerminalKey: "message_finished:2",
	};
	const next = resolveStableActiveTurn(ended, {
		sessionId: "ps-turn",
		startedAt: "2026-07-15T07:01:00.000Z",
		activeEvidence: true,
		terminal: terminal("message_finished:2", "2026-07-15T07:00:10.000Z"),
	});
	assert.equal(next.active, true);
	assert.equal(next.startedAt, "2026-07-15T07:01:00.000Z");
});

test("a terminal newer than a stale observed start wins immediately", () => {
	const stopped = resolveStableActiveTurn(EMPTY_STABLE_ACTIVE_TURN, {
		sessionId: "ps-turn",
		startedAt: "2026-07-15T07:00:00.000Z",
		activeEvidence: true,
		terminal: terminal("message_finished:2", "2026-07-15T07:00:10.000Z"),
	});
	assert.equal(stopped.active, false);
});

test("signal tree preserves the timer origin after message_started leaves the trace page", () => {
	const startedAt = "2026-07-15T07:00:00.000Z";
	const sessionSignal = {
		piboSessionId: "ps-turn",
		rootPiboSessionId: "ps-turn",
		version: 5,
		updatedAt: "2026-07-15T07:00:05.000Z",
		localStatus: "running",
		aggregateStatus: "running",
		queuedMessages: 0,
		currentTurnId: "turn:ps-turn:message-1",
		isLocalActive: true,
		hasActiveDescendant: false,
		isTreeActive: true,
		isSettled: false,
		hasError: false,
		hasErrorDescendant: false,
		hasBlockedDescendant: false,
		activeToolCalls: [],
		activeRuns: [],
		activeChildren: [],
		errors: [],
	};
	const signalTree = {
		rootPiboSessionId: "ps-turn",
		version: 5,
		generatedAt: "2026-07-15T07:00:05.000Z",
		sessions: { "ps-turn": sessionSignal },
		nodes: {
			"turn:ps-turn:message-1": {
				id: "turn:ps-turn:message-1",
				kind: "turn",
				status: "running",
				rootPiboSessionId: "ps-turn",
				piboSessionId: "ps-turn",
				createdAt: startedAt,
				startedAt,
				updatedAt: "2026-07-15T07:00:05.000Z",
			},
		},
	};
	assert.equal(findSignalActiveTurnStartedAt(sessionSignal, signalTree), startedAt);
});

test("terminal signal states stop a turn but transient idle states do not", () => {
	const base = {
		piboSessionId: "ps-turn",
		rootPiboSessionId: "ps-turn",
		version: 6,
		updatedAt: "2026-07-15T07:00:10.000Z",
		queuedMessages: 0,
		isLocalActive: false,
		hasActiveDescendant: false,
		isTreeActive: false,
		isSettled: true,
		hasError: false,
		hasErrorDescendant: false,
		hasBlockedDescendant: false,
		activeToolCalls: [],
		activeRuns: [],
		activeChildren: [],
		errors: [],
	};
	assert.equal(findSignalActiveTurnTerminal({ ...base, localStatus: "idle", aggregateStatus: "idle" }), undefined);
	assert.deepEqual(
		findSignalActiveTurnTerminal({ ...base, localStatus: "interrupted", aggregateStatus: "interrupted" }),
		terminal("signal:interrupted:2026-07-15T07:00:10.000Z", "2026-07-15T07:00:10.000Z"),
	);
});

test("latest terminal extraction recognizes successful, failed, and aborted turns", () => {
	const success = findLatestActiveTurnTerminal(trace([
		event(1, "message_started", "2026-07-15T07:00:00.000Z", { eventId: "turn-1" }),
		event(2, "message_finished", "2026-07-15T07:00:10.000Z", { eventId: "turn-1" }),
	]));
	assert.deepEqual(success, terminal("message_finished:2", "2026-07-15T07:00:10.000Z"));

	const failed = findLatestActiveTurnTerminal(trace([
		event(3, "session_error", "2026-07-15T07:00:20.000Z", { eventId: "turn-2", error: "boom" }),
	]));
	assert.deepEqual(failed, terminal("session_error:3", "2026-07-15T07:00:20.000Z"));

	const aborted = findLatestActiveTurnTerminal(trace([
		event(4, "execution_result", "2026-07-15T07:00:30.000Z", { action: "abort", result: { aborted: true } }),
	]));
	assert.deepEqual(aborted, terminal("execution_result:4", "2026-07-15T07:00:30.000Z"));

	const compactTrace = findLatestActiveTurnTerminal(trace([], [{
		id: "turn-node",
		piboSessionId: "ps-turn",
		type: "agent.turn",
		title: "Agent Turn",
		status: "done",
		completedAt: "2026-07-15T07:00:40.000Z",
		children: [],
	}]));
	assert.deepEqual(compactTrace, terminal("node:turn-node:done", "2026-07-15T07:00:40.000Z"));
});
