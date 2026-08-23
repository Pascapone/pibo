import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { buildPortableRuntimeContextSnapshot } from "../dist/agent-runtime/context-build.js";
import { InitialSessionContext, InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";
import { createDefaultPiboProfile } from "../dist/plugins/builtin.js";
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

test("portable runtime context build exposes selected Pibo subagents through MCP delivery", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	const profile = new InitialSessionContextBuilder("codex-subagent-context")
		.withAgentRuntime("codex-native")
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false, runControl: true })
		.addSubagent({ name: "reviewer", description: "Review the proposed implementation.", targetProfile: "pi-reviewer" })
		.createSession();
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile,
		cwd: process.cwd(),
		piboSessionId: "ps_codex_subagent_context",
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
	assert.equal(tools.state, "active");
	assert.ok(tools.badges.includes("MCP:STREAMABLE-HTTP"));
	assert.ok(tools.children.some((node) => node.title === "pibo_agents_send_message"));
	assert.ok(tools.children.some((node) => node.title === "pibo_agents_observe"));
	assert.ok(tools.children.some((node) => node.title === "agent:reviewer (pi-reviewer) — Review the proposed implementation."));
	assert.ok(tools.children.some((node) => node.title === "package:pibo-run-control"));
});

test("context build exposes one shared agent surface and the available name-description catalog", async () => {
	const profile = new InitialSessionContextBuilder("agent-context")
		.withAutoContextFiles(false)
		.withBuiltinTools("disabled")
		.withToolPackages({ goalControl: false, runControl: true })
		.addSubagents([
			{ name: "explorer", description: "Inspect the repository and report findings.", targetProfile: "explorer-profile" },
			{ name: "worker", description: "Implement focused changes and verify them.", targetProfile: "worker-profile" },
		])
		.createSession();
	const snapshot = await inspectPiboContextBuild({ profile, persistSession: false });
	const sendDefinition = findNode(snapshot.nodes, (node) => node.id === "tools/pibo_agents_send_message/definition");
	const toolIds = [];
	const collect = (nodes) => {
		for (const node of nodes) {
			if (node.kind === "tool") toolIds.push(node.id);
			collect(node.children ?? []);
		}
	};
	collect(snapshot.nodes);

	assert.match(sendDefinition.schemaJson.description, /explorer: Inspect the repository and report findings\./);
	assert.match(sendDefinition.schemaJson.description, /worker: Implement focused changes and verify them\./);
	assert.equal(toolIds.filter((id) => id.startsWith("tools/pibo_agents_")).length, 4);
	assert.equal(toolIds.some((id) => id.includes("pibo_subagent_")), false);
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
