import type { AgentPluginMigrationReport, AgentPluginMigrationResourceSnapshot } from "../chat-ui/src/api-agent-designer-plugin-types.js";
export type { AgentPluginMigrationReport, AgentPluginMigrationResourceSnapshot } from "../chat-ui/src/api-agent-designer-plugin-types.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../../core/pibo-home.js";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_RUNTIME_INSTANCE_ID, DEFAULT_BUILTIN_TOOL_NAMES, type BuiltinToolsMode, type ModelProfile } from "../../core/profiles.js";
import type { PiboJsonObject } from "../../core/events.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import { validateAgentPluginSelection } from "../../plugins/selection.js";
import { resolvePluginContributions } from "../../plugins/resolution.js";
import type { AgentPluginSelection, PluginCatalog, PluginRuntimeTarget, PluginDiagnostic } from "../../plugins/sdk.js";
import { PluginConflictError, pluginJson, type PluginStore } from "../../plugins/store.js";
import { PluginMigrationJournal } from "../../plugins/migration-journal.js";
import type { PluginConsumer } from "../../plugins/operations.js";
import { PIBO_GOAL_TOOL_NAMES } from "../../loops/tools.js";
import { PIBO_RUN_TOOL_NAMES } from "../../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../../subagents/tool.js";

export type CustomAgentSubagent = {
	name: string;
	description?: string;
	targetProfile: string;
	model?: ModelProfile;
	modelFallbacks?: ModelProfile[];
	thinkingLevel?: PiboThinkingLevel;
	runtimeOptions?: PiboJsonObject;
	/** @deprecated Compatibility-only. Does not limit delegated request or yielded-run lifetime. */
	timeoutMs?: number;
	maxDepth?: number;
};

export type CustomAgentFolderDefinition = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
};

export type CustomAgentDefinition = {
	id: string;
	revision: number;
	pluginSelection?: AgentPluginSelection;
	pluginMigration?: AgentPluginMigrationReport;
	profileName: string;
	displayName: string;
	profileAliases: string[];
	folderId?: string;
	description?: string;
	runtimeInstanceId: string;
	runtimeOptions: PiboJsonObject;
	nativeSubagents?: boolean;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgentSubagent[];
	mcpServers: string[];
	piPackages: string[];
	mainModel?: ModelProfile;
	mainModelFallbacks: ModelProfile[];
	subagentModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	mainThinkingLevel?: PiboThinkingLevel;
	subagentThinkingLevel?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools: BuiltinToolsMode;
	builtinToolNames: string[];
	autoContextFiles: boolean;
	runControl: boolean;
	goalControl: boolean;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
};

export class CustomAgentTargetReferenceError extends Error {
	readonly targetProfileName: string;
	readonly dependentProfileNames: string[];

	constructor(targetProfileName: string, dependentProfileNames: readonly string[]) {
		const sortedNames = [...dependentProfileNames].sort((left, right) => left.localeCompare(right));
		super(`Custom agent "${targetProfileName}" is targeted by custom agents: ${sortedNames.join(", ")}`);
		this.name = "CustomAgentTargetReferenceError";
		this.targetProfileName = targetProfileName;
		this.dependentProfileNames = sortedNames;
	}
}

const CUSTOM_AGENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type CreateCustomAgentInput = {
	/** Version 2 forbids legacy executable-selection fields. */
	schemaVersion?: 2;
	pluginSelection?: AgentPluginSelection;
	displayName: string;
	description?: string;
	folderId?: string;
	runtimeInstanceId?: string;
	runtimeOptions?: PiboJsonObject;
	nativeSubagents?: boolean;
	nativeTools?: string[];
	skills?: string[];
	contextFiles?: string[];
	subagents?: CustomAgentSubagent[];
	mcpServers?: string[];
	piPackages?: string[];
	mainModel?: ModelProfile;
	mainModelFallbacks?: ModelProfile[];
	subagentModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	mainThinkingLevel?: PiboThinkingLevel;
	subagentThinkingLevel?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools?: BuiltinToolsMode;
	builtinToolNames?: string[];
	autoContextFiles?: boolean;
	runControl?: boolean;
	goalControl?: boolean;
};

export type UpdateCustomAgentInput = Omit<Partial<CreateCustomAgentInput>, "description" | "folderId" | "nativeSubagents" | "autoContextFiles" | "mainModel" | "subagentModel"> & {
	description?: string | null;
	folderId?: string | null;
	nativeSubagents?: boolean | null;
	autoContextFiles?: boolean | null;
	mainModel?: ModelProfile | null;
	subagentModel?: ModelProfile | null;
};

type AgentFolderRow = {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
};

type AgentRow = {
	id: string;
	revision: number;
	plugin_selection_json: string | null;
	plugin_migration_json: string | null;
	profile_name: string;
	display_name: string;
	description: string | null;
	folder_id: string | null;
	runtime_instance_id: string;
	runtime_options_json: string;
	native_subagents: 0 | 1 | null;
	native_tools_json: string;
	skills_json: string;
	context_files_json: string;
	subagents_json: string;
	mcp_servers_json: string;
	pi_packages_json: string;
	main_model_json: string | null;
	main_model_fallbacks_json: string;
	subagent_model_json: string | null;
	thinking_level: string | null;
	main_thinking_level: string | null;
	subagent_thinking_level: string | null;
	fast: 0 | 1 | null;
	main_fast: 0 | 1 | null;
	subagent_fast: 0 | 1 | null;
	builtin_tools: BuiltinToolsMode;
	builtin_tool_names_json: string;
	auto_context_files: 0 | 1;
	run_control: 0 | 1;
	goal_control: 0 | 1;
	created_at: string;
	updated_at: string;
	archived_at: string | null;
};

export function previewCustomAgentCreate(
	input: CreateCustomAgentInput,
	options: { id?: string; now?: string } = {},
): CustomAgentDefinition {
	assertAgentSelectionInput(input);
	const now = options.now ?? new Date().toISOString();
	const id = options.id ?? `agent_${randomUUID()}`;
	return {
		id,
		revision: 1,
		pluginSelection: input.pluginSelection ? structuredClone(input.pluginSelection) : undefined,
		profileName: input.displayName,
		displayName: input.displayName,
		profileAliases: [],
		folderId: input.folderId,
		description: input.description,
		runtimeInstanceId: sanitizeRuntimeInstanceId(input.runtimeInstanceId),
		runtimeOptions: cloneRuntimeOptions(input.runtimeOptions),
		nativeSubagents: sanitizeBoolean(input.nativeSubagents),
		nativeTools: [...(input.nativeTools ?? [])],
		skills: [...(input.skills ?? [])],
		contextFiles: [...(input.contextFiles ?? [])],
		subagents: sanitizeSubagents(input.subagents ?? []),
		mcpServers: uniqueStrings(input.mcpServers ?? []),
		piPackages: uniqueStrings(input.piPackages ?? []),
		mainModel: sanitizeModelProfile(input.mainModel),
		mainModelFallbacks: sanitizeModelFallbacks(input.mainModelFallbacks ?? [], input.mainModel),
		subagentModel: sanitizeModelProfile(input.subagentModel),
		thinkingLevel: sanitizeThinkingLevel(input.thinkingLevel),
		mainThinkingLevel: sanitizeThinkingLevel(input.mainThinkingLevel),
		subagentThinkingLevel: sanitizeThinkingLevel(input.subagentThinkingLevel),
		fast: sanitizeBoolean(input.fast),
		mainFast: sanitizeBoolean(input.mainFast),
		subagentFast: sanitizeBoolean(input.subagentFast),
		builtinTools: input.builtinTools ?? "default",
		builtinToolNames: sanitizeBuiltinToolNames(input.builtinToolNames),
		autoContextFiles: sanitizeBoolean(input.autoContextFiles) ?? true,
		runControl: input.pluginSelection ? false : input.runControl ?? false,
		goalControl: input.pluginSelection ? false : input.goalControl ?? true,
		createdAt: now,
		updatedAt: now,
	};
}

