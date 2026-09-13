import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { PIBO_RUN_TOOL_NAMES } from "../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../subagents/tool.js";
import type { PluginContribution, PluginManifest, PluginRuntimeRequirement } from "./manifest.js";
import type { PluginManager } from "./manager.js";

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
const BROWSER_TOOL_NAMES = [
	"browser_use_open_tabs",
	"browser_use_take_screenshot",
	"browser_use_browser_use",
	"node_repl_js",
	"node_repl_js_reset",
] as const;

function toolContribution(name: string, options: { title?: string; defaultEnabled?: boolean; runtime?: PluginRuntimeRequirement; context?: PluginContribution["context"]; metadata?: PluginContribution["metadata"] } = {}): PluginContribution {
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
		context: { kind: "none", reason: "System settings and delivery explanation; no model context." },
		view: {
			title,
			exportName: "ToolFamilyView",
			visibility: "infrastructure",
			instance: "singleton",
			mount: "unmount",
			stateSchemaVersion: 1,
			stateSchema: { type: "object", additionalProperties: true },
			subviews: [{ id: "settings", title: "Settings", purpose: "settings", settingsScopes: ["app", "agent", "session"] }, { id: "context", title: "Context", purpose: "context" }],
		},
	};
}

function toolFamilyManifest(input: { id: string; name: string; tools: PluginContribution[]; extra?: PluginContribution[] }): PluginManifest {
	return {
		schemaVersion: 1,
		id: input.id,
		name: input.name,
		version: DEFAULT_PACKAGE_VERSION,
		sdk: "^1.0.0",
		entrypoints: { backend: "backend.mjs", browser: "browser.mjs" },
		config: { schemaVersion: 1, schema: { type: "object", additionalProperties: true } },
		contributions: [...input.tools, ...(input.extra ?? []), settingsView(`${input.name} settings`)],
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
					visibility: "session",
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
				view: { title: "Build Context", icon: "blocks", exportName: "BuildContextView", visibility: "session", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, stateSchema: { type: "object", additionalProperties: true } },
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
	return toolFamilyManifest({ id: CODE_RUNTIME_PLUGIN_ID, name: "Pibo Code Runtime", tools: [toolContribution("runtime", { context: { kind: "context", stage: "tools", description: "Persistent Python/Node runtime tool schema.", loading: "runtime" } })] });
}

export function fileEditingPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: FILE_EDITING_PLUGIN_ID, name: "Pibo File Editing", tools: [toolContribution("hashline", { runtime: { adapterIds: ["pi"] }, metadata: { replacesBuiltinTools: ["read"] }, context: { kind: "context", stage: "tools", description: "Pi read replacement with content-hash anchors.", loading: "runtime" } })] });
}

export function webSearchPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: WEB_SEARCH_PLUGIN_ID, name: "Pibo Web Search", tools: [toolContribution("web_search", { runtime: { adapterIds: ["pi"] }, context: { kind: "context", stage: "provider-tools", description: "OpenAI provider web-search declaration and result contract.", loading: "runtime" } })] });
}

export function gatewayToolsPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: GATEWAY_TOOLS_PLUGIN_ID, name: "Pibo Gateway Tools", tools: [toolContribution("pibo_gateway_send", { context: { kind: "context", stage: "tools", description: "Send a message through the local Pibo gateway.", loading: "runtime" } })] });
}

export function browserToolsPackageManifest(): PluginManifest {
	return toolFamilyManifest({
		id: BROWSER_TOOLS_PLUGIN_ID,
		name: "Pibo Browser Tools",
		tools: BROWSER_TOOL_NAMES.map((name) => toolContribution(name, { context: { kind: "context", stage: "tools", description: "Browser Use and persistent browser-bound Node REPL tool schema.", loading: "runtime" } })),
		extra: [{ id: "native-tooling-context", kind: "context-file", name: "Pibo Native Tooling", title: "Pibo Native Tooling", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "context", description: "Agent-facing native tooling workflow context.", loading: "eager" } }],
	});
}

