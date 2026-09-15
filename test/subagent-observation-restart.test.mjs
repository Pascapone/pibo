import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE } from "../dist/plugins/runtime.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { createPiboDelegationController } from "../dist/subagents/controller.js";

function createAgentsController(router, parentPiboSessionId) {
	const orchestration = router.createChildOrchestrationService();
	return createPiboDelegationController({
		require(serviceId) {
			assert.equal(serviceId, PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE);
			return orchestration;
		},
	}, parentPiboSessionId);
}

test("delegated observation cursors remain monotonic across router restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-subagent-observe-restart-"));
	const dbPath = join(root, "pibo.sqlite");
	const parentId = "ps_observe_parent";
	const childId = "ps_observe_child";
	let firstStore = new PiboDataSessionStore(dbPath);
	firstStore.create({ id: parentId, channel: "pibo.test", kind: "chat", profile: "base" });
	firstStore.create({
		id: childId,
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId,
		title: "Restart observer",
		metadata: { subagentName: "observer", threadKey: "restart-thread" },
	});
	let firstRouter = new PiboSessionRouter({ persistSession: false, sessionStore: firstStore });
	try {
		for (let index = 1; index <= 3; index += 1) {
			firstRouter.emitOutput({
				type: "assistant_message",
				piboSessionId: childId,
				eventId: `before-${index}`,
				text: `before restart ${index}`,
			});
		}
		const beforeRestart = createAgentsController(firstRouter, parentId).observe({
			afterSequence: 0,
			order: "asc",
			limit: 20,
		});
		const beforeSequences = beforeRestart.observations.map((item) => item.sequence);
		assert.equal(beforeSequences.length, 3);
		assert.deepEqual(beforeSequences, [beforeSequences[0], beforeSequences[0] + 1, beforeSequences[0] + 2]);
		assert.equal(beforeRestart.nextAfterSequence, beforeSequences[2]);

		await firstRouter.disposeAll();
		firstStore.close();

		const reopenedStore = new PiboDataSessionStore(dbPath);
		const restartedRouter = new PiboSessionRouter({ persistSession: false, sessionStore: reopenedStore });
		try {
			for (let index = 1; index <= 4; index += 1) {
				restartedRouter.emitOutput({
					type: "assistant_message",
					piboSessionId: childId,
					eventId: `after-${index}`,
					text: `after restart ${index}`,
				});
			}
			const observed = createAgentsController(restartedRouter, parentId).observe({
				afterSequence: beforeRestart.nextAfterSequence,
				order: "asc",
				limit: 20,
			});
			assert.deepEqual(observed.observations.map((item) => item.text), [
				"after restart 1",
				"after restart 2",
				"after restart 3",
				"after restart 4",
			]);
			assert.deepEqual(observed.observations.map((item) => item.sequence), [
				beforeRestart.nextAfterSequence + 1,
				beforeRestart.nextAfterSequence + 2,
				beforeRestart.nextAfterSequence + 3,
				beforeRestart.nextAfterSequence + 4,
			]);
			assert.equal(observed.nextAfterSequence, beforeRestart.nextAfterSequence + 4);
			assert.equal(observed.truncated, false);
		} finally {
			await restartedRouter.disposeAll();
			reopenedStore.close();
		}
	} finally {
		try { await firstRouter.disposeAll(); } catch { /* already disposed */ }
		try { firstStore.close(); } catch { /* already closed */ }
		await rm(root, { recursive: true, force: true });
	}
});

test("delegated observation auto cursors persist across router restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-subagent-observe-auto-restart-"));
	const dbPath = join(root, "pibo.sqlite");
	const parentId = "ps_observe_auto_parent";
	const childId = "ps_observe_auto_child";
	let firstStore = new PiboDataSessionStore(dbPath);
	firstStore.create({ id: parentId, channel: "pibo.test", kind: "chat", profile: "base" });
	firstStore.create({
		id: childId,
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId,
		metadata: { subagentName: "observer", threadKey: "auto-restart" },
	});
	let firstRouter = new PiboSessionRouter({ persistSession: false, sessionStore: firstStore });
	try {
		firstRouter.emitOutput({
			type: "assistant_message",
			piboSessionId: childId,
			eventId: "auto-before",
			text: "before automatic restart",
		});
		const first = createAgentsController(firstRouter, parentId).observe({});
		assert.deepEqual(first.observations.map((item) => item.text), ["before automatic restart"]);
		assert.deepEqual(createAgentsController(firstRouter, parentId).observe({}).observations, []);

		await firstRouter.disposeAll();
		firstStore.close();

		const reopenedStore = new PiboDataSessionStore(dbPath);
		const restartedRouter = new PiboSessionRouter({ persistSession: false, sessionStore: reopenedStore });
		try {
			restartedRouter.emitOutput({
				type: "assistant_message",
				piboSessionId: childId,
				eventId: "auto-after",
				text: "after automatic restart",
			});
			const observed = createAgentsController(restartedRouter, parentId).observe({});
			assert.deepEqual(observed.observations.map((item) => item.text), ["after automatic restart"]);
			assert.deepEqual(createAgentsController(restartedRouter, parentId).observe({}).observations, []);
			assert.deepEqual(
				createAgentsController(restartedRouter, parentId).observe({ cursorMode: "history" }).observations.map((item) => item.text),
				["after automatic restart"],
			);
		} finally {
			await restartedRouter.disposeAll();
			reopenedStore.close();
		}
	} finally {
		try { await firstRouter.disposeAll(); } catch { /* already disposed */ }
		try { firstStore.close(); } catch { /* already closed */ }
		await rm(root, { recursive: true, force: true });
	}
});

test("the first durable observation sequence advances beyond pre-counter cursors", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-subagent-observe-migration-"));
	const store = new PiboDataSessionStore(join(root, "pibo.sqlite"));
	const parentId = "ps_observe_migration_parent";
	const childId = "ps_observe_migration_child";
	store.create({ id: parentId, channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: childId,
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId,
		metadata: { subagentName: "observer" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		const legacyCursor = 1_000_000;
		router.emitOutput({
			type: "assistant_message",
			piboSessionId: childId,
			eventId: "after-upgrade",
			text: "visible after counter migration",
		});
		const observed = createAgentsController(router, parentId).observe({
			afterSequence: legacyCursor,
			order: "asc",
		});
		assert.deepEqual(observed.observations.map((item) => item.text), ["visible after counter migration"]);
		assert.equal(observed.observations[0].sequence > legacyCursor, true);
		assert.equal(observed.truncated, false);
	} finally {
		await router.disposeAll();
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});
