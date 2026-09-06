import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Value } from "typebox/value";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime, inspectPiboProfile } from "../dist/core/runtime.js";
import { normalizePiEvent } from "../dist/agent-runtimes/pi/routed-session.js";
import { PiboRunExecutionTimeoutError } from "../dist/runs/lifecycle.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { createRunToolDefinitions } from "../dist/runs/tools.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { getDelegatedAgentContextFile } from "../dist/subagents/context.js";
import {
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "../dist/subagents/observation-query.js";
import {
	PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS,
	PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES,
} from "../dist/subagents/observation-text-regex.js";
import {
	createAgentToolDefinitions,
	createSubagentToolDefinitions,
	createSubagentToolName,
	PIBO_AGENT_SESSION_NAME_MAX_LENGTH,
	PIBO_AGENT_TOOL_NAMES,
} from "../dist/subagents/tool.js";
import {
	PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES,
	piboAgentObservationToolSummary,
} from "../dist/subagents/observations.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { findCliToolEntry, getInstalledCliToolContextFile } from "../dist/tools/registry.js";
import { isGeneratedPiboTool } from "../dist/tools/session-tool-set.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const fortyCombiningCodePoints = "e\u0301".repeat(20);
const fortyTwoCombiningCodePoints = "e\u0301".repeat(21);

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
	const observe = definitions.find((definition) => definition.name === "pibo_agents_observe");
	assert.match(observe.description, /newest 20 completed assistant messages/);
	assert.match(observe.promptSnippet, /cursorMode=auto is the default/);
	assert.match(observe.promptSnippet, /Streaming deltas, duplicate tool progress events, and tools are hidden by default/);
	assert.match(observe.promptSnippet, /cursorMode=history to reread earlier observations/);
	assert.equal(observe.inputSchema.properties.cursorMode.default, "auto");
	assert.equal(observe.inputSchema.properties.order.default, "desc");
	assert.equal(observe.inputSchema.properties.limit.default, 20);
	assert.equal(observe.inputSchema.properties.includeTools.default, false);
	assert.equal(observe.inputSchema.properties.toolDetail.default, "summary");
	assert.equal(observe.inputSchema.properties.toolCallIds.maxItems, 50);
	assert.match(observe.inputSchema.properties.toolCallIds.items.description, /Exact existing toolCallId/);
	assert.match(observe.inputSchema.properties.eventTypes.items.description, /Explicit filters can retrieve progress events/);
	assert.match(observe.inputSchema.properties.kinds.items.description, /including progress events/);
	assert.match(observe.inputSchema.properties.textRegex.description, /rg\/Rust-regex/);
	assert.match(observe.inputSchema.properties.textRegex.description, /Combines with textContains using AND semantics/);
	assert.match(observe.inputSchema.properties.textRegex.description, /NUL text and literal or escaped NUL patterns are rejected/);
	assert.match(observe.inputSchema.properties.textRegex.description, /requires the optional rg platform binary/);
	assert.throws(
		() => createAgentToolDefinitions([
			{ name: "same", targetProfile: "helper-profile" },
			{ name: "same", targetProfile: "other-profile" },
		], noopAgentsController),
		/Duplicate agent name "same"/,
	);
});

function testAgentObservation(sequence, text, overrides = {}) {
	return {
		sequence,
		createdAt: "2026-09-04T18:00:00.000Z",
		agentId: "ps_regex_child",
		name: "worker",
		eventType: "assistant_message",
		kind: "message",
		role: "assistant",
		text,
		...overrides,
	};
}

test("agent observation regex bounds dense and empty matches by the input batch", () => {
	assert.equal(PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES % 4_096, 0);
	const expectedYieldCount = PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES / 4_096;
	for (const pattern of ["x", ".", "", "x?", ".*?"]) {
		let yielded = 0;
		function* observations() {
			for (let sequence = 1; sequence <= expectedYieldCount * 4; sequence += 1) {
				yielded += 1;
				yield testAgentObservation(sequence, "x".repeat(4_096));
			}
		}
		const page = selectPiboAgentObservationPage(
			observations(),
			preparePiboAgentObservationQuery({ textRegex: pattern, order: "asc", limit: 1 }),
		);
		assert.deepEqual(page.observations.map((observation) => observation.sequence), [1], pattern);
		assert.equal(page.truncated, true, pattern);
		assert.equal(yielded, expectedYieldCount, pattern);
	}
});

test("agent observation regex treats empty text as one null-data record", () => {
	const observations = [testAgentObservation(1, "")];
	for (const pattern of ["", "^$", "x?", ".*?"]) {
		const page = selectPiboAgentObservationPage(
			observations,
			preparePiboAgentObservationQuery({ textRegex: pattern }),
		);
		assert.deepEqual(page.observations.map((observation) => observation.sequence), [1], pattern);
	}
	assert.equal(selectPiboAgentObservationPage(
		observations,
		preparePiboAgentObservationQuery({ textRegex: "x" }),
	).observations.length, 0);
});

test("agent observation regex streams sparse fixed batches with stable cursor pagination", () => {
	const total = PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2 + 10;
	const hitSequences = new Set([
		PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS,
		PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2,
		PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2 + 5,
	]);
	let yielded = 0;
	function* observations() {
		for (let sequence = 1; sequence <= total; sequence += 1) {
			yielded += 1;
			yield testAgentObservation(sequence, hitSequences.has(sequence) ? `hit-${sequence}` : "miss");
		}
	}

	const first = selectPiboAgentObservationPage(
		observations(),
		preparePiboAgentObservationQuery({ textRegex: "^hit-", order: "asc", limit: 1 }),
	);
	assert.deepEqual(first.observations.map((observation) => observation.sequence), [PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS]);
	assert.equal(first.nextAfterSequence, PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS);
	assert.equal(first.truncated, true);
	assert.equal(yielded, PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2);

	yielded = 0;
	const second = selectPiboAgentObservationPage(
		observations(),
		preparePiboAgentObservationQuery({
			textRegex: "^hit-",
			afterSequence: first.nextAfterSequence,
			order: "desc",
			limit: 1,
		}),
	);
	assert.deepEqual(second.observations.map((observation) => observation.sequence), [PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2]);
	assert.equal(second.truncated, true);
	assert.equal(second.nextAfterSequence, PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2);
	assert.equal(yielded, total);

	const third = selectPiboAgentObservationPage(
		observations(),
		preparePiboAgentObservationQuery({
			textRegex: "^hit-",
			afterSequence: second.nextAfterSequence,
			order: "desc",
			limit: 1,
		}),
	);
	assert.deepEqual(third.observations.map((observation) => observation.sequence), [PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS * 2 + 5]);
	assert.equal(third.truncated, false);
});

