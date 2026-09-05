import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
	InitialSessionContextBuilder,
	PiboRuntimeResourceError,
	PiboRuntimeResourceService,
	createMinimalAgentRuntimeCapabilities,
	createPiboRuntime,
	definePiboPlugin,
	PiboPluginRegistry,
	PiboSessionRouter,
	InMemoryPiboSessionStore,
	piboCorePlugin,
} from "../dist/index.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { PI_AGENT_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/pi/adapter.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

const fixtureServerSource = String.raw`
if (process.env.FIXTURE_SECRET !== "session-secret") {
  process.stderr.write("missing scoped secret\n");
  process.exit(12);
}
if (process.env.PIBO_UNRELATED_GATEWAY_SECRET) {
  process.stderr.write("unrelated gateway environment leaked\n");
  process.exit(13);
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n");
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});
function send(value) { process.stdout.write(JSON.stringify(value) + "\n"); }
function result(id, value) { send({ jsonrpc: "2.0", id, result: value }); }
function error(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "resource-fixture", version: "1.2.3" },
      instructions: "Use the scoped resource fixture.",
    });
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, { tools: [{ name: "echo", description: "Scoped echo", inputSchema: { type: "object", properties: {} } }] });
    return;
  }
  if (message.method === "resources/list") {
    result(message.id, { resources: [{ uri: "fixture://document", name: "Fixture document", mimeType: "text/plain" }] });
    return;
  }
  if (message.method === "resources/templates/list") {
    result(message.id, { resourceTemplates: [{ uriTemplate: "fixture://{id}", name: "Fixture template" }] });
    return;
  }
  error(message.id, -32601, "method not found: " + message.method);
}
`;

function findNode(nodes, predicate) {
	for (const node of nodes) {
		if (predicate(node)) return node;
		const nested = findNode(node.children ?? [], predicate);
		if (nested) return nested;
	}
	return undefined;
}

function materializedCapabilities() {
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.skills = { support: "materialized", modes: ["isolated-directory"] };
	capabilities.context = { support: "materialized", modes: ["isolated-files"] };
	capabilities.mcp.externalServers = { support: "materialized", modes: ["isolated-config"] };
	capabilities.mcp.statusInspection = true;
	return capabilities;
}

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-resources-"));
	const workspace = join(root, "workspace");
	const selectedSkillDir = join(workspace, "skills", "selected");
	const unselectedSkillDir = join(workspace, "skills", "unselected");
	await mkdir(join(selectedSkillDir, "references"), { recursive: true });
	await mkdir(unselectedSkillDir, { recursive: true });
	await writeFile(join(selectedSkillDir, "SKILL.md"), "---\nname: selected\ndescription: selected skill\n---\n\n# Selected\n");
	await writeFile(join(selectedSkillDir, "references", "guide.md"), "selected reference\n");
	await writeFile(join(unselectedSkillDir, "SKILL.md"), "# Unselected\n");
	await writeFile(join(workspace, "selected-context.md"), "# Selected context\n");
	await writeFile(join(workspace, "unselected-context.md"), "# Unselected context\n");
	const serverPath = join(root, "fixture-mcp-server.mjs");
	const configPath = join(root, "mcp_servers.json");
	await writeFile(serverPath, fixtureServerSource);
	await writeFile(configPath, `${JSON.stringify({
		mcpServers: {
			selected: {
				command: process.execPath,
				args: [serverPath],
				env: { FIXTURE_SECRET: "${SOURCE_SECRET}" },
				pibo: { description: "Selected deterministic MCP fixture.", descriptionSource: "user" },
			},
			unselected: {
				command: process.execPath,
				args: [serverPath],
				env: { FIXTURE_SECRET: "literal-unselected-secret" },
			},
		},
	}, null, 2)}\n`);
	return { root, workspace, selectedSkillDir, unselectedSkillDir, configPath };
}

test("portable delegated sessions require delivery of generated management context", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-delegated-context-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const profile = new InitialSessionContextBuilder("portable-delegated")
		.withAgentRuntime("portable-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSubagent({ name: "worker", targetProfile: "base" })
		.createSession();
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };

	await assert.rejects(
		service.createSession({
			piboSessionId: "ps_portable_delegated",
			runtimeInstanceId: "portable-runtime",
			adapterId: "portable",
			sessionGeneration: "generation-one",
			profile,
			cwd: root,
			capabilities,
		}),
		(error) => error instanceof PiboRuntimeResourceError
			&& /does not provide this capability/.test(error.message),
	);
});

