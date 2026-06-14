import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createDefaultPiboProfile } from "../plugins/builtin.js";
import { getMcpAgentContextFile } from "../mcp/agent-context.js";
import { createRunToolDefinitions, type PiboRunToolController } from "../runs/tools.js";
import { createSubagentToolName, type PiboSubagentRunner } from "../subagents/tool.js";
import { getInstalledCliToolContextFile } from "../tools/registry.js";
import {
	WEB_SEARCH_PROMPT_CONTRIBUTION,
	isWebSearchProviderTool,
	normalizeOpenAiWebSearchConfig,
} from "../tools/web-search.js";
import {
	buildPiboAvailableTools,
	buildPiboGuidelines,
	hasPiboSystemPromptTemplateMarkers,
} from "./system-prompt-template.js";
import { buildCodexCompatSystemPrompt } from "./codex-compat.js";
import { readPiboBasePrompt } from "./base-prompt.js";
import { DEFAULT_BUILTIN_TOOL_NAMES, InitialSessionContext, type ModelProfile } from "./profiles.js";
import type { PiboRuntimeOptions, PiboRuntimeSessionContext } from "./runtime.js";
import { createPiboRuntime } from "./runtime.js";
import { getDefaultPiboWorkspace } from "./workspace.js";

export type PiboContextBuildNodeKind =
	| "prompt_section"
	| "tool_surface"
	| "tool"
	| "tool_prompt_snippet"
	| "tool_prompt_guidelines"
	| "tool_definition"
	| "provider_payload"
	| "context_files"
	| "context_file"
	| "skills"
	| "skill"
	| "runtime_extension"
	| "diagnostic"
	| "metadata";

export type PiboContextBuildNodeSource =
	| "library"
	| "custom"
	| "managed"
	| "plugin"
	| "generated"
	| "pi"
	| "provider"
	| "runtime"
	| "profile";

export type PiboContextBuildNodeState = "active" | "disabled" | "skipped" | "warning" | "error";

export type PiboContextBuildDiagnostic = {
	type: "info" | "warning" | "error";
	message: string;
	nodeId?: string;
};

export type PiboContextBuildNode = {
	id: string;
	parentId?: string;
	order: number;
	kind: PiboContextBuildNodeKind;
	title: string;
	source: PiboContextBuildNodeSource;
	state?: PiboContextBuildNodeState;
	badges?: string[];
	metadata?: Record<string, unknown>;
	path?: string;
	key?: string;
	provider?: string;
	bytes?: number;
	estimatedTokens?: number;
	estimatedSubtreeTokens?: number;
	children?: PiboContextBuildNode[];
	hydratedText?: string;
	schemaJson?: unknown;
	payloadJson?: unknown;
	notes?: string[];
	redacted?: boolean;
	approximate?: boolean;
};

export type PiboContextBuildSnapshot = {
	version: 1;
	generatedAt: string;
	profileName: string;
	piboSessionId?: string;
	piboRoomId?: string;
	cwd: string;
	activeModel?: ModelProfile;
	summary: {
		topLevelNodes: number;
		totalNodes: number;
		estimatedTokens: number;
		warnings: number;
		errors: number;
	};
	nodes: PiboContextBuildNode[];
	diagnostics: PiboContextBuildDiagnostic[];
};

type NodeInput = Omit<PiboContextBuildNode, "order" | "children"> & {
	children?: NodeInput[];
};

const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|cookie|credential|oauth|password|secret|token)/i;
const SECRET_TEXT_PATTERNS: RegExp[] = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
	/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
	/\b(api[_-]?key|authorization|cookie|password|secret|token)\b\s*[:=]\s*[^\s\n,;]+/gi,
];

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

function estimateTokens(text: string): number {
	if (text.length === 0) return 0;
	return Math.ceil(text.length / 4);
}

function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function estimateDirectNodeTokens(node: PiboContextBuildNode): number {
	let tokens = 0;
	if (node.hydratedText) tokens += estimateTokens(node.hydratedText);
	if (node.schemaJson !== undefined) tokens += estimateTokens(jsonText(node.schemaJson));
	if (node.payloadJson !== undefined) tokens += estimateTokens(jsonText(node.payloadJson));
	if (node.notes?.length) tokens += estimateTokens(node.notes.join("\n"));
	return tokens;
}

