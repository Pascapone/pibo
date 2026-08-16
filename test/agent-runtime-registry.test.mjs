import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { exerciseAgentRuntimeAdapterContract } from "../dist/agent-runtime/testing/contract.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PI_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/pi/adapter.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { createPiboSession } from "../dist/sessions/store.js";

function openInput(profile, overrides = {}) {
	const piboSession = createPiboSession({
		id: overrides.piboSessionId ?? "ps_runtime_contract",
		piSessionId: overrides.piSessionId ?? "11111111-1111-4111-8111-111111111111",
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace: process.cwd(),
	});
	return {
		piboSession,
		profile,
		workspace: piboSession.workspace,
		productContext: { piboSessionId: piboSession.id },
		...overrides.input,
	};
}

test("default profiles and capability catalog expose the configured Pi runtime", () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("base");
	const runtime = registry.requireAgentRuntimeAdapter("pi");
	const catalogEntry = registry.getCapabilityCatalog().agentRuntimes.find((entry) => entry.id === "pi");

	assert.equal(profile.runtimeInstanceId, "pi");
	assert.deepEqual(profile.runtimeOptions, {});
	assert.equal(runtime.descriptor.id, "pi");
	assert.equal(runtime.enabled, true);
	assert.equal(catalogEntry.adapterId, "pi");
	assert.equal(catalogEntry.transport, "embedded");
	assert.equal(catalogEntry.capabilities.lifecycle.resume, true);
	assert.equal(catalogEntry.capabilities.tools.piboManaged.support, "direct");
	assert.equal(catalogEntry.capabilities.tools.nativeToolInspection.support, "native");
	assert.equal(catalogEntry.capabilities.mcp.externalServers.support, "materialized");
	assert.deepEqual(catalogEntry.capabilities.mcp.externalServers.modes, ["isolated-pibo-mcp-config"]);
	assert.equal(catalogEntry.capabilities.mcp.statusInspection, true);

	// Current upstream/dev intentionally has no built-in `codex` profile alias. Native Codex
	// must remain on a distinct profile and must not claim this retired name implicitly.
	assert.throws(() => registry.createProfile("codex"), /Unknown profile "codex"/);
});

test("runtime registry reports availability diagnostics and validates profile options", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const inspections = await registry.inspectAgentRuntimeInstances();
	const pi = inspections.find((runtime) => runtime.id === "pi");
	assert.equal(pi.available, true);
	assert.ok(pi.diagnostics.some((diagnostic) => diagnostic.code === "pi_runtime_available"));
	assert.equal(pi.models.runtimeInstanceId, "pi");
	assert.ok(pi.models.models.length > 0);
	assert.ok(pi.auth.length > 0);

	const valid = await registry.validateAgentRuntimeProfile(
		new InitialSessionContextBuilder("valid-pi").withAgentRuntime("pi").createSession(),
	);
	assert.equal(valid.some((diagnostic) => diagnostic.severity === "error"), false);

	const invalid = await registry.validateAgentRuntimeProfile(
		new InitialSessionContextBuilder("invalid-pi").withAgentRuntime("pi", { unexpected: true }).createSession(),
	);
	assert.ok(invalid.some((diagnostic) => diagnostic.code === "pi_runtime_options_unsupported"));

	const unknown = await registry.validateAgentRuntimeProfile(
		new InitialSessionContextBuilder("unknown-runtime").withAgentRuntime("missing-runtime").createSession(),
	);
	assert.ok(unknown.some((diagnostic) => diagnostic.code === "runtime_instance_unknown"));

	const mcpWithoutBash = await registry.validateAgentRuntimeProfile(
		new InitialSessionContextBuilder("pi-mcp-without-bash")
			.withAgentRuntime("pi")
			.withBuiltinTools("disabled")
			.withMcpServers(["filesystem"])
			.createSession(),
	);
	assert.ok(mcpWithoutBash.some((diagnostic) => diagnostic.code === "pi_mcp_bash_required"));
});

