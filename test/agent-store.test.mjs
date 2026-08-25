import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createCustomAgentProfileDefinition } from "../dist/apps/chat/agent-profiles.js";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { normalizeAgentSubagents } from "../dist/apps/chat/chat-request-normalizers.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const retiredStorageColumn = `${retiredWord}_scope`;

async function withCwd(cwd, run) {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

test("custom agent store normalizes legacy custom-agent profile names before listing", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE chat_agents (
			id TEXT PRIMARY KEY,
			profile_name TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			description TEXT,
			native_tools_json TEXT NOT NULL,
			skills_json TEXT NOT NULL,
			context_files_json TEXT NOT NULL,
			subagents_json TEXT NOT NULL,
			builtin_tools TEXT NOT NULL,
			run_control INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`);
	db.prepare(`
		INSERT INTO chat_agents (
			id,
			profile_name,
			display_name,
			description,
			native_tools_json,
			skills_json,
			context_files_json,
			subagents_json,
			builtin_tools,
			run_control,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"test-agent-2",
		null,
		"[]",
		"[]",
		"[]",
		"[]",
		"default",
		0,
		"2026-05-01T00:00:00.000Z",
		"2026-05-01T00:00:00.000Z",
	);
	db.close();

	const store = new CustomAgentStore(path);
	const [agent] = store.list();
	assert.equal(agent.profileName, "test-agent-2");
	assert.equal(agent.displayName, "test-agent-2");
	assert.equal(retiredPartitionField in agent, false);
	store.close();

	const migratedDb = new DatabaseSync(path);
	assert.equal(
		migratedDb.prepare("SELECT profile_name FROM chat_agents WHERE id = ?").get("agent_02d60a56-9bd4-4606-921b-495e3daf69d8").profile_name,
		"test-agent-2",
	);
	assert.equal(tableColumns(migratedDb, "chat_agents").has(retiredStorageColumn), false);
	migratedDb.close();
});

test("custom agent store migrates old app-context tables with stable defaults", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE chat_agents (
			id TEXT PRIMARY KEY,
			profile_name TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			description TEXT,
			native_tools_json TEXT NOT NULL,
			skills_json TEXT NOT NULL,
			context_files_json TEXT NOT NULL,
			subagents_json TEXT NOT NULL,
			builtin_tools TEXT NOT NULL,
			run_control INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`);
	db.prepare(`
		INSERT INTO chat_agents (
			id,
			profile_name,
			display_name,
			description,
			native_tools_json,
			skills_json,
			context_files_json,
			subagents_json,
			builtin_tools,
			run_control,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"agent_legacy_defaults",
		"legacy-defaults",
		"legacy-defaults",
		null,
		"[]",
		"[]",
		"[]",
		"[]",
		"default",
		0,
		"2026-05-01T00:00:00.000Z",
		"2026-05-01T00:00:00.000Z",
	);
	db.close();

	const store = new CustomAgentStore(path);
	const agent = store.get("agent_legacy_defaults");
	assert.ok(agent);

	assert.equal(agent.runtimeInstanceId, "pi");
	assert.deepEqual(agent.runtimeOptions, {});
	assert.equal(agent.autoContextFiles, true);
	assert.deepEqual(agent.mcpServers, []);
	assert.deepEqual(agent.piPackages, []);
	assert.deepEqual(agent.builtinToolNames, ["read", "bash", "edit", "write"]);
	assert.equal(agent.mainModel, undefined);
	assert.equal(agent.subagentModel, undefined);
	assert.equal(agent.thinkingLevel, undefined);
	assert.equal(agent.mainThinkingLevel, undefined);
	assert.equal(agent.subagentThinkingLevel, undefined);
	assert.equal(agent.fast, undefined);
	assert.equal(agent.mainFast, undefined);
	assert.equal(agent.subagentFast, undefined);
	assert.equal(agent.archivedAt, undefined);
	assert.equal(agent.runControl, false);
	assert.equal(agent.folderId, undefined);

	const migratedFolder = store.createFolder("Migrated");
	assert.equal(store.update(agent.id, { folderId: migratedFolder.id }).folderId, migratedFolder.id);

	store.close();
});

test("custom agent store archives and deletes agents", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({ displayName: "archive-me" });

	assert.deepEqual(store.list().map((item) => item.profileName), ["archive-me"]);
	const archived = store.setArchived(agent.id, true);
	assert.ok(archived.archivedAt);
	assert.deepEqual(store.list(), []);
	assert.deepEqual(store.list({ includeArchived: true }).map((item) => item.profileName), ["archive-me"]);

	const restored = store.setArchived(agent.id, false);
	assert.equal(restored.archivedAt, undefined);
	assert.equal(store.delete(agent.id), true);
	assert.equal(store.get(agent.id), undefined);

	store.close();
});