function applyTokenEstimates(node: PiboContextBuildNode): PiboContextBuildNode {
	const estimatedTokens = estimateDirectNodeTokens(node);
	const estimatedChildrenTokens = (node.children ?? []).reduce((total, child) => total + (child.estimatedSubtreeTokens ?? child.estimatedTokens ?? 0), 0);
	const estimatedSubtreeTokens = estimatedTokens + estimatedChildrenTokens;
	if (estimatedTokens > 0) node.estimatedTokens = estimatedTokens;
	if (estimatedSubtreeTokens > 0) node.estimatedSubtreeTokens = estimatedSubtreeTokens;
	return node;
}

function redactText(text: string): { value: string; redacted: boolean } {
	let value = text;
	for (const pattern of SECRET_TEXT_PATTERNS) {
		value = value.replace(pattern, (match) => {
			const separator = match.match(/[:=]/)?.[0];
			if (!separator) return "[REDACTED]";
			return `${match.slice(0, match.indexOf(separator) + 1)} [REDACTED]`;
		});
	}
	return { value, redacted: value !== text };
}

function redactJson(value: unknown): { value: unknown; redacted: boolean } {
	if (value === null || value === undefined) return { value, redacted: false };
	if (typeof value === "string") return redactText(value);
	if (typeof value === "number" || typeof value === "boolean") return { value, redacted: false };
	if (Array.isArray(value)) {
		let redacted = false;
		const next = value.map((item) => {
			const result = redactJson(item);
			redacted ||= result.redacted;
			return result.value;
		});
		return { value: next, redacted };
	}
	if (typeof value === "object") {
		let redacted = false;
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			if (SECRET_KEY_RE.test(key)) {
				output[key] = "[REDACTED]";
				redacted = true;
				continue;
			}
			const result = redactJson(item);
			redacted ||= result.redacted;
			output[key] = result.value;
		}
		return { value: output, redacted };
	}
	return { value: String(value), redacted: false };
}

function sanitizeNode(input: NodeInput, parentId?: string, order = 0): PiboContextBuildNode {
	let redacted = input.redacted === true;
	const { children, ...nodeInput } = input;
	const node: PiboContextBuildNode = {
		...nodeInput,
		...(parentId ? { parentId } : {}),
		order,
	};

	if (node.hydratedText !== undefined) {
		const result = redactText(node.hydratedText);
		node.hydratedText = result.value;
		redacted ||= result.redacted;
		node.bytes = node.bytes ?? byteLength(node.hydratedText);
	}
	if (node.schemaJson !== undefined) {
		const result = redactJson(node.schemaJson);
		node.schemaJson = result.value;
		redacted ||= result.redacted;
	}
	if (node.payloadJson !== undefined) {
		const result = redactJson(node.payloadJson);
		node.payloadJson = result.value;
		redacted ||= result.redacted;
	}
	if (node.metadata !== undefined) {
		const result = redactJson(node.metadata);
		node.metadata = result.value as Record<string, unknown>;
		redacted ||= result.redacted;
	}
	if (node.notes !== undefined) {
		const redactedNotes = node.notes.map((note) => redactText(note));
		node.notes = redactedNotes.map((note) => note.value);
		redacted ||= redactedNotes.some((note) => note.redacted);
	}
	if (children?.length) {
		node.children = children.map((child, childIndex) => sanitizeNode(child, input.id, childIndex));
	}
	if (redacted) node.redacted = true;
	return applyTokenEstimates(node);
}

function countNodes(nodes: readonly PiboContextBuildNode[]): number {
	return nodes.reduce((count, node) => count + 1 + countNodes(node.children ?? []), 0);
}

function inspectionSubagentRunner(): PiboSubagentRunner {
	return {
		async runSubagent() {
			throw new Error("Context build inspection cannot execute subagents");
		},
	};
}

function inspectionRunToolController(): PiboRunToolController {
	const fail = () => {
		throw new Error("Context build inspection cannot execute run-control tools");
	};
	return {
		startToolRun: fail,
		listRuns: () => [],
		getRunStatus: fail,
		waitForRun: fail,
		readRun: fail,
		cancelRun: fail,
		ackRun: fail,
	};
}

