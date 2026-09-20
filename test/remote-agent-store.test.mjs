import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REMOTE_MODULES, PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { effectiveRemoteMode } from "../dist/remote-agent/types.js";

test("room config defaults and upserts", () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	try {
		assert.equal(store.getRoomConfig("room-a"), undefined);
		const created = store.upsertRoomConfig("room-a", { enabled: true }, { sandboxPath: "/tmp/sb", now: "2026-09-19T12:00:00.000Z" });
		assert.equal(created.enabled, true);
		assert.equal(created.mode, "sandbox");
		assert.equal(created.runtime, "muse");
		assert.equal(created.sandboxPath, "/tmp/sb");
		assert.deepEqual(created.modules, DEFAULT_REMOTE_MODULES);
		const patched = store.upsertRoomConfig("room-a", { mode: "yolo", modules: { bash: true } }, { sandboxPath: "/tmp/ignored" });
		assert.equal(patched.mode, "yolo");
		assert.equal(patched.sandboxPath, "/tmp/sb");
		assert.equal(patched.modules.bash, true);
		assert.equal(patched.modules.sessions, true);
		assert.deepEqual(store.listEnabledRoomIds(), ["room-a"]);
	} finally {
		store.close();
	}
});

test("pi runtime is always effectively yolo", () => {
	assert.equal(effectiveRemoteMode({ mode: "sandbox", runtime: "muse" }), "sandbox");
	assert.equal(effectiveRemoteMode({ mode: "yolo", runtime: "muse" }), "yolo");
	assert.equal(effectiveRemoteMode({ mode: "sandbox", runtime: "pi" }), "yolo");
});

test("room token revocation is scoped to the room", () => {
	const store = new PiboRemoteAgentStore({ path: ":memory:" });
	try {
		store.insertToken({ id: "a1", tokenHash: "h1", label: "a", roomId: "room-a", modules: ["sessions"], createdAt: "2026-09-19T12:00:00.000Z", expiresAt: "2026-10-19T12:00:00.000Z" });
		store.insertToken({ id: "b1", tokenHash: "h2", label: "b", roomId: "room-b", modules: ["sessions"], createdAt: "2026-09-19T12:00:00.000Z", expiresAt: "2026-10-19T12:00:00.000Z" });
		assert.equal(store.revokeRoomTokens("room-a", "2026-09-19T13:00:00.000Z"), 1);
		assert.equal(store.getToken("a1")?.revoked, true);
		assert.equal(store.getToken("b1")?.revoked, false);
	} finally {
		store.close();
	}
});
