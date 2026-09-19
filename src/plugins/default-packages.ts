import { access, cp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { FACT_COUNT_STOP_CONDITION, GOAL_STATUS_STOP_CONDITION, MAX_ITERATIONS_STOP_CONDITION, PROMISE_COMPLETE_STOP_CONDITION } from "../loops/stopping.js";
import { PIBO_RUN_TOOL_NAMES } from "../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../subagents/tool.js";
import { OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID } from "../transcription/openai-chatgpt.js";
import { OPENAI_TRANSCRIPTION_PROVIDER_ID } from "../transcription/openai.js";
import type { PluginContribution, PluginInstallation, PluginManifest, PluginRuntimeRequirement } from "./manifest.js";
import type { PluginManager } from "./manager.js";
import type { PluginConsumer, PluginOperation } from "./operations.js";
import type { StoredPluginInstallation } from "./store.js";
import { PIBO_CHAT_EXTENSION_SERVICE, PIBO_LOOP_SERVICE, PIBO_MESSAGE_PREFLIGHT_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE } from "./product-services.js";
import { PIBO_STANDARD_SKILL_NAMES } from "./standard-skills.js";

export const CHATGPT_TRANSCRIPTION_PLUGIN_ID = "pibo.transcription.openai-chatgpt";
export const OPENAI_TRANSCRIPTION_PLUGIN_ID = "pibo.transcription.openai";
export const PREVIEW_PLUGIN_ID = "pibo.preview";
export const VSCODE_WEB_PLUGIN_ID = "pibo.vscode-web";
export const CRON_PLUGIN_ID = "pibo.cron";
export const WORKFLOWS_PLUGIN_ID = "pibo.workflows";
export const WEB_ANNOTATIONS_PLUGIN_ID = "pibo.web-annotations";
export const CODE_RUNTIME_PLUGIN_ID = "pibo.code-runtime";
export const FILE_EDITING_PLUGIN_ID = "pibo.file-editing";
export const WEB_SEARCH_PLUGIN_ID = "pibo.web-search";
export const BROWSER_TOOLS_PLUGIN_ID = "pibo.browser-tools";
export const GATEWAY_TOOLS_PLUGIN_ID = "pibo.gateway-tools";
export const CODEX_COMPAT_PLUGIN_ID = "pibo.codex-compat";
export const RUN_CONTROL_PLUGIN_ID = "pibo.run-control";
export const GOAL_CONTROL_PLUGIN_ID = "pibo.goal-control";
export const AGENT_DELEGATION_PLUGIN_ID = "pibo.agent-delegation";
export const PI_RUNTIME_PLUGIN_ID = "pibo.runtime-pi";
export const CODEX_NATIVE_RUNTIME_PLUGIN_ID = "pibo.runtime-codex-native";
export const MUSE_NATIVE_RUNTIME_PLUGIN_ID = "pibo.runtime-muse-native";
export const OMP_RUNTIME_PLUGIN_ID = "pibo.runtime-omp";
export const BUILTIN_PROFILES_PLUGIN_ID = "pibo.builtin-profiles";
export const MCP_CLI_PLUGIN_ID = "pibo.mcp-cli";
const DEFAULT_PACKAGE_VERSION = "1.0.0";
const WEB_ANNOTATION_TOOL_NAMES = [
	"web_annotations_list",
	"web_annotations_get",
	"web_annotations_watch",
	"web_annotations_acknowledge",
	"web_annotations_resolve",
	"web_annotations_dismiss",
] as const;
const BROWSER_TOOL_NAMES = [
	"browser_use_open_tabs",
	"browser_use_take_screenshot",
	"browser_use_browser_use",
	"node_repl_js",
	"node_repl_js_reset",
] as const;

function transcriptionPackageManifest(id: string, name: string, providerId: string): PluginManifest {
	return {
		schemaVersion: 1,
		id,
		name,
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs" },
		contributions: [{ id: "provider", kind: "transcription-provider", name: providerId, title: name, scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "System transcription provider; no model context." } }],
	};
}

