import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
	return readFile(new URL(path, root), "utf8");
}

test("core routing imports only generic child and yielded-run orchestration contracts", async () => {
	const router = await source("src/core/session-router.ts");
	for (const forbidden of [
		'../subagents/controller.js',
		'../subagents/tool.js',
		'../subagents/observations.js',
		'../subagents/observation-query.js',
		'../runs/controller.js',
		'../runs/tools.js',
		'../runs/reminders.js',
		'PIBO_DELEGATION_SEND_TOOL_NAME',
		'formatPiboRunReminderMessage',
		'isPiboRunReminderServiceMessage',
	]) {
		assert.equal(router.includes(forbidden), false, `core router must not depend on ${forbidden}`);
	}
	assert.match(router, /PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE/);
	assert.match(router, /PIBO_SESSION_YIELDED_RUNS_SERVICE/);
});

test("run and delegation packages own controller and reminder construction", async () => {
	const packaged = [
		await source("src/plugins/packaged-run-control.ts"),
		await source("src/plugins/packaged-goal-loops.ts"),
		await source("src/plugins/packaged-agent-delegation.ts"),
	].join("\n");
	const delegation = await source("src/subagents/controller.ts");
	assert.match(packaged, /createPiboDelegationController\(providerContext\.services/);
	assert.match(packaged, /formatPiboRunReminderMessage/);
	assert.match(packaged, /isPiboRunReminderServiceMessage/);
	assert.match(delegation, /subagentToolName: PIBO_DELEGATION_SEND_TOOL_NAME/);
	assert.match(delegation, /readChildOutputs/);
});

test("portable tool sessions expose no legacy feature-controller injection surface", async () => {
	const service = await source("src/tools/session-service.ts");
	for (const forbidden of [
		"PiboPortableToolSessionControllers",
		"agentsController",
		"subagentRunner",
		"runToolController",
		"runtimeToolController",
		"codexBrowserController",
		"configureControllers",
	]) {
		assert.equal(service.includes(forbidden), false, `portable session must not retain ${forbidden}`);
	}
});
