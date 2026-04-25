import assert from "node:assert/strict";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";

test("default plugin registry builds profiles from registered resources", () => {
	const registry = createDefaultPiboPluginRegistry();

	const minimal = registry.createProfile("minimal");
	const gatewayProducer = registry.createProfile("gateway-producer");
	const example = registry.createProfile("example-plugin");

	assert.equal(minimal.profileName, "pibo-minimal");
	assert.deepEqual(
		minimal.tools.map((tool) => tool.name),
		["pibo_echo", "pibo_workspace_info"],
	);
	assert.equal(gatewayProducer.profileName, "pibo-gateway-producer");
	assert.deepEqual(
		gatewayProducer.tools.map((tool) => tool.name),
		["pibo_echo", "pibo_workspace_info", "pibo_gateway_send"],
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
});
