import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function createSwitchFixture(firstPromptRelease, observations) {
	const capabilities = {
		...createMinimalAgentRuntimeCapabilities(),
		lifecycle: {
			...createMinimalAgentRuntimeCapabilities().lifecycle,
			persistent: true,
			resume: true,
			attach: true,
			listNativeSessions: true,
		},
	};
	const driver = {
		descriptor: {
			id: "switch-guard",
			displayName: "Switch guard fixture",
			transport: "embedded",
			configSchema: { type: "object", additionalProperties: false },
			capabilities,
			supportsMultipleInstances: true,
		},
		defaultConfig: () => ({}),
		parseConfig: () => ({}),
		create({ instanceId }) {
			return {
				instanceId,
				displayName: "Switch guard fixture",
				enabled: true,
				descriptor: driver.descriptor,
				config: {},
				validateProfile: () => [],
				diagnose: async () => [],
				async openSession(input) {
					const listeners = new Set();
					let disposed = false;
					let streaming = false;
					let promptCount = 0;
					let binding = {
						...input.binding,
						piboSessionId: input.piboSession.id,
						runtimeInstanceId: instanceId,
						adapterId: "switch-guard",
						nativeSessionId: input.binding?.nativeSessionId ?? "native-A",
						state: "bound",
					};
					const emit = (event) => { for (const listener of listeners) listener(event); };
					const session = {
						adapterId: "switch-guard",
						runtimeInstanceId: instanceId,
						cwd: input.workspace,
						capabilities,
						controls: {
							getCurrentSession: () => ({
								adapterId: "switch-guard",
								runtimeInstanceId: instanceId,
								nativeSessionId: binding.nativeSessionId,
								cwd: input.workspace,
								locator: { kind: "adapter-resolved" },
							}),
							listSessions: async () => [],
							async switchSession() {
								observations.switchCalls += 1;
								observations.streamingAtSwitch.push(streaming);
								const previousNativeSessionId = binding.nativeSessionId;
								binding = { ...binding, nativeSessionId: "native-B" };
								return {
									previous: { adapterId: "switch-guard", runtimeInstanceId: instanceId, nativeSessionId: previousNativeSessionId, cwd: input.workspace },
									current: { adapterId: "switch-guard", runtimeInstanceId: instanceId, nativeSessionId: "native-B", cwd: input.workspace },
									cancelled: false,
								};
							},
						},
						getBinding: () => structuredClone(binding),
						subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
						async prompt({ text }) {
							promptCount += 1;
							const nativeAtStart = binding.nativeSessionId;
							observations.promptBindings.push({ text, nativeAtStart });
							streaming = true;
							emit({ type: "turn_started", turnId: `turn-${promptCount}` });
							if (promptCount === 1) await firstPromptRelease.promise;
							emit({ type: "assistant_message", text: `reply from ${nativeAtStart}` });
							emit({ type: "turn_completed", turnId: `turn-${promptCount}`, status: "completed" });
							streaming = false;
						},
						async abort() { firstPromptRelease.resolve(); streaming = false; },
						async dispose() { disposed = true; firstPromptRelease.resolve(); streaming = false; listeners.clear(); },
						getStatus: () => ({ streaming: disposed ? false : streaming, enabledTools: [], cwd: input.workspace }),
					};
					observations.getStreaming = () => session.getStatus().streaming;
					return session;
				},
			};
		},
	};
	return PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.switch-guard",
				register(api) {
					api.registerAgentRuntimeDriver(driver);
					api.registerAgentRuntimeInstance({ id: "switch-guard", adapterId: "switch-guard" });
					api.registerProfile({
						name: "switch-guard-profile",
						create() {
							return new InitialSessionContextBuilder("switch-guard-profile")
								.withAgentRuntime("switch-guard")
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
}

test("session.switch cannot split active and queued turns across native bindings", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-session-switch-guard-"));
	const dataPath = join(root, "pibo.sqlite");
	const firstPromptRelease = deferred();
	const observations = { switchCalls: 0, streamingAtSwitch: [], promptBindings: [], getStreaming: undefined };
	const pluginRegistry = createSwitchFixture(firstPromptRelease, observations);
	let dataStore = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
	let sessionStore = new PiboDataSessionStore(dataStore);
	const reliabilityStore = new PiboReliabilityStore(join(root, "pibo-events.sqlite"));
	sessionStore.create({
		id: "ps_switch_guard",
		channel: "test",
		kind: "chat",
		profile: "switch-guard-profile",
		workspace: root,
		runtimeBinding: {
			runtimeInstanceId: "switch-guard",
			adapterId: "switch-guard",
			nativeSessionId: "native-A",
			state: "bound",
		},
	});
	const router = new PiboSessionRouter({ pluginRegistry, sessionStore, reliabilityStore, cwd: root, persistSession: true });
	const outputs = [];
	router.subscribe((event) => outputs.push(event));

	try {
		await router.emit({ type: "message", piboSessionId: "ps_switch_guard", id: "message-A", text: "first", source: "user" });
		await waitFor(() => observations.getStreaming?.(), "first prompt streaming");

		await assert.rejects(
			() => router.emit({
				type: "execution",
				piboSessionId: "ps_switch_guard",
				id: "switch-active",
				action: "session.switch",
				params: { sessionFile: "/fixture/native-B.jsonl" },
			}),
			/Pibo session must be idle to switch/,
		);
		assert.equal(observations.switchCalls, 0);
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").nativeSessionId, "native-A");
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").revision, 1);

		const queued = await router.emit({ type: "message", piboSessionId: "ps_switch_guard", id: "message-B", text: "second", source: "user" });
		assert.equal(queued.type, "message_queued");
		firstPromptRelease.resolve();
		await waitFor(() => outputs.filter((event) => event.type === "message_finished").length === 2, "two messages finished");
		assert.deepEqual(observations.promptBindings, [
			{ text: "first", nativeAtStart: "native-A" },
			{ text: "second", nativeAtStart: "native-A" },
		]);

		const switched = await router.emit({
			type: "execution",
			piboSessionId: "ps_switch_guard",
			id: "switch-idle",
			action: "session.switch",
			params: { sessionFile: "/fixture/native-B.jsonl" },
		});
		assert.equal(switched.type, "execution_result");
		assert.equal(observations.switchCalls, 1);
		assert.deepEqual(observations.streamingAtSwitch, [false]);
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").nativeSessionId, "native-B");
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").revision, 2);

		await router.emit({ type: "message", piboSessionId: "ps_switch_guard", id: "message-C", text: "third", source: "user" });
		await waitFor(() => outputs.filter((event) => event.type === "message_finished").length === 3, "third message finished");
		assert.deepEqual(observations.promptBindings.at(-1), { text: "third", nativeAtStart: "native-B" });

		await router.disposeAll();
		reliabilityStore.close();
		dataStore.close();
		dataStore = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
		sessionStore = new PiboDataSessionStore(dataStore);
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").nativeSessionId, "native-B");
		assert.equal(sessionStore.getRuntimeBinding("ps_switch_guard").revision, 2);
	} finally {
		firstPromptRelease.resolve();
		await router.disposeAll().catch(() => {});
		try { reliabilityStore.close(); } catch {}
		try { dataStore.close(); } catch {}
		await rm(root, { recursive: true, force: true });
	}
});