function withoutRequestedModels(profile: InitialSessionContext): InitialSessionContext {
	return new InitialSessionContext({
		profileName: profile.profileName,
		sessionId: profile.sessionId,
		parentSessionId: profile.parentSessionId,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel,
		fast: profile.fast,
		mainFast: profile.mainFast,
		subagentFast: profile.subagentFast,
		skills: profile.skills,
		tools: profile.tools,
		subagents: profile.subagents,
		mcpServers: profile.mcpServers,
		piPackages: profile.piPackages,
		contextFiles: profile.contextFiles,
		builtinTools: profile.builtinTools,
		builtinToolNames: profile.builtinToolNames,
		autoContextFiles: profile.autoContextFiles,
		toolPackages: profile.toolPackages,
	});
}

function resolveProfilePath(cwd: string, path: string): string {
	return path.startsWith("pibo://") ? path : resolve(cwd, path);
}

function activeModelFor(profile: InitialSessionContext, options: PiboRuntimeOptions): ModelProfile | undefined {
	return options.activeModel ?? profile.mainModel ?? profile.model;
}

function toolDefinitionSchema(definition: ToolDefinition | undefined, toolInfo: { parameters?: unknown } | undefined): unknown {
	return definition?.parameters ?? toolInfo?.parameters;
}

function generatedOriginForTool(name: string, profile: InitialSessionContext): string | undefined {
	if (name === "runtime") return "Generated Pibo runtime tool selected by the profile.";
	if (name.startsWith("pibo_subagent_")) return "Generated subagent tool from the profile's subagent list.";
	if (name.startsWith("pibo_run_")) return "Generated run-control tool from the pibo-run-control capability package.";
	if (name === "apply_patch" || name === "view_image") return "Generated Codex-compatible tool from the codex-compat package.";
	if (profile.builtinToolNames.includes(name) || (DEFAULT_BUILTIN_TOOL_NAMES as readonly string[]).includes(name)) return undefined;
	return undefined;
}

function sourceForContextFile(path: string, profile: InitialSessionContext, cwd: string): PiboContextBuildNodeSource {
	if (path === "pibo://runtime/session-context.md") return "runtime";
	if (path.endsWith(".pibo/context/installed-pibo-tools.md") || path === ".pibo/context/installed-pibo-tools.md") return "generated";
	if (path.endsWith(".pibo/context/enabled-mcp-servers.md") || path === ".pibo/context/enabled-mcp-servers.md") return "generated";
	const selected = profile.contextFiles.find((contextFile) => contextFile.enabled !== false && resolveProfilePath(cwd, contextFile.path) === path);
	if (selected?.source === "managed") return "managed";
	if (selected?.source === "plugin") return "plugin";
	return selected ? "profile" : "pi";
}

function badgesForSource(source: PiboContextBuildNodeSource): string[] {
	switch (source) {
		case "generated":
		case "runtime":
			return ["GENERATED"];
		case "managed":
			return ["MANAGED"];
		case "plugin":
			return ["PLUGIN"];
		case "pi":
			return ["PI"];
		case "provider":
			return ["PROVIDER"];
		default:
			return [];
	}
}

