import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { load } from "js-yaml";
import { parseOmpRuntimeConfig } from "../dist/agent-runtimes/omp/config.js";
import { prepareOmpSessionPaths, buildOmpProcessEnvironment, resetOmpNativeSession, resolveOmpCommand } from "../dist/agent-runtimes/omp/process.js";
import { OmpResourceDelivery } from "../dist/agent-runtimes/omp/resource-delivery.js";
import { OMP_AGENT_RUNTIME_DRIVER, OMP_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/omp/adapter.js";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

function sessionPaths(config, agentDir) {
	return prepareOmpSessionPaths({ config, runtimeInstanceId: "omp-native", piboSessionId: "sess", sessionGeneration: "gen" });
}

function fakeResources(skillPaths, contributions) {
	return {
		piboSessionId: "sess",
		runtimeInstanceId: "omp-native",
		adapterId: "orp",
		sessionGeneration: "gen",
		getContextContributions() {
			return contributions ?? [];
		},
		getSkillPaths() {
			return skillPaths ?? [];
		},
		getMcpConfigPath() {
			return undefined;
		},
		getAdapterEnvironment() {
			return {};
		},
		getExternalMcpServerConfigs() {
			return {};
		},
		getInspection() {
			return {};
		},
		dispose() {
			return Promise.resolve();
		},
	};
}

test("OMP resource-delivery writes additive context and passes it through --append-system-prompt", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-res-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	await mkdir(workspace);
	await writeFile(join(workspace, "existing.txt"), "unchanged\n");
	const config = parseOmpRuntimeConfig({ bunExecutable: "bun", ompEntry: "/opt/omp/src/cli.ts", homeRoot: root });
	const paths = await sessionPaths(config, root);
	const resources = fakeResources([join(root, "skills", "pibo", "skill-a", "SKILL.md")], [
		{ id: "context:1", kind: "context-file", source: "profile", intent: "developer", label: "CONTRIB", required: false, order: 0, sourcePath: join(workspace, "selected.md"), content: "# Pibo context\n" },
		{ id: "context:native", kind: "context-file", source: "profile", intent: "project", label: "AGENTS.md", required: false, order: 1, sourcePath: join(workspace, "AGENTS.md"), content: "# Native context\n", nativeDiscovered: true },
	]);
	const delivery = new OmpResourceDelivery(config, paths, resources);
	const { reports, diagnostics } = await delivery.prepare();
	assert.deepEqual(diagnostics, []);
	assert.equal(reports.find((report) => report.contributionId === "context:1")?.status, "delivered");
	assert.equal(reports.find((report) => report.contributionId === "context:1")?.mode, "omp-append-system-prompt");
	assert.equal(reports.find((report) => report.contributionId === "context:native")?.mode, "native-project-discovery");
	assert.ok(delivery.appendSystemPromptPath);
	const appendPrompt = await readFile(delivery.appendSystemPromptPath, "utf8");
	assert.match(appendPrompt, /# Pibo-Selected Context/);
	assert.match(appendPrompt, /# Pibo context/);
	assert.doesNotMatch(appendPrompt, /# Native context/);
	assert.deepEqual(
		resolveOmpCommand(config, paths, delivery.appendSystemPromptPath).slice(-2),
		["--append-system-prompt", delivery.appendSystemPromptPath],
	);
	if (process.platform === "win32") assertPrivateWindowsAcl(delivery.appendSystemPromptPath, "file");
	else assert.equal((await stat(delivery.appendSystemPromptPath)).mode & 0o777, 0o600);
	assert.deepEqual(await readdir(workspace), ["existing.txt"], "OMP delivery must not write into the user workspace");

	const configYaml = await readFile(paths.config, "utf8");
	assert.ok(configYaml.includes("skills:"), "config.yml must declare skills");
	assert.ok(configYaml.includes("customDirectories:"), "config.yml must set skills.customDirectories");
	const parsedConfig = load(configYaml);
	assert.deepEqual(parsedConfig.skills.customDirectories, [join(root, "skills", "pibo").replaceAll("\\", "/")], "OMP must scan the parent that contains the selected skill directory");
});

test("OMP resource-delivery persists portable history and blocks every native task entry point", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-history-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = parseOmpRuntimeConfig({ bunExecutable: "bun", ompEntry: "/opt/omp/src/cli.ts", homeRoot: root });
	const paths = await sessionPaths(config, root);
	const historyHandoff = {
		mode: "import",
		history: {
			version: 1,
			piboSessionId: "sess",
			sourceRuntimeInstanceId: "pi",
			sourceAdapterId: "pi",
			checkpoint: { maxSessionSequence: 2, createdAt: "2026-08-20T00:00:00.000Z" },
			entries: [
				{ id: "u1", type: "message", source: "product", createdAt: "2026-08-20T00:00:00.000Z", role: "user", content: "Remember portable context.", status: "complete" },
				{ id: "a1", type: "message", source: "product", createdAt: "2026-08-20T00:00:01.000Z", role: "assistant", content: "I remember.", status: "complete" },
			],
			truncated: false,
			omittedEntries: 0,
		},
	};
	const delivery = new OmpResourceDelivery(config, paths, undefined, historyHandoff, false);
	await delivery.prepare();
	assert.ok(delivery.appendSystemPromptPath);
	assert.match(await readFile(delivery.appendSystemPromptPath, "utf8"), /Remember portable context/);
	const configYaml = await readFile(paths.config, "utf8");
	assert.match(configYaml, /tools:\n  approval:\n    task: deny/);
	assert.match(configYaml, /task:\n  disabledAgents:/);
	for (const name of ["scout", "designer", "reviewer", "security-reviewer", "librarian", "task", "sonic"]) {
		assert.ok(configYaml.includes(`- ${JSON.stringify(name)}`));
	}

	const resumed = new OmpResourceDelivery(config, paths, undefined, undefined, false);
	await resumed.prepare();
	assert.match(await readFile(resumed.appendSystemPromptPath, "utf8"), /Remember portable context/);

	const staleAppendPromptPath = resumed.appendSystemPromptPath;
	const fresh = new OmpResourceDelivery(config, paths, undefined, { mode: "fresh" }, false);
	await fresh.prepare();
	assert.equal(fresh.appendSystemPromptPath, undefined);
	await assert.rejects(() => stat(staleAppendPromptPath), /ENOENT/, "start-fresh must remove the stale additive prompt file");
});

test("OMP unbound-session reset removes stale native transcripts and portable handoff files", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-reset-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = parseOmpRuntimeConfig({ bunExecutable: "bun", ompEntry: "/opt/omp/src/cli.ts", homeRoot: root });
	const paths = await sessionPaths(config, root);
	await writeFile(join(paths.sessionDir, "stale-session.jsonl"), "stale transcript\n");
	await writeFile(join(paths.context, "pibo-portable-history.md"), "stale portable history\n");
	await writeFile(join(paths.context, "pibo-context.md"), "stale append prompt\n");
	await resetOmpNativeSession(paths);
	assert.deepEqual(await readdir(paths.sessionDir), []);
	assert.deepEqual(await readdir(paths.context), []);
});

test("OMP resource-delivery writes provider/model defaults into config.yml", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-provider-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = parseOmpRuntimeConfig({
		bunExecutable: "bun",
		ompEntry: "/opt/omp/src/cli.ts",
		homeRoot: root,
		defaultProvider: "deepseek",
		defaultModel: "deepseek-v4",
	});
	const paths = await sessionPaths(config, root);
	const delivery = new OmpResourceDelivery(config, paths, undefined);
	await delivery.prepare();
	const configYaml = await readFile(paths.config, "utf8");
	assert.ok(configYaml.includes("default: deepseek/deepseek-v4:max"), `expected model role default, got:\n${configYaml}`);
});

