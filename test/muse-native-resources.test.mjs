import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Type } from "typebox";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import {
	MUSE_NATIVE_ADAPTER_ID,
	MUSE_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../dist/agent-runtimes/muse-native/adapter.js";
import { parseMuseNativeRuntimeConfig } from "../dist/agent-runtimes/muse-native/config.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";
import { definePiboTool } from "../dist/tools/contract.js";
import { PiboPortableToolService } from "../dist/tools/session-service.js";

const fixturePath = fileURLToPath(new URL("./fixtures/muse-serve-fake.mjs", import.meta.url));

async function fixtureRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-muse-native-resources-"));
	const disposers = [];
	t.after(async () => {
		for (const dispose of disposers.splice(0)) await dispose().catch(() => {});
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	await chmod(fixturePath, 0o755);
	const fakeStateDir = join(root, "fake-state");
	process.env.MUSE_FAKE_STATE_DIR = fakeStateDir;
	return { root, fakeStateDir, workspace: join(root, "workspace"), disposers };
}

function runtimeConfig(root) {
	const allowlist = process.platform === "win32"
		? ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "MUSE_FAKE_STATE_DIR"]
		: ["PATH", "MUSE_FAKE_STATE_DIR"];
	return parseMuseNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: allowlist,
		diagnosticTimeoutMs: 2_000,
		startupTimeoutMs: process.platform === "win32" ? 15_000 : 5_000,
		requestTimeoutMs: 10_000,
		shutdownTimeoutMs: 500,
	});
}

