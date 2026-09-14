import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { FACT_COUNT_STOP_CONDITION, GOAL_STATUS_STOP_CONDITION, MAX_ITERATIONS_STOP_CONDITION, PROMISE_COMPLETE_STOP_CONDITION } from "../loops/stopping.js";
import { PIBO_RUN_TOOL_NAMES } from "../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../subagents/tool.js";
import type { PluginContribution, PluginInstallation, PluginManifest, PluginRuntimeRequirement } from "./manifest.js";
import type { PluginManager } from "./manager.js";
import { PIBO_LOOP_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, PIBO_USER_RESOURCES_SERVICE } from "./product-services.js";

export const CORE_PLUGIN_ID = "pibo.core";
export const CHATGPT_TRANSCRIPTION_PLUGIN_ID = "pibo.transcription.openai-chatgpt";
export const OPENAI_TRANSCRIPTION_PLUGIN_ID = "pibo.transcription.openai";
export const WEB_PRODUCT_PLUGIN_ID = "pibo.web-product";
export const USER_RESOURCES_PLUGIN_ID = "pibo.user-resources";
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
export const OMP_RUNTIME_PLUGIN_ID = "pibo.runtime-omp";
export const BUILTIN_PROFILES_PLUGIN_ID = "pibo.builtin-profiles";
export const MCP_CLI_PLUGIN_ID = "pibo.mcp-cli";
export const PRODUCT_UI_PLUGIN_ID = "pibo.product-ui";
export const STANDARD_SHELL_PLUGIN_ID = "pibo.standard-shell";
const DEFAULT_PACKAGE_VERSION = "1.0.0";
const WEB_ANNOTATION_TOOL_NAMES = [
	"web_annotations_list",
	"web_annotations_get",
	"web_annotations_watch",
	"web_annotations_acknowledge",
	"web_annotations_resolve",
	"web_annotations_dismiss",
] as const;
const CORE_SKILL_NAMES = ["pi-agent-harness", "pibo-agent-runtime-adapter", "pibo-spec-writing", "pibo-docker-system", "graphify", "prd", "skill-creator", "loop", "ralph-loop", "ralph-prd-json"] as const;
const CORE_ACTION_NAMES = ["status", "compact", "runtime.approval.respond", "runtime.user_input.respond", "session_id", "clear_queue", "abort", "kill", "kill_all", "dispose", "thinking", "fast_mode", "session.current", "session.list", "session.fork_candidates", "session.fork", "session.clone", "session.tree", "session.tree_navigate", "session.switch", "login", "model", "login.start", "login.complete", "login.apikey", "login.cancel", "login.status", "logout"] as const;
const BROWSER_TOOL_NAMES = [
	"browser_use_open_tabs",
	"browser_use_take_screenshot",
	"browser_use_browser_use",
	"node_repl_js",
	"node_repl_js_reset",
] as const;

function transcriptionPackageManifest(id: string, name: string): PluginManifest {
	return {
		schemaVersion: 1,
		id,
		name,
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs" },
		contributions: [{ id: "provider", kind: "transcription-provider", name: id, title: name, scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "System transcription provider; no model context." } }],
	};
}

export const openAiChatGptTranscriptionPackageManifest = () => transcriptionPackageManifest(CHATGPT_TRANSCRIPTION_PLUGIN_ID, "ChatGPT Subscription Transcription");
export const openAiTranscriptionPackageManifest = () => transcriptionPackageManifest(OPENAI_TRANSCRIPTION_PLUGIN_ID, "OpenAI Transcription");

