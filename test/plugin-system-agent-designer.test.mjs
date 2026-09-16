import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore, previewCustomAgentCreate, previewCustomAgentUpdate, inventoryLegacyAgentSelection, planLegacyAgentPluginMigration, migrateLegacyAgentPlugins, migrateLegacyAgentsAtStartup, profileConsumerCollector } from "../dist/apps/chat/agent-store.js";
import { PluginStore } from "../dist/plugins/store.js";
import { PLUGIN_STORE_SCHEMA } from "../dist/plugins/store-schema.js";
import { resolvePluginContributions } from "../dist/plugins/resolution.js";
import { validatePluginAgentMutation, normalizePluginAgentCreate, normalizePluginAgentUpdate, validateAgentPluginPlanMutation, resolveAgentPluginPreview, buildAgentPluginCatalog, handleAgentPluginRoute } from "../dist/apps/chat/chat-capability-routes.js";
import { legacySessionToolNames } from "./helpers/legacy-session-tool-names.mjs";
const { agentDraftToSaveInput, agentToDraft, createBlankAgentDraft, compatibleModelSelectionsForRuntime, setAgentPluginEnabled, setAgentPluginContribution, acceptAgentPluginRevision } = await tsImport("../src/apps/chat-ui/src/agents/agent-designer-model.ts", import.meta.url);

const baseline = JSON.parse(readFileSync(new URL("./fixtures/plugin-system/legacy-builtin-catalog.json", import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/plugin-system/legacy-agent-selections.json", import.meta.url)));
const noContext = { kind: "none", reason: "Fixture tool/schema, not prompt content" };
const runtime = (id = "pi") => { const item = baseline.catalog.agentRuntimes.find((entry) => entry.id === id); return { adapterId: item.adapterId, instanceId: id, capabilities: item.capabilities }; };
const legacyCatalog = { ...baseline.catalog, skills: [...baseline.catalog.skills, { name: "user-notes", kind: "user" }], contextFiles: [...baseline.catalog.contextFiles, { key: "user-context" }] };
function installation(id, contributions) { return { pluginId: id, revision: `hash:${id}`, version: "1.0.0", contentHash: `hash:${id}`, state: "active", enabled: true, stateRevision: 1, createdAt: "2026-09-01T00:00:00Z", source: { kind: "builtin", name: id }, manifest: { schemaVersion: 1, id, name: id, version: "1.0.0", sdk: "^1.0.0", contributions } }; }
function contribution(name, extra = {}) { return { id: name, name, kind: "tool", scope: "agent", required: false, defaultEnabled: true, schemaVersion: 1, context: noContext, ...extra }; }
function catalogFor(inventory) {
	const owners = new Map();
	for (const item of inventory.contributions) {
		const list = owners.get(item.pluginId) ?? [];
		list.push(contribution(item.name, { kind: item.kind, ...(item.name === "hashline" ? { runtime: { adapterIds: ["pi"] } } : {}) }));
		owners.set(item.pluginId, list);
	}
	// Update/new defaults must NOT broaden an old subset.
	if (owners.has("pibo.web-annotations")) owners.get("pibo.web-annotations").push(contribution("extra_write_tool"));
	return { schemaVersion: 1, revision: 1, installations: [...owners].map(([id, items]) => installation(id, items)) };
}
function prepare(store, fixture) {
	const agent = store.create(fixture.input);
	const inventory = inventoryLegacyAgentSelection(agent, { catalog: legacyCatalog, runtime: runtime(agent.runtimeInstanceId), owners: fixtures.owners });
	const catalog = catalogFor(inventory);
	const source = store.exportLegacyAgent(agent.id);
	const report = planLegacyAgentPluginMigration({ agent, source, catalog, runtime: runtime(agent.runtimeInstanceId), ...inventory });
	return { agent, inventory, catalog, source, report };
}
function pluginStore() { const db = new DatabaseSync(":memory:"); db.exec(PLUGIN_STORE_SCHEMA); return { db, store: new PluginStore(db) }; }

for (const fixture of fixtures.cases) test(`legacy ${fixture.id}: exact contribution/tool sets and independent resources`, async () => {
	const agents = new CustomAgentStore(":memory:");
	const { db, store: plugins } = pluginStore();
	const backupRoot = mkdtempSync(join(tmpdir(), "designer-migration-"));
	try {
		const { agent, inventory, catalog, source, report } = prepare(agents, fixture);
		assert.deepEqual([...inventory.harnessTools].sort(), fixture.expectedHarnessTools);
		if (fixture.expectedRunTargets) assert.deepEqual([...inventory.runTargetNames].sort(), fixture.expectedRunTargets);
		assert.deepEqual([...inventory.yieldedOnlyTools].sort(), fixture.expectedYieldedOnlyTools ?? []);
		const beforeNames = [...new Set(inventory.contributions.filter((item) => item.kind === "tool").map((item) => item.name))].sort();
		assert.deepEqual(beforeNames, [...fixture.expectedTools, ...fixture.expectedYieldedOnlyTools ?? []].sort());
		assert.equal(report.status, fixture.conflict ? "conflict" : "ready");
		if (!fixture.conflict) { assert.deepEqual(report.before, report.after); assert.deepEqual(report.beforeTools, report.afterTools); }
		assert.equal(report.afterTools.includes("extra_write_tool"), false);
		const dry = await migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot, dryRun: true });
		assert.equal(dry.dryRun, true);
		assert.equal(agents.get(agent.id).pluginSelection, undefined);
		const result = await migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot });
		assert.equal(result.state, "complete");
		const migrated = agents.get(agent.id);
		assert.deepEqual(migrated.subagents, agent.subagents);
		assert.deepEqual(migrated.runtimeOptions, agent.runtimeOptions);
		assert.deepEqual(migrated.mainModelFallbacks, agent.mainModelFallbacks);
		assert.deepEqual(migrated.pluginMigration.inactivePiPackages, agent.piPackages);
		assert.deepEqual(migrated.piPackages, fixture.conflict ? agent.piPackages : []);
		assert.deepEqual(migrated.nativeTools, fixture.conflict ? agent.nativeTools : []);
		assert.deepEqual(migrated.skills, fixture.conflict ? agent.skills : inventory.userSkills);
		assert.deepEqual(migrated.contextFiles, fixture.conflict ? agent.contextFiles : inventory.userContextFiles);
		assert.equal(readFileSync(result.backupPath).equals(Buffer.from(source)), true);
		const repeated = await migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot });
		assert.deepEqual(repeated, JSON.parse(JSON.stringify(result)));
		assert.equal(agents.get(agent.id).revision, migrated.revision);
		const effective = resolvePluginContributions({ catalog, runtime: runtime(agent.runtimeInstanceId), selection: migrated.pluginSelection, selectionRevision: migrated.revision });
		if (fixture.conflict) assert.equal(migrated.pluginSelection.plugins.every((item) => !item.enabled), true);
		else assert.deepEqual(effective.contributions.filter((item) => item.contribution.kind === "tool").map((item) => item.contribution.name).sort(), report.afterTools);
	} finally { agents.close(); db.close(); rmSync(backupRoot, { recursive: true, force: true }); }
});