test("custom agent store organizes agents in durable renamable folders", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-folders-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const research = store.createFolder("Research");
	const delivery = store.createFolder("Delivery");

	assert.deepEqual(store.listFolders().map((folder) => folder.name), ["Delivery", "Research"]);
	assert.throws(() => store.createFolder("research"), /already exists/);

	const agent = store.create({ displayName: "folder-agent", folderId: research.id });
	assert.equal(agent.folderId, research.id);
	assert.throws(() => store.deleteFolder(research.id), /Move agents out/);

	const moved = store.update(agent.id, { folderId: delivery.id });
	assert.equal(moved.folderId, delivery.id);
	const renamed = store.renameFolder(delivery.id, "Production");
	assert.equal(renamed.name, "Production");

	const unfiled = store.update(agent.id, { folderId: null });
	assert.equal(unfiled.folderId, undefined);
	assert.equal(store.deleteFolder(research.id), true);
	assert.equal(store.deleteFolder(delivery.id), true);
	assert.deepEqual(store.listFolders(), []);
	assert.throws(() => store.update(agent.id, { folderId: "agent_folder_missing" }), /does not exist/);

	store.close();
	const reopened = new CustomAgentStore(path);
	assert.equal(reopened.get(agent.id).folderId, undefined);
	reopened.close();
});

test("custom agent profile renames leave old session profile names resolvable", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({ displayName: "dots-grid-agent" });
	const renamed = store.update(agent.id, { displayName: "unity-agent" });

	assert.equal(renamed.profileName, "unity-agent");
	assert.deepEqual(renamed.profileAliases, ["dots-grid-agent"]);
	assert.throws(
		() => store.create({ displayName: "dots-grid-agent" }),
		/Agent name "dots-grid-agent" already exists/,
	);

	const registry = createDefaultPiboPluginRegistry();
	registry.upsertProfile(createCustomAgentProfileDefinition(renamed));
	assert.equal(registry.resolveProfileName("dots-grid-agent"), "unity-agent");
	assert.equal(registry.resolveProfileName(agent.id), "unity-agent");

	store.close();

	const db = new DatabaseSync(path);
	const aliasRow = db.prepare("SELECT agent_id, old_profile_name, new_profile_name FROM chat_agent_profile_aliases WHERE old_profile_name = ?").get("dots-grid-agent");
	assert.equal(aliasRow.agent_id, agent.id);
	assert.equal(aliasRow.old_profile_name, "dots-grid-agent");
	assert.equal(aliasRow.new_profile_name, "unity-agent");
	db.prepare("UPDATE chat_agents SET profile_name = ?, display_name = ? WHERE id = ?").run("final-agent", "final-agent", agent.id);
	db.close();

	const reopened = new CustomAgentStore(path);
	const directlyRenamed = reopened.get(agent.id);
	assert.equal(directlyRenamed.profileName, "final-agent");
	assert.deepEqual(directlyRenamed.profileAliases, ["dots-grid-agent", "unity-agent"]);
	reopened.close();
});

test("custom agent store records agent rename and deletion history", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({ displayName: "rename-source" });
	store.update(agent.id, { displayName: "renamed-agent" });
	store.close();

	const db = new DatabaseSync(path);
	db.prepare("UPDATE chat_agents SET profile_name = ?, display_name = ? WHERE id = ?").run("direct-profile", "direct-display", agent.id);
	db.prepare("DELETE FROM chat_agents WHERE id = ?").run(agent.id);

	const rows = db.prepare(`
		SELECT event_type, field_name, old_value, new_value, old_profile_name, new_profile_name, old_display_name, new_display_name
		FROM chat_agent_history
		WHERE agent_id = ?
	`).all(agent.id);

	assert.equal(rows.length, 5);
	assert.ok(rows.find((row) => row.event_type === "updated" && row.field_name === "profile_name" && row.old_value === "rename-source" && row.new_value === "renamed-agent"));
	assert.ok(rows.find((row) => row.event_type === "updated" && row.field_name === "display_name" && row.old_value === "rename-source" && row.new_value === "renamed-agent"));
	assert.ok(rows.find((row) => row.event_type === "updated" && row.field_name === "profile_name" && row.old_value === "renamed-agent" && row.new_value === "direct-profile"));
	assert.ok(rows.find((row) => row.event_type === "updated" && row.field_name === "display_name" && row.old_value === "renamed-agent" && row.new_value === "direct-display"));
	assert.ok(rows.find((row) => row.event_type === "deleted" && row.field_name === null && row.old_profile_name === "direct-profile" && row.new_profile_name === null && row.old_display_name === "direct-display"));

	db.close();
});

