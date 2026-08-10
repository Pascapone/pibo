import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { createPiboLoopPlugin, parsePiboSessionGoalCommand } from "../dist/loops/plugin.js";
import { PiboLoopService } from "../dist/loops/service.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import { createPiboSession } from "../dist/sessions/store.js";

function goalEvent(command) {
	return {
		type: "execution",
		piboSessionId: "ps_goal_command",
		action: "goal",
		params: { command },
	};
}

function createHarness() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-goal-command-"));
	const dataStorePath = join(dir, "pibo.sqlite");
	const dataStore = new PiboDataStore(dataStorePath, { payloadRootDir: join(dir, "payloads") });
	const room = new ChatRoomService(dataStore).createRoom({ id: "room_goal_command", name: "Goal command room" });
	dataStore.close();
	const session = createPiboSession({
		id: "ps_goal_command",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "goal-profile",
		metadata: { chatRoomId: room.id },
	});
	const store = new PiboLoopStore({ path: ":memory:" });
	const service = new PiboLoopService({
		store,
		dataStorePath,
		dataPayloadRootDir: join(dir, "payloads"),
		context: {
			getSession(id) { return id === session.id ? session : undefined; },
			findSessions() { return []; },
			createSession() { throw new Error("not used"); },
			emit() { throw new Error("not used"); },
			subscribe() { return () => {}; },
			getGatewayActions() { return []; },
			getWebApps() { return []; },
		},
	});
	return {
		dir,
		service,
		store,
		session,
		close() {
			service.stop();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

test("Goal slash command parser distinguishes objectives, pause, resume, and missing arguments", () => {
	assert.deepEqual(parsePiboSessionGoalCommand(goalEvent("Ship the feature")), { operation: "set", objective: "Ship the feature" });
	assert.deepEqual(parsePiboSessionGoalCommand(goalEvent(" PAUSE ")), { operation: "pause" });
	assert.deepEqual(parsePiboSessionGoalCommand(goalEvent("Resume")), { operation: "resume" });
	assert.throws(() => parsePiboSessionGoalCommand(goalEvent("   ")), /Usage: \/goal/);
});

test("Loop plugin advertises the session Goal slash command", () => {
	const registry = PiboPluginRegistry.create({ plugins: [createPiboLoopPlugin({ loopStorePath: ":memory:" })] });
	assert.deepEqual(registry.getGatewayActionInfos(), [{
		name: "goal",
		description: "Create or update the session Goal Loop. Use /goal pause or /goal resume to control it.",
		slashCommands: ["goal"],
	}]);
});

test("session Goal command creates one Loop and updates that Loop in place", () => {
	const harness = createHarness();
	try {
		const created = harness.service.setSessionGoal(harness.session.id, "Ship the first objective");
		assert.equal(created.operation, "created");
		assert.equal(created.goal.profile, "goal-profile");
		assert.deepEqual(created.goal.target, { kind: "room", roomId: "room_goal_command" });
		assert.equal(created.goal.state.lastPiboSessionId, harness.session.id);
		assert.equal(created.goal.state.goalStatus, "active");

		const updated = harness.service.setSessionGoal(harness.session.id, "Ship the revised objective");
		assert.equal(updated.operation, "updated");
		assert.equal(updated.goal.id, created.goal.id);
		assert.equal(updated.goal.prompt, "Ship the revised objective");
		assert.equal(updated.goal.name, "Ship the revised objective");
		assert.equal(harness.store.listGoalsForSession(harness.session.id).length, 1);
	} finally {
		harness.close();
	}
});

test("session Goal pause is graceful and resume continues the same Loop", () => {
	const harness = createHarness();
	try {
		const created = harness.service.setSessionGoal(harness.session.id, "Keep working").goal;
		const reserved = harness.store.reserveRun(created.id, new Date("2026-08-10T10:00:00.000Z"));
		assert.ok(reserved);

		const paused = harness.service.pauseSessionGoal(harness.session.id);
		assert.equal(paused.operation, "paused");
		assert.equal(paused.goal.id, created.id);
		assert.equal(paused.goal.enabled, false);
		assert.equal(paused.goal.state.goalStatus, "paused");
		assert.equal(paused.goal.state.cancelRequestedAt, undefined);
		assert.equal(harness.store.getRun(reserved.run.id).status, "running");

		const resumed = harness.service.resumeSessionGoal(harness.session.id);
		assert.equal(resumed.operation, "resumed");
		assert.equal(resumed.goal.id, created.id);
		assert.equal(resumed.goal.enabled, true);
		assert.equal(resumed.goal.state.goalStatus, "active");
		assert.equal(resumed.goal.state.lastRunId, reserved.run.id);
		assert.equal(harness.store.listGoalsForSession(harness.session.id).length, 1);
	} finally {
		harness.close();
	}
});

test("session Goal pause and resume reject sessions without a Loop", () => {
	const harness = createHarness();
	try {
		assert.throws(() => harness.service.pauseSessionGoal(harness.session.id), /has no Goal Loop/);
		assert.throws(() => harness.service.resumeSessionGoal(harness.session.id), /has no Goal Loop/);
	} finally {
		harness.close();
	}
});
