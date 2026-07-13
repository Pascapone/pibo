import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;

function createTestRegistry(actionName, execute) {
	return PiboPluginRegistry.create({
		plugins: [
			definePiboPlugin({
				id: `test.${actionName}`,
				register(api) {
					api.registerProfile({
						name: "test-profile",
						create() {
							return new InitialSessionContextBuilder("test-profile").withBuiltinTools("disabled").createSession();
						},
					});
					api.registerGatewayAction({ name: actionName, execute });
				},
			}),
		],
	});
}

function createStoredSession(store, overrides = {}) {
	return store.create({
		id: "ps_source",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "test-profile",
		workspace: process.cwd(),
		...overrides,
	});
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
		await delay(10);
	}
}

test("session router uses the Pibo session profile when creating a runtime", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_profile",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_profile",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("bash"), true);

		const current = await router.emit({
			type: "execution",
			piboSessionId: "ps_profile",
			action: "session.current",
		});
		assert.equal(current.type, "execution_result");
		assert.equal(current.result.piSessionId, "11111111-1111-4111-8111-111111111111");
	} finally {
		await router.disposeAll();
	}
});

test("session router creates implicit runtime sessions in the app context context", async () => {
	const store = new InMemoryPiboSessionStore();
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		const current = await router.emit({
			type: "execution",
			piboSessionId: "ps_implicit",
			action: "session.current",
		});
		const session = store.get("ps_implicit");

		assert.equal(current.type, "execution_result");
		assert.equal(Object.hasOwn(session, retiredPartitionField), false);
		assert.equal(current.result.cwd, homedir());
	} finally {
		await router.disposeAll();
	}
});

test("session router defaults runtimes to the user home workspace", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_home",
		piSessionId: "21111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		const current = await router.emit({
			type: "execution",
			piboSessionId: "ps_home",
			action: "session.current",
		});
		assert.equal(current.type, "execution_result");
		assert.equal(current.result.cwd, homedir());
	} finally {
		await router.disposeAll();
	}
});

test("session router applies product model defaults instead of workspace-local defaults", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-router-model-defaults-"));
	await mkdir(join(cwd, ".pibo"), { recursive: true });
	await writeFile(join(cwd, ".pibo/model-defaults.json"), JSON.stringify({
		main: { provider: "workspace-provider", id: "workspace-model" },
	}), "utf-8");

	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_model_defaults",
		piSessionId: "31111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		workspace: cwd,
	});
	const router = new PiboSessionRouter({
		cwd,
		persistSession: false,
		sessionStore: store,
		modelDefaults: () => ({ main: { provider: "product-provider", id: "product-model" } }),
	});

	try {
		await assert.rejects(
			router.emit({
				type: "execution",
				piboSessionId: "ps_model_defaults",
				action: "status",
			}),
			/product-provider\/product-model/,
		);
	} finally {
		await router.disposeAll();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("session router preserves selected Pi packages when creating a runtime", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-router-pi-package-"));
	const packageDir = join(cwd, "router-package");
	await mkdir(packageDir, { recursive: true });
	await writeFile(join(packageDir, "package.json"), JSON.stringify({
		name: "router-package",
		pi: { extensions: ["index.js"] },
	}), "utf-8");
	await writeFile(join(packageDir, "index.js"), `
export default function(pi) {
	pi.registerTool({
		name: "router_package_tool",
		label: "Router Package Tool",
		description: "Tool provided by a selected Pi package.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: "ok" }] };
		},
	});
}
`, "utf-8");
	upsertPiPackage({
		id: "router-package",
		name: "router-package",
		source: packageDir,
		installSpec: packageDir,
		resourceTypes: ["extension"],
		installStatus: "installed",
		installPath: packageDir,
		enabled: true,
		diagnostics: [],
	}, cwd);

	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-package",
				register(api) {
					api.registerProfile({
						name: "package-profile",
						create() {
							return new InitialSessionContextBuilder("package-profile")
								.withBuiltinTools("disabled")
								.withPiPackages([{ id: "router-package" }])
								.createSession();
						},
					});
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_package",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "package-profile",
		workspace: cwd,
	});
	const router = new PiboSessionRouter({
		cwd,
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("package-profile"),
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_package",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("router_package_tool"), true);
	} finally {
		await router.disposeAll();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("session router creates a visible branch Pibo session for clone operations", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const registry = createTestRegistry("session.clone", (context) => ({
		piboSessionId: context.piboSessionId,
		previous: {
			piSessionId: "11111111-1111-4111-8111-111111111111",
			sessionFile: "/tmp/old-session.jsonl",
			leafId: "old-leaf",
			cwd: "/workspace",
		},
		current: {
			piSessionId: "22222222-2222-4222-8222-222222222222",
			sessionFile: "/tmp/new-session.jsonl",
			leafId: "new-leaf",
			cwd: "/workspace",
		},
		cancelled: false,
	}));
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_source",
			action: "session.clone",
		});

		assert.equal(output.type, "execution_result");
		const branchId = output.result.piboSessionId;
		assert.notEqual(branchId, "ps_source");

		const source = store.get("ps_source");
		const branch = store.get(branchId);
		assert.equal(source.piSessionId, "11111111-1111-4111-8111-111111111111");
		assert.equal(branch.piSessionId, "22222222-2222-4222-8222-222222222222");
		assert.equal(branch.kind, "branch");
		assert.equal(branch.originId, "ps_source");
		assert.equal(branch.parentId, undefined);
		assert.equal(Object.hasOwn(branch, retiredPartitionField), false);
		assert.equal(branch.workspace, "/workspace");
		assert.equal(branch.metadata.originAction, "session.clone");
	} finally {
		await router.disposeAll();
	}
});