test("agent observation regex rejects NUL boundaries without leaking process errors", () => {
	assert.throws(
		() => preparePiboAgentObservationQuery({ textRegex: "literal\0nul" }),
		/Agent observation textRegex is invalid: matching NUL bytes is not supported\./,
	);
	for (const pattern of [String.raw`\x00`, String.raw`\x{0}`, String.raw`\u{0000}`]) {
		assert.throws(
			() => preparePiboAgentObservationQuery({ textRegex: pattern }),
			/Agent observation textRegex is invalid: matching NUL bytes is not supported\./,
		);
	}
	assert.throws(
		() => preparePiboAgentObservationQuery({ textRegex: String.raw`\0` }),
		/Agent observation textRegex is invalid: backreferences are not supported\./,
	);
	const query = preparePiboAgentObservationQuery({ textRegex: "boundary", limit: 1 });
	assert.throws(
		() => selectPiboAgentObservationPage([testAgentObservation(1, "record\0boundary")], query),
		/Agent observation textRegex cannot match observation text containing NUL bytes\./,
	);
	const escapedLiteral = selectPiboAgentObservationPage(
		[testAgentObservation(1, String.raw`literal\x00text`)],
		preparePiboAgentObservationQuery({ textRegex: String.raw`literal\\x00text` }),
	);
	assert.equal(escapedLiteral.observations.length, 1);
});

test("agent observation regex resolves the optional platform binary only for regex queries", () => {
	const previousArch = process.env.npm_config_arch;
	process.env.npm_config_arch = "pibo-missing-architecture";
	try {
		const observations = [testAgentObservation(1, "Alpha complete")];
		assert.equal(selectPiboAgentObservationPage(observations, preparePiboAgentObservationQuery({})).observations.length, 1);
		assert.equal(selectPiboAgentObservationPage(
			observations,
			preparePiboAgentObservationQuery({ textContains: "ALPHA" }),
		).observations.length, 1);
		let yielded = 0;
		function* noRegexFastPath() {
			for (let sequence = 1; sequence <= 10; sequence += 1) {
				yielded += 1;
				yield testAgentObservation(sequence, "alpha");
			}
		}
		selectPiboAgentObservationPage(
			noRegexFastPath(),
			preparePiboAgentObservationQuery({ textContains: "ALPHA", order: "asc", limit: 1 }),
		);
		assert.equal(yielded, 2);
		assert.throws(
			() => preparePiboAgentObservationQuery({ textRegex: "Alpha" }),
			/Agent observation textRegex is unavailable: @vscode\/ripgrep-.*pibo-missing-architecture is not installed for this platform\./,
		);
	} finally {
		if (previousArch === undefined) delete process.env.npm_config_arch;
		else process.env.npm_config_arch = previousArch;
	}
});

test("agent observation regex preserves null-data anchors and inline multiline flags", () => {
	const observations = [testAgentObservation(1, "alpha\nbeta")];
	for (const pattern of [String.raw`^alpha\nbeta$`, String.raw`(?m)^beta$`, String.raw`(?s)^alpha.beta$`]) {
		assert.equal(selectPiboAgentObservationPage(
			observations,
			preparePiboAgentObservationQuery({ textRegex: pattern }),
		).observations.length, 1, pattern);
	}
	assert.equal(selectPiboAgentObservationPage(
		observations,
		preparePiboAgentObservationQuery({ textRegex: "^beta$" }),
	).observations.length, 1);
	assert.equal(selectPiboAgentObservationPage(
		observations,
		preparePiboAgentObservationQuery({ textRegex: "^gamma$" }),
	).observations.length, 0);
});