export function webProductPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: WEB_PRODUCT_PLUGIN_ID,
		name: "Pibo Web Product",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs" },
		services: { requires: [{ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", optional: true }] },
		contributions: [
			{ id: "auth", kind: "auth-service", name: "web-auth", title: "Web authentication", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Web product infrastructure." } },
			{ id: "web-channel", kind: "channel", name: "web", title: "Web channel", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Web product infrastructure." } },
			{ id: "cron-channel", kind: "channel", name: "cron", title: "Cron channel", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Web product infrastructure." } },
			{ id: "preview-app", kind: "web-app", name: "session-live-previews", title: "Session live previews", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Web product infrastructure." } },
			{ id: "chat-app", kind: "web-app", name: "chat", title: "Chat", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Web product infrastructure." } },
		],
	};
}

export function userResourcesPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: USER_RESOURCES_PLUGIN_ID,
		name: "Pibo User Resources",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs" },
		services: { provides: [{ id: PIBO_USER_RESOURCES_SERVICE, version: "1.0.0" }], requires: [{ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", optional: true }] },
		contributions: [
			systemContribution("skill-provider", "resource-provider", "user-skills"),
			systemContribution("context-file-provider", "resource-provider", "user-context-files"),
			systemContribution("profile-provider", "resource-provider", "custom-agent-profiles"),
			{ ...systemContribution("context-files-web-app", "web-app", "context-files"), required: false },
		],
	};
}

export function corePackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: CORE_PLUGIN_ID,
		name: "Pibo Core",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs" },
		contributions: [
			...CORE_SKILL_NAMES.map((name): PluginContribution => ({ id: `skill-${name}`, kind: "skill", name, title: name, scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "skill", description: `Built-in ${name} guidance.`, loading: "progressive" } })),
			...CORE_ACTION_NAMES.map((name): PluginContribution => ({ id: `action-${name}`, kind: "gateway-action", name, title: name, scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Product gateway action; no model context." } })),
		],
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
		tools: ["apply_patch", "view_image", "codex_image_generation"].map((name) => toolContribution(name, { runtime: { adapterIds: ["pi"] }, context: { kind: "context", stage: "tools", description: "Pi-backed Codex compatibility contribution.", loading: "runtime" } })),
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
			provides: [{ id: PIBO_LOOP_SERVICE, version: "1.0.0" }],
			requires: [{ id: PIBO_PRODUCT_OPTIONS_SERVICE, version: "1.0.0", optional: true }],
		},
		contributions: [
			systemContribution("session-tools", "session-tool-provider", `${GOAL_CONTROL_PLUGIN_ID}-session-tools`),
			...PIBO_GOAL_TOOL_NAMES.map((name) => ({ ...toolContribution(name, { defaultEnabled: true, context: { kind: "context", stage: "tools", description: "Persisted session-goal lifecycle tool.", loading: "runtime" } }), sessionToolProvider: `${GOAL_CONTROL_PLUGIN_ID}/session-tools` as const, dependsOn: [`${GOAL_CONTROL_PLUGIN_ID}/session-tools` as const] })),
			settingsView("Pibo Goal Control settings"),
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
export const codexNativeRuntimePackageManifest = (): PluginManifest => runtimeAdapterManifest(CODEX_NATIVE_RUNTIME_PLUGIN_ID, "Pibo Native Codex Runtime Adapter", [systemContribution("driver", "agent-runtime-driver", "codex-native"), systemContribution("instance", "agent-runtime-instance", "codex-native"), systemContribution("speech", "speech-provider", "openai-codex"), systemContribution("profile", "profile", "codex-native")]);
export const ompRuntimePackageManifest = (): PluginManifest => runtimeAdapterManifest(OMP_RUNTIME_PLUGIN_ID, "Pibo OMP Runtime Adapter", [systemContribution("driver", "agent-runtime-driver", "omp"), systemContribution("instance", "agent-runtime-instance", "omp-native"), systemContribution("profile", "profile", "orp")]);
export const builtinProfilesPackageManifest = (): PluginManifest => runtimeAdapterManifest(BUILTIN_PROFILES_PLUGIN_ID, "Pibo Built-in Profiles", [
	systemContribution("base", "profile", "base"),
	systemContribution("gateway-producer", "profile", "pibo-gateway-producer"),
]);
function productView(id: string, title: string, exportName: string, subviews?: NonNullable<NonNullable<PluginContribution["view"]>["subviews"]>): PluginContribution {
	return {
		id,
		kind: "view",
		title,
		scope: "app",
		required: true,
		defaultEnabled: true,
		schemaVersion: 1,
		context: { kind: "none", reason: "Product view; no model context." },
		view: { title, exportName, presentation: "workspace", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, stateSchema: { type: "object", additionalProperties: true }, ...(subviews ? { subviews } : {}) },
	};
}

export function productUiPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: PRODUCT_UI_PLUGIN_ID,
		name: "Pibo Product Views",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		contributions: [
			productView("user-resources", "User Resources", "UserResourcesView", [
				{ id: "context-files", title: "Context Files", purpose: "content" },
				{ id: "skills", title: "Skills", purpose: "content" },
				{ id: "base-prompt", title: "Base Prompt", purpose: "content" },
				{ id: "compaction-prompt", title: "Compaction Prompt", purpose: "content" },
			]),
			productView("agent-designer", "Agent Designer", "AgentDesignerView"),
			productView("settings", "Settings", "GlobalSettingsView", [
				...(["general", "plugins", "debug", "concurrency", "previews", "transcription", "speech", "shortcuts", "maintenance", "skills", "providers"] as const).map((id) => ({ id, title: id[0]!.toUpperCase() + id.slice(1), purpose: "content" as const })),
			]),
			productView("workflows", "Workflows", "WorkflowsView"),
			productView("cron", "Cron", "CronView"),
			productView("loops", "Loops", "LoopsView"),
		],
	};
}

export function standardShellPackageManifest(): PluginManifest {
	return {
		schemaVersion: 1,
		id: STANDARD_SHELL_PLUGIN_ID,
		name: "Pibo Standard Shell",
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		contributions: [{ id: "shell", kind: "shell-provider", name: "standard", title: "Pibo Standard Shell", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Product shell; no model context." } }],
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
	backendModule: "core" | "user-resources" | "web-product" | "transcription" | "web-annotations" | "tool-families" | "control-tools" | "runtime-adapters" | "profiles" | "mcp-cli" | "product-ui";
	webOnly?: boolean;
	userResourcesOnly?: boolean;
	browserExports?: string;
};

const DEFAULT_PACKAGES: readonly DefaultPackageDescriptor[] = [
	{ manifest: corePackageManifest, backendExport: "setupCore", backendModule: "core" },
	{ manifest: userResourcesPackageManifest, backendExport: "setupUserResources", backendModule: "user-resources", userResourcesOnly: true },
	{ manifest: webProductPackageManifest, backendExport: "setupWebProduct", backendModule: "web-product", webOnly: true },
	{ manifest: openAiChatGptTranscriptionPackageManifest, backendExport: "setupOpenAiChatGptTranscription", backendModule: "transcription" },
	{ manifest: openAiTranscriptionPackageManifest, backendExport: "setupOpenAiTranscription", backendModule: "transcription" },
	{ manifest: webAnnotationsPackageManifest, backendExport: "setup", backendModule: "web-annotations", browserExports: "WebAnnotationsView, BuildContextView" },
	{ manifest: codeRuntimePackageManifest, backendExport: "setupCodeRuntime", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: fileEditingPackageManifest, backendExport: "setupFileEditing", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: webSearchPackageManifest, backendExport: "setupWebSearch", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: browserToolsPackageManifest, backendExport: "setupBrowserTools", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: gatewayToolsPackageManifest, backendExport: "setupGatewayTools", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: codexCompatPackageManifest, backendExport: "setupCodexCompat", backendModule: "tool-families", browserExports: "ToolFamilyView" },
	{ manifest: runControlPackageManifest, backendExport: "setupRunControl", backendModule: "control-tools", browserExports: "ToolFamilyView" },
	{ manifest: goalControlPackageManifest, backendExport: "setupGoalControl", backendModule: "control-tools", browserExports: "ToolFamilyView" },
	{ manifest: agentDelegationPackageManifest, backendExport: "setupAgentDelegation", backendModule: "control-tools", browserExports: "ToolFamilyView" },
	{ manifest: builtinProfilesPackageManifest, backendExport: "setupBuiltinProfiles", backendModule: "profiles" },
	{ manifest: piRuntimePackageManifest, backendExport: "setupPiRuntime", backendModule: "runtime-adapters" },
	{ manifest: codexNativeRuntimePackageManifest, backendExport: "setupCodexNativeRuntime", backendModule: "runtime-adapters" },
	{ manifest: ompRuntimePackageManifest, backendExport: "setupOmpRuntime", backendModule: "runtime-adapters" },
	{ manifest: mcpCliPackageManifest, backendExport: "setupMcpCli", backendModule: "mcp-cli", browserExports: "ToolFamilyView" },
	{ manifest: productUiPackageManifest, backendExport: "setupProductUi", backendModule: "product-ui", browserExports: "UserResourcesView, AgentDesignerView, GlobalSettingsView, WorkflowsView, CronView, LoopsView" },
	{ manifest: standardShellPackageManifest, backendExport: "setupStandardShell", backendModule: "product-ui", browserExports: "setupStandardShell as setup" },
];

async function materializeDefaultPackage(artifactRoot: string, descriptor: DefaultPackageDescriptor): Promise<{ manifest: PluginManifest; source: string }> {
	const manifest = descriptor.manifest();
	const source = join(artifactRoot, "default-sources", manifest.id, manifest.version);
	await mkdir(source, { recursive: true, mode: 0o700 });
	await Promise.all([
		writeFile(join(source, "pibo.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
		writeFile(join(source, "backend.mjs"), `export { ${descriptor.backendExport} as setup } from "@pasko70/pibo/plugin-builtin/${descriptor.backendModule}";\n`, { mode: 0o600 }),
		...(descriptor.browserExports ? [writeFile(join(source, "browser.mjs"), `export { ${descriptor.browserExports} } from "/apps/chat/assets/pibo-builtin-plugin.js?v=${manifest.version}";\n`, { mode: 0o600 })] : []),
	]);
	return { manifest, source };
}

/** Seed missing defaults and upgrade only active Pibo-managed defaults. Explicit disable/uninstall remains authoritative. */
export async function ensureDefaultPluginInstallations(manager: PluginManager, artifactRoot: string, options: { includeWebProduct?: boolean; includeUserResources?: boolean; activateExisting?: (installation: PluginInstallation) => Promise<void> } = {}): Promise<void> {
	for (const descriptor of DEFAULT_PACKAGES) {
		if (descriptor.webOnly && !options.includeWebProduct || descriptor.userResourcesOnly && !options.includeUserResources) continue;
		const expected = descriptor.manifest();
		const existing = manager.store.getInstallation(expected.id);
		const defaultSourceRoot = resolve(artifactRoot, "default-sources", expected.id);
		if (existing) {
			const existingSource = existing.source.kind === "local" ? resolve(existing.source.path) : undefined;
			const managedSource = Boolean(existingSource?.startsWith(`${defaultSourceRoot}${sep}`));
			if (!managedSource || !existing.enabled || existing.state !== "active") continue;
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
		await manager.install({ kind: "local", path: source }, { expectedRevision: existing.stateRevision });
		const pending = manager.store.getInstallation(manifest.id);
		if (!pending) throw new Error(`Default plugin ${manifest.id} update was not staged`);
		const activation = await manager.activate(manifest.id, { expectedRevision: pending.stateRevision });
		if (activation.state !== "complete") throw new Error(`Default plugin ${manifest.id} update did not complete: ${activation.state}`);
	}
}
