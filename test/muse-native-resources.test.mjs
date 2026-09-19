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
	MUSE_DELIVERED_RESOURCE_HASH_KEY,
	MUSE_NATIVE_ADAPTER_ID,
	MUSE_NATIVE_AGENT_RUNTIME_DRIVER,
	matchMuseNativeSkillSelector,
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
	assert.deepEqual(adapter.descriptor.capabilities.skills, {
		support: "degraded",
		mode: "muse-turn-prefix",
		reason: "Muse 1.3.0 exposes skills only as a read-only host catalog with no delivery seam; selected Pibo skills are injected as text into the first turn, and host-catalog matches stay invocable by selector.",
	});
	assert.deepEqual(adapter.descriptor.capabilities.context, {
		support: "degraded",
		mode: "muse-turn-prefix",
		reason: "Muse 1.3.0 session config carries only MCP servers; selected Pibo context is injected as text into the first turn.",
	});
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
	assert.equal(delivered["pibo-session-tools"].headers.authorization, `Bearer ${access.token}`);
	assert.equal(delivered.external.transport, "streamableHttp");
	assert.equal(delivered.external.url, "http://127.0.0.1:49191/mcp");
	assert.equal(delivered["external-stdio"].transport, "stdio");
	assert.equal(delivered["external-stdio"].command, process.execPath);
	assert.equal("unselected" in delivered, false);
	const deliveredJson = JSON.stringify(delivered);
	// The host sends headers verbatim, so references arrive resolved.
	assert.equal(deliveredJson.includes("external-session-secret"), true);
	assert.equal(deliveredJson.includes("stdio-environment-secret"), true);
	assert.equal(deliveredJson.includes(access.token), true);
	assert.equal(deliveredJson.includes("${"), false);
	const expectedScopedKeys = resources.getInspection().mcpServers.flatMap((server) => server.secretEnvironmentKeys ?? []);
	assert.ok(expectedScopedKeys.length >= 2);
	const hostScopedKeys = state.startRequests.at(-1).hostEnvScopedMcpKeys;
	for (const key of expectedScopedKeys) assert.equal(hostScopedKeys.includes(key), true);
	assert.ok(state.startRequests.at(-1).hostEnvPiboKeys.includes("PIBO_MUSE_NATIVE_TOOL_TOKEN"));

	await session.prompt({ text: "use the alpha tool", source: "interactive" });
	assert.ok(renewals.count >= 1);
	assert.ok(session.getStatus().enabledTools.includes("alpha"));

	await session.dispose();
	await expectCredentialRevoked(access);
});

test("Muse native re-delivers fresh portable-tool credentials on resume", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const beta = definePiboTool({
		name: "beta",
		title: "Beta",
		description: "Portable Muse resume fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			return { content: [{ type: "text", text: `${context.piboSessionId}:${input.value}` }] };
		},
	});
	const instanceId = "muse-native-resume-delivery";
	const profile = new InitialSessionContextBuilder("muse-native-resume-delivery-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "beta", definition: beta })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Resume Delivery",
		config: runtimeConfig(root),
	});
	const portableService = new PiboPortableToolService();
	disposers.push(async () => portableService.dispose());
	const piboSessionId = "ps_muse_resume_delivery";
	const portableBase = portableService.createSession({
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-resume",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const portableTools = trackedPortableSession(portableBase, accesses, { count: 0 });
	const piboSession = createPiboSession({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace,
	});
	const first = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: { piboSessionId, runtimeInstanceId: instanceId, adapterId: MUSE_NATIVE_ADAPTER_ID, state: "unbound", revision: 1 },
		workspace,
		productContext: { piboSessionId },
		services: { portableTools },
	});
	const binding = first.getBinding();
	assert.equal(binding.state, "bound");
	await first.dispose();

	const second = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding,
		workspace,
		productContext: { piboSessionId },
		services: { portableTools },
	});
	disposers.push(() => second.dispose());
	assert.equal(second.getBinding().nativeSessionId, binding.nativeSessionId);
	assert.equal(accesses.length, 2);
	assert.notEqual(accesses[1].token, accesses[0].token);
	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	const resumed = state.resumeRequests.at(-1).config.mcpServers;
	assert.equal(resumed["pibo-session-tools"].headers.authorization, `Bearer ${accesses[1].token}`);
	assert.ok(second.getStatus().enabledTools.includes("beta"));
});

