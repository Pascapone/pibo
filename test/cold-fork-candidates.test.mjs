import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PI_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/pi/adapter.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const persisted = [{ entryId: "past", text: "persisted user" }];
const live = [{ entryId: "live", text: "live user" }];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function routerFixture(run, { read = async () => persisted, state = "bound" } = {}) {
	let opens = 0;
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.lifecycle.fork = true;
	const driver = createFakeAgentRuntimeDriver({ adapterId: "cold-fork-fake", capabilities });
	const create = driver.create.bind(driver);
	driver.create = (input) => {
		const adapter = create(input);
		adapter.readForkCandidates = read;
		const open = adapter.openSession.bind(adapter);
		adapter.openSession = async (input) => {
			opens++;
			const session = await open(input);
			session.controls = { forkSession: async () => { throw Error("not used"); }, getForkCandidates: async () => live };
			return session;
		};
		return adapter;
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin, definePiboPlugin({
		id: "test.cold-fork",
		register(api) {
			api.registerAgentRuntimeDriver(driver);
			api.registerAgentRuntimeInstance({ id: "cold-fork", adapterId: "cold-fork-fake" });
			api.registerProfile({ name: "cold-fork", create() {
				return new InitialSessionContextBuilder("cold-fork").withAgentRuntime("cold-fork")
					.withBuiltinTools("disabled").withAutoContextFiles(false).withToolPackages({ goalControl: false }).createSession();
			} });
		},
	})] });
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_cold_fork", channel: "test", kind: "chat", profile: "cold-fork",
		runtimeBinding: { runtimeInstanceId: "cold-fork", adapterId: "cold-fork-fake", nativeSessionId: "native", state } });
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try { await run({ router, store, opens: () => opens }); }
	finally { await router.disposeAll(); }
}

test("cold persisted fork inspection does not open a runtime or change the binding", async () => {
	await routerFixture(async ({ router, store, opens }) => {
		const before = store.get("ps_cold_fork").runtimeBinding;
		assert.deepEqual(await router.getSessionForkCandidates("ps_cold_fork"), persisted);
		assert.equal(opens(), 0);
		assert.equal(router.getSessionRuntimeStatus("ps_cold_fork"), undefined);
		assert.deepEqual(store.get("ps_cold_fork").runtimeBinding, before);
	});
});

test("passive header status does not activate or retain idle runtimes", async () => {
	await routerFixture(async ({ router, opens }) => {
		assert.equal(await router.getSessionStatusSnapshot("ps_cold_fork", { activate: false }), undefined);
		assert.equal(opens(), 0);
		const explicit = await router.getSessionStatusSnapshot("ps_cold_fork");
		assert.equal(explicit.piboSessionId, "ps_cold_fork");
		const timer = router.idleSessionTimers.get("ps_cold_fork");
		assert.ok(timer);
		const passive = await router.getSessionStatusSnapshot("ps_cold_fork", { activate: false });
		assert.equal(passive.piboSessionId, "ps_cold_fork");
		assert.equal(opens(), 1);
		assert.equal(router.idleSessionTimers.get("ps_cold_fork"), timer, "polling must not indefinitely retain the runtime");
	});
});

test("unsupported persisted reads retain the live runtime fallback", async () => {
	for (const state of ["bound", "unbound"]) {
		await routerFixture(async ({ router, opens }) => {
			assert.deepEqual(await router.getSessionForkCandidates("ps_cold_fork"), live);
			assert.equal(opens(), 1);
		}, { read: async () => undefined, state });
	}
});

test("a runtime opened during persisted inspection wins over the stale candidate result", async () => {
	const started = deferred();
	const pending = deferred();
	await routerFixture(async ({ router, opens }) => {
		const candidates = router.getSessionForkCandidates("ps_cold_fork");
		await started.promise;
		await router.getSessionStatusSnapshot("ps_cold_fork");
		pending.resolve();
		assert.deepEqual(await candidates, live);
		assert.deepEqual(await router.getSessionForkCandidates("ps_cold_fork"), live);
		assert.equal(opens(), 1);
	}, { read: async () => { started.resolve(); await pending.promise; return persisted; } });
});

test("Pi persisted fork candidates preserve all user entries and text without rewriting native history", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-cold-fork-"));
	const path = join(root, "native.jsonl");
	const adapter = PI_AGENT_RUNTIME_DRIVER.create({ instanceId: "pi", enabled: true, config: {} });
	const input = { workspace: root, binding: { piboSessionId: "ps_fixture", runtimeInstanceId: "pi", adapterId: "pi", nativeSessionId: "native", state: "bound", locator: { kind: "local-file", value: path } } };
	const header = { type: "session", version: 3, id: "native", timestamp: "2026-09-05T00:00:00Z", cwd: root };
	const user = (id, content) => ({ type: "message", id, parentId: null, timestamp: "2026-09-05T00:00:01Z", message: { role: "user", content } });
	const entries = [header, user("a", "repeat"), user("b", [{ type: "text", text: "one" }, { type: "image", data: "ignored", mimeType: "image/png" }, { type: "text", text: "two" }]),
		{ ...user("assistant", "not a user"), message: { role: "assistant", content: "not a user" } }, user("image-only", [{ type: "image", data: "ignored", mimeType: "image/png" }]),
		{ type: "branch_summary", id: "branch", parentId: "a", summary: "branch" }, user("c", "repeat")];
	const original = entries.map(JSON.stringify).join("\n") + "\n{malformed}\n";
	try {
		await writeFile(path, original);
		assert.equal(typeof adapter.readForkCandidates, "function");
		assert.deepEqual(await adapter.readForkCandidates(input), [{ entryId: "a", text: "repeat" }, { entryId: "b", text: "onetwo" }, { entryId: "c", text: "repeat" }]);
		assert.equal(await readFile(path, "utf8"), original);
		const cached = await adapter.readForkCandidates(input);
		cached[0].text = "caller mutation";
		assert.equal((await adapter.readForkCandidates(input))[0].text, "repeat", "cache does not expose mutable shared candidates");
		const before = await stat(path);
		await writeFile(path, original.replace("repeat", "update"));
		await utimes(path, before.atime, before.mtime);
		assert.equal((await adapter.readForkCandidates(input))[0].text, "update", "same-size rewrites invalidate even when mtime is restored");
		await writeFile(path, [header, user("fresh", "new user")].map(JSON.stringify).join("\n"));
		assert.deepEqual(await adapter.readForkCandidates(input), [{ entryId: "fresh", text: "new user" }]);
		await writeFile(path, [{ ...header, version: 1 }, user("a", "old")].map(JSON.stringify).join("\n"));
		assert.equal(await adapter.readForkCandidates(input), undefined, "legacy migrations belong to the runtime");
		await writeFile(path, JSON.stringify({ ...header, id: "other" }));
		assert.equal(await adapter.readForkCandidates(input), undefined, "never accept another native session");
	} finally { await rm(root, { recursive: true, force: true }); }
});