export const openAiChatGptTranscriptionPackageManifest = () => transcriptionPackageManifest(CHATGPT_TRANSCRIPTION_PLUGIN_ID, "ChatGPT Subscription Transcription", OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID);
export const openAiTranscriptionPackageManifest = () => transcriptionPackageManifest(OPENAI_TRANSCRIPTION_PLUGIN_ID, "OpenAI Transcription", OPENAI_TRANSCRIPTION_PROVIDER_ID);

export function vscodeWebPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: VSCODE_WEB_PLUGIN_ID,
		name: "Pibo VS Code Web",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		services: { requires: [{ id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0" }] },
		contributions: [productView("view", "VS Code", "VscodeView")],
	};
}

export function previewPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: PREVIEW_PLUGIN_ID,
		name: "Pibo Preview",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		contributions: [
			systemContribution("app", "web-app", "session-live-previews"),
			productView("view", "Preview", "PreviewView"),
		],
	};
}

export function cronPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: CRON_PLUGIN_ID,
		name: "Pibo Cron",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		services: { requires: [{ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", optional: true }, { id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0" }] },
		contributions: [
			systemContribution("channel", "channel", "cron"),
			productView("view", "Cron", "CronView", "cron"),
		],
	};
}

export function workflowsPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: WORKFLOWS_PLUGIN_ID,
		name: "Pibo Workflows",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		contributions: [productView("view", "Workflows", "WorkflowsView", "workflows")],
	};
}

function toolContribution(name: string, options: { title?: string; defaultEnabled?: boolean; runtime?: PluginRuntimeRequirement; context?: PluginContribution["context"]; metadata?: PluginContribution["metadata"]; direct?: boolean; yieldable?: boolean } = {}): PluginContribution {
	return {
		id: name,
		kind: "tool",
		name,
		title: options.title ?? name.replaceAll("_", " "),
		scope: "agent",
		required: false,
		defaultEnabled: options.defaultEnabled ?? false,
		schemaVersion: 1,
		...(options.runtime ? { runtime: options.runtime } : {}),
		...(options.metadata ? { metadata: options.metadata } : {}),
		...(options.direct !== undefined ? { direct: options.direct } : {}),
		...(options.yieldable !== undefined ? { yieldable: options.yieldable } : {}),
		context: options.context ?? { kind: "none", reason: "Tool schema and bounded results are delivered at runtime." },
	};
}

function settingsView(title: string): PluginContribution {
	return {
		id: "settings",
		kind: "view",
		title,
		scope: "app",
		required: true,
		defaultEnabled: true,
		schemaVersion: 1,
		context: { kind: "none", reason: "Compatibility view for retained tabs; configuration is owned by Settings > Plugins." },
		view: {
			title,
			exportName: "ToolFamilyView",
			presentation: "internal",
			instance: "singleton",
			mount: "unmount",
			stateSchemaVersion: 1,
			stateSchema: { type: "object", additionalProperties: true },
			subviewNavigation: "renderer",
			subviews: [{ id: "settings", title: "Settings", purpose: "settings", settingsScopes: ["app", "agent", "session"] }, { id: "context", title: "Context", purpose: "context" }],
		},
	};
}

function toolFamilyManifest(input: { id: string; name: string; tools: PluginContribution[]; extra?: PluginContribution[]; sessionTools?: boolean; includeNativeTools?: boolean }): PluginManifest {
	const providerId = `${input.id}/session-tools` as const;
	const tools = input.sessionTools
		? input.tools.map((tool) => ({ ...tool, sessionToolProvider: providerId, dependsOn: [...(tool.dependsOn ?? []), providerId] }))
		: input.tools;
	return {
		schemaVersion: 1,
		id: input.id,
		name: input.name,
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		config: { schemaVersion: 1, scopes: ["app", "agent", "session"], schema: { type: "object", additionalProperties: true } },
		contributions: [
			...(input.sessionTools ? [{ ...systemContribution("session-tools", "session-tool-provider", `${input.id}-session-tools`), ...(input.includeNativeTools ? { metadata: { includeNativeTools: true } } : {}) }] : []),
			...tools,
			...(input.extra ?? []),
			settingsView(`${input.name} settings`),
		],
	};
}