test("runtime resources isolate selected skills, context, MCP config, secrets, and verified inventory", async (t) => {
	const fixture = await createFixture();
	t.after(async () => rm(fixture.root, { recursive: true, force: true }));
	const previousUnrelatedSecret = process.env.PIBO_UNRELATED_GATEWAY_SECRET;
	process.env.PIBO_UNRELATED_GATEWAY_SECRET = "must-not-reach-mcp";
	t.after(() => {
		if (previousUnrelatedSecret === undefined) delete process.env.PIBO_UNRELATED_GATEWAY_SECRET;
		else process.env.PIBO_UNRELATED_GATEWAY_SECRET = previousUnrelatedSecret;
	});
	const generationRoot = join(fixture.root, "generations");
	const sourceConfigBefore = await readFile(fixture.configPath, "utf8");
	const profile = new InitialSessionContextBuilder("materialized-profile")
		.withAgentRuntime("external-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "selected", path: join(fixture.selectedSkillDir, "SKILL.md"), kind: "user" })
		.addContextFile({ key: "selected-context", path: "selected-context.md", source: "managed" })
		.addSubagent({ name: "worker", description: "Perform delegated work.", targetProfile: "worker-profile" })
		.withMcpServers(["selected"])
		.createSession();
	const service = new PiboRuntimeResourceService({
		rootDir: generationRoot,
		mcpConfigPath: fixture.configPath,
		environment: { ...process.env, SOURCE_SECRET: "session-secret" },
	});
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_resources",
		piboRoomId: "room_resources",
		runtimeInstanceId: "external-runtime",
		adapterId: "external",
		sessionGeneration: "generation-one",
		profile,
		cwd: fixture.workspace,
		timezone: "UTC",
		capabilities: materializedCapabilities(),
	});

	const inspection = session.getInspection();
	assert.ok(inspection.paths);
	assert.equal(inspection.skills.length, 1);
	assert.equal(inspection.skills[0].name, "selected");
	assert.ok(inspection.skills[0].materializedPath);
	assert.equal(await readFile(inspection.skills[0].materializedPath, "utf8"), "---\nname: selected\ndescription: selected skill\n---\n\n# Selected\n");
	assert.equal(await readFile(join(inspection.paths.skills, basename(dirname(inspection.skills[0].materializedPath)), "references", "guide.md"), "utf8"), "selected reference\n");
	assert.equal(JSON.stringify(inspection).includes("unselected"), false);

	const context = session.getContextContributions();
	assert.ok(context.some((item) => item.id === "context:pibo-session" && item.content.includes("ps_resources")));
	assert.ok(context.some((item) => item.id === "context:selected-context" && item.content === "# Selected context\n"));
	const delegatedContext = context.find((item) => item.id === "context:delegated-agents");
	assert.equal(delegatedContext.required, true);
	assert.match(delegatedContext.content, /`worker`/);
	assert.match(delegatedContext.content, /pibo_run_start/);
	assert.match(delegatedContext.content, /pibo_agents_observe/);
	assert.equal(context.some((item) => item.content?.includes("Unselected context")), false);
	assert.ok(context.filter((item) => item.content !== undefined).every((item) => item.materializedPath));

	const scopedConfigPath = session.getMcpConfigPath();
	assert.ok(scopedConfigPath);
	const scopedConfigText = await readFile(scopedConfigPath, "utf8");
	assert.match(scopedConfigText, /"selected"/);
	assert.doesNotMatch(scopedConfigText, /"unselected"/);
	assert.doesNotMatch(scopedConfigText, /session-secret|literal-unselected-secret/);
	assert.match(scopedConfigText, /\$\{PIBO_RUNTIME_MCP_/);
	const adapterEnvironment = session.getAdapterEnvironment();
	assert.equal(adapterEnvironment.MCP_CONFIG_PATH, scopedConfigPath);
	assert.equal(adapterEnvironment.MCP_NO_DAEMON, "1");
	assert.equal(adapterEnvironment.PIBO_MCP_ISOLATED_ENV, "1");
	assert.equal(adapterEnvironment.PIBO_UNRELATED_GATEWAY_SECRET, undefined);
	assert.ok(Object.values(adapterEnvironment).includes("session-secret"));
	assert.equal(JSON.stringify(inspection).includes("session-secret"), false);
	for (const key of inspection.mcpServers[0].secretEnvironmentKeys) assert.equal(process.env[key], undefined);
	if (process.platform === "win32") {
		assertPrivateWindowsAcl(inspection.paths.root, "directory");
		assertPrivateWindowsAcl(scopedConfigPath, "file");
	} else {
		assert.equal((await stat(inspection.paths.root)).mode & 0o777, 0o700);
		assert.equal((await stat(scopedConfigPath)).mode & 0o777, 0o600);
	}

	assert.deepEqual(inspection.mcpServers.map((server) => server.name), ["selected"]);
	assert.equal(inspection.mcpServers[0].status, "connected");
	assert.equal(inspection.mcpServers[0].serverName, "resource-fixture");
	assert.deepEqual(inspection.mcpServers[0].tools.map((tool) => tool.name), ["echo"]);
	assert.deepEqual(inspection.mcpServers[0].resources.map((resource) => resource.uri), ["fixture://document"]);
	assert.deepEqual(inspection.mcpServers[0].resourceTemplates.map((resource) => resource.uriTemplate), ["fixture://{id}"]);
	assert.equal(inspection.mcpServers[0].instructions, "Use the scoped resource fixture.");
	assert.ok(inspection.delivery.every((report) => report.status === "delivered"));
	assert.equal(await readFile(fixture.configPath, "utf8"), sourceConfigBefore);

	const snapshot = await inspectPiboContextBuild({
		cwd: fixture.workspace,
		profile,
		resources: session,
		persistSession: false,
		sessionContext: { piboSessionId: "ps_resources", piboRoomId: "room_resources", timezone: "UTC" },
	});
	const selectedContextNode = findNode(snapshot.nodes, (node) => node.metadata?.contributionId === "context:selected-context");
	const selectedSkillNode = findNode(snapshot.nodes, (node) => node.metadata?.contributionId === "skill:selected");
	const selectedMcpNode = findNode(snapshot.nodes, (node) => node.metadata?.contributionId === "mcp:selected");
	assert.equal(selectedContextNode.metadata.deliveryStatus, "delivered");
	assert.equal(selectedSkillNode.metadata.deliveryMode, "materialized:isolated-directory");
	assert.equal(selectedMcpNode.metadata.serverName, "resource-fixture");
	assert.equal(selectedMcpNode.metadata.toolNames[0], "echo");
	assert.ok(selectedMcpNode.badges.includes("CONNECTED"));

	const piRuntime = await createPiboRuntime({
		cwd: fixture.workspace,
		profile,
		resources: session,
		persistSession: false,
	});
	const scopedBash = piRuntime.session.getToolDefinition("bash");
	assert.ok(scopedBash);
	const scopedCliResult = await scopedBash.execute(
		"scoped-mcp-cli",
		{ command: `${JSON.stringify(process.execPath)} ${JSON.stringify(resolve("dist/bin/pibo.js"))} mcp` },
		undefined,
		undefined,
		{
			sessionManager: piRuntime.session.sessionManager,
			model: piRuntime.session.model,
			thinkingLevel: piRuntime.session.thinkingLevel,
		},
	);
	await piRuntime.dispose();
	assert.match(scopedCliResult.content[0].text, /selected/);
	assert.match(scopedCliResult.content[0].text, /echo/);
	assert.doesNotMatch(scopedCliResult.content[0].text, /unselected/);
	assert.doesNotMatch(scopedCliResult.content[0].text, /session-secret/);

	const generatedRoot = inspection.paths.root;
	await session.dispose();
	assert.equal(existsSync(generatedRoot), false);
	assert.throws(() => session.getInspection(), /disposed/);
});

