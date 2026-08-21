import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
	getCodexNativeClient,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import {
	CodexNativeSessionSettingsController,
	readCodexNativeModelCatalog,
} from "../dist/agent-runtimes/codex-native/models.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for native Codex model state");
		await delay(5);
	}
}

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-models-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await chmod(fixturePath, 0o755);
	return root;
}

function runtimeConfig(root) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

function createAdapter(root, instanceId) {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex Native Model Test",
		config: runtimeConfig(root),
	});
	return { registry, adapter };
}

function profile(instanceId, options = {}, configure) {
	const builder = new InitialSessionContextBuilder(`profile-${instanceId}`)
		.withAgentRuntime(instanceId, options)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false });
	configure?.(builder);
	return builder.createSession();
}

function openInput(instanceId, workspace, selectedProfile, binding, activeModel) {
	const piboSession = createPiboSession({
		id: binding.piboSessionId,
		channel: "test",
		kind: "chat",
		profile: selectedProfile.profileName,
		workspace,
		runtimeBinding: binding,
		activeModel,
	});
	return {
		piboSession,
		profile: selectedProfile,
		binding,
		workspace,
		...(activeModel ? { activeModel } : {}),
		productContext: {
			piboSessionId: piboSession.id,
			getActiveMessage: () => ({ id: "model-test-message", source: "user" }),
		},
	};
}

function nativeModel(id, overrides = {}) {
	return {
		id,
		model: id,
		displayName: id,
		description: `${id} description`,
		hidden: false,
		isDefault: false,
		supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High reasoning" }],
		defaultReasoningEffort: "high",
		serviceTiers: [],
		defaultServiceTier: null,
		inputModalities: ["text"],
		supportsPersonality: false,
		...overrides,
	};
}

function unboundBinding(instanceId, piboSessionId) {
	return {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
}

test("Codex native advertises and validates its stable model, reasoning, service-tier, and option catalog", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-model-catalog";
	const { adapter } = createAdapter(root, instanceId);

	assert.equal(adapter.descriptor.capabilities.models.catalog, true);
	assert.equal(adapter.descriptor.capabilities.models.switchInSession, true);
	assert.equal(adapter.descriptor.capabilities.reasoning.supported, true);
	assert.equal(adapter.descriptor.capabilities.maintenance.contextUsage, true);
	assert.deepEqual(adapter.descriptor.capabilities.models.optionsSchema.properties.personality.enum, ["none", "friendly", "pragmatic"]);

	const catalog = await adapter.listModels();
	assert.equal(catalog.runtimeInstanceId, instanceId);
	assert.deepEqual(catalog.models.map((model) => model.id), ["gpt-5.6-sol", "gpt-5.2"]);
	assert.deepEqual(catalog.models[0].reasoningOptions, ["low", "medium", "high", "xhigh", "max"]);
	assert.equal(catalog.models[0].options.nativeReasoningEfforts.some((entry) => entry.id === "ultra"), true);
	assert.deepEqual(catalog.models[0].options.serviceTiers.map((entry) => entry.id), ["priority"]);
	assert.equal(catalog.models[0].options.supportsPersonality, true);
	assert.deepEqual(catalog.models[1].options.serviceTiers, []);

	const valid = profile(instanceId, {
		serviceTier: "priority",
		personality: "pragmatic",
		reasoningSummary: "detailed",
	}, (builder) => builder
		.withModel({ provider: "openai-codex", id: "gpt-5.6-sol" })
		.withThinkingLevel("high"));
	assert.deepEqual(adapter.validateProfile({ profile: valid }), []);

	const invalidOptions = profile(instanceId, { token: "must-not-be-supported" });
	assert.equal(adapter.validateProfile({ profile: invalidOptions })[0].code, "codex_native_runtime_options_invalid");
	const invalidProvider = profile(instanceId, {}, (builder) => builder.withModel({ provider: "openai", id: "gpt-5.6-sol" }));
	assert.equal(adapter.validateProfile({ profile: invalidProvider })[0].code, "codex_native_model_provider_invalid");
});

