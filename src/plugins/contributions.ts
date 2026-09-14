import type {
	PluginConfigurationSnapshot, PluginContextEffect, PluginContribution, PluginDiagnostic,
	PluginInstallation, PluginJsonObject, PluginJsonValue, PluginQualifiedId,
} from "./manifest.js";

/** Revision-pinned selection snapshot. Explicit decisions are separate from accepted manifest defaults. */
export type AgentPluginSelection = {
	schemaVersion: 1;
	plugins: AgentPluginSelectionEntry[];
};
export type AgentPluginSelectionEntry = {
	pluginId: string;
	enabled: boolean;
	/** The revision whose semantics the agent explicitly accepted. */
	revision: string;
	/** Accepted values for all known agent contribution IDs at this revision; local IDs. */
	contributions: Record<string, boolean>;
	/** Present for current snapshots. Missing means a legacy snapshot whose stored booleans are all explicit. */
	explicitContributions?: Record<string, boolean>;
	/** Controls dependency activation for contributions without an explicit decision. Missing legacy entries allow it only while the plugin is enabled. */
	dependencyPolicy?: "allow-defaults" | "deny";
	config: PluginJsonObject;
	contributionConfig?: Record<string, PluginJsonObject>;
};
export type PluginRuntimeTarget = {
	adapterId: string;
	instanceId: string;
	capabilities: PluginJsonObject;
	deliveryModes?: string[];
};
export type IndependentPluginResource = {
	id: string;
	kind: string;
	name: string;
	origin: "user" | "manual" | "harness";
	/** Same reference is deduplicable; equal names alone are not. */
	reference: string;
	contentHash?: string;
	order?: number;
	context: PluginContextEffect;
	metadata?: PluginJsonObject;
};
export type EffectivePluginContribution = {
	id: PluginQualifiedId;
	pluginId: string;
	pluginRevision: string;
	contribution: PluginContribution;
	config: PluginJsonObject;
	required: boolean;
	selectionReason: "required" | "explicit" | "dependency" | "infrastructure";
	dependencyPath: string[];
};
export type PluginBuildNodeStatus = "selected" | "disabled" | "unsupported" | "required-conflict" | "not-loaded" | "delivered" | "degraded" | "failed" | "no-context" | "unknown" | "deduplicated" | "replaced";
export type PluginBuildProvenanceNode = {
	schemaVersion: 1;
	id: string;
	kind: string;
	origin: "plugin" | "user" | "manual" | "harness";
	pluginId?: string;
	pluginRevision?: string;
	contributionId?: PluginQualifiedId;
	context: PluginContextEffect;
	status: PluginBuildNodeStatus;
	selected: boolean;
	installed?: boolean;
	globallyActive?: boolean;
	agentSelected?: boolean;
	required?: boolean;
	selectionReason: string;
	order: number;
	predecessors: string[];
	configurationRevisions?: { scope: string; revision: number }[];
	content?: { text?: string; payloadRef?: string; visibility: "model" | "inspector"; redacted: boolean; unavailableReason?: string };
	transformations?: { id: string; owner: string; operation: string; inputRefs: string[]; outputRef?: string; description: string }[];
	delivery?: { status: "delivered" | "degraded" | "unsupported" | "failed"; mode: string; target: string; fidelity: string; generation: string; at?: string; payloadRef?: string; diagnostic?: string };
	tokens?: { value: number; method: "measured" | "estimated" };
	fallback: string;
};
export type EffectivePluginPlan = {
	schemaVersion: 1;
	kind: "preview" | "generation";
	catalogRevision: number;
	selectionRevision: number;
	piboSessionId?: string;
	generation?: string;
	runtime: PluginRuntimeTarget;
	/** Original desired selection retained even when references are unavailable. */
	selection: AgentPluginSelection;
	plugins: { pluginId: string; revision: string; version: string; contentHash: string }[];
	contributions: EffectivePluginContribution[];
	resources: IndependentPluginResource[];
	configurations: PluginConfigurationSnapshot[];
	/** App -> selection -> explicit agent -> explicit session shallow overlays, validated after merge. */
	pluginConfigurations: Record<string, PluginJsonObject>;
	nodes: PluginBuildProvenanceNode[];
	diagnostics: PluginDiagnostic[];
	valid: boolean;
};
export type PluginResolutionInput = {
	catalog: { schemaVersion: 1; revision: number; installations: PluginInstallation[] };
	selection: AgentPluginSelection;
	selectionRevision: number;
	agentId?: string;
	runtime: PluginRuntimeTarget;
	kind?: "preview" | "generation";
	piboSessionId?: string;
	generation?: string;
	resources?: IndependentPluginResource[];
	configurations?: PluginConfigurationSnapshot[];
	/** Exclusive provider choice by kind:name (or kind for unnamed providers). */
	providers?: Record<string, PluginQualifiedId>;
	/** Services available from the already validated app host. */
	services?: Record<string, string>;
	/** Actual service owners from the same host; unique manifest claims may be inferred. */
	serviceProviders?: Record<string, string>;
	/** Revision migrations are explicit, never inferred from version ordering. */
	acceptedRevisions?: Record<string, string[]>;
};
export type PluginBrowserCatalog = {
	schemaVersion: 1;
	revision: number;
	plugins: {
		pluginId: string;
		revision: string;
		version: string;
		contentHash: string;
		browserEntry?: string;
		contributions: PluginContribution[];
	}[];
	diagnostics: PluginDiagnostic[];
};
export type PluginHookDescriptor = {
	id: PluginQualifiedId;
	phase: "pre-tool" | "post-tool" | "input" | "paste" | "drop" | "send";
	order: number;
	required: boolean;
	timeoutMs: number;
};
export type PluginHookResult =
	| { action: "continue" }
	| { action: "transform"; value: PluginJsonValue; provenance: { description: string; inputRefs: string[]; outputRef?: string } }
	| { action: "reject"; reason: string };
