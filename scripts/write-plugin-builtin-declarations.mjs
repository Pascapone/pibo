import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const declarations = {
	"packaged-core.d.ts": ["setupCore(context: PluginSetupContext): void;"],
	"packaged-preview.d.ts": ["setupPreview(context: PluginSetupContext): () => Promise<void>;"],
	"packaged-cron.d.ts": ["setupCron(context: PluginSetupContext): void;"],
	"packaged-workflows.d.ts": ["setupWorkflows(context: PluginSetupContext): void;"],
	"packaged-user-resources.d.ts": ["setupUserResources(context: PluginSetupContext): void;"],
	"packaged-transcription-openai-chatgpt.d.ts": ["setupOpenAiChatGptTranscription(context: PluginSetupContext): void;"],
	"packaged-transcription-openai.d.ts": ["setupOpenAiTranscription(context: PluginSetupContext): void;"],
	"packaged-transcription.d.ts": [
		"setupOpenAiChatGptTranscription(context: PluginSetupContext): void;",
		"setupOpenAiTranscription(context: PluginSetupContext): void;",
	],
	"packaged-web-annotations.d.ts": ["setup(context: PluginSetupContext): () => void;"],
	"packaged-code-runtime.d.ts": ["setupCodeRuntime(context: PluginSetupContext): void;"],
	"packaged-file-editing.d.ts": ["setupFileEditing(context: PluginSetupContext): void;"],
	"packaged-web-search.d.ts": ["setupWebSearch(context: PluginSetupContext): void;"],
	"packaged-browser-tools.d.ts": ["setupBrowserTools(context: PluginSetupContext): void;"],
	"packaged-gateway-tools.d.ts": ["setupGatewayTools(context: PluginSetupContext): void;"],
	"packaged-codex-compat.d.ts": ["setupCodexCompat(context: PluginSetupContext): void;"],
	"packaged-tool-families.d.ts": [
		"setupCodeRuntime(context: PluginSetupContext): void;",
		"setupFileEditing(context: PluginSetupContext): void;",
		"setupWebSearch(context: PluginSetupContext): void;",
		"setupBrowserTools(context: PluginSetupContext): void;",
		"setupGatewayTools(context: PluginSetupContext): void;",
		"setupCodexCompat(context: PluginSetupContext): void;",
	],
	"packaged-run-control.d.ts": ["setupRunControl(context: PluginSetupContext): void;"],
	"packaged-goal-loops.d.ts": ["setupGoalControl(context: PluginSetupContext): () => Promise<void>;"],
	"packaged-agent-delegation.d.ts": ["setupAgentDelegation(context: PluginSetupContext): void;"],
	"packaged-control-tools.d.ts": [
		"setupRunControl(context: PluginSetupContext): void;",
		"setupGoalControl(context: PluginSetupContext): () => Promise<void>;",
		"setupAgentDelegation(context: PluginSetupContext): void;",
	],
	"packaged-runtime-pi.d.ts": ["setupPiRuntime(context: PluginSetupContext): void;"],
	"packaged-runtime-codex-native.d.ts": ["setupCodexNativeRuntime(context: PluginSetupContext): void;"],
	"packaged-runtime-omp.d.ts": ["setupOmpRuntime(context: PluginSetupContext): void;"],
	"packaged-runtime-adapters.d.ts": [
		"setupPiRuntime(context: PluginSetupContext): void;",
		"setupCodexNativeRuntime(context: PluginSetupContext): void;",
		"setupOmpRuntime(context: PluginSetupContext): void;",
		"createBuiltinRuntimeAdapter(instanceId: string): unknown;",
	],
	"packaged-profiles.d.ts": ["setupBuiltinProfiles(context: PluginSetupContext): void;"],
	"packaged-mcp-cli.d.ts": ["setupMcpCli(context: PluginSetupContext): void;"],
	"packaged-product-ui.d.ts": [
		"setupProductUi(context: PluginSetupContext): void;",
		"setupStandardShell(context: PluginSetupContext): void;",
	],
};

const outputDir = join(process.cwd(), "dist", "plugins");
await mkdir(outputDir, { recursive: true });
for (const [name, signatures] of Object.entries(declarations)) {
	const source = [
		'import type { PluginSetupContext } from "./host.js";',
		"",
		...signatures.map((signature) => `export declare function ${signature}`),
		"",
	].join("\n");
	await writeFile(join(outputDir, name), source);
}