test("Muse native repeats resource warnings only on change", async (t) => {
	const { root, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const gamma = definePiboTool({
		name: "gamma",
		title: "Gamma",
		description: "Portable Muse warning fixture",
		inputSchema: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			return { content: [{ type: "text", text: `${context.piboSessionId}:${input.value}` }] };
		},
	});
	const instanceId = "muse-native-warn-dedup";
	const profile = new InitialSessionContextBuilder("muse-native-warn-dedup-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addTool({ name: "gamma", definition: gamma })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Warn Dedup",
		config: runtimeConfig(root),
	});
	const portableService = new PiboPortableToolService();
	disposers.push(async () => portableService.dispose());
	const piboSessionId = "ps_muse_warn_dedup";
	const portableBase = portableService.createSession({
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-warn",
		profile,
		cwd: workspace,
	});
	const accesses = [];
	const portableTools = trackedPortableSession(portableBase, accesses, { count: 0 });
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
		binding: { piboSessionId, runtimeInstanceId: instanceId, adapterId: MUSE_NATIVE_ADAPTER_ID, state: "unbound", revision: 1 },
		workspace,
		productContext: { piboSessionId },
		services: { portableTools },
	});
	disposers.push(() => session.dispose());
	portableBase.revokeMcpAccess(accesses[0].token);
	const realNow = Date.now();
	t.mock.timers.enable({ apis: ["Date"], now: realNow });
	t.mock.timers.tick(6 * 60 * 1000);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "one", source: "interactive" });
	await session.prompt({ text: "two", source: "interactive" });
	const expired = events.filter((event) => event.type === "warning" && event.details?.code === "muse_native_tool_credential_expired");
	assert.equal(expired.length, 1);
});

test("Muse native matches host skill selectors by bare or qualified name", () => {
	assert.equal(matchMuseNativeSkillSelector(["fix-bug", "acme:deploy"], "fix-bug"), "fix-bug");
	assert.equal(matchMuseNativeSkillSelector(["fix-bug", "acme:deploy"], "deploy"), "acme:deploy");
	assert.equal(matchMuseNativeSkillSelector(["Acme:Deploy"], "deploy"), "Acme:Deploy");
	assert.equal(matchMuseNativeSkillSelector(["fix-bug"], "bug"), undefined);
	assert.equal(matchMuseNativeSkillSelector([], "fix-bug"), undefined);
	assert.equal(matchMuseNativeSkillSelector(["fix-bug"], "  "), undefined);
});

