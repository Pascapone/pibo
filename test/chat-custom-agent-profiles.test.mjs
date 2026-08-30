import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";
import { createPiboProfileFromRegistryOrDefault } from "../dist/plugins/builtin.js";

test("web gateway registry loads custom agent profiles before channels start", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-custom-agent-profiles-"));
	const agentStorePath = join(dir, "chat-agents.sqlite");
	let live;
	{
		const store = new CustomAgentStore(agentStorePath);
		try {
			live = store.create({
				displayName: "unity-agent",
				description: "Unity runtime agent",
				mainModel: { provider: "openai-codex", id: "gpt-5.5" },
				mainModelFallbacks: [
					{ provider: "anthropic", id: "claude-sonnet-5" },
					{ provider: "moonshot", id: "kimi-k2" },
				],
				mainThinkingLevel: "xhigh",
				runControl: true,
			});
			const archived = store.create({ displayName: "old-agent" });
			store.setArchived(archived.id, true);
		} finally {
			store.close();
		}
	}

	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local", chat: { agentStorePath } });
		const profileInfos = registry.getProfileInfos();

		assert.ok(profileInfos.some((profile) => profile.name === "unity-agent"));
		assert.ok(!profileInfos.some((profile) => profile.name === "old-agent"));
		assert.ok(profileInfos.find((profile) => profile.name === "unity-agent")?.aliases.includes(live.id));

		const profile = createPiboProfileFromRegistryOrDefault(registry, "unity-agent");
		assert.equal(profile.profileName, "unity-agent");
		assert.deepEqual(profile.mainModel, { provider: "openai-codex", id: "gpt-5.5" });
		assert.deepEqual(profile.mainModelFallbacks, [
			{ provider: "anthropic", id: "claude-sonnet-5" },
			{ provider: "moonshot", id: "kimi-k2" },
		]);
		assert.equal(profile.mainThinkingLevel, "xhigh");
	} finally {
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});

test("web gateway registry loads duplicate legacy custom agents after migration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-custom-agent-duplicate-profiles-"));
	const agentStorePath = join(dir, "chat-agents.sqlite");
	const db = new DatabaseSync(agentStorePath);
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
		)
	`);
	const insert = db.prepare(`
		INSERT INTO chat_agents (
			id, profile_name, display_name, description,
			native_tools_json, skills_json, context_files_json, subagents_json,
			builtin_tools, run_control, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	insert.run("agent_old", "helper", "helper", null, "[]", "[]", "[]", "[]", "default", 0, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
	insert.run("agent_new", "helper", "helper", null, "[]", "[]", "[]", "[]", "default", 0, "2026-05-02T00:00:00.000Z", "2026-05-02T00:00:00.000Z");
	insert.run("agent_control", "scout", "scout", null, "[]", "[]", "[]", "[]", "default", 0, "2026-05-03T00:00:00.000Z", "2026-05-03T00:00:00.000Z");
	db.close();

	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local", chat: { agentStorePath } });
		const store = new CustomAgentStore(agentStorePath);
		const migrated = store.list({ includeArchived: true });
		store.close();
		const oldAgent = migrated.find((agent) => agent.id === "agent_old");
		assert.ok(oldAgent);
		assert.match(oldAgent.profileName, /^helper-legacy-[a-f0-9]{8}$/);
		assert.deepEqual(oldAgent.profileAliases, []);
		assert.equal(registry.resolveProfileName("helper"), "helper");
		assert.equal(registry.resolveProfileName(oldAgent.profileName), oldAgent.profileName);
		assert.equal(registry.resolveProfileName("agent_old"), oldAgent.profileName);
		assert.equal(registry.resolveProfileName("scout"), "scout");
	} finally {
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});

test("stale custom agent tool references do not break the profile catalog", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-stale-custom-agent-tool-"));
	const agentStorePath = join(dir, "chat-agents.sqlite");
	let agent;
	{
		const store = new CustomAgentStore(agentStorePath);
		try {
			agent = store.create({ displayName: "stale-tool-agent", nativeTools: ["retired-tool"] });
		} finally {
			store.close();
		}
	}

	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (message) => warnings.push(String(message));
	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local", chat: { agentStorePath } });
		const profileInfos = registry.getProfileInfos();
		const profileInfo = profileInfos.find((profile) => profile.name === agent.profileName);
		assert.ok(profileInfo);
		assert.deepEqual(profileInfo.nativeTools, []);
		assert.doesNotThrow(() => createPiboProfileFromRegistryOrDefault(registry, agent.profileName));
		assert.ok(warnings.some((warning) => warning.includes(`Skipping unknown tool "retired-tool" for custom agent "${agent.profileName}"`)));
	} finally {
		console.warn = originalWarn;
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});