async function readSkillMarkdown(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

// Skills are advertised to the model via a small XML summary in the system
// prompt (see formatSkillsForPrompt in @mariozechner/pi-coding-agent). Only the
// name, description, and location land in the prompt; the full SKILL.md body
// is loaded lazily by the model via the read tool. Mirror that exact
// per-skill entry shape here so the inspector's token estimate matches what
// the model actually sees, instead of the full markdown body.
function escapeXmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

type SkillEntryLike = {
	name: string;
	description: string;
	filePath: string;
};

function formatSkillEntryForPrompt(skill: SkillEntryLike): string {
	return [
		"  <skill>",
		`    <name>${escapeXmlAttribute(skill.name)}</name>`,
		`    <description>${escapeXmlAttribute(skill.description)}</description>`,
		`    <location>${escapeXmlAttribute(skill.filePath)}</location>`,
		"  </skill>",
	].join("\n");
}

function diagnosticsNodes(diagnostics: readonly PiboContextBuildDiagnostic[]): NodeInput[] {
	return diagnostics.map((diagnostic, index) => ({
		id: `diagnostics/${index}`,
		kind: "diagnostic",
		title: diagnostic.type.toUpperCase(),
		source: "runtime",
		state: diagnostic.type === "error" ? "error" : diagnostic.type === "warning" ? "warning" : "active",
		badges: [diagnostic.type.toUpperCase()],
		hydratedText: diagnostic.message,
		metadata: diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : undefined,
	}));
}

export async function inspectPiboContextBuild(options: PiboRuntimeOptions = {}): Promise<PiboContextBuildSnapshot> {
	const cwd = options.cwd ?? getDefaultPiboWorkspace();
	const profile = options.profile ?? createDefaultPiboProfile();
	const inspectionProfile = withoutRequestedModels(profile);
	const hasEnabledSubagents = profile.subagents.some((subagent) => subagent.enabled !== false);
	const hasYieldableTools =
		profile.toolPackages.runControl === true ||
		hasEnabledSubagents ||
		profile.tools.some((tool) => tool.enabled !== false && tool.definition !== undefined && tool.yieldable !== false);
	const runtime = await createPiboRuntime({
		...options,
		cwd,
		profile: inspectionProfile,
		activeModel: undefined,
		persistSession: false,
		subagentRunner: options.subagentRunner ?? (hasEnabledSubagents ? inspectionSubagentRunner() : undefined),
		runToolController: options.runToolController ?? (hasYieldableTools ? inspectionRunToolController() : undefined),
	});

	try {
		const generatedAt = new Date().toISOString();
		const resourceLoader = runtime.services.resourceLoader;
		const basePrompt = await readPiboBasePrompt(cwd);
		const activePrompt = basePrompt.effectiveMode === "custom" ? basePrompt.custom : basePrompt.library;
		const activeToolNames = new Set(runtime.session.getActiveToolNames());
		const allTools = runtime.session.getAllTools();
		const toolInfoByName = new Map(allTools.map((tool) => [tool.name, tool]));
		const providerTools = profile.tools.filter((tool) => tool.enabled !== false).filter(isWebSearchProviderTool);
		const toolNames = [...new Set([...activeToolNames, ...providerTools.map((tool) => tool.name)])].sort((left, right) => left.localeCompare(right));
		const selectedTools = [...activeToolNames];
		const toolSnippets: Record<string, string> = {};
		const promptGuidelines: string[] = [];
		for (const name of selectedTools) {
			const definition = runtime.session.getToolDefinition(name);
			if (definition?.promptSnippet) toolSnippets[name] = definition.promptSnippet;
			if (definition?.promptGuidelines?.length) promptGuidelines.push(...definition.promptGuidelines);
		}

		const diagnostics: PiboContextBuildDiagnostic[] = runtime.diagnostics.map((diagnostic) => ({
			type: diagnostic.type,
			message: diagnostic.message,
		}));

		if (profile.autoContextFiles === false) {
			diagnostics.push({ type: "info", message: "Pi automatic context files are disabled for this profile." });
		}

		const promptChildren: NodeInput[] = [
			{
				id: "prompt/base",
				kind: "prompt_section",
				title: "Pibo Base Prompt",
				source: basePrompt.effectiveMode,
				state: "active",
				badges: [basePrompt.effectiveMode.toUpperCase(), "LOCKED"],
				path: activePrompt.path,
				bytes: byteLength(activePrompt.markdown),
				metadata: { mode: basePrompt.mode, effectiveMode: basePrompt.effectiveMode },
				hydratedText: activePrompt.markdown,
			},
		];

		if (hasPiboSystemPromptTemplateMarkers(activePrompt.markdown)) {
			if (activePrompt.markdown.includes("{{availableTools}}")) {
				const text = buildPiboAvailableTools({ selectedTools, toolSnippets });
				promptChildren.push({
					id: "prompt/available-tools-marker",
					kind: "prompt_section",
					title: "Available Tools Marker",
					source: "generated",
					state: "active",
					badges: ["GENERATED"],
					key: "{{availableTools}}",
					hydratedText: text,
					bytes: byteLength(text),
					metadata: { toolCount: selectedTools.length, visibleSnippetCount: Object.keys(toolSnippets).length },
				});
			}
			if (activePrompt.markdown.includes("{{guidelines}}")) {
				const text = buildPiboGuidelines({ selectedTools, promptGuidelines });
				promptChildren.push({
					id: "prompt/guidelines-marker",
					kind: "prompt_section",
					title: "Guidelines Marker",
					source: "generated",
					state: "active",
					badges: ["GENERATED"],
					key: "{{guidelines}}",
					hydratedText: text,
					bytes: byteLength(text),
					metadata: { guidelineCount: text.split("\n").filter(Boolean).length },
				});
			}
		}

		if (profile.toolPackages.codexCompat === true) {
			const marker = "\n\n[base prompt continues here]";
			const wrapper = buildCodexCompatSystemPrompt({
				baseSystemPrompt: marker.trimStart(),
				cwd,
				shell: process.env.SHELL ?? "bash",
				isChildSession: profile.parentSessionId !== undefined,
			}).replace(marker.trimStart(), "[base prompt continues here]");
			promptChildren.unshift({
				id: "prompt/codex-compat-wrapper",
				kind: "runtime_extension",
				title: "Codex Compatibility Wrapper",
				source: "generated",
				state: "active",
				badges: ["GENERATED", "APPROX"],
				hydratedText: wrapper,
				approximate: true,
				notes: ["Shows deterministic wrapper text with a placeholder instead of duplicating the full base prompt."],
			});
		}

		for (const tool of providerTools) {
			if (tool.providerTool.kind !== "web_search") continue;
			promptChildren.push({
				id: `prompt/provider/${tool.name}`,
				kind: "runtime_extension",
				title: "Native Web Search Prompt Contribution",
				source: "provider",
				state: "active",
				provider: tool.providerTool.provider,
				badges: ["PROVIDER", "PROVIDER-BACKED"],
				hydratedText: WEB_SEARCH_PROMPT_CONTRIBUTION,
				metadata: { tool: tool.name, provider: tool.providerTool.provider },
			});
		}

		const toolChildren: NodeInput[] = toolNames.map((name) => {
			const providerTool = providerTools.find((tool) => tool.name === name);
			const definition = runtime.session.getToolDefinition(name);
			const info = toolInfoByName.get(name);
			const children: NodeInput[] = [];
			if (definition?.promptSnippet) {
				children.push({
					id: `tools/${name}/prompt-snippet`,
					kind: "tool_prompt_snippet",
					title: "Prompt Snippet",
					source: providerTool ? "provider" : "pi",
					state: "active",
					hydratedText: definition.promptSnippet,
				});
			}
			if (definition?.promptGuidelines?.length) {
				children.push({
					id: `tools/${name}/prompt-guidelines`,
					kind: "tool_prompt_guidelines",
					title: "Prompt Guidelines",
					source: providerTool ? "provider" : "pi",
					state: "active",
					hydratedText: definition.promptGuidelines.map((guideline) => `- ${guideline}`).join("\n"),
					metadata: { guidelineCount: definition.promptGuidelines.length },
				});
			}
			const schema = toolDefinitionSchema(definition, info);
			if (schema !== undefined) {
				children.push({
					id: `tools/${name}/definition`,
					kind: "tool_definition",
					title: "Tool Definition / Schema",
					source: providerTool ? "provider" : "pi",
					state: "active",
					schemaJson: {
						name,
						description: definition?.description ?? info?.description,
						parameters: schema,
					},
				});
			}
			const generatedOrigin = generatedOriginForTool(name, profile);
			if (generatedOrigin) {
				children.push({
					id: `tools/${name}/generated-origin`,
					kind: "metadata",
					title: "Generated Origin",
					source: "generated",
					state: "active",
					badges: ["GENERATED"],
					hydratedText: generatedOrigin,
				});
			}
			if (providerTool?.providerTool.kind === "web_search") {
				children.push({
					id: `tools/${name}/provider-payload`,
					kind: "provider_payload",
					title: "Provider Payload",
					source: "provider",
					state: "active",
					provider: providerTool.providerTool.provider,
					badges: ["PROVIDER-BACKED"],
					payloadJson: {
						provider: providerTool.providerTool.provider,
						toolKind: providerTool.providerTool.kind,
						openAiWebSearch: normalizeOpenAiWebSearchConfig(providerTool.providerTool.options),
					},
				});
				children.push({
					id: `tools/${name}/provider-prompt`,
					kind: "tool_prompt_snippet",
					title: "Provider Prompt Contribution",
					source: "provider",
					state: "active",
					hydratedText: WEB_SEARCH_PROMPT_CONTRIBUTION,
				});
			}
			if (children.length === 0) {
				children.push({
					id: `tools/${name}/no-prompt-text`,
					kind: "metadata",
					title: "No Prompt Text",
					source: providerTool ? "provider" : "pi",
					state: "active",
					hydratedText: "This tool has no separate prompt snippet or guideline exposed by Pi. Its callable schema is the model-visible contribution.",
					approximate: true,
				});
			}
			const badges = [
				"ACTIVE",
				...(providerTool ? ["PROVIDER-BACKED"] : []),
				...(generatedOrigin ? ["GENERATED"] : []),
				...(profile.builtinToolNames.includes(name) || (DEFAULT_BUILTIN_TOOL_NAMES as readonly string[]).includes(name) ? ["PI"] : []),
			];
			return {
				id: `tools/${name}`,
				kind: "tool",
				title: name,
				source: providerTool ? "provider" : generatedOrigin ? "generated" : "pi",
				state: "active",
				provider: providerTool?.providerTool.provider,
				badges,
				metadata: {
					registered: Boolean(info || providerTool),
					hasDefinition: Boolean(definition || info),
					description: definition?.description ?? info?.description ?? providerTool?.description,
				},
				children,
			};
		});

		const agentsFiles = resourceLoader.getAgentsFiles().agentsFiles;
		const installedToolContextFile = getInstalledCliToolContextFile();
		const mcpAgentContextFile = await getMcpAgentContextFile(profile.mcpServers);
		const contextChildren: NodeInput[] = agentsFiles.map((contextFile) => {
			const source = contextFile.path === installedToolContextFile?.path
				? "generated"
				: contextFile.path === mcpAgentContextFile?.path
					? "generated"
					: sourceForContextFile(contextFile.path, profile, cwd);
			return {
				id: `context-files/${contextFile.path}`,
				kind: "context_file",
				title: contextFile.path.split("/").pop() || contextFile.path,
				source,
				state: "active",
				path: contextFile.path,
				bytes: byteLength(contextFile.content),
				badges: [...badgesForSource(source), ...(contextFile.path === "pibo://runtime/session-context.md" ? ["LOCKED"] : [])],
				metadata: { path: contextFile.path },
				hydratedText: contextFile.content,
			};
		});

		const skills = resourceLoader.getSkills().skills;
		const skillChildren: NodeInput[] = [];
		for (const skill of skills) {
			const markdown = await readSkillMarkdown(skill.filePath);
			const promptEntry = formatSkillEntryForPrompt(skill);
			// The skill node reports only what is actually part of the model
			// prompt: the formatted <skill>...</skill> entry. The full
			// SKILL.md body is loaded lazily by the model via the read tool
			// (or explicitly via /skill:name / $skill-name), so it must not
			// inflate the model-context token estimate. The full file path
			// and size are still surfaced via metadata for inspection.
			skillChildren.push({
				id: `skills/${skill.name}`,
				kind: "skill",
				title: skill.name,
				source: "plugin",
				path: skill.filePath,
				bytes: byteLength(promptEntry),
				badges: ["ACTIVE"],
				metadata: {
					description: skill.description,
					filePath: skill.filePath,
					disableModelInvocation: skill.disableModelInvocation,
					fullFileBytes: markdown ? byteLength(markdown) : undefined,
					fullFileLoadableBy: "read tool, /skill:name command, $skill-name inline expansion",
				},
				hydratedText: markdown === undefined
					? `Skill metadata is loaded, but ${skill.filePath} could not be read for inspection.`
					: promptEntry,
				state: markdown ? "active" : "warning",
			});
		}

		const extensionChildren: NodeInput[] = [];
		if (providerTools.length > 0) {
			extensionChildren.push(...providerTools.map((tool) => ({
				id: `runtime-extensions/provider-${tool.name}`,
				kind: "runtime_extension" as const,
				title: `${tool.name} Provider Adapter`,
				source: "provider" as const,
				state: "active" as const,
				provider: tool.providerTool.provider,
				badges: ["PROVIDER", "PROVIDER-BACKED"],
				metadata: { kind: tool.providerTool.kind, provider: tool.providerTool.provider },
				payloadJson: tool.providerTool.kind === "web_search" ? normalizeOpenAiWebSearchConfig(tool.providerTool.options) : undefined,
				hydratedText: tool.providerTool.kind === "web_search" ? WEB_SEARCH_PROMPT_CONTRIBUTION : undefined,
			})));
		}
		if (profile.toolPackages.codexCompat === true) {
			extensionChildren.push({
				id: "runtime-extensions/codex-compat",
				kind: "runtime_extension",
				title: "Codex Compatibility",
				source: "generated",
				state: "active",
				badges: ["GENERATED"],
				hydratedText: "Codex compatibility wraps the base system prompt and adds apply_patch/view_image tools when enabled.",
			});
		}

		const topLevel: NodeInput[] = [
			{
				id: "prompt",
				kind: "prompt_section",
				title: "Prompt / Runtime Shell",
				source: "runtime",
				state: "active",
				badges: ["ACTIVE"],
				metadata: { childCount: promptChildren.length, activeModel: activeModelFor(profile, options) },
				children: promptChildren,
			},
			{
				id: "tools",
				kind: "tool_surface",
				title: "Tool Prompt Surface",
				source: "runtime",
				state: "active",
				badges: ["ACTIVE"],
				metadata: {
					activeTools: toolNames.length,
					generatedTools: toolChildren.filter((node) => node.badges?.includes("GENERATED")).length,
					builtInTools: toolNames.filter((name) => profile.builtinToolNames.includes(name)).length,
					nativeTools: profile.tools.filter((tool) => tool.enabled !== false).length,
					providerBackedTools: providerTools.length,
				},
				children: toolChildren,
			},
			{
				id: "context-files",
				kind: "context_files",
				title: "Context Files",
				source: "runtime",
				state: "active",
				badges: [profile.autoContextFiles === false ? "PI AUTO DISABLED" : "ACTIVE"],
				metadata: {
					childCount: contextChildren.length,
					autoContextFiles: profile.autoContextFiles,
					installedToolContext: Boolean(installedToolContextFile),
					mcpContext: Boolean(mcpAgentContextFile),
				},
				children: contextChildren,
			},
			{
				id: "skills",
				kind: "skills",
				title: "Skills",
				source: "runtime",
				state: skillChildren.length > 0 ? "active" : "disabled",
				badges: skillChildren.length > 0 ? ["ACTIVE"] : ["EMPTY"],
				metadata: { childCount: skillChildren.length },
				children: skillChildren,
			},
			{
				id: "runtime-extensions",
				kind: "runtime_extension",
				title: "Runtime Extensions",
				source: "runtime",
				state: extensionChildren.length > 0 ? "active" : "disabled",
				badges: extensionChildren.length > 0 ? ["ACTIVE"] : ["EMPTY"],
				metadata: { childCount: extensionChildren.length },
				children: extensionChildren,
			},
			{
				id: "diagnostics",
				kind: "diagnostic",
				title: "Diagnostics",
				source: "runtime",
				state: diagnostics.some((diagnostic) => diagnostic.type === "error") ? "error" : diagnostics.some((diagnostic) => diagnostic.type === "warning") ? "warning" : "active",
				badges: diagnostics.length > 0 ? ["DIAGNOSTICS"] : ["OK"],
				metadata: {
					warnings: diagnostics.filter((diagnostic) => diagnostic.type === "warning").length,
					errors: diagnostics.filter((diagnostic) => diagnostic.type === "error").length,
					infos: diagnostics.filter((diagnostic) => diagnostic.type === "info").length,
				},
				children: diagnostics.length ? diagnosticsNodes(diagnostics) : [{
					id: "diagnostics/none",
					kind: "diagnostic",
					title: "No Diagnostics",
					source: "runtime",
					state: "active",
					hydratedText: "No warnings or errors were reported while assembling this snapshot.",
				}],
			},
		];

		const nodes = topLevel.map((node, index) => sanitizeNode(node, undefined, index));
		const estimatedTokens = nodes.reduce((total, node) => total + (node.estimatedSubtreeTokens ?? node.estimatedTokens ?? 0), 0);
		const redactedDiagnostics = diagnostics.map((diagnostic) => {
			const result = redactText(diagnostic.message);
			return { ...diagnostic, message: result.value };
		});
		return {
			version: 1,
			generatedAt,
			profileName: profile.profileName,
			piboSessionId: options.sessionContext?.piboSessionId,
			piboRoomId: options.sessionContext?.piboRoomId,
			cwd,
			activeModel: activeModelFor(profile, options),
			summary: {
				topLevelNodes: nodes.length,
				totalNodes: countNodes(nodes),
				estimatedTokens,
				warnings: redactedDiagnostics.filter((diagnostic) => diagnostic.type === "warning").length,
				errors: redactedDiagnostics.filter((diagnostic) => diagnostic.type === "error").length,
			},
			nodes,
			diagnostics: redactedDiagnostics,
		};
	} finally {
		await runtime.dispose();
	}
}

export function createContextBuildSessionContext(input: PiboRuntimeSessionContext | undefined): PiboRuntimeSessionContext | undefined {
	return input ? { ...input } : undefined;
}
