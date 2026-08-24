import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime, inspectPiboProfile } from "../dist/core/runtime.js";
import { normalizePiEvent } from "../dist/agent-runtimes/pi/routed-session.js";
import { PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";
import { createRunToolDefinitions } from "../dist/runs/tools.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import {
	createAgentToolDefinitions,
	createSubagentToolDefinitions,
	createSubagentToolName,
	PIBO_AGENT_TOOL_NAMES,
} from "../dist/subagents/tool.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { findCliToolEntry, getInstalledCliToolContextFile } from "../dist/tools/registry.js";
import { isGeneratedPiboTool } from "../dist/tools/session-tool-set.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;

const noopAgentsController = {
	async sendMessage(input) {
		return {
			requestId: input.requestId,
			agentId: "ps_child",
			name: input.subagent.name,
			profile: input.subagent.targetProfile,
			threadKey: input.threadKey ?? "generated-thread",
			eventId: "event-1",
			finalMessage: `helper result for ${input.subagent.name}`,
			reply: {
				type: "assistant_message",
				piboSessionId: "ps_child",
				eventId: "event-1",
				text: `helper result for ${input.subagent.name}`,
			},
		};
	},
	listAgents() {
		return [];
	},
	observe(input) {
		return { filters: input, observations: [], nextAfterSequence: input.afterSequence ?? 0, truncated: false };
	},
	async killAgent(agentId) {
		return { agentId, killed: [agentId], cancelledRuns: [] };
	},
};

const noopRunToolController = {
	startToolRun() {
		throw new Error("not used");
	},
	listRuns() {
		return [];
	},
	getRunStatus() {
		throw new Error("not used");
	},
	waitForRun() {
		throw new Error("not used");
	},
	readRun() {
		throw new Error("not used");
	},
	cancelRun() {
		throw new Error("not used");
	},
	ackRun() {
		throw new Error("not used");
	},
};

