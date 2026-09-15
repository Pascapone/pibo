import { defineTestCapabilitySetup, createTestCapabilityHost } from "./helpers/capability-host.mjs";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { createDefaultPiboCapabilityHost } from "./helpers/capability-fixtures.mjs";
import { PiboCapabilityHost } from "../dist/core/capability-host.js";
import { startPluginProductRuntime } from "../dist/plugins/product-runtime.js";
import { findCliToolEntry, listInstalledCliToolAgentContexts } from "../dist/tools/registry.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

async function startProductRegistry(t, createRegistry) {
	const root = await mkdtemp(join(tmpdir(), "pibo-plugin-registry-product-"));
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const registry = createRegistry();
	const product = await startPluginProductRuntime({
		host: registry.getPluginHost(),
		data,
		artifactRoot: join(root, "artifacts"),
		collectConsumers: async () => [],
	});
	t.after(async () => {
		await product.dispose();
		data.close();
		await rm(root, { recursive: true, force: true });
	});
	return registry;
}

async function withPiboHome(piboHome, run) {
	const previous = process.env.PIBO_HOME;
	process.env.PIBO_HOME = piboHome;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previous;
	}
}

test("capability host projects Core resources and installed package capabilities without retired aliases", async (t) => {
	const registry = await startProductRegistry(t, createDefaultPiboCapabilityHost);
	const catalog = registry.getCapabilityCatalog();

	assert.deepEqual(registry.getProfileNames(), ["base", "pibo-gateway-producer", "codex-native", "orp"]);
	assert.deepEqual(registry.createProfile("base").builtinToolNames, ["read", "bash", "edit", "write"]);
	assert.ok(catalog.nativeTools.some((tool) => (
		tool.name === "web_search" && tool.pluginId === "pibo.web-search" && tool.hasDefinition === false
	)));
	assert.ok(catalog.nativeTools.some((tool) => tool.name === "apply_patch" && tool.pluginId === "pibo.codex-compat"));
	assert.ok(catalog.nativeTools.some((tool) => tool.name === "view_image" && tool.pluginId === "pibo.codex-compat"));
	assert.ok(catalog.nativeTools.some((tool) => (
		tool.name === "codex_image_generation" && tool.pluginId === "pibo.codex-compat" && tool.hasDefinition === true
	)));
	assert.deepEqual(registry.getChannels().map((channel) => channel.name), ["pibo.loop"]);
	assert.deepEqual(
		registry.getCapabilityCatalog().skills
			.filter((skill) => skill.kind === "builtin")
			.map((skill) => skill.name),
		["pi-agent-harness", "pibo-agent-runtime-adapter", "pibo-spec-writing", "pibo-docker-system", "graphify", "prd", "skill-creator", "loop", "ralph-loop", "ralph-prd-json", "web-annotations"],
	);
	assert.deepEqual(registry.getGatewayActionInfos(), [
		{
			name: "status",
			description: "Return current session status with context usage quota.",
			slashCommands: ["status"],
		},
		{
			name: "compact",
			description: "Manually compact the session context.",
			slashCommands: ["compact"],
		},
		{
			name: "session_id",
			description: "Return the routed Pibo session id.",
			slashCommands: ["session"],
		},
		{
			name: "clear_queue",
			description: "Clear queued messages that have not started yet.",
			slashCommands: ["clear"],
		},
		{
			name: "abort",
			description: "Abort the active Pi agent run.",
			slashCommands: ["abort"],
		},
		{
			name: "kill",
			description: "Kill the active agent run and all subagent sessions recursively.",
			slashCommands: ["kill"],
		},
		{
			name: "kill_all",
			description: "Kill the active agent run, all subagent sessions recursively, and all yielded runs.",
			slashCommands: ["kill-all"],
		},
		{
			name: "thinking",
			description: "Show or set the active runtime reasoning level.",
			slashCommands: ["thinking"],
		},
		{
			name: "fast_mode",
			description: "Toggle OpenAI priority service tier for fast-capable reasoning models.",
			slashCommands: ["fast"],
		},
		{
			name: "session.current",
			description: "Return the active Pi session metadata for this routed session.",
			slashCommands: ["session-current"],
		},
		{
			name: "session.list",
			description: "List persisted Pi sessions for this workspace.",
			slashCommands: ["sessions"],
		},
		{
			name: "session.fork_candidates",
			description: "Return user messages that can be used as fork targets.",
			slashCommands: ["fork-candidates"],
		},
		{
			name: "session.fork",
			description: "Fork before a selected user message and create a visible Pibo session for the fork.",
			slashCommands: [],
		},
		{
			name: "session.clone",
			description: "Clone the current leaf and create a visible Pibo session for the clone.",
			slashCommands: ["clone"],
		},
		{
			name: "session.tree",
			description: "Return the current Pi session tree and active leaf.",
			slashCommands: ["tree"],
		},
		{
			name: "session.tree_navigate",
			description: "Move the current Pi session leaf to a selected tree entry.",
			slashCommands: [],
		},
		{
			name: "session.switch",
			description: "Switch the active Pi session to a persisted session file.",
			slashCommands: [],
		},
		{
			name: "login",
			description: "Open the interactive provider login menu for the active runtime.",
			slashCommands: ["login"],
		},
		{
			name: "model",
			description: "Open the interactive model selector for the active runtime.",
			slashCommands: ["model"],
		},
		{
			name: "login.start",
			description: "Start a provider login flow for the active runtime.",
			slashCommands: [],
		},
		{
			name: "login.complete",
			description: "Read or complete a provider login flow for the active runtime.",
			slashCommands: [],
		},
		{
			name: "login.apikey",
			description: "Set an API key for a provider on the active runtime.",
			slashCommands: [],
		},
		{
			name: "login.cancel",
			description: "Cancel a pending provider login for the active runtime.",
			slashCommands: [],
		},
		{
			name: "login.status",
			description: "Check provider authentication status for the active runtime.",
			slashCommands: [],
		},
		{
			name: "logout",
			description: "Remove stored credentials for a provider on the active runtime.",
			slashCommands: [],
		},
		{
			name: "goal",
			description: "Create or update the session Goal Loop. Use /goal pause or /goal resume to control it.",
			slashCommands: ["goal"],
		},
	]);
});

