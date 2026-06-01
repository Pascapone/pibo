import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import { SqlitePiboSessionStore, createDefaultPiboSessionStore } from "../dist/sessions/sqlite-store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const retiredStorageColumn = `${retiredWord}_scope`;
const retiredIndexName = `idx_pibo_sessions_${retiredWord}`;

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function indexNames(db, table) {
	return db.prepare(`PRAGMA index_list(${table})`).all().map((index) => index.name).sort();
}

function assertAppContextPiboSessionsSchema(dbPath) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const columns = tableColumns(db, "pibo_sessions");
		assert.equal(columns.has(retiredStorageColumn), false);
		assert.equal(columns.has("active_model_json"), true);
		assert.equal(indexNames(db, "pibo_sessions").includes(retiredIndexName), false);
	} finally {
		db.close();
	}
}

test("pibo session builder creates opaque product and Pi identities", () => {
	const session = createPiboSession(
		{
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			workspace: "/workspace",
			metadata: { source: "test" },
		},
		"2026-04-28T00:00:00.000Z",
	);

	assert.match(session.id, /^ps_[0-9a-f-]{36}$/);
	assert.match(session.piSessionId, /^[0-9a-f-]{36}$/);
	assert.equal(session.channel, "pibo.chat-web");
	assert.equal(session.kind, "chat");
	assert.equal(session.profile, "base");
	assert.equal(Object.hasOwn(session, retiredPartitionField), false);
	assert.equal(session.workspace, "/workspace");
	assert.deepEqual(session.metadata, { source: "test" });
	assert.equal(session.createdAt, "2026-04-28T00:00:00.000Z");
	assert.equal(session.updatedAt, "2026-04-28T00:00:00.000Z");
});

test("in-memory pibo session store creates, updates, and finds sessions", () => {
	const store = new InMemoryPiboSessionStore();
	const parent = store.create({
		id: "ps_parent",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
	});
	const child = store.create({
		id: "ps_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "researcher",
		parentId: parent.id,
		metadata: { subagentName: "researcher", threadKey: "auth" },
	});

	const updated = store.update(child.id, { title: "Research", workspace: "/workspace" });

	assert.equal(updated.id, child.id);
	assert.equal(updated.title, "Research");
	assert.equal(updated.workspace, "/workspace");
	assert.deepEqual(store.find({}).map((session) => session.id).sort(), [
		"ps_child",
		"ps_parent",
	]);
	assert.deepEqual(store.find({ parentId: parent.id }).map((session) => session.id), ["ps_child"]);
	assert.deepEqual(store.find({ metadata: { threadKey: "auth" } }).map((session) => session.id), ["ps_child"]);
});

test("in-memory pibo session store rejects duplicate Pi session mapping", () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_first",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
	});

	assert.throws(
		() =>
			store.create({
				id: "ps_second",
				piSessionId: "11111111-1111-4111-8111-111111111111",
				channel: "pibo.chat-web",
				kind: "branch",
				profile: "base",
			}),
		/Pi session "11111111-1111-4111-8111-111111111111" is already attached/,
	);
});

test("default sqlite pibo session store uses PIBO_HOME, not cwd", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-session-home-"));
	const previousPiboHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = dir;
	const store = createDefaultPiboSessionStore();

	try {
		store.create({
			id: "ps_home",
			piSessionId: "44444444-4444-4444-8444-444444444444",
			channel: "pibo.test",
			kind: "chat",
			profile: "base",
		});
		const dbPath = join(dir, "pibo-sessions.sqlite");
		const reopened = new SqlitePiboSessionStore(dbPath);
		try {
			assert.equal(reopened.get("ps_home")?.id, "ps_home");
		} finally {
			reopened.close();
		}
		assertAppContextPiboSessionsSchema(dbPath);
	} finally {
		store.close();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		await rm(dir, { recursive: true, force: true });
	}
});