async function waitFor(predicate, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function createYieldedSubagentFixture(suffix, script) {
	const adapterId = `subagent-${suffix}-child`;
	const parentProfile = `subagent-${suffix}-parent`;
	const childProfile = `subagent-${suffix}-child-profile`;
	const parentId = `ps_${suffix}_parent`;
	const childDriver = createFakeAgentRuntimeDriver({ adapterId, script });
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: `test.subagent-${suffix}`,
				register(api) {
					api.registerAgentRuntimeDriver(childDriver);
					api.registerAgentRuntimeInstance({ id: adapterId, adapterId });
					api.registerProfile({
						name: parentProfile,
						create() {
							return new InitialSessionContextBuilder(parentProfile)
								.withAgentRuntime("pi")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.addSubagent({ name: "worker", targetProfile: childProfile })
								.createSession();
						},
					});
					api.registerProfile({
						name: childProfile,
						create() {
							return new InitialSessionContextBuilder(childProfile)
								.withAgentRuntime(adapterId)
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
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: parentId,
		channel: "pibo.test",
		kind: "chat",
		profile: parentProfile,
		runtimeBinding: { piboSessionId: parentId, runtimeInstanceId: "pi", adapterId: "pi", state: "unbound" },
	});
	return { adapterId, parentId, registry, store, router: new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store }) };
}

async function yieldedSubagentTools(fixture) {
	await fixture.router.emit({ type: "execution", piboSessionId: fixture.parentId, action: "status" });
	const runtime = fixture.router.sessions.get(fixture.parentId).runtime;
	return {
		start: runtime.session.getToolDefinition("pibo_run_start"),
		cancel: runtime.session.getToolDefinition("pibo_run_cancel"),
	};
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

test("delegated agents expose four stable shared tools and reject duplicate exact names", () => {
	const definitions = createAgentToolDefinitions([
		{ name: "research-helper", description: "Research the relevant code.", targetProfile: "helper-profile" },
		{ name: "worker", description: "Implement focused changes.", targetProfile: "worker-profile" },
	], noopAgentsController);
	assert.deepEqual(definitions.map((definition) => definition.name), PIBO_AGENT_TOOL_NAMES);
	assert.match(definitions[0].description, /research-helper: Research the relevant code/);
	assert.match(definitions[0].description, /worker: Implement focused changes/);
	assert.throws(
		() => createAgentToolDefinitions([
			{ name: "same", targetProfile: "helper-profile" },
			{ name: "same", targetProfile: "other-profile" },
		], noopAgentsController),
		/Duplicate agent name "same"/,
	);
});

test("legacy subagent tool exports remain source-compatible without entering runtime assembly", async () => {
	assert.equal(createSubagentToolName("Research Helper"), "pibo_subagent_research_helper");
	assert.equal(isGeneratedPiboTool("pibo_subagent_research_helper"), true);
	assert.equal(isGeneratedPiboTool("pibo_agents_send_message"), true);
	const calls = [];
	const [tool] = createSubagentToolDefinitions(
		[{ name: "Research Helper", description: "Legacy integration helper.", targetProfile: "helper-profile" }],
		{
			async runSubagent(input) {
				calls.push(input);
				return {
					piboSessionId: "ps_legacy_child",
					eventId: "event-legacy",
					reply: { type: "assistant_message", piboSessionId: "ps_legacy_child", eventId: "event-legacy", text: "legacy reply" },
				};
			},
		},
	);
	assert.equal(tool.name, "pibo_subagent_research_helper");
	const result = await tool.execute("tool-legacy", { message: "inspect", threadKey: "migration" });
	assert.equal(result.content[0].text, "legacy reply");
	assert.equal(calls[0].toolCallId, "tool-legacy");
	assert.equal(calls[0].threadKey, "migration");
	assert.throws(
		() => createSubagentToolDefinitions([
			{ name: "same-name", targetProfile: "one" },
			{ name: "same name", targetProfile: "two" },
		], { async runSubagent() { throw new Error("not used"); } }),
		/Duplicate subagent tool name "pibo_subagent_same_name"/,
	);
});

test("legacy runtime subagentRunner callers receive an explicit migration error", async () => {
	const profile = new InitialSessionContextBuilder("legacy-runtime")
		.withAutoContextFiles(false)
		.addSubagent({ name: "helper", targetProfile: "base" })
		.createSession();
	await assert.rejects(
		createPiboRuntime({
			profile,
			persistSession: false,
			subagentRunner: { async runSubagent() { throw new Error("not used"); } },
		}),
		/PiboRuntimeOptions\.subagentRunner is retired\. Provide agentsController/,
	);
});

test("session context builder preserves Pi parent session ids", () => {
	const context = new InitialSessionContextBuilder("child-profile")
		.withSessionId("child-session")
		.withParentSessionId("parent-session")
		.createSession();

	assert.equal(context.sessionId, "child-session");
	assert.equal(context.parentSessionId, "parent-session");
});

test("profiles can disable automatic AGENTS.md context discovery", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-context-files-"));
	writeFileSync(join(cwd, "AGENTS.md"), "automatic workspace instructions", "utf-8");
	writeFileSync(join(cwd, "profile-context.md"), "explicit profile context", "utf-8");
	const profile = new InitialSessionContextBuilder("context-profile")
		.withAutoContextFiles(false)
		.addContextFile({ path: "profile-context.md" })
		.createSession();

	await withPiboHome(join(cwd, "pibo-home"), async () => {
		const inspection = await inspectPiboProfile({ cwd, profile, persistSession: false });
		const contextFileNames = inspection.contextFiles.map((contextFile) => basename(contextFile.path));

		assert.equal(contextFileNames.includes("AGENTS.md"), false);
		assert.equal(contextFileNames.includes("profile-context.md"), true);
	});
});

test("installed pibo tools are injected into the runtime context", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-installed-tools-context-"));
	const profile = new InitialSessionContextBuilder("context-profile").withAutoContextFiles(false).createSession();
	const browserUse = findCliToolEntry("browser-use");

	assert.ok(browserUse);

	await withPiboHome(join(cwd, "pibo-home"), async () => {
		const paths = getToolPythonRuntimePaths(browserUse.name, browserUse.runtime);
		mkdirSync(paths.binDir, { recursive: true });
		writeFileSync(paths.executablePath, "#!/bin/sh\n");

		const toolContextFile = getInstalledCliToolContextFile();
		assert.ok(toolContextFile);
		assert.equal(toolContextFile.path, ".pibo/context/installed-pibo-tools.md");
		assert.match(toolContextFile.content, /# Installed Pibo Tools/);
		assert.match(toolContextFile.content, /## browser-use/);
		assert.match(toolContextFile.content, /tools env browser-use/);
		assert.match(toolContextFile.content, /tools browser-use lease acquire/);
		assert.match(toolContextFile.content, /## ralph/);
		assert.match(toolContextFile.content, /pibo ralph templates/);
		assert.match(toolContextFile.content, /pibo tools guide ralph ralph/);

		const withToolInstalled = await inspectPiboProfile({ cwd, profile, persistSession: false });
		assert.equal(
			withToolInstalled.contextFiles.some((contextFile) => contextFile.path === toolContextFile.path),
			true,
		);

		rmSync(paths.rootDir, { recursive: true, force: true });

		const afterBrowserUseRemoval = getInstalledCliToolContextFile();
		assert.ok(afterBrowserUseRemoval);
		assert.doesNotMatch(afterBrowserUseRemoval.content, /## browser-use/);
		assert.match(afterBrowserUseRemoval.content, /## ralph/);

		const afterRemoval = await inspectPiboProfile({ cwd, profile, persistSession: false });
		assert.equal(
			afterRemoval.contextFiles.some((contextFile) => contextFile.path === ".pibo/context/installed-pibo-tools.md"),
			true,
		);
	});
});

test("shared agent tool definitions delegate execution and management to the controller", async () => {
	let observed;
	const tools = createAgentToolDefinitions(
		[{
			name: "helper",
			description: "Ask the helper agent.",
			targetProfile: "helper-profile",
		}],
		{
			...noopAgentsController,
			async sendMessage(input) {
				observed = input;
				return noopAgentsController.sendMessage(input);
			},
			listAgents() {
				return [{ agentId: "ps_child", name: "helper", profile: "helper-profile", threadKey: "files", status: "idle", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }];
			},
		},
	);
	const send = tools.find((tool) => tool.name === "pibo_agents_send_message");
	const list = tools.find((tool) => tool.name === "pibo_agents_list_agents");

	assert.equal(send.executionMode, "parallel");
	assert.match(send.description, /helper: Ask the helper agent/);
	const controller = new AbortController();
	await assert.rejects(
		send.execute("tool-call-direct", { name: "helper", message: "direct" }, controller.signal, undefined, {}),
		/yielded-only/,
	);
	const result = await send.execute("tool-call-1", {
		name: "helper",
		message: "Find the relevant files.",
		threadKey: "files",
	}, controller.signal, undefined, {
		yieldedRunId: "run_request_1",
		getActiveMessage: () => ({
			id: "message-parent",
			source: "actor",
			provenance: { kind: "loop-run", jobId: "loop_job", runId: "loop_run" },
		}),
	});

	assert.equal(observed.subagent.name, "helper");
	assert.equal(observed.message, "Find the relevant files.");
	assert.equal(observed.threadKey, "files");
	assert.equal(observed.toolCallId, "tool-call-1");
	assert.equal(observed.requestId, "run_request_1");
	assert.deepEqual(observed.parentProvenance, { kind: "loop-run", jobId: "loop_job", runId: "loop_run" });
	assert.equal(observed.signal, controller.signal);
	assert.equal(send.inputSchema.properties.threadKey.maxLength, 256);
	assert.equal(result.details.agentId, "ps_child");
	assert.equal(result.details.requestId, "run_request_1");
	assert.equal(result.structuredContent.finalMessage, "helper result for helper");
	assert.match(result.content[0].text, /Agent request run_request_1 completed/);
	assert.match(result.content[0].text, /helper result for helper/);

	const listed = await list.execute("tool-call-2", {});
	assert.equal(listed.details.availableAgents[0].description, "Ask the helper agent.");
	assert.equal(listed.details.agents[0].agentId, "ps_child");
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
					model: { provider: "openai", id: "gpt-5.6-mini" },
					thinkingLevel: "high",
				});
				api.registerProfile({
					name: "parent-profile",
					create(context) {
						return new InitialSessionContextBuilder("parent-profile")
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false, runControl: false })
							.addTool({
								name: "ordinary",
								definition: {
									name: "ordinary",
									title: "Ordinary",
									description: "Ordinary direct tool.",
									inputSchema: { type: "object", properties: {}, additionalProperties: false },
									async execute() { return { content: [{ type: "text", text: "ordinary" }] }; },
								},
							})
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

	assert.deepEqual(registry.getCapabilityCatalog().subagents.find((subagent) => subagent.name === "helper"), {
		name: "helper",
		description: "Ask the helper profile.",
		targetProfile: "helper-profile",
		timeoutMs: undefined,
		model: { provider: "openai", id: "gpt-5.6-mini" },
		thinkingLevel: "high",
		maxDepth: undefined,
	});
	const inspection = await inspectPiboProfile({
		profile: registry.createProfile("parent-profile"),
		persistSession: false,
		subagentProfileResolver: (name) => registry.createProfile(name),
	});
	assert.deepEqual(inspection.subagents, [{
		name: "helper",
		targetProfile: "helper-profile",
		configuredModel: { provider: "openai", id: "gpt-5.6-mini" },
		effectiveModel: { provider: "openai", id: "gpt-5.6-mini" },
		configuredThinkingLevel: "high",
		effectiveThinkingLevel: "high",
		active: true,
	}]);
	assert.equal(inspection.contextFiles.some((file) => file.path === "pibo://runtime/delegated-agents.md"), true);

	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "parent-profile",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_parent",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.deepEqual(
			PIBO_AGENT_TOOL_NAMES.filter((name) => output.result.activeTools.includes(name)),
			PIBO_AGENT_TOOL_NAMES.filter((name) => name !== "pibo_agents_send_message"),
		);
		assert.equal(output.result.activeTools.includes("ordinary"), true);
		assert.equal(output.result.activeTools.includes("pibo_run_start"), true);
		assert.equal(output.result.activeTools.some((name) => name.startsWith("pibo_subagent_")), false);
		const runStart = router.sessions.get("ps_parent").runtime.session.getToolDefinition("pibo_run_start");
		assert.deepEqual(runStart.parameters.properties.toolName.enum, ["pibo_agents_send_message"]);
	} finally {
		await router.disposeAll();
	}
});

test("profile inspection distinguishes configured subagent overrides from effective target-profile fallbacks", async () => {
	const targetProfile = new InitialSessionContextBuilder("target-profile")
		.withSubagentModel({ provider: "fallback-provider", id: "fallback-model" })
		.withSubagentThinkingLevel("medium")
		.createSession();
	const profile = new InitialSessionContextBuilder("inspection-parent")
		.addSubagents([
			{
				name: "configured",
				targetProfile: "target-profile",
				model: { provider: "override-provider", id: "override-model" },
				thinkingLevel: "xhigh",
			},
			{ name: "fallback", targetProfile: "target-profile" },
		])
		.createSession();
	const inspection = await inspectPiboProfile({
		profile,
		persistSession: false,
		subagentProfileResolver: () => targetProfile,
	});

	assert.deepEqual(inspection.subagents, [
		{
			name: "configured",
			targetProfile: "target-profile",
			configuredModel: { provider: "override-provider", id: "override-model" },
			effectiveModel: { provider: "override-provider", id: "override-model" },
			configuredThinkingLevel: "xhigh",
			effectiveThinkingLevel: "xhigh",
			active: true,
		},
		{
			name: "fallback",
			targetProfile: "target-profile",
			effectiveModel: { provider: "fallback-provider", id: "fallback-model" },
			effectiveThinkingLevel: "medium",
			active: true,
		},
	]);
});

test("router omits subagent tools that have reached their max depth", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	registry.registerPlugin(
		definePiboPlugin({
			id: "test.subagent-depth-tools",
			register(api) {
				api.registerSubagents([
					{ name: "defaulted", targetProfile: "recursive-profile" },
					{ name: "limited", targetProfile: "recursive-profile", maxDepth: 1 },
					{ name: "deeper", targetProfile: "recursive-profile", maxDepth: 2 },
				]);
				api.registerProfile({
					name: "recursive-profile",
					create(context) {
						return new InitialSessionContextBuilder("recursive-profile")
							.withToolPackages({ runControl: true })
							.addSubagents([
								context.getSubagent("defaulted"),
								context.getSubagent("limited"),
								context.getSubagent("deeper"),
							])
							.createSession();
					},
				});
			},
		}),
	);

	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_root",
		piSessionId: "root-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "recursive-profile",
	});
	store.create({
		id: "ps_child",
		piSessionId: "child-session",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "recursive-profile",
		parentId: "ps_root",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
	});

	try {
		assert.deepEqual(router.getSessionRuntimeProfile("ps_root").subagents.map((subagent) => subagent.name), ["defaulted", "limited", "deeper"]);
		const childProfile = router.getSessionRuntimeProfile("ps_child");
		assert.deepEqual(childProfile.subagents.map((subagent) => subagent.name), ["deeper"]);
		assert.equal(childProfile.sessionId, "child-session");
		assert.equal(childProfile.parentSessionId, "root-session");

		const rootOutput = await router.emit({
			type: "execution",
			piboSessionId: "ps_root",
			action: "status",
		});
		const childOutput = await router.emit({
			type: "execution",
			piboSessionId: "ps_child",
			action: "status",
		});

		const managementToolNames = PIBO_AGENT_TOOL_NAMES.filter((name) => name !== "pibo_agents_send_message");
		assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => rootOutput.result.activeTools.includes(name)), managementToolNames);
		assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => childOutput.result.activeTools.includes(name)), managementToolNames);
		assert.equal(router.sessions.get("ps_root").runtime.session.getToolDefinition("pibo_agents_send_message"), undefined);
		assert.equal(router.sessions.get("ps_child").runtime.session.getToolDefinition("pibo_agents_send_message"), undefined);

		const rootRuntime = router.sessions.get("ps_root").runtime;
		const childRuntime = router.sessions.get("ps_child").runtime;
		const rootAgentContext = rootRuntime.session.resourceLoader.getAgentsFiles().agentsFiles.find((file) => file.path === "pibo://runtime/delegated-agents.md");
		const childAgentContext = childRuntime.session.resourceLoader.getAgentsFiles().agentsFiles.find((file) => file.path === "pibo://runtime/delegated-agents.md");
		assert.match(rootAgentContext.content, /`defaulted`/);
		assert.match(rootAgentContext.content, /`limited`/);
		assert.match(rootAgentContext.content, /`deeper`/);
		assert.doesNotMatch(childAgentContext.content, /`defaulted`/);
		assert.doesNotMatch(childAgentContext.content, /`limited`/);
		assert.match(childAgentContext.content, /`deeper`/);

		const childRunStart = childRuntime.session.getToolDefinition("pibo_run_start");
		const childYieldableToolNames = childRunStart.parameters.properties.toolName.enum;
		assert.equal(childYieldableToolNames.includes("pibo_agents_send_message"), true);

		await assert.rejects(
			router.createAgentsController("ps_child").sendMessage({
				subagent: { name: "defaulted", targetProfile: "recursive-profile" },
				message: "must not create another child",
				requestId: "run_depth_rejected",
			}),
			/Subagent "defaulted" exceeded max depth 1/,
		);
		assert.equal(store.list().length, 2);
	} finally {
		await router.disposeAll();
	}
});