test("gateway producer profile composes from the installed gateway tool package", async (t) => {
	const registry = await startProductRegistry(t, createDefaultPiboCapabilityHost);
	const gatewayProducer = registry.createProfile("gateway-producer");

	assert.equal(gatewayProducer.profileName, "pibo-gateway-producer");
	assert.deepEqual(
		gatewayProducer.tools.map((tool) => tool.name),
		["pibo_gateway_send"],
	);
});

test("capability catalog exposes installed pibo tool context hints", async () => {
	const browserUse = findCliToolEntry("browser-use");
	const graphify = findCliToolEntry("graphify");
	assert.ok(browserUse);
	assert.ok(graphify);
	const piboHome = join(tmpdir(), `pibo-plugin-registry-tools-${Math.random().toString(36).slice(2)}`);

	await withPiboHome(piboHome, async () => {
		const paths = getToolPythonRuntimePaths(browserUse.name, browserUse.runtime);
		const graphifyPaths = getToolPythonRuntimePaths(graphify.name, graphify.runtime);
		mkdirSync(paths.binDir, { recursive: true });
		mkdirSync(graphifyPaths.binDir, { recursive: true });
		writeFileSync(paths.executablePath, "#!/bin/sh\n");
		writeFileSync(graphifyPaths.executablePath, "#!/bin/sh\n");

		const contexts = listInstalledCliToolAgentContexts();
		const browserUseContext = contexts.find((tool) => tool.name === "browser-use");
		const graphifyContext = contexts.find((tool) => tool.name === "graphify");
		const ralphContext = contexts.find((tool) => tool.name === "ralph");
		assert.match(browserUseContext?.snippet ?? "", /tools env browser-use/);
		assert.match(browserUseContext?.snippet ?? "", /tools browser-use lease acquire/);
		assert.match(graphifyContext?.snippet ?? "", /tools env graphify/);
		assert.match(graphifyContext?.snippet ?? "", /GRAPH_REPORT\.md/);
		assert.match(ralphContext?.snippet ?? "", /pibo ralph templates/);
		assert.match(ralphContext?.snippet ?? "", /pibo tools guide ralph ralph/);
		assert.equal(Object.hasOwn(createDefaultPiboCapabilityHost().getCapabilityCatalog(), "piboTools"), false);

		rmSync(paths.rootDir, { recursive: true, force: true });
		rmSync(graphifyPaths.rootDir, { recursive: true, force: true });
	});
});

