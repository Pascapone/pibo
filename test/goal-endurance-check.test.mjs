import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("accelerated Goal endurance check covers restart, timeout, lease, pause, budget, and cleanup", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-goal-endurance-test-"));
	const output = join(dir, "report.json");
	try {
		const result = await execFileAsync(process.execPath, [
			"scripts/goal-endurance-check.mjs",
			"--duration-hours", "24",
			"--turns", "72",
			"--output", output,
		], { cwd: process.cwd(), timeout: 30_000 });
		const summary = JSON.parse(result.stdout);
		const report = JSON.parse(await readFile(output, "utf8"));
		assert.equal(summary.passed, true);
		assert.equal(report.passed, true);
		assert.equal(report.mode, "accelerated");
		assert.equal(report.configuredDurationHours, 24);
		assert.equal(Object.values(report.checks).every(Boolean), true);
		assert.equal(report.variants.unbounded.sessionIds.length, 1);
		assert.equal(report.variants.unbounded.persistedSessionCount, 1);
		assert.equal(report.variants.unbounded.runs.interrupted, 1);
		assert.equal(report.variants.unbounded.runs.toolTimeout, 1);
		assert.equal(report.variants.unbounded.restart.mode, "store-reopen");
		assert.equal(report.variants.unbounded.restart.starts, 0);
		assert.equal(report.variants.unbounded.metrics.simulatedWallTimeSeconds, 24 * 60 * 60);
		assert.equal(Number.isFinite(report.variants.unbounded.metrics.elapsedWallClockSeconds), true);
		assert.equal(report.variants.budgetLimited.goalStatus, "budget_limited");
		assert.equal(report.browser.activeLeaseIdAfterRelease, undefined);
		assert.equal(report.browser.plannedReplacements, 1);
		assert.equal(report.browser.recoveryReacquisitions, 1);
		assert.equal(report.browser.replacements, 2);
		assert.equal(report.browser.reaped, true);
		assert.equal(report.browser.finalState, "empty");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
