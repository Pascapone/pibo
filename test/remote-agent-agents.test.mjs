import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

// Isolate PIBO_HOME so the address file never touches the real home.
const isolatedHome = mkdtempSync(join(tmpdir(), "remote-agents-home-"));
process.env.PIBO_HOME = join(isolatedHome, ".pibo");
import { buildSessionModuleTools } from "../dist/remote-agent/modules/sessions.js";
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { RemoteAgentError } from "../dist/remote-agent/types.js";

function fakeSessionStore(captured) {
	const sessions = new Map();
	return {
		get: (id) => sessions.get(id),
		find: () => [...sessions.values()],
		create: (input) => {
			captured?.push(input);
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
const tempDirs = [isolatedHome];
after(async () => {
	for (const service of services.splice(0)) {
		await service.stop().catch(() => {});
		service.close();
	}
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createService(captured) {
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: ":memory:" }),
		sessionStore: fakeSessionStore(captured),
		dataStore: fakeDataStore,
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
	});
	services.push(service);
	return service;
}

function sandboxDir() {
	const dir = mkdtempSync(join(tmpdir(), "remote-agents-sb-"));
	tempDirs.push(dir);
	return dir;
}

test("room agents default by runtime family", () => {
	const service = createService();
	const muse = service.setRoomConfig("room-muse", { enabled: true, runtime: "muse", sandboxPath: sandboxDir() });
	assert.equal(muse.defaultProfile, "muse-native");
	assert.deepEqual(muse.allowedProfiles, ["muse-native"]);
	const pi = service.setRoomConfig("room-pi", { enabled: true, runtime: "pi", sandboxPath: sandboxDir() });
	assert.equal(pi.defaultProfile, "base");
	assert.deepEqual(pi.allowedProfiles, ["base"]);
	const agents = service.listRoomAgents("room-muse");
	assert.equal(agents.runtimeInstanceId, "muse-native");
	assert.deepEqual(agents.agents, [{ name: "muse-native", isDefault: true }]);
});

test("explicit agents round-trip and validate", () => {
	const service = createService();
	const config = service.setRoomConfig("room-a", {
		enabled: true,
		runtime: "muse",
		sandboxPath: sandboxDir(),
		defaultProfile: "muse-native",
		allowedProfiles: ["muse-native", "codex-native"],
	});
	assert.equal(config.defaultProfile, "muse-native");
	assert.deepEqual(config.allowedProfiles, ["muse-native", "codex-native"]);
	assert.throws(() => service.setRoomConfig("room-a", { defaultProfile: "  " }), (error) => error instanceof RemoteAgentError && error.code === "profile_invalid");
	assert.throws(() => service.setRoomConfig("room-a", { allowedProfiles: ["ok", "  "] }), (error) => error instanceof RemoteAgentError && error.code === "profile_invalid");
});

test("switching runtime family resets agents unless given explicitly", () => {
	const service = createService();
	service.setRoomConfig("room-a", { enabled: true, runtime: "muse", sandboxPath: sandboxDir(), defaultProfile: "muse-native", allowedProfiles: ["muse-native", "codex-native"] });
	const switched = service.setRoomConfig("room-a", { runtime: "pi" });
	assert.equal(switched.defaultProfile, "base");
	assert.deepEqual(switched.allowedProfiles, ["base"]);
	const kept = service.setRoomConfig("room-a", { runtime: "muse", defaultProfile: "muse-native", allowedProfiles: ["muse-native", "orp"] });
	assert.deepEqual(kept.allowedProfiles, ["muse-native", "orp"]);
});

test("legacy room configs migrate to agent columns", () => {
	const dir = mkdtempSync(join(tmpdir(), "remote-agents-legacy-"));
	tempDirs.push(dir);
	const file = join(dir, "legacy.sqlite");
	const raw = new DatabaseSync(file);
	raw.exec(`CREATE TABLE remote_room_config (room_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'sandbox', runtime TEXT NOT NULL DEFAULT 'muse', sandbox_path TEXT NOT NULL DEFAULT '', modules_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)`);
	raw.exec(`INSERT INTO remote_room_config (room_id, enabled, mode, runtime, sandbox_path, modules_json, updated_at) VALUES ('room-old', 1, 'sandbox', 'pi', '/tmp/x', '{}', '2026-01-01T00:00:00.000Z')`);
	raw.close();
	const store = new PiboRemoteAgentStore({ path: file });
	try {
		const config = store.getRoomConfig("room-old");
		assert.equal(config?.runtime, "pi");
		assert.equal(config?.defaultProfile, "");
		assert.deepEqual(config?.allowedProfiles, []);
	} finally {
		store.close();
	}
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: file }),
		sessionStore: fakeSessionStore(),
		dataStore: fakeDataStore,
		sendMessage: async () => ({ eventId: "ev_1" }),
	});
	services.push(service);
	const normalized = service.getRoomConfig("room-old");
	assert.equal(normalized.defaultProfile, "base");
	assert.deepEqual(normalized.allowedProfiles, ["base"]);
});

test("session creation applies the room default profile and runtime binding", () => {
	const captured = [];
	const service = createService(captured);
	service.setRoomConfig("room-muse", { enabled: true, runtime: "muse", sandboxPath: sandboxDir() });
	const created = service["sessionPort"].createRoomSession("room-muse", { title: "hello" });
	assert.equal(created.profile, "muse-native");
	assert.deepEqual(captured[0].runtimeBinding, { runtimeInstanceId: "muse-native", adapterId: "muse-native", state: "unbound", protocol: "muse-session-protocol" });
	service.setRoomConfig("room-pi", { enabled: true, runtime: "pi", sandboxPath: sandboxDir() });
	service["sessionPort"].createRoomSession("room-pi", {});
	assert.equal(captured[1].profile, "base");
	assert.deepEqual(captured[1].runtimeBinding, { runtimeInstanceId: "pi", adapterId: "pi", state: "unbound", protocol: "pi-sdk" });
});

test("session creation rejects profiles outside the allowed list", () => {
	const service = createService();
	service.setRoomConfig("room-a", { enabled: true, runtime: "muse", sandboxPath: sandboxDir(), allowedProfiles: ["muse-native"] });
	assert.throws(
		() => service["sessionPort"].createRoomSession("room-a", { profile: "base" }),
		(error) => error instanceof RemoteAgentError && error.code === "profile_forbidden",
	);
	const ok = service["sessionPort"].createRoomSession("room-a", { profile: "muse-native" });
	assert.equal(ok.profile, "muse-native");
});

test("agents tool lists approved agents with the default marked", async () => {
	const tools = buildSessionModuleTools({
		listRoomSessions: () => [],
		getRoomSession: () => undefined,
		createRoomSession: () => { throw new Error("not used"); },
		sendSessionMessage: async () => ({ eventId: "ev_1" }),
		listRoomAgents: () => ({ defaultProfile: "muse-native", runtime: "muse", runtimeInstanceId: "muse-native", agents: [{ name: "muse-native", isDefault: true }, { name: "codex-native", isDefault: false }] }),
	});
	const agents = tools.find((tool) => tool.name === "remote_session_agents");
	assert.ok(agents);
	assert.equal(agents.readOnly, true);
	const result = await agents.execute({}, { roomId: "room-a", tokenId: "rt_1", label: "t", mode: "sandbox", sandboxRoot: "/tmp", cwd: "/tmp", toolCallId: "tc_1" });
	assert.match(result.text, /muse-native \(default\)/);
	assert.match(result.text, /codex-native/);
	assert.deepEqual(result.details.defaultProfile, "muse-native");
});
