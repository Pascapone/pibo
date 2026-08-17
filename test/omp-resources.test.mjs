import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseOmpRuntimeConfig } from "../dist/agent-runtimes/omp/config.js";
import { prepareOmpSessionPaths, buildOmpProcessEnvironment } from "../dist/agent-runtimes/omp/process.js";
import { OmpResourceDelivery } from "../dist/agent-runtimes/omp/resource-delivery.js";
import { OMP_AGENT_RUNTIME_DRIVER, OMP_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/omp/adapter.js";

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

test("OMP resource-delivery writes config.yml with skills.customDirectories and context files", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-res-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = parseOmpRuntimeConfig({ bunExecutable: "bun", ompEntry: "/opt/omp/src/cli.ts", homeRoot: root });
	const paths = await sessionPaths(config, root);
	const resources = fakeResources([join(root, "skills", "pibo", "skill-a")], [
		{ id: "context:1", kind: "context-file", source: "profile", intent: "developer", label: "CONTRIB", required: false, order: 0, content: "# Pibo context\n" },
	]);
	const delivery = new OmpResourceDelivery(config, paths, resources);
	const { reports, diagnostics } = await delivery.prepare();
	assert.ok(diagnostics.length === 0, `expected no diagnostics, got ${JSON.stringify(diagnostics)}`);
	assert.ok(reports.length >= 1);
	const contextReport = reports.find((r) => r.contributionId === "context:1");
	assert.ok(contextReport, "expected a context report");
	assert.equal(
		contextReport.status,
		"unsupported",
		"OMP has no context injection seam -> context must be reported unsupported, not delivered",
	);
	assert.notEqual(contextReport.mode, "materialized", "context mode must not claim materialized delivery");
	assert.ok(
		contextReport.diagnostic?.includes("AGENTS.md"),
		"context diagnostic should explain OMP-native discovery",
	);

	const configYaml = await readFile(paths.config, "utf8");
	assert.ok(configYaml.includes("skills:"), "config.yml must declare skills");
	assert.ok(configYaml.includes("customDirectories:"), "config.yml must set skills.customDirectories");
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
	assert.equal(
		caps.context.support,
		"unsupported",
		"OMP loads context via its own AGENTS.md discovery; no Pibo seam -> unsupported (truthful)",
	);
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