test("session router updates a Pibo session before emitting switch results", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const registry = createTestRegistry("session.switch", (context) => ({
		piboSessionId: context.piboSessionId,
		previous: {
			piSessionId: "11111111-1111-4111-8111-111111111111",
			leafId: null,
			cwd: "/workspace",
		},
		current: {
			piSessionId: "22222222-2222-4222-8222-222222222222",
			leafId: null,
			cwd: "/workspace/new",
		},
		cancelled: false,
	}));
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
	});
	let sessionAtResult;
	router.subscribe((event) => {
		if (event.type === "execution_result" && event.action === "session.switch") {
			sessionAtResult = store.get("ps_source");
		}
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_source",
			action: "session.switch",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(store.get("ps_source").piSessionId, "22222222-2222-4222-8222-222222222222");
		assert.equal(store.get("ps_source").workspace, "/workspace/new");
		assert.equal(sessionAtResult.piSessionId, "22222222-2222-4222-8222-222222222222");
	} finally {
		await router.disposeAll();
	}
});

test("runtime reopens an existing persisted session by profile session id", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-runtime-session-id-"));
	const piSessionId = "11111111-1111-4111-8111-111111111111";
	const profile = new InitialSessionContextBuilder("runtime-session-test")
		.withSessionId(piSessionId)
		.createSession();

	const first = await createPiboRuntime({ cwd, persistSession: true, profile });
	first.session.sessionManager.appendMessage({
		role: "user",
		content: "hello",
		timestamp: Date.now(),
	});
	first.session.sessionManager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		stopReason: "stop",
		timestamp: Date.now(),
	});
	const firstFile = first.session.sessionFile;
	await first.dispose();

	const second = await createPiboRuntime({ cwd, persistSession: true, profile });
	try {
		assert.equal(second.session.sessionFile, firstFile);
		assert.equal(second.session.sessionManager.getSessionId(), piSessionId);
	} finally {
		const currentFile = second.session.sessionFile;
		await second.dispose();
		await rm(cwd, { recursive: true, force: true });
		if (currentFile) await rm(dirname(currentFile), { recursive: true, force: true });
	}
});

test("session router evicts only idle routed runtimes and preserves yielded runs", async () => {
	let actionDelayMs = 0;
	const registry = createTestRegistry("wait", async () => {
		await delay(actionDelayMs);
		return { waited: actionDelayMs };
	});
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store, { id: "ps_idle" });
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
		routedSessionIdleTimeoutMs: 100,
	});

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_idle", action: "wait" });
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_idle", toolName: "bash" });
		actionDelayMs = 180;
		await delay(20);
		const activeAction = router.emit({ type: "execution", piboSessionId: "ps_idle", action: "wait" });
		await delay(120);
		assert.deepEqual(router.getPiboSessionIds(), ["ps_idle"]);
		await activeAction;

		await waitFor(() => router.getPiboSessionIds().length === 0);
		assert.ok(store.get("ps_idle"));
		assert.equal(router.runRegistry.status("ps_idle", run.runId).status, "running");
		router.runRegistry.cancel("ps_idle", run.runId);
	} finally {
		await router.disposeAll();
	}
});

test("dispose removes cached parent and child routed runtimes", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	store.create({
		id: "ps_child",
		piSessionId: "22222222-2222-4222-8222-222222222222",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_parent", action: "status" });
		await router.emit({ type: "execution", piboSessionId: "ps_child", action: "status" });
		assert.equal(router.getPiboSessionIds().length, 2);
		await router.emit({ type: "execution", piboSessionId: "ps_parent", action: "dispose" });
		assert.deepEqual(router.getPiboSessionIds(), []);
	} finally {
		await router.disposeAll();
	}
});

test("kill action disposes cached runtimes without cancelling yielded runs", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_kill_action",
		piSessionId: "33333333-3333-4333-8333-333333333333",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_kill_action", action: "status" });
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_kill_action", toolName: "bash" });
		const output = await router.emit({ type: "execution", piboSessionId: "ps_kill_action", action: "kill" });
		assert.deepEqual(output.result.killed, ["ps_kill_action"]);
		assert.deepEqual(router.getPiboSessionIds(), []);
		assert.equal(router.runRegistry.status("ps_kill_action", run.runId).status, "running");
		router.runRegistry.cancel("ps_kill_action", run.runId);
	} finally {
		await router.disposeAll();
	}
});

