import assert from "node:assert/strict";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";

test("default plugin registry builds profiles from registered resources", () => {
	const registry = createDefaultPiboPluginRegistry();

	const minimal = registry.createProfile("minimal");
	const runYieldQa = registry.createProfile("run-yield-qa");
	const gatewayProducer = registry.createProfile("gateway-producer");
	const example = registry.createProfile("example-plugin");

	assert.equal(minimal.profileName, "pibo-minimal");
	assert.deepEqual(
		minimal.tools.map((tool) => tool.name),
		["pibo_echo", "pibo_workspace_info", "pibo_exec"],
	);
	assert.equal(gatewayProducer.profileName, "pibo-gateway-producer");
	assert.deepEqual(
		gatewayProducer.tools.map((tool) => tool.name),
		["pibo_echo", "pibo_workspace_info", "pibo_exec", "pibo_gateway_send"],
	);
	assert.equal(runYieldQa.profileName, "pibo-run-yield-qa");
	assert.deepEqual(
		runYieldQa.subagents.map((subagent) => subagent.name),
		["qa-researcher", "qa-reviewer"],
	);
	assert.equal(example.profileName, "pibo-example-plugin");
	assert.deepEqual(
		example.skills.map((skill) => skill.name),
		["pibo-example-plugin"],
	);
	assert.deepEqual(
		example.tools.map((tool) => tool.name),
		["pibo_example_plugin_note"],
	);
	assert.deepEqual(
		registry.getChannels().map((channel) => channel.name),
		["pibo-example-channel", "remote-agent"],
	);
	assert.deepEqual(registry.getGatewayActionInfos(), [
		{
			name: "status",
			description: "Return current session status.",
			slashCommands: ["status"],
		},
		{
			name: "session_id",
			description: "Return the routed session key.",
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
			description: "Fork before a selected user message and make the fork the active Pi session.",
			slashCommands: [],
		},
		{
			name: "session.clone",
			description: "Clone the current leaf and make the clone the active Pi session.",
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
	]);
});

test("plugins can register profiles, gateway actions, and event listeners", async () => {
	const observed = [];
	const registry = PiboPluginRegistry.create({
		plugins: [
			definePiboPlugin({
				id: "test.plugin",
				register(api) {
					api.registerTool({ name: "test_tool" });
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
							return { sessionKey: context.sessionKey };
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

	const action = registry.getGatewayAction("test_action");
	assert.ok(action);
	assert.deepEqual(
		await action.execute({
			sessionKey: "abc",
			getStatus() {
				throw new Error("not used");
			},
			clearQueue() {
				throw new Error("not used");
			},
			async abort() {},
			async dispose() {},
		}),
		{ sessionKey: "abc" },
	);

	registry.notifyEvent({ type: "message_finished", sessionKey: "abc" });
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
