import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function createRegistry() {
	return PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
}

function seedRunningTurn(root) {
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), {
		payloadRootDir: join(root, "payloads"),
	});
	const sessionStore = new PiboDataSessionStore(dataStore);
	const session = sessionStore.create({
		id: "ps_live_external",
		piSessionId: "11111111-2222-4333-8444-555555555555",
		channel: "pibo.chat",
		kind: "chat",
		profile: "base",
		title: "Live external turn",
	});
	dataStore.telemetry.upsertTurn({
		turnId: "turn_live_external",
		piboSessionId: session.id,
		rootSessionId: session.id,
		eventId: "evt_live_external",
		source: "user",
		status: "running",
		currentPhase: "tool_execution",
		queuedAt: "2026-08-10T15:25:22.294Z",
		startedAt: "2026-08-10T15:25:22.294Z",
		lastProgressAt: "2026-08-10T15:25:44.000Z",
	});
	return { dataStore, sessionStore, session };
}

async function withPiboHome(root, action) {
	const previous = process.env.PIBO_HOME;
	process.env.PIBO_HOME = root;
	try {
		return await action();
	} finally {
		if (previous === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previous;
	}
}

test("persistSession false uses an in-memory store and leaves the external Pibo home unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-gateway-nonpersistent-"));
	const seeded = seedRunningTurn(root);
	seeded.dataStore.close();

	try {
		await withPiboHome(root, async () => {
			const server = new PiboGatewayServer({
				host: "127.0.0.1",
				port: 0,
				startChannels: false,
				persistSession: false,
				pluginRegistry: createRegistry(),
				loopStorePath: join(root, "isolated-loops.sqlite"),
				resourceReaper: false,
			});
			await server.start();
			const diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.authoritativeRuntime, false);
			assert.match(diagnostics.runtimeInstanceId, /^gateway:/);
			await server.stop();
		});

		const verification = new PiboDataStore(join(root, "pibo.sqlite"), {
			payloadRootDir: join(root, "payloads"),
		});
		try {
			assert.equal(verification.telemetry.getTurn("turn_live_external").status, "running");
			assert.equal(verification.db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'session_error'").get("ps_live_external").count, 0);
		} finally {
			verification.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an embedded gateway with an explicit live store is non-authoritative by default", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-gateway-observer-"));
	const fixture = seedRunningTurn(root);
	try {
		const server = new PiboGatewayServer({
			host: "127.0.0.1",
			port: 0,
			startChannels: false,
			persistSession: false,
			pluginRegistry: createRegistry(),
			sessionStore: fixture.sessionStore,
			loopStorePath: join(root, "isolated-loops.sqlite"),
			resourceReaper: false,
		});
		await server.start();
		await server.stop();

		assert.equal(fixture.dataStore.telemetry.getTurn("turn_live_external").status, "running");
	} finally {
		fixture.dataStore.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("an explicitly authoritative gateway recovers interrupted state from its supplied store", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-gateway-authoritative-"));
	const fixture = seedRunningTurn(root);
	try {
		const server = new PiboGatewayServer({
			host: "127.0.0.1",
			port: 0,
			startChannels: false,
			persistSession: false,
			authoritativeRuntime: true,
			runtimeInstanceId: "test-authoritative-runtime",
			pluginRegistry: createRegistry(),
			sessionStore: fixture.sessionStore,
			loopStorePath: join(root, "isolated-loops.sqlite"),
			resourceReaper: false,
		});
		await server.start();
		assert.deepEqual(
			{
				authoritativeRuntime: server.getDiagnostics().authoritativeRuntime,
				runtimeInstanceId: server.getDiagnostics().runtimeInstanceId,
			},
			{
				authoritativeRuntime: true,
				runtimeInstanceId: "test-authoritative-runtime",
			},
		);
		await server.stop();

		assert.equal(fixture.dataStore.telemetry.getTurn("turn_live_external").status, "aborted");
	} finally {
		fixture.dataStore.close();
		await rm(root, { recursive: true, force: true });
	}
});

// Keep direct router recovery coverage explicit: the gateway tests above validate ownership defaults.
test("direct router recovery remains opt-in", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-router-recovery-opt-in-"));
	const fixture = seedRunningTurn(root);
	try {
		const observer = new PiboSessionRouter({ sessionStore: fixture.sessionStore, persistSession: false });
		await observer.disposeAll();
		assert.equal(fixture.dataStore.telemetry.getTurn("turn_live_external").status, "running");
	} finally {
		fixture.dataStore.close();
		await rm(root, { recursive: true, force: true });
	}
});
