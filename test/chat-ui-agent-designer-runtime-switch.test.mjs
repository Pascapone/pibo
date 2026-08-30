import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const runtimeCapabilities = {
	auth: { status: false, methods: [], cancel: false, logout: false, credentialScope: "runtime-instance" },
};

test("Agent Designer drops only model selections unsupported by the selected runtime", async () => {
	const source = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.match(source, /compatibleModelSelectionsForRuntime\(current, nextRuntime, modelCatalog\)/);

	const script = `
		import assert from "node:assert/strict";
		const { compatibleModelSelectionsForRuntime } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");

		const codexRuntime = {
			id: "codex-native",
			adapterId: "codex-native",
			capabilities: ${JSON.stringify(runtimeCapabilities)},
			models: {
				runtimeInstanceId: "codex-native",
				models: [
					{ provider: "openai-codex", id: "gpt-5.6-sol" },
					{ provider: "openai-codex", id: "gpt-5.4" },
				],
			},
		};
		const legacyPiCatalog = {
			providers: [{
				id: "qwen-token-plan",
				label: "Qwen",
				authConfigured: true,
				models: [{ provider: "qwen-token-plan", id: "deepseek-v4-flash-0731", label: "DeepSeek", authConfigured: true }],
			}],
		};

		assert.deepEqual(compatibleModelSelectionsForRuntime({
			mainModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
			mainModelFallbacks: [
				{ provider: "openai-codex", id: "gpt-5.4" },
				{ provider: "qwen-token-plan", id: "deepseek-v4-flash-0731" },
			],
			subagentModel: { provider: "qwen-token-plan", id: "deepseek-v4-flash-0731" },
		}, codexRuntime, legacyPiCatalog), {
			mainModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
			mainModelFallbacks: [{ provider: "openai-codex", id: "gpt-5.4" }],
			subagentModel: undefined,
		});

		const piRuntime = { id: "pi", adapterId: "pi", capabilities: ${JSON.stringify(runtimeCapabilities)} };
		assert.deepEqual(compatibleModelSelectionsForRuntime({
			mainModel: { provider: "qwen-token-plan", id: "deepseek-v4-flash-0731" },
			mainModelFallbacks: [],
			subagentModel: undefined,
		}, piRuntime, legacyPiCatalog), {
			mainModel: { provider: "qwen-token-plan", id: "deepseek-v4-flash-0731" },
			mainModelFallbacks: [],
			subagentModel: undefined,
		});
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		maxBuffer: 1024 * 1024,
	});
});

test("Agent Designer serializes cleared model selections so PATCH removes persisted overrides", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { agentDraftToSaveInput } = await import("./src/apps/chat-ui/src/agents/agent-designer-model.ts");
		const input = agentDraftToSaveInput({
			displayName: "runtime-agent",
			description: "",
			runtimeInstanceId: "codex-native",
			runtimeOptions: {},
			nativeTools: [],
			skills: [],
			contextFiles: [],
			subagents: [],
			mcpServers: [],
			piPackages: [],
			mainModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
			mainModelFallbacks: [],
			subagentModel: undefined,
			builtinTools: "default",
			builtinToolNames: ["read", "bash", "edit", "write"],
			autoContextFiles: true,
			runControl: false,
			goalControl: true,
			source: "custom",
		});
		assert.deepEqual(input.mainModel, { provider: "openai-codex", id: "gpt-5.6-sol" });
		assert.equal(input.subagentModel, null);
		assert.match(JSON.stringify(input), /"subagentModel":null/);
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		maxBuffer: 1024 * 1024,
	});
});

test("agent PATCH normalization preserves explicit null model clears", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { createAgentUpdate } = await import("./src/apps/chat/chat-request-normalizers.ts");
		const update = createAgentUpdate({ mainModel: null, subagentModel: null });
		assert.equal(update.mainModel, null);
		assert.equal(update.subagentModel, null);
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		maxBuffer: 1024 * 1024,
	});
});
