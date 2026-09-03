import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Agent Designer and PATCH API persist explicit description clears", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-agent-description-clear-"));
	try {
		const script = `
			import assert from "node:assert/strict";
			import { CustomAgentStore } from "./dist/apps/chat/agent-store.js";
			import { createAgentUpdate } from "./dist/apps/chat/chat-request-normalizers.js";
			import { agentDraftToSaveInput, agentToDraft } from "./src/apps/chat-ui/src/agents/agent-designer-model.ts";

			let store = new CustomAgentStore(process.env.AGENT_STORE_PATH);
			const uiAgent = store.create({ displayName: "ui-clear", description: "remove ui" });
			const apiAgent = store.create({ displayName: "api-clear", description: "remove api" });
			const omittedAgent = store.create({ displayName: "omitted-control", description: "keep me" });

			const uiInput = agentDraftToSaveInput({ ...agentToDraft(uiAgent), description: "" });
			assert.equal(uiInput.description, null);
			assert.equal(JSON.parse(JSON.stringify(uiInput)).description, null);
			assert.equal(store.update(uiAgent.id, createAgentUpdate(uiInput)).description, undefined);
			assert.equal(store.update(apiAgent.id, createAgentUpdate({ description: null })).description, undefined);
			assert.equal(store.update(omittedAgent.id, createAgentUpdate({ displayName: "omitted-control-renamed" })).description, "keep me");
			store.close();

			store = new CustomAgentStore(process.env.AGENT_STORE_PATH);
			assert.equal(store.get(uiAgent.id).description, undefined);
			assert.equal(store.get(apiAgent.id).description, undefined);
			assert.equal(store.get(omittedAgent.id).description, "keep me");
			store.close();
		`;
		await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
			cwd: process.cwd(),
			env: { ...process.env, AGENT_STORE_PATH: join(root, "chat-agents.sqlite") },
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