test("agents controller emits a parent link event before waiting for the child reply", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		metadata: { chatRoomId: "room_parent" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	const events = [];
	router.subscribe((event) => events.push(event));
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "child reply",
	});

	try {
		const controller = router.createAgentsController("ps_parent");
		const result = await controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "check this",
			threadKey: "inspect",
			toolCallId: "tool-1",
			requestId: "run_request_link",
			parentProvenance: { kind: "loop-run", jobId: "loop_parent", runId: "loop_run_parent" },
		});
		const linkEvent = events.find((event) => event.type === "subagent_session");

		assert.equal(linkEvent.piboSessionId, "ps_parent");
		assert.equal(linkEvent.requestId, "run_request_link");
		assert.equal(linkEvent.toolCallId, "tool-1");
		assert.equal(linkEvent.toolName, "pibo_agents_send_message");
		assert.equal(linkEvent.subagentName, "explorer");
		assert.equal(linkEvent.childPiboSessionId, result.agentId);
		assert.equal(linkEvent.threadKey, "inspect");
		assert.equal(store.get(result.agentId).parentId, "ps_parent");
		assert.equal(Object.hasOwn(store.get(result.agentId), retiredPartitionField), false);
		assert.equal(store.get(result.agentId).metadata.chatRoomId, "room_parent");
		assert.equal(store.get(result.agentId).metadata.workflowSessionKind, "subagent");
		assert.equal(store.get(result.agentId).metadata.subagentToolName, "pibo_agents_send_message");
		assert.equal(result.requestId, "run_request_link");
		assert.equal(result.finalMessage, "child reply");
	} finally {
		await router.disposeAll();
	}
});

