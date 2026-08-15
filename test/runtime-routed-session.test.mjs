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
