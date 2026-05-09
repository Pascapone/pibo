import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createDefaultPiboPluginRegistry, createGatewayProducerPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";
import { findCliToolEntry } from "../dist/tools/registry.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

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

async function withCwd(cwd, run) {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

test("default plugin registry builds profiles from registered resources", () => {
	const registry = createDefaultPiboPluginRegistry();

	const codex = registry.createProfile("codex");

	assert.equal(codex.profileName, "codex-compat-openai-web");
	assert.deepEqual(
		codex.tools.map((tool) => tool.name),
		["apply_patch", "web_search", "view_image", "runtime"],
	);
	assert.deepEqual(
		codex.subagents.map((subagent) => subagent.name),
		["default", "explorer", "worker"],
	);
	assert.ok(registry.getCapabilityCatalog().nativeTools.some((tool) => (
		tool.name === "web_search" && tool.pluginId === "pibo.core" && tool.hasDefinition === false
	)));
	assert.deepEqual(registry.getChannels().map((channel) => channel.name), []);
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
			description: "Show or set the routed Pi thinking level.",
			slashCommands: ["thinking"],
		},
		{
			name: "fast_mode",
			description: "Toggle between Fast mode and Normal mode for models with thinking support.",
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
			description: "Open the interactive provider login menu.",
			slashCommands: ["login"],
		},
		{
			name: "model",
			description: "Open the interactive model selector for authenticated providers.",
			slashCommands: ["model"],
		},
		{
			name: "login.start",
			description: "Start an OAuth login flow for a provider. Returns a URL to open in a browser.",
			slashCommands: [],
		},
		{
			name: "login.complete",
			description: "Complete an OAuth login flow with the authorization code from the provider callback.",
			slashCommands: [],
		},
		{
			name: "login.apikey",
			description: "Set an API key directly for a provider.",
			slashCommands: [],
		},
		{
			name: "login.status",
			description: "Check the authentication status for providers.",
			slashCommands: [],
		},
		{
			name: "logout",
			description: "Remove stored credentials for a provider.",
			slashCommands: [],
		},
	]);
});

test("gateway producer profile is available only through its parked registry", () => {
	const registry = createGatewayProducerPiboPluginRegistry();
	const gatewayProducer = registry.createProfile("gateway-producer");

	assert.equal(gatewayProducer.profileName, "pibo-gateway-producer");
	assert.deepEqual(
		gatewayProducer.tools.map((tool) => tool.name),
		["pibo_gateway_send"],
	);
});

test("capability catalog exposes installed pibo tool context hints", async () => {
	const browserUse = findCliToolEntry("browser-use");
	assert.ok(browserUse);
	const piboHome = join(tmpdir(), `pibo-plugin-registry-tools-${Math.random().toString(36).slice(2)}`);

	await withPiboHome(piboHome, async () => {
		const paths = getToolPythonRuntimePaths(browserUse.name, browserUse.runtime);
		mkdirSync(paths.binDir, { recursive: true });
		writeFileSync(paths.executablePath, "#!/bin/sh\n");

		const registry = createDefaultPiboPluginRegistry();
		const catalog = registry.getCapabilityCatalog();
		const browserUseCatalogEntry = catalog.piboTools.find((tool) => tool.name === "browser-use");

		assert.ok(browserUseCatalogEntry);
		assert.match(browserUseCatalogEntry.snippet, /tools env browser-use/);
		assert.match(browserUseCatalogEntry.snippet, /tools browser-use lease acquire/);

		rmSync(paths.rootDir, { recursive: true, force: true });
	});
});

test("capability catalog keeps user skills separate from plugin skills", () => {
	const registry = createDefaultPiboPluginRegistry();

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

test("capability catalog exposes registered Pi packages without activating them", async () => {
	const cwd = join(tmpdir(), `pibo-plugin-registry-pi-packages-${Math.random().toString(36).slice(2)}`);
	mkdirSync(cwd, { recursive: true });
	await withCwd(cwd, () => {
		upsertPiPackage({
			id: "catalog-package",
			name: "catalog-package",
			source: "/tmp/catalog-package",
			installSpec: "/tmp/catalog-package",
			resourceTypes: ["skill"],
			installStatus: "registered",
			diagnostics: [{ type: "warning", message: "not installed" }],
		});
		const registry = createDefaultPiboPluginRegistry();
		const catalog = registry.getCapabilityCatalog();
		const codex = registry.createProfile("codex");

		assert.equal(catalog.piPackages.find((pkg) => pkg.id === "catalog-package")?.installStatus, "registered");
		assert.deepEqual(codex.piPackages, []);
	});
});

test("plugins can register profiles, gateway actions, and event listeners", async () => {
	const observed = [];
	const registry = PiboPluginRegistry.create({
		plugins: [
			definePiboPlugin({
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

test("plugin registry rejects duplicate registrations", () => {
	assert.throws(
		() =>
			PiboPluginRegistry.create({
				plugins: [
					definePiboPlugin({
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
			PiboPluginRegistry.create({
				plugins: [
					definePiboPlugin({
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
			PiboPluginRegistry.create({
				plugins: [
					definePiboPlugin({
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
			PiboPluginRegistry.create({
				plugins: [
					definePiboPlugin({
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
