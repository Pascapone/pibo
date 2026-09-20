import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Isolate PIBO_HOME so the address file never touches the real home.
const isolatedHome = mkdtempSync(join(tmpdir(), "remote-svc-home-"));
process.env.PIBO_HOME = join(isolatedHome, ".pibo");
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { effectiveRemoteMode, RemoteAgentError } from "../dist/remote-agent/types.js";

function fakeSessionStore() {
	const sessions = new Map();
	return {
		sessions,
		get: (id) => sessions.get(id),
		find: () => [...sessions.values()],
		create: (input) => {
			const session = { id: `ps_${sessions.size + 1}`, piSessionId: "", channel: input.channel, kind: input.kind, profile: input.profile, workspace: input.workspace, title: input.title, metadata: input.metadata ?? {}, createdAt: "2026-09-19T12:00:00.000Z", updatedAt: "2026-09-19T12:00:00.000Z" };
			sessions.set(session.id, session);
			return session;
		},
		update: () => undefined,
	};
}

const fakeDataStore = {
	messages: { listMessages: () => [] },
	observations: { listObservations: () => [] },
};

const services = [];
after(async () => {
	for (const service of services.splice(0)) {
		await service.stop().catch(() => {});
		service.close();
	}
	rmSync(isolatedHome, { recursive: true, force: true });
});

function createService() {
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: ":memory:" }),
		sessionStore: fakeSessionStore(),
		dataStore: fakeDataStore,
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
	});
	services.push(service);
	return service;
}

test("room lifecycle: enable, code, redeem, disable revokes", async () => {
	const service = createService();
	const sandbox = mkdtempSync(join(tmpdir(), "remote-svc-"));
	try {
		assert.throws(() => service.createDeviceCode("room-a"), (error) => error instanceof RemoteAgentError && error.code === "room_inactive");
		const config = service.setRoomConfig("room-a", { enabled: true, sandboxPath: sandbox, modules: { sessions: true, observe: true, files: false, bash: false } });
		assert.equal(config.enabled, true);
		assert.equal(effectiveRemoteMode(config), "sandbox");
		const { code } = service.createDeviceCode("room-a", "agent-1");
		const { token, info } = service.redeemDeviceCode(code);
		assert.deepEqual(info.modules, ["sessions", "observe"]);
		assert.equal(service.listTokens("room-a").length, 1);
		assert.equal(service.status().connections, 1);
		const disabled = service.setRoomConfig("room-a", { enabled: false });
		assert.equal(disabled.enabled, false);
		assert.equal(service.listTokens("room-a")[0]?.revoked, true);
		assert.equal(service.status().connections, 0);
		assert.ok(token.startsWith("pibo_remote_"));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("pi runtime reports yolo and rejects unknown modules", () => {
	const service = createService();
	const config = service.setRoomConfig("room-a", { enabled: true, runtime: "pi", mode: "sandbox", sandboxPath: join(tmpdir(), "remote-pi-sandbox") });
	assert.equal(effectiveRemoteMode(config), "yolo");
	assert.throws(() => service.setRoomConfig("room-a", { modules: { subagents: true } }), (error) => error instanceof RemoteAgentError && error.code === "module_invalid");
	assert.throws(() => service.setRoomConfig("room-a", { mode: "party" }), (error) => error instanceof RemoteAgentError && error.code === "mode_invalid");
	rmSync(join(tmpdir(), "remote-pi-sandbox"), { recursive: true, force: true });
});

test("service starts the MCP server and reports its URL", async () => {
	const service = createService();
	assert.equal(service.status().running, false);
	const address = await service.ensureStarted();
	assert.match(address.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
	assert.equal(service.status().running, true);
	await service.stop();
	assert.equal(service.status().running, false);
});
