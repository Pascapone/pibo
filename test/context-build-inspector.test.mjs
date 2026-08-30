import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { buildPortableRuntimeContextSnapshot } from "../dist/agent-runtime/context-build.js";
import { InitialSessionContext, InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";
import { createDefaultPiboProfile } from "../dist/plugins/builtin.js";
import { createCodexBrowserToolProfiles } from "../dist/tools/codex-browser.js";
import { definePiboTool } from "../dist/tools/contract.js";
import { createPiboSessionToolDefinitions } from "../dist/tools/session-tool-set.js";
import { createWebSearchToolProfile } from "../dist/tools/web-search.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredTitle = `${retiredWord[0].toUpperCase()}${retiredWord.slice(1)}`;
const retiredPartitionPattern = new RegExp(["User ID", `${retiredTitle} scope`, "user_test", "user:user_test"].join("|"));
const retiredFieldsPattern = new RegExp([`${retiredWord}Scope`, `${retiredTitle} scope`, `legacy${retiredTitle}Scope`, "User ID", "Principal", "user:"].join("|"));

function findNode(nodes, predicate) {
	for (const node of nodes) {
		if (predicate(node)) return node;
		const child = findNode(node.children ?? [], predicate);
		if (child) return child;
	}
	return undefined;
}

test("default base context build does not select Pibo native tooling context", async () => {
	const snapshot = await inspectPiboContextBuild({ profile: createDefaultPiboProfile() });
	const nativeTooling = findNode(snapshot.nodes, (node) => node.path?.endsWith("context/pibo-native-tooling.md"));
	const goalTool = findNode(snapshot.nodes, (node) => node.id === "tools/get_goal");
	const goalSchema = findNode([goalTool], (node) => node.id === "tools/get_goal/definition");

	assert.equal(snapshot.profileName, "base");
	assert.equal(nativeTooling, undefined);
	assert.equal(goalTool.source, "generated");
	assert.ok(goalTool.badges.includes("PIBO"));
	assert.ok(goalSchema.schemaJson.inputSchema);
});

test("generated tool origins remain inspector-only parent metadata", async () => {
	const profile = new InitialSessionContextBuilder("generated-tool-origin-test")
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ codexCompat: true, goalControl: true, runControl: true })
		.addTool({ name: "runtime", builtInPiboTool: "runtime" })
		.addSubagent({ name: "reviewer", description: "Review changes.", targetProfile: "reviewer-profile" })
		.createSession();
	const snapshot = await inspectPiboContextBuild({
		profile,
		persistSession: false,
		subagentProfileResolver: () => new InitialSessionContext({ profileName: "reviewer-profile" }),
	});
	const expectedOrigins = new Map([
		["runtime", "pibo-runtime"],
		["pibo_agents_observe", "pibo-subagents"],
		["pibo_run_read", "pibo-run-control"],
		["get_goal", "pibo-goal-control"],
		["apply_patch", "codex-compat"],
	]);

	for (const [toolName, label] of expectedOrigins) {
		const tool = findNode(snapshot.nodes, (node) => node.id === `tools/${toolName}`);
		assert.ok(tool, `expected generated tool ${toolName}`);
		assert.deepEqual(tool.metadata.inspectorOrigin, { label, modelVisible: false });
		assert.equal(tool.children.some((child) => child.id.endsWith("/generated-origin") || child.title === "Generated Origin"), false);
		assert.equal(tool.estimatedTokens, undefined, "inspector metadata must not receive a direct token estimate");
		const childTokens = tool.children.reduce((total, child) => total + (child.estimatedSubtreeTokens ?? child.estimatedTokens ?? 0), 0);
		assert.equal(tool.estimatedSubtreeTokens ?? 0, childTokens, "tool totals must include only model-visible children");
	}

	const allNodes = [];
	const collect = (nodes) => {
		for (const node of nodes) {
			allNodes.push(node);
			collect(node.children ?? []);
		}
	};
	collect(snapshot.nodes);
	assert.equal(snapshot.summary.totalNodes, allNodes.length);
	assert.equal(snapshot.summary.estimatedTokens, snapshot.nodes.reduce((total, node) => total + (node.estimatedSubtreeTokens ?? node.estimatedTokens ?? 0), 0));
	assert.equal(allNodes.some((node) => node.title === "Generated Origin"), false);
});

