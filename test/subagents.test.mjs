import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime, inspectPiboProfile } from "../dist/core/runtime.js";
import { PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { createAgentToolDefinitions, PIBO_AGENT_TOOL_NAMES } from "../dist/subagents/tool.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { findCliToolEntry, getInstalledCliToolContextFile } from "../dist/tools/registry.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;

const noopAgentsController = {
	async sendMessage(input) {
		return {
			agentId: "ps_child",
			name: input.subagent.name,
			profile: input.subagent.targetProfile,
			threadKey: input.threadKey ?? "generated-thread",
			eventId: "event-1",
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
	const result = await send.execute("tool-call-1", {
		name: "helper",
		message: "Find the relevant files.",
		threadKey: "files",
	}, controller.signal);

	assert.equal(observed.subagent.name, "helper");
	assert.equal(observed.message, "Find the relevant files.");
	assert.equal(observed.threadKey, "files");
	assert.equal(observed.toolCallId, "tool-call-1");
	assert.equal(observed.signal, controller.signal);
	assert.equal(send.inputSchema.properties.threadKey.maxLength, 256);
	assert.equal(result.details.agentId, "ps_child");
	assert.match(result.content[0].text, /Agent helper \(ps_child, thread files\) replied:/);
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
			PIBO_AGENT_TOOL_NAMES,
		);
		assert.equal(output.result.activeTools.some((name) => name.startsWith("pibo_subagent_")), false);
	} finally {
		await router.disposeAll();
	}
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

		assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => rootOutput.result.activeTools.includes(name)), PIBO_AGENT_TOOL_NAMES);
		assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => childOutput.result.activeTools.includes(name)), PIBO_AGENT_TOOL_NAMES);
		const rootSend = router.sessions.get("ps_root").runtime.session.getToolDefinition("pibo_agents_send_message");
		const childSend = router.sessions.get("ps_child").runtime.session.getToolDefinition("pibo_agents_send_message");
		assert.deepEqual(rootSend.parameters.properties.name.enum, ["defaulted", "limited", "deeper"]);
		assert.deepEqual(childSend.parameters.properties.name.enum, ["deeper"]);

		const childRunStart = router.sessions.get("ps_child").runtime.session.getToolDefinition("pibo_run_start");
		const childYieldableToolNames = childRunStart.parameters.properties.toolName.enum;
		assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => childYieldableToolNames.includes(name)), PIBO_AGENT_TOOL_NAMES);

		await assert.rejects(
			router.createAgentsController("ps_child").sendMessage({
				subagent: { name: "defaulted", targetProfile: "recursive-profile" },
				message: "must not create another child",
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
		});
		const linkEvent = events.find((event) => event.type === "subagent_session");

		assert.equal(linkEvent.piboSessionId, "ps_parent");
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
		});
		assert.equal(reused.agentId, first.agentId);
		assert.deepEqual(store.get(reused.agentId).activeModel, { provider: "openai", id: "gpt-5.6-mini" });
		assert.equal(store.get(reused.agentId).metadata.initialThinkingLevel, "high");

		const fallback = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			message: "use defaults",
			threadKey: "default-thread",
		});
		assert.deepEqual(store.get(fallback.agentId).activeModel, { provider: "default-provider", id: "default-subagent" });
		assert.equal(store.get(fallback.agentId).metadata.initialThinkingLevel, undefined);
	} finally {
		await router.disposeAll();
	}
});

test("subagent runner rejects oversized thread keys before creating a child session", async () => {
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
		await assert.rejects(router.createAgentsController("ps_parent").sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "must not create a child",
			threadKey: "é".repeat(257),
		}), /Subagent thread key exceeds 512 bytes/);
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
		});
		const worker = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			message: "work",
			threadKey: "beta",
		});
		assert.deepEqual(controller.listAgents().map((agent) => [agent.name, agent.status]).sort(), [["explorer", "idle"], ["worker", "idle"]]);

		router.emitOutput({
			type: "assistant_message",
			piboSessionId: explorer.agentId,
			eventId: "event-explorer",
			text: "Alpha complete",
		});
		router.emitOutput({
			type: "tool_call",
			piboSessionId: worker.agentId,
			eventId: "event-worker",
			toolCallId: "tool-worker",
			toolName: "bash",
			args: { command: "npm test" },
			argsComplete: true,
		});
		router.emitOutput({
			type: "session_error",
			piboSessionId: worker.agentId,
			eventId: "event-worker-error",
			error: "test failed",
		});

		const observed = controller.observe({
			agentIds: [worker.agentId],
			names: ["worker"],
			threadKeys: ["beta"],
			eventTypes: ["tool_call"],
			kinds: ["tool"],
			textContains: "NPM TEST",
			order: "asc",
			limit: 10,
		});
		assert.equal(observed.observations.length, 1);
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
		const tool = runtime.session.getToolDefinition("pibo_agents_send_message");
		const execution = tool.execute("subagent-abort-tool", { name: "worker", message: "hold until parent abort", threadKey: "hold" });
		const childAdapter = registry.requireAgentRuntimeAdapter("subagent-abort-child");
		const deadline = Date.now() + 2_000;
		while (!childAdapter.sessions.some((session) => session.getStatus().streaming)) {
			if (Date.now() >= deadline) throw new Error("Timed out waiting for active subagent child");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await router.emit({ type: "execution", piboSessionId: "ps_abort_parent", action: "abort" });
		await assert.rejects(execution, /finished without an assistant reply/);
		assert.equal(childAdapter.sessions[0].abortCalls > 0, true);
		assert.equal(childAdapter.sessions[0].getStatus().streaming, false);
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
	assert.deepEqual(PIBO_AGENT_TOOL_NAMES.filter((name) => activeTools.has(name)), PIBO_AGENT_TOOL_NAMES);
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