test("capability catalog keeps user skills separate from plugin skills", () => {
	const registry = createDefaultPiboCapabilityHost();

	registry.registerSkill({ name: "personal-helper", path: "/tmp/personal-helper/SKILL.md", kind: "user" });

	assert.deepEqual(
		registry.getCapabilityCatalog().skills.find((skill) => skill.name === "personal-helper"),
		{
			name: "personal-helper",
			path: "/tmp/personal-helper/SKILL.md",
			kind: "user",
			pluginId: undefined,
			pluginName: undefined,
		},
	);
});

test("plugins can register profiles, gateway actions, and event listeners", async () => {
	const observed = [];
	const registry = createTestCapabilityHost({
		setups: [
			defineTestCapabilitySetup({
				id: "test.plugin",
				name: "Test Plugin",
				register(api) {
					api.registerTool({ name: "test_tool" });
					api.registerContextFile({ key: "test_context", path: "test-context.md" });
					api.registerProfile({
						name: "test-profile",
						aliases: ["test"],
						create(context) {
							return new InitialSessionContextBuilder("test-profile")
								.addTool(context.getTool("test_tool"))
								.createSession();
						},
					});
					api.registerGatewayAction({
						name: "test_action",
						execute(context) {
							return { piboSessionId: context.piboSessionId };
						},
					});
					api.onEvent((event) => {
						observed.push(event.type);
					});
					api.registerChannel({
						name: "test_channel",
						auth: { mode: "trusted-local" },
						start() {},
					});
					api.registerAuthService({
						name: "test_auth",
						getSession() {
							return Promise.resolve(undefined);
						},
						requireSession() {
							throw new Error("not used");
						},
					});
					api.registerWebApp({
						name: "test_web_app",
						mountPath: "/apps/test",
						apiPrefix: "/api/test",
						handleRequest() {
							return undefined;
						},
					});
				},
			}),
		],
	});

	const profile = registry.createProfile("test");
	assert.equal(profile.tools[0].name, "test_tool");
	const catalog = registry.getCapabilityCatalog();
	assert.deepEqual(
		catalog.nativeTools.find((tool) => tool.name === "test_tool"),
		{
			name: "test_tool",
			description: undefined,
			yieldable: true,
			hasDefinition: false,
			portable: true,
			pluginId: "test.plugin",
			pluginName: "Test Plugin",
		},
	);
	assert.equal(catalog.contextFiles.find((file) => file.key === "test_context")?.pluginName, "Test Plugin");

	const action = registry.getGatewayAction("test_action");
	assert.ok(action);
	assert.deepEqual(
		await action.execute({
			piboSessionId: "abc",
			getStatus() {
				throw new Error("not used");
			},
			clearQueue() {
				throw new Error("not used");
			},
			async abort() {},
			async dispose() {},
		}),
		{ piboSessionId: "abc" },
	);

	registry.notifyEvent({ type: "message_finished", piboSessionId: "abc" });
	assert.deepEqual(observed, ["message_finished"]);
	assert.equal(registry.getChannels()[0].name, "test_channel");
	assert.equal(registry.getAuthService().name, "test_auth");
	assert.equal(registry.getWebApps()[0].name, "test_web_app");
	assert.deepEqual(registry.getGatewayActionInfos(), [
		{
			name: "test_action",
			description: undefined,
			slashCommands: [],
		},
	]);
});

