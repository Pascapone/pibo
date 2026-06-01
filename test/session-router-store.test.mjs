import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { PRE_CUTOVER_LEGACY_OWNER_SCOPE } from "../dist/owner-scope-compat.js";

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
		ownerScope: "user:test",
		workspace: process.cwd(),
		...overrides,
	});
}

test("session router uses the Pibo session profile when creating a runtime", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_profile",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		ownerScope: "user:test",
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

test("session router creates implicit runtime sessions in the shared app context", async () => {
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
		assert.equal(session.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
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
		ownerScope: "user:test",
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
		ownerScope: "user:test",
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
		ownerScope: "user:test",
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
		assert.equal(branch.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
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

test("kill cancels child sessions but not yielded runs", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		ownerScope: "user:test",
	});
	store.create({
		id: "ps_child",
		piSessionId: "22222222-2222-4222-8222-222222222222",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
		ownerScope: "user:test",
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
			ownerPiboSessionId: "ps_child",
			toolName: "bash",
		});
		assert.equal(run.status, "running");

		const result = await router.killSession("ps_parent");
		assert.deepEqual(result.killed.sort(), ["ps_child", "ps_parent"]);
		assert.deepEqual(result.cancelledRuns, []);

		assert.equal(router.runRegistry.status("ps_child", run.runId).status, "running");
		router.runRegistry.cancel("ps_child", run.runId);
	} finally {
		await router.disposeAll();
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
		ownerScope: "user:test",
	});
	store.create({
		id: "ps_child",
		piSessionId: "22222222-2222-4222-8222-222222222222",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
		ownerScope: "user:test",
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
			ownerPiboSessionId: "ps_child",
			toolName: "bash",
		});
		const parentRun = router.runRegistry.startToolRun({
			ownerPiboSessionId: "ps_parent",
			toolName: "bash",
		});

		const result = await router.killSession("ps_parent", { includeRuns: true });
		assert.deepEqual(result.killed.sort(), ["ps_child", "ps_parent"]);
		assert.equal(result.cancelledRuns.length, 2);
		assert.ok(result.cancelledRuns.includes(childRun.runId));
		assert.ok(result.cancelledRuns.includes(parentRun.runId));

		assert.equal(router.runRegistry.status("ps_child", childRun.runId).status, "cancelled");
		assert.equal(router.runRegistry.status("ps_parent", parentRun.runId).status, "cancelled");
	} finally {
		await router.disposeAll();
	}
});