test("runtime inspection rejects a declared model catalog without a listModels implementation", async () => {
	const capabilities = createFakeAgentRuntimeDriver({ adapterId: "catalog-template" }).descriptor.capabilities;
	capabilities.models.catalog = true;
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(createFakeAgentRuntimeDriver({ adapterId: "catalog-missing", capabilities }));
	registry.registerInstance({ id: "catalog-missing", adapterId: "catalog-missing" });
	const [inspection] = await registry.inspectInstances();
	assert.equal(inspection.available, false);
	assert.ok(inspection.diagnostics.some((diagnostic) => diagnostic.code === "runtime_model_catalog_contract_missing"));
});

test("runtime registry rejects profile selections that declared capabilities cannot deliver", async () => {
	const fakeDriver = createFakeAgentRuntimeDriver({ adapterId: "partial-runtime" });
	const registry = PiboPluginRegistry.create({
		plugins: [definePiboPlugin({
			id: "test.partial-runtime",
			register(api) {
				api.registerAgentRuntimeDriver(fakeDriver);
				api.registerAgentRuntimeInstance({ id: "partial-runtime", adapterId: "partial-runtime" });
			},
		})],
	});
	const invalidProfile = new InitialSessionContextBuilder("partial-profile")
		.withAgentRuntime("partial-runtime")
		.addTool({ name: "pibo-tool" })
		.addSkill({ name: "portable-skill", path: "/tmp/SKILL.md" })
		.addContextFile({ key: "project-context", path: "/tmp/AGENTS.md" })
		.withMcpServers(["filesystem"])
		.withThinkingLevel("high")
		.createSession();
	const diagnostics = await registry.validateAgentRuntimeProfile(invalidProfile);
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "runtime_pibo_tools_unsupported"));
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "runtime_external_mcp_unsupported"));
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "runtime_skills_unsupported"));
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "runtime_context_unsupported"));
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "runtime_reasoning_unsupported"));

	const validPartialProfile = new InitialSessionContextBuilder("partial-profile")
		.withAgentRuntime("partial-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	assert.equal(
		(await registry.validateAgentRuntimeProfile(validPartialProfile)).some((diagnostic) => diagnostic.severity === "error"),
		false,
	);
});