test("runtime resources expose adapter-observed delivery instead of generic capability guesses", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-adapter-delivery-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	await writeFile(join(workspace, "selected.md"), "# selected\n");
	const profile = new InitialSessionContextBuilder("adapter-delivery")
		.withAgentRuntime("materialized")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "selected", path: "selected.md" })
		.createSession();
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_adapter_delivery",
		runtimeInstanceId: "materialized",
		adapterId: "materialized",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities: materializedCapabilities(),
	});
	const contributionId = "context:selected";
	assert.match(session.getInspection().delivery.find((entry) => entry.contributionId === contributionId)?.mode ?? "", /^materialized:/);
	session.recordAdapterDelivery?.([{
		contributionId,
		status: "delivered",
		mode: "adapter-native-seam",
		fidelity: "exact",
		target: "/private/adapter-target",
	}], [{ severity: "info", code: "adapter_delivery_verified", message: "Adapter delivery was verified.", contributionId }]);
	const inspection = session.getInspection();
	assert.equal(inspection.delivery.filter((entry) => entry.contributionId === contributionId).length, 1);
	assert.equal(inspection.delivery.find((entry) => entry.contributionId === contributionId)?.mode, "adapter-native-seam");
	assert.equal(inspection.delivery.find((entry) => entry.contributionId === contributionId)?.target, "/private/adapter-target");
	assert.ok(inspection.diagnostics.some((entry) => entry.code === "adapter_delivery_verified"));
	assert.throws(() => session.recordAdapterDelivery?.([
		{ contributionId, status: "delivered", mode: "one", fidelity: "exact" },
		{ contributionId, status: "delivered", mode: "two", fidelity: "exact" },
	]), /more than once/);
});

