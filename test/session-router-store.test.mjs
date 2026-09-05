import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import test from "node:test";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { PiboSteeringUnavailableError } from "../dist/core/events.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
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

test("session router clears accepted signal activity when idle steering is rejected", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_idle_steer",
		piSessionId: "41111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
	});

	try {
		await assert.rejects(
			router.emit({
				type: "message",
				piboSessionId: "ps_idle_steer",
				id: "rejected-steer",
				text: "too late",
				source: "user",
				delivery: "steer",
			}),
			(error) => error instanceof PiboSteeringUnavailableError,
		);

		const snapshot = router.getSignalRegistry().snapshotTree("ps_idle_steer");
		assert.equal(snapshot.sessions.ps_idle_steer.localStatus, "idle");
		assert.equal(snapshot.sessions.ps_idle_steer.isTreeActive, false);
		assert.equal(snapshot.sessions.ps_idle_steer.latestTurn, undefined);
		assert.equal(snapshot.sessions.ps_idle_steer.activeTelemetry, undefined);
		assert.equal(snapshot.nodes["message:ps_idle_steer:rejected-steer"], undefined);
		assert.equal(snapshot.nodes["turn:ps_idle_steer:rejected-steer"], undefined);
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

test("snapshot fork persistence keeps the active source runtime attached", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const registry = createTestRegistry("session.fork", (context, event) => ({
		piboSessionId: context.piboSessionId,
		previous: {
			piSessionId: "11111111-1111-4111-8111-111111111111",
			leafId: "source-leaf",
			cwd: process.cwd(),
		},
		current: {
			piSessionId: "22222222-2222-4222-8222-222222222222",
			leafId: "fork-leaf",
			cwd: process.cwd(),
		},
		cancelled: false,
		sourceSessionUnchanged: true,
		selectedText: "completed prompt",
		summaryEntryId: event.params.entryId,
	}));
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
	});

	try {
		await router.getSessionStatusSnapshot("ps_source");
		const sourceRuntime = router.sessions.get("ps_source");
		assert.ok(sourceRuntime);
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_source",
			action: "session.fork",
			params: { entryId: "completed-user" },
		});
		assert.strictEqual(router.sessions.get("ps_source"), sourceRuntime, "snapshot fork must not reset the active source runtime");
		const branch = store.get(output.result.piboSessionId);
		assert.equal(branch.originId, "ps_source");
		assert.equal(branch.piSessionId, "22222222-2222-4222-8222-222222222222");
		assert.equal(store.get("ps_source").piSessionId, "11111111-1111-4111-8111-111111111111");
	} finally {
		await router.disposeAll();
	}
});

test("forking a named delegated session preserves lineage and title without copying managed-agent identity", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "01111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "test-profile",
	});
	createStoredSession(store, {
		channel: "pibo.subagents",
		kind: "subagent",
		parentId: "ps_parent",
		title: "Named delegated session",
		metadata: {
			workflowSessionKind: "subagent",
			subagentName: "researcher",
			subagentToolName: "pibo_agents_send_message",
			agentStatus: "active",
			threadKey: "stable-thread",
			chatRoomId: "room_1",
		},
	});
	const registry = createTestRegistry("session.fork", (context, event) => {
		const sourceFork = context.piboSessionId === "ps_source";
		return {
		piboSessionId: context.piboSessionId,
		previous: {
			piSessionId: sourceFork
				? "11111111-1111-4111-8111-111111111111"
				: "22222222-2222-4222-8222-222222222222",
			leafId: "old-leaf",
			cwd: "/workspace",
		},
		current: {
			piSessionId: sourceFork
				? "22222222-2222-4222-8222-222222222222"
				: "33333333-3333-4333-8333-333333333333",
			leafId: "fork-leaf",
			cwd: "/workspace",
		},
		cancelled: false,
		selectedText: "fork target",
		summaryEntryId: event.params.entryId,
		};
	});
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
			action: "session.fork",
			params: { entryId: "user-entry" },
		});
		const branch = store.get(output.result.piboSessionId);
		assert.equal(branch.kind, "branch");
		assert.equal(branch.parentId, "ps_parent");
		assert.equal(branch.originId, "ps_source");
		assert.equal(branch.title, "Named delegated session");
		assert.equal(branch.metadata.chatRoomId, "room_1");
		for (const key of ["workflowSessionKind", "subagentName", "subagentToolName", "agentStatus", "threadKey"]) {
			assert.equal(branch.metadata[key], undefined);
		}
		assert.deepEqual(
			store.find({ channel: "pibo.subagents", kind: "subagent", parentId: "ps_parent" }).map((session) => session.id),
			["ps_source"],
			"a named branch must not become a reusable delegated-agent session",
		);

		store.update("ps_source", { title: "Renamed delegated session" });
		assert.equal(store.get(branch.id).title, "Named delegated session", "branch titles are derivation snapshots, not shared identity");

		const nestedOutput = await router.emit({
			type: "execution",
			piboSessionId: branch.id,
			action: "session.fork",
			params: { entryId: "user-entry-2" },
		});
		const nestedBranch = store.get(nestedOutput.result.piboSessionId);
		assert.equal(nestedBranch.parentId, "ps_parent", "repeated forks retain delegated hierarchy");
		assert.equal(nestedBranch.originId, branch.id);
		assert.equal(nestedBranch.title, "Named delegated session");
	} finally {
		await router.disposeAll();
	}
});

