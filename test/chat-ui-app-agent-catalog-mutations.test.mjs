import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAgentCatalogMutationScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			removeAgentCatalogPiPackage,
			removeAgentCatalogUserSkill,
			updateAgentCatalogMcpServer,
			upsertAgentCatalogPiPackage,
			upsertAgentCatalogUserSkill,
		} = await import("./src/apps/chat-ui/src/app-agent-catalog-mutations.ts");

		function piboSession(overrides = {}) {
			return {
				id: overrides.id ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				channel: "web",
				kind: "chat",
				profile: "pibo-agent",
				title: "Root",
				metadata: {},
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: "pibo-agent",
				title: "Root",
				status: "idle",
				lastActivityAt: "2026-05-27T00:00:00.000Z",
				derivedSessions: [],
				children: [],
				...overrides,
			};
		}

		function room(overrides = {}) {
			return {
				id: overrides.id ?? "room-root",
				ownerScope: "user:user-1",
				name: "Root Room",
				type: "chat",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				metadata: {},
				children: [],
				...overrides,
			};
		}

		function mcpServer(overrides = {}) {
			return {
				name: overrides.name ?? "filesystem",
				transport: "stdio",
				hasDescription: Boolean(overrides.description),
				editable: true,
				...overrides,
			};
		}

		function piPackage(overrides = {}) {
			return {
				id: overrides.id ?? "pkg-alpha",
				name: overrides.name ?? "Alpha Package",
				source: "local",
				installSpec: "file:alpha",
				resourceTypes: [],
				installStatus: "installed",
				enabled: true,
				diagnostics: [],
				...overrides,
			};
		}

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

		function agentCatalog(overrides = {}) {
			return {
				nativeTools: [],
				skills: [],
				subagents: [],
				contextFiles: [],
				packages: [],
				piboTools: [],
				mcpServers: [mcpServer({ name: "filesystem" }), mcpServer({ name: "github" })],
				piPackages: [piPackage({ id: "pkg-zeta", name: "Zeta Package" })],
				userSkills: [userSkill({ id: "skill-zeta", name: "zeta-skill" })],
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			const root = sessionNode();
			const rootRoom = room();
			return {
				identity: { userId: "user-1" },
				session: piboSession(),
				selectedRoomId: rootRoom.id,
				selectedPiboSessionId: root.piboSessionId,
				room: rootRoom,
				rooms: [rootRoom],
				sessions: [root],
				agents: [],
				customAgents: [],
				capabilities: { actions: [] },
				agentCatalog: agentCatalog(),
				...overrides,
			};
		}

		const base = bootstrap();
		const withoutCatalog = { ...base, agentCatalog: undefined };
		assert.equal(updateAgentCatalogMcpServer(withoutCatalog, mcpServer({ name: "filesystem" })), withoutCatalog);
		assert.equal(upsertAgentCatalogPiPackage(withoutCatalog, piPackage()), withoutCatalog);
		assert.equal(removeAgentCatalogUserSkill(withoutCatalog, "skill-zeta"), withoutCatalog);

		const updatedServer = updateAgentCatalogMcpServer(base, mcpServer({ name: "filesystem", description: "Local files", descriptionSource: "user", hasDescription: true }));
		assert.equal(updatedServer.agentCatalog.mcpServers[0].description, "Local files");
		assert.equal(updatedServer.agentCatalog.mcpServers[1], base.agentCatalog.mcpServers[1]);

		const withPackages = upsertAgentCatalogPiPackage(base, piPackage({ id: "pkg-alpha", name: "Alpha Package" }));
		assert.deepEqual(withPackages.agentCatalog.piPackages.map((pkg) => pkg.name), ["Alpha Package", "Zeta Package"]);
		const replacedPackage = upsertAgentCatalogPiPackage(withPackages, piPackage({ id: "pkg-zeta", name: "Beta Package", enabled: false }));
		assert.deepEqual(replacedPackage.agentCatalog.piPackages.map((pkg) => pkg.name), ["Alpha Package", "Beta Package"]);
		assert.equal(replacedPackage.agentCatalog.piPackages[1].enabled, false);
		assert.deepEqual(removeAgentCatalogPiPackage(replacedPackage, "pkg-alpha").agentCatalog.piPackages.map((pkg) => pkg.id), ["pkg-zeta"]);

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