test("native automatic context discovery is independent from Pibo-selected context delivery", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-native-context-only-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const profile = new InitialSessionContextBuilder("native-context-only")
		.withAgentRuntime("native-context-only")
		.withToolPackages({ goalControl: false })
		.createSession();
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.context = { support: "unsupported", reason: "Pibo-selected context is unavailable in this fixture." };
	capabilities.contextDiscovery = {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		knownFileNames: ["AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_native_context_only",
		runtimeInstanceId: "native-context-only",
		adapterId: "native-context-only",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities,
	});
	const report = session.getInspection().delivery.find((entry) => entry.contributionId === "context:automatic-project-files");
	assert.equal(report?.status, "delivered");
	assert.equal(report?.mode, "native-project-discovery");
	assert.deepEqual(session.getInspection().diagnostics, []);
});

test("explicit context remains injectable when configurable native discovery is disabled", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-context-discovery-disabled-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	await writeFile(join(workspace, "AGENTS.md"), "# explicit only\n");
	const profile = new InitialSessionContextBuilder("context-discovery-disabled")
		.withAgentRuntime("pi-like")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "agents", path: "AGENTS.md" })
		.createSession();
	const capabilities = materializedCapabilities();
	capabilities.contextDiscovery = {
		supported: true,
		configurable: true,
		enabledByDefault: true,
		strategy: "filesystem-ancestors",
		knownFileNames: ["AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_context_discovery_disabled",
		runtimeInstanceId: "pi-like",
		adapterId: "pi-like",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities,
	});
	const contribution = session.getContextContributions().find((entry) => entry.id === "context:agents");
	assert.equal(contribution?.nativeDiscovered, undefined);
	assert.ok(contribution?.materializedPath, "explicit AGENTS.md must be delivered when native discovery is off");
});

test("Pi consumes an explicitly selected native context file only through native discovery", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-pi-context-dedup-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	const agentsPath = join(workspace, "AGENTS.md");
	await writeFile(agentsPath, "# Native Pi context\n");
	const profile = new InitialSessionContextBuilder("pi-context-dedup")
		.withAgentRuntime("pi")
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "agents", path: "AGENTS.md" })
		.createSession();
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const resources = await service.createSession({
		piboSessionId: "ps_pi_context_dedup",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities: PI_AGENT_RUNTIME_CAPABILITIES,
	});
	assert.equal(resources.getContextContributions().find((entry) => entry.id === "context:agents")?.nativeDiscovered, true);
	const runtime = await createPiboRuntime({ cwd: workspace, profile, resources, persistSession: false });
	t.after(async () => runtime.dispose());
	const matching = runtime.services.resourceLoader.getAgentsFiles().agentsFiles
		.filter((entry) => resolve(entry.path) === resolve(agentsPath));
	assert.equal(matching.length, 1, "Pi native discovery and Pibo-selected delivery must not duplicate the same source path");
	assert.equal(matching[0]?.content, "# Native Pi context\n");
});

