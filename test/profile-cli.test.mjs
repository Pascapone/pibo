import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo profile resolves active saved Chat custom agents", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-profile-custom-agent-"));
	const piboHome = join(cwd, "pibo-home");
	await mkdir(piboHome, { recursive: true });
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
				skills: ["graphify", "missing-skill"],
				contextFiles: ["ctx:missing-context"],
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
		assert.ok(profile.tools.some((tool) => tool.name === "web_search" && tool.active));
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