test("portable runtime context build explains degraded native-tool inspection", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.nativeToolInspection = {
		support: "degraded",
		mode: "observed-runtime-items",
		reason: "The stable runtime protocol exposes native tool names only after use.",
	};
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile: createDefaultPiboProfile(),
		cwd: process.cwd(),
		piboSessionId: "ps_native_tool_inspection",
		runtime: {
			runtimeInstanceId: "observed-runtime",
			adapterId: "observed",
			available: true,
			transport: "stdio",
			capabilities,
			diagnostics: [],
		},
	});
	const nativeInspection = findNode(snapshot.nodes, (node) => node.id === "tools/native-inspection");
	assert.equal(nativeInspection.state, "warning");
	assert.ok(nativeInspection.badges.includes("DEGRADED:OBSERVED-RUNTIME-ITEMS"));
	assert.ok(nativeInspection.notes.includes("The stable runtime protocol exposes native tool names only after use."));
});

test("portable runtime manifest uses materialized callable names for fixed and factory profile tools", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	let factoryCalls = 0;
	let factoryContext;
	const fixedDefinition = definePiboTool({
		name: "fixed_callable",
		title: "Fixed callable",
		description: "Fixed callable test tool.",
		inputSchema: Type.Object({}),
		async execute() { return { content: [{ type: "text", text: "fixed" }] }; },
	});
	const profile = new InitialSessionContext({
		profileName: "materialized-tool-names",
		builtinTools: "disabled",
		autoContextFiles: false,
		toolPackages: { goalControl: false, runControl: true },
		tools: [
			{ name: "fixed_registration", definition: fixedDefinition, yieldable: false },
			{
				name: "factory_registration",
				yieldable: true,
				createDefinition(context) {
					factoryCalls += 1;
					factoryContext = context;
					return definePiboTool({
						name: "factory_callable",
						title: "Factory callable",
						description: "Factory callable test tool.",
						inputSchema: Type.Object({}),
						async execute() { return { content: [{ type: "text", text: "factory" }] }; },
					});
				},
			},
		],
	});
	const toolContext = {
		piboSessionId: "ps_materialized_tool_names",
		piboRoomId: "room_materialized_tool_names",
		profileName: profile.profileName,
		cwd: process.cwd(),
	};
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile,
		cwd: toolContext.cwd,
		piboSessionId: toolContext.piboSessionId,
		piboRoomId: toolContext.piboRoomId,
		runtime: {
			runtimeInstanceId: "portable",
			adapterId: "portable",
			available: true,
			transport: "stdio",
			capabilities,
			diagnostics: [],
		},
	});
	assert.equal(factoryCalls, 1, "inspection materializes each profile factory once");
	assert.deepEqual(factoryContext, toolContext);
	const manifest = findNode(snapshot.nodes, (node) => node.id === "runtime-manifest");
	const definitions = createPiboSessionToolDefinitions({
		profile,
		toolContext,
		runToolController: {},
	});
	assert.equal(factoryCalls, 2, "session assembly materializes each profile factory once");
	assert.deepEqual(manifest.payloadJson.activeToolNames, definitions.map((definition) => definition.name));
	assert.deepEqual(
		manifest.payloadJson.yieldableToolNames,
		definitions.find((definition) => definition.name === "pibo_run_start").inputSchema.properties.toolName.enum,
	);
	assert.deepEqual(manifest.payloadJson.yieldableToolNames, ["factory_callable"]);
	assert.equal(manifest.payloadJson.activeToolNames.includes("fixed_registration"), false);
	assert.equal(manifest.payloadJson.activeToolNames.includes("factory_registration"), false);
});

