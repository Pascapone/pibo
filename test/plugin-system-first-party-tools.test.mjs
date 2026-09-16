import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { InitialSessionContext } from "../dist/core/profiles.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";
import { buildPortableRuntimeContextSnapshot } from "../dist/agent-runtime/context-build.js";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { PI_AGENT_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/pi/adapter.js";
import { PluginHost } from "../dist/plugins/host.js";
import { startPluginProductRuntime } from "../dist/plugins/product-runtime.js";
import { createAgentPluginSelection } from "../dist/plugins/selection.js";
import {
	PIBO_SESSION_AGENT_TARGETS_SERVICE,
	PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE,
	PIBO_SESSION_GOAL_STORE_SERVICE,
	PIBO_SESSION_YIELDED_RUNS_SERVICE,
} from "../dist/plugins/runtime.js";
import { PiboPortableToolService } from "../dist/tools/session-service.js";
import { createAgentToolDefinitions } from "../dist/subagents/tool.js";

const selectedPluginIds = new Set([
	"pibo.code-runtime",
	"pibo.file-editing",
	"pibo.gateway-tools",
	"pibo.browser-tools",
	"pibo.codex-compat",
	"pibo.run-control",
	"pibo.goal-control",
]);

function selectFirstPartyTools(installations) {
	const selection = structuredClone(createAgentPluginSelection(installations));
	for (const entry of selection.plugins) {
		const installation = installations.find((candidate) => candidate.pluginId === entry.pluginId);
		const selected = selectedPluginIds.has(entry.pluginId);
		for (const contribution of installation.manifest.contributions) {
			if (contribution.scope === "agent" && Object.hasOwn(entry.contributions, contribution.id)) {
				entry.contributions[contribution.id] = selected && ["tool", "system-prompt-transformer"].includes(contribution.kind);
			}
		}
		entry.enabled = Object.values(entry.contributions).some(Boolean);
	}
	return selection;
}

function findNode(nodes, id) {
	for (const node of nodes) {
		if (node.id === id) return node;
		const nested = node.children ? findNode(node.children, id) : undefined;
		if (nested) return nested;
	}
	return undefined;
}

function findNodeWhere(nodes, predicate) {
	for (const node of nodes) {
		if (predicate(node)) return node;
		const nested = node.children ? findNodeWhere(node.children, predicate) : undefined;
		if (nested) return nested;
	}
	return undefined;
}

test("selected first-party providers preserve direct, yielded, context, Run schema, MCP, and cleanup boundaries", async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-first-party-tools-"));
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const host = new PluginHost();
	const product = await startPluginProductRuntime({ host, data, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [] });
	const installations = data.plugins.listInstallations();
	const profile = new InitialSessionContext({
		profileName: "first-party-provider-agent",
		pluginSelection: selectFirstPartyTools(installations),
		subagents: [{ name: "reviewer", description: "Reviews changes", targetProfile: "reviewer-profile" }],
		builtinTools: "disabled",
		autoContextFiles: false,
	});
	const generation = product.runtime.reserve(profile, { adapterId: "pi", instanceId: "pi", capabilities: {} }, "ps_first_party", "gen_first_party");
	const portableService = new PiboPortableToolService();
	const resourceService = new PiboRuntimeResourceService();
	const resources = await resourceService.createSession({
		piboSessionId: "ps_first_party",
		piboRoomId: "room_first_party",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		sessionGeneration: "gen_first_party",
		profile: generation.profile,
		cwd: root,
		timezone: "UTC",
		capabilities: PI_AGENT_RUNTIME_CAPABILITIES,
	});
	const runController = {
		startToolRun() { throw new Error("not executed in schema test"); },
		listRuns() { return []; },
		status() { throw new Error("not executed in schema test"); },
		wait() { throw new Error("not executed in schema test"); },
		read() { throw new Error("not executed in schema test"); },
		cancel() { throw new Error("not executed in schema test"); },
		acknowledge() { throw new Error("not executed in schema test"); },
	};
	const delegationHost = {
		assertDepth() {},
		resolveSession() { throw new Error("not executed in schema test"); },
		associateRequest() {},
		dissociateRequest() {},
		emitOutput() {},
		emitMessageAndWaitForReply() { throw new Error("not executed in schema test"); },
		trackActive() { return () => {}; },
		listAgents() { return []; },
		observeAgents() { return { observations: [], truncated: false, nextAfterSequence: 0 }; },
		killAgent() { throw new Error("not executed in schema test"); },
	};
	const coreDelegationTools = createAgentToolDefinitions(generation.profile.subagents, {
		async sendMessage() { throw new Error("not executed in schema test"); },
		listAgents() { return []; },
		observe() { return { filters: {}, observations: [], truncated: false, nextAfterSequence: 0 }; },
		async killAgent() { throw new Error("not executed in schema test"); },
	});
	const session = portableService.createSession({
		piboSessionId: "ps_first_party",
		piboRoomId: "room_first_party",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		sessionGeneration: "gen_first_party",
		profile: generation.profile,
		cwd: root,
		coreSessionTools: coreDelegationTools.map((definition) => ({ definition })),
		sessionToolProviders: generation.sessionToolProviders,
		sessionServices: {
			[PIBO_SESSION_YIELDED_RUNS_SERVICE]: runController,
			[PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE]: delegationHost,
			[PIBO_SESSION_AGENT_TARGETS_SERVICE]: generation.profile.subagents,
			[PIBO_SESSION_GOAL_STORE_SERVICE]: join(root, "goals.sqlite"),
		},
	});
	t.after(async () => {
		await session.dispose().catch(() => {});
		await portableService.dispose().catch(() => {});
		await resourceService.dispose().catch(() => {});
		try { product.runtime.release(generation); } catch {}
		await product.dispose().catch(() => {});
		data.close();
		await rm(root, { recursive: true, force: true });
	});
	const inspectionProfile = new InitialSessionContext({ ...generation.profile, pluginSelection: undefined });
	const detailedSnapshot = await inspectPiboContextBuild({ profile: inspectionProfile, portableTools: session, resources, persistSession: false });
	const definitions = [...session.getDefinitions()];
	const directNames = definitions.map((definition) => definition.name);
	assert.ok(directNames.includes("pibo_agents_list_agents"));
	assert.ok(directNames.includes("pibo_agents_observe"));
	assert.ok(directNames.includes("pibo_agents_kill"));
	assert.ok(directNames.includes("pibo_agents_send_message"), "delegated send is a direct Core tool");
	assert.ok(directNames.includes("pibo_run_start"));
	assert.ok(directNames.includes("runtime"));
	assert.ok(directNames.includes("hashline"));
	const runStart = definitions.find((definition) => definition.name === "pibo_run_start");
	const runEnum = runStart.inputSchema.properties.toolName.enum;
	assert.ok(runEnum.includes("pibo_agents_send_message"));
	assert.ok(runEnum.includes("bash"), "selected augment provider receives adapter-native yieldable tools");
	assert.equal(runEnum.includes("hashline"), false, "non-yieldable file editing stays out of Run");
	assert.equal(runEnum.includes("pibo_run_start"), false, "augment tools cannot recursively target themselves");

	assert.equal(generation.profile.systemPromptTransformers.length, 1);
	const promptTransformer = findNodeWhere(detailedSnapshot.nodes, (node) => node.id?.startsWith("prompt/transformer/"));
	assert.equal(promptTransformer?.source, "plugin");
	assert.match(promptTransformer?.hydratedText ?? "", /Codex-Compatible Runtime/);
	const inspectedRunStart = findNode(detailedSnapshot.nodes, "tools/pibo_run_start/definition");
	const inspectedObserve = findNode(detailedSnapshot.nodes, "tools/pibo_agents_observe/definition");
	const delegatedContext = findNodeWhere(detailedSnapshot.nodes, (node) => node.path === "pibo://runtime/delegated-agents.md");
	assert.ok(inspectedRunStart.schemaJson.inputSchema.properties.toolName.enum.includes("pibo_agents_send_message"));
	assert.ok(findNode(detailedSnapshot.nodes, "tools/pibo_agents_send_message"));
	assert.equal(inspectedObserve.schemaJson.inputSchema.properties.order.default, "desc");
	assert.equal(inspectedObserve.schemaJson.inputSchema.properties.limit.default, 20);
	assert.match(delegatedContext.hydratedText, /`reviewer`.*Reviews changes/s);
	assert.match(delegatedContext.hydratedText, /pibo_run_start/);
	const capabilities = createMinimalAgentRuntimeCapabilities("Unavailable by default.");
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	const snapshot = buildPortableRuntimeContextSnapshot({
		profile: generation.profile,
		runtime: { runtimeInstanceId: "pi", adapterId: "pi", available: true, transport: "embedded", capabilities, diagnostics: [] },
		cwd: root,
		piboSessionId: "ps_first_party",
		piboRoomId: "room_first_party",
	});
	const manifest = findNode(snapshot.nodes, "runtime-manifest");
	assert.deepEqual([...manifest.payloadJson.activeToolNames].sort(), [...directNames.filter((name) => name !== "bash")].sort());
	assert.deepEqual([...manifest.payloadJson.yieldableToolNames].sort(), [...runEnum.filter((name) => name !== "bash")].sort());
	const toolsNode = findNode(snapshot.nodes, "tools");
	assert.ok(toolsNode.badges.includes("MCP:STREAMABLE-HTTP"));
	assert.ok(toolsNode.children.some((node) => node.title === "yielded-target:pibo_agents_send_message"));
	assert.equal(toolsNode.children.some((node) => node.title === "pibo_agents_send_message"), true);

	const access = await session.issueMcpAccess();
	assert.deepEqual([...access.allowedToolNames].sort(), [...definitions.filter((tool) => tool.name !== "bash" && tool.portable !== false).map((tool) => tool.name)].sort());
	assert.equal(access.allowedToolNames.includes("pibo_agents_send_message"), true);
	await session.dispose();
	assert.throws(() => session.createDefinitions(), /disposed/);
});