test("session router discards a derived native handle when branch persistence fails", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const create = store.create.bind(store);
	store.create = (input) => {
		if (input.kind === "branch") throw new Error("derived persistence failed");
		return create(input);
	};
	const registry = createTestRegistry("session.clone", (context) => ({
		piboSessionId: context.piboSessionId,
		previous: {
			piSessionId: "11111111-1111-4111-8111-111111111111",
			leafId: "old-leaf",
			cwd: "/workspace",
		},
		current: {
			piSessionId: "22222222-2222-4222-8222-222222222222",
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
	const resetCachedSession = router.resetCachedSession.bind(router);
	let resets = 0;
	router.resetCachedSession = async (piboSessionId) => {
		resets += 1;
		await resetCachedSession(piboSessionId);
	};

	try {
		await assert.rejects(() => router.emit({
			type: "execution",
			piboSessionId: "ps_source",
			action: "session.clone",
		}), /derived persistence failed/);
		assert.equal(resets, 1);
		assert.equal(store.get("ps_source").piSessionId, "11111111-1111-4111-8111-111111111111");
		assert.equal(store.list().some((session) => session.kind === "branch"), false);
	} finally {
		await router.disposeAll();
	}
});

test("session router reconciles a branch that persisted exactly before create threw", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const create = store.create.bind(store);
	let ambiguousCreates = 0;
	store.create = (input) => {
		const created = create(input);
		if (input.kind === "branch") {
			ambiguousCreates += 1;
			throw new Error("storage acknowledgement lost after commit");
		}
		return created;
	};
	const registry = createTestRegistry("session.clone", (context) => ({
		piboSessionId: context.piboSessionId,
		previous: { piSessionId: "11111111-1111-4111-8111-111111111111", leafId: "old-leaf", cwd: "/workspace" },
		current: { piSessionId: "22222222-2222-4222-8222-222222222222", leafId: "new-leaf", cwd: "/workspace" },
		cancelled: false,
	}));
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
	});
	try {
		const output = await router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" });
		assert.equal(ambiguousCreates, 1);
		assert.equal(output.result.piboSessionId.startsWith("ps_"), true);
		assert.equal(store.get(output.result.piboSessionId).originId, "ps_source");
		assert.equal(store.list().filter((session) => session.kind === "branch").length, 1, "the committed branch is disclosed instead of duplicated on retry");
		assert.equal(store.get("ps_source").piSessionId, "11111111-1111-4111-8111-111111111111");
	} finally {
		await router.disposeAll();
	}
});

