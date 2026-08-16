import assert from "node:assert/strict";
import test from "node:test";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for routed runtime output");
		await delay(5);
	}
}

function createFakeRuntimeFixture() {
	const fakeDriver = createFakeAgentRuntimeDriver({
		adapterId: "router-fake",
		script: (input) => ({
			events: [
				{ type: "assistant_delta", text: `${input.text}:delta` },
				{ type: "assistant_message", text: `${input.text}:final` },
			],
		}),
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-fake",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({ id: "router-fake", adapterId: "router-fake" });
					api.registerProfile({
						name: "router-fake-profile",
						create() {
							return new InitialSessionContextBuilder("router-fake-profile")
								.withAgentRuntime("router-fake")
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
		id: "ps_router_fake",
		runtimeBinding: { runtimeInstanceId: "router-fake", adapterId: "router-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "router-fake-profile",
		workspace: process.cwd(),
	});
	return {
		registry,
		store,
		router: new PiboSessionRouter({
			persistSession: false,
			pluginRegistry: registry,
			sessionStore: store,
		}),
	};
}

test("generic routed orchestration queues and correlates a non-Pi fake adapter", async () => {
	const fixture = createFakeRuntimeFixture();
	const events = [];
	let portableTools;
	fixture.router.subscribe((event) => events.push(event));
	try {
		const first = fixture.router.emit({
			type: "message",
			piboSessionId: "ps_router_fake",
			id: "fake-message-1",
			text: "one",
			source: "user",
		});
		const second = fixture.router.emit({
			type: "message",
			piboSessionId: "ps_router_fake",
			id: "fake-message-2",
			text: "two",
			source: "user",
		});
		assert.equal((await first).type, "message_queued");
		assert.equal((await second).type, "message_queued");
		await waitFor(() => events.filter((event) => event.type === "message_finished").length === 2);

		assert.deepEqual(
			events.filter((event) => event.type === "assistant_message").map((event) => [event.eventId, event.text]),
			[
				["fake-message-1", "one:final"],
				["fake-message-2", "two:final"],
			],
		);
		const status = await fixture.router.emit({
			type: "execution",
			piboSessionId: "ps_router_fake",
			action: "status",
		});
		assert.equal(status.result.streaming, false);
		assert.equal(status.result.cwd, process.cwd());
		const adapter = fixture.registry.requireAgentRuntimeAdapter("router-fake");
		portableTools = adapter.openInputs[0].services.portableTools;
		assert.equal(portableTools.piboSessionId, "ps_router_fake");
		assert.equal(portableTools.runtimeInstanceId, "router-fake");
		assert.equal(portableTools.adapterId, "router-fake");
		assert.deepEqual(portableTools.createDefinitions(), []);
	} finally {
		await fixture.router.disposeAll();
	}
	assert.throws(() => portableTools.createDefinitions(), /disposed/);
});

test("generic router rejects profile selections the runtime cannot deliver", async () => {
	const fixture = createFakeRuntimeFixture();
	fixture.registry.upsertProfile({
		name: "unsupported-portable-profile",
		create() {
			return new InitialSessionContextBuilder("unsupported-portable-profile")
				.withAgentRuntime("router-fake")
				.addTool({ name: "pibo-tool" })
				.createSession();
		},
	});
	fixture.store.create({
		id: "ps_router_unsupported",
		runtimeBinding: { runtimeInstanceId: "router-fake", adapterId: "router-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "unsupported-portable-profile",
		workspace: process.cwd(),
	});
	try {
		await assert.rejects(
			() => fixture.router.emit({ type: "execution", piboSessionId: "ps_router_unsupported", action: "status" }),
			/Runtime profile validation failed: .*Pibo-managed tools/,
		);
	} finally {
		await fixture.router.disposeAll();
	}
});

test("generic routed controls reject unadvertised adapter capabilities explicitly", async () => {
	const fixture = createFakeRuntimeFixture();
	try {
		await assert.rejects(
			() => fixture.router.emit({
				type: "execution",
				piboSessionId: "ps_router_fake",
				action: "session.clone",
			}),
			(error) => error?.name === "AgentRuntimeCapabilityUnavailableError"
				&& /native session clone/.test(error.message),
		);
	} finally {
		await fixture.router.disposeAll();
	}
});

test("adapter-shared auth mutations recycle every affected configured runtime session", async () => {
	const baseDriver = createFakeAgentRuntimeDriver({ adapterId: "router-shared-auth-fake" });
	baseDriver.descriptor.capabilities.auth = {
		status: true,
		methods: [{ id: "api_key", completion: "immediate" }],
		cancel: false,
		logout: true,
		credentialScope: "adapter-shared",
	};
	const adapters = new Map();
	const createBase = baseDriver.create.bind(baseDriver);
	const authDriver = {
		...baseDriver,
		create(input) {
			const adapter = Object.assign(createBase(input), {
				async getAuthStatus() {
					return [{
						id: "fixture-provider",
						state: "disconnected",
						configured: false,
						methods: [{ id: "api_key", completion: "immediate" }],
					}];
				},
				async startAuth(authInput) {
					return { providerId: authInput.providerId, state: "connected", configured: true };
				},
				async logoutAuth(authInput) {
					return { providerId: authInput.providerId, state: "disconnected", configured: false };
				},
			});
			adapters.set(input.instanceId, adapter);
			return adapter;
		},
	};
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-shared-auth-fake",
				register(api) {
					api.registerAgentRuntimeDriver(authDriver);
					for (const runtimeInstanceId of ["router-shared-a", "router-shared-b"]) {
						api.registerAgentRuntimeInstance({ id: runtimeInstanceId, adapterId: "router-shared-auth-fake" });
						api.registerProfile({
							name: `${runtimeInstanceId}-profile`,
							create() {
								return new InitialSessionContextBuilder(`${runtimeInstanceId}-profile`)
									.withAgentRuntime(runtimeInstanceId)
									.withBuiltinTools("disabled")
									.withAutoContextFiles(false)
									.withToolPackages({ goalControl: false })
									.createSession();
							},
						});
					}
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	for (const suffix of ["a", "b"]) {
		store.create({
			id: `ps_router_shared_${suffix}`,
			runtimeBinding: {
				runtimeInstanceId: `router-shared-${suffix}`,
				adapterId: "router-shared-auth-fake",
				nativeSessionId: `router-shared-${suffix}-native`,
				state: "bound",
			},
			channel: "test",
			kind: "chat",
			profile: `router-shared-${suffix}-profile`,
			workspace: process.cwd(),
		});
	}
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		await router.getSessionStatusSnapshot("ps_router_shared_a");
		await router.getSessionStatusSnapshot("ps_router_shared_b");
		assert.equal(adapters.get("router-shared-a").sessions[0].disposeCalls, 0);
		assert.equal(adapters.get("router-shared-b").sessions[0].disposeCalls, 0);

		await router.startAgentRuntimeAuth("router-shared-a", {
			providerId: "fixture-provider",
			method: "api_key",
			apiKey: "deterministic-fixture-key",
		});

		assert.equal(adapters.get("router-shared-a").sessions[0].disposeCalls, 1);
		assert.equal(adapters.get("router-shared-b").sessions[0].disposeCalls, 1);
	} finally {
		await router.disposeAll();
	}
});

test("runtime login and model menus use the active adapter's real auth status without hiding unauthenticated models", async () => {
	const baseDriver = createFakeAgentRuntimeDriver({ adapterId: "router-auth-fake" });
	let authStatusFails = false;
	baseDriver.descriptor.capabilities.models.catalog = true;
	baseDriver.descriptor.capabilities.auth = {
		status: true,
		methods: [{ id: "api_key", completion: "immediate" }],
		cancel: false,
		logout: true,
		credentialScope: "runtime-instance",
	};
	const createBase = baseDriver.create.bind(baseDriver);
	const authDriver = {
		...baseDriver,
		create(input) {
			return Object.assign(createBase(input), {
				async listModels() {
					return {
						runtimeInstanceId: input.instanceId,
						models: [{ id: "fixture-model", provider: "fixture-provider", displayName: "Fixture Model" }],
					};
				},
				async getAuthStatus() {
					if (authStatusFails) throw new Error("deterministic auth status failure");
					return [{
						id: "fixture-provider",
						displayName: "Fixture Provider",
						state: "disconnected",
						configured: false,
						methods: [{ id: "api_key", completion: "immediate" }],
					}];
				},
				async startAuth(authInput) {
					return { providerId: authInput.providerId, state: "connected", configured: true, details: { accountType: "api_key" } };
				},
				async logoutAuth(authInput) {
					return { providerId: authInput.providerId, state: "disconnected", configured: false };
				},
			});
		},
	};
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-auth-fake",
				register(api) {
					api.registerAgentRuntimeDriver(authDriver);
					api.registerAgentRuntimeInstance({ id: "router-auth-fake", adapterId: "router-auth-fake" });
					api.registerProfile({
						name: "router-auth-profile",
						create() {
							return new InitialSessionContextBuilder("router-auth-profile")
								.withAgentRuntime("router-auth-fake")
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
		id: "ps_router_auth_fake",
		runtimeBinding: { runtimeInstanceId: "router-auth-fake", adapterId: "router-auth-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "router-auth-profile",
		workspace: process.cwd(),
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		const login = await router.emit({ type: "execution", piboSessionId: "ps_router_auth_fake", action: "login" });
		assert.equal(login.result.runtimeInstanceId, "router-auth-fake");
		assert.deepEqual(login.result.providers.map(({ id, configured, authMethods }) => ({ id, configured, authMethods })), [
			{ id: "fixture-provider", configured: false, authMethods: ["api_key"] },
		]);

		authStatusFails = true;
		const model = await router.emit({ type: "execution", piboSessionId: "ps_router_auth_fake", action: "model" });
		assert.equal(model.result.providers[0].authConfigured, false);
		assert.deepEqual(model.result.providers[0].models.map(({ id }) => id), ["fixture-model"]);
	} finally {
		await router.disposeAll();
	}
});
