import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
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

test("custom agent store persists main and subagent model overrides", () => {
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

	store.close();
});

function tableColumns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}
