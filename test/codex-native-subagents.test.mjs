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
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

async function fixtureRoot(t, prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await chmod(fixturePath, 0o755);
	await mkdir(join(root, "workspace"), { recursive: true, mode: 0o700 });
	t.after(() => rm(root, { recursive: true, force: true }));
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

test("Codex native invokes direct and yielded Pibo subagents through scoped MCP on a different runtime", async (t) => {
	const root = await fixtureRoot(t, "pibo-codex-subagent-parent-");
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
		cwd: workspace,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	const events = [];
	router.subscribe((event) => events.push(event));
	t.after(() => router.disposeAll());

	const status = await openStatus(router, "ps_codex_subagent_parent");
	assert.ok(status.activeTools.includes("pibo-session-tools/pibo_subagent_helper"));
	assert.ok(status.activeTools.includes("pibo-session-tools/pibo_run_start"));
	const parent = store.get("ps_codex_subagent_parent");
	assert.equal(parent.runtimeBinding.adapterId, CODEX_NATIVE_ADAPTER_ID);
	assert.equal(parent.runtimeBinding.state, "bound");
	const client = router.sessions.get(parent.id).runtime;

	const first = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_subagent_helper", {
		message: "first direct request",
		threadKey: "shared",
	});
	assert.equal(first.content[0].text, "fixture child: first direct request");
	const [firstChild] = childSessions(store, parent.id);
	assert.ok(firstChild);
	assert.equal(firstChild.profile, "fixture-subagent-child");
	assert.equal(firstChild.runtimeBinding.adapterId, "fixture-child");
	assert.equal(firstChild.runtimeBinding.runtimeInstanceId, "fixture-child");
	assert.equal(firstChild.runtimeBinding.state, "bound");
	assert.equal(firstChild.metadata.chatRoomId, "room_codex_subagents");
	assert.equal(firstChild.metadata.workflowSessionKind, "subagent");

	const second = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_subagent_helper", {
		message: "second direct request",
		threadKey: "shared",
	});
	assert.equal(second.content[0].text, "fixture child: second direct request");
	assert.equal(second.structuredContent.piboSessionId, firstChild.id);
	assert.equal(childSessions(store, parent.id).length, 1);

	const started = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_start", {
		toolName: "pibo_subagent_helper",
		arguments: { message: "yielded request", threadKey: "yielded" },
		completionPolicy: "tracked",
	});
	const runId = started.structuredContent.runId;
	assert.match(runId, /^run_/);
	const waited = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_wait", {
		runId,
		timeoutMs: 2_000,
	});
	assert.equal(waited.structuredContent.status, "completed");
	const read = await callFixtureMcp(client, parent.runtimeBinding.nativeSessionId, "pibo_run_read", { runId });
	assert.equal(read.content[0].text, "fixture child: yielded request");

	const links = events.filter((event) => event.type === "subagent_session" && event.piboSessionId === parent.id);
	assert.equal(links.length, 3);
	assert.equal(links[0].childPiboSessionId, links[1].childPiboSessionId);
	assert.notEqual(links[2].childPiboSessionId, links[0].childPiboSessionId);
	assert.deepEqual(links.map((event) => event.threadKey), ["shared", "shared", "yielded"]);
	const childAdapter = registry.requireAgentRuntimeAdapter("fixture-child");
	assert.equal(childAdapter.sessions.length, 2);
	assert.deepEqual(childAdapter.sessions[0].prompts.map((prompt) => prompt.text), ["first direct request", "second direct request"]);
	assert.deepEqual(childAdapter.sessions[1].prompts.map((prompt) => prompt.text), ["yielded request"]);
});

test("a Pi parent subagent tool creates and reuses a native Codex child binding", async (t) => {
	const root = await fixtureRoot(t, "pibo-pi-codex-subagent-");
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
		cwd: workspace,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	t.after(() => router.disposeAll());

	const status = await openStatus(router, "ps_pi_subagent_parent");
	assert.ok(status.activeTools.includes("pibo_subagent_codex"));
	const parent = store.get("ps_pi_subagent_parent");
	assert.equal(parent.runtimeBinding.adapterId, "pi");
	const piRuntime = router.sessions.get(parent.id).runtime;
	const tool = piRuntime.session.getToolDefinition("pibo_subagent_codex");
	assert.ok(tool);

	const first = await tool.execute("pi-codex-tool-1", {
		message: "native Codex child first turn",
		threadKey: "shared",
	});
	assert.equal(first.content[0].text, "Codex answer.");
	const [child] = childSessions(store, parent.id);
	assert.ok(child);
	assert.equal(child.runtimeBinding.adapterId, CODEX_NATIVE_ADAPTER_ID);
	assert.equal(child.runtimeBinding.runtimeInstanceId, "codex-subagent-fixture");
	assert.equal(child.runtimeBinding.state, "bound");
	assert.ok(child.runtimeBinding.nativeSessionId);
	assert.equal(child.parentId, parent.id);
	assert.equal(child.workspace, parent.workspace);
	assert.equal(child.metadata.chatRoomId, "room_pi_codex_subagents");

	const firstNativeThread = child.runtimeBinding.nativeSessionId;
	const second = await tool.execute("pi-codex-tool-2", {
		message: "native Codex child second turn",
		threadKey: "shared",
	});
	assert.equal(second.content[0].text, "Codex answer.");
	assert.equal(second.details.piboSessionId, child.id);
	assert.equal(childSessions(store, parent.id).length, 1);
	assert.equal(store.get(child.id).runtimeBinding.nativeSessionId, firstNativeThread);
});
