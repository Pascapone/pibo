import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { normalizeAssistantUsageEvent } from "../dist/core/routed-session.js";
import { goalActiveTimeSeconds, goalBudgetTokens, goalElapsedWallClockSeconds } from "../dist/loops/accounting.js";
import { buildLoopTurnPrompt } from "../dist/loops/prompts.js";
import { getEffectiveLoopStopPolicy } from "../dist/loops/stopping.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createPiboGoalToolDefinitions } from "../dist/loops/tools.js";
import { listLoopJobTemplates } from "../dist/loops/templates.js";

function toolsByName(store, context = { piboSessionId: "ps_goal", piboRoomId: "room_goal", profileName: "goal-agent" }) {
	return Object.fromEntries(createPiboGoalToolDefinitions(context, { store }).map((tool) => [tool.name, tool]));
}

function details(result) {
	assert.equal(result.isError, undefined, result.content?.[0]?.text);
	return result.details;
}

test("assistant model usage is normalized for Goal token accounting", () => {
	assert.deepEqual(normalizeAssistantUsageEvent("ps_usage", { usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20 } }), {
		type: "assistant_usage",
		piboSessionId: "ps_usage",
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 3,
		cacheWriteTokens: 2,
		totalTokens: 20,
	});
	assert.equal(normalizeAssistantUsageEvent("ps_usage", { usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 } })?.totalTokens, 20);
	assert.equal(normalizeAssistantUsageEvent("ps_usage", { usage: {} }), undefined);
});

test("Goal budget token accounting excludes cache reads and writes", () => {
	assert.equal(goalBudgetTokens({ type: "assistant_usage", piboSessionId: "ps_usage", totalTokens: 20, inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 }), 15);
	assert.equal(goalBudgetTokens({ type: "assistant_usage", piboSessionId: "ps_usage", totalTokens: 10 }), 10);
	assert.equal(goalBudgetTokens({ type: "assistant_usage", piboSessionId: "ps_usage", totalTokens: 4, cacheReadTokens: 5 }), 0);
});

test("goal tool package is enabled by default or disabled as one profile capability", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-goal-profile-"));
	try {
		for (const [enabled, expected] of [[undefined, true], [true, true], [false, false]]) {
			const builder = new InitialSessionContextBuilder(`goal-${enabled}`);
			const profile = enabled === undefined ? builder.createSession() : builder.withToolPackages({ goalControl: enabled }).createSession();
			const inspection = await inspectPiboProfile({ cwd, profile, persistSession: false, modelDefaults: {}, sessionContext: { piboSessionId: `ps_${enabled}`, piboRoomId: "room_goal" } });
			const active = new Set(inspection.tools.filter((tool) => tool.active).map((tool) => tool.name));
			for (const name of ["get_goal", "create_goal", "update_goal"]) assert.equal(active.has(name), expected, `${name} enabled=${enabled}`);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("native goal tools create, inspect, complete, and replace a session goal", async () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const tools = toolsByName(store);
		const created = details(await tools.create_goal.execute("call_create", { objective: "Ship the complete feature", token_budget: 1000, token_reserve: 100 }));
		assert.equal(created.goal.status, "active");
		assert.equal(created.goal.budgetType, "soft");
		assert.equal(created.goal.tokenBudget, 1000);
		assert.equal(created.goal.tokenReserve, 100);
		assert.equal(created.goal.tokensUsed, 0);
		assert.equal(created.goal.canStartNextTurn, true);
		assert.equal(created.goal.wallClockIncludesPausedTime, true);

		const job = store.getJob(created.goal.goalId);
		assert.equal(job.mode, "goal");
		assert.equal(job.profile, "goal-agent");
		assert.equal(job.target.roomId, "room_goal");
		assert.equal(job.state.lastPiboSessionId, "ps_goal");

		const duplicate = await tools.create_goal.execute("call_duplicate", { objective: "A second unfinished goal" });
		assert.equal(duplicate.isError, true);
		assert.match(duplicate.content[0].text, /unfinished goal/);

		store.recordGoalProgress(job.id, { tokens: 240, activeTimeSeconds: 12 });
		const inspected = details(await tools.get_goal.execute("call_get", {}));
		assert.equal(inspected.goal.tokensUsed, 240);
		assert.equal(inspected.goal.remainingTokens, 760);
		assert.equal(inspected.goal.activeAgentTimeSeconds, 12);
		assert.equal(typeof inspected.goal.elapsedWallClockSeconds, "number");

		const completed = details(await tools.update_goal.execute("call_complete", { status: "complete" }));
		assert.equal(completed.goal.status, "complete");
		assert.equal(store.getJob(job.id).enabled, false);
		assert.throws(() => store.updateJob(job.id, { enabled: true }), /Completed goals cannot be restarted/);

		const replacement = details(await tools.create_goal.execute("call_replace", { objective: "Follow-up objective" }));
		assert.notEqual(replacement.goal.goalId, job.id);
		assert.equal(replacement.goal.status, "active");
	} finally {
		store.close();
	}
});

test("token budgets are limited to Goal mode", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		assert.throws(() => store.createJob({ mode: "ralph", target: { kind: "default-chat" }, profile: "base", prompt: "legacy", tokenBudget: 100 }), /only available for goal mode/);
		assert.throws(() => store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "invalid reserve", tokenReserve: 10 }), /requires tokenBudget/);
	} finally {
		store.close();
	}
});

