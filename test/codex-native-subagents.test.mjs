import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));
const fortyCombiningCodePoints = "e\u0301".repeat(20);
const fortyTwoCombiningCodePoints = "e\u0301".repeat(21);

async function fixtureRoot(prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await chmod(fixturePath, 0o755);
	await mkdir(join(root, "workspace"), { recursive: true, mode: 0o700 });
	return root;
}

function codexConfig(root) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 5_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

function childSessions(store, parentId) {
	return store.list().filter((session) => session.parentId === parentId && session.kind === "subagent");
}

async function openStatus(router, piboSessionId) {
	const output = await router.emit({
		type: "execution",
		piboSessionId,
		action: "status",
	});
	assert.equal(output.type, "execution_result");
	return output.result;
}

async function callFixtureMcp(client, threadId, tool, args) {
	return await client.request("test/callMcpTool", {
		threadId,
		server: "pibo-session-tools",
		tool,
		arguments: args,
	});
}

async function listFixtureMcpTools(client, threadId) {
	return await client.request("test/listMcpTools", {
		threadId,
		server: "pibo-session-tools",
	});
}

function createRegistry(root, registerProfiles, childDriver) {
	return PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: `test.codex-subagents.${basename(root)}`,
				register(api) {
					api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
					api.registerAgentRuntimeInstance({
						id: "codex-subagent-fixture",
						adapterId: CODEX_NATIVE_ADAPTER_ID,
						config: codexConfig(root),
					});
					if (childDriver) {
						api.registerAgentRuntimeDriver(childDriver);
						api.registerAgentRuntimeInstance({ id: "fixture-child", adapterId: "fixture-child" });
					}
					registerProfiles(api);
				},
			}),
		],
	});
}

