import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { handleChatUserSkillRoute, syncChatUserSkills } from "../dist/apps/chat/chat-user-skill-routes.js";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";
import { createPiboProfileFromRegistryOrDefault } from "../dist/plugins/builtin.js";
import { UserSkillManager } from "../dist/user-skills/manager.js";

function createSkill(manager, name, description = `${name} instructions`) {
	return manager.create({
		name,
		description,
		markdown: `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
	});
}

test("web gateway registers user skills before custom agent profiles are used", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-user-skill-profiles-"));
	const globalRoot = join(dir, "global");
	const workspaceRoot = join(dir, "workspace");
	const agentStorePath = join(dir, "chat-agents.sqlite");
	const globalSkills = new UserSkillManager(globalRoot, "global");
	const workspaceSkills = new UserSkillManager(workspaceRoot, "workspace");
	const globalTexture = createSkill(globalSkills, "texture-helper", "global texture helper");
	createSkill(globalSkills, "workspace-wins", "global fallback");
	const workspaceWinner = createSkill(workspaceSkills, "workspace-wins", "workspace override");
	const disabled = createSkill(globalSkills, "disabled-helper");
	globalSkills.setEnabled(disabled.id, false);
	createSkill(globalSkills, "skill-creator", "must not replace the built-in skill");

	{
		const store = new CustomAgentStore(agentStorePath);
		try {
			store.create({
				displayName: "unity-agent",
				skills: ["skill-creator", "texture-helper", "workspace-wins"],
			});
		} finally {
			store.close();
		}
	}

	const warnings = [];
	const originalWarn = console.warn;
	try {
		console.warn = (...args) => warnings.push(args.join(" "));
		const registry = createWebPiboPluginRegistry({
			chat: { agentStorePath, userSkillGlobalRoot: globalRoot, userSkillWorkspaceRoot: workspaceRoot },
		});
		const profile = createPiboProfileFromRegistryOrDefault(registry, "unity-agent");
		const profileSkillNames = profile.skills.map((skill) => skill.name);
		const catalogSkillByName = new Map(registry.getCapabilityCatalog().skills.map((skill) => [skill.name, skill]));

		assert.deepEqual(profileSkillNames, ["skill-creator", "texture-helper", "workspace-wins"]);
		assert.equal(catalogSkillByName.get("texture-helper")?.path, globalTexture.path);
		assert.equal(catalogSkillByName.get("workspace-wins")?.path, workspaceWinner.path);
		assert.equal(catalogSkillByName.has("disabled-helper"), false);
		assert.equal(catalogSkillByName.get("skill-creator")?.kind, "builtin");
		assert.deepEqual(warnings, []);
	} finally {
		console.warn = originalWarn;
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});

test("web gateway startup survives a malformed user skill store", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-malformed-user-skills-"));
	const globalRoot = join(dir, "global");
	const workspaceRoot = join(dir, "workspace");
	const agentStorePath = join(dir, "chat-agents.sqlite");
	await mkdir(join(globalRoot, ".pibo"), { recursive: true });
	await writeFile(join(globalRoot, ".pibo", "user-skills.json"), JSON.stringify({ version: 99, skills: [] }));
	createSkill(new UserSkillManager(workspaceRoot, "workspace"), "workspace-helper");
	const warnings = [];
	const originalWarn = console.warn;
	try {
		console.warn = (...args) => warnings.push(args.join(" "));
		const registry = createWebPiboPluginRegistry({
			chat: { agentStorePath, userSkillGlobalRoot: globalRoot, userSkillWorkspaceRoot: workspaceRoot },
		});
		assert.ok(registry.getProfileNames().includes("base"));
		assert.ok(registry.getCapabilityCatalog().skills.some((skill) => skill.name === "workspace-helper"));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /Skipping global startup user-skill registration/);
		assert.match(warnings[0], /Unsupported user skills store/);
	} finally {
		console.warn = originalWarn;
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});

test("chat user skill sync adopts startup-registered skills without duplicate registration", () => {
	const registerCalls = [];
	const unregisterCalls = [];
	let syncedNames;
	const startupSkill = {
		id: "skill-1",
		name: "texture-helper",
		description: "Texture helper",
		path: "/skills/texture-helper/SKILL.md",
		enabled: true,
		source: "user-created",
		scope: "global",
		createdAt: "2026-07-11T00:00:00.000Z",
		updatedAt: "2026-07-11T00:00:00.000Z",
	};

	syncChatUserSkills({
		userSkillManager: { list: () => [startupSkill] },
		channelContext: {
			getCapabilityCatalog: () => ({ skills: [{ name: startupSkill.name, path: startupSkill.path, kind: "user" }] }),
			registerSkill: (skill) => registerCalls.push(skill),
			unregisterSkill: (name) => unregisterCalls.push(name),
		},
		setSyncedUserSkillNames: (names) => { syncedNames = names; },
	});

	assert.deepEqual(registerCalls, []);
	assert.deepEqual(unregisterCalls, []);
	assert.deepEqual([...syncedNames], ["texture-helper"]);
});

test("enabling a legacy user skill cannot shadow a built-in skill", async () => {
	const legacySkill = {
		id: "legacy-skill",
		name: "skill-creator",
		description: "Legacy collision",
		path: "/skills/skill-creator/SKILL.md",
		enabled: false,
		source: "user-created",
		scope: "global",
		createdAt: "2026-07-11T00:00:00.000Z",
		updatedAt: "2026-07-11T00:00:00.000Z",
	};
	let updated = false;

	await assert.rejects(
		handleChatUserSkillRoute({
			route: { kind: "user-skill-update", skillId: legacySkill.id },
			request: new Request(`http://localhost/api/chat/user-skills/${legacySkill.id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
			userSkillManager: {
				get: () => legacySkill,
				update: () => { updated = true; return { ...legacySkill, enabled: true }; },
			},
			channelContext: {
				getCapabilityCatalog: () => ({ skills: [{ name: "skill-creator", path: "/builtin/SKILL.md", kind: "builtin" }] }),
			},
			setSyncedUserSkillNames: () => {},
			invalidateBootstrapCatalogCache: () => {},
		}),
		/conflicts with an existing registered skill/,
	);
	assert.equal(updated, false);
});

test("chat user skill sync removes a startup-registered skill that was disabled", () => {
	const unregisterCalls = [];
	let syncedNames;
	const disabledSkill = {
		id: "skill-2",
		name: "disabled-helper",
		description: "Disabled helper",
		path: "/skills/disabled-helper/SKILL.md",
		enabled: false,
		source: "user-created",
		scope: "global",
		createdAt: "2026-07-11T00:00:00.000Z",
		updatedAt: "2026-07-11T00:00:00.000Z",
	};

	syncChatUserSkills({
		userSkillManager: { list: () => [disabledSkill] },
		channelContext: {
			getCapabilityCatalog: () => ({ skills: [{ name: disabledSkill.name, path: disabledSkill.path, kind: "user" }] }),
			registerSkill: () => assert.fail("disabled skill must not be registered"),
			unregisterSkill: (name) => unregisterCalls.push(name),
		},
		setSyncedUserSkillNames: (names) => { syncedNames = names; },
	});

	assert.deepEqual(unregisterCalls, ["disabled-helper"]);
	assert.deepEqual([...syncedNames], []);
});