test("Muse native injects selected skills and context into the first turn only", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const nativeSkillDir = join(workspace, "skills", "native-echo");
	const localSkillDir = join(workspace, "skills", "local-notes");
	await mkdir(nativeSkillDir, { recursive: true });
	await mkdir(localSkillDir, { recursive: true });
	await writeFile(join(nativeSkillDir, "SKILL.md"), "# native-echo\n\nNative echo skill body.\n");
	await writeFile(join(localSkillDir, "SKILL.md"), "# local-notes\n\nLocal notes skill body.\n");
	await writeFile(join(localSkillDir, "helper.txt"), "undelivered helper\n");
	await writeFile(join(workspace, "selected.md"), "# Selected context\n\nSelected muse context body.\n");
	await mkdir(fakeStateDir, { recursive: true });
	await writeFile(join(fakeStateDir, "skill-catalog.json"), JSON.stringify({
		skills: [{ selector: "native-echo", displayName: "Native Echo", description: "host copy", source: "project" }],
	}));
	const instanceId = "muse-native-turn-prefix";
	const profile = new InitialSessionContextBuilder("muse-native-turn-prefix-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "native-echo", path: join(nativeSkillDir, "SKILL.md"), kind: "user" })
		.addSkill({ name: "local-notes", path: join(localSkillDir, "SKILL.md"), kind: "user" })
		.addContextFile({ key: "selected-muse-context", label: "Selected Muse Context", path: "selected.md", source: "managed" })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Turn Prefix",
		config: runtimeConfig(root),
	});
	const resourceService = new PiboRuntimeResourceService({ rootDir: join(root, "resource-generations") });
	const piboSessionId = "ps_muse_turn_prefix";
	const resources = await resourceService.createSession({
		piboSessionId,
		piboRoomId: "room_muse_turn_prefix",
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-prefix",
		profile,
		cwd: workspace,
		timezone: "UTC",
		capabilities: adapter.descriptor.capabilities,
		strict: true,
	});
	const piboSession = createPiboSession({ id: piboSessionId, channel: "test", kind: "chat", profile: profile.profileName, workspace });
	const session = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: { piboSessionId, runtimeInstanceId: instanceId, adapterId: MUSE_NATIVE_ADAPTER_ID, state: "unbound", revision: 1 },
		workspace,
		productContext: { piboSessionId },
		services: { resources },
	});
	disposers.push(() => session.dispose());

	const inspection = resources.getInspection();
	const reportById = new Map(inspection.delivery.map((report) => [report.contributionId, report]));
	assert.deepEqual(reportById.get("skill:native-echo"), {
		contributionId: "skill:native-echo",
		status: "degraded",
		mode: "muse-turn-prefix",
		fidelity: "equivalent",
		target: join(nativeSkillDir, "SKILL.md"),
	});
	const localReport = reportById.get("skill:local-notes");
	assert.equal(localReport.status, "degraded");
	assert.equal(localReport.mode, "muse-turn-prefix");
	assert.equal(localReport.fidelity, "lossy");
	assert.match(localReport.diagnostic, /helper\.txt/);
	const contextReport = reportById.get("context:selected-muse-context");
	assert.equal(contextReport.status, "degraded");
	assert.equal(contextReport.mode, "muse-turn-prefix");
	assert.ok(inspection.diagnostics.some((diagnostic) =>
		diagnostic.code === "muse_native_skill_catalog_match" && diagnostic.contributionId === "skill:native-echo"));
	assert.ok(inspection.diagnostics.some((diagnostic) =>
		diagnostic.code === "muse_native_skill_siblings_undelivered" && diagnostic.contributionId === "skill:local-notes"));

	await session.prompt({ text: "first", source: "interactive" });
	await session.prompt({ text: "second", source: "interactive" });
	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	assert.equal(state.turnStartRequests.length, 2);
	const [firstTurn, secondTurn] = state.turnStartRequests;
	assert.match(firstTurn.text, /# Pibo-Selected Skills/);
	assert.match(firstTurn.text, /Native echo skill body\./);
	assert.match(firstTurn.text, /Local notes skill body\./);
	assert.match(firstTurn.text, /# Pibo-Selected Context/);
	assert.match(firstTurn.text, /Selected muse context body\./);
	assert.equal(firstTurn.text.endsWith("first"), true);
	assert.equal(firstTurn.displayText, "first");
	assert.equal(secondTurn.text, "second");
	assert.match(session.getBinding().metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY], /^[0-9a-f]{64}$/);
});