test("portable runtime manifest excludes controller-backed Codex browser tools when no controller exists", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	const profile = new InitialSessionContext({
		profileName: "portable-without-codex-browser-controller",
		builtinTools: "disabled",
		autoContextFiles: false,
		toolPackages: { goalControl: false, runControl: true },
		tools: createCodexBrowserToolProfiles(),
	});
	const toolContext = {
		piboSessionId: "ps_portable_without_codex_browser_controller",
		profileName: profile.profileName,
		cwd: process.cwd(),
	};
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile,
		cwd: toolContext.cwd,
		piboSessionId: toolContext.piboSessionId,
		runtime: {
			runtimeInstanceId: "portable",
			adapterId: "portable",
			available: true,
			transport: "stdio",
			capabilities,
			diagnostics: [],
		},
	});
	const manifest = findNode(snapshot.nodes, (node) => node.id === "runtime-manifest");
	const definitions = createPiboSessionToolDefinitions({
		profile,
		toolContext,
		runToolController: {},
	});
	assert.deepEqual(definitions, []);
	assert.deepEqual(manifest.payloadJson.activeToolNames, []);
	assert.deepEqual(manifest.payloadJson.yieldableToolNames, []);
	assert.deepEqual(manifest.payloadJson.activeToolPackages, []);
});

test("portable runtime context build exposes selected Pibo subagents through MCP delivery", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	const profile = new InitialSessionContextBuilder("codex-subagent-context")
		.withAgentRuntime("codex-native")
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSubagent({
			name: "reviewer",
			description: "Review the proposed implementation.",
			targetProfile: "pi-reviewer",
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
			thinkingLevel: "xhigh",
		})
		.createSession();
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile,
		cwd: process.cwd(),
		piboSessionId: "ps_codex_subagent_context",
		activeModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
		thinkingLevel: "max",
		runtime: {
			runtimeInstanceId: "codex-native",
			adapterId: "codex-native",
			available: true,
			transport: "stdio",
			capabilities,
			diagnostics: [],
		},
	});
	const tools = findNode(snapshot.nodes, (node) => node.id === "tools");
	const manifest = findNode(snapshot.nodes, (node) => node.id === "runtime-manifest");
	assert.equal(tools.state, "active");
	assert.ok(tools.badges.includes("MCP:STREAMABLE-HTTP"));
	assert.equal(tools.children.some((node) => node.title === "pibo_agents_send_message"), false);
	assert.ok(tools.children.some((node) => node.title === "yielded-target:pibo_agents_send_message"));
	assert.ok(tools.children.some((node) => node.title === "pibo_agents_observe"));
	assert.ok(tools.children.some((node) => node.title === "pibo_run_start"));
	assert.ok(tools.children.some((node) => node.title === "pibo_run_read"));
	assert.ok(tools.children.some((node) => node.title === "agent:reviewer (pi-reviewer) — Review the proposed implementation."));
	assert.ok(tools.children.some((node) => node.title === "package:pibo-run-control (automatic for delegation)"));
	assert.equal(manifest.kind, "runtime_manifest");
	assert.equal(manifest.estimatedTokens, undefined, "the read-only manifest must not count as prompt context");
	assert.equal(manifest.payloadJson.toolSurface, "pibo-managed-only");
	assert.deepEqual(manifest.payloadJson.activeToolNames, [
		"pibo_agents_list_agents",
		"pibo_agents_observe",
		"pibo_agents_kill",
		"pibo_run_start",
		"pibo_run_list",
		"pibo_run_status",
		"pibo_run_wait",
		"pibo_run_read",
		"pibo_run_cancel",
		"pibo_run_ack",
	]);
	assert.deepEqual(manifest.payloadJson.yieldableToolNames, ["pibo_agents_send_message"]);
	assert.deepEqual(manifest.payloadJson.activeToolPackages, ["pibo-run-control"]);
	assert.equal(manifest.payloadJson.activeToolNames.some((name) => name.startsWith("agent:") || name.startsWith("package:") || name.startsWith("yielded-target:")), false);
	assert.deepEqual(manifest.payloadJson.effectiveModel, { provider: "openai-codex", id: "gpt-5.6-sol" });
	assert.equal(manifest.payloadJson.effectiveThinkingLevel, "max");
	assert.deepEqual(manifest.payloadJson.delegatedAgents, [{
		name: "reviewer",
		targetProfile: "pi-reviewer",
		configuredModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
		effectiveModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
		configuredThinkingLevel: "xhigh",
		effectiveThinkingLevel: "xhigh",
	}]);
});