test("runtime resources deduplicate native context through a symlinked workspace", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-symlinked-context-dedup-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspaceRoot = join(root, "workspace");
	const workspace = join(workspaceRoot, "nested");
	const linkedWorkspaceRoot = join(root, "linked-workspace");
	const linkedWorkspace = join(linkedWorkspaceRoot, "nested");
	await mkdir(workspace, { recursive: true });
	await writeFile(join(workspace, "AGENTS.md"), "# Native context through a linked workspace\n");
	await symlink(workspaceRoot, linkedWorkspaceRoot, process.platform === "win32" ? "junction" : "dir");
	const profile = new InitialSessionContextBuilder("linked-context-dedup")
		.withAgentRuntime("pi")
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "agents", path: "AGENTS.md" })
		.createSession();
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const resources = await service.createSession({
		piboSessionId: "ps_linked_context_dedup",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		sessionGeneration: "generation-one",
		profile,
		cwd: linkedWorkspace,
		capabilities: PI_AGENT_RUNTIME_CAPABILITIES,
	});
	const contribution = resources.getContextContributions().find((entry) => entry.id === "context:agents");
	assert.equal(contribution?.nativeDiscovered, true);
	assert.equal(contribution?.materializedPath, undefined);
	assert.equal(contribution?.sourcePath, await realpath(join(workspace, "AGENTS.md")));
});

test("runtime resources deduplicate only the exact native context file selected by runtime precedence", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-context-dedup-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	await writeFile(join(workspace, "AGENTS.md"), "# fallback agents\n");
	await writeFile(join(workspace, "AGENTS.override.md"), "# preferred agents\n");
	await writeFile(join(workspace, "agents.md"), "# lowercase explicit context\n");
	await mkdir(join(workspace, ".omp"), { recursive: true });
	await writeFile(join(workspace, ".omp", "AGENTS.md"), "# runtime-relative native context\n");
	const profile = new InitialSessionContextBuilder("deduplicated-context")
		.withAgentRuntime("codex-like")
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "agents", path: "AGENTS.md" })
		.addContextFile({ key: "override", path: "AGENTS.override.md" })
		.addContextFile({ key: "lowercase", path: "agents.md" })
		.addContextFile({ key: "runtime-relative", path: ".omp/AGENTS.md" })
		.createSession();
	const capabilities = materializedCapabilities();
	capabilities.contextDiscovery = {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		strategy: "codex-project",
		knownFileNames: ["AGENTS.override.md", "AGENTS.md"],
		knownRelativePaths: [".omp/AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_context_dedup",
		runtimeInstanceId: "codex-like",
		adapterId: "codex-like",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities,
	});
	const contributions = session.getContextContributions();
	const fallback = contributions.find((item) => item.id === "context:agents");
	const preferred = contributions.find((item) => item.id === "context:override");
	const lowercase = contributions.find((item) => item.id === "context:lowercase");
	const runtimeRelative = contributions.find((item) => item.id === "context:runtime-relative");
	assert.equal(preferred.nativeDiscovered, true);
	assert.equal(preferred.materializedPath, undefined);
	assert.equal(fallback.nativeDiscovered, undefined, "lower-priority AGENTS.md must still be injected when the native runtime selected its override");
	assert.ok(fallback.materializedPath);
	if (process.platform === "win32") assert.equal(lowercase.nativeDiscovered, undefined, "the override still wins on case-insensitive filesystems");
	else assert.equal(lowercase.nativeDiscovered, undefined, "lowercase filenames are not native Codex context on case-sensitive filesystems");
	assert.equal(runtimeRelative.nativeDiscovered, true);
	assert.equal(runtimeRelative.materializedPath, undefined);
	assert.equal(session.getInspection().delivery.find((report) => report.contributionId === "context:override")?.mode, "native-project-discovery");
});

test("runtime context precedence skips non-file native candidates", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-context-file-precedence-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(join(workspace, "AGENTS.override.md"), { recursive: true });
	await writeFile(join(workspace, "AGENTS.md"), "# native fallback\n");
	const profile = new InitialSessionContextBuilder("context-file-precedence")
		.withAgentRuntime("codex-like")
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "agents", path: "AGENTS.md" })
		.createSession();
	const capabilities = materializedCapabilities();
	capabilities.contextDiscovery = {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		strategy: "codex-project",
		knownFileNames: ["AGENTS.override.md", "AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_context_file_precedence",
		runtimeInstanceId: "codex-like",
		adapterId: "codex-like",
		sessionGeneration: "generation-one",
		profile,
		cwd: workspace,
		capabilities,
	});
	assert.equal(session.getContextContributions().find((entry) => entry.id === "context:agents")?.nativeDiscovered, true);
});

