import assert from "node:assert/strict";
import test from "node:test";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";

class MemoryBindingStore {
	bindings = new Map();

	get(sessionKey) {
		return this.bindings.get(sessionKey);
	}

	resolve(input) {
		for (const binding of this.bindings.values()) {
			if (binding.channel === input.channel && binding.externalId === input.externalId) {
				return binding;
			}
		}

		const now = new Date().toISOString();
		const binding = {
			sessionKey: input.sessionKey ?? `${input.channel}:${input.externalId}`,
			channel: input.channel,
			externalId: input.externalId,
			originalProfile: input.defaultProfile,
			workspace: input.workspace,
			createdAt: now,
			updatedAt: now,
		};
		this.bindings.set(binding.sessionKey, binding);
		return binding;
	}
}

test("gateway starts plugin channels with router and session binding context", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const store = new MemoryBindingStore();
	let startedBinding;
	let stopped = false;

	registry.registerPlugin(
		definePiboPlugin({
			id: "test.channel",
			register(api) {
				api.registerChannel({
					name: "test-web-channel",
					kind: "web",
					auth: { mode: "required" },
					start(context) {
						startedBinding = context.resolveSession({
							channel: "web",
							externalId: "user-1",
							defaultProfile: "minimal",
						});
					},
					stop() {
						stopped = true;
					},
				});
			},
		}),
	);

	const server = new PiboGatewayServer({
		port: 0,
		persistSession: false,
		pluginRegistry: registry,
		bindingStore: store,
	});

	await server.start();
	await server.stop();

	assert.equal(startedBinding.sessionKey, "web:user-1");
	assert.equal(startedBinding.originalProfile, "pibo-minimal");
	assert.equal(store.get("web:user-1"), startedBinding);
	assert.equal(stopped, true);
});