export function webAnnotationsPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: WEB_ANNOTATIONS_PLUGIN_ID,
		name: "Pibo Web Annotations",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		services: { requires: [{ id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0" }] },
		config: {
			schemaVersion: 1,
			scopes: ["app", "agent", "session"],
			schema: {
				type: "object",
				properties: {
					annotationShortcut: { type: "string", maxLength: 80 },
					cdpUrl: { type: "string", maxLength: 2048 },
				},
				additionalProperties: false,
			},
		},
		contributions: [
			...WEB_ANNOTATION_TOOL_NAMES.map((name) => toolContribution(name, { defaultEnabled: true })),
			{
				id: "skill",
				kind: "skill",
				name: "web-annotations",
				title: "Web Annotations",
				scope: "agent",
				required: false,
				defaultEnabled: true,
				schemaVersion: 1,
				context: { kind: "context", stage: "skill", description: "Progressive Web Annotation workflow guidance.", loading: "progressive" },
			},
			{
				id: "api",
				kind: "web-app",
				name: "web-annotations",
				title: "Web Annotations API",
				scope: "app",
				required: true,
				defaultEnabled: true,
				schemaVersion: 1,
				context: { kind: "none", reason: "System API; no model context." },
			},
			{
				id: "annotations",
				kind: "view",
				title: "Web Annotations",
				scope: "agent",
				required: false,
				defaultEnabled: true,
				schemaVersion: 1,
				context: { kind: "none", reason: "Browser projection of persisted annotations." },
				view: {
					title: "Web Annotations",
					icon: "message-square-text",
					exportName: "WebAnnotationsView",
					presentation: "workspace",
					instance: "singleton",
					mount: "keep-alive",
					stateSchemaVersion: 1,
					stateSchema: { type: "object", additionalProperties: true },
					subviewNavigation: "renderer",
					subviews: [
						{ id: "annotations", title: "Annotations", purpose: "content" },
						{ id: "settings", title: "Settings", purpose: "settings", settingsScopes: ["app", "agent", "session"] },
						{ id: "context", title: "Context", purpose: "context" },
					],
				},
			},
			{
				id: "build-context",
				kind: "view",
				title: "Build Context",
				scope: "agent",
				required: false,
				defaultEnabled: true,
				schemaVersion: 1,
				context: { kind: "none", reason: "Read-only explanation of the immutable generation plan." },
				view: { title: "Build Context", icon: "blocks", exportName: "BuildContextView", presentation: "workspace", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, stateSchema: { type: "object", additionalProperties: true } },
			},
			{
				id: "terminal",
				kind: "terminal-card",
				title: "Web Annotation",
				scope: "agent",
				required: false,
				defaultEnabled: true,
				schemaVersion: 1,
				context: { kind: "none", reason: "Terminal rendering uses the same persisted annotation identity." },
				metadata: { renderer: "web-annotation", fallback: "Web annotation unavailable" },
			},
		],
	};
}

export function codeRuntimePackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: CODE_RUNTIME_PLUGIN_ID, name: "Pibo Code Runtime", sessionTools: true, tools: [toolContribution("runtime", { context: { kind: "context", stage: "tools", description: "Persistent Python/Node runtime tool schema.", loading: "runtime" } })] });
}

export function fileEditingPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: FILE_EDITING_PLUGIN_ID, name: "Pibo File Editing", sessionTools: true, tools: [toolContribution("hashline", { yieldable: false, runtime: { adapterIds: ["pi"] }, metadata: { replacesBuiltinTools: ["read"] }, context: { kind: "context", stage: "tools", description: "Pi read replacement with content-hash anchors.", loading: "runtime" } })] });
}

export function webSearchPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: WEB_SEARCH_PLUGIN_ID, name: "Pibo Web Search", tools: [toolContribution("web_search", { yieldable: false, runtime: { adapterIds: ["pi"] }, context: { kind: "context", stage: "provider-tools", description: "OpenAI provider web-search declaration and result contract.", loading: "runtime" } })] });
}

export function gatewayToolsPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: GATEWAY_TOOLS_PLUGIN_ID, name: "Pibo Gateway Tools", sessionTools: true, tools: [toolContribution("pibo_gateway_send", { context: { kind: "context", stage: "tools", description: "Send a message through the local Pibo gateway.", loading: "runtime" } })] });
}