test("MCP-delivered runtimes reject legacy private tools and explain native-tool yielding limits", async () => {
	const capabilities = createFakeAgentRuntimeDriver({ adapterId: "mcp-template" }).descriptor.capabilities;
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	capabilities.tools.nativeToolYielding = { support: "unsupported", reason: "The harness does not expose private native tools to Pibo." };
	const registry = PiboPluginRegistry.create({
		plugins: [definePiboPlugin({
			id: "test.mcp-runtime",
			register(api) {
				api.registerAgentRuntimeDriver(createFakeAgentRuntimeDriver({ adapterId: "mcp-runtime", capabilities }));
				api.registerAgentRuntimeInstance({ id: "mcp-runtime", adapterId: "mcp-runtime" });
			},
		})],
	});
	const legacyTool = {
		name: "legacy-private",
		label: "Legacy Private",
		description: "Legacy Pi-native fixture",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() { return { content: [{ type: "text", text: "legacy" }], details: {} }; },
	};
	const legacyProfile = new InitialSessionContextBuilder("legacy-private-profile")
		.withAgentRuntime("mcp-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "legacy-private", definition: legacyTool })
		.createSession();
	const legacyDiagnostics = await registry.validateAgentRuntimeProfile(legacyProfile);
	assert.ok(legacyDiagnostics.some((diagnostic) => diagnostic.code === "runtime_pibo_tool_not_portable"));

	const portableTool = {
		name: "portable",
		title: "Portable",
		description: "Portable fixture",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		async execute() { return { content: [{ type: "text", text: "portable" }] }; },
	};
	const runControlProfile = new InitialSessionContextBuilder("portable-run-profile")
		.withAgentRuntime("mcp-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false, runControl: true })
		.addTool({ name: "portable", definition: portableTool })
		.createSession();
	const runDiagnostics = await registry.validateAgentRuntimeProfile(runControlProfile);
	assert.equal(runDiagnostics.some((diagnostic) => diagnostic.severity === "error"), false);
	assert.ok(runDiagnostics.some((diagnostic) => diagnostic.code === "runtime_native_tool_yielding_unsupported"));
});

test("materialized context requires an explicit automatic project-discovery mode", async () => {
	const capabilities = createFakeAgentRuntimeDriver({ adapterId: "context-template" }).descriptor.capabilities;
	capabilities.context = { support: "materialized", modes: ["isolated-context-files"] };
	const registry = PiboPluginRegistry.create({
		plugins: [definePiboPlugin({
			id: "test.context-runtime",
			register(api) {
				api.registerAgentRuntimeDriver(createFakeAgentRuntimeDriver({ adapterId: "context-runtime", capabilities }));
				api.registerAgentRuntimeInstance({ id: "context-runtime", adapterId: "context-runtime" });
			},
		})],
	});
	const automaticProfile = new InitialSessionContextBuilder("automatic-context-profile")
		.withAgentRuntime("context-runtime")
		.withBuiltinTools("disabled")
		.withToolPackages({ goalControl: false })
		.createSession();
	const automaticDiagnostics = await registry.validateAgentRuntimeProfile(automaticProfile);
	assert.ok(automaticDiagnostics.some((diagnostic) => diagnostic.code === "runtime_auto_context_discovery_unsupported"));

	capabilities.context = { support: "materialized", modes: ["isolated-context-files", "native-project-discovery"] };
	const supportedRegistry = PiboPluginRegistry.create({
		plugins: [definePiboPlugin({
			id: "test.context-runtime-supported",
			register(api) {
				api.registerAgentRuntimeDriver(createFakeAgentRuntimeDriver({ adapterId: "context-runtime-supported", capabilities }));
				api.registerAgentRuntimeInstance({ id: "context-runtime-supported", adapterId: "context-runtime-supported" });
			},
		})],
	});
	const supportedProfile = new InitialSessionContextBuilder("supported-auto-context-profile")
		.withAgentRuntime("context-runtime-supported")
		.withBuiltinTools("disabled")
		.withToolPackages({ goalControl: false })
		.createSession();
	assert.equal(
		(await supportedRegistry.validateAgentRuntimeProfile(supportedProfile)).some((diagnostic) => diagnostic.severity === "error"),
		false,
	);
});


test("plugins register typed runtime drivers and configured instances", () => {
	const fakeDriver = createFakeAgentRuntimeDriver({ adapterId: "fixture-runtime" });
	const registry = PiboPluginRegistry.create({
		plugins: [
			definePiboPlugin({
				id: "test.runtime-plugin",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({
						id: "fixture-primary",
						adapterId: "fixture-runtime",
						displayName: "Fixture Primary",
					});
					api.registerProfile({
						name: "fixture-profile",
						create() {
							return new InitialSessionContextBuilder("fixture-profile")
								.withAgentRuntime("fixture-primary", { mode: "test" })
								.createSession();
						},
					});
				},
			}),
		],
	});

	const profile = registry.createProfile("fixture-profile");
	assert.equal(profile.runtimeInstanceId, "fixture-primary");
	assert.deepEqual(profile.runtimeOptions, { mode: "test" });
	assert.deepEqual(registry.getAgentRuntimeInstanceIds(), ["fixture-primary"]);
	assert.equal(registry.requireAgentRuntimeAdapter("fixture-primary").descriptor.id, "fixture-runtime");
	assert.equal(registry.getProfileInfos()[0].runtimeInstanceId, "fixture-primary");
});

test("custom Pi-backed runtime instance ids preserve persisted codex references without creating a profile alias", async () => {
	const registry = createDefaultPiboPluginRegistry();
	registry.registerAgentRuntimeInstance({ id: "codex", adapterId: "pi", displayName: "Persisted Pi Codex Instance" });
	const profile = new InitialSessionContextBuilder("persisted-custom-profile")
		.withAgentRuntime("codex")
		.createSession();
	const diagnostics = await registry.validateAgentRuntimeProfile(profile);
	assert.equal(diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);
	assert.equal(registry.requireAgentRuntimeAdapter("codex").descriptor.id, "pi");
	assert.throws(() => registry.createProfile("codex"), /Unknown profile "codex"/);
});

test("runtime registry rejects duplicate, unknown, invalid, and disabled instances", () => {
	const registry = new AgentRuntimeAdapterRegistry();
	const driver = createFakeAgentRuntimeDriver({ adapterId: "fixture" });
	registry.registerDriver(driver);
	assert.throws(() => registry.registerDriver(driver), /already registered/);
	assert.throws(
		() => registry.registerInstance({ id: "missing-driver", adapterId: "missing" }),
		/unknown adapter/,
	);
	assert.throws(
		() => registry.registerInstance({ id: "Invalid Runtime", adapterId: "fixture" }),
		/must match/,
	);
	registry.registerInstance({ id: "fixture", adapterId: "fixture" });
	const piRegistry = new AgentRuntimeAdapterRegistry();
	piRegistry.registerDriver(PI_AGENT_RUNTIME_DRIVER);
	assert.throws(
		() => piRegistry.registerInstance({ id: "pi-invalid", adapterId: "pi", config: { unexpected: true } }),
		/does not accept instance fields/,
	);
	assert.throws(
		() => registry.registerInstance({ id: "fixture", adapterId: "fixture" }),
		/already registered/,
	);
	registry.registerInstance({ id: "fixture-disabled", adapterId: "fixture", enabled: false });
	assert.throws(() => registry.requireInstance("fixture-disabled"), /disabled/);
	assert.throws(() => registry.requireInstance("unknown"), /Unknown agent runtime instance/);
});

test("runtime registry validates descriptor and live-session capability claims", async () => {
	const invalidDescriptorRegistry = new AgentRuntimeAdapterRegistry();
	const invalidDriver = createFakeAgentRuntimeDriver({ adapterId: "invalid-capabilities" });
	invalidDriver.descriptor.capabilities.lifecycle.persistent = false;
	invalidDriver.descriptor.capabilities.lifecycle.resume = true;
	assert.throws(
		() => invalidDescriptorRegistry.registerDriver(invalidDriver),
		/lifecycle\.resume requires lifecycle\.persistent/,
	);

	const registry = new AgentRuntimeAdapterRegistry();
	const driver = createFakeAgentRuntimeDriver({ adapterId: "invalid-session" });
	driver.descriptor.capabilities.maintenance.compaction = true;
	registry.registerDriver(driver);
	registry.registerInstance({ id: "invalid-session", adapterId: "invalid-session" });
	const profile = new InitialSessionContextBuilder("invalid-session-profile")
		.withAgentRuntime("invalid-session")
		.createSession();
	await assert.rejects(
		() => registry.openSession("invalid-session", openInput(profile)),
		/maintenance\.compaction requires controls\.compact/,
	);
});

test("runtime registry requires declared native history providers to implement inspection and reads", () => {
	const registry = new AgentRuntimeAdapterRegistry();
	const capabilities = createFakeAgentRuntimeDriver({ adapterId: "history-contract-template" }).descriptor.capabilities;
	capabilities.maintenance.history = true;
	registry.registerDriver(createFakeAgentRuntimeDriver({ adapterId: "history-contract", capabilities }));
	assert.throws(
		() => registry.registerInstance({ id: "history-contract", adapterId: "history-contract" }),
		/declares maintenance\.history.*inspectHistory\(\).*readHistory\(\)/,
	);
});

test("deterministic fake adapter passes the reusable lifecycle contract", async () => {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(createFakeAgentRuntimeDriver({
		adapterId: "contract-fake",
		script: {
			events: [
				{ type: "assistant_delta", text: "hel" },
				{ type: "assistant_message", text: "hello" },
				{ type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
			],
		},
	}));
	const adapter = registry.registerInstance({ id: "contract-fake", adapterId: "contract-fake" });
	const profile = new InitialSessionContextBuilder("contract-profile")
		.withAgentRuntime("contract-fake")
		.createSession();
	const result = await exerciseAgentRuntimeAdapterContract(adapter, openInput(profile));

	assert.deepEqual(result.events.map((event) => event.type), [
		"turn_started",
		"assistant_delta",
		"assistant_message",
		"usage",
		"turn_completed",
	]);
	assert.equal(result.session.getBinding().nativeSessionId, "fake-native-1");
	assert.equal(result.session.getStatus().streaming, false);
	assert.equal(result.session.disposeCalls, 2);
});

test("fake adapter covers abort, failure, missing binding, and idempotent cleanup", async () => {
	const profile = new InitialSessionContextBuilder("fake-edge-profile")
		.withAgentRuntime("fake-edge")
		.createSession();

	const abortRegistry = new AgentRuntimeAdapterRegistry();
	abortRegistry.registerDriver(createFakeAgentRuntimeDriver({
		adapterId: "fake-edge",
		script: { waitForAbort: true },
	}));
	abortRegistry.registerInstance({ id: "fake-edge", adapterId: "fake-edge" });
	const abortSession = await abortRegistry.openSession("fake-edge", openInput(profile));
	const abortEvents = [];
	abortSession.subscribe((event) => abortEvents.push(event));
	const pendingPrompt = abortSession.prompt({ text: "wait", source: "rpc" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(abortSession.getStatus().streaming, true);
	await abortSession.abort();
	await pendingPrompt;
	assert.equal(abortSession.getStatus().streaming, false);
	assert.equal(abortEvents.at(-1).type, "turn_completed");
	assert.equal(abortEvents.at(-1).status, "aborted");
	await abortSession.dispose();
	await abortSession.dispose();

	const failureRegistry = new AgentRuntimeAdapterRegistry();
	failureRegistry.registerDriver(createFakeAgentRuntimeDriver({
		adapterId: "fake-edge",
		script: { failWith: "fixture crash" },
	}));
	failureRegistry.registerInstance({ id: "fake-edge", adapterId: "fake-edge" });
	const failureSession = await failureRegistry.openSession("fake-edge", openInput(profile));
	const failureEvents = [];
	failureSession.subscribe((event) => failureEvents.push(event));
	await assert.rejects(
		() => failureSession.prompt({ text: "fail", source: "rpc" }),
		/fixture crash/,
	);
	assert.equal(failureEvents.some((event) => event.type === "turn_failed"), true);
	await failureSession.dispose();

	const missingRegistry = new AgentRuntimeAdapterRegistry();
	missingRegistry.registerDriver(createFakeAgentRuntimeDriver({
		adapterId: "fake-edge",
		script: { missingNativeSession: true },
	}));
	missingRegistry.registerInstance({ id: "fake-edge", adapterId: "fake-edge" });
	await assert.rejects(
		() => missingRegistry.openSession("fake-edge", {
			...openInput(profile),
			binding: {
				piboSessionId: "ps_runtime_contract",
				runtimeInstanceId: "fake-edge",
				adapterId: "fake-edge",
				nativeSessionId: "missing-native",
				state: "bound",
			},
		}),
		(error) => error?.name === "AgentRuntimeBindingMissingError",
	);
});

test("Pi adapter opens the existing Pi runtime without rewriting the requested session id", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const adapter = registry.requireAgentRuntimeAdapter("pi");
	const profile = new InitialSessionContextBuilder("pi-contract")
		.withAgentRuntime("pi")
		.withSessionId("22222222-2222-4222-8222-222222222222")
		.createSession();
	const session = await adapter.openSession({
		...openInput(profile, { piSessionId: "22222222-2222-4222-8222-222222222222" }),
		services: { compatibility: { persistSession: false } },
	});
	try {
		assert.equal(session.adapterId, "pi");
		assert.equal(session.runtimeInstanceId, "pi");
		assert.equal(session.getBinding().nativeSessionId, "22222222-2222-4222-8222-222222222222");
		assert.equal(session.getBinding().state, "bound");
		assert.equal(session.getNativeCompatibilityHandle().session.sessionId, "22222222-2222-4222-8222-222222222222");
	} finally {
		await session.dispose();
	}
});