test("runtime context deduplication follows native Codex project-root boundaries", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-codex-context-boundary-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const repository = join(root, "repository");
	const nested = join(repository, "nested");
	await mkdir(join(repository, ".git"), { recursive: true });
	await mkdir(nested, { recursive: true });
	const above = join(root, "AGENTS.md");
	const project = join(repository, "AGENTS.md");
	const nestedFallback = join(nested, "AGENTS.md");
	const nestedOverride = join(nested, "AGENTS.override.md");
	await Promise.all([
		writeFile(above, "# above repository\n"),
		writeFile(project, "# project root\n"),
		writeFile(nestedFallback, "# nested fallback\n"),
		writeFile(nestedOverride, "# nested override\n"),
	]);
	const profile = new InitialSessionContextBuilder("codex-context-boundary")
		.withAgentRuntime("codex-like")
		.withToolPackages({ goalControl: false })
		.addContextFile({ key: "above", path: above })
		.addContextFile({ key: "project", path: project })
		.addContextFile({ key: "nested-fallback", path: nestedFallback })
		.addContextFile({ key: "nested-override", path: nestedOverride })
		.createSession();
	const capabilities = materializedCapabilities();
	capabilities.contextDiscovery = {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		strategy: "codex-project",
		knownFileNames: ["AGENTS.override.md", "AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_codex_context_boundary",
		runtimeInstanceId: "codex-like",
		adapterId: "codex-like",
		sessionGeneration: "generation-one",
		profile,
		cwd: nested,
		capabilities,
	});
	const contributions = new Map(session.getContextContributions().map((entry) => [entry.id, entry]));
	assert.equal(contributions.get("context:project")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:nested-override")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:nested-fallback")?.nativeDiscovered, undefined, "Codex override precedence applies within each directory");
	assert.equal(contributions.get("context:above")?.nativeDiscovered, undefined, "Codex does not walk past the project root");
	assert.ok(contributions.get("context:above")?.materializedPath);
});