export function browserToolsPackageManifest(): PluginManifest {
	return toolFamilyManifest({
		id: BROWSER_TOOLS_PLUGIN_ID,
		name: "Pibo Browser Tools",
		sessionTools: true,
		tools: BROWSER_TOOL_NAMES.map((name) => toolContribution(name, { yieldable: name === "browser_use_browser_use", context: { kind: "context", stage: "tools", description: "Browser Use and persistent browser-bound Node REPL tool schema.", loading: "runtime" } })),
		extra: [{ id: "native-tooling-context", kind: "context-file", name: "Pibo Native Tooling", title: "Pibo Native Tooling", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "context", description: "Agent-facing native tooling workflow context.", loading: "eager" } }],
	});
}

export function codexCompatPackageManifest(): PluginManifest {
	return toolFamilyManifest({
		id: CODEX_COMPAT_PLUGIN_ID,
		name: "Pibo Codex Compatibility",
		sessionTools: true,
		tools: ["apply_patch", "view_image", "codex_image_generation"].map((name) => toolContribution(name, { runtime: { adapterIds: ["pi"] }, context: { kind: "context", stage: "tools", description: name === "codex_image_generation" ? "Generate or edit images through the ChatGPT/Codex backend API." : "Pi-backed Codex compatibility contribution.", loading: "runtime" } })),
		extra: [{ id: "base-prompt", kind: "system-prompt-transformer", name: "Codex Base Prompt", title: "Codex Base Prompt", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "base-prompt", description: "Codex compatibility system-prompt transformation for compatible adapters.", loading: "eager" } }],
	});
}

export function runControlPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: RUN_CONTROL_PLUGIN_ID, name: "Pibo Run Control", sessionTools: true, includeNativeTools: true, tools: PIBO_RUN_TOOL_NAMES.map((name) => toolContribution(name, { yieldable: false, context: { kind: "context", stage: "tools", description: "Session-owned yielded-run lifecycle tool.", loading: "runtime" } })) });
}

export function goalControlPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: GOAL_CONTROL_PLUGIN_ID,
		name: "Pibo Goal Control",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		config: { schemaVersion: 1, scopes: ["app", "agent", "session"], schema: { type: "object", additionalProperties: true } },
		services: {
			provides: [{ id: PIBO_LOOP_SERVICE, version: "1.0.0" }, { id: PIBO_MESSAGE_PREFLIGHT_SERVICE, version: "1.0.0" }],
			requires: [{ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", optional: true }, { id: PIBO_CHAT_EXTENSION_SERVICE, version: "1.0.0" }],
		},
		contributions: [
			systemContribution("session-tools", "session-tool-provider", `${GOAL_CONTROL_PLUGIN_ID}-session-tools`),
			...PIBO_GOAL_TOOL_NAMES.map((name) => ({ ...toolContribution(name, { defaultEnabled: true, context: { kind: "context", stage: "tools", description: "Persisted session-goal lifecycle tool.", loading: "runtime" } }), sessionToolProvider: `${GOAL_CONTROL_PLUGIN_ID}/session-tools` as const, dependsOn: [`${GOAL_CONTROL_PLUGIN_ID}/session-tools` as const] })),
			settingsView("Pibo Goal Control settings"),
			productView("loops", "Loops", "LoopsView", "loops"),
			systemContribution("service", "system-service", PIBO_LOOP_SERVICE),
			systemContribution("channel", "channel", "pibo.loop"),
			systemContribution("goal-action", "gateway-action", "goal"),
			...[MAX_ITERATIONS_STOP_CONDITION, PROMISE_COMPLETE_STOP_CONDITION, GOAL_STATUS_STOP_CONDITION, FACT_COUNT_STOP_CONDITION].map((name) => systemContribution(`stop-${name}`, "loop-stop-condition", name)),
		],
	};
}