test("Codex native invokes yielded-only Pibo subagents through scoped MCP on a different runtime", async (t) => {
	const root = await fixtureRoot("pibo-codex-subagent-parent-");
	const workspace = join(root, "workspace");
	const childDriver = createFakeAgentRuntimeDriver({
		adapterId: "fixture-child",
		script(input) {
			return { events: [{ type: "assistant_message", text: `fixture child: ${input.text}` }] };
		},
	});
	const registry = createRegistry(root, (api) => {
		api.registerProfile({
			name: "codex-subagent-parent",
			create() {
				return new InitialSessionContextBuilder("codex-subagent-parent")
					.withAgentRuntime("codex-subagent-fixture")
					.withBuiltinTools("disabled")
					.withAutoContextFiles(false)
					.withToolPackages({ goalControl: false, runControl: true })
					.addSubagent({ name: "helper", targetProfile: "fixture-subagent-child", maxDepth: 2 })
					.createSession();
			},
		});
		api.registerProfile({
			name: "fixture-subagent-child",
			create() {
				return new InitialSessionContextBuilder("fixture-subagent-child")
					.withAgentRuntime("fixture-child")
					.withBuiltinTools("disabled")
					.withAutoContextFiles(false)
					.withToolPackages({ goalControl: false })
					.createSession();
			},
		});
	}, childDriver);
	const store = new InMemoryPiboSessionStore();
	const reliabilityStore = new PiboReliabilityStore(":memory:");
	store.create({
		id: "ps_codex_subagent_parent",
		channel: "test",
		kind: "chat",
		profile: "codex-subagent-parent",
		workspace,
		runtimeBinding: {
			piboSessionId: "ps_codex_subagent_parent",
			runtimeInstanceId: "codex-subagent-fixture",
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
		},
		metadata: { chatRoomId: "room_codex_subagents" },
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
		reliabilityStore,
		cwd: workspace,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	const events = [];
	router.subscribe((event) => events.push(event));
	t.after(async () => {
		await router.disposeAll();
		reliabilityStore.close();
		await rm(root, { recursive: true, force: true });
	});

	const status = await openStatus(router, "ps_codex_subagent_parent");
	assert.equal(status.activeTools.includes("pibo-session-tools/pibo_agents_send_message"), false);
	assert.ok(status.activeTools.includes("pibo-session-tools/pibo_run_start"));
	const parent = store.get("ps_codex_subagent_parent");
	assert.equal(parent.runtimeBinding.adapterId, CODEX_NATIVE_ADAPTER_ID);
	assert.equal(parent.runtimeBinding.state, "bound");
	const client = router.sessions.get(parent.id).runtime;
	const listedTools = await listFixtureMcpTools(client, parent.runtimeBinding.nativeSessionId);
	const runStartDefinition = listedTools.tools.find((tool) => tool.name === "pibo_run_start");
	assert.ok(runStartDefinition);
	const argumentSchemas = runStartDefinition.inputSchema.properties.arguments.anyOf
		?? [runStartDefinition.inputSchema.properties.arguments];
	const delegatedArgumentsSchema = argumentSchemas.find((schema) => schema.required?.includes("sessionName"));
	assert.ok(delegatedArgumentsSchema, "real Codex MCP tools/list must expose delegated sessionName");
	assert.equal(delegatedArgumentsSchema.properties.sessionName.maxLength, 40);
	assert.equal(delegatedArgumentsSchema.properties.sessionName.pattern, "\\S");

	for (const [label, argumentsValue] of [
		["empty-cross-schema", {}],
		["missing", { name: "helper", message: "missing" }],
		["blank", { name: "helper", sessionName: "   ", message: "blank" }],
		["non-string", { name: "helper", sessionName: 7, message: "wrong type" }],
		["oversized", { name: "helper", sessionName: "😀".repeat(41), message: "too long" }],
		["combining-oversized", { name: "helper", sessionName: fortyTwoCombiningCodePoints, message: "too many code points" }],
	]) {
		const rejected = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_start", {
			toolName: "pibo_agents_send_message",
			arguments: argumentsValue,
			completionPolicy: "tracked",
		});
		assert.equal(rejected.isError, true, `${label} sessionName must fail through real MCP tools/call`);
		assert.match(rejected.content[0].text, /Invalid arguments/);
	}
	assert.equal(childSessions(store, parent.id).length, 0);
	assert.equal(router.listRuns({ includeConsumed: true, includeDetached: true }).length, 0);
	assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
	assert.equal(router.scheduledRunReminders.size, 0);
	assert.equal(router.runReminderDeliveries.size, 0);
	assert.equal(router.runReminderRecoveries.size, 0);
	assert.equal(reliabilityStore.listRuns({ includeConsumed: true, includeDetached: true }).length, 0);
	assert.equal(reliabilityStore.listJobs({ queue: "runs" }).length, 0);
	assert.equal(registry.requireAgentRuntimeAdapter("fixture-child").sessions.length, 0);
	assert.equal(events.some((event) => event.type === "subagent_session"), false);
	const send = async (message, threadKey, sessionName) => {
		const started = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_start", {
			toolName: "pibo_agents_send_message",
			arguments: { name: "helper", sessionName, message, threadKey },
			completionPolicy: "tracked",
		});
		const runId = started.structuredContent.runId;
		const waited = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_wait", { runId, timeoutMs: 2_000 });
		assert.equal(waited.structuredContent.status, "completed");
		const read = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_read", { runId });
		return { runId, read };
	};

	const first = await send("first yielded request", "shared", fortyCombiningCodePoints);
	assert.match(first.read.content[0].text, /fixture child: first yielded request/);
	const [firstChild] = childSessions(store, parent.id);
	assert.ok(firstChild);
	assert.equal(firstChild.profile, "fixture-subagent-child");
	assert.equal(firstChild.runtimeBinding.adapterId, "fixture-child");
	assert.equal(firstChild.runtimeBinding.runtimeInstanceId, "fixture-child");
	assert.equal(firstChild.runtimeBinding.state, "bound");
	assert.equal(firstChild.metadata.chatRoomId, "room_codex_subagents");
	assert.equal(firstChild.metadata.workflowSessionKind, "subagent");
	assert.equal(firstChild.title, fortyCombiningCodePoints);

	const second = await send("second yielded request", "shared", "  Second yielded request  ");
	assert.match(second.read.content[0].text, /fixture child: second yielded request/);
	assert.equal(second.read.structuredContent.result.details.agentId, firstChild.id);
	assert.equal(childSessions(store, parent.id).length, 1);
	assert.equal(store.get(firstChild.id).title, "Second yielded request");

	const listed = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_agents_list_agents", {});
	assert.equal(listed.structuredContent.availableAgents[0].name, "helper");
	assert.equal(listed.structuredContent.agents[0].agentId, firstChild.id);
	assert.equal(listed.structuredContent.agents[0].sessionName, "Second yielded request");
	const observed = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_agents_observe", {
		requestIds: [second.runId],
		agentIds: [firstChild.id],
		eventTypes: ["assistant_message"],
		kinds: ["message"],
		roles: ["assistant"],
		textContains: "SECOND YIELDED REQUEST",
		limit: 10,
	});
	assert.equal(observed.structuredContent.observations.length, 1);
	assert.equal(observed.structuredContent.observations[0].requestId, second.runId);
	assert.match(observed.structuredContent.observations[0].text, /fixture child: second yielded request/);
	const killed = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_agents_kill", { agentId: firstChild.id });
	assert.deepEqual(killed.structuredContent.killed, [firstChild.id]);
	const afterKill = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_agents_list_agents", {});
	assert.equal(afterKill.structuredContent.agents[0].status, "killed");

	const afterKillSend = await send("yielded request after kill", "yielded", "Request after kill");
	assert.match(afterKillSend.runId, /^run_/);
	assert.match(afterKillSend.read.content[0].text, /fixture child: yielded request after kill/);

	const links = events.filter((event) => event.type === "subagent_session" && event.piboSessionId === parent.id);
	assert.equal(links.length, 3);
	assert.equal(links[0].childPiboSessionId, links[1].childPiboSessionId);
	assert.notEqual(links[2].childPiboSessionId, links[0].childPiboSessionId);
	assert.deepEqual(links.map((event) => event.threadKey), ["shared", "shared", "yielded"]);
	const childAdapter = registry.requireAgentRuntimeAdapter("fixture-child");
	assert.equal(childAdapter.sessions.length, 2);
	assert.deepEqual(childAdapter.sessions[0].prompts.map((prompt) => prompt.text), ["first yielded request", "second yielded request"]);
	assert.deepEqual(childAdapter.sessions[1].prompts.map((prompt) => prompt.text), ["yielded request after kill"]);
});

