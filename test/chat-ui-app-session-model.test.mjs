import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppSessionModelScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			createClientTxnId,
			defaultProfileFromBootstrap,
			findSessionNode,
			findSessionPath,
			identityFromBootstrap,
			resolveSessionActiveModelLabel,
		} = await import("./src/apps/chat-ui/src/app-session-model.ts");

		function session(overrides) {
			return {
				piboSessionId: overrides.piboSessionId,
				piSessionId: overrides.piSessionId ?? \`pi-\${overrides.piboSessionId}\`,
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? overrides.piboSessionId,
				status: overrides.status ?? "idle",
				children: overrides.children ?? [],
				derivedSessions: overrides.derivedSessions ?? [],
				...overrides,
			};
		}

		const grandchild = session({ piboSessionId: "ps-grandchild", profile: "grandchild-profile" });
		const child = session({ piboSessionId: "ps-child", profile: "child-profile", children: [grandchild] });
		const root = session({ piboSessionId: "ps-root", profile: "root-profile", children: [child] });
		const sibling = session({ piboSessionId: "ps-sibling", profile: "sibling-profile" });
		const sessions = Object.freeze([root, sibling]);

		assert.equal(findSessionNode(sessions, "ps-grandchild"), grandchild);
		assert.equal(findSessionNode(sessions, "ps-missing"), undefined);
		assert.deepEqual(findSessionPath(sessions, "ps-grandchild").map((node) => node.piboSessionId), ["ps-root", "ps-child", "ps-grandchild"]);
		assert.deepEqual(findSessionPath(sessions, "ps-missing"), []);

		const bootstrap = {
			identity: { userId: "user-1" },
			session: { id: "ps-root", piSessionId: "pi-root", channel: "web", kind: "chat", profile: "session-profile", createdAt: "now", updatedAt: "now" },
			selectedRoomId: "room-1",
			selectedPiboSessionId: "ps-root",
			rooms: [],
			sessions,
			agents: [
				{
					name: "static-profile",
					aliases: [],
					model: { provider: "static", id: "hard-pinned" },
					mainModel: { provider: "static", id: "main" },
					subagentModel: { provider: "static", id: "subagent" },
				},
			],
			customAgents: [
				{
					id: "custom-1",
					profileName: "custom-profile",
					name: "Custom",
					description: "Custom profile",
					mainModel: { provider: "custom", id: "main" },
					subagentModel: { provider: "custom", id: "subagent" },
					tools: [],
					subagents: [],
					contextFiles: [],
					skills: [],
					createdAt: "now",
					updatedAt: "now",
				},
			],
			modelDefaults: {
				main: { provider: "default", id: "main" },
				subagent: { provider: "default", id: "subagent" },
			},
			capabilities: { actions: [] },
		};

		assert.equal(defaultProfileFromBootstrap(bootstrap), "session-profile");
		assert.equal(defaultProfileFromBootstrap({ ...bootstrap, session: null }), "static-profile");
		assert.equal(defaultProfileFromBootstrap({ ...bootstrap, session: null, agents: [] }), "custom-profile");
		assert.deepEqual(identityFromBootstrap(bootstrap), { userId: "user-1" });
		assert.deepEqual(identityFromBootstrap(null), { userId: "user" });

		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "custom-profile", activeModel: { provider: "active", id: "chosen" } }), "active/chosen");
		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "static-profile" }), "static/hard-pinned");
		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "custom-profile" }), "custom/main");
		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "custom-profile", parentId: "ps-root" }), "custom/subagent");
		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "unknown" }), "default/main");
		assert.equal(resolveSessionActiveModelLabel(bootstrap, { profile: "unknown", parentId: "ps-root" }), "default/subagent");
		assert.equal(resolveSessionActiveModelLabel({ ...bootstrap, modelDefaults: undefined }, { profile: "unknown" }), undefined);

		assert.match(createClientTxnId(), /^web-[a-z0-9]+-.+/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app session model helpers preserve session lookup and fallback semantics", async () => {
	await assert.doesNotReject(runAppSessionModelScenario());
});