export function previewCustomAgentUpdate(
	existing: CustomAgentDefinition,
	input: UpdateCustomAgentInput,
	options: { now?: string } = {},
): CustomAgentDefinition {
	assertAgentSelectionInput(input, existing);
	const profileName = input.displayName ?? existing.displayName;
	return {
		...existing,
		revision: existing.revision + 1,
		pluginSelection: input.pluginSelection ? structuredClone(input.pluginSelection) : existing.pluginSelection,
		profileName,
		displayName: input.displayName ?? existing.displayName,
		folderId: input.folderId === undefined ? existing.folderId : input.folderId ?? undefined,
		description: input.description === undefined ? existing.description : input.description ?? undefined,
		runtimeInstanceId: input.runtimeInstanceId === undefined ? existing.runtimeInstanceId : sanitizeRuntimeInstanceId(input.runtimeInstanceId),
		runtimeOptions: input.runtimeOptions === undefined ? existing.runtimeOptions : cloneRuntimeOptions(input.runtimeOptions),
		nativeSubagents: input.nativeSubagents === undefined ? existing.nativeSubagents : sanitizeBoolean(input.nativeSubagents),
		nativeTools: input.nativeTools ? [...input.nativeTools] : existing.nativeTools,
		skills: input.skills ? [...input.skills] : existing.skills,
		contextFiles: input.contextFiles ? [...input.contextFiles] : existing.contextFiles,
		subagents: input.subagents ? sanitizeSubagents(input.subagents) : existing.subagents,
		mcpServers: input.mcpServers ? uniqueStrings(input.mcpServers) : existing.mcpServers,
		piPackages: input.piPackages ? uniqueStrings(input.piPackages) : existing.piPackages,
		mainModel: input.mainModel === undefined ? existing.mainModel : sanitizeModelProfile(input.mainModel),
		mainModelFallbacks: sanitizeModelFallbacks(
			input.mainModelFallbacks ?? existing.mainModelFallbacks,
			input.mainModel === undefined ? existing.mainModel : input.mainModel,
		),
		subagentModel: input.subagentModel === undefined ? existing.subagentModel : sanitizeModelProfile(input.subagentModel),
		thinkingLevel: input.thinkingLevel === undefined ? existing.thinkingLevel : sanitizeThinkingLevel(input.thinkingLevel),
		mainThinkingLevel: input.mainThinkingLevel === undefined ? existing.mainThinkingLevel : sanitizeThinkingLevel(input.mainThinkingLevel),
		subagentThinkingLevel: input.subagentThinkingLevel === undefined ? existing.subagentThinkingLevel : sanitizeThinkingLevel(input.subagentThinkingLevel),
		fast: input.fast === undefined ? existing.fast : sanitizeBoolean(input.fast),
		mainFast: input.mainFast === undefined ? existing.mainFast : sanitizeBoolean(input.mainFast),
		subagentFast: input.subagentFast === undefined ? existing.subagentFast : sanitizeBoolean(input.subagentFast),
		builtinTools: input.builtinTools ?? existing.builtinTools,
		builtinToolNames: input.builtinToolNames ? sanitizeBuiltinToolNames(input.builtinToolNames) : existing.builtinToolNames,
		autoContextFiles: input.autoContextFiles === undefined
			? existing.autoContextFiles
			: sanitizeBoolean(input.autoContextFiles) ?? true,
		runControl: input.runControl ?? existing.runControl,
		goalControl: input.goalControl ?? existing.goalControl,
		updatedAt: options.now ?? new Date().toISOString(),
	};
}

