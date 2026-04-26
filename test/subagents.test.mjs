import assert from "node:assert/strict";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import {
	createSubagentSessionKey,
	createSubagentToolDefinitions,
	createSubagentToolName,
	getSubagentSessionDepth,
} from "../dist/subagents/tool.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";

const noopSubagentRunner = {
	async runSubagent(input) {
		return {
			sessionKey: createSubagentSessionKey("parent", input.subagent.name, input.threadKey),
			eventId: "event-1",
			reply: {
				type: "assistant_message",
				sessionKey: createSubagentSessionKey("parent", input.subagent.name, input.threadKey),
				eventId: "event-1",
				text: "helper result",
			},
		};
	},
};

class MemoryBindingStore {
	constructor(bindings = []) {
		this.bindings = new Map(bindings.map((binding) => [binding.sessionKey, binding]));
	}

	get(sessionKey) {
		return this.bindings.get(sessionKey);
	}

	resolve(input) {
		const existing = this.get(input.sessionKey ?? `${input.channel}:${input.externalId}`);
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
			createdAt: now,
			updatedAt: now,
		};
		this.bindings.set(binding.sessionKey, binding);
		return binding;
	}
}

test("subagent helpers create deterministic session keys and tool names", () => {
	assert.equal(createSubagentToolName("research-helper"), "pibo_subagent_research_helper");
	assert.equal(createSubagentToolName("Research Helper"), "pibo_subagent_research_helper");
	assert.equal(
		createSubagentSessionKey("chat:user-1", "research-helper", "auth-plan"),
		"chat:user-1::sub::research-helper::auth-plan",
	);
	assert.match(
		createSubagentSessionKey("chat:user-1", "research-helper", ""),
		/^chat:user-1::sub::research-helper::[a-f0-9-]+$/,
	);
	assert.equal(getSubagentSessionDepth("chat:user-1::sub::research-helper::auth-plan"), 1);
	assert.equal(getSubagentSessionDepth("chat:user-1::sub::a::x::sub::b::y"), 2);
	assert.throws(
		() =>
			createSubagentToolDefinitions(
				[
					{ name: "same-name", targetProfile: "helper-profile" },
					{ name: "same_name", targetProfile: "helper-profile" },
				],
				noopSubagentRunner,
			),
		/Duplicate subagent tool name "pibo_subagent_same_name"/,
	);
});

test("session context builder preserves parent session ids", () => {
	const context = new InitialSessionContextBuilder("child-profile")
		.withSessionId("child-session")
		.withParentSessionId("parent-session")
		.createSession();

	assert.equal(context.sessionId, "child-session");
	assert.equal(context.parentSessionId, "parent-session");
});

test("subagent tool definitions delegate execution to the provided runner", async () => {
	let observed;
	const [tool] = createSubagentToolDefinitions(
		[
			{
				name: "helper",
				description: "Ask the helper agent.",
				targetProfile: "helper-profile",
				executionMode: "parallel",
			},
		],
		{
			async runSubagent(input) {
				observed = input;
				return noopSubagentRunner.runSubagent(input);
			},
		},
	);

	assert.equal(tool.name, "pibo_subagent_helper");
	assert.equal(tool.executionMode, "parallel");

	const result = await tool.execute("tool-call-1", {
		message: "Find the relevant files.",
		threadKey: "files",
	});

	assert.equal(observed.message, "Find the relevant files.");
	assert.equal(observed.threadKey, "files");
	assert.equal(result.details.sessionKey, "parent::sub::helper::files");
	assert.equal(result.content[0].text, "helper result");
});

test("profiles can expose subagents as active router tools", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	registry.registerPlugin(
		definePiboPlugin({
			id: "test.subagents",
			register(api) {
				api.registerSubagent({
					name: "helper",
					description: "Ask the helper profile.",
					targetProfile: "helper-profile",
				});
				api.registerProfile({
					name: "parent-profile",
					create(context) {
						return new InitialSessionContextBuilder("parent-profile")
							.addSubagent(context.getSubagent("helper"))
							.createSession();
					},
				});
				api.registerProfile({
					name: "helper-profile",
					create() {
						return new InitialSessionContextBuilder("helper-profile").createSession();
					},
				});
			},
		}),
	);

	const now = new Date().toISOString();
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		bindingStore: new MemoryBindingStore([
			{
				sessionKey: "parent",
				sessionId: "parent-session",
				channel: "test",
				externalId: "parent",
				originalProfile: "parent-profile",
				createdAt: now,
				updatedAt: now,
			},
		]),
	});

	try {
		const output = await router.emit({
			type: "execution",
			sessionKey: "parent",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("pibo_subagent_helper"), true);
	} finally {
		await router.disposeAll();
	}
});

test("default run-yield QA profile exposes run control tools", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("run-yield-qa");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.map((tool) => tool.name));

	assert.deepEqual(
		inspection.subagents.map((subagent) => subagent.name),
		["qa-researcher", "qa-reviewer"],
	);
	assert.equal(activeTools.has("pibo_echo"), true);
	assert.equal(activeTools.has("pibo_workspace_info"), true);
	assert.equal(activeTools.has("pibo_exec"), true);
	assert.equal(activeTools.has("pibo_subagent_qa_researcher"), true);
	assert.equal(activeTools.has("pibo_subagent_qa_reviewer"), true);
	assert.equal(activeTools.has("pibo_run_start"), true);
	assert.equal(activeTools.has("pibo_run_list"), true);
	assert.equal(activeTools.has("pibo_run_wait"), true);
	assert.equal(activeTools.has("pibo_run_read"), true);
	assert.equal(activeTools.has("pibo_run_cancel"), true);
	assert.equal(activeTools.has("pibo_run_ack"), true);
	assert.equal(inspection.subagents.every((subagent) => subagent.active), true);
	assert.equal(inspection.diagnostics.length, 0);
});