test("subagent runner freezes per-subagent model and thinking settings on new child sessions", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		sessionStore: store,
		modelDefaults: { subagent: { provider: "default-provider", id: "default-subagent" } },
	});
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "child reply",
	});

	try {
		const controller = router.createAgentsController("ps_parent");
		const first = await controller.sendMessage({
			subagent: {
				name: "researcher",
				targetProfile: "base",
				model: { provider: "openai", id: "gpt-5.6-mini" },
				thinkingLevel: "high",
			},
			message: "research this",
			threadKey: "research-thread",
			requestId: "run_research_first",
		});
		const child = store.get(first.agentId);
		assert.deepEqual(child.activeModel, { provider: "openai", id: "gpt-5.6-mini" });
		assert.equal(child.metadata.initialThinkingLevel, "high");

		const reused = await controller.sendMessage({
			subagent: {
				name: "researcher",
				targetProfile: "base",
				model: { provider: "other", id: "changed-model" },
				thinkingLevel: "low",
			},
			message: "continue",
			threadKey: "research-thread",
			requestId: "run_research_reuse",
		});
		assert.equal(reused.agentId, first.agentId);
		assert.deepEqual(store.get(reused.agentId).activeModel, { provider: "openai", id: "gpt-5.6-mini" });
		assert.equal(store.get(reused.agentId).metadata.initialThinkingLevel, "high");

		const fallback = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			message: "use defaults",
			threadKey: "default-thread",
			requestId: "run_research_default",
		});
		assert.deepEqual(store.get(fallback.agentId).activeModel, { provider: "default-provider", id: "default-subagent" });
		assert.equal(store.get(fallback.agentId).metadata.initialThinkingLevel, undefined);
	} finally {
		await router.disposeAll();
	}
});

test("subagent runner rejects invalid or cancelled requests before creating a child session", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		const controller = router.createAgentsController("ps_parent");
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "must identify the request",
		}), /requestId is required/);
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "must not create a child",
			threadKey: "é".repeat(257),
			requestId: "run_invalid_thread",
		}), /Subagent thread key exceeds 512 bytes/);

		const abortController = new AbortController();
		abortController.abort();
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "must not create a child",
			threadKey: "cancelled",
			requestId: "run_preaborted",
			signal: abortController.signal,
		}), (error) => error instanceof Error && error.name === "AbortError");
		assert.equal(store.list().length, 1);
	} finally {
		await router.disposeAll();
	}
});

