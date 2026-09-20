import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

// Isolate PIBO_HOME: the adapter resolves the room posture from the default store path.
const isolatedHome = mkdtempSync(join(tmpdir(), "remote-internet-home-"));
process.env.PIBO_HOME = join(isolatedHome, ".pibo");

import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { MUSE_NATIVE_ADAPTER_ID, MUSE_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/muse-native/adapter.js";
import { parseMuseNativeRuntimeConfig } from "../dist/agent-runtimes/muse-native/config.js";
import { resolveMuseSandboxArgs } from "../dist/agent-runtimes/muse-native/process.js";
import {
	isRemoteAgentCreatedSession,
	resolveRemoteRoomSandboxNetwork,
} from "../dist/agent-runtimes/muse-native/remote-posture.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import {
	effectiveRemoteInternetAccess,
	REMOTE_AGENT_SESSION_METADATA_KEY,
	REMOTE_AGENT_TOOL_NAMES,
} from "../dist/remote-agent/types.js";
import { createPiboSession } from "../dist/sessions/store.js";

const closables = [];
after(async () => {
	for (const closable of closables.splice(0)) {
		await closable.stop?.().catch(() => {});
		closable.close?.();
	}
	rmSync(isolatedHome, { recursive: true, force: true });
});

test("effective remote internet access: yolo and pi are always on, sandbox uses the stored wish", () => {
	assert.equal(effectiveRemoteInternetAccess({ mode: "yolo", runtime: "muse", allowInternet: false }), true);
	assert.equal(effectiveRemoteInternetAccess({ mode: "yolo", runtime: "muse", allowInternet: true }), true);
	assert.equal(effectiveRemoteInternetAccess({ mode: "sandbox", runtime: "pi", allowInternet: false }), true);
	assert.equal(effectiveRemoteInternetAccess({ mode: "yolo", runtime: "pi", allowInternet: false }), true);
	assert.equal(effectiveRemoteInternetAccess({ mode: "sandbox", runtime: "muse", allowInternet: true }), true);
	assert.equal(effectiveRemoteInternetAccess({ mode: "sandbox", runtime: "muse", allowInternet: false }), false);
	assert.equal(effectiveRemoteInternetAccess({ mode: "sandbox", runtime: "muse" }), false);
});

test("room internet wish persists across reopen and survives yolo round-trips", () => {
	const dir = mkdtempSync(join(tmpdir(), "remote-internet-store-"));
	try {
		const dbPath = join(dir, "roundtrip.sqlite");
		const store = new PiboRemoteAgentStore({ path: dbPath });
		const created = store.upsertRoomConfig("room-x", { enabled: true }, { sandboxPath: "/tmp/sb" });
		assert.equal(created.allowInternet, false);
		store.upsertRoomConfig("room-x", { allowInternet: true }, { sandboxPath: "/tmp/sb" });
		store.close();
		const reopened = new PiboRemoteAgentStore({ path: dbPath });
		try {
			assert.equal(reopened.getRoomConfig("room-x")?.allowInternet, true);
			reopened.upsertRoomConfig("room-x", { mode: "yolo" }, { sandboxPath: "/tmp/sb" });
			assert.equal(reopened.getRoomConfig("room-x")?.allowInternet, true);
			assert.equal(effectiveRemoteInternetAccess(reopened.getRoomConfig("room-x")), true);
			reopened.upsertRoomConfig("room-x", { mode: "sandbox" }, { sandboxPath: "/tmp/sb" });
			assert.equal(effectiveRemoteInternetAccess(reopened.getRoomConfig("room-x")), true);
		} finally {
			reopened.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pre-feature room rows migrate with internet securely off", () => {
	const dir = mkdtempSync(join(tmpdir(), "remote-internet-migrate-"));
	try {
		const dbPath = join(dir, "legacy.sqlite");
		const raw = new DatabaseSync(dbPath);
		raw.exec(`CREATE TABLE remote_room_config (
			room_id TEXT PRIMARY KEY,
			enabled INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT 'sandbox',
			runtime TEXT NOT NULL DEFAULT 'muse',
			sandbox_path TEXT NOT NULL DEFAULT '',
			modules_json TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL
		)`);
		raw.exec(`INSERT INTO remote_room_config (room_id, enabled, mode, runtime, sandbox_path, modules_json, updated_at)
			VALUES ('old-room', 1, 'sandbox', 'muse', '/tmp/sb', '{}', '2026-09-19T12:00:00.000Z')`);
		raw.close();
		const store = new PiboRemoteAgentStore({ path: dbPath });
		try {
			const config = store.getRoomConfig("old-room");
			assert.equal(config?.enabled, true);
			assert.equal(config?.allowInternet, false);
			assert.equal(effectiveRemoteInternetAccess(config), false);
		} finally {
			store.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("muse sandbox args carry --sandbox-network only while the sandbox stays engaged", async () => {
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "enabled", workspace: "/work", executable: "muse", sandboxNetwork: "restricted" }),
		{ args: ["--sandbox-network", "restricted"] },
	);
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "enabled", workspace: "/work", executable: "muse", sandboxNetwork: "enabled" }),
		{ args: ["--sandbox-network", "enabled"] },
	);
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "enabled", workspace: "/work", executable: "muse" }),
		{ args: [] },
	);
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "disabled", workspace: "/work", executable: "muse", sandboxNetwork: "restricted" }),
		{ args: ["--disable-sandbox"] },
	);
	const degraded = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/work",
		executable: "/usr/local/bin/muse",
		platform: "linux",
		findExecutable: () => undefined,
		probeSandbox: async () => true,
		sandboxNetwork: "restricted",
	});
	assert.deepEqual(degraded.args, ["--disable-sandbox"]);
	const healthy = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/work",
		executable: "/usr/local/bin/muse",
		platform: "linux",
		findExecutable: (name) => (name === "bwrap" ? "/usr/bin/bwrap" : undefined),
		probeSandbox: async () => true,
		sandboxNetwork: "enabled",
	});
	assert.deepEqual(healthy, { args: ["--sandbox-network", "enabled"] });
});