test("custom agent names are globally unique and lists are app-global across legacy accounts", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const first = store.create({ displayName: "shared-agent" });

	assert.throws(
		() => store.create({ displayName: "shared-agent" }),
		/Agent name "shared-agent" already exists/,
	);
	assert.deepEqual(store.list().map((agent) => agent.profileName), ["shared-agent"]);
	assert.deepEqual(store.list().map((agent) => agent.profileName), ["shared-agent"]);

	store.close();
});

test("custom agent store lists all app-global agents", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	store.create({ displayName: "shared-history" });
	store.create({ displayName: "user-history" });

	assert.deepEqual(store.list().map((agent) => agent.profileName).sort(), ["shared-history", "user-history"]);
	assert.equal(retiredPartitionField in store.list()[0], false);

	store.close();
});

test("custom agent store migrates duplicate profile names before enforcing global uniqueness", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE chat_agents (
			id TEXT PRIMARY KEY,
			profile_name TEXT NOT NULL,
			display_name TEXT NOT NULL,
			description TEXT,
			native_tools_json TEXT NOT NULL,
			skills_json TEXT NOT NULL,
			context_files_json TEXT NOT NULL,
			subagents_json TEXT NOT NULL,
			builtin_tools TEXT NOT NULL,
			run_control INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
	const insert = db.prepare(`
		INSERT INTO chat_agents (
			id, profile_name, display_name, description, native_tools_json, skills_json,
			context_files_json, subagents_json, builtin_tools, run_control, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	insert.run("agent_old", "helper", "helper", null, "[]", "[]", "[]", "[]", "default", 0, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
	insert.run("agent_new", "helper", "helper", null, "[]", "[]", "[]", "[]", "default", 0, "2026-05-02T00:00:00.000Z", "2026-05-02T00:00:00.000Z");
	db.close();

	const store = new CustomAgentStore(path);
	const agents = store.list({ includeArchived: true }).sort((left, right) => left.id.localeCompare(right.id));
	assert.equal(agents.length, 2);
	assert.equal(agents.find((agent) => agent.id === "agent_new").profileName, "helper");
	assert.match(agents.find((agent) => agent.id === "agent_old").profileName, /^helper-legacy-[a-f0-9]{8}$/);
	assert.ok(agents.every((agent) => !(retiredPartitionField in agent)));
	store.close();

	const migratedDb = new DatabaseSync(path);
	assert.equal(tableColumns(migratedDb, "chat_agents").has(retiredStorageColumn), false);
	migratedDb.close();
});

test("custom agent store defaults goal lifecycle tools on and persists disabling them", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-goal-control-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	try {
		const created = store.create({ displayName: "goal-control-agent" });
		assert.equal(created.goalControl, true);
		const disabled = store.update(created.id, { goalControl: false });
		assert.equal(disabled.goalControl, false);
		const registry = createDefaultPiboPluginRegistry();
		const profile = createCustomAgentProfileDefinition(disabled).create({
			getTool: (name) => registry.getTool(name),
			getTools: (names) => registry.getTools(names),
			getSkill: (name) => registry.getSkill(name),
			getContextFile: (key) => registry.getContextFile(key),
		});
		assert.equal(profile.toolPackages.goalControl, false);
	} finally {
		store.close();
	}
});

test("custom agent store persists automatic context file setting", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const defaultAgent = store.create({ displayName: "default-context" });
	const disabledAgent = store.create({
		displayName: "disabled-context",
		autoContextFiles: false,
	});

	assert.equal(defaultAgent.autoContextFiles, true);
	assert.equal(disabledAgent.autoContextFiles, false);

	const updated = store.update(defaultAgent.id, { autoContextFiles: false });
	assert.equal(updated.autoContextFiles, false);

	store.close();
});

test("custom agent store keeps automatic context concrete while native-subagent overrides remain nullable", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-runtime-features-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "runtime-feature-agent",
		autoContextFiles: false,
		nativeSubagents: false,
	});
	assert.equal(agent.autoContextFiles, false);
	assert.equal(agent.nativeSubagents, false);

	const cleared = store.update(agent.id, { autoContextFiles: null, nativeSubagents: null });
	assert.equal(cleared.autoContextFiles, true);
	assert.equal(cleared.nativeSubagents, undefined);
	store.close();

	const reopened = new CustomAgentStore(path);
	const persisted = reopened.get(agent.id);
	assert.equal(persisted.autoContextFiles, true);
	assert.equal(persisted.nativeSubagents, undefined);
	reopened.close();

	const db = new DatabaseSync(path);
	assert.equal(tableColumns(db, "chat_agents").has("auto_context_files_override"), false);
	assert.ok(tableColumns(db, "chat_agents").has("native_subagents"));
	assert.equal(db.prepare("SELECT auto_context_files, native_subagents FROM chat_agents WHERE id = ?").get(agent.id).auto_context_files, 1);
	assert.equal(db.prepare("SELECT auto_context_files, native_subagents FROM chat_agents WHERE id = ?").get(agent.id).native_subagents, null);
	db.close();
});

test("custom agent store persists runtime instance selection and adapter options", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-runtime-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "native-runtime-agent",
		runtimeInstanceId: "codex-native",
		runtimeOptions: { model: "gpt-5.6-codex", reasoningEffort: "high", nested: { enabled: true } },
	});

	assert.equal(agent.runtimeInstanceId, "codex-native");
	assert.deepEqual(agent.runtimeOptions, { model: "gpt-5.6-codex", reasoningEffort: "high", nested: { enabled: true } });
	const updated = store.update(agent.id, {
		runtimeInstanceId: "pi",
		runtimeOptions: {},
	});
	assert.equal(updated.runtimeInstanceId, "pi");
	assert.deepEqual(updated.runtimeOptions, {});
	store.close();

	const reopened = new CustomAgentStore(path);
	assert.equal(reopened.get(agent.id).runtimeInstanceId, "pi");
	assert.deepEqual(reopened.get(agent.id).runtimeOptions, {});
	reopened.close();

	const db = new DatabaseSync(path);
	assert.ok(tableColumns(db, "chat_agents").has("runtime_instance_id"));
	assert.ok(tableColumns(db, "chat_agents").has("runtime_options_json"));
	db.close();
});

test("custom agent store persists selected MCP servers", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "mcp-context",
		mcpServers: ["filesystem", "filesystem", "deepwiki"],
	});

	assert.deepEqual(agent.mcpServers, ["filesystem", "deepwiki"]);

	const updated = store.update(agent.id, { mcpServers: ["deepwiki"] });
	assert.deepEqual(updated.mcpServers, ["deepwiki"]);
	assert.deepEqual(store.get(agent.id).mcpServers, ["deepwiki"]);

	store.close();
});

test("custom agent store persists selected built-in tools", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "basic-tools",
		builtinToolNames: ["read", "bash", "bash", "unknown"],
	});

	assert.deepEqual(agent.builtinToolNames, ["read", "bash"]);

	const updated = store.update(agent.id, { builtinToolNames: ["read"] });
	assert.deepEqual(updated.builtinToolNames, ["read"]);
	assert.deepEqual(store.get(agent.id).builtinToolNames, ["read"]);

	store.close();
});

test("custom agent store persists thinking, fast, and built-in mode options", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "runtime-options",
		thinkingLevel: "medium",
		mainThinkingLevel: "high",
		subagentThinkingLevel: "low",
		fast: true,
		mainFast: false,
		subagentFast: true,
		builtinTools: "none",
	});

	assert.equal(agent.thinkingLevel, "medium");
	assert.equal(agent.mainThinkingLevel, "high");
	assert.equal(agent.subagentThinkingLevel, "low");
	assert.equal(agent.fast, true);
	assert.equal(agent.mainFast, false);
	assert.equal(agent.subagentFast, true);
	assert.equal(agent.builtinTools, "none");

	const updated = store.update(agent.id, {
		thinkingLevel: "invalid",
		mainThinkingLevel: "minimal",
		subagentThinkingLevel: "xhigh",
		fast: false,
		mainFast: true,
		subagentFast: "yes",
		builtinTools: "selected",
	});
	assert.equal(updated.thinkingLevel, undefined);
	assert.equal(updated.mainThinkingLevel, "minimal");
	assert.equal(updated.subagentThinkingLevel, "xhigh");
	assert.equal(updated.fast, false);
	assert.equal(updated.mainFast, true);
	assert.equal(updated.subagentFast, undefined);
	assert.equal(updated.builtinTools, "selected");

	assert.deepEqual(store.get(agent.id), updated);

	store.close();
});

test("custom agent store persists selected registered Pi packages", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-agent-store-pi-packages-"));
	await withCwd(cwd, () => {
		upsertPiPackage({
			id: "demo-package",
			name: "demo-package",
			source: "/tmp/demo-package",
			installSpec: "/tmp/demo-package",
			resourceTypes: ["extension"],
			installStatus: "installed",
			installPath: "/tmp/demo-package",
			diagnostics: [],
		});
		const store = new CustomAgentStore(join(cwd, "agents.sqlite"));
		const agent = store.create({
			displayName: "package-agent",
			piPackages: ["demo-package", "demo-package"],
		});

		assert.deepEqual(agent.piPackages, ["demo-package"]);
		assert.throws(
			() => store.update(agent.id, { piPackages: ["missing-package"] }),
			/Unknown Pi package "missing-package"/,
		);

		store.close();
	});
});

test("custom agent store persists main and legacy subagent model overrides", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "model-agent",
		mainModel: { provider: "openai", id: "gpt-5.4" },
		subagentModel: { provider: "kimi-coding", id: "kimi-for-coding" },
	});

	assert.deepEqual(agent.mainModel, { provider: "openai", id: "gpt-5.4" });
	assert.deepEqual(agent.subagentModel, { provider: "kimi-coding", id: "kimi-for-coding" });

	const updated = store.update(agent.id, { subagentModel: { provider: "openai", id: "gpt-5.5" } });
	assert.deepEqual(updated.mainModel, { provider: "openai", id: "gpt-5.4" });
	assert.deepEqual(updated.subagentModel, { provider: "openai", id: "gpt-5.5" });

	const cleared = store.update(agent.id, { mainModel: null, subagentModel: null });
	assert.equal(cleared.mainModel, undefined);
	assert.equal(cleared.subagentModel, undefined);

	store.close();
});

test("custom agent store persists per-subagent descriptions, models, thinking levels, and runtime overrides", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		displayName: "delegating-agent",
		subagents: [{
			name: "researcher",
			description: "Research current sources and report evidence.",
			targetProfile: "research-profile",
			model: { provider: "openai", id: "gpt-5.6-mini" },
			thinkingLevel: "high",
			runtimeOptions: { permissionMode: "yolo" },
			maxDepth: 2,
		}],
	});

	assert.deepEqual(agent.subagents, [{
		name: "researcher",
		description: "Research current sources and report evidence.",
		targetProfile: "research-profile",
		model: { provider: "openai", id: "gpt-5.6-mini" },
		thinkingLevel: "high",
		runtimeOptions: { permissionMode: "yolo" },
		maxDepth: 2,
	}]);

	const updated = store.update(agent.id, {
		subagents: [{
			name: "researcher",
			targetProfile: "research-profile",
			model: { provider: " ", id: "invalid" },
			thinkingLevel: "unsupported",
		}],
	});
	assert.deepEqual(updated.subagents, [{ name: "researcher", targetProfile: "research-profile" }]);

	store.close();
});

test("custom agent request normalization accepts JSON subagent runtime overrides", () => {
	assert.deepEqual(normalizeAgentSubagents([{
		name: " planner ",
		targetProfile: " codex-agent ",
		runtimeOptions: { permissionMode: "plan", nested: { enabled: true } },
	}]), [{
		name: "planner",
		targetProfile: "codex-agent",
		runtimeOptions: { permissionMode: "plan", nested: { enabled: true } },
	}]);
	assert.throws(
		() => normalizeAgentSubagents([{ name: "planner", targetProfile: "codex-agent", runtimeOptions: [] }]),
		/subagent runtimeOptions must be a JSON object/,
	);
});

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}