test("agents controller lists, filters observations, kills owned children, and does not reuse killed threads", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "child reply",
	});

	try {
		const controller = router.createAgentsController("ps_parent");
		const explorer = await controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "explore",
			threadKey: "alpha",
			requestId: "run_explorer",
		});
		const worker = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			message: "work",
			threadKey: "beta",
			requestId: "run_worker",
		});
		assert.deepEqual(controller.listAgents().map((agent) => [agent.name, agent.status]).sort(), [["explorer", "idle"], ["worker", "idle"]]);

		router.emitOutput({
			type: "assistant_message",
			piboSessionId: explorer.agentId,
			eventId: "event-explorer",
			text: "Alpha complete",
			provenance: { kind: "subagent-request", requestId: "run_explorer", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "tool_call",
			piboSessionId: worker.agentId,
			eventId: "event-worker",
			toolCallId: "tool-worker",
			toolName: "bash",
			args: { command: "npm test" },
			argsComplete: true,
			provenance: { kind: "subagent-request", requestId: "run_worker", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "session_error",
			piboSessionId: worker.agentId,
			eventId: "event-worker-error",
			error: "test failed",
		});

		const observed = controller.observe({
			requestIds: ["run_worker"],
			agentIds: [worker.agentId],
			names: ["worker"],
			threadKeys: ["beta"],
			eventTypes: ["tool_call"],
			kinds: ["tool"],
			roles: ["tool"],
			textContains: "NPM TEST",
			order: "asc",
			limit: 10,
		});
		assert.equal(observed.observations.length, 1);
		assert.equal(observed.observations[0].requestId, "run_worker");
		assert.equal(observed.observations[0].role, "tool");
		assert.equal(observed.observations[0].toolName, "bash");
		assert.equal(observed.observations[0].details, undefined);
		assert.equal(observed.nextAfterSequence, observed.observations[0].sequence);
		assert.equal(controller.observe({ afterSequence: observed.nextAfterSequence }).observations.length, 1);
		assert.equal(controller.observe({ kinds: ["error"], includeDetails: true }).observations[0].details.type, "session_error");
		assert.throws(() => controller.observe({ agentIds: ["ps_foreign"] }), /is not owned/);

		const killed = await controller.killAgent(worker.agentId);
		assert.deepEqual(killed.killed, [worker.agentId]);
		assert.equal(controller.listAgents().find((agent) => agent.agentId === worker.agentId).status, "killed");
		const replacement = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			message: "retry",
			threadKey: "beta",
			requestId: "run_worker_replacement",
		});
		assert.notEqual(replacement.agentId, worker.agentId);
		await assert.rejects(
			router.createAgentsController(explorer.agentId).killAgent(replacement.agentId),
			/is not owned/,
		);
	} finally {
		await router.disposeAll();
	}
});

test("agent observation polling is cursor-safe in descending order and reports retention loss", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: "ps_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
		metadata: { subagentName: "worker", threadKey: "retained" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		for (let index = 1; index <= 5_002; index += 1) {
			router.emitOutput({
				type: "assistant_delta",
				piboSessionId: "ps_child",
				eventId: `event-${index}`,
				text: `observation ${index}`,
			});
		}
		const controller = router.createAgentsController("ps_parent");
		const first = controller.observe({ afterSequence: 0, order: "desc", limit: 2 });
		assert.deepEqual(first.observations.map((observation) => observation.sequence), [4, 3]);
		assert.equal(first.nextAfterSequence, 4);
		assert.equal(first.truncated, true);

		const second = controller.observe({ afterSequence: first.nextAfterSequence, order: "desc", limit: 2 });
		assert.deepEqual(second.observations.map((observation) => observation.sequence), [6, 5]);
		assert.equal(second.nextAfterSequence, 6);
		assert.equal(second.truncated, true);

		const newest = controller.observe({ order: "desc", limit: 2 });
		assert.deepEqual(newest.observations.map((observation) => observation.sequence), [5_002, 5_001]);
		assert.equal(newest.truncated, true);

		router.emitOutput({
			type: "assistant_message",
			piboSessionId: "ps_child",
			eventId: "event-large",
			text: `prefix-${"é".repeat(20_000)}`,
		});
		const large = controller.observe({ textContains: "prefix-", includeDetails: true, limit: 1 });
		assert.equal(Buffer.byteLength(large.observations[0].text, "utf8") <= 4 * 1024, true);
		assert.equal(large.observations[0].text.endsWith("…"), true);
		assert.deepEqual(large.observations[0].details.truncated, true);
		assert.throws(() => controller.observe({ limit: 0 }), /limit must be an integer from 1 to 200/);
		assert.throws(() => controller.observe({ since: "2026-08-23" }), /valid ISO-8601 timestamp/);
	} finally {
		await router.disposeAll();
	}
});

test("agent kill retries subtree cleanup after a partial failure", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: "ps_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
		metadata: { subagentName: "worker", threadKey: "cleanup" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		await router.emit({ type: "execution", piboSessionId: "ps_child", action: "status" });
		assert.equal(router.sessions.has("ps_child"), true);
		const originalDispose = router.disposeSessionSubtree.bind(router);
		let attempts = 0;
		router.disposeSessionSubtree = async (...args) => {
			attempts += 1;
			if (attempts === 1) throw new Error("injected cleanup failure");
			return originalDispose(...args);
		};
		const controller = router.createAgentsController("ps_parent");
		await assert.rejects(controller.killAgent("ps_child"), /injected cleanup failure/);
		assert.equal(controller.listAgents()[0].status, "killed");
		const retried = await controller.killAgent("ps_child");
		assert.deepEqual(retried.killed, ["ps_child"]);
		assert.equal(attempts, 2);
		assert.equal(router.sessions.has("ps_child"), false);
	} finally {
		await router.disposeAll();
	}
});

test("descendant traversal is cycle-safe for corrupt stored session graphs", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_a", channel: "pibo.subagents", kind: "subagent", profile: "base", parentId: "ps_c" });
	store.create({ id: "ps_b", channel: "pibo.subagents", kind: "subagent", profile: "base", parentId: "ps_a" });
	store.create({ id: "ps_c", channel: "pibo.subagents", kind: "subagent", profile: "base", parentId: "ps_b" });
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		assert.deepEqual(router.descendantSessionIds("ps_a"), ["ps_b", "ps_c"]);
	} finally {
		await router.disposeAll();
	}
});

