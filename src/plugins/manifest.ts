/** JSON-only public plugin contract. No backend, Node or harness imports. */
export const PLUGIN_MANIFEST_VERSION = 1 as const;
export const PLUGIN_SDK_VERSION = "1.0.0";
export const PLUGIN_MANIFEST_FILENAME = "pibo.plugin.json";
export type PluginJsonValue = null | boolean | number | string | PluginJsonValue[] | { [key: string]: PluginJsonValue };
export type PluginJsonObject = { [key: string]: PluginJsonValue };
export type PluginJsonSchema = PluginJsonObject;
export type PluginQualifiedId = `${string}/${string}`;
export type PluginDiagnostic = {
	code: string;
	severity: "error" | "warning" | "info";
	message: string;
	pluginId?: string;
	contributionId?: string;
	path: string[];
};
export type PluginSource =
	| { kind: "builtin"; name: string }
	| { kind: "local"; path: string }
	| { kind: "package"; name: string; version: string; registry?: string };
export type PluginInstallationState = "staged" | "installed" | "active" | "pending-activation" | "retiring" | "failed" | "uninstalled";
export type PluginRevision = {
	pluginId: string;
	revision: string;
	version: string;
	contentHash: string;
	source: PluginSource;
	manifest: PluginManifest;
	/** Immutable artifact root; never a mutable development directory. Backend-only location. */
	artifactPath?: string;
	createdAt: string;
};
export type PluginInstallation = PluginRevision & {
	state: PluginInstallationState;
	enabled: boolean;
	/** Store CAS revision, distinct from immutable artifact revision. */
	stateRevision: number;
	diagnostics?: PluginDiagnostic[];
};
export type PluginServiceRequirement = { id: string; version: string; optional?: boolean };
export type PluginServiceDeclaration = { id: string; version: string; replaces?: string[] };
export type PluginRuntimeRequirement = {
	adapterIds?: string[];
	instanceIds?: string[];
	/** Dotted capability paths into the adapter's existing capability object. */
	capabilities?: string[];
	deliveryModes?: string[];
};
export type PluginContextEffect =
	| { kind: "none"; reason: string }
	| { kind: "context"; stage: string; description: string; loading: "eager" | "progressive" | "runtime" };
export type PluginSettingsScope = "app" | "agent" | "session";
export type PluginConfigurationTarget =
	| { scope: "app"; pluginId: string }
	| { scope: "agent"; pluginId: string; agentId: string }
	| { scope: "session"; pluginId: string; piboSessionId: string };
export type PluginConfigurationSnapshot = {
	target: PluginConfigurationTarget;
	revision: number;
	schemaVersion: number;
	values: PluginJsonObject;
};
export type PluginViewDefinition = {
	title: string;
	icon?: string;
	/** Export of the prebuilt browser entry, not a backend module path. */
	exportName: string;
	visibility: "session" | "infrastructure";
	instance: "singleton" | "multiple";
	mount: "unmount" | "keep-alive";
	stateSchemaVersion: number;
	stateSchema?: PluginJsonSchema;
	subviews?: { id: string; title: string; purpose: "content" | "settings" | "context"; settingsScopes?: PluginSettingsScope[] }[];
};
export type PluginContribution = {
	id: string;
	/** Open service-owned namespace; the kernel does not close this union. */
	kind: string;
	title?: string;
	scope: "app" | "agent";
	required: boolean;
	defaultEnabled: boolean;
	schemaVersion: number;
	dependsOn?: PluginQualifiedId[];
	services?: PluginServiceRequirement[];
	runtime?: PluginRuntimeRequirement;
	context: PluginContextEffect;
	/** Visible name conflicts are checked per kind (tools share the tool namespace). */
	name?: string;
	replaces?: PluginQualifiedId[];
	order?: number;
	configSchema?: PluginJsonSchema;
	metadata?: PluginJsonObject;
	view?: PluginViewDefinition;
};
export type PluginManifest = {
	schemaVersion: 1;
	id: string;
	name: string;
	version: string;
	sdk: string;
	entrypoints?: { backend?: string; browser?: string };
	dependencies?: { id: string; version: string; optional?: boolean }[];
	services?: { provides?: PluginServiceDeclaration[]; requires?: PluginServiceRequirement[] };
	config?: { schemaVersion: number; schema: PluginJsonSchema };
	dataSchemaVersion?: number;
	contributions: PluginContribution[];
};
export type PluginCatalog = { schemaVersion: 1; revision: number; installations: PluginInstallation[] };
export type PluginTabInstance = {
	instanceId: string;
	piboSessionId: string;
	pluginId: string;
	viewId: PluginQualifiedId;
	pluginRevision: string;
	stateSchemaVersion: number;
	state: PluginJsonObject;
	subviewId?: string;
	instanceKey?: string;
	fallback: string;
};
export type PluginSessionTabset = {
	schemaVersion: 1;
	piboSessionId: string;
	revision: number;
	tabs: PluginTabInstance[];
	activeTabId: string | null;
	layout: PluginJsonObject;
};
export type PluginArtifactEnvelope = {
	schemaVersion: 1;
	pluginId: string;
	contributionId: PluginQualifiedId;
	dataSchemaVersion: number;
	objectId: string;
	eventId: string;
	payload?: PluginJsonValue;
	payloadRef?: string;
	fallback: string;
};

export function qualifyPluginContribution(pluginId: string, contributionId: string): PluginQualifiedId {
	return `${pluginId}/${contributionId}`;
}
