import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const renderScript = `
	import React from "react";
	globalThis.React = React;
	import { renderToStaticMarkup } from "react-dom/server";
	const { SessionGoalIndicatorView } = await import("./src/apps/chat-ui/src/session-goal-indicator.tsx");
	const goal = JSON.parse(process.env.TEST_GOAL);
	const nowMs = Number(process.env.TEST_NOW_MS);
	console.log(renderToStaticMarkup(React.createElement(SessionGoalIndicatorView, { goal, nowMs })));
`;

function goal(status, { tokenBudget, tokensUsed = 254_600, usage } = {}) {
	return {
		id: "loop_goal",
		mode: "goal",
		name: "Ship the feature",
		enabled: status === "active",
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Implement and verify the requested feature",
		...(tokenBudget === undefined ? {} : { tokenBudget }),
		state: {
			goalStatus: status,
			goalStartedAt: "2026-08-10T10:00:00.000Z",
			tokenAccounting: { version: 1, basis: "uncached" },
			tokensUsed,
			...(usage === undefined ? {} : { usage }),
		},
		createdAt: "2026-08-10T10:00:00.000Z",
		updatedAt: "2026-08-10T10:05:57.000Z",
	};
}

async function render(goalValue) {
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", renderScript], {
		cwd: process.cwd(),
		env: {
			...process.env,
			TEST_GOAL: JSON.stringify(goalValue),
			TEST_NOW_MS: String(Date.parse("2026-08-10T10:05:57.000Z")),
		},
	});
	return stdout;
}

test("session Goal indicator shows active Goals with screenshot-style elapsed time", async () => {
	const markup = await render(goal("active"));
	assert.match(markup, /data-pibo-debug="session-goal-indicator"/);
	assert.match(markup, /data-goal-status="active"/);
	assert.match(markup, /Pursuing Goal:/);
	assert.match(markup, />5:57</);
	assert.match(markup, />254\.6k</);
	assert.match(markup, /aria-label="Pursuing Goal\. Elapsed 5:57\. Tokens 254\.6k"/);
});

test("session Goal indicator shows compact token usage and budget with one decimal place", async () => {
	const markup = await render(goal("active", { tokenBudget: 12_300_000 }));
	assert.match(markup, />254\.6k \/ 12\.3M</);
});

test("session Goal indicator preserves a trailing decimal zero", async () => {
	const markup = await render(goal("active", { tokensUsed: 1_000, tokenBudget: 1_000_000 }));
	assert.match(markup, />1\.0k \/ 1\.0M</);
});

test("session Goal indicator uses the corrected uncached counter instead of cached-input totals", async () => {
	const usage = {
		controller: { inputTokens: 9_000, outputTokens: 7_000, cacheReadTokens: 4_000, cacheWriteTokens: 2_000, reasoningTokens: 0, totalTokens: 22_000, costUsd: 0, costReportedTurns: 1, assistantTurns: 1 },
		descendants: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0, costReportedTurns: 0, assistantTurns: 0 },
		total: { inputTokens: 9_000, outputTokens: 7_000, cacheReadTokens: 4_000, cacheWriteTokens: 2_000, reasoningTokens: 0, totalTokens: 22_000, costUsd: 0, costReportedTurns: 1, assistantTurns: 1 },
		sessionIds: ["ps_goal"],
	};
	const markup = await render(goal("active", { tokensUsed: 16_000, tokenBudget: 100_000, usage }));
	assert.match(markup, />16\.0k \/ 100\.0k</);
	assert.doesNotMatch(markup, />22\.0k \/ 100\.0k</);
});

test("session Goal indicator remains visible while the Goal is paused", async () => {
	const markup = await render(goal("paused"));
	assert.match(markup, /data-goal-status="paused"/);
	assert.match(markup, /Goal Paused:/);
	assert.match(markup, />5:57</);
	assert.match(markup, /aria-label="Goal Paused\. Elapsed 5:57"/);
	assert.doesNotMatch(markup, /Tokens 254\.6k/);
});

test("session Goal indicator hides terminal Goals", async () => {
	for (const status of ["complete", "blocked", "budget_limited"]) {
		assert.equal((await render(goal(status))).trim(), "");
	}
});