test("aborting a parent turn interrupts its active subagent child", async () => {
	const childDriver = createFakeAgentRuntimeDriver({
		adapterId: "subagent-abort-child",
		script: { waitForAbort: true },
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.subagent-parent-abort",
				register(api) {
					api.registerAgentRuntimeDriver(childDriver);
					api.registerAgentRuntimeInstance({ id: "subagent-abort-child", adapterId: "subagent-abort-child" });
					api.registerProfile({
						name: "subagent-abort-parent",
						create() {
							return new InitialSessionContextBuilder("subagent-abort-parent")
								.withAgentRuntime("pi")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.addSubagent({ name: "worker", targetProfile: "subagent-abort-child-profile" })
								.createSession();
						},
					});
					api.registerProfile({
						name: "subagent-abort-child-profile",
						create() {
							return new InitialSessionContextBuilder("subagent-abort-child-profile")
								.withAgentRuntime("subagent-abort-child")
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
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_abort_parent",
		channel: "pibo.test",
		kind: "chat",
		profile: "subagent-abort-parent",
		runtimeBinding: { piboSessionId: "ps_abort_parent", runtimeInstanceId: "pi", adapterId: "pi", state: "unbound" },
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		await router.emit({ type: "execution", piboSessionId: "ps_abort_parent", action: "status" });
		const runtime = router.sessions.get("ps_abort_parent").runtime;
		assert.equal(runtime.session.getToolDefinition("pibo_agents_send_message"), undefined);
		const startTool = runtime.session.getToolDefinition("pibo_run_start");
		const started = await startTool.execute("subagent-abort-tool", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "hold until parent abort", threadKey: "hold" },
			completionPolicy: "tracked",
		});
		const childAdapter = registry.requireAgentRuntimeAdapter("subagent-abort-child");
		const deadline = Date.now() + 2_000;
		while (!childAdapter.sessions.some((session) => session.getStatus().streaming)) {
			if (Date.now() >= deadline) throw new Error("Timed out waiting for active subagent child");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await router.emit({ type: "execution", piboSessionId: "ps_abort_parent", action: "abort" });
		const terminal = await router.createRunToolController("ps_abort_parent").waitForRun(started.details.runId, 1_000);
		assert.equal(terminal.status, "failed");
		assert.equal(childAdapter.sessions[0].abortCalls, 1);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, false);
	} finally {
		await router.disposeAll();
	}
});

test("parent abort reports rejected child cancellation instead of silently succeeding", async () => {
	const script = { waitForAbort: true, abortFailWith: "child adapter abort rejected" };
	const fixture = createYieldedSubagentFixture("parent-abort-rejected", script);
	try {
		const tools = await yieldedSubagentTools(fixture);
		const started = await tools.start.execute("start-parent-abort-rejected", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "hold", threadKey: "hold" },
			completionPolicy: "tracked",
		});
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);

		await assert.rejects(
			fixture.router.emit({ type: "execution", piboSessionId: fixture.parentId, action: "abort" }),
			/Failed to cancel active subagent requests/,
		);
		await waitFor(() => fixture.router.createRunToolController(fixture.parentId).getRunStatus(started.details.runId).status === "failed");
		const failed = fixture.router.createRunToolController(fixture.parentId).readRun(started.details.runId);
		assert.equal(failed.status, "failed");
		assert.match(failed.error, /Failed to cancel subagent request/);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, true);

		delete script.abortFailWith;
		await childAdapter.sessions[0].abort();
	} finally {
		delete script.abortFailWith;
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		if (childAdapter.sessions[0]?.getStatus().streaming) await childAdapter.sessions[0].abort();
		await fixture.router.disposeAll();
	}
});