test("automatic startup migration preserves MCP selection and backs up independent resource contents and provenance", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-v4-auto-migration-"));
	const agents = new CustomAgentStore(join(root, "agents.sqlite"));
	const db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	const plugins = new PluginStore(db);
	try {
		const skillPath = join(root, "personal-skill.md");
		const contextPath = join(root, "personal-context.md");
		writeFileSync(skillPath, "# Personal skill\nKeep this exact content.\n");
		writeFileSync(contextPath, "Private context body.\n");
		const agent = agents.create({ displayName: "automatic-agent", nativeTools: ["legacy_search"], skills: ["personal-skill"], contextFiles: ["personal-context"], mcpServers: ["filesystem", "project-db"], goalControl: false, runControl: false });
		const catalog = { schemaVersion: 1, revision: 2, installations: [
			installation("fixture.search", [contribution("legacy_search")]),
			installation("pibo.mcp-cli", [{ ...contribution("adapter", { kind: "mcp-adapter", name: "mcp-cli", defaultEnabled: false }), configSchema: { type: "object", properties: { selectedServers: { type: "array", items: { type: "string" } } }, required: ["selectedServers"], additionalProperties: false } }]),
		] };
		const legacy = { nativeTools: [{ name: "legacy_search", yieldable: false }], skills: [{ name: "personal-skill", kind: "user", path: skillPath }], contextFiles: [{ key: "personal-context", path: contextPath, scope: "agent", source: "managed" }] };
		const first = await migrateLegacyAgentsAtStartup({ agents, plugins, catalog, legacyCatalog: legacy, backupRoot: join(root, "backups"), resolveRuntime: () => runtime() });
		assert.equal(first[0].status, "migrated");
		const migrated = agents.get(agent.id);
		assert.deepEqual(migrated.mcpServers, []);
		assert.deepEqual(migrated.pluginMigration.mcpServers, ["filesystem", "project-db"]);
		assert.deepEqual(migrated.pluginSelection.plugins.find((item) => item.pluginId === "pibo.mcp-cli").contributionConfig.adapter.selectedServers, ["filesystem", "project-db"]);
		assert.deepEqual(migrated.skills, ["personal-skill"]);
		assert.deepEqual(migrated.contextFiles, ["personal-context"]);
		assert.equal(migrated.pluginMigration.resourceSnapshots.every((item) => item.available && item.contentHash && item.byteSize > 0), true);
		const journalRow = db.prepare("SELECT record_json FROM plugin_migration_journal WHERE id LIKE ?").get(`agent-plugins-v2:${agent.id}:%`);
		const journal = JSON.parse(journalRow.record_json);
		const backup = JSON.parse(readFileSync(journal.backupPath, "utf8"));
		assert.deepEqual(backup.resources.map((item) => item.content), ["# Personal skill\nKeep this exact content.\n", "Private context body.\n"]);
		assert.deepEqual(backup.resources.map((item) => [item.kind, item.origin, item.order]), [["skill", "user", 0], ["context-file", "user", 0]]);
		const revision = migrated.revision;
		const second = await migrateLegacyAgentsAtStartup({ agents, plugins, catalog, legacyCatalog: legacy, backupRoot: join(root, "backups"), resolveRuntime: () => runtime() });
		assert.equal(second[0].status, "unchanged");
		assert.equal(agents.get(agent.id).revision, revision);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("startup retry resolves a prior conflict from the immutable backup without losing legacy fields", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-v4-retry-conflict-"));
	const agents = new CustomAgentStore(join(root, "agents.sqlite"));
	const db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	const plugins = new PluginStore(db);
	try {
		const agent = agents.create({ displayName: "retry-agent", nativeTools: ["missing-write-tool"], goalControl: false, runControl: false });
		const emptyCatalog = { schemaVersion: 1, revision: 1, installations: [] };
		const legacy = { nativeTools: [{ name: "missing-write-tool", yieldable: false }], skills: [], contextFiles: [] };
		const first = await migrateLegacyAgentsAtStartup({ agents, plugins, catalog: emptyCatalog, legacyCatalog: legacy, backupRoot: join(root, "backups"), resolveRuntime: () => runtime() });
		assert.equal(first[0].status, "blocked");
		assert.deepEqual(agents.get(agent.id).nativeTools, ["missing-write-tool"]);
		assert.equal(agents.get(agent.id).pluginMigration.status, "conflict");
		const sourceHash = agents.get(agent.id).pluginMigration.sourceHash;

		const fixedCatalog = { schemaVersion: 1, revision: 2, installations: [installation("fixture.writer", [contribution("missing-write-tool")])] };
		const second = await migrateLegacyAgentsAtStartup({ agents, plugins, catalog: fixedCatalog, legacyCatalog: legacy, backupRoot: join(root, "backups"), resolveRuntime: () => runtime() });
		assert.equal(second[0].status, "migrated");
		const migrated = agents.get(agent.id);
		assert.equal(migrated.pluginMigration.status, "ready");
		assert.equal(migrated.pluginMigration.sourceHash, sourceHash);
		assert.deepEqual(migrated.nativeTools, []);
		assert.equal(migrated.pluginSelection.plugins.some((entry) => entry.pluginId === "fixture.writer" && entry.contributions["missing-write-tool"]), true);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const journalVersion of ["v2", "v1"]) test(`startup reconciliation moves a formerly independent core skill from the original ${journalVersion} backup`, async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-v4-core-ownership-"));
	const agents = new CustomAgentStore(join(root, "agents.sqlite"));
	const db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	const plugins = new PluginStore(db);
	try {
		const skillPath = join(root, "pi-agent-harness.md");
		writeFileSync(skillPath, "# Original core skill snapshot\n");
		const agent = agents.create({ displayName: "core-owner-agent", skills: ["pi-agent-harness"], goalControl: false, runControl: false });
		const first = await migrateLegacyAgentsAtStartup({
			agents, plugins, catalog: { schemaVersion: 1, revision: 1, installations: [] },
			legacyCatalog: { nativeTools: [], skills: [{ name: "pi-agent-harness", kind: "user", path: skillPath }], contextFiles: [] },
			backupRoot: join(root, "backups"), resolveRuntime: () => runtime(),
		});
		assert.equal(first[0].status, "migrated");
		if (journalVersion === "v1") {
			const record = plugins.listJournals(`agent-plugins-v2:${agent.id}:`)[0];
			const oldId = `agent-plugins-v1:${agent.id}:${record.backupHash}`;
			db.prepare("UPDATE plugin_migration_journal SET id = ?, record_json = ? WHERE id = ?").run(oldId, JSON.stringify({ ...record, id: oldId }), record.id);
		}
		const originalHash = agents.get(agent.id).pluginMigration.resourceSnapshots[0].contentHash;
		assert.deepEqual(agents.get(agent.id).skills, ["pi-agent-harness"]);
		writeFileSync(skillPath, "# Later independent edit\n");

		const coreCatalog = { schemaVersion: 1, revision: 2, installations: [installation("pibo.core", [contribution("pi-agent-harness", { kind: "skill" })])] };
		const second = await migrateLegacyAgentsAtStartup({
			agents, plugins, catalog: coreCatalog,
			legacyCatalog: { nativeTools: [], skills: [{ name: "pi-agent-harness", kind: "builtin", path: skillPath }], contextFiles: [] },
			backupRoot: join(root, "backups"), resolveRuntime: () => runtime(),
		});
		assert.equal(second[0].status, "migrated");
		const migrated = agents.get(agent.id);
		assert.deepEqual(migrated.skills, []);
		assert.equal(migrated.pluginSelection.plugins.some((entry) => entry.pluginId === "pibo.core" && entry.contributions["pi-agent-harness"]), true);
		assert.equal(migrated.pluginMigration.resourceSnapshots[0].contentHash, originalHash);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("partially migrated explicit selections retain their entries and absorb legacy MCP filters exactly", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-v4-partial-agent-"));
	const agentPath = join(root, "agents.sqlite");
	let agents = new CustomAgentStore(agentPath);
	const db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	const plugins = new PluginStore(db);
	try {
		const agent = agents.create({ displayName: "partial-agent", mcpServers: ["filesystem", "project-db"], goalControl: false, runControl: false });
		agents.close();
		const raw = new DatabaseSync(agentPath);
		raw.prepare("UPDATE chat_agents SET plugin_selection_json = ? WHERE id = ?").run(JSON.stringify({ schemaVersion: 1, plugins: [{ pluginId: "fixture.search", revision: "hash:fixture.search", enabled: true, contributions: { legacy_search: true }, config: {} }] }), agent.id);
		raw.close();
		agents = new CustomAgentStore(agentPath);
		const catalog = { schemaVersion: 1, revision: 2, installations: [
			installation("fixture.search", [contribution("legacy_search")]),
			installation("pibo.mcp-cli", [{ ...contribution("adapter", { kind: "mcp-adapter", name: "mcp-cli", defaultEnabled: false }), configSchema: { type: "object", properties: { selectedServers: { type: "array", items: { type: "string" } } }, required: ["selectedServers"], additionalProperties: false } }]),
		] };
		const result = await migrateLegacyAgentsAtStartup({ agents, plugins, catalog, legacyCatalog: { nativeTools: [], skills: [], contextFiles: [] }, backupRoot: join(root, "backups"), resolveRuntime: () => runtime() });
		assert.equal(result[0].status, "migrated");
		const migrated = agents.get(agent.id);
		assert.equal(migrated.pluginSelection.plugins.some((entry) => entry.pluginId === "fixture.search" && entry.contributions.legacy_search), true);
		assert.deepEqual(migrated.pluginSelection.plugins.find((entry) => entry.pluginId === "pibo.mcp-cli").contributionConfig.adapter.selectedServers, ["filesystem", "project-db"]);
		assert.deepEqual(migrated.mcpServers, []);
		assert.deepEqual(migrated.pluginMigration.before, migrated.pluginMigration.after);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("one archived agent with an unavailable runtime is isolated and remains diagnostically repairable", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-v4-unavailable-runtime-"));
	const agents = new CustomAgentStore(join(root, "agents.sqlite"));
	const db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	const plugins = new PluginStore(db);
	try {
		const archived = agents.create({ displayName: "retired-runtime-agent", runtimeInstanceId: "removed-runtime", nativeTools: ["legacy_search"], goalControl: false, runControl: false });
		agents.setArchived(archived.id, true);
		const healthy = agents.create({ displayName: "healthy-agent", nativeTools: ["legacy_search"], goalControl: false, runControl: false });
		const catalog = { schemaVersion: 1, revision: 1, installations: [installation("fixture.search", [contribution("legacy_search")])] };
		const results = await migrateLegacyAgentsAtStartup({
			agents, plugins, catalog, legacyCatalog: { nativeTools: [{ name: "legacy_search", yieldable: false }], skills: [], contextFiles: [] }, backupRoot: join(root, "backups"),
			resolveRuntime: (id) => { if (id === "removed-runtime") throw new Error("runtime instance was uninstalled"); return runtime(); },
		});
		assert.equal(results.find((item) => item.agentId === archived.id).status, "blocked");
		assert.match(results.find((item) => item.agentId === archived.id).diagnostic, /removed-runtime|uninstalled/);
		assert.equal(results.find((item) => item.agentId === healthy.id).status, "migrated");
		const blocked = agents.get(archived.id);
		assert.equal(blocked.pluginMigration.diagnostics[0].code, "stored-runtime-unavailable");
		assert.deepEqual(blocked.nativeTools, ["legacy_search"]);
		assert.ok(blocked.archivedAt);
		assert.deepEqual(agents.get(healthy.id).nativeTools, []);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("fixture tool names match actual legacy session-tool assembler (Goal default, manual-only Run)", () => {
	for (const id of ["standard", "subset", "run", "resources"]) {
		const fixture = fixtures.cases.find((item) => item.id === id);
		const agent = previewCustomAgentCreate(fixture.input);
		const names = legacySessionToolNames({ nativeToolNames: agent.nativeTools, subagents: agent.subagents, goalControl: agent.goalControl, runControl: agent.runControl });
		assert.deepEqual(names, fixture.expectedTools, id);
	}
	const manual = fixtures.cases.find((item) => item.id === "manual");
	const legacyManualAgent = previewCustomAgentCreate(manual.input);
	const legacyNames = legacySessionToolNames({ nativeToolNames: legacyManualAgent.nativeTools, subagents: legacyManualAgent.subagents, goalControl: legacyManualAgent.goalControl, runControl: legacyManualAgent.runControl });
	assert.equal(legacyNames.includes("pibo_agents_send_message"), false, "legacy send_message was yielded-only");
	assert.equal(legacyNames.includes("pibo_agents_observe"), true);
	assert.equal(legacyNames.includes("pibo_run_start"), true);
	assert.deepEqual(manual.expectedTools, ["web_annotations_list"], "plugin migration excludes Core-owned delegation and implicit Run Control");
});

test("required subset mismatch and runtime incompatibility never gain tools", () => {
	const store = new CustomAgentStore(":memory:");
	try {
		const state = prepare(store, fixtures.cases.find((item) => item.id === "subset"));
		state.catalog.installations[0].manifest.contributions.find((item) => item.name === "extra_write_tool").required = true;
		const report = planLegacyAgentPluginMigration({ ...state, runtime: runtime(), ...state.inventory });
		assert.equal(report.status, "conflict");
		assert.deepEqual(report.afterTools, []);
		assert.equal(report.selection.plugins.every((item) => !item.enabled), true);
		const pi = prepare(store, fixtures.cases.find((item) => item.id === "pi-only"));
		const incompatible = planLegacyAgentPluginMigration({ ...pi, runtime: runtime("codex-native"), ...pi.inventory });
		assert.equal(incompatible.status, "conflict");
		assert.deepEqual(incompatible.afterTools, []);
	} finally { store.close(); }
});

test("migration crash after AgentStore commit before journal checkpoint resumes after reopen", async () => {
	const root = mkdtempSync(join(tmpdir(), "designer-crash-"));
	let agents = new CustomAgentStore(join(root, "agents.sqlite"));
	let db = new DatabaseSync(join(root, "product.sqlite")); db.exec(PLUGIN_STORE_SCHEMA);
	let plugins = new PluginStore(db);
	try {
		const { agent, source, report } = prepare(agents, fixtures.cases.find((item) => item.id === "manual"));
		await assert.rejects(migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot: root, afterStageWrite: () => { throw new Error("crash after owner write"); } }), /crash/);
		const revision = agents.get(agent.id).revision;
		agents.close(); db.close();
		agents = new CustomAgentStore(join(root, "agents.sqlite")); db = new DatabaseSync(join(root, "product.sqlite")); plugins = new PluginStore(db);
		const result = await migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot: root });
		assert.equal(result.state, "complete");
		assert.equal(agents.get(agent.id).revision, revision);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("migration resumes after a real SIGKILL immediately after the owner write", async () => {
	const root = mkdtempSync(join(tmpdir(), "designer-sigkill-"));
	const agentPath = join(root, "agents.sqlite");
	const pluginPath = join(root, "product.sqlite");
	let agents = new CustomAgentStore(agentPath);
	let db = new DatabaseSync(pluginPath); db.exec(PLUGIN_STORE_SCHEMA);
	try {
		const { agent, source, report } = prepare(agents, fixtures.cases.find((item) => item.id === "manual"));
		writeFileSync(join(root, "source.bin"), source);
		writeFileSync(join(root, "report.json"), JSON.stringify(report));
		agents.close(); db.close();
		const child = spawnSync(process.execPath, ["--input-type=module", "--eval", `
			import { readFileSync } from "node:fs";
			import { DatabaseSync } from "node:sqlite";
			import { CustomAgentStore, migrateLegacyAgentPlugins } from "./dist/apps/chat/agent-store.js";
			import { PluginStore } from "./dist/plugins/store.js";
			const agents = new CustomAgentStore(${JSON.stringify(agentPath)});
			const db = new DatabaseSync(${JSON.stringify(pluginPath)});
			await migrateLegacyAgentPlugins({ agents, plugins: new PluginStore(db), agentId: ${JSON.stringify(agent.id)}, source: readFileSync(${JSON.stringify(join(root, "source.bin"))}), report: JSON.parse(readFileSync(${JSON.stringify(join(root, "report.json"))}, "utf8")), backupRoot: ${JSON.stringify(root)}, afterStageWrite: () => process.kill(process.pid, "SIGKILL") });
		`], { cwd: process.cwd(), encoding: "utf8" });
		agents = new CustomAgentStore(agentPath); db = new DatabaseSync(pluginPath);
		assert.equal(child.signal, "SIGKILL", child.stderr);

		const revision = agents.get(agent.id).revision;
		const resumed = await migrateLegacyAgentPlugins({ agents, plugins: new PluginStore(db), agentId: agent.id, source, report, backupRoot: root });
		assert.equal(resumed.state, "complete");
		assert.equal(agents.get(agent.id).revision, revision);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("migration refuses concurrent source edits; raw unknown fields remain in backup", async () => {
	const agents = new CustomAgentStore(":memory:"); const { db, store: plugins } = pluginStore(); const root = mkdtempSync(join(tmpdir(), "designer-source-"));
	try {
		const { agent, source, report } = prepare(agents, fixtures.cases[0]);
		agents.update(agent.id, { description: "changed after preview" });
		await assert.rejects(migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot: root }), /changed since migration/);
		assert.equal(agents.get(agent.id).pluginSelection, undefined);
		assert.equal(agents.get(agent.id).description, "changed after preview");
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

const emptySelection = { schemaVersion: 1, plugins: [] };

test("retired Delegation plugin selections are removed while Core derives delegation from subagents", () => {
	const retained = { pluginId: "fixture.search", revision: "hash:fixture.search", enabled: true, contributions: { search: true }, config: {} };
	const retired = { pluginId: "pibo.agent-delegation", revision: "hash:retired", enabled: true, contributions: { pibo_agents_send_message: true }, config: {} };
	const designerCatalog = buildAgentPluginCatalog({ schemaVersion: 1, revision: 1, installations: [
		installation("pibo.agent-delegation", [contribution("pibo_agents_send_message")]),
		installation("fixture.search", [contribution("search")]),
	] });
	assert.deepEqual(designerCatalog.plugins.map((plugin) => plugin.pluginId), ["fixture.search"]);
	const created = previewCustomAgentCreate({
		schemaVersion: 2,
		displayName: "core-delegation-agent",
		subagents: [{ name: "helper", targetProfile: "base" }],
		pluginSelection: { schemaVersion: 1, plugins: [retired, retained] },
	});
	assert.deepEqual(created.pluginSelection.plugins, [retained]);
	assert.deepEqual(previewCustomAgentUpdate(created, {
		pluginSelection: { schemaVersion: 1, plugins: [retired] },
	}).pluginSelection.plugins, []);
	assert.deepEqual(inventoryLegacyAgentSelection(created, {
		catalog: legacyCatalog,
		runtime: runtime(),
		owners: fixtures.owners,
	}).runTargetNames, []);
});

test("SQL CAS protects parallel connections, archive and missing references survive metadata edits", async () => {
	const root = mkdtempSync(join(tmpdir(), "designer-cas-")); const path = join(root, "agents.sqlite");
	const first = new CustomAgentStore(path); const second = new CustomAgentStore(path);
	try {
		const selection = { schemaVersion: 1, plugins: [{ pluginId: "missing.plugin", revision: "old-hash", enabled: true, contributions: { read: true }, config: { endpoint: "fixture" } }] };
		const agent = first.create({ schemaVersion: 2, displayName: "cas-agent", pluginSelection: selection });
		assert.throws(() => first.update(agent.id, { description: "no revision" }), /expectedRevision/);
		const saved = first.update(agent.id, { description: "first tab" }, { expectedRevision: agent.revision });
		assert.throws(() => second.update(agent.id, { displayName: "other-tab" }, { expectedRevision: agent.revision }), /revision changed/);
		assert.throws(() => second.setArchived(agent.id, true, { expectedRevision: agent.revision }), /revision changed/);
		assert.deepEqual(second.get(agent.id).pluginSelection, selection);
		assert.equal(saved.revision, 2);
		const folder = first.createFolder("Work");
		const moved = first.update(agent.id, { folderId: folder.id, mainModel: { provider: "example", id: "model" }, runtimeOptions: { keep: true } }, { expectedRevision: saved.revision });
		assert.equal(moved.folderId, folder.id);
		assert.throws(() => first.deleteFolder(folder.id), /Move agents/);
		assert.equal(first.setArchived(agent.id, true, { expectedRevision: moved.revision }).revision, 4);
		assert.equal((await profileConsumerCollector(first)("missing.plugin"))[0].id, "cas-agent");
	} finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
});

test("API v2 rejects legacy/version/required manipulation; unchanged unresolved metadata is saveable", async () => {
	const agent = previewCustomAgentCreate({ schemaVersion: 2, displayName: "test-agent", pluginSelection: emptySelection });
	assert.throws(() => validatePluginAgentMutation({ displayName: "old-agent" }), /schemaVersion 2/);
	for (const field of ["nativeTools", "mcpServers", "piPackages", "runControl", "goalControl", "capabilityPackages"]) assert.throws(() => validatePluginAgentMutation({ schemaVersion: 2, pluginSelection: emptySelection, [field]: [] }), /Legacy field/);
	assert.throws(() => validatePluginAgentMutation({ schemaVersion: 2, pluginSelection: null }), /Expected schemaVersion/);
	assert.throws(() => validatePluginAgentMutation({ schemaVersion: 2, expectedRevision: 0 }, agent), /revision changed/);
	const catalog = { schemaVersion: 1, revision: 1, installations: [installation("fixture.plugin", [contribution("read", { required: true })])] };
	const selection = { schemaVersion: 1, plugins: [{ pluginId: "fixture.plugin", revision: "hash:fixture.plugin", enabled: true, contributions: { read: false }, config: {} }] };
	assert.throws(() => validateAgentPluginPlanMutation({ agent: { ...agent, pluginSelection: selection }, catalog, runtime: runtime() }), /Required contribution/);
	const unknown = { ...agent, pluginSelection: { ...selection, plugins: [{ ...selection.plugins[0], pluginId: "missing.plugin" }] } };
	assert.equal(validateAgentPluginPlanMutation({ existing: unknown, agent: { ...unknown, description: "new" }, catalog, runtime: runtime() }).valid, false);
	assert.throws(() => validateAgentPluginPlanMutation({ existing: unknown, agent: { ...unknown, runtimeInstanceId: "omp-native" }, catalog, runtime: runtime("omp-native") }), /missing|installed/i);
});

test("preview route ignores forged runtime capabilities, is read-only, and catalog hides artifact paths", async () => {
	const agents = new CustomAgentStore(":memory:");
	try {
		const installed = installation("fixture.plugin", [contribution("pi_only", { required: true, runtime: { adapterIds: ["pi"] } })]); installed.artifactPath = "/secret/backend";
		const catalog = { schemaVersion: 1, revision: 1, installations: [installed] };
		const selection = buildAgentPluginCatalog(catalog).plugins[0].initialSelection;
		assert.equal(JSON.stringify(buildAgentPluginCatalog(catalog)).includes("/secret/backend"), false);
		const agent = agents.create({ schemaVersion: 2, displayName: "preview-agent", pluginSelection: { schemaVersion: 1, plugins: [selection] } });
		let calls = 0;
		const request = new Request("http://fixture/api/chat/agent-plugin-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, agentId: agent.id, expectedRevision: agent.revision, runtimeInstanceId: "codex-native", pluginSelection: agent.pluginSelection, runtime: runtime("pi"), skills: [], contextFiles: [], subagents: [], builtinToolNames: [] }) });
		const response = await handleAgentPluginRoute({ route: { kind: "preview" }, request, agents, catalog, resolveRuntime: (id) => { calls++; return runtime(id); } });
		assert.equal(calls, 1); assert.equal((await response.json()).plan.valid, false); assert.equal(agents.get(agent.id).revision, 1);
	} finally { agents.close(); }
});

test("Designer snapshots preserve missing selections, optional exclusions and revision across model changes", () => {
	const catalog = buildAgentPluginCatalog({ schemaVersion: 1, revision: 1, installations: [installation("fixture.plugin", [contribution("read", { required: true }), contribution("write")])] });
	const plugin = catalog.plugins[0];
	let selection = setAgentPluginEnabled(emptySelection, plugin, true);
	selection = setAgentPluginContribution(selection, plugin.pluginId, plugin.contributions[1], false);
	assert.equal(selection.plugins[0].explicitContributions.write, false);
	assert.equal(setAgentPluginContribution(selection, plugin.pluginId, plugin.contributions[0], false).plugins[0].contributions.read, true);
	const changed = { ...plugin, revision: "new-revision", contributions: [...plugin.contributions, contribution("new_optional")] };
	const disabled = setAgentPluginEnabled(selection, changed, false);
	assert.equal(disabled.plugins[0].revision, plugin.revision);
	assert.equal(disabled.plugins[0].dependencyPolicy, "deny");
	const accepted = acceptAgentPluginRevision(selection, changed);
	assert.equal(accepted.plugins[0].contributions.new_optional, false);
	assert.equal(Object.hasOwn(accepted.plugins[0].explicitContributions, "new_optional"), false);
	assert.equal(accepted.plugins[0].contributions.write, false);
	const agent = previewCustomAgentCreate({ schemaVersion: 2, displayName: "designer-agent", pluginSelection: selection, mainModel: { provider: "old", id: "model" } });
	const draft = agentToDraft(agent);
	const switched = { ...draft, runtimeInstanceId: "codex-native", ...compatibleModelSelectionsForRuntime(draft, { adapterId: "codex-native", capabilities: { auth: { status: false, methods: [] } }, models: { models: [] } }) };
	const input = agentDraftToSaveInput(switched);
	assert.deepEqual(input.pluginSelection, selection); assert.equal(input.expectedRevision, agent.revision); assert.equal(input.mainModel, null);
	for (const key of ["nativeTools", "mcpServers", "piPackages", "runControl", "goalControl"]) assert.equal(Object.hasOwn(input, key), false);
	assert.deepEqual(createBlankAgentDraft().pluginSelection, emptySelection);
});


test("v2 normalizer adapters preserve model clears and never reinsert old Goal/Tool/Package defaults", () => {
	const input = normalizePluginAgentCreate({ schemaVersion: 2, displayName: "normalized-agent", pluginSelection: emptySelection });
	for (const key of ["nativeTools", "mcpServers", "piPackages", "runControl", "goalControl"]) assert.equal(Object.hasOwn(input, key), false);
	const agent = previewCustomAgentCreate(input);
	assert.equal(agent.goalControl, false);
	const { update, expectedRevision } = normalizePluginAgentUpdate({ schemaVersion: 2, expectedRevision: agent.revision, description: null, mainModel: null }, agent);
	assert.equal(update.mainModel, null); assert.equal(update.description, null); assert.equal(expectedRevision, agent.revision);
	assert.deepEqual(previewCustomAgentUpdate(agent, update).pluginSelection, emptySelection);
	assert.throws(() => normalizePluginAgentUpdate({ schemaVersion: 2, expectedRevision: 1, pluginSelection: emptySelection }, { ...agent, pluginSelection: undefined }), /journal-migrated/);
});

test("unresolved inactive migration is a blocked preview, not a valid empty activation", () => {
	const agents = new CustomAgentStore(":memory:");
	try {
		const state = prepare(agents, fixtures.cases.find((item) => item.id === "unknown-tool"));
		const agent = { ...state.agent, pluginSelection: state.report.selection, pluginMigration: state.report };
		const plan = resolveAgentPluginPreview({ agent, catalog: state.catalog, runtime: runtime() });
		assert.equal(plan.valid, false); assert.equal(plan.diagnostics.some((item) => item.code === "legacy-migration-unresolved"), true);
		assert.equal(validateAgentPluginPlanMutation({ existing: agent, agent: { ...agent, description: "retained" }, catalog: state.catalog, runtime: runtime() }).valid, false);
	} finally { agents.close(); }
});

test("product migration route previews and journal-migrates the exact legacy selection without owner ID lists", async () => {
	const agents = new CustomAgentStore(":memory:"); const { db, store: plugins } = pluginStore(); const root = mkdtempSync(join(tmpdir(), "designer-route-migration-"));
	try {
		const agent = agents.create({ displayName: "legacy-route", nativeTools: ["legacy_search"], skills: ["personal-skill"], contextFiles: ["personal-context"], goalControl: false, runControl: false });
		const installed = installation("fixture.search", [contribution("search", { name: "legacy_search", title: "Search" })]);
		const catalog = { schemaVersion: 1, revision: 1, installations: [installed] };
		const common = { agents, catalog, pluginStore: plugins, migrationBackupRoot: root, resolveRuntime: () => runtime(), legacyCatalog: {
			nativeTools: [{ name: "legacy_search", yieldable: false }], skills: [{ name: "personal-skill", kind: "user" }], contextFiles: [{ key: "personal-context" }],
		} };
		const previewResponse = await handleAgentPluginRoute({ ...common, route: { kind: "migration", action: "preview", agentId: agent.id }, request: new Request("http://fixture/api/chat/agents/x/plugin-migration") });
		const preview = await previewResponse.json();
		assert.equal(preview.report.status, "ready");
		assert.deepEqual(preview.report.beforeTools, ["legacy_search"]);
		assert.deepEqual(preview.report.userSkills, ["personal-skill"]);
		assert.deepEqual(preview.report.userContextFiles, ["personal-context"]);
		const applyResponse = await handleAgentPluginRoute({ ...common, route: { kind: "migration", action: "apply", agentId: agent.id }, request: new Request("http://fixture/api/chat/agents/x/plugin-migration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: agent.revision, sourceHash: preview.report.sourceHash }) }) });
		const applied = await applyResponse.json();
		assert.equal(applied.agent.revision, 2);
		assert.deepEqual(applied.agent.pluginSelection.plugins[0].contributions, { search: true });
		assert.deepEqual(applied.agent.skills, ["personal-skill"]);
		assert.deepEqual(applied.agent.contextFiles, ["personal-context"]);
		const repeated = await handleAgentPluginRoute({ ...common, route: { kind: "migration", action: "apply", agentId: agent.id }, request: new Request("http://fixture/api/chat/agents/x/plugin-migration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: agent.revision, sourceHash: preview.report.sourceHash }) }) });
		assert.equal((await repeated.json()).idempotent, true);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("legacy independent resource collisions are explained and block migration without changing the agent", () => {
	const agents = new CustomAgentStore(":memory:");
	try {
		const agent = agents.create({ displayName: "legacy-collision", skills: ["shared"], goalControl: false });
		const installed = installation("fixture.skill", [{ ...contribution("shared", { kind: "skill", name: "shared" }) }]);
		const catalog = { schemaVersion: 1, revision: 1, installations: [installed] };
		const source = agents.exportLegacyAgent(agent.id);
		const inventory = inventoryLegacyAgentSelection(agent, { catalog: { nativeTools: [], skills: [{ name: "shared", kind: "user" }], contextFiles: [] }, pluginCatalog: catalog, runtime: runtime() });
		const report = planLegacyAgentPluginMigration({ agent, source, catalog, runtime: runtime(), ...inventory });
		assert.equal(report.status, "conflict");
		assert.ok(report.diagnostics.some((item) => item.code === "resource-name-conflict"));
		assert.equal(agents.get(agent.id).pluginSelection, undefined);
	} finally { agents.close(); }
});


test("unavailable saved skill references survive migration without blocking selected tools or enabling replacements", async () => {
	const agents = new CustomAgentStore(":memory:");
	const { db, store: plugins } = pluginStore();
	const root = mkdtempSync(join(tmpdir(), "legacy-unavailable-skill-"));
	try {
		const agent = agents.create({ displayName: "retained-skills", nativeTools: ["legacy_search"], skills: ["unavailable-personal-reference", "host-skill"], goalControl: false, runControl: false });
		const catalog = { schemaVersion: 1, revision: 1, installations: [installation("fixture.search", [contribution("legacy_search")])] };
		const inventory = inventoryLegacyAgentSelection(agent, { catalog: { nativeTools: [{ name: "legacy_search", yieldable: false }], skills: [{ name: "host-skill", kind: "builtin", pluginId: "legacy.owner" }], contextFiles: [] }, pluginCatalog: catalog, runtime: runtime() });
		const source = agents.exportLegacyAgent(agent.id);
		const report = planLegacyAgentPluginMigration({ agent, source, catalog, runtime: runtime(), ...inventory });
		assert.equal(report.status, "ready");
		assert.deepEqual(report.beforeTools, ["legacy_search"]);
		assert.deepEqual(report.afterTools, report.beforeTools);
		assert.deepEqual(report.userSkills, ["unavailable-personal-reference", "host-skill"]);
		assert.deepEqual(inventory.harnessSkills, ["host-skill"]);
		assert.equal(report.diagnostics.find(item => item.code === "legacy-resource-unavailable")?.severity, "warning");
		await migrateLegacyAgentPlugins({ agents, plugins, agentId: agent.id, source, report, backupRoot: root });
		assert.deepEqual(agents.get(agent.id).skills, agent.skills);
		assert.deepEqual(agents.get(agent.id).pluginSelection.plugins.map(item => item.pluginId), ["fixture.search"]);
	} finally { agents.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});