test("agent observation tool summaries bound oversized and malformed values", () => {
	const oversized = piboAgentObservationToolSummary(undefined, false, {
		result: { status: "completed", output: `prefix-${"x".repeat(100_000)}` },
	});
	assert.equal(Buffer.byteLength(oversized, "utf8") <= PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES, true);
	assert.match(oversized, /"outputBytes":100007/);
	assert.match(oversized, /"outputPreview":"prefix-/);
	assert.equal(oversized.includes("x".repeat(1_000)), false);

	const cyclic = {};
	cyclic.self = cyclic;
	const malformed = piboAgentObservationToolSummary(undefined, true, { result: cyclic });
	assert.equal(Buffer.byteLength(malformed, "utf8") <= PIBO_AGENT_OBSERVATION_TOOL_SUMMARY_MAX_BYTES, true);
	assert.match(malformed, /"preview":"\[object Object\]"/);
	assert.match(malformed, /"isError":true/);
});

test("legacy subagent tool exports remain available, stay outside runtime assembly, and require session names", async () => {
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
	assert.equal(Value.Check(tool.inputSchema, { message: "missing name" }), false);
	assert.equal(Value.Check(tool.inputSchema, { sessionName: fortyTwoCombiningCodePoints, message: "schema mismatch" }), true);
	await assert.rejects(
		tool.execute("tool-legacy-missing", { message: "missing name" }),
		/Agent session name is required/,
	);
	assert.throws(
		() => tool.prepareInput({ sessionName: fortyTwoCombiningCodePoints, message: "must fail before dispatch" }),
		/Agent session name must be at most 40 characters/,
	);
	await assert.rejects(
		tool.execute("tool-legacy-combining-long", { sessionName: fortyTwoCombiningCodePoints, message: "must fail before dispatch" }),
		/Agent session name must be at most 40 characters/,
	);
	assert.equal(calls.length, 0);
	assert.equal(
		tool.prepareInput({ sessionName: ` ${fortyCombiningCodePoints} `, message: "trim before validating" }).sessionName,
		fortyCombiningCodePoints,
	);
	await tool.execute("tool-legacy-combining-exact", { sessionName: fortyCombiningCodePoints, message: "exactly 40 code points" });
	assert.equal(calls[0].sessionName, fortyCombiningCodePoints);
	const result = await tool.execute("tool-legacy", { sessionName: "  Legacy research  ", message: "inspect", threadKey: "migration" });
	assert.equal(result.content[0].text, "legacy reply");
	assert.equal(calls[1].sessionName, "Legacy research");
	assert.equal(calls[1].toolCallId, "tool-legacy");
	assert.equal(calls[1].threadKey, "migration");
	assert.throws(
		() => createSubagentToolDefinitions([
			{ name: "same-name", targetProfile: "one" },
			{ name: "same name", targetProfile: "two" },
		], { async runSubagent() { throw new Error("not used"); } }),
		/Duplicate subagent tool name "pibo_subagent_same_name"/,
	);
});

test("shared send tool normalizes the legacy agents-controller result shape", async () => {
	let observedInput;
	const [send] = createAgentToolDefinitions(
		[{ name: "helper", description: "Legacy controller helper.", targetProfile: "helper-profile" }],
		{
			async sendMessage(input) {
				observedInput = input;
				return {
					agentId: "ps_legacy_controller_child",
					name: "helper",
					profile: "helper-profile",
					threadKey: "legacy-thread",
					eventId: "legacy-event",
					reply: {
						type: "assistant_message",
						piboSessionId: "ps_legacy_controller_child",
						eventId: "legacy-event",
						text: "legacy reply text",
					},
				};
			},
			listAgents() { return []; },
			observe(input) { return { filters: input, observations: [], nextAfterSequence: 0, truncated: false }; },
			async killAgent(agentId) { return { agentId, killed: [agentId], cancelledRuns: [] }; },
		},
	);
	const result = await send.execute("legacy-controller-send", {
		name: "helper",
		sessionName: "Legacy controller request",
		message: "work",
	}, undefined, undefined, { yieldedRunId: "run_legacy_controller" });
	assert.equal(observedInput.requestId, "run_legacy_controller");
	assert.equal(result.details.requestId, "run_legacy_controller");
	assert.equal(result.details.finalMessage, "legacy reply text");
	assert.equal(result.structuredContent.requestId, "run_legacy_controller");
	assert.equal(result.structuredContent.finalMessage, "legacy reply text");
	assert.match(result.content[0].text, /legacy reply text/);
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

test("direct Pi prompt orders delegated-agent context before installed-tool and MCP context", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-direct-pi-context-order-"));
	const piboHome = join(root, "pibo-home");
	const mcpConfigPath = join(root, "mcp_servers.json");
	const previousMcpConfigPath = process.env.MCP_CONFIG_PATH;
	writeFileSync(mcpConfigPath, JSON.stringify({
		mcpServers: {
			filesystem: {
				command: "node",
				pibo: { description: "Inspect files for context-order testing.", descriptionSource: "user" },
			},
		},
	}));
	try {
		await withPiboHome(piboHome, async () => {
			const browserUse = findCliToolEntry("browser-use");
			assert.ok(browserUse);
			const paths = getToolPythonRuntimePaths(browserUse.name, browserUse.runtime);
			mkdirSync(paths.binDir, { recursive: true });
			writeFileSync(paths.executablePath, "#!/bin/sh\n");
			process.env.MCP_CONFIG_PATH = mcpConfigPath;
			const profile = new InitialSessionContextBuilder("direct-context-order")
				.withAutoContextFiles(false)
				.withBuiltinTools("disabled")
				.withToolPackages({ goalControl: false })
				.withMcpServers(["filesystem"])
				.addSubagent({ name: "worker", description: "Perform delegated work.", targetProfile: "base" })
				.createSession();
			const inspection = await inspectPiboProfile({ cwd: root, profile, persistSession: false });
			const pathsInOrder = inspection.contextFiles.map((contextFile) => contextFile.path);
			const delegatedIndex = pathsInOrder.indexOf("pibo://runtime/delegated-agents.md");
			const installedIndex = pathsInOrder.indexOf(".pibo/context/installed-pibo-tools.md");
			const mcpIndex = pathsInOrder.indexOf(".pibo/context/enabled-mcp-servers.md");
			assert.ok(delegatedIndex >= 0, `delegated context missing from ${JSON.stringify(pathsInOrder)}`);
			assert.ok(installedIndex > delegatedIndex, `installed-tool context must follow delegated context: ${JSON.stringify(pathsInOrder)}`);
			assert.ok(mcpIndex > installedIndex, `MCP context must follow installed-tool context: ${JSON.stringify(pathsInOrder)}`);
		});
	} finally {
		if (previousMcpConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousMcpConfigPath;
		rmSync(root, { recursive: true, force: true });
	}
});

test("shared agent tool definitions delegate execution and management to the controller", async () => {
	const observed = [];
	const tools = createAgentToolDefinitions(
		[{
			name: "helper",
			description: "Ask the helper agent.",
			targetProfile: "helper-profile",
		}],
		{
			...noopAgentsController,
			async sendMessage(input) {
				observed.push(input);
				return noopAgentsController.sendMessage(input);
			},
			listAgents() {
				return [{ agentId: "ps_child", name: "helper", profile: "helper-profile", sessionName: "Find relevant files", threadKey: "files", status: "idle", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }];
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
	for (const [label, params] of [
		["missing", { name: "helper", message: "missing" }],
		["blank", { name: "helper", sessionName: "   ", message: "blank" }],
		["non-string", { name: "helper", sessionName: 7, message: "wrong type" }],
		["oversized", { name: "helper", sessionName: "😀".repeat(41), message: "too long" }],
		["combining-oversized", { name: "helper", sessionName: fortyTwoCombiningCodePoints, message: "too many code points" }],
	]) {
		await assert.rejects(
			send.execute(`tool-call-${label}`, params, controller.signal, undefined, { yieldedRunId: `run_${label}` }),
			/Agent session name/,
		);
	}
	assert.equal(observed.length, 0);
	await send.execute("tool-call-combining-exact", {
		name: "helper",
		sessionName: fortyCombiningCodePoints,
		message: "Exactly 40 code points.",
	}, controller.signal, undefined, { yieldedRunId: "run_combining_exact" });
	assert.equal(observed[0].sessionName, fortyCombiningCodePoints);
	const result = await send.execute("tool-call-1", {
		name: "helper",
		sessionName: "  Find relevant files  ",
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

	assert.equal(observed[1].subagent.name, "helper");
	assert.equal(observed[1].sessionName, "Find relevant files");
	assert.equal(observed[1].message, "Find the relevant files.");
	assert.equal(observed[1].threadKey, "files");
	assert.equal(observed[1].toolCallId, "tool-call-1");
	assert.equal(observed[1].requestId, "run_request_1");
	assert.deepEqual(observed[1].parentProvenance, { kind: "loop-run", jobId: "loop_job", runId: "loop_run" });
	assert.equal(observed[1].signal, controller.signal);
	assert.equal(send.inputSchema.required.includes("sessionName"), true);
	assert.equal(send.inputSchema.properties.sessionName.minLength, 1);
	assert.equal(send.inputSchema.properties.sessionName.maxLength, PIBO_AGENT_SESSION_NAME_MAX_LENGTH);
	assert.equal(send.inputSchema.properties.sessionName.pattern, "\\S");
	assert.equal(Value.Check(send.inputSchema, { name: "helper", message: "missing" }), false);
	assert.equal(Value.Check(send.inputSchema, { name: "helper", sessionName: "   ", message: "blank" }), false);
	assert.equal(Value.Check(send.inputSchema, { name: "helper", sessionName: "😀".repeat(40), message: "valid" }), true);
	assert.equal(Value.Check(send.inputSchema, { name: "helper", sessionName: "😀".repeat(41), message: "long" }), false);
	assert.equal(Value.Check(send.inputSchema, { name: "helper", sessionName: fortyTwoCombiningCodePoints, message: "schema mismatch" }), true);
	assert.throws(
		() => send.prepareInput({ name: "helper", sessionName: fortyTwoCombiningCodePoints, message: "prepared validation" }),
		/Agent session name must be at most 40 characters/,
	);
	assert.equal(send.inputSchema.properties.threadKey.maxLength, 256);
	assert.equal(result.details.agentId, "ps_child");
	assert.equal(result.details.requestId, "run_request_1");
	assert.equal(result.structuredContent.finalMessage, "helper result for helper");
	assert.match(result.content[0].text, /Agent request run_request_1 completed/);
	assert.match(result.content[0].text, /helper result for helper/);

	const listed = await list.execute("tool-call-2", {});
	assert.equal(listed.details.availableAgents[0].description, "Ask the helper agent.");
	assert.equal(listed.details.agents[0].agentId, "ps_child");
	assert.equal(listed.details.agents[0].sessionName, "Find relevant files");
});

test("run start prepares selected delegated input before admission and persists the prepared arguments", async () => {
	let starts = 0;
	let dispatches = 0;
	let started;
	let dispatched;
	const [send] = createAgentToolDefinitions(
		[{ name: "helper", targetProfile: "helper-profile" }],
		{
			...noopAgentsController,
			async sendMessage(input) {
				dispatches += 1;
				dispatched = input;
				return noopAgentsController.sendMessage(input);
			},
		},
	);
	const [start] = createRunToolDefinitions([send], {
		...noopRunToolController,
		startToolRun(input) {
			starts += 1;
			started = input;
			return {
				runId: `run_prepared_${starts}`,
				kind: "tool",
				controllerPiboSessionId: "ps_parent",
				status: "running",
				completionPolicy: input.completionPolicy ?? "tracked",
				consumed: false,
				toolName: input.toolName,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
		},
	});

	assert.equal(Value.Check(send.inputSchema, {
		name: "helper",
		sessionName: fortyTwoCombiningCodePoints,
		message: "schema admits graphemes",
	}), true);
	await assert.rejects(start.execute("run-start-combining-long", {
		toolName: send.name,
		arguments: { name: "helper", sessionName: fortyTwoCombiningCodePoints, message: "must not start" },
		completionPolicy: "tracked",
	}), /Agent session name must be at most 40 characters/);
	assert.equal(starts, 0);
	assert.equal(dispatches, 0);

	await start.execute("run-start-combining-exact", {
		toolName: send.name,
		arguments: { name: "helper", sessionName: fortyCombiningCodePoints, message: "exactly 40 code points" },
		completionPolicy: "tracked",
	});
	assert.equal(starts, 1);
	assert.equal(started.params.sessionName, fortyCombiningCodePoints);
	await started.execute("run_prepared_1");
	assert.equal(dispatches, 1);
	assert.equal(dispatched.sessionName, fortyCombiningCodePoints);

	await start.execute("run-start-trimmed", {
		toolName: send.name,
		arguments: { name: "helper", sessionName: "  Prepared title  ", message: "persist prepared input" },
		completionPolicy: "tracked",
	});
	assert.equal(starts, 2);
	assert.equal(started.params.sessionName, "Prepared title");
	await started.execute("run_prepared_2");
	assert.equal(dispatches, 2);
	assert.equal(dispatched.sessionName, "Prepared title");
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
	const delegatedContext = getDelegatedAgentContextFile(registry.createProfile("parent-profile").subagents);
	assert.ok(delegatedContext);
	assert.match(delegatedContext.content, /arguments: \{ name, sessionName, message, threadKey\? \}/);
	assert.match(delegatedContext.content, /sessionName.*human-readable child title/);
	assert.match(delegatedContext.content, /at most 40 Unicode code points/);
	assert.match(delegatedContext.content, /trims surrounding whitespace/);
	assert.match(delegatedContext.content, /before creating a yielded run or child session/);
	assert.match(delegatedContext.content, /textContains\?, textRegex\?/);
	assert.match(delegatedContext.content, /both must match when supplied together/);

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
				sessionName: "Depth rejection",
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
			sessionName: "  Inspect delegation  ",
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
		assert.equal(store.get(result.agentId).title, "Inspect delegation");
		assert.equal(result.requestId, "run_request_link");
		assert.equal(result.finalMessage, "child reply");
	} finally {
		await router.disposeAll();
	}
});

test("subagent runner freezes per-subagent model, thinking, and runtime overrides on new child sessions", async () => {
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
				modelFallbacks: [
					{ provider: "anthropic", id: "claude-haiku-5" },
					{ provider: "moonshot", id: "kimi-k2" },
				],
				thinkingLevel: "high",
				runtimeOptions: { permissionMode: "yolo" },
			},
			sessionName: "  Research plan  ",
			message: "research this",
			threadKey: "research-thread",
			requestId: "run_research_first",
		});
		const child = store.get(first.agentId);
		assert.equal(child.title, "Research plan");
		assert.deepEqual(child.activeModel, { provider: "openai", id: "gpt-5.6-mini" });
		assert.deepEqual(child.metadata.initialModelFallbacks, [
			{ provider: "anthropic", id: "claude-haiku-5" },
			{ provider: "moonshot", id: "kimi-k2" },
		]);
		assert.equal(child.metadata.initialThinkingLevel, "high");
		assert.deepEqual(child.metadata.initialRuntimeOptions, { permissionMode: "yolo" });
		assert.deepEqual(router.getSessionRuntimeProfile(child.id).runtimeOptions, { permissionMode: "yolo" });

		const reused = await controller.sendMessage({
			subagent: {
				name: "researcher",
				targetProfile: "base",
				model: { provider: "other", id: "changed-model" },
				modelFallbacks: [{ provider: "google", id: "changed-fallback" }],
				thinkingLevel: "low",
				runtimeOptions: { permissionMode: "approval" },
			},
			sessionName: "Refined research",
			message: "continue",
			threadKey: "research-thread",
			requestId: "run_research_reuse",
		});
		assert.equal(reused.agentId, first.agentId);
		assert.equal(store.get(reused.agentId).title, "Refined research");
		assert.deepEqual(store.get(reused.agentId).activeModel, { provider: "openai", id: "gpt-5.6-mini" });
		assert.deepEqual(store.get(reused.agentId).metadata.initialModelFallbacks, [
			{ provider: "anthropic", id: "claude-haiku-5" },
			{ provider: "moonshot", id: "kimi-k2" },
		]);
		assert.equal(store.get(reused.agentId).metadata.initialThinkingLevel, "high");
		assert.deepEqual(router.getSessionRuntimeProfile(reused.agentId).runtimeOptions, { permissionMode: "yolo" });

		const fallback = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			sessionName: "Default worker",
			message: "use defaults",
			threadKey: "default-thread",
			requestId: "run_research_default",
		});
		assert.equal(store.get(fallback.agentId).title, "Default worker");
		assert.deepEqual(store.get(fallback.agentId).activeModel, { provider: "default-provider", id: "default-subagent" });
		assert.equal(store.get(fallback.agentId).metadata.initialThinkingLevel, undefined);
		assert.equal(store.get(fallback.agentId).metadata.initialRuntimeOptions, undefined);
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
			sessionName: "Missing request ID",
			message: "must identify the request",
		}), /requestId is required/);
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "   ",
			message: "must not create a child",
			requestId: "run_invalid_blank_name",
		}), /Agent session name must not be empty/);
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "😀".repeat(41),
			message: "must not create a child",
			requestId: "run_invalid_long_name",
		}), /Agent session name must be at most 40 characters/);
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: fortyTwoCombiningCodePoints,
			message: "must not create a child",
			requestId: "run_invalid_combining_name",
		}), /Agent session name must be at most 40 characters/);
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "Invalid thread key",
			message: "must not create a child",
			threadKey: "é".repeat(257),
			requestId: "run_invalid_thread",
		}), /Subagent thread key exceeds 512 bytes/);

		const abortController = new AbortController();
		abortController.abort();
		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "Pre-aborted request",
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