test("Codex native applies profile options and exposes cumulative context usage", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-model-options";
	const { registry } = createAdapter(root, instanceId);
	const selectedProfile = profile(instanceId, {
		serviceTier: "priority",
		personality: "pragmatic",
		reasoningSummary: "detailed",
	}, (builder) => builder
		.withModel({ provider: "openai-codex", id: "gpt-5.6-sol" })
		.withThinkingLevel("max"));
	const binding = unboundBinding(instanceId, "ps_codex_model_options");
	const session = await registry.openSession(instanceId, openInput(instanceId, root, selectedProfile, binding));
	t.after(() => session.dispose());

	assert.deepEqual(session.getStatus().activeModel, { provider: "openai-codex", id: "gpt-5.6-sol" });
	assert.deepEqual(session.getStatus().reasoning, {
		value: "max",
		availableValues: ["low", "medium", "high", "xhigh", "max"],
		supported: true,
	});
	assert.deepEqual(session.getStatus().fastMode, { mode: "fast", supported: true });
	assert.equal(session.getStatus().contextUsage, undefined);

	await session.prompt({ text: "model options", source: "rpc" });
	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.deepEqual(state.turnRequests.at(-1), {
		threadId: session.getBinding().nativeSessionId,
		model: "gpt-5.6-sol",
		effort: "max",
		serviceTier: "priority",
		summary: "detailed",
		personality: "pragmatic",
	});
	assert.deepEqual(session.getStatus().contextUsage, {
		tokens: 20,
		contextWindow: 200_000,
		percent: 0.01,
	});
	assert.equal(session.getBinding().metadata.codexNativeReasoningEffort, "max");
	assert.equal(session.getBinding().metadata.codexNativeServiceTier, "priority");
	assert.equal(session.getBinding().metadata.codexNativeReasoningSummary, "detailed");
});

test("Codex native model, reasoning, and Fast Mode controls are model-aware and survive native resume", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-model-controls";
	const { registry } = createAdapter(root, instanceId);
	const selectedProfile = profile(instanceId, {}, (builder) => builder
		.withModel({ provider: "openai-codex", id: "gpt-5.6-sol" })
		.withThinkingLevel("high"));
	const binding = unboundBinding(instanceId, "ps_codex_model_controls");
	const first = await registry.openSession(instanceId, openInput(instanceId, root, selectedProfile, binding));

	assert.deepEqual(first.controls.setReasoning("low"), {
		value: "low",
		availableValues: ["low", "medium", "high", "xhigh", "max"],
		supported: true,
	});
	assert.deepEqual(first.controls.setFastMode(true), { mode: "fast", supported: true, changed: true });
	assert.deepEqual(await first.controls.setModel({ provider: "openai-codex", id: "gpt-5.2" }), {
		provider: "openai-codex",
		id: "gpt-5.2",
	});
	assert.deepEqual(first.getStatus().fastMode, { mode: "normal", supported: false });
	assert.deepEqual(first.controls.setFastMode(true), { mode: "normal", supported: false, changed: false });
	assert.throws(() => first.controls.setReasoning("max"), /does not support reasoning effort/);
	await assert.rejects(first.controls.setModel({ provider: "openai", id: "gpt-5.2" }), /use provider "openai-codex"/);
	await assert.rejects(first.controls.setModel({ provider: "openai-codex", id: "missing" }), /is not available/);

	await first.prompt({ text: "controlled model", source: "rpc" });
	const firstState = await getCodexNativeClient(first).request("test/getState", {});
	assert.deepEqual(firstState.turnRequests.at(-1), {
		threadId: first.getBinding().nativeSessionId,
		model: "gpt-5.2",
		effort: "low",
		serviceTier: null,
		summary: null,
		personality: null,
	});
	const resumedBinding = first.getBinding();
	assert.equal(resumedBinding.metadata.codexNativeModelId, "gpt-5.2");
	assert.equal(resumedBinding.metadata.codexNativeReasoningEffort, "low");
	assert.equal(resumedBinding.metadata.codexNativeServiceTier, null);
	await first.dispose();

	const resumed = await registry.openSession(instanceId, openInput(
		instanceId,
		root,
		selectedProfile,
		resumedBinding,
		{ provider: "openai-codex", id: "gpt-5.2" },
	));
	t.after(() => resumed.dispose());
	await waitFor(() => resumed.getStatus().contextUsage?.tokens === 20);
	assert.deepEqual(resumed.getStatus().activeModel, { provider: "openai-codex", id: "gpt-5.2" });
	assert.equal(resumed.getStatus().reasoning.value, "low");
	assert.deepEqual(resumed.getStatus().contextUsage, {
		tokens: 20,
		contextWindow: 200_000,
		percent: 0.01,
	});

	await resumed.prompt({ text: "resumed model", source: "rpc" });
	assert.deepEqual(resumed.getStatus().contextUsage, {
		tokens: 40,
		contextWindow: 200_000,
		percent: 0.02,
	});
});