test("runtime context deduplication follows OMP cwd-only, nearest, ancestor, and repository boundaries", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-context-relative-dedup-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	const nested = join(workspace, "nested");
	for (const directory of [
		join(workspace, ".git"),
		join(root, ".agent"),
		join(workspace, ".agent"),
		join(nested, ".agent"),
		join(workspace, ".omp"),
		join(nested, ".omp"),
		join(workspace, ".claude"),
		join(nested, ".claude"),
	]) await mkdir(directory, { recursive: true });
	const paths = {
		aboveAgent: join(root, ".agent", "AGENTS.md"),
		rootAgent: join(workspace, ".agent", "AGENTS.md"),
		nestedAgent: join(nested, ".agent", "AGENTS.md"),
		rootOmp: join(workspace, ".omp", "AGENTS.md"),
		nestedOmp: join(nested, ".omp", "AGENTS.md"),
		rootClaude: join(workspace, ".claude", "CLAUDE.md"),
		nestedClaude: join(nested, ".claude", "CLAUDE.md"),
		aboveStandalone: join(root, "AGENTS.md"),
		rootStandalone: join(workspace, "AGENTS.md"),
	};
	await Promise.all(Object.entries(paths).map(([name, path]) => writeFile(path, `# ${name}\n`)));
	const profileBuilder = new InitialSessionContextBuilder("relative-context-dedup")
		.withAgentRuntime("omp-like")
		.withToolPackages({ goalControl: false });
	for (const [key, path] of Object.entries(paths)) profileBuilder.addContextFile({ key, path });
	const profile = profileBuilder.createSession();
	const capabilities = materializedCapabilities();
	capabilities.contextDiscovery = {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		strategy: "omp-project",
		knownFileNames: ["AGENTS.md"],
		knownCwdRelativePaths: [".claude/CLAUDE.md"],
		knownRelativePaths: [".omp/AGENTS.md"],
		knownAncestorRelativePaths: [".agent/AGENTS.md"],
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(async () => service.dispose());
	const session = await service.createSession({
		piboSessionId: "ps_relative_context_dedup",
		runtimeInstanceId: "omp-like",
		adapterId: "omp-like",
		sessionGeneration: "generation-one",
		profile,
		cwd: nested,
		capabilities,
	});
	const contributions = new Map(session.getContextContributions().map((entry) => [entry.id, entry]));
	assert.equal(contributions.get("context:rootAgent")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:nestedAgent")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:aboveAgent")?.nativeDiscovered, undefined, "OMP project agent dirs stop at the repository root");
	assert.equal(contributions.get("context:nestedOmp")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:rootOmp")?.nativeDiscovered, undefined, "only the nearest .omp context is discovered natively");
	assert.equal(contributions.get("context:nestedClaude")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:rootClaude")?.nativeDiscovered, undefined, "Claude project context is cwd-only in OMP");
	assert.equal(contributions.get("context:rootStandalone")?.nativeDiscovered, true);
	assert.equal(contributions.get("context:aboveStandalone")?.nativeDiscovered, undefined, "standalone OMP AGENTS.md discovery stops at the repository root outside home");
	for (const id of ["context:aboveAgent", "context:rootOmp", "context:rootClaude", "context:aboveStandalone"]) {
		assert.ok(contributions.get(id)?.materializedPath, `${id} must remain explicitly injectable`);
	}
});

test("runtime resources reject missing secret references and symlinks that escape a selected skill", async (t) => {
	const fixture = await createFixture();
	t.after(async () => rm(fixture.root, { recursive: true, force: true }));
	const escapingSkillDir = join(fixture.workspace, "skills", "escaping");
	await mkdir(escapingSkillDir, { recursive: true });
	await writeFile(join(escapingSkillDir, "SKILL.md"), "# Escaping\n");
	if (process.platform === "win32") {
		await symlink(fixture.workspace, join(escapingSkillDir, "outside"), "junction");
	} else {
		await symlink(join(fixture.workspace, "unselected-context.md"), join(escapingSkillDir, "outside.md"));
	}
	const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
	config.mcpServers.selected.env.FIXTURE_SECRET = "${MISSING_SECRET}";
	await writeFile(fixture.configPath, JSON.stringify(config));
	const service = new PiboRuntimeResourceService({
		rootDir: join(fixture.root, "generations"),
		mcpConfigPath: fixture.configPath,
		environment: { ...process.env },
	});
	t.after(async () => service.dispose());
	const profile = new InitialSessionContextBuilder("invalid-resources")
		.withAgentRuntime("external-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSkill({ name: "escaping", path: join(escapingSkillDir, "SKILL.md") })
		.withMcpServers(["selected"])
		.createSession();
	await assert.rejects(
		() => service.createSession({
			piboSessionId: "ps_invalid_resources",
			runtimeInstanceId: "external-runtime",
			adapterId: "external",
			sessionGeneration: "generation-invalid",
			profile,
			cwd: fixture.workspace,
			capabilities: materializedCapabilities(),
		}),
		(error) => error instanceof PiboRuntimeResourceError
			&& error.diagnostics.some((diagnostic) => diagnostic.code === "runtime_mcp_configuration_failed")
			&& error.diagnostics.some((diagnostic) => diagnostic.code === "runtime_skill_materialization_failed"),
	);
	assert.equal(existsSync(join(fixture.root, "generations")), true);
	const entries = await readdir(join(fixture.root, "generations"), { recursive: true });
	assert.equal(entries.some((entry) => entry.includes("generation-invalid")), false);
});

test("runtime resources reject selected MCP transports that the adapter cannot deliver", async (t) => {
	const fixture = await createFixture();
	t.after(async () => rm(fixture.root, { recursive: true, force: true }));
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.mcp.externalServers = { support: "mcp", transports: ["streamable-http"] };
	const profile = new InitialSessionContextBuilder("http-only-runtime")
		.withAgentRuntime("http-only-runtime")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.withMcpServers(["selected"])
		.createSession();
	const service = new PiboRuntimeResourceService({
		rootDir: join(fixture.root, "http-only-generations"),
		mcpConfigPath: fixture.configPath,
		environment: { ...process.env, SOURCE_SECRET: "session-secret" },
		async verifyMcpServer() {
			throw new Error("unsupported stdio transport must not be started for verification");
		},
	});
	t.after(async () => service.dispose());
	await assert.rejects(
		() => service.createSession({
			piboSessionId: "ps_http_only",
			runtimeInstanceId: "http-only-runtime",
			adapterId: "external",
			sessionGeneration: "generation-http-only",
			profile,
			cwd: fixture.workspace,
			capabilities,
			strict: true,
		}),
		(error) => error instanceof PiboRuntimeResourceError
			&& /does not support selected MCP transport "stdio"/.test(error.message)
			&& error.diagnostics.some((diagnostic) => diagnostic.code === "runtime_mcp_transport_unsupported"),
	);
});

test("Pi Bash inherits only the router-owned adapter environment without process-global mutation", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-resource-pi-bash-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const profile = new InitialSessionContextBuilder("pi-resource-env")
		.withAgentRuntime("pi")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const resources = {
		piboSessionId: "ps_pi_resource_env",
		runtimeInstanceId: "pi",
		adapterId: "pi",
		sessionGeneration: "generation-pi-env",
		getContextContributions: () => [],
		getSkillPaths: () => [],
		getMcpConfigPath: () => undefined,
		getAdapterEnvironment: () => ({ PIBO_SCOPE_PROOF: "scoped-value" }),
		getExternalMcpServerConfigs: () => ({}),
		getInspection: () => ({
			piboSessionId: "ps_pi_resource_env",
			runtimeInstanceId: "pi",
			adapterId: "pi",
			sessionGeneration: "generation-pi-env",
			skills: [], context: [], mcpServers: [], delivery: [], diagnostics: [],
		}),
		dispose: async () => {},
	};
	assert.equal(process.env.PIBO_SCOPE_PROOF, undefined);
	const runtime = await createPiboRuntime({ cwd: root, persistSession: false, profile, resources });
	t.after(async () => runtime.dispose());
	const bash = runtime.session.getToolDefinition("bash");
	assert.ok(bash);
	const result = await bash.execute(
		"pi-env-proof",
		{ command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write(process.env.PIBO_SCOPE_PROOF || "missing")'` },
		undefined,
		undefined,
		{
			sessionManager: runtime.session.sessionManager,
			model: runtime.session.model,
			thinkingLevel: runtime.session.thinkingLevel,
		},
	);
	assert.equal(result.content[0].text, "scoped-value");
	assert.equal(process.env.PIBO_SCOPE_PROOF, undefined);
});

test("router gives tools and resources one generation and disposes isolated state", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-resource-router-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const skillDir = join(root, "skill");
	const contextPath = join(root, "STATUS-CONTEXT.md");
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), "# Router skill\n");
	await writeFile(contextPath, "# Router context\n");
	const capabilities = materializedCapabilities();
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	const driver = createFakeAgentRuntimeDriver({ adapterId: "resource-router", capabilities });
	const registry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.resource-router",
			register(api) {
				api.registerAgentRuntimeDriver(driver);
				api.registerAgentRuntimeInstance({ id: "resource-router", adapterId: "resource-router" });
				api.registerProfile({
					name: "resource-router-profile",
					create() {
						return new InitialSessionContextBuilder("resource-router-profile")
							.withAgentRuntime("resource-router")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.addSkill({ name: "router-skill", path: join(skillDir, "SKILL.md") })
							.addContextFile({ key: "status-context", path: contextPath })
							.createSession();
					},
				});
			},
		})],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_resource_router",
		channel: "test",
		kind: "chat",
		profile: "resource-router-profile",
		workspace: root,
		runtimeBinding: { runtimeInstanceId: "resource-router", adapterId: "resource-router", state: "unbound" },
	});
	const resourceService = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
		runtimeResourceService: resourceService,
	});
	await router.emit({ type: "execution", piboSessionId: "ps_resource_router", action: "status" });
	const status = await router.getSessionStatusSnapshot("ps_resource_router");
	assert.deepEqual(status.enabledSkills, ["router-skill"]);
	assert.ok(status.contextFiles.includes(contextPath));
	const adapter = registry.requireAgentRuntimeAdapter("resource-router");
	const openInput = adapter.openInputs[0];
	assert.ok(openInput.services.resources);
	assert.ok(openInput.services.portableTools);
	assert.equal(openInput.services.resources.sessionGeneration, openInput.services.portableTools.sessionGeneration);
	const generatedRoot = openInput.services.resources.getInspection().paths.root;
	assert.equal(existsSync(generatedRoot), true);
	await router.disposeSession("ps_resource_router", "test deletion");
	assert.equal(existsSync(generatedRoot), false);
	assert.throws(() => openInput.services.resources.getInspection(), /disposed/);
	assert.throws(() => openInput.services.portableTools.createDefinitions(), /disposed/);
	await router.disposeAll();
});
