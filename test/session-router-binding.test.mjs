import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";

class StaticBindingStore {
	constructor(binding) {
		this.binding = binding;
	}

	get(sessionKey) {
		return this.binding.sessionKey === sessionKey ? this.binding : undefined;
	}

	resolve() {
		return this.binding;
	}

	update(sessionKey, input) {
		if (this.binding.sessionKey !== sessionKey) return undefined;
		this.binding = {
			...this.binding,
			...input,
			updatedAt: new Date().toISOString(),
		};
		return this.binding;
	}
}

class MemoryBindingStore {
	bindings = new Map();
	bindingsByChannelExternalId = new Map();

	constructor(bindings = []) {
		for (const binding of bindings) this.add(binding);
	}

	add(binding) {
		this.bindings.set(binding.sessionKey, binding);
		this.bindingsByChannelExternalId.set(`${binding.channel}:${binding.externalId}`, binding);
	}

	get(sessionKey) {
		return this.bindings.get(sessionKey);
	}

	list() {
		return [...this.bindings.values()];
	}

	resolve(input) {
		const channelExternalId = `${input.channel}:${input.externalId}`;
		const existing = this.bindingsByChannelExternalId.get(channelExternalId);
		if (existing) return existing;

		const now = new Date().toISOString();
		const binding = {
			sessionKey: input.sessionKey ?? `${input.channel}:${input.externalId}`,
			sessionId: input.sessionId ?? `session-${this.bindings.size + 1}`,
			parentSessionKey: input.parentSessionKey,
			parentSessionId: input.parentSessionId,
			channel: input.channel,
			externalId: input.externalId,
			originalProfile: input.defaultProfile,
			workspace: input.workspace,
			createdAt: now,
			updatedAt: now,
		};
		this.add(binding);
		return binding;
	}

	update(sessionKey, input) {
		const existing = this.get(sessionKey);
		if (!existing) return undefined;
		const updated = {
			...existing,
			...input,
			updatedAt: new Date().toISOString(),
		};
		this.add(updated);
		return updated;
	}
}

test("session router uses the binding original profile when creating a session", async () => {
	const router = new PiboSessionRouter({
		persistSession: false,
		bindingStore: new StaticBindingStore({
			sessionKey: "web:user-1",
			sessionId: "11111111-1111-4111-8111-111111111111",
			channel: "web",
			externalId: "user-1",
			originalProfile: "pibo-example-plugin",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
	});

	try {
		const output = await router.emit({
			type: "execution",
			sessionKey: "web:user-1",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("pibo_example_plugin_note"), true);

		const current = await router.emit({
			type: "execution",
			sessionKey: "web:user-1",
			action: "session.current",
		});
		assert.equal(current.type, "execution_result");
		assert.equal(current.result.sessionId, "11111111-1111-4111-8111-111111111111");
	} finally {
		await router.disposeAll();
	}
});

test("session router keeps the previous Pi session visible after session replacement", async () => {
	const store = new MemoryBindingStore([
		{
			sessionKey: "web:user-1",
			sessionId: "11111111-1111-4111-8111-111111111111",
			channel: "web",
			externalId: "user-1",
			originalProfile: "pibo-minimal",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
	]);
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.session-branch",
				register(api) {
					api.registerGatewayAction({
						name: "test.session_branch",
						execute(context) {
							return {
								routeSessionKey: context.sessionKey,
								previous: {
									sessionId: "11111111-1111-4111-8111-111111111111",
									sessionFile: "/tmp/old-session.jsonl",
									leafId: "old-leaf",
									cwd: "/workspace",
								},
								current: {
									sessionId: "22222222-2222-4222-8222-222222222222",
									sessionFile: "/tmp/new-session.jsonl",
									leafId: "new-leaf",
									cwd: "/workspace",
								},
								cancelled: false,
							};
						},
					});
				},
			}),
		],
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		bindingStore: store,
		pluginRegistry: registry,
	});

	try {
		await router.emit({
			type: "execution",
			sessionKey: "web:user-1",
			action: "test.session_branch",
		});

		const current = store.get("web:user-1");
		const archived = store.list().find((binding) => binding.sessionKey.startsWith("web:user-1:branch:"));
		assert.equal(current.sessionId, "22222222-2222-4222-8222-222222222222");
		assert.ok(archived);
		assert.equal(archived.sessionId, "11111111-1111-4111-8111-111111111111");
		assert.equal(archived.parentSessionKey, undefined);
		assert.equal(archived.workspace, "/workspace");
	} finally {
		await router.disposeAll();
	}
});

test("runtime reopens an existing persisted session by profile session id", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-runtime-session-id-"));
	const sessionId = "11111111-1111-4111-8111-111111111111";
	const profile = new InitialSessionContextBuilder("runtime-session-test")
		.withSessionId(sessionId)
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
		assert.equal(second.session.sessionId, sessionId);
	} finally {
		await second.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("session router updates binding before emitting a session operation result", async () => {
	const store = new StaticBindingStore({
		sessionKey: "web:user-1",
		sessionId: "11111111-1111-4111-8111-111111111111",
		channel: "web",
		externalId: "user-1",
		originalProfile: "pibo-minimal",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.session-operation",
				register(api) {
					api.registerGatewayAction({
						name: "test.session_operation",
						execute(context) {
							return {
								routeSessionKey: context.sessionKey,
								previous: {
									sessionId: "11111111-1111-4111-8111-111111111111",
									leafId: null,
									cwd: process.cwd(),
								},
								current: {
									sessionId: "22222222-2222-4222-8222-222222222222",
									leafId: null,
									cwd: process.cwd(),
								},
								cancelled: false,
							};
						},
					});
				},
			}),
		],
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		bindingStore: store,
		pluginRegistry: registry,
	});
	let bindingAtResult;
	router.subscribe((event) => {
		if (event.type === "execution_result" && event.action === "test.session_operation") {
			bindingAtResult = store.get("web:user-1");
		}
	});

	try {
		const output = await router.emit({
			type: "execution",
			sessionKey: "web:user-1",
			action: "test.session_operation",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(store.get("web:user-1").sessionId, "22222222-2222-4222-8222-222222222222");
		assert.equal(bindingAtResult.sessionId, "22222222-2222-4222-8222-222222222222");
	} finally {
		await router.disposeAll();
	}
});