test("Codex native model catalog and controls flow through routed status and gateway actions", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-model-router";
	const profileName = "codex-native-model-router-profile";
	const piboSessionId = "ps_codex_model_router";
	const config = runtimeConfig(root);
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-model-router",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config });
				api.registerProfile({
					name: profileName,
					create() {
						return profile(instanceId, {}, (builder) => builder
							.withModel({ provider: "openai-codex", id: "gpt-5.6-sol" })
							.withThinkingLevel("high"));
					},
				});
			},
		})],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profileName,
		workspace: root,
		runtimeBinding: { runtimeInstanceId: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, state: "unbound" },
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	t.after(() => router.disposeAll());

	const modelMenu = await router.emit({
		type: "execution",
		piboSessionId,
		id: "codex-model-menu",
		action: "model",
	});
	assert.equal(modelMenu.type, "execution_result");
	assert.deepEqual(modelMenu.result.providers.map((provider) => provider.id), ["openai-codex"]);
	assert.deepEqual(modelMenu.result.providers[0].models.map((model) => model.id), ["gpt-5.6-sol", "gpt-5.2"]);

	assert.deepEqual(await router.setLiveSessionActiveModel(piboSessionId, { provider: "openai-codex", id: "gpt-5.2" }), {
		provider: "openai-codex",
		id: "gpt-5.2",
	});
	const thinking = await router.emit({
		type: "execution",
		piboSessionId,
		id: "codex-thinking",
		action: "thinking",
		params: { level: "low" },
	});
	assert.equal(thinking.result.level, "low");
	const fast = await router.emit({
		type: "execution",
		piboSessionId,
		id: "codex-fast",
		action: "fast_mode",
	});
	assert.deepEqual(fast.result, { mode: "normal", supported: false, changed: false });

	await router.emit({
		type: "message",
		piboSessionId,
		id: "codex-model-router-message",
		text: "routed model status",
		source: "user",
	});
	await waitFor(() => router.getSessionRuntimeStatus(piboSessionId)?.processing === false);
	const status = await router.getSessionStatusSnapshot(piboSessionId);
	assert.deepEqual(status.activeModel, { provider: "openai-codex", id: "gpt-5.2" });
	assert.equal(status.thinkingLevel, "low");
	assert.deepEqual(status.contextUsage, { tokens: 20, contextWindow: 200_000, percent: 0.01 });
});

