import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
	createDefaultPreviewProcessController,
	reconcileManagedPreviews,
	startManagedPreview,
	stopManagedPreview,
	validatePreviewStartCommand,
} from "../dist/previews/manager.js";
import { previewProcessStartTicks, probePreviewTarget } from "../dist/previews/network.js";
import { PreviewCapacityError, PreviewStore } from "../dist/previews/store.js";

function listen(server, port = 0) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve(server.address().port));
	});
}

async function unusedPort() {
	const server = createServer();
	const port = await listen(server);
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return port;
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

function createFakeController() {
	let sequence = 0;
	const servers = new Map();
	const stopped = [];
	const launched = [];
	return {
		launched,
		stopped,
		createIdentity() {
			return { kind: "process", id: `fake-${++sequence}` };
		},
		async launch(input, identity) {
			const id = identity.id;
			const server = createServer((_request, response) => response.end("preview"));
			await listen(server, input.port);
			servers.set(id, server);
			launched.push(id);
			return { kind: "process", id };
		},
		async isRunning(identity) {
			return servers.has(identity.id);
		},
		async ownsTarget(identity) {
			return servers.has(identity.id);
		},
		async stop(identity) {
			const server = servers.get(identity.id);
			if (!server) return;
			servers.delete(identity.id);
			stopped.push(identity.id);
			await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		},
		async closeAll() {
			for (const id of [...servers.keys()]) await this.stop({ kind: "process", id });
		},
	};
}

async function createManagedExposure(store, id, now = new Date("2026-08-23T12:00:00.000Z")) {
	return store.createExposure({
		id,
		piboSessionId: "ps_managed",
		label: id,
		targetHost: "127.0.0.1",
		targetPort: await unusedPort(),
		workspace: process.cwd(),
		managementMode: "managed",
		startCommand: "node server.js",
		serverState: "stopped",
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
	});
}

const settings = { maxRunningServers: 3, autoStopMinutes: 10 };
const reservationIdentity = (id) => ({ kind: "process", id: `fake-reservation-${id}` });

test("managed Preview lifecycle uses a fixed lease and can stop and restart independently", async (t) => {
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	t.after(async () => { await controller.closeAll(); store.close(); });
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-managed", startedAt);

	const running = await startManagedPreview(store, "pv-managed", { controller, settings, now: () => startedAt, startupTimeoutMs: 2_000, pollIntervalMs: 10 });
	assert.equal(running.serverState, "running");
	assert.equal(running.serverStopAt, "2026-08-23T12:10:00.000Z");
	assert.ok(running.managerId);

	const repeated = await startManagedPreview(store, "pv-managed", {
		controller,
		settings,
		now: () => new Date("2026-08-23T12:05:00.000Z"),
	});
	assert.equal(repeated.serverStopAt, running.serverStopAt, "activity and repeated start calls must not extend the fixed lease");

	const stopped = await stopManagedPreview(store, "pv-managed", { controller });
	assert.equal(stopped.serverState, "stopped");
	assert.equal(stopped.managerId, undefined);
	assert.equal(controller.stopped.length, 1);

	const restarted = await startManagedPreview(store, "pv-managed", {
		controller,
		settings,
		now: () => new Date("2026-08-23T12:06:00.000Z"),
		startupTimeoutMs: 2_000,
		pollIntervalMs: 10,
	});
	assert.equal(restarted.serverState, "running");
	assert.equal(restarted.serverStopAt, "2026-08-23T12:16:00.000Z");
	assert.notEqual(restarted.managerId, running.managerId);
});

test("managed Preview auto-stop reconciliation terminates the process tree at lease end", async (t) => {
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	t.after(async () => { await controller.closeAll(); store.close(); });
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-auto-stop", startedAt);
	await startManagedPreview(store, "pv-auto-stop", { controller, settings, now: () => startedAt, startupTimeoutMs: 2_000, pollIntervalMs: 10 });

	await reconcileManagedPreviews(store, { controller, now: () => new Date("2026-08-23T12:10:00.001Z") });
	const stopped = store.requireExposure("pv-auto-stop");
	assert.equal(stopped.serverState, "stopped");
	assert.equal(stopped.serverStoppedAt, "2026-08-23T12:10:00.001Z");
	assert.equal(controller.stopped.length, 1);
});

test("reconciliation retains process identity when termination fails so a later pass can retry", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-stop-retry-"));
	const path = join(directory, "previews.sqlite");
	let store = new PreviewStore(path);
	const controller = createFakeController();
	t.after(async () => {
		await controller.closeAll();
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-stop-retry", startedAt);
	const running = await startManagedPreview(store, "pv-stop-retry", {
		controller,
		settings,
		now: () => startedAt,
		startupTimeoutMs: 2_000,
		pollIntervalMs: 10,
	});
	const originalStop = controller.stop.bind(controller);
	controller.stop = async () => { throw new Error("deterministic stop failure"); };
	await reconcileManagedPreviews(store, { controller, now: () => new Date("2026-08-23T12:10:01.000Z") });
	const retained = store.requireExposure("pv-stop-retry");
	assert.equal(retained.serverState, "stopping");
	assert.equal(retained.managerId, running.managerId);

	store.close();
	store = new PreviewStore(path);
	controller.stop = originalStop;
	await reconcileManagedPreviews(store, { controller, now: () => new Date("2026-08-23T12:10:02.000Z") });
	assert.equal(store.requireExposure("pv-stop-retry").serverState, "stopped");
});

test("managed Preview capacity reservation is atomic across store connections", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-capacity-"));
	const path = join(directory, "previews.sqlite");
	const first = new PreviewStore(path);
	const second = new PreviewStore(path);
	t.after(() => { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(first, "pv-first", now);
	await createManagedExposure(first, "pv-second", now);
	const stopAt = new Date(now.getTime() + 10 * 60_000).toISOString();

	assert.equal(first.reserveManagedServerStart("pv-first", 1, now.toISOString(), stopAt, reservationIdentity("first")).reserved, true);
	assert.throws(
		() => second.reserveManagedServerStart("pv-second", 1, now.toISOString(), stopAt, reservationIdentity("second")),
		(error) => error instanceof PreviewCapacityError && error.maxRunningServers === 1,
	);
	assert.equal(second.requireExposure("pv-second").serverState, "stopped");
});

test("ownerless error recovery rejects every partially persisted owner", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-partial-owner-"));
	const path = join(directory, "previews.sqlite");
	const store = new PreviewStore(path);
	let stopCalls = 0;
	const controller = {
		createIdentity() { throw new Error("not used"); },
		async launch() { throw new Error("not used"); },
		async isRunning() { return false; },
		async ownsTarget() { return false; },
		async stop() { stopCalls += 1; },
	};
	t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	for (const id of ["pv-generation-only", "pv-identity-only"]) {
		await createManagedExposure(store, id, now);
		store.reserveManagedServerStart(
			id,
			3,
			now.toISOString(),
			"2026-08-23T12:10:00.000Z",
			reservationIdentity(id),
		);
	}
	const inspection = new DatabaseSync(path);
	inspection.prepare(`
		UPDATE preview_exposures
		SET server_state = 'error', manager_kind = NULL, manager_id = NULL,
			manager_pid = NULL, manager_process_start_ticks = NULL
		WHERE id = ?
	`).run("pv-generation-only");
	inspection.prepare(`
		UPDATE preview_exposures
		SET server_state = 'error', server_generation = NULL
		WHERE id = ?
	`).run("pv-identity-only");
	inspection.close();

	for (const id of ["pv-generation-only", "pv-identity-only"]) {
		await assert.rejects(
			stopManagedPreview(store, id, { controller }),
			/no durable managed owner identity/,
		);
		assert.equal(store.requireExposure(id).serverState, "error");
	}
	assert.equal(stopCalls, 0, "partial ownership must never authorize process termination");
});

test("managed start rejects a listener owned by the wrong process group", async (t) => {
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	controller.ownsTarget = async () => false;
	t.after(async () => { await controller.closeAll(); store.close(); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-wrong-process-group", now);

	await assert.rejects(
		startManagedPreview(store, "pv-wrong-process-group", {
			controller,
			settings,
			now: () => now,
			startupTimeoutMs: 2_000,
			pollIntervalMs: 10,
		}),
		/owned by a different process/,
	);
	const failed = store.requireExposure("pv-wrong-process-group");
	assert.equal(failed.serverState, "error");
	assert.equal(failed.serverGeneration, undefined);
	assert.equal(failed.managerId, undefined);
	assert.deepEqual(controller.stopped, controller.launched);
	const stopped = await stopManagedPreview(store, failed.id, { controller });
	assert.equal(stopped.serverState, "stopped");
	assert.equal(stopped.serverError, undefined);
});

test("reconciliation handles every persisted owner-bearing lifecycle state", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-all-states-"));
	const path = join(directory, "previews.sqlite");
	const store = new PreviewStore(path);
	const stopped = [];
	const controller = {
		createIdentity() { throw new Error("not used"); },
		async launch() { throw new Error("not used"); },
		async isRunning() { return false; },
		async ownsTarget() { return false; },
		async stop(identity) { stopped.push(identity.id); },
	};
	t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	for (const id of ["pv-state-starting", "pv-state-running", "pv-state-stopping", "pv-state-error"]) {
		await createManagedExposure(store, id, startedAt);
		store.reserveManagedServerStart(
			id,
			10,
			startedAt.toISOString(),
			"2026-08-23T12:10:00.000Z",
			reservationIdentity(id),
		);
	}
	for (const id of ["pv-state-running", "pv-state-stopping"]) {
		const exposure = store.requireExposure(id);
		store.markManagedServerRunning(id, exposure.serverGeneration, {
			targetHost: "127.0.0.1",
			targetProcessId: 12345,
			targetProcessStartTicks: "fixture-start-ticks",
			manager: reservationIdentity(id),
		});
	}
	const stopping = store.requireExposure("pv-state-stopping");
	store.markManagedServerStopping(stopping.id, stopping.serverGeneration);
	const inspection = new DatabaseSync(path);
	inspection.prepare("UPDATE preview_exposures SET server_state = 'error', server_error = ? WHERE id = ?")
		.run("persisted owner error", "pv-state-error");
	inspection.close();

	await reconcileManagedPreviews(store, {
		controller,
		now: () => new Date("2026-08-23T12:00:21.000Z"),
		startupTimeoutMs: 15_000,
	});
	assert.equal(store.requireExposure("pv-state-starting").serverState, "error");
	assert.equal(store.requireExposure("pv-state-starting").managerId, undefined);
	assert.equal(store.requireExposure("pv-state-running").serverState, "stopped");
	assert.equal(store.requireExposure("pv-state-stopping").serverState, "stopped");
	assert.equal(store.requireExposure("pv-state-error").serverState, "error");
	assert.equal(store.requireExposure("pv-state-error").serverError, "persisted owner error");
	assert.equal(store.requireExposure("pv-state-error").managerId, undefined);
	assert.deepEqual(new Set(stopped), new Set([
		"fake-reservation-pv-state-starting",
		"fake-reservation-pv-state-running",
		"fake-reservation-pv-state-stopping",
		"fake-reservation-pv-state-error",
	]));
});

test("a stop racing startup cancels the newly launched server instead of orphaning it", async (t) => {
	const store = new PreviewStore(":memory:");
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const controller = createFakeController();
	const originalLaunch = controller.launch.bind(controller);
	controller.launch = async (input, identity) => {
		entered.resolve();
		await release.promise;
		return originalLaunch(input, identity);
	};
	t.after(async () => { release.resolve(); await controller.closeAll(); store.close(); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-start-stop-race", now);

	const starting = startManagedPreview(store, "pv-start-stop-race", {
		controller,
		settings,
		now: () => now,
		startupTimeoutMs: 2_000,
		pollIntervalMs: 10,
	});
	await entered.promise;
	const stopped = await stopManagedPreview(store, "pv-start-stop-race", { controller });
	assert.equal(stopped.serverState, "stopping");
	assert.throws(
		() => store.closeExposure("pv-start-stop-race"),
		/must be fully stopped before removal/,
		"removal must not erase ownership while launch can still publish",
	);
	release.resolve();
	const result = await starting;
	assert.equal(result.serverState, "stopped");
	assert.equal(controller.stopped.length, 1, "the process launched after cancellation must be terminated");
});

test("an old stop generation cannot overwrite a newer start reservation", async (t) => {
	const store = new PreviewStore(":memory:");
	t.after(() => store.close());
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-generation", now);
	const first = store.reserveManagedServerStart(
		"pv-generation",
		1,
		now.toISOString(),
		"2026-08-23T12:10:00.000Z",
		reservationIdentity("generation-first"),
	).exposure;
	assert.ok(first.serverGeneration);
	store.markManagedServerStopped("pv-generation", { expectedGeneration: first.serverGeneration });
	const secondManager = reservationIdentity("generation-second");
	const second = store.reserveManagedServerStart(
		"pv-generation",
		1,
		"2026-08-23T12:01:00.000Z",
		"2026-08-23T12:11:00.000Z",
		secondManager,
	).exposure;
	assert.ok(second.serverGeneration);
	assert.notEqual(second.serverGeneration, first.serverGeneration);
	store.markManagedServerRunning("pv-generation", second.serverGeneration, {
		targetHost: "127.0.0.1",
		manager: secondManager,
	});
	const currentSession = store.createBrowserSession("pv-generation", 10, new Date("2026-08-23T12:01:01.000Z"));

	const afterLateStop = store.markManagedServerStopped("pv-generation", { expectedGeneration: first.serverGeneration });
	assert.equal(afterLateStop.serverState, "running");
	assert.equal(afterLateStop.serverGeneration, second.serverGeneration);
	assert.equal(store.authenticateBrowserSession(currentSession.token, "pv-generation", new Date("2026-08-23T12:01:02.000Z")), true);
});

test("stale manager publication cannot replace a newer generation owner", async (t) => {
	const store = new PreviewStore(":memory:");
	t.after(() => store.close());
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-stale-publication", now);
	const firstManager = reservationIdentity("stale-publication-first");
	const first = store.reserveManagedServerStart(
		"pv-stale-publication",
		1,
		now.toISOString(),
		"2026-08-23T12:10:00.000Z",
		firstManager,
	).exposure;
	store.markManagedServerStopped("pv-stale-publication", { expectedGeneration: first.serverGeneration });
	const secondManager = reservationIdentity("stale-publication-second");
	const second = store.reserveManagedServerStart(
		"pv-stale-publication",
		1,
		"2026-08-23T12:01:00.000Z",
		"2026-08-23T12:11:00.000Z",
		secondManager,
	).exposure;

	store.markManagedServerManager("pv-stale-publication", first.serverGeneration, {
		...firstManager,
		pid: 111,
		processStartTicks: "old-start-ticks",
	});
	store.markManagedServerRunning("pv-stale-publication", first.serverGeneration, {
		targetHost: "127.0.0.1",
		targetProcessId: 222,
		targetProcessStartTicks: "old-target-ticks",
		manager: firstManager,
	});
	const retained = store.requireExposure("pv-stale-publication");
	assert.equal(retained.serverState, "starting");
	assert.equal(retained.serverGeneration, second.serverGeneration);
	assert.equal(retained.managerId, secondManager.id);
	assert.equal(retained.managerPid, undefined);
	assert.equal(retained.targetProcessId, undefined);
});

test("a committed running publication followed by a throw still cleans the exact owner", async (t) => {
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	t.after(async () => { await controller.closeAll(); store.close(); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-commit-then-throw", now);
	const markRunning = store.markManagedServerRunning.bind(store);
	store.markManagedServerRunning = (...args) => {
		markRunning(...args);
		throw new Error("simulated commit-then-throw after running publication");
	};

	await assert.rejects(
		startManagedPreview(store, "pv-commit-then-throw", {
			controller,
			settings,
			now: () => now,
			startupTimeoutMs: 2_000,
			pollIntervalMs: 10,
		}),
		/commit-then-throw/,
	);
	const cleaned = store.requireExposure("pv-commit-then-throw");
	assert.equal(cleaned.serverState, "error");
	assert.equal(cleaned.serverGeneration, undefined);
	assert.equal(cleaned.managerId, undefined);
	assert.equal(controller.launched.length, 1);
	assert.deepEqual(controller.stopped, controller.launched);
});

test("a committed reservation followed by a throw publishes ownership before any launch", async (t) => {
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	t.after(async () => { await controller.closeAll(); store.close(); });
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-reservation-commit-throw", now);
	const reserve = store.reserveManagedServerStart.bind(store);
	store.reserveManagedServerStart = (...args) => {
		reserve(...args);
		throw new Error("simulated commit-then-throw after ownership reservation");
	};

	await assert.rejects(
		startManagedPreview(store, "pv-reservation-commit-throw", {
			controller,
			settings,
			now: () => now,
			startupTimeoutMs: 15_000,
			pollIntervalMs: 10,
		}),
		/commit-then-throw after ownership reservation/,
	);
	const reserved = store.requireExposure("pv-reservation-commit-throw");
	assert.equal(reserved.serverState, "starting");
	assert.ok(reserved.serverGeneration);
	assert.ok(reserved.managerId);
	assert.equal(controller.launched.length, 0, "an ambiguous reservation must not proceed to process launch");

	await reconcileManagedPreviews(store, {
		controller,
		now: () => new Date("2026-08-23T12:00:21.000Z"),
		startupTimeoutMs: 15_000,
	});
	assert.equal(store.requireExposure("pv-reservation-commit-throw").serverState, "error");
});

test("detached process cleanup requires the exact owner token and process creation identity", {
	skip: process.platform !== "linux",
}, async (t) => {
	const controller = createDefaultPreviewProcessController();
	const port = await unusedPort();
	const input = {
		previewId: "pv-exact-process-owner",
		command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setInterval(() => {}, 1000)")}`,
		workspace: process.cwd(),
		port,
	};
	const prepared = controller.createIdentity(input);
	const launched = await controller.launch(input, prepared);
	t.after(async () => { await controller.stop(prepared); });
	assert.ok(launched.pid);
	assert.ok(launched.processStartTicks);
	assert.equal(await controller.isRunning(launched), true);

	await controller.stop({ ...launched, id: `${launched.id}-unrelated` });
	assert.equal(await controller.isRunning(launched), true, "a forged owner token must not authorize a PID signal");
	const reusedLeader = { ...launched, processStartTicks: `${launched.processStartTicks}-reused` };
	assert.equal(await controller.isManagerRunning(reusedLeader), false, "a reused PID must not be accepted as the recorded leader");
	assert.equal(await controller.isRunning(reusedLeader), true, "leader reuse must not erase exact-token descendant ownership");
	await controller.stop(prepared);
	assert.equal(await controller.isRunning(prepared), false, "the durable token must recover and stop the exact process group");
});

test("reconciliation exactly terminates a detached listener after only its supervisor dies", {
	skip: process.platform !== "linux",
}, async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-supervisor-death-"));
	const databasePath = join(directory, "previews.sqlite");
	const controller = createDefaultPreviewProcessController();
	const port = await unusedPort();
	const serverScript = [
		"const { createServer } = require('node:http')",
		"createServer((_request, response) => response.end('owned-descendant')).listen(Number(process.env.PORT), '127.0.0.1')",
	].join(";");
	let store = new PreviewStore(databasePath);
	store.createExposure({
		id: "pv-supervisor-death",
		piboSessionId: "ps_supervisor_death",
		label: "Supervisor death",
		targetHost: "127.0.0.1",
		targetPort: port,
		workspace: process.cwd(),
		managementMode: "managed",
		startCommand: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(serverScript)}`,
		serverState: "stopped",
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	let cleanupIdentity;
	t.after(async () => {
		if (cleanupIdentity) await controller.stop({ kind: cleanupIdentity.kind, id: cleanupIdentity.id });
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});

	const running = await startManagedPreview(store, "pv-supervisor-death", {
		controller,
		settings,
		startupTimeoutMs: 2_000,
		pollIntervalMs: 10,
	});
	cleanupIdentity = { kind: running.managerKind, id: running.managerId };
	assert.ok(running.managerPid);
	assert.ok(running.managerProcessStartTicks);
	assert.ok(await probePreviewTarget(port, { timeoutMs: 500 }));

	store.close();
	process.kill(running.managerPid, "SIGKILL");
	await waitFor(
		() => previewProcessStartTicks(running.managerPid) !== running.managerProcessStartTicks,
		"the detached supervisor to exit",
	);
	assert.ok(await probePreviewTarget(port, { timeoutMs: 500 }), "the exact-token descendant listener must survive supervisor-only death");
	assert.equal(await controller.isRunning({
		kind: running.managerKind,
		id: running.managerId,
		pid: running.managerPid,
		processStartTicks: running.managerProcessStartTicks,
	}), true, "the surviving exact-token process group must remain owned");

	store = new PreviewStore(databasePath);
	await reconcileManagedPreviews(store, { controller });
	assert.equal(await probePreviewTarget(port, { timeoutMs: 250 }), undefined, "reconciliation must terminate the exact descendant listener");
	const reconciled = store.requireExposure("pv-supervisor-death");
	assert.equal(reconciled.serverState, "stopped");
	assert.equal(reconciled.managerId, undefined, "ownership may clear only after exact cleanup");
});

test("managed Preview reconciliation survives store reopen and records manager crashes", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-reopen-"));
	const path = join(directory, "previews.sqlite");
	const controller = createFakeController();
	let store = new PreviewStore(path);
	t.after(async () => {
		await controller.closeAll();
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-reopen", startedAt);
	const running = await startManagedPreview(store, "pv-reopen", {
		controller,
		settings,
		now: () => startedAt,
		startupTimeoutMs: 2_000,
		pollIntervalMs: 10,
	});
	const identity = { kind: running.managerKind, id: running.managerId };
	store.close();
	store = new PreviewStore(path);
	await reconcileManagedPreviews(store, {
		controller,
		now: () => new Date("2026-08-23T12:01:00.000Z"),
	});
	assert.equal(store.requireExposure("pv-reopen").serverState, "running");

	await controller.stop(identity);
	await reconcileManagedPreviews(store, {
		controller,
		now: () => new Date("2026-08-23T12:02:00.000Z"),
	});
	assert.equal(store.requireExposure("pv-reopen").serverState, "stopped");
});

test("an ambiguous launch remains durably owned across restart and can be stopped exactly", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pibo-preview-ambiguous-launch-"));
	const path = join(directory, "previews.sqlite");
	const identity = { kind: "process", id: "fake-ambiguous-launch" };
	let server;
	let stopUnavailable = true;
	const controller = {
		createIdentity() {
			return identity;
		},
		async launch(input, candidate) {
			assert.equal(candidate.id, identity.id);
			server = createServer((_request, response) => response.end("preview"));
			await listen(server, input.port);
			throw new Error("launch outcome is ambiguous after process creation");
		},
		async isRunning(candidate) {
			return candidate.id === identity.id && server?.listening === true;
		},
		async ownsTarget(candidate) {
			return candidate.id === identity.id && server?.listening === true;
		},
		async stop(candidate) {
			assert.equal(candidate.id, identity.id, "cleanup must target only the durable owner identity");
			if (stopUnavailable) throw new Error("simulated interruption before cleanup");
			if (!server?.listening) return;
			await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		},
	};
	let store = new PreviewStore(path);
	t.after(async () => {
		stopUnavailable = false;
		if (server?.listening) await controller.stop(identity);
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});
	const startedAt = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-ambiguous-launch", startedAt);

	await assert.rejects(
		startManagedPreview(store, "pv-ambiguous-launch", {
			controller,
			settings,
			now: () => startedAt,
			startupTimeoutMs: 15_000,
			pollIntervalMs: 10,
		}),
		/launch outcome is ambiguous/,
	);
	const interrupted = store.requireExposure("pv-ambiguous-launch");
	assert.equal(interrupted.serverState, "starting");
	assert.ok(interrupted.serverGeneration);
	assert.equal(interrupted.managerId, identity.id);
	assert.equal(server.listening, true);

	store.close();
	store = new PreviewStore(path);
	stopUnavailable = false;
	await reconcileManagedPreviews(store, {
		controller,
		now: () => new Date("2026-08-23T12:00:21.000Z"),
		startupTimeoutMs: 15_000,
	});
	assert.equal(server.listening, false);
	const reconciled = store.requireExposure("pv-ambiguous-launch");
	assert.equal(reconciled.serverState, "error");
	assert.equal(reconciled.managerId, undefined);
});

test("stale starting reservations are reaped after a gateway crash", async (t) => {
	const store = new PreviewStore(":memory:");
	t.after(() => store.close());
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-stale-start", now);
	store.reserveManagedServerStart(
		"pv-stale-start",
		1,
		now.toISOString(),
		"2026-08-23T12:10:00.000Z",
		reservationIdentity("stale-start"),
	);
	await reconcileManagedPreviews(store, {
		controller: createFakeController(),
		now: () => new Date("2026-08-23T12:00:21.000Z"),
		startupTimeoutMs: 15_000,
	});
	const reaped = store.requireExposure("pv-stale-start");
	assert.equal(reaped.serverState, "error");
	assert.match(reaped.serverError, /startup timed out/);
});

test("managed Preview command validation rejects empty, NUL, and oversized commands", () => {
	assert.equal(validatePreviewStartCommand("  npm run dev  "), "npm run dev");
	assert.throws(() => validatePreviewStartCommand("   "), /required/);
	assert.throws(() => validatePreviewStartCommand("node\0server"), /NUL/);
	assert.throws(() => validatePreviewStartCommand("x".repeat(8_193)), /too long/);
});