test("session router compensates an uninspectable commit before allowing a retry", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const create = store.create.bind(store);
	const get = store.get.bind(store);
	let firstAmbiguousBranchId;
	let failFirstReconciliationLookup = true;
	store.create = (input) => {
		const created = create(input);
		if (input.kind === "branch") {
			firstAmbiguousBranchId ??= input.id;
			throw new Error("commit acknowledgement unavailable");
		}
		return created;
	};
	store.get = (id) => {
		if (id === firstAmbiguousBranchId && failFirstReconciliationLookup) {
			failFirstReconciliationLookup = false;
			throw new Error("commit lookup unavailable");
		}
		return get(id);
	};
	let nativeClones = 0;
	const registry = createTestRegistry("session.clone", (context) => {
		nativeClones += 1;
		return {
			piboSessionId: context.piboSessionId,
			previous: { piSessionId: "11111111-1111-4111-8111-111111111111", leafId: "old-leaf", cwd: "/workspace" },
			current: { piSessionId: `22222222-2222-4222-8222-${String(nativeClones).padStart(12, "0")}`, leafId: "new-leaf", cwd: "/workspace" },
			cancelled: false,
		};
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store, pluginRegistry: registry, profile: registry.createProfile("test-profile") });
	try {
		await assert.rejects(
			() => router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" }),
			(error) => error instanceof AggregateError && /commit state could not be reconciled/.test(error.message),
		);
		assert.equal(store.list().filter((session) => session.kind === "branch").length, 1);

		const retry = await router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" });
		assert.equal(nativeClones, 2);
		assert.notEqual(retry.result.piboSessionId, firstAmbiguousBranchId);
		assert.equal(store.get(firstAmbiguousBranchId), undefined, "retry first compensates the undisclosed ambiguous branch");
		assert.equal(store.list().filter((session) => session.kind === "branch").length, 1, "retry leaves only its disclosed branch");
	} finally {
		await router.disposeAll();
	}
});

test("session router compensates mismatched post-commit branches before rejecting", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const create = store.create.bind(store);
	store.create = (input) => {
		if (input.kind !== "branch") return create(input);
		create({ ...input, title: "partially persisted wrong title" });
		throw new Error("branch create failed after a partial commit");
	};
	const registry = createTestRegistry("session.clone", (context) => ({
		piboSessionId: context.piboSessionId,
		previous: { piSessionId: "11111111-1111-4111-8111-111111111111", leafId: "old-leaf", cwd: "/workspace" },
		current: { piSessionId: "22222222-2222-4222-8222-222222222222", leafId: "new-leaf", cwd: "/workspace" },
		cancelled: false,
	}));
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store, pluginRegistry: registry, profile: registry.createProfile("test-profile") });
	try {
		await assert.rejects(
			() => router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" }),
			/branch create failed after a partial commit/,
		);
		assert.equal(store.list().some((session) => session.kind === "branch"), false, "mismatched state is removed before the caller can retry");
		assert.equal(store.get("ps_source").piSessionId, "11111111-1111-4111-8111-111111111111");
	} finally {
		await router.disposeAll();
	}
});