export class CustomAgentStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_agent_folders (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL COLLATE NOCASE UNIQUE,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS chat_agents (
				id TEXT PRIMARY KEY,
				profile_name TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				description TEXT,
				folder_id TEXT REFERENCES chat_agent_folders(id) ON DELETE SET NULL,
				runtime_instance_id TEXT NOT NULL DEFAULT 'pi',
				runtime_options_json TEXT NOT NULL DEFAULT '{}',
				native_subagents INTEGER,
				native_tools_json TEXT NOT NULL,
				skills_json TEXT NOT NULL,
				context_files_json TEXT NOT NULL,
				subagents_json TEXT NOT NULL,
				mcp_servers_json TEXT NOT NULL DEFAULT '[]',
				pi_packages_json TEXT NOT NULL DEFAULT '[]',
				main_model_json TEXT,
				main_model_fallbacks_json TEXT NOT NULL DEFAULT '[]',
				subagent_model_json TEXT,
				thinking_level TEXT,
				main_thinking_level TEXT,
				subagent_thinking_level TEXT,
				fast INTEGER,
				main_fast INTEGER,
				subagent_fast INTEGER,
				builtin_tools TEXT NOT NULL,
				builtin_tool_names_json TEXT NOT NULL DEFAULT '["read","bash","edit","write"]',
				auto_context_files INTEGER NOT NULL DEFAULT 1,
				run_control INTEGER NOT NULL,
				goal_control INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				archived_at TEXT
			);

		`);
		this.migrateAgentFolderColumn();
		this.migrateProfileAliasTable();
		this.migrateArchivedAtColumn();
		this.migrateAutoContextFilesColumn();
		this.migrateNativeSubagentsColumn();
		this.migrateMcpServersColumn();
		this.migrateRuntimeColumns();
		this.migratePiPackagesColumn();
		this.migrateModelColumns();
		this.migrateModelFallbackColumns();
		this.migrateThinkingLevelColumn();
		this.migrateThinkingOptionColumns();
		this.migrateBuiltinToolNamesColumn();
		this.migrateGoalControlColumn();
		this.migratePluginSelectionColumns();
		this.migrateAgentHistory();
		this.migrateLegacyProfileNames();
		this.migrateDuplicateProfileNames();
	}

	listFolders(): CustomAgentFolderDefinition[] {
		const rows = this.db.prepare("SELECT * FROM chat_agent_folders ORDER BY name COLLATE NOCASE ASC, created_at ASC").all() as AgentFolderRow[];
		return rows.map(folderFromRow);
	}

	getFolder(id: string): CustomAgentFolderDefinition | undefined {
		const row = this.db.prepare("SELECT * FROM chat_agent_folders WHERE id = ?").get(id) as AgentFolderRow | undefined;
		return row ? folderFromRow(row) : undefined;
	}

	createFolder(name: string): CustomAgentFolderDefinition {
		const normalizedName = normalizeCustomAgentFolderName(name);
		this.requireFolderNameAvailable(normalizedName);
		const now = new Date().toISOString();
		const id = `agent_folder_${randomUUID()}`;
		this.db.prepare("INSERT INTO chat_agent_folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, normalizedName, now, now);
		return this.getFolder(id)!;
	}

	renameFolder(id: string, name: string): CustomAgentFolderDefinition | undefined {
		const existing = this.getFolder(id);
		if (!existing) return undefined;
		const normalizedName = normalizeCustomAgentFolderName(name);
		this.requireFolderNameAvailable(normalizedName, id);
		this.db.prepare("UPDATE chat_agent_folders SET name = ?, updated_at = ? WHERE id = ?").run(normalizedName, new Date().toISOString(), id);
		return this.getFolder(id);
	}

	deleteFolder(id: string): boolean {
		const assigned = this.db.prepare("SELECT COUNT(*) AS count FROM chat_agents WHERE folder_id = ?").get(id) as { count: number };
		if (assigned.count > 0) throw new Error("Move agents out of this folder before deleting it");
		const result = this.db.prepare("DELETE FROM chat_agent_folders WHERE id = ?").run(id);
		return Number(result.changes ?? 0) > 0;
	}

	list(options: { includeArchived?: boolean } = {}): CustomAgentDefinition[] {
		this.migrateLegacyProfileNames();
		this.migrateDuplicateProfileNames();
		const archivedClause = options.includeArchived ? "" : " AND archived_at IS NULL";
		const rows = this.db.prepare(`SELECT * FROM chat_agents WHERE 1 = 1${archivedClause} ORDER BY updated_at DESC`).all();
		const profileAliases = this.profileAliasesByAgentId();
		return (rows as AgentRow[]).map((row) => agentFromRow(row, profileAliases.get(row.id) ?? []));
	}

	get(id: string): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const row = this.db.prepare("SELECT * FROM chat_agents WHERE id = ?").get(id) as AgentRow | undefined;
		return row ? agentFromRow(row, this.profileAliasesByAgentId().get(row.id) ?? []) : undefined;
	}

	create(input: CreateCustomAgentInput): CustomAgentDefinition {
		this.migrateLegacyProfileNames();
		this.requireProfileNameAvailable(input.displayName);
		this.requireFolderExists(input.folderId);
		const agent = previewCustomAgentCreate(input);
		this.insert(agent);
		const created = this.get(agent.id);
		if (!created) throw new Error(`Failed to create custom agent "${agent.id}"`);
		return created;
	}

	update(id: string, input: UpdateCustomAgentInput, options: { expectedRevision?: number } = {}): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const existing = this.get(id);
		if (!existing) return undefined;
		const expectedRevision = requireAgentRevision(existing, options.expectedRevision);
		const profileName = input.displayName ?? existing.displayName;
		this.requireProfileNameAvailable(profileName, id);
		this.requireFolderExists(input.folderId);
		const updated = previewCustomAgentUpdate(existing, input);
		const result = this.db
			.prepare(`
				UPDATE chat_agents SET
					revision = revision + 1,
					plugin_selection_json = ?,
					profile_name = ?,
					display_name = ?,
					description = ?,
					folder_id = ?,
					runtime_instance_id = ?,
					runtime_options_json = ?,
					native_subagents = ?,
					native_tools_json = ?,
					skills_json = ?,
					context_files_json = ?,
					subagents_json = ?,
					mcp_servers_json = ?,
					pi_packages_json = ?,
					main_model_json = ?,
					main_model_fallbacks_json = ?,
					subagent_model_json = ?,
					thinking_level = ?,
					main_thinking_level = ?,
					subagent_thinking_level = ?,
					fast = ?,
					main_fast = ?,
					subagent_fast = ?,
					builtin_tools = ?,
					builtin_tool_names_json = ?,
					auto_context_files = ?,
					run_control = ?,
					goal_control = ?,
					updated_at = ?
				WHERE id = ? AND revision = ?
			`)
			.run(
				updated.pluginSelection ? pluginJson(updated.pluginSelection) : null,
				updated.profileName,
				updated.displayName,
				updated.description ?? null,
				updated.folderId ?? null,
				updated.runtimeInstanceId,
				JSON.stringify(updated.runtimeOptions),
				serializeBoolean(updated.nativeSubagents),
				JSON.stringify(updated.nativeTools),
				JSON.stringify(updated.skills),
				JSON.stringify(updated.contextFiles),
				JSON.stringify(sanitizeSubagents(updated.subagents)),
				JSON.stringify(updated.mcpServers),
				JSON.stringify(updated.piPackages),
				updated.mainModel ? JSON.stringify(updated.mainModel) : null,
				JSON.stringify(updated.mainModelFallbacks),
				updated.subagentModel ? JSON.stringify(updated.subagentModel) : null,
				updated.thinkingLevel ?? null,
				updated.mainThinkingLevel ?? null,
				updated.subagentThinkingLevel ?? null,
				serializeBoolean(updated.fast),
				serializeBoolean(updated.mainFast),
				serializeBoolean(updated.subagentFast),
				updated.builtinTools,
				JSON.stringify(updated.builtinToolNames),
				updated.autoContextFiles ? 1 : 0,
				updated.runControl ? 1 : 0,
				updated.goalControl ? 1 : 0,
				updated.updatedAt,
				id,
				expectedRevision,
			);
		if (!Number(result.changes)) throw new PluginConflictError("Agent revision changed; reload before saving");
		return this.get(id);
	}

	setArchived(id: string, archived: boolean, options: { expectedRevision?: number } = {}): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const existing = this.get(id);
		if (!existing) return undefined;
		const expectedRevision = requireAgentRevision(existing, options.expectedRevision);
		const archivedAt = archived ? existing.archivedAt ?? new Date().toISOString() : null;
		const result = this.db
			.prepare("UPDATE chat_agents SET archived_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
			.run(archivedAt, new Date().toISOString(), id, expectedRevision);
		if (!Number(result.changes)) throw new PluginConflictError("Agent revision changed; reload before archiving");
		return this.get(id);
	}

	listReferencingAgents(id: string): CustomAgentDefinition[] {
		this.migrateLegacyProfileNames();
		const target = this.get(id);
		if (!target) return [];
		const targetNames = new Set([
			target.profileName,
			target.id,
			`custom-agent:${target.id}`,
			...target.profileAliases,
		]);
		return this.list({ includeArchived: true })
			.filter((agent) => agent.id !== id && agent.subagents.some((subagent) => targetNames.has(subagent.targetProfile)))
			.sort((left, right) => left.profileName.localeCompare(right.profileName));
	}

	delete(id: string): boolean {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const target = this.get(id);
			if (!target) {
				this.db.exec("COMMIT");
				return false;
			}
			const dependents = this.listReferencingAgents(id);
			if (dependents.length > 0) {
				throw new CustomAgentTargetReferenceError(target.profileName, dependents.map((agent) => agent.profileName));
			}
			this.db.prepare("DELETE FROM chat_agent_profile_aliases WHERE agent_id = ?").run(id);
			const result = this.db.prepare("DELETE FROM chat_agents WHERE id = ?").run(id);
			this.db.exec("COMMIT");
			return Number(result.changes ?? 0) > 0;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}

	private insert(agent: CustomAgentDefinition): void {
		this.db
			.prepare(`
				INSERT INTO chat_agents (
					id,
					plugin_selection_json,
					profile_name,
					display_name,
					description,
					folder_id,
					runtime_instance_id,
					runtime_options_json,
					native_subagents,
					native_tools_json,
					skills_json,
					context_files_json,
					subagents_json,
					mcp_servers_json,
					pi_packages_json,
					main_model_json,
					main_model_fallbacks_json,
					subagent_model_json,
					thinking_level,
					main_thinking_level,
					subagent_thinking_level,
					fast,
					main_fast,
					subagent_fast,
					builtin_tools,
					builtin_tool_names_json,
					auto_context_files,
					run_control,
					goal_control,
					created_at,
					updated_at,
					archived_at
				) VALUES (${Array.from({ length: 32 }, () => "?").join(", ")})
			`)
			.run(
				agent.id,
				agent.pluginSelection ? pluginJson(agent.pluginSelection) : null,
				agent.profileName,
				agent.displayName,
				agent.description ?? null,
				agent.folderId ?? null,
				agent.runtimeInstanceId,
				JSON.stringify(agent.runtimeOptions),
				serializeBoolean(agent.nativeSubagents),
				JSON.stringify(agent.nativeTools),
				JSON.stringify(agent.skills),
				JSON.stringify(agent.contextFiles),
				JSON.stringify(sanitizeSubagents(agent.subagents)),
				JSON.stringify(agent.mcpServers),
				JSON.stringify(agent.piPackages),
				agent.mainModel ? JSON.stringify(agent.mainModel) : null,
				JSON.stringify(agent.mainModelFallbacks),
				agent.subagentModel ? JSON.stringify(agent.subagentModel) : null,
				agent.thinkingLevel ?? null,
				agent.mainThinkingLevel ?? null,
				agent.subagentThinkingLevel ?? null,
				serializeBoolean(agent.fast),
				serializeBoolean(agent.mainFast),
				serializeBoolean(agent.subagentFast),
				agent.builtinTools,
				JSON.stringify(agent.builtinToolNames),
				agent.autoContextFiles ? 1 : 0,
				agent.runControl ? 1 : 0,
				agent.goalControl ? 1 : 0,
				agent.createdAt,
				agent.updatedAt,
				agent.archivedAt ?? null,
			);
	}

	private requireFolderExists(folderId: string | null | undefined): void {
		if (folderId === undefined || folderId === null) return;
		if (!this.getFolder(folderId)) throw new Error(`Agent folder "${folderId}" does not exist`);
	}

	private requireFolderNameAvailable(name: string, currentId?: string): void {
		const row = this.db.prepare("SELECT id FROM chat_agent_folders WHERE name = ? COLLATE NOCASE").get(name) as { id: string } | undefined;
		if (row && row.id !== currentId) throw new Error(`Agent folder "${name}" already exists`);
	}

	private requireProfileNameAvailable(profileName: string, currentId?: string): void {
		const row = this.db.prepare("SELECT id FROM chat_agents WHERE profile_name = ?").get(profileName) as { id: string } | undefined;
		if (row && row.id !== currentId) throw new Error(`Agent name "${profileName}" already exists`);
		const alias = this.db.prepare("SELECT agent_id FROM chat_agent_profile_aliases WHERE old_profile_name = ?").get(profileName) as { agent_id: string } | undefined;
		if (alias && alias.agent_id !== currentId) throw new Error(`Agent name "${profileName}" already exists`);
	}

	private profileAliasesByAgentId(): Map<string, string[]> {
		const rows = this.db.prepare("SELECT agent_id, old_profile_name FROM chat_agent_profile_aliases ORDER BY created_at ASC, old_profile_name ASC").all() as Array<{ agent_id: string; old_profile_name: string }>;
		const aliases = new Map<string, string[]>();
		for (const row of rows) {
			const values = aliases.get(row.agent_id) ?? [];
			if (!values.includes(row.old_profile_name)) values.push(row.old_profile_name);
			aliases.set(row.agent_id, values);
		}
		return aliases;
	}

	private migrateLegacyProfileNames(): void {
		const rows = this.db.prepare("SELECT id, profile_name, display_name FROM chat_agents ORDER BY created_at ASC").all() as Array<{
			id: string;
			profile_name: string;
			display_name: string;
		}>;
		const used = new Set(rows.map((row) => row.profile_name));
		for (const row of rows) {
			if (!row.profile_name.startsWith("custom-agent:agent_")) continue;
			used.delete(row.profile_name);
			const nextName = uniqueAgentName(agentNameCandidate(row.display_name, row.id), used);
			used.add(nextName);
			this.db
				.prepare("UPDATE chat_agents SET profile_name = ?, display_name = ? WHERE id = ?")
				.run(nextName, nextName, row.id);
		}
	}

	private migrateDuplicateProfileNames(): void {
		const rows = this.db.prepare("SELECT id, profile_name, display_name, created_at, updated_at FROM chat_agents ORDER BY profile_name ASC, updated_at DESC, created_at DESC, id DESC").all() as Array<{
			id: string;
			profile_name: string;
			display_name: string;
			created_at: string;
			updated_at: string;
		}>;
		const used = new Set<string>();
		for (const row of rows) {
			if (!used.has(row.profile_name)) {
				used.add(row.profile_name);
				continue;
			}
			const nextName = uniqueAgentName(legacyAgentNameCandidate(row.profile_name, row.id), used);
			used.add(nextName);
			this.db
				.prepare("UPDATE chat_agents SET profile_name = ?, display_name = ? WHERE id = ?")
				.run(nextName, nextName, row.id);
		}
		this.db.prepare(`
			DELETE FROM chat_agent_profile_aliases
			WHERE EXISTS (
				SELECT 1
				FROM chat_agents
				WHERE chat_agents.profile_name = chat_agent_profile_aliases.old_profile_name
					AND chat_agents.id != chat_agent_profile_aliases.agent_id
			)
		`).run();
	}

	private migrateAgentFolderColumn(): void {
		if (!this.tableColumns().has("folder_id")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN folder_id TEXT REFERENCES chat_agent_folders(id) ON DELETE SET NULL").run();
		}
		this.db.exec("CREATE INDEX IF NOT EXISTS chat_agents_folder_id_idx ON chat_agents(folder_id)");
	}

	private migrateProfileAliasTable(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_agent_profile_aliases (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				old_profile_name TEXT NOT NULL UNIQUE,
				new_profile_name TEXT NOT NULL,
				created_at TEXT NOT NULL,
				FOREIGN KEY(agent_id) REFERENCES chat_agents(id) ON DELETE CASCADE
			);

			CREATE TRIGGER IF NOT EXISTS chat_agents_profile_alias_insert
			AFTER UPDATE OF profile_name ON chat_agents
			WHEN OLD.profile_name IS NOT NEW.profile_name
			BEGIN
				INSERT INTO chat_agent_profile_aliases (
					id,
					agent_id,
					old_profile_name,
					new_profile_name,
					created_at
				) VALUES (
					'alias_' || lower(hex(randomblob(16))),
					NEW.id,
					OLD.profile_name,
					NEW.profile_name,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				)
				ON CONFLICT(old_profile_name) DO UPDATE SET
					agent_id = excluded.agent_id,
					new_profile_name = excluded.new_profile_name,
					created_at = excluded.created_at
				WHERE chat_agent_profile_aliases.agent_id = excluded.agent_id;

				DELETE FROM chat_agent_profile_aliases
				WHERE agent_id = NEW.id AND old_profile_name = NEW.profile_name;
			END;
		`);
	}

	private tableColumns(): Set<string> {
		return new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
	}

	private migrateArchivedAtColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("archived_at")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN archived_at TEXT").run();
		}
	}

	private migrateAutoContextFilesColumn(): void {
		if (!this.tableColumns().has("auto_context_files")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN auto_context_files INTEGER NOT NULL DEFAULT 1").run();
		}
	}

	private migrateNativeSubagentsColumn(): void {
		if (!this.tableColumns().has("native_subagents")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN native_subagents INTEGER").run();
		}
	}

	private migrateMcpServersColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("mcp_servers_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN mcp_servers_json TEXT NOT NULL DEFAULT '[]'").run();
		}
	}

	private migrateRuntimeColumns(): void {
		const columns = this.tableColumns();
		if (!columns.has("runtime_instance_id")) {
			this.db.prepare(`ALTER TABLE chat_agents ADD COLUMN runtime_instance_id TEXT NOT NULL DEFAULT '${DEFAULT_AGENT_RUNTIME_INSTANCE_ID}'`).run();
		}
		if (!columns.has("runtime_options_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN runtime_options_json TEXT NOT NULL DEFAULT '{}'").run();
		}
	}

	private migratePiPackagesColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("pi_packages_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN pi_packages_json TEXT NOT NULL DEFAULT '[]'").run();
		}
	}

	private migrateModelColumns(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("main_model_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN main_model_json TEXT").run();
		}
		if (!columns.has("subagent_model_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN subagent_model_json TEXT").run();
		}
	}

	private migrateModelFallbackColumns(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("main_model_fallbacks_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN main_model_fallbacks_json TEXT NOT NULL DEFAULT '[]'").run();
		}
	}

	private migrateThinkingLevelColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("thinking_level")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN thinking_level TEXT").run();
		}
	}

	private migrateThinkingOptionColumns(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("main_thinking_level")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN main_thinking_level TEXT").run();
		}
		if (!columns.has("subagent_thinking_level")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN subagent_thinking_level TEXT").run();
		}
		if (!columns.has("fast")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN fast INTEGER").run();
		}
		if (!columns.has("main_fast")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN main_fast INTEGER").run();
		}
		if (!columns.has("subagent_fast")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN subagent_fast INTEGER").run();
		}
	}

	private migrateBuiltinToolNamesColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("builtin_tool_names_json")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN builtin_tool_names_json TEXT NOT NULL DEFAULT '[\"read\",\"bash\",\"edit\",\"write\"]'").run();
		}
	}

	private migrateGoalControlColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("goal_control")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN goal_control INTEGER NOT NULL DEFAULT 1").run();
		}
	}

	private migratePluginSelectionColumns(): void {
		const columns = this.tableColumns();
		if (!columns.has("revision")) this.db.exec("ALTER TABLE chat_agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
		if (!columns.has("plugin_selection_json")) this.db.exec("ALTER TABLE chat_agents ADD COLUMN plugin_selection_json TEXT");
		if (!columns.has("plugin_migration_json")) this.db.exec("ALTER TABLE chat_agents ADD COLUMN plugin_migration_json TEXT");
	}

	/** Exact legacy SQLite values, not sanitized public DTOs. Migration metadata is excluded so a journaled retry sees the same source. */
	exportLegacyAgent(id: string, resources: readonly LegacyAgentMigrationSourceResource[] = []): Uint8Array {
		const stored = this.db.prepare("SELECT * FROM chat_agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		if (!stored) throw new Error(`Unknown agent "${id}"`);
		const row = { ...stored };
		delete row.revision;
		delete row.plugin_selection_json;
		delete row.plugin_migration_json;
		const aliases = this.db.prepare("SELECT * FROM chat_agent_profile_aliases WHERE agent_id = ? ORDER BY id").all(id);
		return Buffer.from(JSON.stringify({ schemaVersion: 2, row, aliases, resources }));
	}

	/** Owner-local transaction. The management journal checkpoints this separately. Legacy values remain immutable backup evidence, not a runtime selection source. */
	applyPluginMigration(id: string, report: AgentPluginMigrationReport, source: Uint8Array): void {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const existing = this.get(id);
			if (!existing) throw new Error(`Unknown agent "${id}"`);
			const alreadyApplied = pluginJson(existing.pluginMigration ?? null) === pluginJson(report)
				&& pluginJson(existing.pluginSelection ?? null) === pluginJson(report.selection);
			if (alreadyApplied) {
				this.db.exec("COMMIT");
				return;
			}
			if (createHash("sha256").update(source).digest("hex") !== report.sourceHash
				|| pluginJson(legacyAgentDatabaseSnapshot(source)) !== pluginJson(legacyAgentDatabaseSnapshot(this.exportLegacyAgent(id)))) {
				throw new PluginConflictError("Legacy agent changed since migration preview");
			}
			if (existing.pluginSelection && !isUnresolvedAgentPluginMigration(existing)) throw new PluginConflictError("Agent already has an explicit plugin selection");
			const result = this.db.prepare(`UPDATE chat_agents SET plugin_selection_json = ?, plugin_migration_json = ?, revision = revision + 1,
				native_tools_json = '[]', mcp_servers_json = '[]', pi_packages_json = '[]', run_control = 0, goal_control = 0,
				skills_json = ?, context_files_json = ? WHERE id = ? AND revision = ?`).run(
				pluginJson(report.selection), pluginJson(report), JSON.stringify(report.userSkills), JSON.stringify(report.userContextFiles), id, existing.revision,
			);
			if (result.changes !== 1) throw new PluginConflictError("Agent revision changed during migration");
			this.db.exec("COMMIT");
		} catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}

	private migrateAgentHistory(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_agent_events (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				event_type TEXT NOT NULL CHECK (event_type IN ('updated', 'deleted')),
				field_name TEXT,
				old_value TEXT,
				new_value TEXT,
				old_profile_name TEXT,
				new_profile_name TEXT,
				old_display_name TEXT,
				new_display_name TEXT,
				recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			);

			CREATE INDEX IF NOT EXISTS chat_agent_events_agent_id_idx
				ON chat_agent_events(agent_id, recorded_at);

			CREATE INDEX IF NOT EXISTS chat_agent_events_profile_name_idx
				ON chat_agent_events(old_profile_name, new_profile_name, recorded_at);

			CREATE TRIGGER IF NOT EXISTS chat_agents_profile_name_history_update
			AFTER UPDATE OF profile_name ON chat_agents
			FOR EACH ROW
			WHEN OLD.profile_name IS NOT NEW.profile_name
			BEGIN
				INSERT INTO chat_agent_events (
					id,
					agent_id,
					event_type,
					field_name,
					old_value,
					new_value,
					old_profile_name,
					new_profile_name,
					old_display_name,
					new_display_name,
					recorded_at
				) VALUES (
					'agent_event_' || lower(hex(randomblob(16))),
					NEW.id,
					'updated',
					'profile_name',
					OLD.profile_name,
					NEW.profile_name,
					OLD.profile_name,
					NEW.profile_name,
					OLD.display_name,
					NEW.display_name,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				);
			END;

			CREATE TRIGGER IF NOT EXISTS chat_agents_display_name_history_update
			AFTER UPDATE OF display_name ON chat_agents
			FOR EACH ROW
			WHEN OLD.display_name IS NOT NEW.display_name
			BEGIN
				INSERT INTO chat_agent_events (
					id,
					agent_id,
					event_type,
					field_name,
					old_value,
					new_value,
					old_profile_name,
					new_profile_name,
					old_display_name,
					new_display_name,
					recorded_at
				) VALUES (
					'agent_event_' || lower(hex(randomblob(16))),
					NEW.id,
					'updated',
					'display_name',
					OLD.display_name,
					NEW.display_name,
					OLD.profile_name,
					NEW.profile_name,
					OLD.display_name,
					NEW.display_name,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				);
			END;

			CREATE TRIGGER IF NOT EXISTS chat_agents_history_delete
			AFTER DELETE ON chat_agents
			FOR EACH ROW
			BEGIN
				INSERT INTO chat_agent_events (
					id,
					agent_id,
					event_type,
					field_name,
					old_value,
					new_value,
					old_profile_name,
					new_profile_name,
					old_display_name,
					new_display_name,
					recorded_at
				) VALUES (
					'agent_event_' || lower(hex(randomblob(16))),
					OLD.id,
					'deleted',
					NULL,
					OLD.profile_name,
					NULL,
					OLD.profile_name,
					NULL,
					OLD.display_name,
					NULL,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				);
			END;

			CREATE VIEW IF NOT EXISTS chat_agent_history AS
			SELECT
				id,
				agent_id,
				event_type,
				field_name,
				old_value,
				new_value,
				old_profile_name,
				new_profile_name,
				old_display_name,
				new_display_name,
				recorded_at
			FROM chat_agent_events;
		`);
	}
}

export function createDefaultCustomAgentStore(_cwd?: string): CustomAgentStore {
	return new CustomAgentStore(piboHomePath("chat-agents.sqlite"));
}

function agentFromRow(row: AgentRow, profileAliases: readonly string[]): CustomAgentDefinition {
	return {
		id: row.id,
		revision: row.revision,
		pluginSelection: row.plugin_selection_json ? JSON.parse(row.plugin_selection_json) : undefined,
		pluginMigration: row.plugin_migration_json ? JSON.parse(row.plugin_migration_json) : undefined,
		profileName: row.profile_name,
		displayName: row.display_name,
		profileAliases: profileAliases.filter((alias) => alias !== row.profile_name),
		folderId: row.folder_id ?? undefined,
		description: row.description ?? undefined,
		runtimeInstanceId: sanitizeRuntimeInstanceId(row.runtime_instance_id),
		runtimeOptions: parseRuntimeOptions(row.runtime_options_json),
		nativeSubagents: parseBoolean(row.native_subagents),
		nativeTools: parseStringArray(row.native_tools_json),
		skills: parseStringArray(row.skills_json),
		contextFiles: parseStringArray(row.context_files_json),
		subagents: parseSubagents(row.subagents_json),
		mcpServers: parseStringArray(row.mcp_servers_json),
		piPackages: parseStringArray(row.pi_packages_json),
		mainModel: parseModelProfile(row.main_model_json),
		mainModelFallbacks: parseModelFallbacks(row.main_model_fallbacks_json, row.main_model_json),
		subagentModel: parseModelProfile(row.subagent_model_json),
		thinkingLevel: sanitizeThinkingLevel(row.thinking_level),
		mainThinkingLevel: sanitizeThinkingLevel(row.main_thinking_level),
		subagentThinkingLevel: sanitizeThinkingLevel(row.subagent_thinking_level),
		fast: parseBoolean(row.fast),
		mainFast: parseBoolean(row.main_fast),
		subagentFast: parseBoolean(row.subagent_fast),
		builtinTools: row.builtin_tools,
		builtinToolNames: sanitizeBuiltinToolNames(parseStringArray(row.builtin_tool_names_json)),
		autoContextFiles: row.auto_context_files !== 0,
		runControl: row.run_control === 1,
		goalControl: row.goal_control !== 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		archivedAt: row.archived_at ?? undefined,
	};
}

function folderFromRow(row: AgentFolderRow): CustomAgentFolderDefinition {
	return {
		id: row.id,
		name: row.name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function normalizeCustomAgentFolderName(value: string): string {
	const name = value.replace(/\s+/g, " ").trim();
	if (!name) throw new Error("Agent folder name is required");
	if (name.length > 80) throw new Error("Agent folder name is too long");
	return name;
}

function parseStringArray(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function uniqueStrings(value: readonly string[]): string[] {
	return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function sanitizeRuntimeInstanceId(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) return DEFAULT_AGENT_RUNTIME_INSTANCE_ID;
	return value.trim();
}

function cloneRuntimeOptions(value: PiboJsonObject | undefined): PiboJsonObject {
	return structuredClone(value ?? {});
}

function parseRuntimeOptions(value: string): PiboJsonObject {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? structuredClone(parsed as PiboJsonObject)
			: {};
	} catch {
		return {};
	}
}

function sanitizeThinkingLevel(value: unknown): PiboThinkingLevel | undefined {
	return typeof value === "string" && isPiboThinkingLevel(value) ? value : undefined;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function serializeBoolean(value: boolean | undefined): 0 | 1 | null {
	if (value === undefined) return null;
	return value ? 1 : 0;
}

function parseBoolean(value: 0 | 1 | null): boolean | undefined {
	if (value === null) return undefined;
	return value === 1;
}

function sanitizeBuiltinToolNames(value: readonly string[] | undefined): string[] {
	const selected = new Set(uniqueStrings(value ?? DEFAULT_BUILTIN_TOOL_NAMES));
	return DEFAULT_BUILTIN_TOOL_NAMES.filter((name) => selected.has(name));
}

function parseSubagents(value: string): CustomAgentSubagent[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? sanitizeSubagents(parsed)
			: [];
	} catch {
		return [];
	}
}

function parseModelProfile(value: string | null): ModelProfile | undefined {
	if (!value) return undefined;
	try {
		return sanitizeModelProfile(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function sanitizeModelProfile(value: unknown): ModelProfile | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as Partial<ModelProfile>;
	if (typeof candidate.provider !== "string" || typeof candidate.id !== "string") return undefined;
	const provider = candidate.provider.trim();
	const id = candidate.id.trim();
	if (!provider || !id) return undefined;
	return { provider, id };
}

function parseModelFallbacks(value: string, primaryValue: string | null): ModelProfile[] {
	try {
		return sanitizeModelFallbacks(JSON.parse(value), parseModelProfile(primaryValue));
	} catch {
		return [];
	}
}

function sanitizeModelFallbacks(value: unknown, primary?: unknown): ModelProfile[] {
	if (!Array.isArray(value)) return [];
	const primaryModel = sanitizeModelProfile(primary);
	const seen = new Set(primaryModel ? [`${primaryModel.provider}\u0000${primaryModel.id}`] : []);
	return value.flatMap((item) => {
		const model = sanitizeModelProfile(item);
		if (!model) return [];
		const key = `${model.provider}\u0000${model.id}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [model];
	});
}

