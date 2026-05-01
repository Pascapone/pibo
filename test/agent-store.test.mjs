import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";

test("custom agent store migrates legacy profile names before listing", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const db = new DatabaseSync(path);
	db.prepare(`
		INSERT INTO chat_agents (
			id,
			profile_name,
			owner_scope,
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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"user:test",
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

	const [agent] = store.list("user:test");
	assert.equal(agent.profileName, "test-agent-2");
	assert.equal(agent.displayName, "test-agent-2");
	assert.equal(
		db.prepare("SELECT profile_name FROM chat_agents WHERE id = ?").get("agent_02d60a56-9bd4-4606-921b-495e3daf69d8").profile_name,
		"test-agent-2",
	);

	db.close();
	store.close();
});

test("custom agent store archives and deletes agents", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({ ownerScope: "user:test", displayName: "archive-me" });

	assert.deepEqual(store.list("user:test").map((item) => item.profileName), ["archive-me"]);
	const archived = store.setArchived(agent.id, true);
	assert.ok(archived.archivedAt);
	assert.deepEqual(store.list("user:test"), []);
	assert.deepEqual(store.list("user:test", { includeArchived: true }).map((item) => item.profileName), ["archive-me"]);

	const restored = store.setArchived(agent.id, false);
	assert.equal(restored.archivedAt, undefined);
	assert.equal(store.delete(agent.id), true);
	assert.equal(store.get(agent.id), undefined);

	store.close();
});