test("kill_all action disposes the runtime and cancels its yielded runs", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_kill_all_action",
		piSessionId: "44444444-4444-4444-8444-444444444444",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_kill_all_action", action: "status" });
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_kill_all_action", toolName: "bash" });
		await router.emit({ type: "execution", piboSessionId: "ps_kill_all_action", action: "kill_all" });
		assert.deepEqual(router.getPiboSessionIds(), []);
		assert.equal(router.runRegistry.status("ps_kill_all_action", run.runId).status, "cancelled");
	} finally {
		await router.disposeAll();
	}
});

test("kill cancels child sessions but not yielded runs", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	store.create({
		id: "ps_child",
		piSessionId: "22222222-2222-4222-8222-222222222222",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		await router.emit({
			type: "execution",
			piboSessionId: "ps_parent",
			action: "status",
		});
		await router.emit({
			type: "execution",
			piboSessionId: "ps_child",
			action: "status",
		});

		const run = router.runRegistry.startToolRun({
			controllerPiboSessionId: "ps_child",
			toolName: "bash",
		});
		assert.equal(run.status, "running");

		const result = await router.killSession("ps_parent");
		assert.deepEqual(result.killed.sort(), ["ps_child", "ps_parent"]);
		assert.deepEqual(result.cancelledRuns, []);
		assert.deepEqual(router.getPiboSessionIds(), []);

		assert.equal(router.runRegistry.status("ps_child", run.runId).status, "running");
		router.runRegistry.cancel("ps_child", run.runId);
	} finally {
		await router.disposeAll();
	}
});

test("session router flushes queued telemetry and rejects new work during disposal", async () => {
	const payloadRootDir = await mkdtemp(join(tmpdir(), "pibo-router-telemetry-payloads-"));
	const dataStore = new PiboDataStore(":memory:", { payloadRootDir });
	const sessionStore = new InMemoryPiboSessionStore();
	const stored = sessionStore.create({
		id: "ps_router_telemetry_flush",
		piSessionId: "33333333-3333-4333-8333-333333333333",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		metadata: { chatRoomId: "room_router_telemetry_flush" },
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore,
		telemetryStore: dataStore.telemetry,
	});
	const eventId = "evt_router_dispose_flush";
	const runtimeStatus = {
		piboSessionId: stored.id,
		queuedMessages: 0,
		processing: false,
		streaming: false,
		activeTools: [],
		enabledTools: [],
		cwd: process.cwd(),
		disposed: false,
	};

	try {
		router.telemetryRecorder.recordOutput({ type: "message_queued", piboSessionId: stored.id, eventId, queuedMessages: 1, text: "flush", source: "user" }, { session: stored, status: { ...runtimeStatus, queuedMessages: 1 } });
		router.telemetryRecorder.recordOutput({ type: "message_started", piboSessionId: stored.id, eventId, text: "flush", source: "user" }, { session: stored, status: runtimeStatus });
		router.telemetryRecorder.recordOutput({ type: "message_finished", piboSessionId: stored.id, eventId, source: "user" }, { session: stored, status: runtimeStatus });
		assert.equal(dataStore.telemetry.getTurnTimeline(eventId), undefined);

		await router.disposeAll();
		assert.equal(dataStore.telemetry.getTurnTimeline(eventId).turn.status, "ok");
		await assert.rejects(
			router.emit({ type: "execution", piboSessionId: stored.id, action: "status" }),
			/Pibo session router is disposed/,
		);
	} finally {
		await router.disposeAll();
		dataStore.close();
		await rm(payloadRootDir, { recursive: true, force: true });
	}
});

test("kill_all cancels child sessions and yielded runs recursively", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	store.create({
		id: "ps_child",
		piSessionId: "22222222-2222-4222-8222-222222222222",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		await router.emit({
			type: "execution",
			piboSessionId: "ps_parent",
			action: "status",
		});
		await router.emit({
			type: "execution",
			piboSessionId: "ps_child",
			action: "status",
		});

		const childRun = router.runRegistry.startToolRun({
			controllerPiboSessionId: "ps_child",
			toolName: "bash",
		});
		const parentRun = router.runRegistry.startToolRun({
			controllerPiboSessionId: "ps_parent",
			toolName: "bash",
		});

		const result = await router.killSession("ps_parent", { includeRuns: true });
		assert.deepEqual(result.killed.sort(), ["ps_child", "ps_parent"]);
		assert.equal(result.cancelledRuns.length, 2);
		assert.ok(result.cancelledRuns.includes(childRun.runId));
		assert.ok(result.cancelledRuns.includes(parentRun.runId));
		assert.deepEqual(router.getPiboSessionIds(), []);

		assert.equal(router.runRegistry.status("ps_child", childRun.runId).status, "cancelled");
		assert.equal(router.runRegistry.status("ps_parent", parentRun.runId).status, "cancelled");
	} finally {
		await router.disposeAll();
	}
});