test("session router reports reconciliation cleanup failure without rebinding the source", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store);
	const create = store.create.bind(store);
	const remove = store.delete.bind(store);
	let induceAmbiguousCommit = true;
	store.create = (input) => {
		if (input.kind !== "branch" || !induceAmbiguousCommit) return create(input);
		create({ ...input, title: "incomplete branch" });
		throw new Error("ambiguous branch commit");
	};
	store.delete = () => { throw new Error("compensating delete unavailable"); };
	let nativeClones = 0;
	const registry = createTestRegistry("session.clone", (context) => {
		nativeClones += 1;
		return {
			piboSessionId: context.piboSessionId,
			previous: { piSessionId: "11111111-1111-4111-8111-111111111111", leafId: "old-leaf", cwd: "/workspace" },
			current: { piSessionId: "22222222-2222-4222-8222-222222222222", leafId: "new-leaf", cwd: "/workspace" },
			cancelled: false,
		};
	});
	const createRouter = () => new PiboSessionRouter({ persistSession: false, sessionStore: store, pluginRegistry: registry, profile: registry.createProfile("test-profile") });
	let router = createRouter();
	try {
		await assert.rejects(
			() => router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" }),
			(error) => error instanceof AggregateError
				&& /compensation failed/.test(error.message)
				&& /ps_/.test(error.message)
				&& error.errors.some((item) => /compensating delete unavailable/.test(item.message)),
		);
		assert.equal(store.get("ps_source").piSessionId, "11111111-1111-4111-8111-111111111111", "source ownership remains on the pre-clone native session");
		const residual = store.list().find((session) => session.kind === "branch");
		assert.ok(residual, "the residual branch is explicitly identified by the failure");
		assert.equal(residual.metadata["pibo.sessionIdentityReconciliation.v1"].state, "cleanup-required");

		await router.disposeAll();
		router = createRouter();
		await assert.rejects(
			() => router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" }),
			/refusing another session identity operation/,
		);
		assert.equal(nativeClones, 1, "a persisted residual marker blocks retry after router recovery and before another native branch is created");
		assert.equal(store.list().filter((session) => session.kind === "branch").length, 1);

		store.delete = remove;
		induceAmbiguousCommit = false;
		const retry = await router.emit({ type: "execution", piboSessionId: "ps_source", action: "session.clone" });
		assert.equal(nativeClones, 2);
		assert.equal(store.get(residual.id), undefined, "retry compensates the quarantined residual before native branching");
		assert.equal(store.get(retry.result.piboSessionId).originId, "ps_source");
		assert.equal(store.list().filter((session) => session.kind === "branch").length, 1, "only the disclosed retry branch remains");
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

test("idle runtime eviction keeps durable session signals reopenable", async () => {
	const registry = createTestRegistry("status", async () => ({ disposed: false }));
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store, { id: "ps_idle_signal" });
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		pluginRegistry: registry,
		profile: registry.createProfile("test-profile"),
		routedSessionIdleTimeoutMs: 20,
	});

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_idle_signal", action: "status" });
		await waitFor(() => router.getPiboSessionIds().length === 0);
		const afterEviction = router.snapshotSignalSession("ps_idle_signal").sessions.ps_idle_signal;
		assert.equal(afterEviction.localStatus, "idle");
		assert.equal(afterEviction.aggregateStatus, "idle");
		assert.ok(store.get("ps_idle_signal"));

		const reopened = await router.emit({ type: "execution", piboSessionId: "ps_idle_signal", action: "status" });
		assert.equal(reopened.result.disposed, false);
		const afterReopen = router.snapshotSignalSession("ps_idle_signal").sessions.ps_idle_signal;
		assert.equal(afterReopen.localStatus, "idle");
		assert.equal(afterReopen.aggregateStatus, "idle");
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

test("message acceptance starts a signal turn before cold runtime creation resolves", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_cold_message",
		piSessionId: "22222222-2222-4222-8222-222222222224",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		const pending = router.emit({ type: "message", piboSessionId: "ps_cold_message", id: "m-cold", text: "hi", source: "user" });
		const immediate = router.snapshotSignalSession("ps_cold_message").sessions.ps_cold_message;
		assert.equal(immediate.latestTurn.state, "running");
		assert.equal(immediate.latestTurn.eventId, "m-cold");
		assert.equal(immediate.localStatus, "running");
		await pending;
	} finally {
		await router.disposeAll();
	}
});