test("agents controller requires bounded Unicode names and updates reused titles", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "child reply",
	});
	try {
		const controller = router.createAgentsController("ps_parent");
		const first = await controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: fortyCombiningCodePoints,
			message: "start",
			threadKey: "named-thread",
			requestId: "run_named_first",
		});
		assert.equal(store.get(first.agentId).title, fortyCombiningCodePoints);

		const renamed = await controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "  Updated title  ",
			message: "continue",
			threadKey: "named-thread",
			requestId: "run_named_second",
		});
		assert.equal(renamed.agentId, first.agentId);
		assert.equal(store.get(first.agentId).title, "Updated title");

		await assert.rejects(controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			message: "missing name",
			threadKey: "named-thread",
			requestId: "run_missing_name",
		}), /Agent session name is required/);
		assert.equal(store.get(first.agentId).title, "Updated title");
		assert.equal(controller.listAgents()[0].sessionName, "Updated title");
		assert.equal(store.list().length, 2);
	} finally {
		await router.disposeAll();
	}
});

test("named sends reuse and upgrade existing legacy child sessions", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: "ps_legacy_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent",
		metadata: {
			subagentName: "explorer",
			threadKey: "legacy-thread",
			subagentToolName: "pibo_subagent_explorer",
		},
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "legacy child reply",
	});
	try {
		const controller = router.createAgentsController("ps_parent");
		const result = await controller.sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "Continue legacy research",
			message: "continue",
			threadKey: "legacy-thread",
			requestId: "run_legacy_upgrade",
		});
		assert.equal(result.agentId, "ps_legacy_child");
		assert.equal(store.list().length, 2);
		assert.equal(store.get(result.agentId).title, "Continue legacy research");
		assert.equal(store.get(result.agentId).metadata.subagentToolName, "pibo_agents_send_message");
		assert.equal(controller.listAgents()[0].sessionName, "Continue legacy research");
	} finally {
		await router.disposeAll();
	}
});

