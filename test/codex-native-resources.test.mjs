import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
	getCodexNativeClient,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";
import { definePiboTool } from "../dist/tools/contract.js";
import { PiboPortableToolService } from "../dist/tools/session-service.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = process.platform === "win32" ? 10_000 : 3_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for native Codex resource maintenance");
		await delay(10);
	}
}

async function fixtureRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-resources-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await chmod(fixturePath, 0o755);
	return root;
}

function runtimeConfig(root) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

function binding(instanceId, piboSessionId, previous) {
	return previous ?? {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
}

function openInput({ instanceId, piboSessionId, workspace, profile, runtimeBinding, portableTools, resources }) {
	return {
		piboSession: createPiboSession({
			id: piboSessionId,
			channel: "test",
			kind: "chat",
			profile: profile.profileName,
			workspace,
			runtimeBinding,
		}),
		profile,
		binding: runtimeBinding,
		workspace,
		productContext: {
			piboSessionId,
			getActiveMessage: () => ({ id: "resource-message", source: "user" }),
		},
		services: { portableTools, resources },
	};
}

function trackedPortableSession(session, issued) {
	return {
		piboSessionId: session.piboSessionId,
		runtimeInstanceId: session.runtimeInstanceId,
		adapterId: session.adapterId,
		sessionGeneration: session.sessionGeneration,
		createDefinitions: (...args) => session.createDefinitions(...args),
		configureControllers: (...args) => session.configureControllers(...args),
		setConversationEntriesProvider: (...args) => session.setConversationEntriesProvider(...args),
		async issueMcpAccess(options) {
			const access = await session.issueMcpAccess(options);
			issued.push(access);
			return access;
		},
		renewMcpAccess: (...args) => session.renewMcpAccess(...args),
		revokeMcpAccess: (...args) => session.revokeMcpAccess(...args),
		dispose: () => session.dispose(),
	};
}

async function callAlpha(access, value) {
	const transport = new StreamableHTTPClientTransport(new URL(access.url), {
		requestInit: { headers: { Authorization: `Bearer ${access.token}` } },
	});
	const client = new Client({ name: "codex-resource-fixture", version: "1" });
	try {
		await client.connect(transport);
		const listed = await client.listTools();
		assert.deepEqual(listed.tools.map((tool) => tool.name), ["alpha"]);
		const result = await client.callTool({ name: "alpha", arguments: { value } });
		return result.content[0].text;
	} finally {
		await transport.close();
	}
}

async function expectCredentialRevoked(access) {
	const response = await fetch(access.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${access.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }),
	});
	assert.equal(response.status, 401);
}