test("restart signal reconstruction roots nested sessions independently of store order", async (t) => {
	const createTopology = async (store, prefix, pauseMs = 0) => {
		const root = store.create({ id: `${prefix}_root`, channel: "pibo.test", kind: "chat", profile: "base" });
		if (pauseMs) await delay(pauseMs);
		const child = store.create({ id: `${prefix}_child`, channel: "pibo.subagents", kind: "subagent", profile: "base", parentId: root.id });
		if (pauseMs) await delay(pauseMs);
		const grandchild = store.create({ id: `${prefix}_grandchild`, channel: "pibo.subagents", kind: "subagent", profile: "base", parentId: child.id });
		return { root, child, grandchild };
	};
	const captureStatusActivity = async (router, topology) => {
		const statuses = router.snapshotSignalStatuses();
		const patchRoots = [];
		const unsubscribe = router.subscribeSignalStatuses((patch) => patchRoots.push(patch.rootPiboSessionId));
		try {
			router.getSignalRegistry().project({
				type: "session_processing_changed",
				piboSessionId: topology.grandchild.id,
				processing: true,
				queuedMessages: 0,
			});
			await Promise.resolve();
			await Promise.resolve();
		} finally {
			unsubscribe();
		}
		return {
			statusGrandchildRoot: statuses.sessions[topology.grandchild.id].rootPiboSessionId,
			rootVersionIds: Object.keys(statuses.rootVersions).sort(),
			patchRoots,
		};
	};

	const controlStore = new InMemoryPiboSessionStore();
	const controlTopology = await createTopology(controlStore, "ps_signal_control");
	const controlRouter = new PiboSessionRouter({ persistSession: false, sessionStore: controlStore });
	const controlTree = controlRouter.snapshotSignalTree(controlTopology.root.id);
	const control = await captureStatusActivity(controlRouter, controlTopology);
	await controlRouter.disposeAll();

	const root = await mkdtemp(join(tmpdir(), "pibo-signal-restart-reconstruction-"));
	const databasePath = join(root, "sessions.sqlite");
	let restartStore = new SqlitePiboSessionStore(databasePath);
	let restartRouter;
	t.after(async () => {
		await restartRouter?.disposeAll();
		restartStore.close();
		await rm(root, { recursive: true, force: true });
	});
	const restartTopology = await createTopology(restartStore, "ps_signal_restart", 10);
	restartStore.close();
	restartStore = new SqlitePiboSessionStore(databasePath);
	const storeOrder = restartStore.list().map((session) => session.id);
	restartRouter = new PiboSessionRouter({ persistSession: false, sessionStore: restartStore });
	const restartTree = restartRouter.snapshotSignalTree(restartTopology.root.id);
	await restartRouter.disposeAll();
	restartRouter = new PiboSessionRouter({ persistSession: false, sessionStore: restartStore });
	const restart = await captureStatusActivity(restartRouter, restartTopology);

	assert.deepEqual({
		storeOrder,
		controlTreeGrandchildRoot: controlTree.sessions[controlTopology.grandchild.id].rootPiboSessionId,
		control,
		restartTreeGrandchildRoot: restartTree.sessions[restartTopology.grandchild.id].rootPiboSessionId,
		restart,
	}, {
		storeOrder: [restartTopology.grandchild.id, restartTopology.child.id, restartTopology.root.id],
		controlTreeGrandchildRoot: controlTopology.root.id,
		control: {
			statusGrandchildRoot: controlTopology.root.id,
			rootVersionIds: [controlTopology.root.id],
			patchRoots: [controlTopology.root.id],
		},
		restartTreeGrandchildRoot: restartTopology.root.id,
		restart: {
			statusGrandchildRoot: restartTopology.root.id,
			rootVersionIds: [restartTopology.root.id],
			patchRoots: [restartTopology.root.id],
		},
	});
});

test("cached identity reservations reject queued messages before signal acceptance", async () => {
	const store = new InMemoryPiboSessionStore();
	createStoredSession(store, { id: "ps_identity_signal_admission", profile: "base" });
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_identity_signal_admission", action: "status" });
		const routed = router.sessions.get("ps_identity_signal_admission");
		assert.ok(routed);
		routed.sessionIdentityOperationInFlight = true;
		await assert.rejects(
			router.emit({
				type: "message",
				piboSessionId: "ps_identity_signal_admission",
				id: "m-identity-rejected",
				text: "must fail before acceptance",
				source: "user",
			}),
			/session identity operation is in progress/,
		);
		const rejected = router.snapshotSignalSession("ps_identity_signal_admission").sessions.ps_identity_signal_admission;
		assert.notEqual(rejected.latestTurn?.eventId, "m-identity-rejected");
		assert.equal(rejected.localStatus, "idle");

		routed.sessionIdentityOperationInFlight = false;
		await router.emit({
			type: "message",
			piboSessionId: "ps_identity_signal_admission",
			id: "m-after-identity",
			text: "accepted after reservation",
			source: "user",
		});
		const accepted = router.snapshotSignalSession("ps_identity_signal_admission").sessions.ps_identity_signal_admission;
		assert.equal(accepted.latestTurn.eventId, "m-after-identity");
	} finally {
		await router.disposeAll();
	}
});

