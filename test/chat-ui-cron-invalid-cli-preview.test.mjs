import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/apps/chat-ui/src/CronArea.tsx", "utf8");

test("invalid Cron schedules do not expose a fallback daily CLI command", () => {
	assert.doesNotMatch(source, /schedulePreview\.kind === "cron" \? schedulePreview\.value : "0 8 \* \* \*"/);
	assert.match(source, /schedulePreview\.kind === "cron"[\s\S]*pibo cron add --cron "\{schedulePreview\.value\}"/);
	assert.match(source, /schedulePreview\.kind === "error"[\s\S]*Fix the invalid schedule to generate the matching CLI command\./);
});