test("Codex native delivers selected Pibo tools, HTTP MCP, skills, and context without Pi prompt injection", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	const selectedSkill = join(workspace, "skills", "selected");
	const unselectedSkill = join(workspace, "skills", "unselected");
	await mkdir(selectedSkill, { recursive: true });
	await mkdir(unselectedSkill, { recursive: true });
	await writeFile(join(selectedSkill, "SKILL.md"), "---\nname: selected-codex-skill\ndescription: selected fixture\n---\n\n# Selected skill\n");
	await writeFile(join(unselectedSkill, "SKILL.md"), "---\nname: unselected-codex-skill\ndescription: hidden fixture\n---\n\n# Hidden skill\n");
	await writeFile(join(workspace, "AGENTS.md"), "# Native Codex Project Context\n\nDiscovered by Codex itself.\n");
	await writeFile(join(workspace, "selected.md"), "# Selected Codex Context\n\nUse the selected delivery marker.\n");
	await writeFile(join(workspace, "unselected.md"), "# Unselected Context\n\nThis must not be delivered.\n");
	const stdioServerPath = join(root, "selected-stdio-server.mjs");
	await writeFile(stdioServerPath, "process.exit(0);\n");
	const mcpConfigPath = join(root, "mcp-servers.json");
	await writeFile(mcpConfigPath, `${JSON.stringify({
		mcpServers: {
			external: {
				url: "http://127.0.0.1:49191/mcp",
				headers: { Authorization: "Bearer ${EXTERNAL_TOKEN}" },
				allowedTools: ["external_lookup"],
				pibo: { description: "External native Codex fixture.", descriptionSource: "user" },
			},
			"external-stdio": {
				command: process.execPath,
				args: [stdioServerPath, "--credential=${STDIO_ARG}"],
				env: { STDIO_SECRET: "${STDIO_TOKEN}" },
				allowedTools: ["stdio_lookup"],
				pibo: { description: "External stdio native Codex fixture.", descriptionSource: "user" },
			},
			unselected: {
				url: "http://127.0.0.1:49192/mcp",
				headers: { Authorization: "Bearer unselected-secret" },
			},
		},
	}, null, 2)}\n`);
	const sourceMcpConfig = await readFile(mcpConfigPath, "utf8");

	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable Codex resource fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			return { content: [{ type: "text", text: `${context.piboSessionId}:${input.value}` }] };
		},
	});
	const instanceId = "codex-native-resources";
	const profile = new InitialSessionContextBuilder("codex-native-resources-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(true)
		.withNativeSubagents(true)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "alpha", definition: alpha })
		.addSkill({ name: "selected-codex-skill", path: join(selectedSkill, "SKILL.md"), kind: "user" })
		.addContextFile({ key: "selected-codex-context", label: "Selected Codex Context", path: "selected.md", source: "managed" })
		.withMcpServers(["external", "external-stdio"])
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex Native Resources",
		config: runtimeConfig(root),
	});
	assert.deepEqual(adapter.descriptor.capabilities.tools.piboManaged, { support: "mcp", transports: ["streamable-http"] });
	assert.deepEqual(adapter.descriptor.capabilities.mcp.externalServers, { support: "mcp", transports: ["streamable-http", "stdio"] });
	assert.equal(adapter.descriptor.capabilities.mcp.statusInspection, true);
	assert.deepEqual(adapter.descriptor.capabilities.skills, { support: "materialized", modes: ["codex-extra-roots"] });
	assert.deepEqual(adapter.descriptor.capabilities.context, {
		support: "materialized",
		modes: ["native-project-discovery", "codex-developer-instructions"],
	});
	const profileDiagnostics = await registry.validateProfile({ profile, workspace });
	assert.equal(profileDiagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

	const portableService = new PiboPortableToolService();
	t.after(async () => portableService.dispose());
	const resourceService = new PiboRuntimeResourceService({
		rootDir: join(root, "resource-generations"),
		mcpConfigPath,
		environment: {
			...process.env,
			EXTERNAL_TOKEN: "external-session-secret",
			STDIO_ARG: "stdio-argument-secret",
			STDIO_TOKEN: "stdio-environment-secret",
		},
		async verifyMcpServer(name, config) {
			if (name === "external") {
				assert.equal(config.headers.Authorization, "Bearer external-session-secret");
				return {
					status: "connected",
					serverName: "external-fixture",
					serverVersion: "1.0.0",
					protocolVersion: "2025-11-25",
					tools: [{ name: "external_lookup", description: "Selected external lookup" }],
					resources: [],
					resourceTemplates: [],
				};
			}
			assert.equal(name, "external-stdio");
			assert.equal(config.command, process.execPath);
			assert.deepEqual(config.args, [stdioServerPath, "--credential=stdio-argument-secret"]);
			assert.deepEqual(config.env, { STDIO_SECRET: "stdio-environment-secret" });
			return {
				status: "connected",
				serverName: "external-stdio-fixture",
				serverVersion: "1.0.0",
				protocolVersion: "2025-11-25",
				tools: [{ name: "stdio_lookup", description: "Selected stdio lookup" }],
				resources: [],
				resourceTemplates: [],
			};
		},
	});
	t.after(async () => resourceService.dispose());

	const piboSessionId = "ps_codex_resources";
	const generations = ["resource-generation-one", "resource-generation-two"];
	let runtimeBinding = binding(instanceId, piboSessionId);
	const accesses = [];
	for (const [index, generation] of generations.entries()) {
		const portableBase = portableService.createSession({
			piboSessionId,
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			sessionGeneration: generation,
			profile,
			cwd: workspace,
		});
		const portable = trackedPortableSession(portableBase, accesses);
		const resources = await resourceService.createSession({
			piboSessionId,
			piboRoomId: "room_codex_resources",
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			sessionGeneration: generation,
			profile,
			cwd: workspace,
			timezone: "UTC",
			capabilities: adapter.descriptor.capabilities,
			strict: true,
		});
		const resourceInspection = resources.getInspection();
		const resourceRoot = resourceInspection.paths.root;
		const automaticContext = resourceInspection.delivery.find((report) => report.contributionId === "context:automatic-project-files");
		assert.deepEqual(automaticContext, {
			contributionId: "context:automatic-project-files",
			status: "delivered",
			mode: "native-project-discovery",
			fidelity: "equivalent",
			target: workspace,
		});
		const mcpContext = resourceInspection.delivery.find((report) => report.contributionId === "context:enabled-mcp-servers");
		assert.equal(mcpContext.status, "delivered");
		assert.equal(mcpContext.mode, "native-mcp-inventory");
		assert.equal(mcpContext.fidelity, "equivalent");
		const session = await registry.openSession(instanceId, openInput({
			instanceId,
			piboSessionId,
			workspace,
			profile,
			runtimeBinding,
			portableTools: portable,
			resources,
		}));
		assert.equal(session.capabilities.tools.piboManaged.support, "mcp");
		assert.deepEqual(session.capabilities.tools.nativeToolInspection, {
			support: "degraded",
			mode: "observed-runtime-items",
			reason: "Stable Codex App Server 0.147.0 does not expose a complete pre-turn native-tool inventory; Pibo reports selected MCP tools immediately and harness-native tools after stable item notifications prove they are active.",
		});
		assert.deepEqual(session.getStatus().enabledTools, [
			"external-stdio/stdio_lookup",
			"external/external_lookup",
			"pibo-session-tools/alpha",
		]);
		assert.equal(accesses.length, index + 1);
		assert.equal(await callAlpha(accesses[index], `generation-${index + 1}`), `${piboSessionId}:generation-${index + 1}`);
		await session.prompt({ text: `materialize resource generation ${index + 1}`, source: "rpc" });

		const state = await getCodexNativeClient(session).request("test/getState", {});
		assert.deepEqual(state.skillRequests.at(-1), { rootCount: 1, skillNames: ["selected-codex-skill"] });
		const delivered = state.resourceRequests.at(-1);
		assert.equal(delivered.method, index === 0 ? "thread/start" : "thread/resume");
		assert.equal(delivered.hasBaseInstructions, false);
		assert.equal(delivered.hasNativeToolOverrides, true);
		assert.equal(delivered.multiAgentEnabled, true);
		assert.equal(delivered.multiAgentV2Enabled, true);
		assert.equal(delivered.agentsEnabled, true);
		assert.equal(delivered.containsPiboSelectedContext, true);
		assert.equal(delivered.containsPiboMcpCliInstructions, false);
		assert.equal(delivered.containsPiBasePrompt, false);
		assert.ok(delivered.developerInstructionBytes > 0);
		assert.ok(delivered.developerInstructionHeadings.includes("Selected Codex Context"));
		assert.equal(delivered.developerInstructionHeadings.includes("Unselected Context"), false);
		assert.equal(delivered.developerInstructionHeadings.includes("Native Codex Project Context"), false);
		assert.deepEqual(delivered.mcpServers.map((server) => server.name).sort(), ["external", "external-stdio", "pibo-session-tools"]);
		const external = delivered.mcpServers.find((server) => server.name === "external");
		assert.deepEqual(external.enabledTools, ["external_lookup"]);
		assert.deepEqual(external.envHttpHeaderNames, ["Authorization"]);
		assert.equal(external.hasBearerTokenEnvironment, false);
		assert.equal(external.defaultToolsApprovalMode, null);
		assert.equal(external.stdio, false);
		const stdio = delivered.mcpServers.find((server) => server.name === "external-stdio");
		assert.deepEqual(stdio.enabledTools, ["stdio_lookup"]);
		assert.equal(stdio.stdio, true);
		assert.equal(stdio.stdioEnvironmentCount, 4);
		assert.deepEqual(stdio.httpHeaderNames, []);
		assert.deepEqual(stdio.envHttpHeaderNames, []);
		const pibo = delivered.mcpServers.find((server) => server.name === "pibo-session-tools");
		assert.deepEqual(pibo.enabledTools, ["alpha"]);
		assert.equal(pibo.hasBearerTokenEnvironment, true);
		assert.equal(pibo.defaultToolsApprovalMode, "approve");
		assert.doesNotMatch(JSON.stringify(state), /external-session-secret|stdio-argument-secret|stdio-environment-secret|unselected-secret|selected delivery marker/);

		if (index === 0) {
			await session.controls.cloneSession();
			const forkState = await getCodexNativeClient(session).request("test/getState", {});
			const forkDelivery = forkState.resourceRequests.at(-1);
			assert.equal(forkDelivery.method, "thread/fork");
			assert.deepEqual(forkDelivery.mcpServers.map((server) => server.name).sort(), ["external", "external-stdio", "pibo-session-tools"]);
			assert.equal(forkDelivery.containsPiboSelectedContext, true);
			await session.prompt({ text: "materialize resource clone", source: "rpc" });
		}
		runtimeBinding = session.getBinding();
		await session.dispose();
		await expectCredentialRevoked(accesses[index]);
		portable.dispose();
		await resources.dispose();
		await assert.rejects(() => readFile(resourceRoot), /EISDIR|ENOENT/);
	}
	assert.equal(accesses[0].credentialId === accesses[1].credentialId, false);
	assert.equal(await readFile(mcpConfigPath, "utf8"), sourceMcpConfig);
});