test("named child titles survive PiboDataSessionStore reopen and remain reusable", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-subagent-session-name-reopen-"));
	const dbPath = join(root, "pibo.sqlite");
	let childId;
	let firstStore = new PiboDataSessionStore(dbPath);
	firstStore.create({ id: "ps_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	let firstRouter = new PiboSessionRouter({ persistSession: false, sessionStore: firstStore });
	firstRouter.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "first persisted reply",
	});
	try {
		const first = await firstRouter.createAgentsController("ps_parent").sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "  Persisted research  ",
			message: "start",
			threadKey: "persisted-thread",
			requestId: "run_persisted_first",
		});
		childId = first.agentId;
		assert.equal(firstStore.get(childId).title, "Persisted research");
	} finally {
		await firstRouter.disposeAll();
		firstStore.close();
	}

	let reopenedStore = new PiboDataSessionStore(dbPath);
	let reopenedRouter = new PiboSessionRouter({ persistSession: false, sessionStore: reopenedStore });
	reopenedRouter.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "reopened reply",
	});
	try {
		assert.equal(reopenedStore.get(childId).title, "Persisted research");
		const reused = await reopenedRouter.createAgentsController("ps_parent").sendMessage({
			subagent: { name: "explorer", targetProfile: "base" },
			sessionName: "Reopened research",
			message: "continue",
			threadKey: "persisted-thread",
			requestId: "run_persisted_reuse",
		});
		assert.equal(reused.agentId, childId);
		assert.equal(reopenedStore.get(childId).title, "Reopened research");
		assert.equal(reopenedRouter.createAgentsController("ps_parent").listAgents()[0].sessionName, "Reopened research");
	} finally {
		await reopenedRouter.disposeAll();
		reopenedStore.close();
		rmSync(root, { recursive: true, force: true });
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
			sessionName: "Explore alpha",
			message: "explore",
			threadKey: "alpha",
			requestId: "run_explorer",
		});
		const worker = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			sessionName: "Work beta",
			message: "work",
			threadKey: "beta",
			requestId: "run_worker",
		});
		assert.deepEqual(controller.listAgents().map((agent) => [agent.name, agent.status]).sort(), [["explorer", "idle"], ["worker", "idle"]]);

		router.emitOutput({
			type: "assistant_delta",
			piboSessionId: explorer.agentId,
			eventId: "event-explorer",
			text: "Alpha",
			provenance: { kind: "subagent-request", requestId: "run_explorer", controllerPiboSessionId: "ps_parent" },
		});
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
			type: "tool_execution_started",
			piboSessionId: worker.agentId,
			eventId: "event-worker",
			toolCallId: "tool-worker",
			toolName: "bash",
			args: { command: "npm test" },
			provenance: { kind: "subagent-request", requestId: "run_worker", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "tool_execution_updated",
			piboSessionId: worker.agentId,
			eventId: "event-worker",
			toolCallId: "tool-worker",
			toolName: "bash",
			args: { command: "npm test" },
			partialResult: { delta: "x".repeat(5_000) },
			provenance: { kind: "subagent-request", requestId: "run_worker", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "tool_execution_finished",
			piboSessionId: worker.agentId,
			eventId: "event-worker",
			toolCallId: "tool-worker",
			toolName: "bash",
			result: { status: "completed", exitCode: 0, durationMs: 12, output: "x".repeat(5_000) },
			isError: false,
			provenance: { kind: "subagent-request", requestId: "run_worker", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "tool_call",
			piboSessionId: explorer.agentId,
			eventId: "event-explorer-tool",
			toolCallId: "tool-explorer",
			toolName: "read",
			args: { path: "package.json" },
			argsComplete: true,
			provenance: { kind: "subagent-request", requestId: "run_explorer", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "tool_execution_finished",
			piboSessionId: explorer.agentId,
			eventId: "event-explorer-tool",
			toolCallId: "tool-explorer",
			toolName: "read",
			result: { status: "completed", path: "package.json", output: "package contents" },
			isError: false,
			provenance: { kind: "subagent-request", requestId: "run_explorer", controllerPiboSessionId: "ps_parent" },
		});
		router.emitOutput({
			type: "session_error",
			piboSessionId: worker.agentId,
			eventId: "event-worker-error",
			error: "test failed",
		});

		const defaults = controller.observe({});
		assert.deepEqual(defaults.filters.eventTypes, ["assistant_message"]);
		assert.equal(defaults.filters.order, "desc");
		assert.equal(defaults.filters.limit, 20);
		assert.equal(defaults.filters.includeTools, false);
		assert.equal(defaults.filters.toolDetail, "summary");
		assert.deepEqual(defaults.observations.map((observation) => observation.eventType), ["assistant_message"]);
		assert.equal(defaults.observations[0].text, "Alpha complete");
		assert.deepEqual(
			controller.observe({ eventTypes: ["assistant_delta"], limit: 50 }).observations.map((observation) => observation.eventType),
			["assistant_delta"],
		);
		assert.deepEqual(
			controller.observe({ textRegex: "^[A-Z][a-z]+ complete$" }).observations.map((observation) => observation.text),
			["Alpha complete"],
		);
		assert.equal(controller.observe({ textRegex: "^alpha complete$" }).observations.length, 0);
		assert.equal(controller.observe({ textRegex: "(?i)^alpha complete$" }).observations.length, 1);
		assert.equal(controller.observe({ textRegex: "^Beta" }).observations.length, 0);
		assert.equal(controller.observe({ textContains: "ALPHA", textRegex: "complete$" }).observations.length, 1);
		assert.equal(controller.observe({ textContains: "missing", textRegex: "complete$" }).observations.length, 0);
		assert.equal(controller.observe({ names: ["explorer"], textRegex: "^Alpha" }).observations.length, 1);
		assert.equal(controller.observe({ names: ["worker"], textRegex: "^Alpha" }).observations.length, 0);
		assert.throws(
			() => controller.observe({ textRegex: "(" }),
			/Agent observation textRegex is invalid: unclosed group\./,
		);
		assert.throws(
			() => controller.observe({ textRegex: String.raw`(Alpha)\1` }),
			/Agent observation textRegex is invalid: backreferences are not supported\./,
		);

		const withToolSummaries = controller.observe({ includeTools: true, order: "asc", limit: 50 });
		assert.deepEqual(withToolSummaries.filters.eventTypes, ["assistant_message", "tool_call", "tool_execution_finished"]);
		assert.deepEqual(withToolSummaries.observations.map((observation) => observation.eventType), [
			"assistant_message",
			"tool_call",
			"tool_execution_finished",
			"tool_call",
			"tool_execution_finished",
		]);
		const summarizedToolResult = withToolSummaries.observations.find((observation) => observation.eventType === "tool_execution_finished");
		assert.match(summarizedToolResult.text, /"outputBytes":5000/);
		assert.equal(Buffer.byteLength(summarizedToolResult.text, "utf8") <= 768, true);
		const selectedTools = controller.observe({ toolCallIds: ["tool-worker", "tool-explorer"], order: "asc", limit: 50 });
		assert.equal(selectedTools.filters.includeTools, true);
		assert.deepEqual(selectedTools.observations.map((observation) => observation.toolCallId), [
			"tool-worker",
			"tool-worker",
			"tool-explorer",
			"tool-explorer",
		]);
		assert.equal(selectedTools.observations.every((observation) => observation.kind === "tool"), true);
		assert.equal(controller.observe({ toolCallIds: ["tool-work"] }).observations.length, 0);
		const fullTools = controller.observe({
			requestIds: ["run_worker"],
			toolCallIds: ["tool-worker"],
			eventTypes: ["tool_execution_finished"],
			toolDetail: "full",
			order: "asc",
			limit: 50,
		});
		assert.deepEqual(fullTools.observations.map((observation) => observation.eventType), ["tool_execution_finished"]);
		const fullToolResult = fullTools.observations.find((observation) => observation.eventType === "tool_execution_finished");
		assert.equal(Buffer.byteLength(fullToolResult.text, "utf8") <= 4 * 1024, true);
		assert.ok(Buffer.byteLength(fullToolResult.text, "utf8") > Buffer.byteLength(summarizedToolResult.text, "utf8"));

		const broadActivity = controller.observe({ kinds: ["message", "tool", "error", "lifecycle"], order: "asc", limit: 100 });
		assert.equal(broadActivity.filters.includeTools, true);
		assert.deepEqual(broadActivity.observations.map((observation) => observation.eventType), [
			"assistant_delta",
			"assistant_message",
			"tool_call",
			"tool_execution_started",
			"tool_execution_updated",
			"tool_execution_finished",
			"tool_call",
			"tool_execution_finished",
			"session_error",
		]);

		const firstExplicitPage = controller.observe({ afterSequence: 0, kinds: ["message", "tool"], order: "desc", limit: 2 });
		assert.deepEqual(firstExplicitPage.observations.map((observation) => observation.eventType), ["assistant_message", "assistant_delta"]);
		const secondExplicitPage = controller.observe({
			afterSequence: firstExplicitPage.nextAfterSequence,
			kinds: ["message", "tool"],
			order: "desc",
			limit: 2,
		});
		assert.deepEqual(secondExplicitPage.observations.map((observation) => observation.eventType), ["tool_execution_started", "tool_call"]);
		assert.equal(secondExplicitPage.nextAfterSequence > firstExplicitPage.nextAfterSequence, true);

		const observeTool = createAgentToolDefinitions([
			{ name: "explorer", targetProfile: "base" },
			{ name: "worker", targetProfile: "base" },
		], controller).find((definition) => definition.name === "pibo_agents_observe");
		const modelResult = await observeTool.execute("observe-default", { cursorMode: "history" });
		assert.match(modelResult.content[0].text, /Alpha complete/);
		assert.doesNotMatch(modelResult.content[0].text, /assistant_delta|npm test|"observations"/);
		const summarizedToolModelResult = await observeTool.execute("observe-tool-summary", {
			toolCallIds: ["tool-worker"],
			order: "asc",
		});
		assert.match(summarizedToolModelResult.content[0].text, /toolCallId=tool-worker/);
		assert.doesNotMatch(summarizedToolModelResult.content[0].text, /toolCallId=tool-explorer/);
		const detailedModelResult = await observeTool.execute("observe-details", {
			eventTypes: ["tool_execution_finished"],
			includeDetails: true,
			toolDetail: "full",
			limit: 1,
		});
		assert.equal(detailedModelResult.details.observations[0].details.type, "tool_execution_finished");
		assert.equal(detailedModelResult.details.filters.includeDetails, true);
		await assert.rejects(
			observeTool.execute("observe-invalid-regex", { textRegex: "[z-a]" }),
			/Agent observation textRegex is invalid: invalid character class range, the start must be <= the end\./,
		);

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
		assert.equal(controller.observe({ afterSequence: observed.nextAfterSequence, kinds: ["error"] }).observations.length, 1);
		assert.equal(controller.observe({ kinds: ["error"], includeDetails: true }).observations[0].details.type, "session_error");
		assert.throws(() => controller.observe({ agentIds: ["ps_foreign"] }), /is not owned/);

		const killed = await controller.killAgent(worker.agentId);
		assert.deepEqual(killed.killed, [worker.agentId]);
		assert.equal(controller.listAgents().find((agent) => agent.agentId === worker.agentId).status, "killed");
		const replacement = await controller.sendMessage({
			subagent: { name: "worker", targetProfile: "base" },
			sessionName: "Retry beta",
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

test("agent observation auto cursors return messages once and history rereads without advancing them", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_auto_parent", channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: "ps_auto_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_auto_parent",
		metadata: { subagentName: "worker", threadKey: "auto" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		router.emitOutput({
			type: "assistant_message",
			piboSessionId: "ps_auto_child",
			eventId: "auto-message-1",
			text: "first result",
		});
		router.emitOutput({
			type: "tool_call",
			piboSessionId: "ps_auto_child",
			eventId: "auto-tool",
			toolCallId: "auto-tool-call",
			toolName: "bash",
			args: { command: "npm test" },
			argsComplete: true,
		});
		const controller = router.createAgentsController("ps_auto_parent");

		const first = controller.observe({ limit: 1 });
		assert.equal(first.filters.cursorMode, "auto");
		assert.deepEqual(first.observations.map((observation) => observation.text), ["first result"]);
		assert.equal(first.nextAfterSequence, 1);
		assert.equal(first.autoCursorSequence, 2);
		assert.deepEqual(controller.observe({ limit: 20, order: "asc" }).observations, []);

		router.emitOutput({
			type: "tool_execution_finished",
			piboSessionId: "ps_auto_child",
			eventId: "auto-tool",
			toolCallId: "auto-tool-call",
			toolName: "bash",
			result: { status: "completed", exitCode: 0 },
			isError: false,
		});
		const toolsHidden = controller.observe({});
		assert.deepEqual(toolsHidden.observations, []);
		assert.equal(toolsHidden.nextAfterSequence, 2);
		assert.equal(toolsHidden.autoCursorSequence, 3);

		router.emitOutput({
			type: "assistant_message",
			piboSessionId: "ps_auto_child",
			eventId: "auto-message-2",
			text: "second result",
		});
		assert.deepEqual(controller.observe({}).observations.map((observation) => observation.text), ["second result"]);
		assert.deepEqual(controller.observe({}).observations, []);

		const history = controller.observe({ cursorMode: "history", order: "asc" });
		assert.equal(history.filters.cursorMode, "history");
		assert.deepEqual(history.observations.map((observation) => observation.text), ["first result", "second result"]);
		assert.deepEqual(
			controller.observe({ cursorMode: "history", order: "asc" }).observations.map((observation) => observation.text),
			["first result", "second result"],
		);
		assert.deepEqual(controller.observe({}).observations, []);

		const diagnosticTools = controller.observe({ includeTools: true, order: "asc" });
		assert.deepEqual(diagnosticTools.observations.map((observation) => observation.eventType), [
			"assistant_message",
			"tool_call",
			"tool_execution_finished",
			"assistant_message",
		]);
		assert.deepEqual(controller.observe({ includeTools: true, order: "asc" }).observations, []);
		assert.throws(
			() => controller.observe({ cursorMode: "manual" }),
			/cursorMode must be "auto" or "history"/,
		);
	} finally {
		await router.disposeAll();
	}
});

test("agent observation fallback cursors remain bounded for compatibility stores", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_parent_fallback_cursor", channel: "pibo.test", kind: "chat", profile: "base" });
	store.create({
		id: "ps_agent_fallback_cursor",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "base",
		parentId: "ps_parent_fallback_cursor",
		metadata: { subagentName: "worker", threadKey: "fallback" },
	});
	store.getAgentObservationAutoCursor = undefined;
	store.advanceAgentObservationAutoCursor = undefined;
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	try {
		router.recordAgentObservation({
			type: "assistant_message",
			piboSessionId: "ps_agent_fallback_cursor",
			eventId: "evt_fallback_cursor",
			text: "hello fallback",
		}, store.get("ps_agent_fallback_cursor"));
		const controller = router.createAgentsController("ps_parent_fallback_cursor");
		assert.equal(controller.observe({ textContains: "hello" }).observations.length, 1);
		for (let index = 0; index < 128; index += 1) {
			assert.deepEqual(controller.observe({ textContains: `missing-${index}` }).observations, []);
		}
		assert.equal(controller.observe({ textContains: "hello" }).observations.length, 1);
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
				type: "assistant_message",
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

		const newest = controller.observe({ cursorMode: "history", order: "desc", limit: 2 });
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
		assert.throws(() => controller.observe({ toolCallIds: Array.from({ length: 51 }, (_, index) => `tool-${index}`) }), /toolCallIds must contain at most 50 entries/);
		assert.throws(() => controller.observe({ toolDetail: "verbose" }), /toolDetail must be "summary" or "full"/);
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
			arguments: { name: "worker", sessionName: "Hold until parent abort", message: "hold until parent abort", threadKey: "hold" },
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
			arguments: { name: "worker", sessionName: "Hold request", message: "hold", threadKey: "hold" },
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
			arguments: { name: "worker", sessionName: "Request A", message: "A", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		const childAdapter = fixture.registry.requireAgentRuntimeAdapter(fixture.adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);
		const child = fixture.store.find({ channel: "pibo.subagents", kind: "subagent", parentId: fixture.parentId })[0];
		assert.ok(child);

		const second = await tools.start.execute("start-active-b", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", sessionName: "Request B", message: "B", threadKey: "shared" },
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

test("killing an active delegated agent cancels its parent-owned yielded run durably", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-active-agent-kill-"));
	const sessionsPath = join(root, "sessions.sqlite");
	const reliabilityPath = join(root, "reliability.sqlite");
	const adapterId = "subagent-active-kill-child";
	const parentProfile = "subagent-active-kill-parent";
	const childProfile = "subagent-active-kill-child-profile";
	const parentId = "ps_active_kill_parent";
	const childDriver = createFakeAgentRuntimeDriver({ adapterId, script: { waitForAbort: true } });
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.subagent-active-kill",
				register(api) {
					api.registerAgentRuntimeDriver(childDriver);
					api.registerAgentRuntimeInstance({ id: adapterId, adapterId });
					api.registerProfile({
						name: parentProfile,
						create: () => new InitialSessionContextBuilder(parentProfile)
							.withAgentRuntime("pi")
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.addSubagent({ name: "worker", targetProfile: childProfile })
							.createSession(),
					});
					api.registerProfile({
						name: childProfile,
						create: () => new InitialSessionContextBuilder(childProfile)
							.withAgentRuntime(adapterId)
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession(),
					});
				},
			}),
		],
	});
	let sessionStore = new PiboDataSessionStore(sessionsPath);
	let reliabilityStore = new PiboReliabilityStore(reliabilityPath);
	let router = new PiboSessionRouter({ pluginRegistry: registry, sessionStore, reliabilityStore });
	try {
		sessionStore.create({
			id: parentId,
			channel: "pibo.test",
			kind: "chat",
			profile: parentProfile,
			runtimeBinding: { piboSessionId: parentId, runtimeInstanceId: "pi", adapterId: "pi", state: "unbound" },
		});
		await router.emit({ type: "execution", piboSessionId: parentId, action: "status" });
		const runtime = router.sessions.get(parentId).runtime;
		const started = await runtime.session.getToolDefinition("pibo_run_start").execute("start-active-child", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", sessionName: "Active worker", message: "hold", threadKey: "active" },
			completionPolicy: "tracked",
		});
		const runId = started.details.runId;
		const childAdapter = registry.requireAgentRuntimeAdapter(adapterId);
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);
		const child = sessionStore.find({ channel: "pibo.subagents", kind: "subagent", parentId })[0];
		const killed = await runtime.session.getToolDefinition("pibo_agents_kill").execute("kill-active-child", { agentId: child.id });
		assert.deepEqual(killed.details.cancelledRuns, [runId]);
		assert.equal(reliabilityStore.getRun(runId).status, "cancelled");
		assert.ok(childAdapter.sessions[0].abortCalls >= 1);

		await router.disposeAll();
		sessionStore.close();
		reliabilityStore.close();
		sessionStore = new PiboDataSessionStore(sessionsPath);
		reliabilityStore = new PiboReliabilityStore(reliabilityPath);
		router = new PiboSessionRouter({ pluginRegistry: registry, sessionStore, reliabilityStore });
		assert.equal(reliabilityStore.getRun(runId).status, "cancelled");
	} finally {
		await router.disposeAll().catch(() => undefined);
		try { sessionStore.close(); } catch {}
		try { reliabilityStore.close(); } catch {}
		rmSync(root, { recursive: true, force: true });
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
			arguments: { name: "worker", sessionName: "Queued request A", message: "A", threadKey: "shared" },
			completionPolicy: "tracked",
		});
		const childAdapter = registry.requireAgentRuntimeAdapter("subagent-targeted-cancel-child");
		await waitFor(() => childAdapter.sessions[0]?.getStatus().streaming === true);
		const second = await startTool.execute("start-shared-b", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "worker", sessionName: "Queued request B", message: "B", threadKey: "shared" },
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
			arguments: { name: "worker", sessionName: "Abort rejection", message: "wait", threadKey: "abort-rejection" },
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
			arguments: { name: "worker", sessionName: "Abort settlement", message: "wait", threadKey: "abort-nonsettling" },
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
			arguments: { name: "worker", sessionName: "Complete result", message: "produce complete result", threadKey: "complete" },
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
			arguments: { name: "worker", sessionName: "Reusable request", message: "wait", threadKey: "reusable" },
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
		assert.equal(activeChild.title, "Reusable request");

		const cancelStartedAt = Date.now();
		const cancelled = await runTools.pibo_run_cancel.execute("cancel-agent-request", { runId: started.details.runId });
		assert.ok(Date.now() - cancelStartedAt >= 35, "run cancellation must await confirmed child settlement");
		assert.equal(cancelled.details.status, "cancelled");
		assert.equal(store.get(activeChild.id).title, "Reusable request");
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
			sessionName: "Reusable request",
			message: "continue",
			threadKey: "reusable",
			requestId: "run_reused_thread",
		});
		assert.equal(reused.agentId, activeChild.id);
		assert.equal(store.get(reused.agentId).title, "Reusable request");
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
