import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
		const registry = createWebPiboPluginRegistry({ chat: { agentStorePath } });
		const profileInfos = registry.getProfileInfos();

		assert.ok(profileInfos.some((profile) => profile.name === "unity-agent"));
		assert.ok(!profileInfos.some((profile) => profile.name === "old-agent"));
		assert.ok(profileInfos.find((profile) => profile.name === "unity-agent")?.aliases.includes(live.id));

		const profile = createPiboProfileFromRegistryOrDefault(registry, "unity-agent");
		assert.equal(profile.profileName, "unity-agent");
		assert.deepEqual(profile.mainModel, { provider: "openai-codex", id: "gpt-5.5" });
		assert.equal(profile.mainThinkingLevel, "xhigh");
	} finally {
		await rm(dir, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});