test("Codex native model catalog pagination applies stable protocol defaults and rejects unbounded responses", async () => {
	const pages = [
		{
			data: [{
				id: "model-a",
				model: "model-a",
				displayName: "Model A",
				description: "First model",
				hidden: false,
				isDefault: true,
				supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
				defaultReasoningEffort: "high",
			}],
			nextCursor: "page-2",
		},
		{ data: [nativeModel("model-b")], nextCursor: null },
	];
	const requests = [];
	const catalog = await readCodexNativeModelCatalog({
		async request(method, params) {
			requests.push({ method, params });
			return pages.shift();
		},
	});
	assert.deepEqual(requests.map((request) => request.params.cursor), [null, "page-2"]);
	assert.deepEqual(catalog.models.map((model) => model.id), ["model-a", "model-b"]);
	assert.deepEqual(catalog.models[0].serviceTiers, []);
	assert.deepEqual(catalog.models[0].inputModalities, ["text", "image"]);
	assert.equal(catalog.models[0].supportsPersonality, undefined);

	await assert.rejects(readCodexNativeModelCatalog({
		async request() {
			return { data: [nativeModel("repeated")], nextCursor: "same-cursor" };
		},
	}), /duplicate model id|repeated a pagination cursor/);
	await assert.rejects(readCodexNativeModelCatalog({
		async request() {
			return {
				data: [nativeModel("too-many-efforts", {
					supportedReasoningEfforts: Array.from({ length: 33 }, (_, index) => ({
						reasoningEffort: `effort-${index}`,
						description: "bounded",
					})),
					defaultReasoningEffort: "effort-0",
				})],
				nextCursor: null,
			};
		},
	}), /more than 32 reasoning-effort options/);
});

test("Codex native session settings keep model and context notifications thread-scoped", () => {
	let listener;
	let unsubscribed = false;
	const client = {
		subscribeNotifications(next) {
			listener = next;
			return () => { unsubscribed = true; };
		},
	};
	const catalog = {
		models: [
			nativeModel("model-a", {
				isDefault: true,
				supportedReasoningEfforts: [
					{ reasoningEffort: "low", description: "Low" },
					{ reasoningEffort: "high", description: "High" },
				],
				serviceTiers: [{ id: "priority", name: "Priority", description: "Fast" }],
				supportsPersonality: true,
			}),
			nativeModel("model-b", {
				supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Low" }],
				defaultReasoningEffort: "low",
			}),
		],
	};
	const settings = new CodexNativeSessionSettingsController(client, catalog, {
		profileOptions: {},
	});
	settings.attachThread("thread-a", {
		model: "model-a",
		modelProvider: "fixture",
		reasoningEffort: "high",
		serviceTier: "default",
	});
	assert.deepEqual(settings.fastMode, { mode: "normal", supported: true });

	listener({
		method: "thread/tokenUsage/updated",
		params: {
			threadId: "foreign-thread",
			turnId: "foreign-turn",
			tokenUsage: {
				last: { cachedInputTokens: 0, inputTokens: 1, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 },
				total: { cachedInputTokens: 0, inputTokens: 999, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 1_000 },
				modelContextWindow: 2_000,
			},
		},
	});
	assert.equal(settings.currentContextUsage, undefined);
	listener({
		method: "thread/tokenUsage/updated",
		params: {
			threadId: "thread-a",
			turnId: "turn-a",
			tokenUsage: {
				last: { cachedInputTokens: 0, inputTokens: 1, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 },
				total: { cachedInputTokens: 0, inputTokens: 25, outputTokens: 5, reasoningOutputTokens: 0, totalTokens: 30 },
			},
		},
	});
	assert.deepEqual(settings.currentContextUsage, { tokens: 30 });

	listener({
		method: "model/rerouted",
		params: {
			threadId: "foreign-thread",
			turnId: "foreign-turn",
			fromModel: "model-a",
			toModel: "model-b",
			reason: "fixture",
		},
	});
	assert.deepEqual(settings.activeModel, { provider: "openai-codex", id: "model-a" });
	listener({
		method: "model/rerouted",
		params: {
			threadId: "thread-a",
			turnId: "turn-a",
			fromModel: "model-a",
			toModel: "model-b",
			reason: "fixture",
		},
	});
	assert.deepEqual(settings.activeModel, { provider: "openai-codex", id: "model-b" });
	assert.equal(settings.reasoning.value, "low");
	assert.deepEqual(settings.fastMode, { mode: "normal", supported: false });
	settings.dispose();
	assert.equal(unsubscribed, true);
});