test("context build exposes one shared agent surface and the available name-description catalog", async () => {
	const targetProfile = new InitialSessionContextBuilder("delegated-target")
		.withSubagentModel({ provider: "fallback-provider", id: "fallback-model" })
		.withSubagentThinkingLevel("medium")
		.createSession();
	const profile = new InitialSessionContextBuilder("agent-context")
		.withAutoContextFiles(false)
		.withBuiltinTools("disabled")
		.withToolPackages({ goalControl: false, runControl: true })
		.addSubagents([
			{ name: "explorer", description: "Inspect the repository and report findings.", targetProfile: "explorer-profile" },
			{ name: "worker", description: "Implement focused changes and verify them.", targetProfile: "worker-profile" },
		])
		.createSession();
	const snapshot = await inspectPiboContextBuild({
		profile,
		persistSession: false,
		subagentProfileResolver: () => targetProfile,
	});
	const runStartDefinition = findNode(snapshot.nodes, (node) => node.id === "tools/pibo_run_start/definition");
	const observeDefinition = findNode(snapshot.nodes, (node) => node.id === "tools/pibo_agents_observe/definition");
	const delegatedContext = findNode(snapshot.nodes, (node) => node.path === "pibo://runtime/delegated-agents.md");
	const manifest = findNode(snapshot.nodes, (node) => node.id === "runtime-manifest");
	const toolIds = [];
	const collect = (nodes) => {
		for (const node of nodes) {
			if (node.kind === "tool") toolIds.push(node.id);
			collect(node.children ?? []);
		}
	};
	collect(snapshot.nodes);

	assert.ok(runStartDefinition.schemaJson.inputSchema.properties.toolName.enum.includes("pibo_agents_send_message"));
	assert.equal(observeDefinition.schemaJson.inputSchema.properties.order.default, "desc");
	assert.equal(observeDefinition.schemaJson.inputSchema.properties.limit.default, 20);
	assert.equal(observeDefinition.schemaJson.inputSchema.properties.includeTools.default, false);
	assert.equal(observeDefinition.schemaJson.inputSchema.properties.toolDetail.default, "summary");
	assert.match(observeDefinition.schemaJson.inputSchema.properties.eventTypes.items.description, /Explicit filters can retrieve progress events/);
	assert.match(delegatedContext.hydratedText, /`explorer`.*Inspect the repository and report findings\./s);
	assert.match(delegatedContext.hydratedText, /`worker`.*Implement focused changes and verify them\./s);
	assert.match(delegatedContext.hydratedText, /pibo_run_wait/);
	assert.match(delegatedContext.hydratedText, /pibo_agents_observe/);
	assert.match(delegatedContext.hydratedText, /newest 20 completed assistant messages/);
	assert.match(delegatedContext.hydratedText, /includeTools: true/);
	assert.match(delegatedContext.hydratedText, /afterSequence/);
	assert.equal(toolIds.filter((id) => id.startsWith("tools/pibo_agents_")).length, 3);
	assert.equal(toolIds.includes("tools/pibo_agents_send_message"), false);
	assert.equal(toolIds.some((id) => id.includes("pibo_subagent_")), false);
	assert.equal(manifest.payloadJson.toolSurface, "complete");
	assert.deepEqual(manifest.payloadJson.activeToolNames, [
		"bash",
		"pibo_agents_kill",
		"pibo_agents_list_agents",
		"pibo_agents_observe",
		"pibo_run_ack",
		"pibo_run_cancel",
		"pibo_run_list",
		"pibo_run_read",
		"pibo_run_start",
		"pibo_run_status",
		"pibo_run_wait",
	]);
	assert.deepEqual(manifest.payloadJson.yieldableToolNames, [
		"bash",
		"pibo_agents_send_message",
		"pibo_agents_list_agents",
		"pibo_agents_observe",
		"pibo_agents_kill",
	]);
	assert.deepEqual(manifest.payloadJson.activeToolPackages, ["pibo-run-control"]);
	assert.equal(manifest.payloadJson.contextFilePaths.includes("pibo://runtime/delegated-agents.md"), true);
	assert.deepEqual(manifest.payloadJson.delegatedAgents.map((agent) => ({
		name: agent.name,
		effectiveModel: agent.effectiveModel,
		effectiveThinkingLevel: agent.effectiveThinkingLevel,
	})), [
		{ name: "explorer", effectiveModel: { provider: "fallback-provider", id: "fallback-model" }, effectiveThinkingLevel: "medium" },
		{ name: "worker", effectiveModel: { provider: "fallback-provider", id: "fallback-model" }, effectiveThinkingLevel: "medium" },
	]);
});