export function agentDelegationPackageManifest(): PluginManifest {
	return toolFamilyManifest({
		id: AGENT_DELEGATION_PLUGIN_ID,
		name: "Pibo Agent Delegation",
		sessionTools: true,
		tools: PIBO_AGENT_TOOL_NAMES.map((name) => ({
			...toolContribution(name, { direct: name !== "pibo_agents_send_message", context: { kind: "context", stage: "subagents", description: "Session-owned delegated-agent management tool.", loading: "runtime" } }),
			...(name === "pibo_agents_send_message" ? { dependsOn: PIBO_RUN_TOOL_NAMES.map((runTool) => `${RUN_CONTROL_PLUGIN_ID}/${runTool}` as const) } : {}),
		})),
	});
}

function systemContribution(id: string, kind: string, name: string): PluginContribution {
	return { id, kind, name, title: name, scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "System lifecycle contribution; no model context." } };
}
function runtimeAdapterManifest(id: string, name: string, contributions: PluginContribution[]): PluginManifest {
	return { schemaVersion: 1, id, name, version: DEFAULT_PACKAGE_VERSION, sdk: "^1.0.0", entrypoints: { backend: "backend.mjs" }, contributions };
}
export const piRuntimePackageManifest = (): PluginManifest => runtimeAdapterManifest(PI_RUNTIME_PLUGIN_ID, "Pibo Pi Runtime Adapter", [systemContribution("driver", "agent-runtime-driver", "pi"), systemContribution("instance", "agent-runtime-instance", "pi")]);
export const codexNativeRuntimePackageManifest = (): PluginManifest => ({
	...runtimeAdapterManifest(CODEX_NATIVE_RUNTIME_PLUGIN_ID, "Pibo Native Codex Runtime Adapter", [
		systemContribution("driver", "agent-runtime-driver", "codex-native"),
		systemContribution("instance", "agent-runtime-instance", "codex-native"),
		systemContribution("speech", "speech-provider", "openai-codex"),
		systemContribution("profile", "profile", "codex-native"),
		{ ...systemContribution("approval-response", "gateway-action", "runtime.approval.respond"), title: "Respond to runtime approval" },
		{ ...systemContribution("user-input-response", "gateway-action", "runtime.user_input.respond"), title: "Respond to runtime input" },
		{
			...productView("runtime-requests", "Runtime Requests", "RuntimeRequestsView"),
			scope: "agent",
			required: false,
			defaultEnabled: true,
			runtime: { adapterIds: ["codex-native"], capabilities: ["approvals.supported"] },
			metadata: { surface: "runtime-requests" },
		},
	]),
	entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
});
export const museNativeRuntimePackageManifest = (): PluginManifest => ({
	...runtimeAdapterManifest(MUSE_NATIVE_RUNTIME_PLUGIN_ID, "Pibo Native Muse Runtime Adapter", [
		systemContribution("driver", "agent-runtime-driver", "muse-native"),
		systemContribution("instance", "agent-runtime-instance", "muse-native"),
		systemContribution("profile", "profile", "muse-native"),
		{
			...productView("runtime-requests", "Runtime Requests", "RuntimeRequestsView"),
			scope: "agent",
			required: false,
			defaultEnabled: true,
			runtime: { adapterIds: ["muse-native"], capabilities: ["approvals.supported"] },
			metadata: { surface: "runtime-requests" },
		},
	]),
	entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
});
export const ompRuntimePackageManifest = (): PluginManifest => runtimeAdapterManifest(OMP_RUNTIME_PLUGIN_ID, "Pibo OMP Runtime Adapter", [systemContribution("driver", "agent-runtime-driver", "omp"), systemContribution("instance", "agent-runtime-instance", "omp-native"), systemContribution("profile", "profile", "orp")]);
export const builtinProfilesPackageManifest = (): PluginManifest => runtimeAdapterManifest(BUILTIN_PROFILES_PLUGIN_ID, "Pibo Built-in Profiles", [
	...PIBO_STANDARD_SKILL_NAMES.map((name) => ({
		id: name,
		kind: "skill" as const,
		name,
		title: name,
		scope: "agent" as const,
		required: false,
		defaultEnabled: name === "pi-agent-harness",
		schemaVersion: 1 as const,
		context: { kind: "context" as const, stage: "skill" as const, description: `${name} workflow guidance.`, loading: "progressive" as const },
	})),
	systemContribution("base", "profile", "base"),
	systemContribution("gateway-producer", "profile", "pibo-gateway-producer"),
]);
function productView(id: string, title: string, exportName: string, chatRoute?: string, subviews?: NonNullable<NonNullable<PluginContribution["view"]>["subviews"]>): PluginContribution {
	return {
		id,
		kind: "view",
		title,
		scope: "app",
		required: true,
		defaultEnabled: true,
		schemaVersion: 1,
		context: { kind: "none", reason: "Product view; no model context." },
		...(chatRoute ? { metadata: { chatRoute } } : {}),
		view: { title, exportName, presentation: "workspace", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, stateSchema: { type: "object", additionalProperties: true }, ...(subviews ? { subviews } : {}) },
	};
}