test("OMP process environment isolates the agent dir and passes provider API keys", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-env-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = parseOmpRuntimeConfig({ bunExecutable: "bun", ompEntry: "/opt/omp/src/cli.ts", homeRoot: root });
	const paths = await sessionPaths(config, root);
	const env = buildOmpProcessEnvironment({
		paths,
		config,
		baseEnvironment: { ...process.env, OPENAI_API_KEY: "sk-a", SECRET_LEAK: "nope", PATH: "/bin" },
	});
	assert.equal(env.PI_CODING_AGENT_DIR, paths.agentDir, "agent dir must be isolated");
	assert.equal(env.OPENAI_API_KEY, "sk-a", "allowlisted provider key must pass through");
	assert.equal(env.SECRET_LEAK, undefined, "non-allowlisted key must NOT pass through");
	assert.equal(env.PI_NO_TITLE, "1");
});

test("OMP adapter driver descriptor declares truthful capabilities", async (t) => {
	assert.equal(OMP_AGENT_RUNTIME_DRIVER.descriptor.id, "orp");
	assert.equal(OMP_AGENT_RUNTIME_DRIVER.descriptor.transport, "stdio-rpc");
	const caps = OMP_RUNTIME_CAPABILITIES;
	assert.equal(caps.approvals.supported, false, "no RPC approval command -> approvals unsupported (truthful)");
	assert.equal(caps.skills.support, "materialized", "skills delivered via isolated customDirectories");
	assert.equal(caps.context.support, "materialized");
	assert.deepEqual(caps.context.modes, ["native-project-discovery", "omp-append-system-prompt"]);
	assert.deepEqual(caps.contextDiscovery, {
		supported: true,
		configurable: false,
		enabledByDefault: true,
		strategy: "omp-project",
		knownFileNames: ["AGENTS.md"],
		knownUserRelativePaths: [
			".claude/CLAUDE.md",
			".codex/AGENTS.md",
			".gemini/GEMINI.md",
			".config/opencode/AGENTS.md",
			".copilot/copilot-instructions.md",
		],
		knownCwdRelativePaths: [
			".claude/CLAUDE.md",
			".gemini/GEMINI.md",
			".github/copilot-instructions.md",
		],
		knownRelativePaths: [
			".omp/AGENTS.md",
		],
		knownAncestorRelativePaths: [
			".agent/AGENTS.md",
			".agents/AGENTS.md",
		],
	});
	assert.deepEqual(caps.nativeSubagents, { supported: true, configurable: true, enabledByDefault: true });
	assert.equal(caps.historyImport, true);
	assert.equal(caps.models.catalog, true);
	assert.equal(caps.models.switchInSession, true);
	assert.equal(caps.maintenance.compaction, true);
	assert.equal(caps.maintenance.history, true);
	assert.equal(caps.reasoning.supported, true);
	assert.equal(caps.tools.piboManaged.support, "direct", "Pibo tools delivered via host-tool bridge");
	// auth: api_key only, completion immediate (no device/browser flow invented)
	assert.equal(caps.auth.methods.length, 1);
	assert.equal(caps.auth.methods[0].id, "api_key");
});