function sanitizeSubagents(value: unknown[]): CustomAgentSubagent[] {
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const candidate = item as CustomAgentSubagent;
		if (typeof candidate.name !== "string" || typeof candidate.targetProfile !== "string") return [];
		const subagent: CustomAgentSubagent = {
			name: candidate.name,
			targetProfile: candidate.targetProfile,
		};
		if (typeof candidate.description === "string") subagent.description = candidate.description;
		const model = sanitizeModelProfile(candidate.model);
		if (model) subagent.model = model;
		const modelFallbacks = sanitizeModelFallbacks(candidate.modelFallbacks, model);
		if (modelFallbacks.length > 0) subagent.modelFallbacks = modelFallbacks;
		const thinkingLevel = sanitizeThinkingLevel(candidate.thinkingLevel);
		if (thinkingLevel) subagent.thinkingLevel = thinkingLevel;
		if (candidate.runtimeOptions && typeof candidate.runtimeOptions === "object" && !Array.isArray(candidate.runtimeOptions)) {
			subagent.runtimeOptions = structuredClone(candidate.runtimeOptions as PiboJsonObject);
		}
		if (typeof candidate.timeoutMs === "number") subagent.timeoutMs = candidate.timeoutMs;
		if (typeof candidate.maxDepth === "number") subagent.maxDepth = candidate.maxDepth;
		return [subagent];
	});
}