export function mcpCliPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: MCP_CLI_PLUGIN_ID,
		name: "Pibo MCP CLI",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		config: { schemaVersion: 1, scopes: ["app", "agent", "session"], schema: { type: "object", properties: { toolFilter: { type: "array", items: { type: "string" } }, descriptionMode: { type: "string" } }, additionalProperties: true } },
		contributions: [
			{ id: "adapter", kind: "mcp-adapter", name: "mcp-cli", title: "MCP CLI", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, configSchema: { type: "object", properties: { selectedServers: { type: "array", items: { type: "string" } } }, required: ["selectedServers"], additionalProperties: false }, context: { kind: "context", stage: "mcp", description: "Selected external MCP server inventory, descriptions and tool delivery.", loading: "runtime" } },
			settingsView("MCP CLI settings"),
		],
	};
}

type DefaultPackageDescriptor = {
	manifest: () => PluginManifest;
	backendExport: string;
	backendModule: "preview" | "vscode-web" | "cron" | "workflows" | "transcription-openai-chatgpt" | "transcription-openai" | "web-annotations" | "code-runtime" | "file-editing" | "web-search" | "browser-tools" | "gateway-tools" | "codex-compat" | "run-control" | "goal-loops" | "runtime-pi" | "runtime-codex-native" | "runtime-muse-native" | "runtime-omp" | "profiles" | "mcp-cli";
	webOnly?: boolean;
	browserModules?: readonly { exports: string; asset: string }[];
};

