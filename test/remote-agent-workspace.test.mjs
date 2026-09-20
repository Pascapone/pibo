import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Isolate PIBO_HOME so the address file never touches the real home.
const isolatedHome = mkdtempSync(join(tmpdir(), "remote-ws-home-"));
process.env.PIBO_HOME = join(isolatedHome, ".pibo");
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { getDefaultPiboWorkspace } from "../dist/core/workspace.js";

function roomRow(id, { workspace = null, metadata = {} } = {}) {
	return { id, name: id, topic: null, type: "chat", parent_room_id: null, workspace, retention_policy_id: null, metadata_json: JSON.stringify(metadata), created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

function fakeDataStore(rows) {
	return {
		messages: { listMessages: () => [] },
		observations: { listObservations: () => [] },
		db: { prepare: () => ({ get: (id) => rows[id] }) },
	};
}

function fakeSessionStore(captured) {
	const sessions = new Map();
	return {
		get: (id) => sessions.get(id),
		find: () => [...sessions.values()],
		create: (input) => {
			captured?.push(input);
			const session = { id: `ps_${sessions.size + 1}`, piSessionId: "", channel: input.channel, kind: input.kind, profile: input.profile, workspace: input.workspace, metadata: input.metadata ?? {}, createdAt: "2026-09-19T12:00:00.000Z", updatedAt: "2026-09-19T12:00:00.000Z" };
			sessions.set(session.id, session);
			return session;
		},
		update: () => undefined,
	};
}

const services = [];
const tempDirs = [isolatedHome];
after(async () => {
	for (const service of services.splice(0)) {
		await service.stop().catch(() => {});
		service.close();
	}
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createService({ rooms = {}, now, captured, resolveRoomWorkspace } = {}) {
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: ":memory:" }),
		sessionStore: fakeSessionStore(captured),
		dataStore: fakeDataStore(rooms),
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
		...(now ? { now } : {}),
		...(resolveRoomWorkspace ? { resolveRoomWorkspace } : {}),
	});
	services.push(service);
	return service;
}

function sandboxDir() {
	const dir = mkdtempSync(join(tmpdir(), "remote-ws-sb-"));
	tempDirs.push(dir);
	return dir;
}

test("default working directory follows the room workspace like UI sessions", () => {
	const rooms = {
		"room-meta": roomRow("room-meta", { metadata: { workspace: "/proj/from-meta" } }),
		"room-col": roomRow("room-col", { workspace: "/proj/from-col" }),
		"room-none": roomRow("room-none"),
	};
	const service = createService({ rooms });
	assert.equal(service.defaultSandboxPath("room-meta"), "/proj/from-meta");
	assert.equal(service.defaultSandboxPath("room-col"), "/proj/from-col");
	assert.equal(service.defaultSandboxPath("room-none"), getDefaultPiboWorkspace());
	assert.equal(service.defaultSandboxPath("room-unknown"), getDefaultPiboWorkspace());
});

test("explicit workspace resolver wins over the room workspace", () => {
	const rooms = { "room-a": roomRow("room-a", { workspace: "/proj/room" }) };
	const service = createService({ rooms, resolveRoomWorkspace: () => "/proj/override" });
	assert.equal(service.defaultSandboxPath("room-a"), "/proj/override");
});

test("empty stored path follows the room default, explicit override is kept", () => {
	const rooms = { "room-a": roomRow("room-a", { workspace: "/proj/room" }) };
	const service = createService({ rooms });
	const cleared = service.setRoomConfig("room-a", { enabled: true, sandboxPath: sandboxDir() });
	assert.ok(cleared.sandboxPath.length > 0);
	const follows = service.setRoomConfig("room-a", { sandboxPath: "" });
	assert.equal(follows.sandboxPath, "/proj/room");
	const custom = service.setRoomConfig("room-a", { sandboxPath: "/tmp/custom-override" });
	assert.equal(custom.sandboxPath, "/tmp/custom-override");
	assert.equal(service.getRoomConfig("room-a").sandboxPath, "/tmp/custom-override");
});

test("new sessions start with the resolved room directory in every mode", () => {
	const captured = [];
	const rooms = { "room-a": roomRow("room-a", { workspace: "/proj/room" }) };
	const service = createService({ rooms, captured });
	service.setRoomConfig("room-a", { enabled: true, mode: "sandbox", runtime: "muse", sandboxPath: "" });
	service.sessionPort.createRoomSession("room-a", {});
	assert.equal(captured[0].workspace, "/proj/room");
	service.setRoomConfig("room-a", { mode: "yolo" });
	service.sessionPort.createRoomSession("room-a", {});
	assert.equal(captured[1].workspace, "/proj/room");
});

test("tool context runs in the resolved room directory in every mode", () => {
	const rooms = { "room-a": roomRow("room-a", { workspace: "/proj/room" }) };
	const service = createService({ rooms });
	service.setRoomConfig("room-a", { enabled: true, mode: "sandbox", runtime: "muse", sandboxPath: "" });
	const scope = { tokenId: "rt_1", roomId: "room-a", label: "t", modules: ["sessions", "observe", "files", "bash"] };
	const sandbox = service.resolveContext(scope, "tc_1");
	assert.equal(sandbox.cwd, "/proj/room");
	assert.equal(sandbox.sandboxRoot, "/proj/room");
	service.setRoomConfig("room-a", { mode: "yolo" });
	const yolo = service.resolveContext(scope, "tc_2");
	assert.equal(yolo.cwd, "/proj/room");
	assert.equal(yolo.sandboxRoot, "/proj/room");
});