test("cancelling an active delegated run settles before the next queued request finishes", async () => {
	const fixture = createYieldedSubagentFixture("active-request-cancellation", { waitForAbort: true });
	try {
		const tools = await yieldedSubagentTools(fixture);
		const first = await tools.start.execute("start-active-a", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "A", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);
		const child = fixture.store.find({ channel: "pibo.subagents", kind: "subagent", parentId: fixture.parentId })[0];
		assert.ok(child);

		const second = await tools.start.execute("start-active-b", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "B", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		await waitFor(() => fixture.router.sessions.get(child.id)?.getStatus().queuedMessages === 1);

		const cancelledFirst = await tools.cancel.execute("cancel-active-a", { runId: first.details.runId });
		assert.equal(cancelledFirst.details.status, "cancelled");
		await waitFor(() => childAdapter.sessions[0].prompts.length === 2 && childAdapter.sessions[0].getStatus().streaming === true);
		assert.equal(childAdapter.sessions[0].abortCalls, 1);
		assert.equal(fixture.router.createRunToolController(fixture.parentId).getRunStatus(second.details.runId).status, "running");

		const cancelledSecond = await tools.cancel.execute("cancel-active-b", { runId: second.details.runId });
		assert.equal(cancelledSecond.details.status, "cancelled");
		assert.equal(childAdapter.sessions[0].abortCalls, 2);
	} finally {
		await fixture.router.disposeAll();
	}
});

test("cancelling a queued delegated run leaves the active request on the shared thread running", async () => {
	const childDriver = createFakeAgentRuntimeDriver({
		adapterId: "subagent-targeted-cancel-child",
		script: { waitForAbort: true },
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.subagent-targeted-cancel",
				register(api) {
					api.registerAgentRuntimeDriver(childDriver);
					api.registerAgentRuntimeInstance({ id: "subagent-targeted-cancel-child", adapterId: "subagent-targeted-cancel-child" });
					api.registerProfile({
						name: "subagent-targeted-cancel-parent",
						create() {
							return new InitialSessionContextBuilder("subagent-targeted-cancel-parent")
								.withAgentRuntime("pi")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.addSubagent({ name: "worker", targetProfile: "subagent-targeted-cancel-child-profile" })
								.createSession();
						},
					});
					api.registerProfile({
						name: "subagent-targeted-cancel-child-profile",
						create() {
							return new InitialSessionContextBuilder("subagent-targeted-cancel-child-profile")
								.withAgentRuntime("subagent-targeted-cancel-child")
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
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_targeted_cancel_parent",
		channel: "pibo.test",
		kind: "chat",
		profile: "subagent-targeted-cancel-parent",
		runtimeBinding: { piboSessionId: "ps_targeted_cancel_parent", runtimeInstanceId: "pi", adapterId: "pi", state: "unbound" },
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		await router.emit({ type: "execution", piboSessionId: "ps_targeted_cancel_parent", action: "status" });
		const runtime = router.sessions.get("ps_targeted_cancel_parent").runtime;
		const startTool = runtime.session.getToolDefinition("pibo_run_start");
		const cancelTool = runtime.session.getToolDefinition("pibo_run_cancel");
		const first = await startTool.execute("start-shared-a", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "A", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		const childAdapter = registry.requireAgentRuntimeAdapter("subagent-targeted-cancel-child");
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);
		const second = await startTool.execute("start-shared-b", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "B", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		await new Promise((resolve) => setImmediate(resolve));

		const cancelledSecond = await cancelTool.execute("cancel-shared-b", { runId: second.details.runId });
		assert.equal(cancelledSecond.details.status, "cancelled");
		assert.deepEqual(childAdapter.sessions[0].prompts.map((prompt) => prompt.text), ["A"]);
		assert.equal(childAdapter.sessions[0].abortCalls, 0);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, true);
		assert.equal(router.createRunToolController("ps_targeted_cancel_parent").getRunStatus(first.details.runId).status, "running");

		const cancelledFirst = await cancelTool.execute("cancel-shared-a", { runId: first.details.runId });
		assert.equal(cancelledFirst.details.status, "cancelled");
		assert.equal(childAdapter.sessions[0].abortCalls, 1);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, false);
	} finally {
		await router.disposeAll();
	}
});

test("delegated run cancellation fails when the child rejects targeted abort", async () => {
	const script = { waitForAbort: true, abortFailWith: "provider abort failed" };
	const fixture = createYieldedSubagentFixture("abort-rejection", script);
	try {
		const tools = await yieldedSubagentTools(fixture);
		const started = await tools.start.execute("start-abort-rejection", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "wait", threadKey: "abort-rejection" },
			completionPolicy: "tracked",
		});
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);

		await assert.rejects(tools.cancel.execute("cancel-abort-rejection", { runId: started.details.runId }), (error) => (
			error instanceof AggregateError
			&& error.errors.some((nested) => nested?.name === "PiboRunCancellationError" && nested.cause?.message === "provider abort failed")
		));
		await waitFor(() => fixture.router.createRunToolController(fixture.parentId).getRunStatus(started.details.runId).status === "failed");
		const failed = fixture.router.createRunToolController(fixture.parentId).readRun(started.details.runId);
		assert.equal(failed.status, "failed");
		assert.match(failed.error, /Failed to cancel subagent request/);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, true);

		delete script.abortFailWith;
		await childAdapter.sessions[0].abort();
	} finally {
		await fixture.router.disposeAll();
	}
});

test("delegated run cancellation is bounded when an adapter never settles its active prompt", { timeout: 25_000 }, async () => {
	const script = { waitForAbort: true, abortNeverSettles: true };
	const fixture = createYieldedSubagentFixture("abort-nonsettling", script);
	try {
		const tools = await yieldedSubagentTools(fixture);
		const started = await tools.start.execute("start-abort-nonsettling", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "wait", threadKey: "abort-nonsettling" },
			completionPolicy: "tracked",
		});
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);

		const cancelStartedAt = Date.now();
		await assert.rejects(tools.cancel.execute("cancel-abort-nonsettling", { runId: started.details.runId }), (error) => (
			error instanceof AggregateError
			&& error.errors.some((nested) => /Yielded run did not settle within 15000ms after cancellation/.test(nested?.message ?? ""))
		));
		assert.ok(Date.now() - cancelStartedAt >= 14_500);
		assert.equal(fixture.router.createRunToolController(fixture.parentId).getRunStatus(started.details.runId).status, "running");
		assert.equal(childAdapter.sessions[0].getStatus().streaming, true);

		script.abortNeverSettles = false;
		await childAdapter.sessions[0].abort();
		await waitFor(() => fixture.router.createRunToolController(fixture.parentId).getRunStatus(started.details.runId).status === "failed");
	} finally {
		script.abortNeverSettles = false;
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		if (childAdapter.sessions[0]?.getStatus().streaming) await childAdapter.sessions[0].abort();
		await fixture.router.disposeAll();
	}
});

test("yielded delegated run read returns the complete final message and request identity", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	const firstBlock = `complete:${"x".repeat(6_000)}`;
	const secondBlock = `${"y".repeat(6_000)}:end`;
	const normalizedFinal = normalizePiEvent("ps_child", {
		type: "message_end",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: firstBlock },
				{ type: "toolCall", id: "tool-gap", name: "read", arguments: {} },
				{ type: "text", text: secondBlock },
			],
			stopReason: "stop",
		},
	});
	assert.equal(normalizedFinal.type, "assistant_message");
	const finalMessage = `${firstBlock}\n${secondBlock}`;
	router.emitMessageAndWaitForReply = async (event) => ({
		...normalizedFinal,
		piboSessionId: event.piboSessionId,
		eventId: event.id,
	});

	try {
		const subagent = { name: "worker", targetProfile: "base" };
		const runTools = Object.fromEntries(createRunToolDefinitions(
			createAgentToolDefinitions([subagent], router.createAgentsController("ps_parent")),
			router.createRunToolController("ps_parent"),
		).map((tool) => [tool.name, tool]));
		const started = await runTools.pibo_run_start.execute("start-agent-complete", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "produce complete result", threadKey: "complete" },
			completionPolicy: "tracked",
		});
		const waited = await runTools.pibo_run_wait.execute("wait-agent-complete", {
			runId: started.details.runId,
			timeoutMs: 1_000,
		});
		assert.equal(waited.details.status, "completed");

		const read = await runTools.pibo_run_read.execute("read-agent-complete", { runId: started.details.runId });
		assert.equal(read.content[0].text.endsWith(finalMessage), true);
		assert.equal(read.details.result.details.requestId, started.details.runId);
		assert.equal(read.details.result.details.finalMessage, finalMessage);
		assert.equal(read.details.result.details.threadKey, "complete");
		assert.equal(typeof read.details.result.details.agentId, "string");
		assert.equal(typeof read.details.result.details.eventId, "string");
	} finally {
		await router.disposeAll();
	}
});

