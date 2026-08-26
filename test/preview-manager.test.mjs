import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	reconcileManagedPreviews,
	startManagedPreview,
	stopManagedPreview,
	validatePreviewStartCommand,
} from "../dist/previews/manager.js";
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

function createFakeController() {
	let sequence = 0;
	const servers = new Map();
	const stopped = [];
	return {
		stopped,
		async launch(input) {
			const id = `fake-${++sequence}`;
			const server = createServer((_request, response) => response.end("preview"));
			await listen(server, input.port);
			servers.set(id, server);
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
	const store = new PreviewStore(":memory:");
	const controller = createFakeController();
	t.after(async () => { await controller.closeAll(); store.close(); });
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
	assert.equal(retained.serverState, "running");
	assert.equal(retained.managerId, running.managerId);

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

	assert.equal(first.reserveManagedServerStart("pv-first", 1, now.toISOString(), stopAt).reserved, true);
	assert.throws(
		() => second.reserveManagedServerStart("pv-second", 1, now.toISOString(), stopAt),
		(error) => error instanceof PreviewCapacityError && error.maxRunningServers === 1,
	);
	assert.equal(second.requireExposure("pv-second").serverState, "stopped");
});

test("a stop racing startup cancels the newly launched server instead of orphaning it", async (t) => {
	const store = new PreviewStore(":memory:");
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	const controller = createFakeController();
	const originalLaunch = controller.launch.bind(controller);
	controller.launch = async (input) => {
		entered.resolve();
		await release.promise;
		return originalLaunch(input);
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
	assert.equal(stopped.serverState, "stopped");
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
	const first = store.reserveManagedServerStart("pv-generation", 1, now.toISOString(), "2026-08-23T12:10:00.000Z").exposure;
	assert.ok(first.serverGeneration);
	store.markManagedServerStopped("pv-generation", { expectedGeneration: first.serverGeneration });
	const second = store.reserveManagedServerStart("pv-generation", 1, "2026-08-23T12:01:00.000Z", "2026-08-23T12:11:00.000Z").exposure;
	assert.ok(second.serverGeneration);
	assert.notEqual(second.serverGeneration, first.serverGeneration);

	const afterLateStop = store.markManagedServerStopped("pv-generation", { expectedGeneration: first.serverGeneration });
	assert.equal(afterLateStop.serverState, "starting");
	assert.equal(afterLateStop.serverGeneration, second.serverGeneration);
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

test("stale starting reservations are reaped after a gateway crash", async (t) => {
	const store = new PreviewStore(":memory:");
	t.after(() => store.close());
	const now = new Date("2026-08-23T12:00:00.000Z");
	await createManagedExposure(store, "pv-stale-start", now);
	store.reserveManagedServerStart("pv-stale-start", 1, now.toISOString(), "2026-08-23T12:10:00.000Z");
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