test("Codex native leaves existing runtime subagent configuration untouched when the profile has no override", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const instanceId = "codex-native-subagents-inherited";
	const profile = new InitialSessionContextBuilder("codex-native-subagents-inherited-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config: runtimeConfig(root) });
	const runtimeBinding = binding(instanceId, "ps_codex_native_subagents_inherited");
	const session = await registry.openSession(instanceId, openInput({
		instanceId,
		piboSessionId: "ps_codex_native_subagents_inherited",
		workspace,
		profile,
		runtimeBinding,
		portableTools: undefined,
		resources: undefined,
	}));
	t.after(async () => session.dispose());
	const state = await getCodexNativeClient(session).request("test/getState", {});
	const start = state.resourceRequests.find((request) => request.method === "thread/start");
	assert.equal(start.multiAgentEnabled, null);
	assert.equal(start.multiAgentV2Enabled, null);
	assert.equal(start.agentsEnabled, null);
	assert.equal(start.hasNativeToolOverrides, false);
	await session.dispose();
});

test("Codex native disables only harness-native multi-agent tools when the profile turns native subagents off", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const instanceId = "codex-native-subagents-disabled";
	const profile = new InitialSessionContextBuilder("codex-native-subagents-disabled-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withNativeSubagents(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config: runtimeConfig(root) });
	const runtimeBinding = binding(instanceId, "ps_codex_native_subagents_disabled");
	const session = await registry.openSession(instanceId, openInput({
		instanceId,
		piboSessionId: "ps_codex_native_subagents_disabled",
		workspace,
		profile,
		runtimeBinding,
		portableTools: undefined,
		resources: undefined,
	}));
	t.after(async () => session.dispose());
	const state = await getCodexNativeClient(session).request("test/getState", {});
	const start = state.resourceRequests.find((request) => request.method === "thread/start");
	assert.equal(start.multiAgentEnabled, false);
	assert.equal(start.multiAgentV2Enabled, false);
	assert.equal(start.agentsEnabled, false, "model-catalog multi-agent hints must not re-enable native subagents");
	assert.equal(start.hasNativeToolOverrides, true);
	assert.equal(session.capabilities.nativeSubagents.configurable, true);
	await session.dispose();
});