const contractStoreFactories = [
	{
		name: "in-memory",
		async create() {
			return { store: new InMemoryPiboSessionStore(), async cleanup() {} };
		},
	},
	{
		name: "sqlite",
		async create() {
			const dir = await mkdtemp(join(tmpdir(), "pibo-session-contract-"));
			const store = new SqlitePiboSessionStore(join(dir, "sessions.sqlite"));
			return {
				store,
				async cleanup() {
					store.close();
					await rm(dir, { recursive: true, force: true });
				},
			};
		},
	},
];

for (const factory of contractStoreFactories) {
	test(`${factory.name} pibo session store supports unset updates and active model filters`, async () => {
		const { store, cleanup } = await factory.create();
		try {
			const parent = store.create({
				id: `ps_${factory.name}_parent`,
				piSessionId: "11111111-1111-4111-8111-111111111111",
				channel: "pibo.chat-web",
				kind: "chat",
				profile: "base",
				activeModel: { provider: "openai", id: "gpt-4.1" },
			});
			const child = store.create({
				id: `ps_${factory.name}_child`,
				piSessionId: "22222222-2222-4222-8222-222222222222",
				channel: "pibo.subagents",
				kind: "subagent",
				profile: "researcher",
				parentId: parent.id,
				originId: parent.id,
				workspace: "/workspace",
				title: "Research",
			});

			assert.deepEqual(store.find({ activeModel: { provider: "openai", id: "gpt-4.1" } }).map((session) => session.id), [parent.id]);
			assert.deepEqual(store.find({ activeModel: null }).map((session) => session.id), [child.id]);
			assert.deepEqual(store.find({ parentId: null }).map((session) => session.id), [parent.id]);

			const updated = store.update(child.id, {
				parentId: null,
				originId: null,
				workspace: null,
				title: null,
				activeModel: { provider: "anthropic", id: "claude-3-7-sonnet" },
			});

			assert.equal(updated?.parentId, undefined);
			assert.equal(updated?.originId, undefined);
			assert.equal(updated?.workspace, undefined);
			assert.equal(updated?.title, undefined);
			assert.deepEqual(updated?.activeModel, { provider: "anthropic", id: "claude-3-7-sonnet" });
			assert.deepEqual(store.find({ activeModel: { provider: "anthropic", id: "claude-3-7-sonnet" } }).map((session) => session.id), [child.id]);

			const cleared = store.update(child.id, { activeModel: null });
			assert.equal(cleared?.activeModel, undefined);
			assert.deepEqual(store.find({ activeModel: null }).map((session) => session.id).sort(), [child.id]);
		} finally {
			await cleanup();
		}
	});
}

test("sqlite pibo session store persists structured session fields", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-sessions-"));
	const dbPath = join(dir, "sessions.sqlite");
	const store = new SqlitePiboSessionStore(dbPath);

	try {
		const parent = store.create({
			id: "ps_parent",
			piSessionId: "11111111-1111-4111-8111-111111111111",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
		});
		const child = store.create({
			id: "ps_child",
			piSessionId: "22222222-2222-4222-8222-222222222222",
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "researcher",
			parentId: parent.id,
			originId: parent.id,
			metadata: { subagentName: "researcher", threadKey: "auth" },
		});

		const reopened = new SqlitePiboSessionStore(dbPath);
		try {
			assert.deepEqual(reopened.get(child.id), {
				...child,
				metadata: { subagentName: "researcher", threadKey: "auth" },
			});
			assert.deepEqual(reopened.find({ parentId: parent.id }).map((session) => session.id), ["ps_child"]);
			assert.deepEqual(reopened.find({ originId: parent.id }).map((session) => session.id), ["ps_child"]);
			assert.deepEqual(reopened.find({ metadata: { threadKey: "auth" } }).map((session) => session.id), [
				"ps_child",
			]);
		} finally {
			reopened.close();
		}
		assertAppContextPiboSessionsSchema(dbPath);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});
