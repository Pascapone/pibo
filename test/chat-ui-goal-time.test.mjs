import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Goal active time adds only the current run to persisted active time", async () => {
	const script = `
		const { goalActiveTimeSeconds } = await import("./src/apps/chat-ui/src/goal-time.ts");
		const goal = (state) => ({ state });
		const nowMs = Date.parse("2026-08-10T10:05:57.000Z");
		console.log(JSON.stringify([
			goalActiveTimeSeconds(goal({ activeTimeSeconds: 125, runningAt: "2026-08-10T10:04:00.000Z" }), nowMs),
			goalActiveTimeSeconds(goal({ activeTimeSeconds: 125 }), nowMs),
			goalActiveTimeSeconds(goal({ timeUsedSeconds: 7.9 }), nowMs),
			goalActiveTimeSeconds(goal({ activeTimeSeconds: 125, runningAt: "2026-08-10T10:10:00.000Z" }), nowMs),
		]));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	assert.deepEqual(JSON.parse(stdout), [242, 125, 7, 125]);
});
