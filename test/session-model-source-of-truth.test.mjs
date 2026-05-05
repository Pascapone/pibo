import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { InitialSessionContext } from "../dist/core/profiles.js";
import { resolvePiboSessionActiveModel } from "../dist/core/session-model.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";

const gpt = { provider: "openai", id: "gpt-5" };
const kimi = { provider: "moonshot", id: "kimi-k2" };
const subagent = { provider: "anthropic", id: "claude-sonnet-5" };

function tmpPath(name) {
	const dir = join(tmpdir(), `pibo-session-model-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return { dir, path: join(dir, name) };
}

test("new sessions freeze the current default as activeModel", () => {
	const store = new InMemoryPiboSessionStore();
	const profile = new InitialSessionContext({ profileName: "default" });
	const first = store.create({ channel: "test", kind: "chat", profile: "default" });
	const firstModel = resolvePiboSessionActiveModel({ profile, piboSession: first, modelDefaults: { main: gpt } });
	store.update(first.id, { activeModel: firstModel });

	const second = store.create({ channel: "test", kind: "chat", profile: "default" });
	const secondModel = resolvePiboSessionActiveModel({ profile, piboSession: second, modelDefaults: { main: kimi } });
	store.update(second.id, { activeModel: secondModel });

	assert.deepEqual(store.get(first.id).activeModel, gpt);
	assert.deepEqual(store.get(second.id).activeModel, kimi);
});

test("existing session activeModel wins over changed defaults", () => {
	const profile = new InitialSessionContext({ profileName: "default" });
	const store = new InMemoryPiboSessionStore();
	const session = store.create({ channel: "test", kind: "chat", profile: "default", activeModel: gpt });

	assert.deepEqual(
		resolvePiboSessionActiveModel({ profile, piboSession: session, modelDefaults: { main: kimi } }),
		gpt,
	);
});

test("subagent sessions resolve subagent defaults when first frozen", () => {
	const profile = new InitialSessionContext({ profileName: "child" });
	const store = new InMemoryPiboSessionStore();
	const session = store.create({ channel: "test", kind: "subagent", profile: "child" });

	assert.deepEqual(
		resolvePiboSessionActiveModel({
			profile,
			piboSession: session,
			parentPiSessionId: "parent-pi-session",
			modelDefaults: { main: gpt, subagent },
		}),
		subagent,
	);
});

test("sqlite session store persists activeModel across reopen", () => {
	const { dir, path } = tmpPath("sessions.sqlite");
	try {
		let store = new SqlitePiboSessionStore(path);
		const created = store.create({ channel: "test", kind: "chat", profile: "default", activeModel: gpt });
		store.close();

		store = new SqlitePiboSessionStore(path);
		assert.deepEqual(store.get(created.id).activeModel, gpt);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("sqlite session store migrates older tables and lazy backfills activeModel", () => {
	const { dir, path } = tmpPath("old-sessions.sqlite");
	try {
		const db = new DatabaseSync(path);
		db.exec(`
			CREATE TABLE pibo_sessions (
				id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL UNIQUE,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				profile TEXT NOT NULL,
				owner_scope TEXT,
				parent_id TEXT,
				origin_id TEXT,
				workspace TEXT,
				title TEXT,
				metadata_json TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
		db.prepare("INSERT INTO pibo_sessions (id, pi_session_id, channel, kind, profile, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.run("ps_old", "pi_old", "test", "chat", "default", "{}", "2026-05-05T00:00:00.000Z", "2026-05-05T00:00:00.000Z");
		db.close();

		const store = new SqlitePiboSessionStore(path);
		assert.equal(store.get("ps_old").activeModel, undefined);
		store.update("ps_old", { activeModel: gpt });
		assert.deepEqual(store.get("ps_old").activeModel, gpt);
		store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