test("context build snapshot exposes runtime context and provider-backed web search without final prompt duplicate", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-context-build-"));
	const profile = new InitialSessionContext({
		profileName: "context-build-test",
		autoContextFiles: false,
		builtinToolNames: ["read", "bash"],
		tools: [createWebSearchToolProfile({ allowedDomains: ["example.com"], searchContextSize: "low" })],
	});

	const snapshot = await inspectPiboContextBuild({
		cwd,
		profile,
		sessionContext: {
			piboSessionId: "ps_test",
			piboRoomId: "room_test",
			timezone: "UTC",
		},
	});

	assert.equal(snapshot.version, 1);
	assert.equal(snapshot.profileName, "context-build-test");
	assert.equal(snapshot.piboSessionId, "ps_test");
	assert.ok(snapshot.summary.totalNodes > snapshot.summary.topLevelNodes);
	assert.ok(snapshot.summary.estimatedTokens > 0, "summary should include estimated token usage");
	assert.equal(findNode(snapshot.nodes, (node) => /final prompt|full prompt/i.test(node.title)), undefined);

	const runtimeContext = findNode(snapshot.nodes, (node) => node.path === "pibo://runtime/session-context.md");
	assert.ok(runtimeContext, "runtime session context node should exist");
	assert.match(runtimeContext.hydratedText, /App context: app/);
	assert.match(runtimeContext.hydratedText, /Pibo Session ID: ps_test/);
	assert.match(runtimeContext.hydratedText, /Pibo Room ID: room_test/);
	assert.doesNotMatch(runtimeContext.hydratedText, retiredPartitionPattern);
	assert.ok(runtimeContext.estimatedTokens > 0, "context file node should include direct estimated tokens");
	assert.ok(runtimeContext.estimatedSubtreeTokens >= runtimeContext.estimatedTokens, "context file node should include subtree estimated tokens");

	const webSearch = findNode(snapshot.nodes, (node) => node.id === "tools/web_search");
	assert.ok(webSearch, "web_search tool node should exist");
	assert.ok(webSearch.badges.includes("PROVIDER-BACKED"));
	assert.ok(webSearch.estimatedSubtreeTokens > 0, "tool parent should aggregate child estimated tokens");

	const providerPayload = findNode([webSearch], (node) => node.kind === "provider_payload");
	assert.equal(providerPayload.payloadJson.provider, "openai");
	assert.equal(providerPayload.payloadJson.openAiWebSearch.search_context_size, "low");
	assert.deepEqual(providerPayload.payloadJson.openAiWebSearch.filters.allowed_domains, ["example.com"]);
});

test("runtime context exposes app context and resource ids without partition fields", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-runtime-shared-context-"));
	const profile = new InitialSessionContext({
		profileName: "shared-context-test",
		autoContextFiles: false,
		builtinToolNames: ["read"],
	});

	const snapshot = await inspectPiboContextBuild({
		cwd,
		profile,
		sessionContext: {
			piboSessionId: "ps_shared",
			piboRoomId: "room_shared",
			timezone: "UTC",
		},
	});
	const runtimeContext = findNode(snapshot.nodes, (node) => node.path === "pibo://runtime/session-context.md");

	assert.match(runtimeContext.hydratedText, /App context: app/);
	assert.match(runtimeContext.hydratedText, /Pibo Session ID: ps_shared/);
	assert.match(runtimeContext.hydratedText, /Pibo Room ID: room_shared/);
	assert.doesNotMatch(runtimeContext.hydratedText, retiredFieldsPattern);
});
