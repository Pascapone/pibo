import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  InMemoryPiboSessionStore,
  RuntimeSessionBindingConflictError,
  RuntimeSessionBindingTransitionError,
  createPiboSession,
} from "../dist/index.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";

function codexBinding(runtimeInstanceId = "codex-native", adapterId = "codex") {
  return { runtimeInstanceId, adapterId, state: "unbound", protocol: "codex-app-server" };
}

function bind(store, session, nativeSessionId, options = {}) {
  return store.updateRuntimeBinding(session.id, {
    ...session.runtimeBinding,
    piboSessionId: session.id,
    nativeSessionId,
    state: "bound",
  }, { expectedRevision: session.runtimeBinding.revision, ...options });
}

test("session creation freezes an unbound runtime selection and keeps Pi compatibility additive", () => {
  const pi = createPiboSession({ channel: "test", kind: "chat", profile: "base" }, "2026-08-15T00:00:00.000Z");
  assert.match(pi.piSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(pi.runtimeBinding, {
    piboSessionId: pi.id,
    runtimeInstanceId: "pi",
    adapterId: "pi",
    nativeSessionId: pi.piSessionId,
    state: "unbound",
    protocol: "pi-sdk",
    protocolVersion: undefined,
    adapterVersion: undefined,
    locator: undefined,
    metadata: {},
    revision: 1,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  });

  const codex = createPiboSession({
    channel: "test",
    kind: "chat",
    profile: "codex-native",
    runtimeBinding: codexBinding(),
  }, "2026-08-15T00:00:01.000Z");
  assert.equal(codex.piSessionId, "");
  assert.equal(codex.runtimeBinding.runtimeInstanceId, "codex-native");
  assert.equal(codex.runtimeBinding.adapterId, "codex");
  assert.equal(codex.runtimeBinding.nativeSessionId, undefined);
  assert.equal(codex.runtimeBinding.state, "unbound");
});

const storeFactories = [
  {
    name: "in-memory",
    async create() {
      return { store: new InMemoryPiboSessionStore(), async cleanup() {} };
    },
  },
  {
    name: "legacy sqlite",
    async create() {
      const dir = await mkdtemp(join(tmpdir(), "pibo-binding-legacy-"));
      const store = new SqlitePiboSessionStore(join(dir, "sessions.sqlite"));
      return { store, async cleanup() { store.close(); await rm(dir, { recursive: true, force: true }); } };
    },
  },
  {
    name: "pibo data",
    async create() {
      const dir = await mkdtemp(join(tmpdir(), "pibo-binding-data-"));
      const store = new PiboDataSessionStore(join(dir, "pibo.sqlite"));
      return { store, async cleanup() { store.close(); await rm(dir, { recursive: true, force: true }); } };
    },
  },
];

for (const factory of storeFactories) {
  test(`${factory.name} runtime bindings support CAS, missing diagnostics, repair, and adapter-scoped uniqueness`, async () => {
    const { store, cleanup } = await factory.create();
    try {
      const created = store.create({
        id: `ps_${factory.name.replaceAll(" ", "_")}_one`,
        channel: "test",
        kind: "chat",
        profile: "codex-native",
        runtimeBinding: codexBinding(),
      });
      assert.equal(created.piSessionId, "");
      assert.equal(created.runtimeBinding.state, "unbound");
      assert.equal(created.runtimeBinding.revision, 1);

      assert.throws(
        () => store.updateRuntimeBinding(created.id, {
          ...created.runtimeBinding,
          nativeSessionId: "thread-one",
          state: "bound",
        }),
        RuntimeSessionBindingTransitionError,
      );

      const bound = bind(store, created, "thread-one");
      assert.equal(bound.state, "bound");
      assert.equal(bound.nativeSessionId, "thread-one");
      assert.equal(bound.revision, 2);
      assert.equal(store.get(created.id).piSessionId, "");

      assert.throws(
        () => store.updateRuntimeBinding(created.id, { ...bound, metadata: { stale: true } }, { expectedRevision: 1 }),
        RuntimeSessionBindingConflictError,
      );

      const missing = store.updateRuntimeBinding(created.id, { ...bound, state: "missing" }, { expectedRevision: 2 });
      assert.equal(missing.state, "missing");
      assert.equal(missing.revision, 3);
      assert.throws(
        () => store.updateRuntimeBinding(created.id, { ...missing, state: "bound" }, { expectedRevision: 3 }),
        RuntimeSessionBindingTransitionError,
      );
      const repaired = store.updateRuntimeBinding(
        created.id,
        { ...missing, state: "bound" },
        { expectedRevision: 3, mode: "repair" },
      );
      assert.equal(repaired.state, "bound");
      assert.equal(repaired.revision, 4);

      const duplicate = store.create({
        id: `ps_${factory.name.replaceAll(" ", "_")}_duplicate`,
        channel: "test",
        kind: "chat",
        profile: "codex-native",
        runtimeBinding: codexBinding("codex-secondary"),
      });
      assert.throws(
        () => bind(store, duplicate, "thread-one"),
        /already attached|UNIQUE constraint failed/,
      );

      const otherAdapter = store.create({
        id: `ps_${factory.name.replaceAll(" ", "_")}_other_adapter`,
        channel: "test",
        kind: "chat",
        profile: "other-native",
        runtimeBinding: codexBinding("other-native", "other"),
      });
      const otherBound = bind(store, otherAdapter, "thread-one");
      assert.equal(otherBound.adapterId, "other");
      assert.equal(otherBound.nativeSessionId, "thread-one");
    } finally {
      await cleanup();
    }
  });

  test(`${factory.name} Pi binding writes dual-write the deprecated Pi id`, async () => {
    const { store, cleanup } = await factory.create();
    try {
      const created = store.create({ id: `ps_pi_${factory.name.replaceAll(" ", "_")}`, channel: "test", kind: "chat", profile: "base" });
      const bound = bind(store, created, created.piSessionId);
      assert.equal(bound.adapterId, "pi");
      assert.equal(bound.state, "bound");
      assert.equal(store.get(created.id).piSessionId, created.piSessionId);

      const changed = store.update(created.id, { piSessionId: `${created.piSessionId}-moved` });
      assert.equal(changed.runtimeBinding.adapterId, "pi");
      assert.equal(changed.runtimeBinding.nativeSessionId, `${created.piSessionId}-moved`);
      assert.equal(changed.runtimeBinding.state, "bound");
    } finally {
      await cleanup();
    }
  });
}

test("legacy sqlite migration backfills bound Pi rows and makes the compatibility Pi column nullable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pibo-binding-old-sqlite-"));
  const dbPath = join(dir, "sessions.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE pibo_sessions (
      id TEXT PRIMARY KEY,
      pi_session_id TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      profile TEXT NOT NULL,
      parent_id TEXT,
      origin_id TEXT,
      workspace TEXT,
      title TEXT,
      metadata_json TEXT,
      active_model_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO pibo_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "ps_old", "pi-old", "test", "chat", "base", null, null, "/tmp", "Old", "{}", null,
    "2026-08-14T00:00:00.000Z", "2026-08-14T00:01:00.000Z",
  );
  db.close();

  const store = new SqlitePiboSessionStore(dbPath);
  try {
    const old = store.get("ps_old");
    assert.equal(old.piSessionId, "pi-old");
    assert.equal(old.runtimeBinding.adapterId, "pi");
    assert.equal(old.runtimeBinding.nativeSessionId, "pi-old");
    assert.equal(old.runtimeBinding.state, "bound");

    const nonPi = store.create({
      id: "ps_codex",
      channel: "test",
      kind: "chat",
      profile: "codex-native",
      runtimeBinding: codexBinding(),
    });
    assert.equal(nonPi.piSessionId, "");
  } finally {
    store.close();
  }

  const verify = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const piColumn = verify.prepare("PRAGMA table_info(pibo_sessions)").all().find((column) => column.name === "pi_session_id");
    assert.equal(piColumn.notnull, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM pibo_session_runtime_bindings").get().count, 2);
  } finally {
    verify.close();
    await rm(dir, { recursive: true, force: true });
  }
});