const DEFAULT_PACKAGES: readonly DefaultPackageDescriptor[] = [
	{ manifest: previewPackageManifest, backendExport: "setupPreview", backendModule: "preview", webOnly: true, browserModules: [{ exports: "PreviewView", asset: "pibo-plugin-preview.js" }] },
	{ manifest: vscodeWebPackageManifest, backendExport: "setupVscodeWeb", backendModule: "vscode-web", webOnly: true, browserModules: [{ exports: "VscodeView", asset: "pibo-plugin-vscode-web.js" }] },
	{ manifest: cronPackageManifest, backendExport: "setupCron", backendModule: "cron", webOnly: true, browserModules: [{ exports: "CronView", asset: "pibo-plugin-cron.js" }] },
	{ manifest: workflowsPackageManifest, backendExport: "setupWorkflows", backendModule: "workflows", browserModules: [{ exports: "WorkflowsView", asset: "pibo-plugin-workflows.js" }] },
	{ manifest: openAiChatGptTranscriptionPackageManifest, backendExport: "setupOpenAiChatGptTranscription", backendModule: "transcription-openai-chatgpt" },
	{ manifest: openAiTranscriptionPackageManifest, backendExport: "setupOpenAiTranscription", backendModule: "transcription-openai" },
	{ manifest: webAnnotationsPackageManifest, backendExport: "setup", backendModule: "web-annotations", browserModules: [{ exports: "WebAnnotationsView", asset: "pibo-plugin-web-annotations.js" }, { exports: "BuildContextView", asset: "pibo-plugin-build-context.js" }] },
	{ manifest: codeRuntimePackageManifest, backendExport: "setupCodeRuntime", backendModule: "code-runtime", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: fileEditingPackageManifest, backendExport: "setupFileEditing", backendModule: "file-editing", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: webSearchPackageManifest, backendExport: "setupWebSearch", backendModule: "web-search", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: browserToolsPackageManifest, backendExport: "setupBrowserTools", backendModule: "browser-tools", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: gatewayToolsPackageManifest, backendExport: "setupGatewayTools", backendModule: "gateway-tools", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: codexCompatPackageManifest, backendExport: "setupCodexCompat", backendModule: "codex-compat", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: runControlPackageManifest, backendExport: "setupRunControl", backendModule: "run-control", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
	{ manifest: goalControlPackageManifest, backendExport: "setupGoalControl", backendModule: "goal-loops", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }, { exports: "LoopsView", asset: "pibo-plugin-loops.js" }] },
	{ manifest: builtinProfilesPackageManifest, backendExport: "setupBuiltinProfiles", backendModule: "profiles" },
	{ manifest: piRuntimePackageManifest, backendExport: "setupPiRuntime", backendModule: "runtime-pi" },
	{ manifest: codexNativeRuntimePackageManifest, backendExport: "setupCodexNativeRuntime", backendModule: "runtime-codex-native", browserModules: [{ exports: "RuntimeRequestsView", asset: "pibo-plugin-runtime-requests.js" }] },
	{ manifest: museNativeRuntimePackageManifest, backendExport: "setupMuseNativeRuntime", backendModule: "runtime-muse-native", browserModules: [{ exports: "RuntimeRequestsView", asset: "pibo-plugin-runtime-requests.js" }] },
	{ manifest: ompRuntimePackageManifest, backendExport: "setupOmpRuntime", backendModule: "runtime-omp" },
	{ manifest: mcpCliPackageManifest, backendExport: "setupMcpCli", backendModule: "mcp-cli", browserModules: [{ exports: "ToolFamilyView", asset: "pibo-plugin-tool-family.js" }] },
];

async function materializeDefaultPackage(artifactRoot: string, descriptor: DefaultPackageDescriptor): Promise<{ manifest: PluginManifest; source: string }> {
	const expected = descriptor.manifest();
	const packageSuffix = descriptor.backendModule === "profiles" ? "standard-profiles" : descriptor.backendModule;
	const moduleDirectory = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(moduleDirectory, "..", "pibo4-artifacts", packageSuffix),
		resolve(moduleDirectory, "..", "..", "dist", "pibo4-artifacts", packageSuffix),
	];
	let builtSource: string | undefined;
	for (const candidate of candidates) {
		try {
			await access(join(candidate, "pibo.plugin.json"));
			builtSource = candidate;
			break;
		} catch {}
	}
	const source = join(artifactRoot, "default-sources", expected.id, expected.version);
	await rm(source, { recursive: true, force: true });
	try {
		if (!builtSource) throw new Error(`No built source found in ${candidates.join(", ")}`);
		await cp(builtSource, source, { recursive: true, force: true });
	} catch (error) {
		throw new Error(`Standard plugin artifact ${packageSuffix} is unavailable. Build or install @pasko70/pibo-standard before starting the Standard composition.`, { cause: error });
	}
	const manifest = JSON.parse(await readFile(join(source, "pibo.plugin.json"), "utf8")) as PluginManifest;
	if (manifest.id !== expected.id || manifest.version !== expected.version) throw new Error(`Built Standard artifact ${packageSuffix} does not match ${expected.id}@${expected.version}`);
	return { manifest, source };
}

function describeDrainBlockers(blockers: readonly PluginConsumer[]): string {
	return blockers.map((consumer) => `${consumer.kind}:${consumer.id}`).join(", ");
}

