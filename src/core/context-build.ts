import { createDefaultPiboProfile } from "./default-profile.js";
import { loadPiboModelDefaults, selectRequestedModelProfile, selectRequestedThinkingLevel, type PiboModelDefaults } from "./model-defaults.js";
import type { InitialSessionContext, ModelProfile } from "./profiles.js";
import type { PiboThinkingLevel } from "./thinking.js";
import { resolvePiboSubagentRuntimeSelections, type PiboResolvedSubagentRuntimeSelection } from "../subagents/runtime-selection.js";
import type { PiboRuntimeOptions, PiboRuntimeSessionContext } from "./runtime.js";
import type { AgentRuntimeCapabilities } from "../agent-runtime/capabilities.js";
import type { AgentRuntimeDiagnostic, AgentRuntimeTransport } from "../agent-runtime/types.js";
import { getDefaultPiboWorkspace } from "./workspace.js";
import { buildLegacyContextPreview } from "../agent-runtime/legacy-context-preview.js";
import { redactSensitiveValue } from "./sensitive-data-redaction.js";

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
	| "runtime_manifest"
	| "diagnostic"
	| "metadata";

export type PiboContextBuildNodeSource =
	| "library"
	| "custom"
	| "legacy"
	| "managed"
	| "plugin"
	| "generated"
	| "pibo"
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

export type PiboContextBuildRuntimeInfo = {
	runtimeInstanceId: string;
	adapterId: string;
	available: boolean;
	transport: AgentRuntimeTransport;
	bindingState?: "unbound" | "bound" | "missing" | "error";
	protocol?: { name: string; supportedRange?: string };
	capabilities: AgentRuntimeCapabilities;
	diagnostics: AgentRuntimeDiagnostic[];
};

export type PiboRuntimeResolutionManifest = {
	version: 1;
	profileName: string;
	runtimeInstanceId: string;
	adapterId?: string;
	piboSessionId?: string;
	piboRoomId?: string;
	cwd: string;
	effectiveModel?: ModelProfile;
	effectiveThinkingLevel?: PiboThinkingLevel;
	toolSurface: "complete" | "pibo-managed-only";
	activeToolNames: string[];
	yieldableToolNames: string[];
	activeToolPackages: string[];
	contextFilePaths: string[];
	skillNames: string[];
	delegatedAgents: Array<Omit<PiboResolvedSubagentRuntimeSelection, "enabled">>;
};

export type PiboContextBuildSnapshot = {
	version: 1;
	generatedAt: string;
	profileName: string;
	piboSessionId?: string;
	piboRoomId?: string;
	cwd: string;
	activeModel?: ModelProfile;
	runtime?: PiboContextBuildRuntimeInfo;
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

export function createPiboRuntimeResolutionManifest(input: {
	profile: InitialSessionContext;
	cwd: string;
	adapterId?: string;
	piboSessionId?: string;
	piboRoomId?: string;
	activeModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	toolSurface?: "complete" | "pibo-managed-only";
	activeToolNames: readonly string[];
	yieldableToolNames?: readonly string[];
	activeToolPackages?: readonly string[];
	contextFilePaths: readonly string[];
	skillNames: readonly string[];
	modelDefaults?: PiboModelDefaults;
	subagentProfileResolver?: (profileName: string) => InitialSessionContext;
}): PiboRuntimeResolutionManifest {
	const modelDefaults = input.modelDefaults ?? loadPiboModelDefaults(input.cwd);
	const effectiveModel = input.activeModel ?? selectRequestedModelProfile(input.profile, modelDefaults);
	const effectiveThinkingLevel = input.thinkingLevel ?? selectRequestedThinkingLevel(input.profile, modelDefaults);
	const delegatedAgents = resolvePiboSubagentRuntimeSelections(
		input.profile.subagents,
		input.subagentProfileResolver,
		modelDefaults,
	).filter((subagent) => subagent.enabled).map(({ enabled: _enabled, ...subagent }) => subagent);
	return {
		version: 1,
		profileName: input.profile.profileName,
		runtimeInstanceId: input.profile.runtimeInstanceId,
		...(input.adapterId ? { adapterId: input.adapterId } : {}),
		...(input.piboSessionId ? { piboSessionId: input.piboSessionId } : {}),
		...(input.piboRoomId ? { piboRoomId: input.piboRoomId } : {}),
		cwd: input.cwd,
		...(effectiveModel ? { effectiveModel: { ...effectiveModel } } : {}),
		...(effectiveThinkingLevel ? { effectiveThinkingLevel } : {}),
		toolSurface: input.toolSurface ?? "complete",
		activeToolNames: [...input.activeToolNames],
		yieldableToolNames: [...(input.yieldableToolNames ?? [])],
		activeToolPackages: [...(input.activeToolPackages ?? [])],
		contextFilePaths: [...input.contextFilePaths],
		skillNames: [...input.skillNames],
		delegatedAgents,
	};
}

/** Read-only compatibility preview. Actual evidence is captured at runtime generation setup. */
export async function inspectPiboContextBuild(options: PiboRuntimeOptions = {}): Promise<PiboContextBuildSnapshot> {
	const snapshot = buildLegacyContextPreview(options.profile ?? createDefaultPiboProfile(), options.cwd ?? getDefaultPiboWorkspace(), options.sessionContext?.piboSessionId, options.sessionContext?.piboRoomId);
	// Callers may supply an already existing generation. Reading its observed metadata is safe;
	// this inspector never creates it, refreshes it, or connects its MCP servers.
	const inspection = options.resources?.getInspection();
	if (inspection) {
		const append = (id: string, title: string, kind: PiboContextBuildNodeKind, metadata: Record<string, unknown>, badges?: string[]) => {
			const delivery = inspection.delivery.find((report) => report.contributionId === id);
			snapshot.nodes.push({ id: `observed/${id}`, title, kind, source: "runtime", order: snapshot.nodes.length, badges, metadata: redactSensitiveValue({ ...metadata, contributionId: id, generation: inspection.sessionGeneration, deliveryStatus: delivery?.status, deliveryMode: delivery?.mode, fidelity: delivery?.fidelity }) as Record<string, unknown>, notes: ["Observed resource metadata from supplied generation; not newly executed by inspection."] });
		};
		for (const file of inspection.context) append(file.id, file.label, "context_file", { path: file.path });
		for (const skill of inspection.skills) append(skill.contributionId, skill.name, "skill", { loading: "progressive", bodyInjected: false });
		for (const server of inspection.mcpServers) append(server.contributionId, server.name, "metadata", { serverName: server.serverName, toolNames: server.tools.map((tool) => tool.name) }, [server.status.toUpperCase()]);
		snapshot.summary.topLevelNodes = snapshot.nodes.length;
		snapshot.summary.totalNodes = snapshot.nodes.length;
	}
	return snapshot;
}

export function createContextBuildSessionContext(input: PiboRuntimeSessionContext | undefined): PiboRuntimeSessionContext | undefined {
	return input ? { ...input } : undefined;
}
