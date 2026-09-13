import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAgentCatalogMutationScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			removeAgentCatalogUserSkill,
			upsertAgentCatalogUserSkill,
		} = await import("./src/apps/chat-ui/src/app-agent-catalog-mutations.ts");

		function userSkill(overrides = {}) {
			return {
				id: overrides.id ?? "skill-alpha",
				name: overrides.name ?? "alpha-skill",
				description: "Skill",
				path: "/tmp/skill.md",
				enabled: true,
				source: "user-created",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			return {
				identity: { userId: "user-1" },
				selectedRoomId: "room-root",
				selectedPiboSessionId: "ps-root",
				rooms: [],
				sessions: [],
				agents: [],
				customAgents: [],
				agentFolders: [],
				modelDefaults: {},
				modelCatalog: { providers: [] },
				capabilities: { actions: [] },
				agentCatalog: {
					agentRuntimes: [],
					skills: [],
					subagents: [],
					contextFiles: [],
					userSkills: [userSkill({ id: "skill-zeta", name: "zeta-skill" })],
				},
				...overrides,
			};
		}

		const base = bootstrap();
		const withoutCatalog = { ...base, agentCatalog: undefined };
		assert.equal(removeAgentCatalogUserSkill(withoutCatalog, "skill-zeta"), withoutCatalog);
		assert.equal(upsertAgentCatalogUserSkill(withoutCatalog, userSkill()), withoutCatalog);

		const withSkills = upsertAgentCatalogUserSkill(base, userSkill({ id: "skill-alpha", name: "alpha-skill" }));
		assert.deepEqual(withSkills.agentCatalog.userSkills.map((skill) => skill.name), ["alpha-skill", "zeta-skill"]);
		const replacedSkill = upsertAgentCatalogUserSkill(withSkills, userSkill({ id: "skill-zeta", name: "beta-skill", enabled: false }));
		assert.deepEqual(replacedSkill.agentCatalog.userSkills.map((skill) => skill.name), ["alpha-skill", "beta-skill"]);
		assert.equal(replacedSkill.agentCatalog.userSkills[1].enabled, false);
		assert.deepEqual(removeAgentCatalogUserSkill(replacedSkill, "skill-alpha").agentCatalog.userSkills.map((skill) => skill.id), ["skill-zeta"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app agent catalog mutation helpers update bootstrap catalog entries", async () => {
	await assert.doesNotReject(runAgentCatalogMutationScenario());
});
