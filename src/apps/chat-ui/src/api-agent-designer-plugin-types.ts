import type { AgentPluginSelection, PluginContribution, PluginDiagnostic } from "../../../plugins/sdk.js";

/** JSON-only Designer transport types. Safe in backend and browser; selection stays SDK-owned. */
export type AgentPluginCatalog = {
	schemaVersion: 1;
	revision: number;
	plugins: { pluginId: string; name: string; revision: string; version: string; state: string; enabled: boolean; contributions: PluginContribution[]; initialSelection?: AgentPluginSelection["plugins"][number] }[];
};

export type AgentPluginMigrationReport = {
	schemaVersion: 1;
	status: "ready" | "conflict";
	sourceHash: string;
	selection: AgentPluginSelection;
	before: string[];
	after: string[];
	beforeTools: string[];
	afterTools: string[];
	userSkills: string[];
	userContextFiles: string[];
	inactivePiPackages: string[];
	diagnostics: PluginDiagnostic[];
};