/** Resume a drain-interrupted default update (nothing was ever stopped) once blockers are gone. Returns the refreshed installation, or undefined when the plugin must be skipped this boot. */
async function resumeInterruptedDefaultUpdate(manager: PluginManager, installation: StoredPluginInstallation): Promise<StoredPluginInstallation | undefined> {
	const candidates = manager.store.listOperations<PluginOperation>().filter((operation) => operation.pluginId === installation.pluginId && operation.kind === "activate" && (operation.state === "draining" || operation.state === "stopped"));
	if (candidates.length !== 1) {
		console.error(`[pibo] Default plugin ${installation.pluginId} is retiring with ${candidates.length} resumable operations; leaving it for explicit recovery (pibo plugins recover)`);
		return undefined;
	}
	const blockers = await manager.listDrainBlockers(installation.pluginId);
	if (blockers.length) {
		console.error(`[pibo] Default plugin ${installation.pluginId} update still waiting for ${describeDrainBlockers(blockers)} to drain; plugin stays unavailable, will retry on next start`);
		return undefined;
	}
	try {
		const resumed = await manager.resumeOperation(candidates[0]!.id);
		if (resumed.state !== "complete") {
			console.error(`[pibo] Default plugin ${installation.pluginId} interrupted update is ${resumed.state}${resumed.diagnostic ? ` (${resumed.diagnostic})` : ""}; leaving it for explicit recovery (pibo plugins recover)`);
			return undefined;
		}
	} catch (error) {
		console.error(`[pibo] Default plugin ${installation.pluginId} interrupted update could not resume: ${error instanceof Error ? error.message : String(error)}; leaving it for explicit recovery (pibo plugins recover)`);
		return undefined;
	}
	return manager.store.getInstallation(installation.pluginId);
}

/** Seed missing defaults and upgrade only active Pibo-managed defaults. Explicit disable/uninstall remains authoritative. */
export async function ensureDefaultPluginInstallations(manager: PluginManager, artifactRoot: string, options: { includeWebProduct?: boolean; activateExisting?: (installation: PluginInstallation) => Promise<void> } = {}): Promise<void> {
	for (const descriptor of DEFAULT_PACKAGES) {
		if (descriptor.webOnly && !options.includeWebProduct) continue;
		const expected = descriptor.manifest();
		let existing = manager.store.getInstallation(expected.id);
		const defaultSourceRoot = resolve(artifactRoot, "default-sources", expected.id);
		if (existing?.state === "retiring") {
			existing = await resumeInterruptedDefaultUpdate(manager, existing);
			if (!existing) continue;
		}
		if (existing) {
			const existingSource = existing.source.kind === "local" ? resolve(existing.source.path) : undefined;
			const managedSource = Boolean(existingSource?.startsWith(`${defaultSourceRoot}${sep}`));
			if (!managedSource || !existing.enabled || existing.state !== "active") continue;
		}
		if (!existing) {
			const blockers = await manager.listDrainBlockers(expected.id);
			if (blockers.length) {
				console.error(`[pibo] Default plugin ${expected.id} installation deferred: waiting for ${describeDrainBlockers(blockers)} to drain; will retry on next start`);
				continue;
			}
		}
		const { manifest, source } = await materializeDefaultPackage(artifactRoot, descriptor);
		if (!existing) {
			await manager.install({ kind: "local", path: source }, { expectedRevision: 0 });
			const installed = manager.store.getInstallation(manifest.id);
			if (!installed) throw new Error(`Default plugin ${manifest.id} was not installed`);
			const activation = await manager.activate(manifest.id, { expectedRevision: installed.stateRevision });
			if (activation.state !== "complete") throw new Error(`Default plugin ${manifest.id} activation did not complete: ${activation.state}`);
			continue;
		}
		const inspected = await manager.inspect({ kind: "local", path: source });
		if (inspected.contentHash === existing.contentHash) {
			await options.activateExisting?.(existing);
			continue;
		}
		const updateBlockers = await manager.listDrainBlockers(expected.id);
		if (updateBlockers.length) {
			console.error(`[pibo] Default plugin ${expected.id} update deferred: waiting for ${describeDrainBlockers(updateBlockers)} to drain; prior revision stays active, will retry on next start`);
			continue;
		}
		await manager.install({ kind: "local", path: source }, { expectedRevision: existing.stateRevision });
		const pending = manager.store.getInstallation(manifest.id);
		if (!pending) throw new Error(`Default plugin ${manifest.id} update was not staged`);
		const activation = await manager.activate(manifest.id, { expectedRevision: pending.stateRevision });
		if (activation.state !== "complete") throw new Error(`Default plugin ${manifest.id} update did not complete: ${activation.state}`);
	}
}
