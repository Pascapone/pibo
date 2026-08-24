import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionActivity } from "../dist/session-ui/sessionActivity.js";

function turn(state, overrides = {}) {
	return {
		nodeId: "turn:ps-1:event-1",
		eventId: "event-1",
		state,
		startedAt: "2026-07-15T10:00:00.000Z",
		updatedAt: "2026-07-15T10:00:05.000Z",
		...(state === "running" ? {} : { completedAt: "2026-07-15T10:00:10.000Z" }),
		...overrides,
	};
}

function signal(overrides = {}) {
	return {
		isTreeActive: false,
		localStatus: "idle",
		hasError: false,
		hasErrorDescendant: false,
		aggregateStatus: "idle",
		...overrides,
	};
}

test("running canonical turn drives both session status and Working", () => {
	const activity = resolveSessionActivity(signal({
		isTreeActive: true,
		aggregateStatus: "running",
		latestTurn: turn("running"),
	}));
	assert.equal(activity.status, "running");
	assert.equal(activity.isTreeActive, true);
	assert.equal(activity.isTurnActive, true);
	assert.equal(activity.activeTurnId, "event-1");
	assert.equal(activity.activeTurnStartedAt, "2026-07-15T10:00:00.000Z");
	assert.equal(activity.source, "signals");
});

test("a running turn keeps the session active if aggregate activity is momentarily false or the turn is long-lived", () => {
	const activity = resolveSessionActivity(signal({ latestTurn: turn("running", {
		startedAt: "2026-07-12T10:00:00.000Z",
		updatedAt: "2026-07-15T10:00:05.000Z",
	}) }));
	assert.equal(activity.status, "running");
	assert.equal(activity.isTreeActive, true);
	assert.equal(activity.isTurnActive, true);
	assert.equal(activity.activeTurnStartedAt, "2026-07-12T10:00:00.000Z");
});

test("every terminal turn state stops Working", () => {
	for (const state of ["completed", "failed", "cancelled", "interrupted"]) {
		const activity = resolveSessionActivity(signal({
			aggregateStatus: state === "failed" ? "error" : "idle",
			hasError: state === "failed",
			latestTurn: turn(state),
		}));
		assert.equal(activity.isTurnActive, false, state);
		assert.equal(activity.activeTurnStartedAt, undefined, state);
		assert.equal(activity.status, state === "failed" ? "error" : "idle", state);
	}
});

test("background tree activity keeps status running without showing local Working", () => {
	const activity = resolveSessionActivity(signal({
		isTreeActive: true,
		aggregateStatus: "running",
		latestTurn: turn("completed"),
	}));
	assert.equal(activity.status, "running");
	assert.equal(activity.isTreeActive, true);
	assert.equal(activity.isTurnActive, false);
});

test("active work outranks historical local and descendant errors", () => {
	const activity = resolveSessionActivity(signal({
		isTreeActive: true,
		localStatus: "error",
		aggregateStatus: "error",
		hasError: true,
		hasErrorDescendant: true,
		latestTurn: turn("running"),
	}));
	assert.equal(activity.status, "running");
	assert.equal(activity.isTurnActive, true);
});

test("historical errors do not poison a settled session after a successful turn", () => {
	const activity = resolveSessionActivity(signal({
		aggregateStatus: "error",
		hasError: true,
		hasErrorDescendant: true,
		latestTurn: turn("completed"),
	}));
	assert.equal(activity.status, "idle");
});

test("a terminal local session error remains visible without a turn summary", () => {
	const activity = resolveSessionActivity(signal({
		localStatus: "error",
		aggregateStatus: "error",
		hasError: true,
	}));
	assert.equal(activity.status, "error");
});

test("terminal signal state ignores stale trace fallback", () => {
	const activity = resolveSessionActivity(
		signal({ latestTurn: turn("completed") }),
		{ status: "running", turnStartedAt: "2026-07-15T09:59:00.000Z" },
	);
	assert.equal(activity.source, "signals");
	assert.equal(activity.status, "idle");
	assert.equal(activity.isTurnActive, false);
});

test("trace fallback is used only when no signal snapshot exists", () => {
	const active = resolveSessionActivity(undefined, {
		status: "running",
		turnStartedAt: "2026-07-15T10:00:00.000Z",
	});
	assert.equal(active.source, "fallback");
	assert.equal(active.isTurnActive, true);

	const statusOnly = resolveSessionActivity(undefined, { status: "running" });
	assert.equal(statusOnly.status, "running");
	assert.equal(statusOnly.isTurnActive, false);
});