test("a Pi parent yielded subagent request creates and reuses a native Codex child binding", async (t) => {
	const root = await fixtureRoot("pibo-pi-codex-subagent-");
	const workspace = join(root, "workspace");
	const registry = createRegistry(root, (api) => {
		api.registerProfile({
			name: "pi-subagent-parent",
			create() {
				return new InitialSessionContextBuilder("pi-subagent-parent")
					.withAgentRuntime("pi")
					.withBuiltinTools("disabled")
					.withAutoContextFiles(false)
					.withToolPackages({ goalControl: false })
					.addSubagent({ name: "codex", targetProfile: "codex-subagent-child", maxDepth: 2 })
					.createSession();
			},
		});
		api.registerProfile({
			name: "codex-subagent-child",
			create() {
				return new InitialSessionContextBuilder("codex-subagent-child")
					.withAgentRuntime("codex-subagent-fixture")
					.withBuiltinTools("disabled")
					.withAutoContextFiles(false)
					.withToolPackages({ goalControl: false })
					.createSession();
			},
		});
	});
	const store = new InMemoryPiboSessionStore();
	const reliabilityStore = new PiboReliabilityStore(":memory:");
	store.create({
		id: "ps_pi_subagent_parent",
		channel: "test",
		kind: "chat",
		profile: "pi-subagent-parent",
		workspace,
		runtimeBinding: {
			piboSessionId: "ps_pi_subagent_parent",
			runtimeInstanceId: "pi",
			adapterId: "pi",
			state: "unbound",
		},
		metadata: { chatRoomId: "room_pi_codex_subagents" },
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
		reliabilityStore,
		cwd: workspace,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	const events = [];
	router.subscribe((event) => events.push(event));
	t.after(async () => {
		await router.disposeAll();
		reliabilityStore.close();
		await rm(root, { recursive: true, force: true });
	});

	const status = await openStatus(router, "ps_pi_subagent_parent");
	assert.equal(status.activeTools.includes("pibo_agents_send_message"), false);
	assert.ok(status.activeTools.includes("pibo_run_start"));
	const parent = store.get("ps_pi_subagent_parent");
	assert.equal(parent.runtimeBinding.adapterId, "pi");
	const piRuntime = router.sessions.get(parent.id).runtime;
	const startTool = piRuntime.session.getToolDefinition("pibo_run_start");
	const waitTool = piRuntime.session.getToolDefinition("pibo_run_wait");
	const readTool = piRuntime.session.getToolDefinition("pibo_run_read");
	assert.equal(startTool.parameters.properties.arguments.required.includes("sessionName"), true);
	assert.equal(startTool.parameters.properties.arguments.properties.sessionName.maxLength, 40);
	for (const argumentsValue of [
		{ name: "codex", message: "missing" },
		{ name: "codex", sessionName: "   ", message: "blank" },
		{ name: "codex", sessionName: 7, message: "wrong type" },
		{ name: "codex", sessionName: "😀".repeat(41), message: "too long" },
		{ name: "codex", sessionName: fortyTwoCombiningCodePoints, message: "too many code points" },
	]) {
		await assert.rejects(startTool.execute("pi-invalid-session-name", {
			toolName: "pibo_agents_send_message",
			arguments: argumentsValue,
			completionPolicy: "tracked",
		}), /Invalid arguments for yielded tool/);
	}
	assert.equal(childSessions(store, parent.id).length, 0);
	assert.equal(router.listRuns({ includeConsumed: true, includeDetached: true }).length, 0);
	assert.equal(router.gatewayWorkAdmission.activeReservations.size, 0);
	assert.equal(router.scheduledRunReminders.size, 0);
	assert.equal(router.runReminderDeliveries.size, 0);
	assert.equal(router.runReminderRecoveries.size, 0);
	assert.equal(reliabilityStore.listRuns({ includeConsumed: true, includeDetached: true }).length, 0);
	assert.equal(reliabilityStore.listJobs({ queue: "runs" }).length, 0);
	assert.equal(events.some((event) => event.type === "subagent_session"), false);
	const send = async (toolCallId, sessionName, message) => {
		const started = await startTool.execute(toolCallId, {
			toolName: "pibo_agents_send_message",
			arguments: { name: "codex", sessionName, message, threadKey: "shared" },
			completionPolicy: "tracked",
		});
		const waited = await waitTool.execute(`${toolCallId}-wait`, { runId: started.details.runId, timeoutMs: 2_000 });
		assert.equal(waited.details.status, "completed");
		return await readTool.execute(`${toolCallId}-read`, { runId: started.details.runId });
	};

	const first = await send("pi-codex-tool-1", fortyCombiningCodePoints, "native Codex child first turn");
	assert.match(first.content[0].text, /Codex answer\./);
	const [child] = childSessions(store, parent.id);
	assert.ok(child);
	assert.equal(child.runtimeBinding.adapterId, CODEX_NATIVE_ADAPTER_ID);
	assert.equal(child.runtimeBinding.runtimeInstanceId, "codex-subagent-fixture");
	assert.equal(child.runtimeBinding.state, "bound");
	assert.ok(child.runtimeBinding.nativeSessionId);
	assert.equal(child.parentId, parent.id);
	assert.equal(child.workspace, parent.workspace);
	assert.equal(child.metadata.chatRoomId, "room_pi_codex_subagents");
	assert.equal(child.title, fortyCombiningCodePoints);

	const firstNativeThread = child.runtimeBinding.nativeSessionId;
	const second = await send("pi-codex-tool-2", "Native Codex second turn", "native Codex child second turn");
	assert.match(second.content[0].text, /Codex answer\./);
	assert.equal(second.details.result.details.agentId, child.id);
	assert.equal(childSessions(store, parent.id).length, 1);
	assert.equal(store.get(child.id).runtimeBinding.nativeSessionId, firstNativeThread);
	assert.equal(store.get(child.id).title, "Native Codex second turn");
});