test("product events add metadata, preserve explicit fields, and isolate listeners", () => {
	const observed = [];
	const registry = createTestCapabilityHost();
	const unsubscribeFirst = registry.onProductEvent((event) => {
		observed.push({ listener: "first", id: event.id, type: event.type });
	});
	registry.onProductEvent(() => {
		throw new Error("product listener failed");
	});
	registry.onProductEvent((event) => {
		observed.push({ listener: "second", id: event.id, type: event.type });
	});

	const generated = registry.emitProductEvent({
		type: "capability.updated",
		source: "core",
		payload: { name: "generated" },
	});

	assert.match(generated.id, /^[0-9a-f-]{36}$/);
	assert.ok(Date.parse(generated.createdAt));
	assert.deepEqual(observed, [
		{ listener: "first", id: generated.id, type: "capability.updated" },
		{ listener: "second", id: generated.id, type: "capability.updated" },
	]);
	assert.deepEqual(registry.getEventErrors(), ["product listener failed"]);

	unsubscribeFirst();
	const explicit = registry.emitProductEvent({
		id: "caller-event-id",
		createdAt: "2026-05-10T12:00:00.000Z",
		type: "capability.updated",
		source: "plugin",
		payload: { name: "explicit" },
	});

	assert.equal(explicit.id, "caller-event-id");
	assert.equal(explicit.createdAt, "2026-05-10T12:00:00.000Z");
	assert.deepEqual(observed, [
		{ listener: "first", id: generated.id, type: "capability.updated" },
		{ listener: "second", id: generated.id, type: "capability.updated" },
		{ listener: "second", id: "caller-event-id", type: "capability.updated" },
	]);
	assert.deepEqual(registry.getEventErrors(), ["product listener failed", "product listener failed"]);
});

test("capability host rejects duplicate Core registrations", () => {
	assert.throws(
		() =>
			createTestCapabilityHost({
				setups: [
					defineTestCapabilitySetup({
						id: "duplicate",
						register(api) {
							api.registerTool({ name: "same_tool" });
							api.registerTool({ name: "same_tool" });
						},
					}),
				],
			}),
		/Duplicate tool "same_tool"/,
	);

	assert.throws(
		() =>
			createTestCapabilityHost({
				setups: [
					defineTestCapabilitySetup({
						id: "duplicate-slash",
						register(api) {
							api.registerGatewayAction({
								name: "first",
								slashCommands: ["same"],
								execute() {},
							});
							api.registerGatewayAction({
								name: "second",
								slashCommands: ["same"],
								execute() {},
							});
						},
					}),
				],
			}),
		/Duplicate slash command "same"/,
	);

	assert.throws(
		() =>
			createTestCapabilityHost({
				setups: [
					defineTestCapabilitySetup({
						id: "duplicate-auth",
						register(api) {
							const service = {
								name: "auth",
								getSession() {
									return Promise.resolve(undefined);
								},
								requireSession() {
									throw new Error("not used");
								},
							};
							api.registerAuthService(service);
							api.registerAuthService(service);
						},
					}),
				],
			}),
		/Auth service "auth" is already registered/,
	);

	assert.throws(
		() =>
			createTestCapabilityHost({
				setups: [
					defineTestCapabilitySetup({
						id: "web-route-conflict",
						register(api) {
							api.registerWebApp({
								name: "first",
								mountPath: "/apps/chat",
								apiPrefix: "/api/chat",
								handleRequest() {
									return undefined;
								},
							});
							api.registerWebApp({
								name: "second",
								mountPath: "/apps/chat/admin",
								apiPrefix: "/api/admin",
								handleRequest() {
									return undefined;
								},
							});
						},
					}),
				],
			}),
		/Web app route "\/apps\/chat\/admin" for "second" overlaps mountPath "\/apps\/chat" from web app "first"/,
	);
});