test("Codex native renews its scoped Pibo tool lease while a turn remains active", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable active-renewal fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input) {
			return { content: [{ type: "text", text: `active:${input.value}` }] };
		},
	});
	const instanceId = "codex-native-resource-active-renewal";
	const profile = new InitialSessionContextBuilder("codex-native-resource-active-renewal-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "alpha", definition: alpha })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config: runtimeConfig(root) });
	const portableService = new PiboPortableToolService();
	t.after(async () => portableService.dispose());
	const base = portableService.createSession({
		piboSessionId: "ps_codex_resource_active_renewal",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		sessionGeneration: "generation-active-renewal",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const tracked = trackedPortableSession(base, accesses);
	let renewals = 0;
	const portable = {
		...tracked,
		async issueMcpAccess(options) {
			const access = await tracked.issueMcpAccess(options);
			return { ...access, expiresAt: new Date(Date.now() + 100).toISOString() };
		},
		renewMcpAccess(token, ttlMs) {
			renewals += 1;
			return tracked.renewMcpAccess(token, ttlMs);
		},
	};
	const runtimeBinding = binding(instanceId, "ps_codex_resource_active_renewal");
	const session = await registry.openSession(instanceId, openInput({
		instanceId,
		piboSessionId: "ps_codex_resource_active_renewal",
		workspace,
		profile,
		runtimeBinding,
		portableTools: portable,
		resources: undefined,
	}));
	t.after(async () => session.dispose());
	const client = getCodexNativeClient(session);
	const events = [];
	session.subscribe((event) => events.push(event));
	const prompt = session.prompt({ text: "[hold] keep the native turn active", source: "rpc" });
	await waitFor(() => events.some((event) => event.type === "turn_started"));
	await waitFor(() => renewals > 0);
	assert.equal(getCodexNativeClient(session), client);
	assert.equal(accesses.length, 1);
	assert.equal(await callAlpha(accesses[0], "lease"), "active:lease");
	await session.abort();
	await prompt;
	await session.dispose();
	await expectCredentialRevoked(accesses[0]);
	portable.dispose();
});

test("Codex native renews bounded tool credentials by rolling an idle App Server process", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable rollover fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input) {
			return { content: [{ type: "text", text: `rolled:${input.value}` }] };
		},
	});
	const instanceId = "codex-native-resource-rollover";
	const profile = new InitialSessionContextBuilder("codex-native-resource-rollover-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "alpha", definition: alpha })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config: runtimeConfig(root) });
	const portableService = new PiboPortableToolService();
	t.after(async () => portableService.dispose());
	const base = portableService.createSession({
		piboSessionId: "ps_codex_resource_rollover",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		sessionGeneration: "generation-rollover",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const tracked = trackedPortableSession(base, accesses);
	let issued = 0;
	let rejectedRenewals = 0;
	const portable = {
		...tracked,
		async issueMcpAccess(options) {
			const access = await tracked.issueMcpAccess(options);
			issued += 1;
			if (issued === 1) return { ...access, expiresAt: new Date(Date.now() + 100).toISOString() };
			if (issued === 2) return { ...access, expiresAt: new Date(Date.now() + 60_500).toISOString() };
			return access;
		},
		renewMcpAccess(token, ttlMs) {
			if (rejectedRenewals < 2) {
				rejectedRenewals += 1;
				throw new Error("fixture renewal boundary");
			}
			return tracked.renewMcpAccess(token, ttlMs);
		},
	};
	const runtimeBinding = binding(instanceId, "ps_codex_resource_rollover");
	const session = await registry.openSession(instanceId, openInput({
		instanceId,
		piboSessionId: "ps_codex_resource_rollover",
		workspace,
		profile,
		runtimeBinding,
		portableTools: portable,
		resources: undefined,
	}));
	t.after(async () => session.dispose());
	const initialClient = getCodexNativeClient(session);
	const initialThreadId = session.getBinding().nativeSessionId;
	await waitFor(() => accesses.length === 2 && getCodexNativeClient(session) !== initialClient);
	assert.notEqual(session.getBinding().nativeSessionId, initialThreadId);
	const secondClient = getCodexNativeClient(session);
	await session.prompt({ text: "materialize rollover thread", source: "rpc" });
	await expectCredentialRevoked(accesses[0]);
	const durableThreadId = session.getBinding().nativeSessionId;
	await waitFor(() => accesses.length === 3 && getCodexNativeClient(session) !== secondClient);
	await session.prompt({ text: "verify resumed rollover thread", source: "rpc" });
	assert.equal(session.getBinding().nativeSessionId, durableThreadId);
	assert.equal(session.getStatus().warnings.length, 0);
	await expectCredentialRevoked(accesses[1]);
	assert.equal(await callAlpha(accesses[2], "fresh"), "rolled:fresh");
	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.equal(state.resourceRequests.filter((request) => request.method === "thread/start").length, 2);
	assert.equal(state.resourceRequests.filter((request) => request.method === "thread/resume").length, 1);
	await session.dispose();
	await expectCredentialRevoked(accesses[2]);
	portable.dispose();
});

test("Codex native rejects same-name native skill collisions instead of silently losing explicit Pibo priority", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const skillsRoot = join(root, "materialized-skills");
	const selectedSkillDir = join(skillsRoot, "collision-skill");
	const selectedSkillPath = join(selectedSkillDir, "SKILL.md");
	await mkdir(selectedSkillDir, { recursive: true });
	await writeFile(selectedSkillPath, "---\nname: collision-skill\ndescription: selected collision fixture\n---\n\n# Selected collision skill\n");
	const instanceId = "codex-native-skill-collision";
	const profile = new InitialSessionContextBuilder("codex-native-skill-collision-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "collision-skill", path: selectedSkillPath })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config: runtimeConfig(root) });
	const resources = {
		piboSessionId: "ps_codex_skill_collision",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		sessionGeneration: "generation-skill-collision",
		getContextContributions: () => [],
		getSkillPaths: () => [selectedSkillPath],
		getMcpConfigPath: () => undefined,
		getAdapterEnvironment: () => ({ PIBO_CODEX_FIXTURE_NATIVE_SKILL_NAME: "collision-skill" }),
		getExternalMcpServerConfigs: () => ({}),
		getInspection: () => ({
			piboSessionId: "ps_codex_skill_collision",
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			sessionGeneration: "generation-skill-collision",
			paths: { root, home: root, skills: skillsRoot, context: root, config: root, protocol: root },
			skills: [{ contributionId: "skill:collision-skill", name: "collision-skill", kind: "user", required: true, sourcePath: selectedSkillPath, materializedPath: selectedSkillPath }],
			context: [], mcpServers: [], delivery: [], diagnostics: [],
		}),
		dispose: async () => {},
	};
	await assert.rejects(
		() => registry.openSession(instanceId, openInput({
			instanceId,
			piboSessionId: "ps_codex_skill_collision",
			workspace,
			profile,
			runtimeBinding: binding(instanceId, "ps_codex_skill_collision"),
			portableTools: undefined,
			resources,
		})),
		/explicit Pibo-skill precedence cannot be guaranteed/,
	);
});

test("Codex native rejects unverified MCP delivery, revokes the scoped credential, and cleans its process generation", async (t) => {
	const root = await fixtureRoot(t);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable failure fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute() {
			return { content: [{ type: "text", text: "unused" }] };
		},
	});
	const instanceId = "codex-native-resource-failure";
	const profile = new InitialSessionContextBuilder("codex-native-resource-failure-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "alpha", definition: alpha })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root),
	});
	const portableService = new PiboPortableToolService();
	t.after(async () => portableService.dispose());
	const portableBase = portableService.createSession({
		piboSessionId: "ps_codex_resource_failure",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		sessionGeneration: "generation-failure",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const portable = trackedPortableSession(portableBase, accesses);
	const resources = {
		piboSessionId: "ps_codex_resource_failure",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		sessionGeneration: "generation-failure",
		getContextContributions: () => [],
		getSkillPaths: () => [],
		getMcpConfigPath: () => undefined,
		getAdapterEnvironment: () => ({ PIBO_CODEX_FIXTURE_RESOURCE_MODE: "omit-mcp" }),
		getExternalMcpServerConfigs: () => ({}),
		getInspection: () => ({
			piboSessionId: "ps_codex_resource_failure",
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			sessionGeneration: "generation-failure",
			skills: [], context: [], mcpServers: [], delivery: [], diagnostics: [],
		}),
		dispose: async () => {},
	};
	const runtimeBinding = binding(instanceId, "ps_codex_resource_failure");
	await assert.rejects(
		() => registry.openSession(instanceId, openInput({
			instanceId,
			piboSessionId: "ps_codex_resource_failure",
			workspace,
			profile,
			runtimeBinding,
			portableTools: portable,
			resources,
		})),
		(error) => /did not initialize every selected MCP server/.test(error.message)
			&& !/Bearer|pibo-mcp|token/i.test(error.message),
	);
	assert.equal(accesses.length, 1);
	await expectCredentialRevoked(accesses[0]);
	portable.dispose();
	const runtimeEntries = await readdir(join(root, "runtime-state"), { recursive: true });
	assert.equal(runtimeEntries.some((entry) => entry.includes("generation-failure")), false);
});