test("bounded run waits do not cancel delegated agents and explicit cancellation preserves thread reuse", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	const emitted = [];
	const cancellations = [];
	router.emit = async (event) => {
		emitted.push(event);
		return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 0, text: event.text, source: event.source };
	};
	router.cancelSessionMessage = async (piboSessionId, eventId) => {
		cancellations.push({ piboSessionId, eventId });
		await new Promise((resolve) => setTimeout(resolve, 40));
	};

	try {
		const subagent = { name: "worker", targetProfile: "base", timeoutMs: 10 };
		const agentsController = router.createAgentsController("ps_parent");
		const agentTools = createAgentToolDefinitions([subagent], agentsController);
		const runTools = Object.fromEntries(createRunToolDefinitions(
			agentTools,
			router.createRunToolController("ps_parent"),
		).map((tool) => [tool.name, tool]));
		const started = await runTools.pibo_run_start.execute("start-agent-timeout", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", message: "wait", threadKey: "reusable" },
			completionPolicy: "tracked",
		});
		const waited = await runTools.pibo_run_wait.execute("wait-agent-timeout", {
			runId: started.details.runId,
			timeoutMs: 25,
		});

		assert.equal(waited.details.status, "running");
		assert.equal(waited.details.timedOut, true);
		assert.equal(started.details.timeoutMs, undefined);
		assert.equal(cancellations.length, 0);
		const activeChild = store.find({ channel: "pibo.subagents", kind: "subagent", parentId: "ps_parent" })[0];
		assert.ok(activeChild);

		const cancelStartedAt = Date.now();
		const cancelled = await runTools.pibo_run_cancel.execute("cancel-agent-request", { runId: started.details.runId });
		assert.ok(Date.now() - cancelStartedAt >= 35, "run cancellation must await confirmed child settlement");
		assert.equal(cancelled.details.status, "cancelled");
		const delegatedMessage = emitted.find((event) => event.type === "message");
		assert.deepEqual(cancellations, [{ piboSessionId: activeChild.id, eventId: delegatedMessage.id }]);

		router.emitMessageAndWaitForReply = async (event) => ({
			type: "assistant_message",
			piboSessionId: event.piboSessionId,
			eventId: event.id,
			text: "continued",
		});
		const reused = await agentsController.sendMessage({
			subagent,
			message: "continue",
			threadKey: "reusable",
			requestId: "run_reused_thread",
		});
		assert.equal(reused.agentId, activeChild.id);
		assert.equal(store.find({ channel: "pibo.subagents", kind: "subagent", parentId: "ps_parent" }).length, 1);
	} finally {
		await router.disposeAll();
	}
});

test("profile-selected subagents expose run control tools", async () => {
	const profile = new InitialSessionContextBuilder("run-control-agent")
		.withToolPackages({ runControl: true })
		.addSubagents([
			{ name: "default", targetProfile: "base" },
			{ name: "explorer", targetProfile: "base" },
			{ name: "worker", targetProfile: "base" },
		])
		.createSession();
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.map((tool) => tool.name));

	assert.deepEqual(
		inspection.subagents.map((subagent) => subagent.name),
		["default", "explorer", "worker"],
	);
	assert.deepEqual(
		PIBO_AGENT_TOOL_NAMES.filter((name) => activeTools.has(name)),
		PIBO_AGENT_TOOL_NAMES.filter((name) => name !== "pibo_agents_send_message"),
	);
	assert.equal([...activeTools].some((name) => name.startsWith("pibo_subagent_")), false);
	assert.equal(activeTools.has("pibo_run_start"), true);
	assert.equal(activeTools.has("pibo_run_list"), true);
	assert.equal(activeTools.has("pibo_run_wait"), true);
	assert.equal(activeTools.has("pibo_run_read"), true);
	assert.equal(activeTools.has("pibo_run_cancel"), true);
	assert.equal(activeTools.has("pibo_run_ack"), true);
	assert.equal(inspection.subagents.every((subagent) => subagent.active), true);
	assert.equal(inspection.diagnostics.length, 0);
});

test("run-control package exposes Pi bash as a yieldable tool", async () => {
	const profile = new InitialSessionContextBuilder("run-control-agent")
		.withBuiltinToolNames(["read", "bash", "edit", "write"])
		.withToolPackages({ runControl: true })
		.createSession();
	const runtime = await createPiboRuntime({
		profile,
		persistSession: false,
		agentsController: noopAgentsController,
		runToolController: noopRunToolController,
	});

	try {
		const activeTools = new Set(runtime.session.getActiveToolNames());
		assert.equal(runtime.session.resourceLoader.getAgentsFiles().agentsFiles.some((file) => file.path === "pibo://runtime/delegated-agents.md"), false);
		assert.equal(activeTools.has("bash"), true);
		assert.equal(activeTools.has("pibo_exec"), false);

		const startTool = runtime.session.getToolDefinition("pibo_run_start");
		assert.ok(startTool);
		const toolNameSchema = startTool.parameters.properties.toolName;
		assert.equal(toolNameSchema.enum.includes("bash"), true);
		assert.equal(toolNameSchema.enum.includes("pibo_exec"), false);
	} finally {
		await runtime.dispose();
	}
});

test("real yielded Pi bash timeout preserves startup output classification", async () => {
	let started;
	const controller = {
		...noopRunToolController,
		startToolRun(input) {
			started = input;
			return {
				runId: "run_real_bash_timeout",
				kind: "tool",
				controllerPiboSessionId: "ps_parent",
				status: "running",
				completionPolicy: input.completionPolicy ?? "tracked",
				consumed: false,
				toolName: input.toolName,
				timeoutMs: input.timeoutMs,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
		},
	};
	const profile = new InitialSessionContextBuilder("run-control-agent")
		.withBuiltinToolNames(["bash"])
		.withToolPackages({ runControl: true })
		.createSession();
	const runtime = await createPiboRuntime({ profile, persistSession: false, agentsController: noopAgentsController, runToolController: controller });
	try {
		const startTool = runtime.session.getToolDefinition("pibo_run_start");
		await startTool.execute(
			"tool-call-real-timeout",
			{ toolName: "bash", arguments: { command: "printf 'service ready\\n'; sleep 2", timeout: 1 } },
			new AbortController().signal,
			() => {},
			{
				sessionManager: runtime.session.sessionManager,
				model: runtime.session.model,
				thinkingLevel: runtime.session.thinkingLevel,
			},
		);
		assert.equal(started.timeoutMs, 1000);
		await assert.rejects(started.execute(), (error) => error instanceof PiboRunExecutionTimeoutError && error.timeoutPhase === "lifetime");
	} finally {
		await runtime.dispose();
	}
});