test("goal token accounting marks the goal budget limited", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const job = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "bounded objective", tokenBudget: 100 });
		store.recordGoalProgress(job.id, { tokens: 40, activeTimeSeconds: 2 });
		assert.equal(store.getJob(job.id).state.goalStatus, "active");
		store.recordGoalProgress(job.id, { tokens: 70, activeTimeSeconds: 3 });
		const limited = store.getJob(job.id);
		assert.equal(limited.state.goalStatus, "budget_limited");
		assert.equal(limited.state.tokensUsed, 110);
		assert.equal(limited.state.activeTimeSeconds, 5);
		assert.equal(limited.enabled, false);
		assert.throws(() => store.updateJob(job.id, { enabled: true }), /Increase or clear the token budget/);
		const resumed = store.updateJob(job.id, { tokenBudget: 200, enabled: true });
		assert.equal(resumed.state.goalStatus, "active");
		assert.equal(resumed.enabled, true);
	} finally {
		store.close();
	}
});

test("Goal reserve gates the next turn before the soft budget is exhausted", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const job = store.createJob({ mode: "goal", enabled: true, target: { kind: "default-chat" }, profile: "base", prompt: "bounded objective", tokenBudget: 100, tokenReserve: 20 });
		store.recordGoalProgress(job.id, { tokens: 80 });
		assert.equal(store.reserveRun(job.id), undefined);
		const limited = store.getJob(job.id);
		assert.equal(limited.state.goalStatus, "budget_limited");
		assert.equal(limited.enabled, false);
	} finally {
		store.close();
	}
});

test("Goal wall-clock elapsed time starts on first activation and includes paused time", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const createdAt = new Date("2026-08-04T10:00:00.000Z");
		const startedAt = new Date("2026-08-04T11:00:00.000Z");
		const pausedAt = new Date("2026-08-04T11:30:00.000Z");
		const inspectedAt = new Date("2026-08-04T13:00:00.000Z");
		const afterCompletion = new Date("2026-08-04T15:00:00.000Z");
		const job = store.createJob({ mode: "goal", target: { kind: "default-chat" }, profile: "base", prompt: "timed objective" }, createdAt);
		assert.equal(goalElapsedWallClockSeconds(job, inspectedAt), 0);
		const started = store.updateJob(job.id, { enabled: true }, startedAt);
		store.recordGoalProgress(job.id, { activeTimeSeconds: 90 }, pausedAt);
		const paused = store.requestStop(job.id, pausedAt);
		assert.equal(started.state.goalStartedAt, startedAt.toISOString());
		assert.equal(goalActiveTimeSeconds(paused), 90);
		assert.equal(goalElapsedWallClockSeconds(paused, inspectedAt), 7200);
		const completed = store.updateGoalStatus(job.id, "complete", inspectedAt);
		assert.equal(goalElapsedWallClockSeconds(completed, afterCompletion), 7200);
	} finally {
		store.close();
	}
});

test("Goal prompting uses native status tooling while Ralph retains the completion marker", () => {
	const goal = {
		id: "loop_goal",
		mode: "goal",
		name: "Goal",
		enabled: true,
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Finish everything",
		tokenBudget: 500,
		tokenReserve: 50,
		state: { goalStatus: "active", tokensUsed: 125, activeTimeSeconds: 4 },
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	const prompt = buildLoopTurnPrompt(goal, true, true);
	assert.match(prompt, /call update_goal with status "complete"/);
	assert.match(prompt, /three consecutive goal turns/);
	assert.match(prompt, /Budget enforcement: soft/);
	assert.match(prompt, /Pre-turn uncached token reserve: 50/);
	assert.match(prompt, /Reported uncached tokens remaining before this turn: 375/);
	assert.doesNotMatch(prompt, /opening tag <promise>/);
	assert.equal(getEffectiveLoopStopPolicy(goal).conditions.some((condition) => condition.type === "pibo.loop.goal-status"), true);
	assert.equal(listLoopJobTemplates().find((template) => template.id === "goal-objective").job.stopPolicy.conditions[0].type, "pibo.loop.goal-status");

	const disabledPrompt = buildLoopTurnPrompt(goal, true, false);
	assert.match(disabledPrompt, /Goal lifecycle tools are disabled/);
	assert.doesNotMatch(disabledPrompt, /call update_goal with status "complete"/);

	const ralph = { ...goal, id: "ralph_goal", mode: "ralph", state: { completedIterations: 0 } };
	const ralphPrompt = buildLoopTurnPrompt(ralph, false);
	assert.match(ralphPrompt, /opening tag <promise>/);
	assert.equal(getEffectiveLoopStopPolicy(ralph).conditions.some((condition) => condition.type === "pibo.loop.promise-complete"), true);
});
