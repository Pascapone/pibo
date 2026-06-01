import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";

test("sqlite session find applies indexed filters before semantic matching", () => {
	const store = new SqlitePiboSessionStore(":memory:");
	try {
		store.create({ id: "a", piSessionId: "pa", channel: "web", kind: "chat", profile: "p1", metadata: { room: "r1" }, activeModel: { provider: "openai", id: "m1" } });
		store.create({ id: "b", piSessionId: "pb", channel: "web", kind: "chat", profile: "p2", parentId: "a", metadata: { room: "r2" } });

		assert.deepEqual(store.find({ profile: "p1" }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ parentId: null }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ parentId: "a" }).map((session) => session.id), ["b"]);
		assert.deepEqual(store.find({ ids: ["b", "missing"] }).map((session) => session.id), ["b"]);
		assert.deepEqual(store.find({ metadata: { room: "r1" } }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ activeModel: { provider: "openai", id: "m1" } }).map((session) => session.id), ["a"]);
	} finally {
		store.close();
	}
});