test("room posture resolves only for remote-created sessions in enabled rooms", () => {
	assert.equal(isRemoteAgentCreatedSession({ [REMOTE_AGENT_SESSION_METADATA_KEY]: true }), true);
	assert.equal(isRemoteAgentCreatedSession({}), false);
	assert.equal(isRemoteAgentCreatedSession(undefined), false);
	assert.equal(resolveRemoteRoomSandboxNetwork({ createdByRemoteAgent: false, roomId: "room-a" }), undefined);
	assert.equal(resolveRemoteRoomSandboxNetwork({ createdByRemoteAgent: true }), undefined);
	assert.equal(
		resolveRemoteRoomSandboxNetwork({ createdByRemoteAgent: true, roomId: "room-a", storePath: join(isolatedHome, "no-such.sqlite") }),
		undefined,
	);
	assert.equal(existsSync(join(isolatedHome, "no-such.sqlite")), false);

	const dir = mkdtempSync(join(tmpdir(), "remote-internet-posture-"));
	try {
		const dbPath = join(dir, "posture.sqlite");
		const store = new PiboRemoteAgentStore({ path: dbPath });
		try {
			store.upsertRoomConfig("room-off", { enabled: true, mode: "sandbox" }, { sandboxPath: "/tmp/sb" });
			store.upsertRoomConfig("room-on", { enabled: true, mode: "sandbox", allowInternet: true }, { sandboxPath: "/tmp/sb" });
			store.upsertRoomConfig("room-yolo", { enabled: true, mode: "yolo" }, { sandboxPath: "/tmp/sb" });
			store.upsertRoomConfig("room-disabled", { enabled: false, mode: "sandbox", allowInternet: true }, { sandboxPath: "/tmp/sb" });
		} finally {
			store.close();
		}
		const resolve = (roomId) => resolveRemoteRoomSandboxNetwork({ createdByRemoteAgent: true, roomId, storePath: dbPath });
		assert.equal(resolve("room-off"), "restricted");
		assert.equal(resolve("room-on"), "enabled");
		assert.equal(resolve("room-yolo"), "enabled");
		assert.equal(resolve("room-disabled"), undefined);
		assert.equal(resolve("room-unknown"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

function fakeSessionStore() {
	const sessions = new Map();
	return {
		sessions,
		get: (id) => sessions.get(id),
		find: () => [...sessions.values()],
		create: (input) => {
			const session = {
				id: `ps_${sessions.size + 1}`,
				piSessionId: "",
				channel: input.channel,
				kind: input.kind,
				profile: input.profile,
				workspace: input.workspace,
				title: input.title,
				metadata: input.metadata ?? {},
				createdAt: "2026-09-19T12:00:00.000Z",
				updatedAt: "2026-09-19T12:00:00.000Z",
			};
			sessions.set(session.id, session);
			return session;
		},
		update: () => undefined,
	};
}

test("service validates the internet wish and stamps remote-created sessions", async () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	const sessionStore = fakeSessionStore();
	const service = new PiboRemoteAgentService({
		store,
		sessionStore,
		dataStore: { messages: { listMessages: () => [] }, observations: { listObservations: () => [] } },
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
	});
	closables.push(service, store);
	const sandbox = mkdtempSync(join(tmpdir(), "remote-internet-svc-"));
	try {
		service.setRoomConfig("room-m", { enabled: true, sandboxPath: sandbox });
		const config = service.setRoomConfig("room-m", { allowInternet: true });
		assert.equal(config.allowInternet, true);
		assert.throws(
			() => service.setRoomConfig("room-m", { allowInternet: "yes" }),
			(error) => error?.code === "internet_invalid",
		);
		const createTool = service.catalogTools().find((tool) => tool.name === REMOTE_AGENT_TOOL_NAMES.sessionCreate);
		const result = await createTool.execute({ title: "remote task" }, {
			roomId: "room-m",
			tokenId: "tok",
			label: "label",
			mode: "sandbox",
			sandboxRoot: sandbox,
			cwd: sandbox,
			toolCallId: "tc-1",
		});
		const created = sessionStore.get(result.details.session.id);
		assert.equal(created.metadata[REMOTE_AGENT_SESSION_METADATA_KEY], true);
		assert.equal(created.metadata.chatRoomId, "room-m");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

const fixturePath = fileURLToPath(new URL("./fixtures/muse-serve-fake.mjs", import.meta.url));

function seedDefaultStoreRoom(roomId, patch) {
	const store = new PiboRemoteAgentStore({});
	try {
		return store.upsertRoomConfig(roomId, patch, { sandboxPath: join(tmpdir(), `remote-e2e-${roomId}`) });
	} finally {
		store.close();
	}
}

async function openInternetE2ESession(t, { roomId, marked }) {
	const root = await mkdtemp(join(tmpdir(), "pibo-remote-internet-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	await chmod(fixturePath, 0o755);
	const fakeStateDir = join(root, "fake-state");
	process.env.MUSE_FAKE_STATE_DIR = fakeStateDir;
	const instanceId = `muse-native-e2e-${roomId}-${marked ? "marked" : "plain"}`;
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Internet E2E",
		config: parseMuseNativeRuntimeConfig({
			executable: fixturePath,
			homeRoot: join(root, "runtime-state"),
			environmentAllowlist: ["PATH", "MUSE_FAKE_STATE_DIR"],
			sandbox: "enabled",
			diagnosticTimeoutMs: 2_000,
			startupTimeoutMs: 5_000,
			requestTimeoutMs: 10_000,
			shutdownTimeoutMs: 500,
		}),
	});
	const selectedProfile = new InitialSessionContextBuilder(`profile-${instanceId}`)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const piboSession = createPiboSession({
		id: `ps_e2e_${roomId}_${marked ? "m" : "p"}`,
		channel: "test",
		kind: "chat",
		profile: selectedProfile.profileName,
		workspace: root,
		metadata: { chatRoomId: roomId, ...(marked ? { [REMOTE_AGENT_SESSION_METADATA_KEY]: true } : {}) },
	});
	const binding = {
		piboSessionId: piboSession.id,
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
	const session = await registry.openSession(instanceId, {
		piboSession,
		profile: selectedProfile,
		binding,
		workspace: root,
		productContext: { piboSessionId: piboSession.id, piboRoomId: roomId },
	});
	t.after(async () => {
		await session.dispose().catch(() => {});
	});
	const files = (await readdir(fakeStateDir)).filter((name) => name.endsWith(".args.json")).sort();
	const argSets = [];
	for (const file of files) argSets.push(JSON.parse(await readFile(join(fakeStateDir, file), "utf8")));
	return { session, argSets };
}

function networkFlag(argSets) {
	for (const args of argSets) {
		const index = args.indexOf("--sandbox-network");
		if (index >= 0) return args[index + 1];
	}
	return undefined;
}

test("muse host for sandbox+internet-off remote sessions starts restricted", async (t) => {
	seedDefaultStoreRoom("room-e2e-off", { enabled: true, mode: "sandbox" });
	const { session, argSets } = await openInternetE2ESession(t, { roomId: "room-e2e-off", marked: true });
	assert.equal(networkFlag(argSets), "restricted");
	assert.equal(session.controls.getSandbox?.().network, "restricted");
});

test("muse host for sandbox+internet-on remote sessions starts enabled", async (t) => {
	seedDefaultStoreRoom("room-e2e-on", { enabled: true, mode: "sandbox", allowInternet: true });
	const { session, argSets } = await openInternetE2ESession(t, { roomId: "room-e2e-on", marked: true });
	assert.equal(networkFlag(argSets), "enabled");
	assert.equal(session.controls.getSandbox?.().network, "enabled");
});

test("muse host for yolo remote sessions starts with internet on", async (t) => {
	seedDefaultStoreRoom("room-e2e-yolo", { enabled: true, mode: "yolo" });
	const { session, argSets } = await openInternetE2ESession(t, { roomId: "room-e2e-yolo", marked: true });
	assert.equal(networkFlag(argSets), "enabled");
	assert.equal(session.controls.getSandbox?.().network, "enabled");
});

test("interactive sessions in remote rooms keep the engine default", async (t) => {
	seedDefaultStoreRoom("room-e2e-off", { enabled: true, mode: "sandbox" });
	const { session, argSets } = await openInternetE2ESession(t, { roomId: "room-e2e-off", marked: false });
	assert.equal(networkFlag(argSets), undefined);
	assert.equal(session.controls.getSandbox?.().network, undefined);
});