test("cold runtime creation failure terminalizes the accepted signal turn", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_cold_failure",
		piSessionId: "22222222-2222-4222-8222-222222222225",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		modelDefaults: () => ({ main: { provider: "missing-provider", id: "missing-model" } }),
	});

	try {
		await assert.rejects(router.emit({ type: "message", piboSessionId: "ps_cold_failure", id: "m-failed", text: "hi", source: "user" }));
		const failed = router.snapshotSignalSession("ps_cold_failure").sessions.ps_cold_failure;
		assert.equal(failed.latestTurn.state, "failed");
		assert.equal(failed.isTreeActive, false);
	} finally {
		await router.disposeAll();
	}
});

test("abort action terminalizes the active turn before runtime abort work", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_abort_action",
		piSessionId: "22222222-2222-4222-8222-222222222223",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });

	try {
		await router.emit({ type: "execution", piboSessionId: "ps_abort_action", action: "status" });
		router.getSignalRegistry().project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "ps_abort_action", eventId: "m1", text: "hi" } });
		await router.emit({ type: "execution", piboSessionId: "ps_abort_action", action: "abort" });
		const snapshot = router.getSignalRegistry().snapshotTree("ps_abort_action");
		assert.equal(snapshot.sessions.ps_abort_action.latestTurn.state, "interrupted");
		assert.equal(snapshot.sessions.ps_abort_action.isTreeActive, false);
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
		router.getSignalRegistry().project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "ps_kill_action", eventId: "m1", text: "hi" } });
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_kill_action", toolName: "bash" });
		const output = await router.emit({ type: "execution", piboSessionId: "ps_kill_action", action: "kill" });
		assert.deepEqual(output.result.killed, ["ps_kill_action"]);
		assert.deepEqual(router.getPiboSessionIds(), []);
		const snapshot = router.getSignalRegistry().snapshotTree("ps_kill_action");
		assert.equal(snapshot.sessions.ps_kill_action.latestTurn.state, "cancelled");
		assert.equal(snapshot.sessions.ps_kill_action.isTreeActive, false);
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


test("session router keeps the persisted runtime instance when the profile default changes", async () => {
	const fakeDriver = createFakeAgentRuntimeDriver({ adapterId: "frozen-fake" });
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.frozen-runtime",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({ id: "frozen-a", adapterId: "frozen-fake" });
					api.registerAgentRuntimeInstance({ id: "changed-b", adapterId: "frozen-fake" });
					api.registerProfile({
						name: "mutable-profile",
						create() {
							return new InitialSessionContextBuilder("mutable-profile")
								.withAgentRuntime("changed-b")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.createSession();
						},
					});
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_frozen_runtime",
		channel: "test",
		kind: "chat",
		profile: "mutable-profile",
		runtimeBinding: { runtimeInstanceId: "frozen-a", adapterId: "frozen-fake", state: "unbound" },
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		const status = await router.emit({ type: "execution", piboSessionId: "ps_frozen_runtime", action: "status" });
		assert.equal(status.type, "execution_result");
		assert.equal(store.get("ps_frozen_runtime").runtimeBinding.runtimeInstanceId, "frozen-a");
		assert.equal(store.get("ps_frozen_runtime").runtimeBinding.state, "bound");
	} finally {
		await router.disposeAll();
	}
});