export function isValidCustomAgentName(name: string): boolean {
	return CUSTOM_AGENT_NAME_PATTERN.test(name);
}

function agentNameCandidate(displayName: string, id: string): string {
	const candidate = displayName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
	if (isValidCustomAgentName(candidate)) return candidate;
	return `agent-${id.replace(/^agent_/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function legacyAgentNameCandidate(profileName: string, id: string): string {
	const baseName = agentNameCandidate(profileName, id);
	const hash = createHash("sha256").update(id).digest("hex").slice(0, 8);
	return `${baseName}-legacy-${hash}`;
}

function uniqueAgentName(baseName: string, used: Set<string>): string {
	let name = baseName;
	let suffix = 2;
	while (used.has(name)) {
		name = `${baseName}-${suffix}`;
		suffix += 1;
	}
	return name;
}

/** The only executable selection accepted by version-2 agent mutations. */
export const LEGACY_AGENT_SELECTION_FIELDS = ["nativeTools", "mcpServers", "piPackages", "runControl", "goalControl", "capabilityPackages"] as const;

function assertAgentSelectionInput(input: UpdateCustomAgentInput, existing?: CustomAgentDefinition): void {
	if (input.schemaVersion === 2 || input.pluginSelection !== undefined || existing?.pluginSelection) {
		for (const key of LEGACY_AGENT_SELECTION_FIELDS) if (Object.hasOwn(input, key)) {
			throw new Error(`Legacy agent field "${key}" requires explicit versioned migration`);
		}
		if (!existing && !input.pluginSelection) throw new Error("Version 2 agents require pluginSelection");
	}
	if (input.pluginSelection !== undefined) {
		const diagnostics = validateAgentPluginSelection(input.pluginSelection);
		if (diagnostics.length) throw new Error(diagnostics.map((item) => item.message).join("; "));
	}
}

function requireAgentRevision(existing: CustomAgentDefinition, expected?: number): number {
	if (expected === undefined && existing.pluginSelection) throw new PluginConflictError("expectedRevision is required for this agent");
	if (expected !== undefined && (!Number.isSafeInteger(expected) || expected !== existing.revision)) throw new PluginConflictError("Agent revision changed; reload before saving");
	return expected ?? existing.revision;
}

export function profileConsumerCollector(store: CustomAgentStore, catalog?: () => PluginCatalog): (pluginId: string) => Promise<PluginConsumer[]> {
	return async (pluginId) => store.list({ includeArchived: true }).flatMap((agent): PluginConsumer[] => {
		if (!agent.pluginSelection || isUnresolvedAgentPluginMigration(agent)) return [{ kind: "profile", id: agent.profileName, usage: "unknown" }];
		const entry = agent.pluginSelection.plugins.find((item) => item.pluginId === pluginId);
		if (!entry) return [];
		const installation = catalog?.().installations.find((item) => item.pluginId === pluginId && item.revision === entry.revision);
		const usage = !entry.enabled ? "historical" : !installation ? "unknown"
			: installation.manifest.contributions.some((item) => item.required && entry.contributions[item.id]) ? "required" : "optional";
		return [{ kind: "profile", id: agent.profileName, usage, revision: entry.revision }];
	});
}

export function isUnresolvedAgentPluginMigration(agent: Pick<CustomAgentDefinition, "pluginMigration" | "pluginSelection">): boolean {
	return agent.pluginMigration?.status === "conflict" && pluginJson(agent.pluginSelection ?? null) === pluginJson(agent.pluginMigration.selection);
}

/** Baseline inventory is supplied by the resource owner, never guessed from new defaults. */
export type LegacyAgentContribution = { kind: string; name: string; pluginId: string; config?: import("../../plugins/sdk.js").PluginJsonObject };
export type LegacyAgentMigrationSourceResource = AgentPluginMigrationResourceSnapshot & { content?: string };

type LegacyAgentMigrationSourceEnvelope = {
	schemaVersion?: number;
	row: unknown;
	aliases: unknown;
	resources?: LegacyAgentMigrationSourceResource[];
};

function legacyAgentDatabaseSnapshot(source: Uint8Array): Pick<LegacyAgentMigrationSourceEnvelope, "row" | "aliases"> {
	const parsed = JSON.parse(Buffer.from(source).toString("utf8")) as LegacyAgentMigrationSourceEnvelope;
	if (!parsed || typeof parsed !== "object" || !Object.hasOwn(parsed, "row") || !Object.hasOwn(parsed, "aliases")) throw new PluginConflictError("Legacy agent migration source is invalid");
	return { row: parsed.row, aliases: parsed.aliases };
}

function migrationResourceSnapshot(resource: LegacyAgentMigrationSourceResource): AgentPluginMigrationResourceSnapshot {
	const { content: _content, ...snapshot } = resource;
	return snapshot;
}

export async function captureLegacyAgentMigrationResources(agent: CustomAgentDefinition, options: {
	catalog: LegacyAgentCatalogInventory;
	userSkills: readonly string[];
	harnessSkills?: readonly string[];
	userContextFiles: readonly string[];
}): Promise<LegacyAgentMigrationSourceResource[]> {
	const resources: LegacyAgentMigrationSourceResource[] = [];
	const capture = async (resource: Omit<LegacyAgentMigrationSourceResource, "available" | "contentHash" | "byteSize" | "content" | "diagnostic"> & { path?: string }) => {
		if (!resource.path) {
			resources.push({ ...resource, available: false, diagnostic: "Saved resource path is unavailable" });
			return;
		}
		try {
			const content = await readFile(resource.path, "utf8");
			resources.push({ ...resource, available: true, content, contentHash: createHash("sha256").update(content).digest("hex"), byteSize: Buffer.byteLength(content, "utf8") });
		} catch (error) {
			resources.push({ ...resource, available: false, diagnostic: error instanceof Error ? error.message : String(error) });
		}
	};
	for (const [order, name] of options.userSkills.entries()) {
		const skill = options.catalog.skills.find((item) => item.name === name);
		await capture({ kind: "skill", name, origin: options.harnessSkills?.includes(name) ? "harness" : "user", reference: name, order, path: skill?.path, source: skill?.kind });
	}
	for (const [order, name] of options.userContextFiles.entries()) {
		const context = options.catalog.contextFiles.find((item) => item.key === name);
		await capture({ kind: "context-file", name, origin: "user", reference: name, order, path: context?.path, scope: context?.scope, source: context?.source });
	}
	return resources;
}

export function planLegacyAgentPluginMigration(options: {
	agent: CustomAgentDefinition;
	source: Uint8Array;
	catalog: PluginCatalog;
	runtime: PluginRuntimeTarget;
	/** Exact previously effective plugin-owned contributions, including generated Goal/Run infrastructure. */
	contributions: LegacyAgentContribution[];
	userSkills: string[];
	harnessSkills?: string[];
	userContextFiles: string[];
	resourceSnapshots?: readonly LegacyAgentMigrationSourceResource[];
	inventoryDiagnostics?: PluginDiagnostic[];
}): AgentPluginMigrationReport {
	const { agent, catalog, runtime } = options;
	const diagnostics: PluginDiagnostic[] = [...options.inventoryDiagnostics ?? []];
	const selection: AgentPluginSelection = { schemaVersion: 1, plugins: [] };
	const expected = new Set<string>();
	const note = (code: string, message: string) => diagnostics.push({ code, message, severity: "error", path: [agent.id] });
	for (const legacy of options.contributions) {
		const installation = catalog.installations.find((item) => item.pluginId === legacy.pluginId);
		const matches = installation?.manifest.contributions.filter((item) => item.scope === "agent" && item.kind === legacy.kind && item.name === legacy.name) ?? [];
		if (matches.length !== 1 || !installation) {
			note("legacy-contribution-unresolved", `No unique owner for ${legacy.pluginId}:${legacy.kind}:${legacy.name}`);
			continue;
		}
		let entry = selection.plugins.find((item) => item.pluginId === legacy.pluginId);
		if (!entry) {
			entry = { pluginId: installation.pluginId, revision: installation.revision, enabled: true, config: {},
				contributions: Object.fromEntries(installation.manifest.contributions.filter((item) => item.scope === "agent").map((item) => [item.id, false])) };
			selection.plugins.push(entry);
		}
		entry.contributions[matches[0].id] = true;
		if (legacy.config) (entry.contributionConfig ??= {})[matches[0].id] = structuredClone(legacy.config);
		expected.add(`${legacy.pluginId}/${matches[0].id}`);
	}
	const resources = [
		...options.userSkills.map((name, order): import("../../plugins/sdk.js").IndependentPluginResource => ({ id: `legacy-user-skill:${name}`, kind: "skill", name, origin: options.harnessSkills?.includes(name) ? "harness" : "user", reference: name, order, context: { kind: "context", stage: "skills", description: "Independent skill reference preserved from the legacy agent", loading: "progressive" } })),
		...options.userContextFiles.map((name, order): import("../../plugins/sdk.js").IndependentPluginResource => ({ id: `legacy-user-context:${name}`, kind: "context-file", name, origin: "user", reference: name, order, context: { kind: "context", stage: "context", description: "Independent user context preserved from the legacy agent", loading: "eager" } })),
	];
	const plan = resolvePluginContributions({ catalog, runtime, selection, selectionRevision: agent.revision, kind: "preview", resources });
	diagnostics.push(...plan.diagnostics);
	const before = [...expected].sort();
	const after = plan.contributions.filter((item) => item.contribution.scope === "agent").map((item) => item.id).sort();
	const beforeTools = [...new Set(options.contributions.filter((item) => item.kind === "tool").map((item) => item.name))].sort();
	const afterTools = [...new Set(plan.contributions.filter((item) => item.contribution.scope === "agent" && item.contribution.kind === "tool").map((item) => item.contribution.name!))].sort();
	if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(beforeTools) !== JSON.stringify(afterTools)) note("legacy-contribution-set-changed", "Migration must preserve the exact effective contribution and tool sets");
	// Unresolved dependencies remain desired but all executable entries are inactive until explicitly reconciled.
	const conflict = diagnostics.some((item) => item.severity === "error");
	if (conflict) for (const entry of selection.plugins) entry.enabled = false;
	return { schemaVersion: 1, status: conflict ? "conflict" : "ready", sourceHash: createHash("sha256").update(options.source).digest("hex"),
		selection, before, after: conflict ? [] : after, beforeTools, afterTools: conflict ? [] : afterTools, mcpServers: [...agent.mcpServers],
		userSkills: [...options.userSkills], userContextFiles: [...options.userContextFiles], resourceSnapshots: (options.resourceSnapshots ?? []).map(migrationResourceSnapshot), inactivePiPackages: [...agent.piPackages], diagnostics };
}

/** Resume with the SAME source export and preview after a crash; journal verifies the backup bytes. */
export async function migrateLegacyAgentPlugins(options: {
	agents: CustomAgentStore; plugins: PluginStore; agentId: string; source: Uint8Array;
	report: AgentPluginMigrationReport; backupRoot: string; dryRun?: boolean;
	afterStageWrite?: (stageId: string) => void | Promise<void>;
}) {
	const { agents, agentId, report, source } = options;
	if (createHash("sha256").update(source).digest("hex") !== report.sourceHash) throw new PluginConflictError("Migration report belongs to different source bytes");
	const reportHash = createHash("sha256").update(pluginJson(report)).digest("hex");
	return new PluginMigrationJournal(options.plugins).run({
		id: `agent-plugins-v2:${agentId}:${report.sourceHash}:${reportHash}`, backup: source, backupRoot: options.backupRoot, dryRun: options.dryRun,
		afterStageWrite: options.afterStageWrite,
		stages: [{ id: `agent:${agentId}:${report.status}`, isApplied: () => {
			const current = agents.get(agentId);
			return pluginJson(current?.pluginMigration ?? null) === pluginJson(report)
				&& pluginJson(current?.pluginSelection ?? null) === pluginJson(report.selection);
		}, apply: () => agents.applyPluginMigration(agentId, report, source) }],
	});
}

export type LegacyAgentCatalogInventory = {
	nativeTools: { name: string; pluginId?: string; yieldable?: boolean; portable?: boolean }[];
	skills: { name: string; kind: string; pluginId?: string; path?: string }[];
	contextFiles: { key: string; pluginId?: string; path?: string; scope?: string; source?: string }[];
};
/** Read-only baseline projection, used only by the migration. No factories or plugin setup run. */
export function inventoryLegacyAgentSelection(agent: CustomAgentDefinition, options: {
	catalog: LegacyAgentCatalogInventory; runtime: PluginRuntimeTarget;
	/** Current installed manifests are the authoritative owner map for product migrations. */
	pluginCatalog?: PluginCatalog;
	/** Fixture-only compatibility for preserved historical migration tests. */
	owners?: Record<string, string>;
}) {
	const contributions: LegacyAgentContribution[] = [];
	const diagnostics: PluginDiagnostic[] = [];
	const userSkills: string[] = [];
	const harnessSkills: string[] = [];
	const userContextFiles: string[] = [];
	const candidatesFor = (kind: string, name: string) => [...new Set((options.pluginCatalog?.installations ?? []).flatMap((installation) => installation.manifest.contributions
		.filter((contribution) => contribution.scope === "agent" && contribution.kind === kind && contribution.name === name)
		.map(() => installation.pluginId)))];
	const preserveIndependent = (kind: "skill" | "context-file", name: string, target: string[]) => {
		target.push(name);
		const candidates = candidatesFor(kind, name);
		if (candidates.length > 0) diagnostics.push({ code: "resource-name-conflict", severity: "error", path: [agent.id, kind, name, ...candidates], message: `Independent user ${kind} ${name} conflicts with installed plugin ownership (${candidates.join(", ")}); origin is preserved and migration is blocked` });
	};
	const add = (kind: string, name: string, previousOwner?: string) => {
		const candidates = candidatesFor(kind, name);
		const pluginId = candidates.length === 1 ? candidates[0] : options.owners?.[`${kind}:${name}`] ?? (candidates.length === 0 && previousOwner !== "pibo.core" ? previousOwner : undefined);
		if (!pluginId || candidates.length > 1) diagnostics.push({ code: candidates.length > 1 ? "legacy-owner-ambiguous" : "legacy-owner-unknown", severity: "error", path: [agent.id, kind, name], message: candidates.length > 1 ? `Legacy ${kind} ${name} has multiple installed plugin owners` : `Legacy ${kind} ${name} has no verified plugin owner` });
		else if (!contributions.some((item) => item.kind === kind && item.name === name && item.pluginId === pluginId)) contributions.push({ kind, name, pluginId });
	};
	const selectedTools = agent.nativeTools.map((name) => options.catalog.nativeTools.find((tool) => tool.name === name));
	for (const name of agent.nativeTools) {
		const tool = options.catalog.nativeTools.find((item) => item.name === name);
		if (!tool) diagnostics.push({ code: "legacy-tool-unknown", severity: "error", path: [agent.id, name], message: `Unknown legacy tool ${name}; retained inactive` });
		else add("tool", name, tool.pluginId);
	}
	for (const name of agent.skills) {
		const skill = options.catalog.skills.find((item) => item.name === name);
		if (skill?.kind === "user") preserveIndependent("skill", name, userSkills);
		else if (skill?.kind === "builtin" && candidatesFor("skill", name).length === 0) {
			// Host/harness skills already have an independent runtime delivery path.
			userSkills.push(name);
			harnessSkills.push(name);
		} else if (!skill && candidatesFor("skill", name).length === 0) {
			// Retain the saved external reference without inventing a plugin owner or loading code.
			userSkills.push(name);
			diagnostics.push({ code: "legacy-resource-unavailable", severity: "warning", path: [agent.id, "skill", name], message: `Saved skill ${name} is currently unavailable; its reference is retained without enabling a replacement` });
		} else add("skill", name, skill?.pluginId);
	}
	for (const name of agent.contextFiles) {
		const context = options.catalog.contextFiles.find((item) => item.key === name);
		if (context && !context.pluginId) preserveIndependent("context-file", name, userContextFiles);
		else add("context-file", name, context?.pluginId);
	}
	if (agent.mcpServers.length > 0) {
		add("mcp-adapter", "mcp-cli");
		const adapter = contributions.find((item) => item.kind === "mcp-adapter" && item.name === "mcp-cli");
		if (adapter) adapter.config = { selectedServers: [...agent.mcpServers] };
	}
	if (agent.goalControl !== false) for (const name of PIBO_GOAL_TOOL_NAMES) add("tool", name);
	// send_message is yielded-only; the other three tools remain direct. Do not enable general Run targets.
	const manualSubagents = agent.subagents.length > 0;
	if (manualSubagents) for (const name of PIBO_AGENT_TOOL_NAMES) add("tool", name);
	// Baseline Pi wraps only bash (not read/edit/write) when full Run Control is enabled.
	const piNativeYielding = options.runtime.adapterId === "pi" && agent.runControl;
	if (piNativeYielding && (agent.builtinTools === "disabled" || !agent.builtinToolNames.includes("bash"))) diagnostics.push({
		code: "legacy-implicit-bash-override", severity: "error", path: [agent.id, "builtinToolNames"],
		message: "Legacy Run Control implicitly exposed bash despite disabled Pi built-ins; explicit harness selection reconciliation is required",
	});
	const hasYieldable = piNativeYielding || selectedTools.some((tool) => tool && tool.yieldable !== false);
	if (manualSubagents || (agent.runControl && hasYieldable)) for (const name of PIBO_RUN_TOOL_NAMES) add("tool", name);
	const runTargetNames = manualSubagents && !agent.runControl ? ["pibo_agents_send_message"] : agent.runControl ? [
		...selectedTools.filter((tool) => tool && tool.yieldable !== false).map((tool) => tool!.name),
		...(manualSubagents ? [...PIBO_AGENT_TOOL_NAMES] : []), ...(piNativeYielding ? ["bash"] : []),
	] : [];
	const start = contributions.find((item) => item.kind === "tool" && item.name === "pibo_run_start");
	if (start) start.config = { allowedToolNames: runTargetNames };
	return { contributions, userSkills, harnessSkills, userContextFiles, inventoryDiagnostics: diagnostics,
		harnessTools: options.runtime.adapterId === "pi" && agent.builtinTools !== "disabled" ? [...agent.builtinToolNames] : [],
		yieldedOnlyTools: manualSubagents ? ["pibo_agents_send_message"] : [],
		/** Migrator/runtime must preserve this filter, not broaden manual infrastructure to all tools. */
		runTargetNames,
	};
}

export type AutomaticAgentPluginMigrationResult = {
	agentId: string;
	profileName: string;
	status: "migrated" | "blocked" | "unchanged";
	report?: AgentPluginMigrationReport;
};

/** Pibo 4.0 admission boundary: migrate every stored legacy profile before the router may start a new generation. */
export async function migrateLegacyAgentsAtStartup(options: {
	agents: CustomAgentStore;
	plugins: PluginStore;
	catalog: PluginCatalog;
	legacyCatalog: LegacyAgentCatalogInventory;
	backupRoot: string;
	resolveRuntime: (instanceId: string) => PluginRuntimeTarget | Promise<PluginRuntimeTarget>;
}): Promise<AutomaticAgentPluginMigrationResult[]> {
	const results: AutomaticAgentPluginMigrationResult[] = [];
	for (const initial of options.agents.list({ includeArchived: true })) {
		if (initial.pluginSelection) {
			results.push({ agentId: initial.id, profileName: initial.profileName, status: "unchanged", report: initial.pluginMigration });
			continue;
		}
		const runtime = await options.resolveRuntime(initial.runtimeInstanceId);
		const inventory = inventoryLegacyAgentSelection(initial, { catalog: options.legacyCatalog, pluginCatalog: options.catalog, runtime });
		const resourceSnapshots = await captureLegacyAgentMigrationResources(initial, { catalog: options.legacyCatalog, ...inventory });
		const source = options.agents.exportLegacyAgent(initial.id, resourceSnapshots);
		const report = planLegacyAgentPluginMigration({ agent: initial, source, catalog: options.catalog, runtime, ...inventory, resourceSnapshots });
		await migrateLegacyAgentPlugins({ agents: options.agents, plugins: options.plugins, agentId: initial.id, source, report, backupRoot: options.backupRoot });
		results.push({ agentId: initial.id, profileName: initial.profileName, status: report.status === "ready" ? "migrated" : "blocked", report });
	}
	return results;
}
