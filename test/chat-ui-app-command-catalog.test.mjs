import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runCommandCatalogScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { availableSkillsForSession, buildSlashCommands } = await import("./src/apps/chat-ui/src/app-command-catalog.ts");

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
				profile: overrides.profile ?? "pibo-agent",
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

		function catalogSkill(name) {
			return { name, path: "/skills/" + name, kind: "builtin" };
		}

		function userSkill(name) {
			return {
				id: "skill-" + name,
				name,
				description: "Skill " + name,
				path: "/user-skills/" + name,
				enabled: true,
				source: "user-created",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
			};
		}

		function agent(overrides = {}) {
			return {
				name: overrides.name ?? "pibo-agent",
				description: "Agent",
				aliases: [],
				skills: overrides.skills ?? [],
				...overrides,
			};
		}

		function customAgent(overrides = {}) {
			return {
				id: overrides.id ?? "agent-custom",
				profileName: overrides.profileName ?? "custom-agent",
				ownerScope: "user:user-1",
				displayName: "Custom Agent",
				nativeTools: [],
				skills: overrides.skills ?? [],
				contextFiles: [],
				subagents: [],
				mcpServers: [],
				piPackages: [],
				builtinTools: "default",
				builtinToolNames: [],
				autoContextFiles: false,
				runControl: false,
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			const rootRoom = room();
			return {
				identity: { userId: "user-1" },
				session: piboSession(),
				selectedRoomId: rootRoom.id,
				selectedPiboSessionId: "ps-root",
				room: rootRoom,
				rooms: [rootRoom],
				sessions: [sessionNode(), sessionNode({ piboSessionId: "ps-custom", profile: "custom-agent" })],
				agents: [agent({ name: "pibo-agent", skills: ["builtin-alpha", "user-beta"] })],
				customAgents: [customAgent({ profileName: "custom-agent", skills: ["user-gamma"] })],
				capabilities: { actions: [] },
				agentCatalog: {
					nativeTools: [],
					skills: [catalogSkill("builtin-alpha"), catalogSkill("builtin-hidden")],
					subagents: [],
					contextFiles: [],
					packages: [],
					piboTools: [],
					mcpServers: [],
					piPackages: [],
					userSkills: [userSkill("user-beta"), userSkill("user-gamma")],
				},
				...overrides,
			};
		}

		const commands = buildSlashCommands([
			{ name: "thinking", description: "Set thinking", slashCommands: ["thinking", "tree"] },
			{ name: "session.fork", description: "Fork session", slashCommands: ["fork"] },
			{ name: "compact", slashCommands: ["compact"] },
		]);
		assert.deepEqual(commands.map((command) => command.slash), ["/thinking", "/fork", "/compact", "/download", "/upload", "/thinking-show"]);
		assert.equal(commands.find((command) => command.slash === "/thinking").description, "Show thinking level or use /thinking <level>.");
		assert.equal(commands.find((command) => command.slash === "/compact").description, "compact");
		assert.equal(commands.some((command) => command.slash === "/tree"), false);

		const data = bootstrap();
		assert.deepEqual(availableSkillsForSession(data, "ps-root").map((skill) => skill.name), ["builtin-alpha", "user-beta"]);
		assert.deepEqual(availableSkillsForSession(data, "ps-custom").map((skill) => skill.name), ["user-gamma"]);
		assert.deepEqual(availableSkillsForSession(data, "ps-missing").map((skill) => skill.name), ["builtin-alpha", "user-beta"]);
		assert.deepEqual(availableSkillsForSession({ ...data, agentCatalog: undefined }, "ps-root"), []);
		assert.deepEqual(availableSkillsForSession(null, "ps-root"), []);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app command catalog helpers derive slash commands and available skills", async () => {
	await assert.doesNotReject(runCommandCatalogScenario());
});