test("session router persists live binding changes after a runtime turn settles", async () => {
	const fakeDriver = createFakeAgentRuntimeDriver({
		adapterId: "binding-sync-fake",
		script: {
			events: [{ type: "assistant_message", text: "done" }],
			bindingPatchAfterPrompt: { metadata: { durable: true } },
		},
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.binding-sync-runtime",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({ id: "binding-sync", adapterId: "binding-sync-fake" });
					api.registerProfile({
						name: "binding-sync-profile",
						create() {
							return new InitialSessionContextBuilder("binding-sync-profile")
								.withAgentRuntime("binding-sync")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.createSession();
						},
					});
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_binding_sync",
		channel: "test",
		kind: "chat",
		profile: "binding-sync-profile",
		runtimeBinding: { runtimeInstanceId: "binding-sync", adapterId: "binding-sync-fake", state: "unbound" },
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		await router.emit({ type: "message", piboSessionId: "ps_binding_sync", id: "binding-sync-turn", text: "go", source: "user" });
		await waitFor(() => store.get("ps_binding_sync")?.runtimeBinding?.metadata?.durable === true);
		const binding = store.get("ps_binding_sync").runtimeBinding;
		assert.equal(binding.state, "bound");
		assert.equal(binding.metadata.durable, true);
		assert.equal(binding.revision, 3);
	} finally {
		await router.disposeAll();
	}
});

test("session router lazily creates the reserved Pi transcript for an empty migrated session", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-empty-migrated-pi-binding-"));
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_empty_migrated_pi",
		piSessionId: "67777777-7777-4777-8777-777777777777",
		channel: "test",
		kind: "chat",
		profile: "base",
		workspace: cwd,
		runtimeBinding: {
			runtimeInstanceId: "pi",
			adapterId: "pi",
			nativeSessionId: "67777777-7777-4777-8777-777777777777",
			state: "bound",
			protocol: "pi-sdk",
			metadata: { migrationSource: "schema-v4", nativePresenceExpected: false },
		},
	});
	const firstRouter = new PiboSessionRouter({ cwd, persistSession: true, sessionStore: store });
	let firstLocator;
	try {
		const status = await firstRouter.emit({ type: "execution", piboSessionId: "ps_empty_migrated_pi", action: "status" });
		assert.equal(status.type, "execution_result");
		const stored = store.get("ps_empty_migrated_pi");
		assert.equal(stored.runtimeBinding.state, "bound");
		assert.equal(stored.runtimeBinding.metadata.nativePresenceExpected, false);
		assert.equal(stored.runtimeBinding.locator.kind, "local-file");
		firstLocator = stored.runtimeBinding.locator.value;
	} finally {
		await firstRouter.disposeAll();
	}

	if (firstLocator) await rm(firstLocator, { force: true });
	const reopenedRouter = new PiboSessionRouter({ cwd, persistSession: true, sessionStore: store });
	try {
		const status = await reopenedRouter.emit({ type: "execution", piboSessionId: "ps_empty_migrated_pi", action: "status" });
		assert.equal(status.type, "execution_result");
		assert.equal(store.get("ps_empty_migrated_pi").runtimeBinding.state, "bound");
	} finally {
		await reopenedRouter.disposeAll();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("session router marks a missing bound Pi transcript instead of creating a replacement", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-missing-pi-binding-"));
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_missing_pi",
		piSessionId: "77777777-7777-4777-8777-777777777777",
		channel: "test",
		kind: "chat",
		profile: "base",
		workspace: cwd,
		runtimeBinding: {
			runtimeInstanceId: "pi",
			adapterId: "pi",
			nativeSessionId: "77777777-7777-4777-8777-777777777777",
			state: "bound",
			protocol: "pi-sdk",
		},
	});
	const router = new PiboSessionRouter({ cwd, persistSession: true, sessionStore: store });
	try {
		await assert.rejects(
			() => router.emit({ type: "execution", piboSessionId: "ps_missing_pi", action: "status" }),
			(error) => error?.name === "AgentRuntimeBindingMissingError" && /77777777/.test(error.message),
		);
		const stored = store.get("ps_missing_pi");
		assert.equal(stored.piSessionId, "77777777-7777-4777-8777-777777777777");
		assert.equal(stored.runtimeBinding.state, "missing");
		assert.equal(stored.runtimeBinding.metadata.diagnosticCode, "pi_session_missing");
	} finally {
		await router.disposeAll();
		await rm(cwd, { recursive: true, force: true });
	}
});
