import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { ContextFileMetadataStore } from "../dist/plugins/context-files-store.js";
import { UserSkillManager } from "../dist/user-skills/manager.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo profile exposes native Codex without claiming the codex compatibility alias", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-profile-codex-native-"));
	const piboHome = join(cwd, "pibo-home");
	await mkdir(piboHome, { recursive: true });
	try {
		const env = { ...process.env, PIBO_HOME: piboHome, HOME: cwd };
		const result = await execFileAsync("node", [cliPath, "profile", "codex-native"], { cwd, env });
		const profile = JSON.parse(result.stdout);
		assert.equal(profile.profileName, "codex-native");
		assert.equal(profile.runtimeInstanceId, "codex-native");
		assert.equal(profile.builtinTools, "disabled");
		assert.deepEqual(profile.builtinToolNames, []);
		assert.equal(profile.toolPackages.goalControl, true);

		await assert.rejects(
			() => execFileAsync("node", [cliPath, "profile", "codex"], { cwd, env }),
			(error) => {
				assert.match(error.stderr, /Unknown profile "codex"/);
				assert.match(error.stderr, /codex-native/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo profile resolves active saved Chat custom agents", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-profile-custom-agent-"));
	const piboHome = join(cwd, "pibo-home");
	await mkdir(piboHome, { recursive: true });
	const userSkill = new UserSkillManager(cwd, "global").create({
		name: "unity-user-skill",
		description: "Unity user instructions",
		markdown: "---\nname: unity-user-skill\ndescription: Unity user instructions\n---\n\n# Unity\n",
	});
	const contextPath = join(piboHome, "context-files", "global", "unity-context.md");
	await mkdir(join(piboHome, "context-files", "global"), { recursive: true });
	await writeFile(contextPath, "# Unity context\n");
	{
		const contextStore = new ContextFileMetadataStore(join(piboHome, "context-files", "context-files.sqlite"));
		try {
			contextStore.createFile({
				key: "ctx:unity-context",
				label: "Unity context",
				managedPath: contextPath,
				scope: "global",
				workingContent: "# Unity context\n",
			});
		} finally {
			contextStore.close();
		}
	}
	let live;
	{
		const store = new CustomAgentStore(join(piboHome, "chat-agents.sqlite"));
		try {
			live = store.create({
				displayName: "unity-agent",
				description: "Unity runtime agent",
				mainModel: { provider: "openai-codex", id: "gpt-5.5" },
				mainThinkingLevel: "xhigh",
				fast: false,
				nativeTools: ["web_search"],
				skills: ["graphify", "unity-user-skill", "missing-skill"],
				contextFiles: ["ctx:unity-context", "ctx:missing-context"],
				mcpServers: ["unity"],
				runControl: true,
			});
			const archived = store.create({ displayName: "old-agent" });
			store.setArchived(archived.id, true);
		} finally {
			store.close();
		}
	}

	try {
		const env = { ...process.env, PIBO_HOME: piboHome, HOME: cwd };
		const result = await execFileAsync("node", [cliPath, "profile", "unity-agent"], { cwd, env });
		const profile = JSON.parse(result.stdout);

		assert.equal(profile.profileName, "unity-agent");
		assert.deepEqual(profile.mainModel, { provider: "openai-codex", id: "gpt-5.5" });
		assert.equal(profile.mainThinkingLevel, "xhigh");
		assert.equal(profile.fast, false);
		assert.equal(profile.toolPackages.runControl, true);
		assert.deepEqual(profile.mcpServers, ["unity"]);
		assert.ok(profile.skills.some((skill) => skill.name === "graphify"));
		assert.ok(profile.skills.some((skill) => skill.name === "unity-user-skill" && skill.path === userSkill.path));
		assert.ok(profile.contextFiles.some((file) => file.path === contextPath));
		assert.ok(profile.tools.some((tool) => tool.name === "web_search" && tool.active));
		assert.ok(profile.diagnostics.some((diagnostic) => diagnostic.message.includes("[custom_agent_unknown_skill]") && diagnostic.message.includes("missing-skill")));
		assert.ok(profile.diagnostics.some((diagnostic) => diagnostic.message.includes("[custom_agent_unknown_context_file]") && diagnostic.message.includes("ctx:missing-context")));
		assert.match(result.stderr, /Skipping unknown skill "missing-skill" for custom agent "unity-agent"/);
		assert.match(result.stderr, /Skipping unknown context file "ctx:missing-context" for custom agent "unity-agent"/);

		const aliasResult = await execFileAsync("node", [cliPath, "profile", live.id], { cwd, env });
		assert.equal(JSON.parse(aliasResult.stdout).profileName, "unity-agent");

		await assert.rejects(
			() => execFileAsync("node", [cliPath, "profile", "old-agent"], { cwd, env }),
			(error) => {
				assert.match(error.stderr, /Unknown profile "old-agent"/);
				assert.doesNotMatch(error.stderr, /Available profiles: .*old-agent/);
				return true;
			},
		);

		const help = await execFileAsync("node", [cliPath, "profile", "--help"], { cwd, env });
		assert.match(help.stdout, /active saved Chat custom agents/);
		assert.match(help.stdout, /\$PIBO_HOME\/chat-agents\.sqlite/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo profile resolves persisted subagent targets and recovers after a missing target is updated away", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-profile-subagent-target-"));
	const piboHome = join(cwd, "pibo-home");
	await mkdir(piboHome, { recursive: true });
	const storePath = join(piboHome, "chat-agents.sqlite");
	let target;
	let parent;
	{
		const store = new CustomAgentStore(storePath);
		try {
			target = store.create({ displayName: "cli-target" });
			parent = store.create({
				displayName: "cli-parent",
				subagents: [{ name: "helper", targetProfile: target.profileName }],
			});
		} finally {
			store.close();
		}
	}

	try {
		const env = { ...process.env, PIBO_HOME: piboHome, HOME: cwd };
		const resolved = await execFileAsync("node", [cliPath, "profile", parent.profileName], { cwd, env });
		assert.deepEqual(JSON.parse(resolved.stdout).subagents, [{
			name: "helper",
			targetProfile: target.profileName,
			active: true,
		}]);

		const db = new DatabaseSync(storePath);
		db.prepare("DELETE FROM chat_agents WHERE id = ?").run(target.id);
		db.close();
		await assert.rejects(
			() => execFileAsync("node", [cliPath, "profile", parent.profileName], { cwd, env }),
			(error) => {
				assert.match(error.stderr, /Unknown profile "cli-target"/);
				return true;
			},
		);

		const repaired = new CustomAgentStore(storePath);
		try {
			assert.deepEqual(repaired.update(parent.id, { subagents: [] }).subagents, []);
		} finally {
			repaired.close();
		}
		const updated = await execFileAsync("node", [cliPath, "profile", parent.profileName], { cwd, env });
		assert.deepEqual(JSON.parse(updated.stdout).subagents, []);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