function trackedPortableSession(session, accesses, renewals) {
	return {
		...session,
		issueMcpAccess: async (...args) => {
			const access = await session.issueMcpAccess(...args);
			accesses.push(access);
			return access;
		},
		renewMcpAccess: (...args) => {
			renewals.count += 1;
			return session.renewMcpAccess(...args);
		},
		revokeMcpAccess: (...args) => session.revokeMcpAccess(...args),
		dispose: () => session.dispose(),
	};
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

test("Muse native delivers portable tools and external MCP servers through session config", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const stdioServerPath = join(root, "selected-stdio-server.mjs");
	await writeFile(stdioServerPath, "process.exit(0);\n");
	const mcpConfigPath = join(root, "mcp-servers.json");
	await writeFile(mcpConfigPath, `${JSON.stringify({
		mcpServers: {
			external: {
				url: "http://127.0.0.1:49191/mcp",
				headers: { Authorization: "Bearer ${EXTERNAL_TOKEN}" },
				allowedTools: ["external_lookup"],
			},
			"external-stdio": {
				command: process.execPath,
				args: [stdioServerPath],
				env: { STDIO_SECRET: "${STDIO_TOKEN}" },
				allowedTools: ["stdio_lookup"],
			},
			unselected: {
				url: "http://127.0.0.1:49192/mcp",
			},
		},
	}, null, 2)}\n`);

	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Portable Muse resource fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			return { content: [{ type: "text", text: `${context.piboSessionId}:${input.value}` }] };
		},
	});
	const instanceId = "muse-native-resources";
	const profile = new InitialSessionContextBuilder("muse-native-resources-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "alpha", definition: alpha })
		.withMcpServers(["external", "external-stdio"])
		.createSession();

	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Resources",
		config: runtimeConfig(root),
	});
	assert.deepEqual(adapter.descriptor.capabilities.tools.piboManaged, { support: "mcp", transports: ["streamable-http"] });
	assert.deepEqual(adapter.descriptor.capabilities.mcp.externalServers, { support: "mcp", transports: ["streamable-http", "stdio"] });
	assert.equal(adapter.descriptor.capabilities.skills.support, "unsupported");
	assert.equal(adapter.descriptor.capabilities.context.support, "unsupported");
	assert.equal(adapter.descriptor.capabilities.nativeSubagents.supported, false);

	const portableService = new PiboPortableToolService();
	disposers.push(async () => portableService.dispose());
	const resourceService = new PiboRuntimeResourceService({
		rootDir: join(root, "resource-generations"),
		mcpConfigPath,
		environment: {
			...process.env,
			EXTERNAL_TOKEN: "external-session-secret",
			STDIO_TOKEN: "stdio-environment-secret",
		},
		async verifyMcpServer() {
			return {
				status: "connected",
				serverName: "external-fixture",
				serverVersion: "1.0.0",
				protocolVersion: "2025-11-25",
				tools: [],
				resources: [],
				resourceTemplates: [],
			};
		},
	});
	const piboSessionId = "ps_muse_resources";
	const portableBase = portableService.createSession({
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-one",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const renewals = { count: 0 };
	const portableTools = trackedPortableSession(portableBase, accesses, renewals);
	const resources = await resourceService.createSession({
		piboSessionId,
		piboRoomId: "room_muse_resources",
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-one",
		profile,
		cwd: workspace,
		timezone: "UTC",
		capabilities: adapter.descriptor.capabilities,
		strict: true,
	});
	const piboSession = createPiboSession({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace,
	});
	const session = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: {
			piboSessionId,
			runtimeInstanceId: instanceId,
			adapterId: MUSE_NATIVE_ADAPTER_ID,
			state: "unbound",
			revision: 1,
		},
		workspace,
		productContext: { piboSessionId },
		services: { portableTools, resources },
	});
	disposers.push(() => session.dispose());

	assert.equal(accesses.length, 1);
	const [access] = accesses;
	assert.deepEqual(access.allowedToolNames, ["alpha"]);
	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	const delivered = state.startRequests.at(-1).config.mcpServers;
	assert.equal(delivered["pibo-session-tools"].transport, "streamableHttp");
	assert.equal(delivered["pibo-session-tools"].url, access.url);
	assert.equal(delivered["pibo-session-tools"].headers.authorization, "Bearer ${PIBO_MUSE_NATIVE_TOOL_TOKEN}");
	assert.equal(delivered.external.transport, "streamableHttp");
	assert.equal(delivered.external.url, "http://127.0.0.1:49191/mcp");
	assert.equal(delivered["external-stdio"].transport, "stdio");
	assert.equal(delivered["external-stdio"].command, process.execPath);
	assert.equal("unselected" in delivered, false);
	const deliveredJson = JSON.stringify(delivered);
	assert.equal(deliveredJson.includes("external-session-secret"), false);
	assert.equal(deliveredJson.includes("stdio-environment-secret"), false);
	assert.equal(deliveredJson.includes(access.token), false);
	const expectedScopedKeys = resources.getInspection().mcpServers.flatMap((server) => server.secretEnvironmentKeys ?? []);
	assert.ok(expectedScopedKeys.length >= 2);
	for (const key of expectedScopedKeys) assert.equal(deliveredJson.includes(`\${${key}}`), true);
	const hostScopedKeys = state.startRequests.at(-1).hostEnvScopedMcpKeys;
	for (const key of expectedScopedKeys) assert.equal(hostScopedKeys.includes(key), true);
	assert.ok(state.startRequests.at(-1).hostEnvPiboKeys.includes("PIBO_MUSE_NATIVE_TOOL_TOKEN"));

	await session.prompt({ text: "use the alpha tool", source: "interactive" });
	assert.ok(renewals.count >= 1);
	assert.ok(session.getStatus().enabledTools.includes("alpha"));

	await session.dispose();
	await expectCredentialRevoked(access);
});

test("Muse native opens without MCP config when no tools or servers are selected", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const instanceId = "muse-native-no-resources";
	const profile = new InitialSessionContextBuilder("muse-native-no-resources-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native No Resources",
		config: runtimeConfig(root),
	});
	const piboSession = createPiboSession({
		id: "ps_muse_no_resources",
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace,
	});
	const session = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: {
			piboSessionId: piboSession.id,
			runtimeInstanceId: instanceId,
			adapterId: MUSE_NATIVE_ADAPTER_ID,
			state: "unbound",
			revision: 1,
		},
		workspace,
		productContext: { piboSessionId: piboSession.id },
	});
	disposers.push(() => session.dispose());
	await session.prompt({ text: "plain turn", source: "interactive" });
	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	assert.equal(state.startRequests.at(-1).config, null);
	assert.deepEqual(session.getStatus().enabledTools, []);
});