test("Muse native skips injection on unchanged resume and re-injects on changed selection", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const skillDir = join(workspace, "skills", "resume-skill");
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), "# resume-skill\n\nResume skill body.\n");
	const contextPath = join(workspace, "resume.md");
	await writeFile(contextPath, "resume context v1\n");
	const instanceId = "muse-native-prefix-resume";
	const profile = new InitialSessionContextBuilder("muse-native-prefix-resume-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "resume-skill", path: join(skillDir, "SKILL.md"), kind: "user" })
		.addContextFile({ key: "resume-context", label: "Resume Context", path: "resume.md", source: "managed" })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Prefix Resume",
		config: runtimeConfig(root),
	});
	const resourceService = new PiboRuntimeResourceService({ rootDir: join(root, "resource-generations") });
	disposers.push(() => resourceService.dispose());
	const piboSessionId = "ps_muse_prefix_resume";
	const piboSession = createPiboSession({ id: piboSessionId, channel: "test", kind: "chat", profile: profile.profileName, workspace });
	const openResources = (generation) => resourceService.createSession({
		piboSessionId,
		piboRoomId: "room_muse_prefix_resume",
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: generation,
		profile,
		cwd: workspace,
		timezone: "UTC",
		capabilities: adapter.descriptor.capabilities,
		strict: true,
	});

	const first = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: { piboSessionId, runtimeInstanceId: instanceId, adapterId: MUSE_NATIVE_ADAPTER_ID, state: "unbound", revision: 1 },
		workspace,
		productContext: { piboSessionId },
		services: { resources: await openResources("resource-generation-resume-one") },
	});
	await first.prompt({ text: "one", source: "interactive" });
	const bound = first.getBinding();
	assert.match(bound.metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY], /^[0-9a-f]{64}$/);
	await first.dispose();

	const second = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: bound,
		workspace,
		productContext: { piboSessionId },
		services: { resources: await openResources("resource-generation-resume-two") },
	});
	await second.prompt({ text: "two", source: "interactive" });
	const rebound = second.getBinding();
	assert.equal(rebound.metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY], bound.metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY]);
	await second.dispose();

	await writeFile(contextPath, "resume context v2\n");
	const third = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding: rebound,
		workspace,
		productContext: { piboSessionId },
		services: { resources: await openResources("resource-generation-resume-three") },
	});
	disposers.push(() => third.dispose());
	await third.prompt({ text: "three", source: "interactive" });

	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	assert.equal(state.turnStartRequests.length, 3);
	const [firstTurn, secondTurn, thirdTurn] = state.turnStartRequests;
	assert.match(firstTurn.text, /Resume skill body\./);
	assert.match(firstTurn.text, /resume context v1/);
	assert.equal(secondTurn.text, "two");
	assert.match(thirdTurn.text, /replaces the earlier injected/);
	assert.match(thirdTurn.text, /resume context v2/);
	assert.equal(thirdTurn.text.endsWith("three"), true);
	assert.notEqual(
		third.getBinding().metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY],
		bound.metadata[MUSE_DELIVERED_RESOURCE_HASH_KEY],
	);
});

test("Muse native opens when skill/list verification fails", async (t) => {
	const { root, fakeStateDir, workspace, disposers } = await fixtureRoot(t);
	await mkdir(workspace, { recursive: true });
	const skillDir = join(workspace, "skills", "unverified-skill");
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), "# unverified-skill\n\nUnverified skill body.\n");
	const instanceId = "muse-native-prefix-unverified";
	const profile = new InitialSessionContextBuilder("muse-native-prefix-unverified-profile")
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "unverified-skill", path: join(skillDir, "SKILL.md"), kind: "user" })
		.createSession();
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Prefix Unverified",
		config: { ...runtimeConfig(root), requestTimeoutMs: 2_000 },
	});
	const resourceService = new PiboRuntimeResourceService({ rootDir: join(root, "resource-generations") });
	const piboSessionId = "ps_muse_prefix_unverified";
	const resources = await resourceService.createSession({
		piboSessionId,
		piboRoomId: "room_muse_prefix_unverified",
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		sessionGeneration: "resource-generation-unverified",
		profile,
		cwd: workspace,
		timezone: "UTC",
		capabilities: adapter.descriptor.capabilities,
		strict: true,
	});
	const piboSession = createPiboSession({ id: piboSessionId, channel: "test", kind: "chat", profile: profile.profileName, workspace });
	await mkdir(fakeStateDir, { recursive: true });
	await writeFile(join(fakeStateDir, "hang-methods.json"), JSON.stringify(["skill/list"]));
	let session;
	try {
		session = await registry.openSession(instanceId, {
			piboSession,
			profile,
			binding: { piboSessionId, runtimeInstanceId: instanceId, adapterId: MUSE_NATIVE_ADAPTER_ID, state: "unbound", revision: 1 },
			workspace,
			productContext: { piboSessionId },
			services: { resources },
		});
	} finally {
		await rm(join(fakeStateDir, "hang-methods.json"), { force: true });
	}
	disposers.push(() => session.dispose());
	assert.ok(resources.getInspection().diagnostics.some((diagnostic) =>
		diagnostic.code === "muse_native_skill_catalog_unverified"));
	await session.prompt({ text: "hello", source: "interactive" });
	const state = JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
	assert.match(state.turnStartRequests.at(-1).text, /Unverified skill body\./);
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