export function codexCompatPackageManifest(): PluginManifest {
	return toolFamilyManifest({
		id: CODEX_COMPAT_PLUGIN_ID,
		name: "Pibo Codex Compatibility",
		tools: ["apply_patch", "view_image", "codex_image_generation"].map((name) => toolContribution(name, { runtime: { adapterIds: ["pi"] }, context: { kind: "context", stage: "tools", description: "Pi-backed Codex compatibility contribution.", loading: "runtime" } })),
		extra: [{ id: "base-prompt", kind: "context-file", name: "Codex Base Prompt", title: "Codex Base Prompt", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "base-prompt", description: "Codex compatibility base prompt for the Pi adapter only.", loading: "eager" } }],
	});
}

export function runControlPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: RUN_CONTROL_PLUGIN_ID, name: "Pibo Run Control", tools: PIBO_RUN_TOOL_NAMES.map((name) => toolContribution(name, { context: { kind: "context", stage: "tools", description: "Session-owned yielded-run lifecycle tool.", loading: "runtime" } })) });
}

export function goalControlPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: GOAL_CONTROL_PLUGIN_ID, name: "Pibo Goal Control", tools: PIBO_GOAL_TOOL_NAMES.map((name) => toolContribution(name, { defaultEnabled: true, context: { kind: "context", stage: "tools", description: "Persisted session-goal lifecycle tool.", loading: "runtime" } })) });
}

export function agentDelegationPackageManifest(): PluginManifest {
	return toolFamilyManifest({ id: AGENT_DELEGATION_PLUGIN_ID, name: "Pibo Agent Delegation", tools: PIBO_AGENT_TOOL_NAMES.map((name) => toolContribution(name, { context: { kind: "context", stage: "subagents", description: "Session-owned delegated-agent management tool.", loading: "runtime" } })) });
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
export const builtinProfilesPackageManifest = (): PluginManifest => runtimeAdapterManifest(BUILTIN_PROFILES_PLUGIN_ID, "Pibo Built-in Profiles", [systemContribution("base", "profile", "base")]);
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
		view: { title, exportName, visibility: "infrastructure", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, stateSchema: { type: "object", additionalProperties: true }, ...(subviews ? { subviews } : {}) },
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
		config: { schemaVersion: 1, schema: { type: "object", properties: { toolFilter: { type: "array", items: { type: "string" } }, descriptionMode: { type: "string" } }, additionalProperties: true } },
		contributions: [
			{ id: "adapter", kind: "mcp-adapter", name: "mcp-cli", title: "MCP CLI", scope: "agent", required: false, defaultEnabled: false, schemaVersion: 1, context: { kind: "context", stage: "mcp", description: "Selected external MCP server inventory, descriptions and tool delivery.", loading: "runtime" } },
			settingsView("MCP CLI settings"),
		],
	};
}

type DefaultPackageDescriptor = {
	manifest: () => PluginManifest;
	backendExport: string;
	backendModule: "web-annotations" | "tool-families" | "control-tools" | "runtime-adapters" | "profiles" | "mcp-cli" | "product-ui";
	browserExports?: string;
};

const DEFAULT_PACKAGES: readonly DefaultPackageDescriptor[] = [
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

/** Seed only never-seen packages. Explicit disable/uninstall and stored selections remain authoritative. */
export async function ensureDefaultPluginInstallations(manager: PluginManager, artifactRoot: string): Promise<void> {
	for (const descriptor of DEFAULT_PACKAGES) {
		const expected = descriptor.manifest();
		if (manager.store.getInstallation(expected.id)) continue;
		const { manifest, source } = await materializeDefaultPackage(artifactRoot, descriptor);
		await manager.install({ kind: "local", path: source }, { expectedRevision: 0 });
		const installed = manager.store.getInstallation(manifest.id);
		if (!installed) throw new Error(`Default plugin ${manifest.id} was not installed`);
		await manager.activate(manifest.id, { expectedRevision: installed.stateRevision });
	}
}
