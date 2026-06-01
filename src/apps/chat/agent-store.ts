import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../../core/pibo-home.js";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_BUILTIN_TOOL_NAMES, type BuiltinToolsMode, type ModelProfile } from "../../core/profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import { findPiPackage } from "../../pi-packages/store.js";

export type CustomAgentSubagent = {
	name: string;
	description?: string;
	targetProfile: string;
	timeoutMs?: number;
	maxDepth?: number;
};

export type CustomAgentDefinition = {
	id: string;
	profileName: string;
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgentSubagent[];
	mcpServers: string[];
	piPackages: string[];
	mainModel?: ModelProfile;
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
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
};

const CUSTOM_AGENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type CreateCustomAgentInput = {
	displayName: string;
	description?: string;
	nativeTools?: string[];
	skills?: string[];
	contextFiles?: string[];
	subagents?: CustomAgentSubagent[];
	mcpServers?: string[];
	piPackages?: string[];
	mainModel?: ModelProfile;
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
};

export type UpdateCustomAgentInput = Partial<CreateCustomAgentInput>;

type AgentRow = {
	id: string;
	profile_name: string;
	display_name: string;
	description: string | null;
	native_tools_json: string;
	skills_json: string;
	context_files_json: string;
	subagents_json: string;
	mcp_servers_json: string;
	pi_packages_json: string;
	main_model_json: string | null;
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
	created_at: string;
	updated_at: string;
	archived_at: string | null;
};

export class CustomAgentStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });
		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_agents (
				id TEXT PRIMARY KEY,
				profile_name TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				description TEXT,
				native_tools_json TEXT NOT NULL,
				skills_json TEXT NOT NULL,
				context_files_json TEXT NOT NULL,
				subagents_json TEXT NOT NULL,
				mcp_servers_json TEXT NOT NULL DEFAULT '[]',
				pi_packages_json TEXT NOT NULL DEFAULT '[]',
				main_model_json TEXT,
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
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				archived_at TEXT
			);

		`);
		this.migrateArchivedAtColumn();
		this.migrateAutoContextFilesColumn();
		this.migrateMcpServersColumn();
		this.migratePiPackagesColumn();
		this.migrateModelColumns();
		this.migrateThinkingLevelColumn();
		this.migrateThinkingOptionColumns();
		this.migrateBuiltinToolNamesColumn();
		this.migrateLegacyProfileNames();
		this.migrateDuplicateProfileNames();
		this.migrateOwnerScopeColumn();
	}

	list(options: { includeArchived?: boolean } = {}): CustomAgentDefinition[] {
		this.migrateLegacyProfileNames();
		this.migrateDuplicateProfileNames();
		const archivedClause = options.includeArchived ? "" : " AND archived_at IS NULL";
		const rows = this.db.prepare(`SELECT * FROM chat_agents WHERE 1 = 1${archivedClause} ORDER BY updated_at DESC`).all();
		return (rows as AgentRow[]).map(agentFromRow);
	}

	get(id: string): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const row = this.db.prepare("SELECT * FROM chat_agents WHERE id = ?").get(id) as AgentRow | undefined;
		return row ? agentFromRow(row) : undefined;
	}

	create(input: CreateCustomAgentInput): CustomAgentDefinition {
		this.migrateLegacyProfileNames();
		const now = new Date().toISOString();
		const id = `agent_${randomUUID()}`;
		const profileName = input.displayName;
		this.requireProfileNameAvailable(profileName);
		const agent: CustomAgentDefinition = {
			id,
			profileName,
			displayName: input.displayName,
			description: input.description,
			nativeTools: [...(input.nativeTools ?? [])],
			skills: [...(input.skills ?? [])],
			contextFiles: [...(input.contextFiles ?? [])],
			subagents: sanitizeSubagents(input.subagents ?? []),
			mcpServers: uniqueStrings(input.mcpServers ?? []),
			piPackages: sanitizePiPackages(input.piPackages ?? []),
			mainModel: sanitizeModelProfile(input.mainModel),
			subagentModel: sanitizeModelProfile(input.subagentModel),
			thinkingLevel: sanitizeThinkingLevel(input.thinkingLevel),
			mainThinkingLevel: sanitizeThinkingLevel(input.mainThinkingLevel),
			subagentThinkingLevel: sanitizeThinkingLevel(input.subagentThinkingLevel),
			fast: sanitizeBoolean(input.fast),
			mainFast: sanitizeBoolean(input.mainFast),
			subagentFast: sanitizeBoolean(input.subagentFast),
			builtinTools: input.builtinTools ?? "default",
			builtinToolNames: sanitizeBuiltinToolNames(input.builtinToolNames),
			autoContextFiles: input.autoContextFiles ?? true,
			runControl: input.runControl ?? false,
			createdAt: now,
			updatedAt: now,
		};
		this.insert(agent);
		const created = this.get(id);
		if (!created) throw new Error(`Failed to create custom agent "${id}"`);
		return created;
	}

	update(id: string, input: UpdateCustomAgentInput): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const existing = this.get(id);
		if (!existing) return undefined;
		const profileName = input.displayName ?? existing.displayName;
		this.requireProfileNameAvailable(profileName, id);
		const updated: CustomAgentDefinition = {
			...existing,
			profileName,
			displayName: input.displayName ?? existing.displayName,
			description: input.description === undefined ? existing.description : input.description,
			nativeTools: input.nativeTools ? [...input.nativeTools] : existing.nativeTools,
			skills: input.skills ? [...input.skills] : existing.skills,
			contextFiles: input.contextFiles ? [...input.contextFiles] : existing.contextFiles,
			subagents: input.subagents ? sanitizeSubagents(input.subagents) : existing.subagents,
			mcpServers: input.mcpServers ? uniqueStrings(input.mcpServers) : existing.mcpServers,
			piPackages: input.piPackages ? sanitizePiPackages(input.piPackages) : existing.piPackages,
			mainModel: input.mainModel === undefined ? existing.mainModel : sanitizeModelProfile(input.mainModel),
			subagentModel: input.subagentModel === undefined ? existing.subagentModel : sanitizeModelProfile(input.subagentModel),
			thinkingLevel: input.thinkingLevel === undefined ? existing.thinkingLevel : sanitizeThinkingLevel(input.thinkingLevel),
			mainThinkingLevel: input.mainThinkingLevel === undefined ? existing.mainThinkingLevel : sanitizeThinkingLevel(input.mainThinkingLevel),
			subagentThinkingLevel: input.subagentThinkingLevel === undefined ? existing.subagentThinkingLevel : sanitizeThinkingLevel(input.subagentThinkingLevel),
			fast: input.fast === undefined ? existing.fast : sanitizeBoolean(input.fast),
			mainFast: input.mainFast === undefined ? existing.mainFast : sanitizeBoolean(input.mainFast),
			subagentFast: input.subagentFast === undefined ? existing.subagentFast : sanitizeBoolean(input.subagentFast),
			builtinTools: input.builtinTools ?? existing.builtinTools,
			builtinToolNames: input.builtinToolNames ? sanitizeBuiltinToolNames(input.builtinToolNames) : existing.builtinToolNames,
			autoContextFiles: input.autoContextFiles ?? existing.autoContextFiles,
			runControl: input.runControl ?? existing.runControl,
			updatedAt: new Date().toISOString(),
		};
		this.db
			.prepare(`
				UPDATE chat_agents SET
					profile_name = ?,
					display_name = ?,
					description = ?,
					native_tools_json = ?,
					skills_json = ?,
					context_files_json = ?,
					subagents_json = ?,
					mcp_servers_json = ?,
					pi_packages_json = ?,
					main_model_json = ?,
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
					updated_at = ?
				WHERE id = ?
			`)
			.run(
				updated.profileName,
				updated.displayName,
				updated.description ?? null,
				JSON.stringify(updated.nativeTools),
				JSON.stringify(updated.skills),
				JSON.stringify(updated.contextFiles),
				JSON.stringify(sanitizeSubagents(updated.subagents)),
				JSON.stringify(updated.mcpServers),
				JSON.stringify(updated.piPackages),
				updated.mainModel ? JSON.stringify(updated.mainModel) : null,
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
				updated.updatedAt,
				id,
			);
		return this.get(id);
	}

	setArchived(id: string, archived: boolean): CustomAgentDefinition | undefined {
		this.migrateLegacyProfileNames();
		const existing = this.get(id);
		if (!existing) return undefined;
		const archivedAt = archived ? existing.archivedAt ?? new Date().toISOString() : null;
		this.db
			.prepare("UPDATE chat_agents SET archived_at = ?, updated_at = ? WHERE id = ?")
			.run(archivedAt, new Date().toISOString(), id);
		return this.get(id);
	}

	delete(id: string): boolean {
		const result = this.db.prepare("DELETE FROM chat_agents WHERE id = ?").run(id);
		return Number(result.changes ?? 0) > 0;
	}

	close(): void {
		this.db.close();
	}

	private insert(agent: CustomAgentDefinition): void {
		this.db
			.prepare(`
				INSERT INTO chat_agents (
					id,
					profile_name,
					display_name,
					description,
					native_tools_json,
					skills_json,
					context_files_json,
					subagents_json,
					mcp_servers_json,
					pi_packages_json,
					main_model_json,
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
					created_at,
					updated_at,
					archived_at
				) VALUES (${Array.from({ length: 25 }, () => "?").join(", ")})
			`)
			.run(
				agent.id,
				agent.profileName,
				agent.displayName,
				agent.description ?? null,
				JSON.stringify(agent.nativeTools),
				JSON.stringify(agent.skills),
				JSON.stringify(agent.contextFiles),
				JSON.stringify(sanitizeSubagents(agent.subagents)),
				JSON.stringify(agent.mcpServers),
				JSON.stringify(agent.piPackages),
				agent.mainModel ? JSON.stringify(agent.mainModel) : null,
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
				agent.createdAt,
				agent.updatedAt,
				agent.archivedAt ?? null,
			);
	}

	private requireProfileNameAvailable(profileName: string, currentId?: string): void {
		const row = this.db.prepare("SELECT id FROM chat_agents WHERE profile_name = ?").get(profileName) as { id: string } | undefined;
		if (row && row.id !== currentId) throw new Error(`Agent name "${profileName}" already exists`);
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
	}

	private migrateOwnerScopeColumn(): void {
		const columns = this.tableColumns();
		if (!columns.has("owner_scope")) return;
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.exec(`
				CREATE TABLE chat_agents_ownerless (
					id TEXT PRIMARY KEY,
					profile_name TEXT NOT NULL UNIQUE,
					display_name TEXT NOT NULL,
					description TEXT,
					native_tools_json TEXT NOT NULL,
					skills_json TEXT NOT NULL,
					context_files_json TEXT NOT NULL,
					subagents_json TEXT NOT NULL,
					mcp_servers_json TEXT NOT NULL DEFAULT '[]',
					pi_packages_json TEXT NOT NULL DEFAULT '[]',
					main_model_json TEXT,
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
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					archived_at TEXT
				);
				INSERT INTO chat_agents_ownerless (
					id, profile_name, display_name, description, native_tools_json, skills_json, context_files_json,
					subagents_json, mcp_servers_json, pi_packages_json, main_model_json, subagent_model_json,
					thinking_level, main_thinking_level, subagent_thinking_level, fast, main_fast, subagent_fast,
					builtin_tools, builtin_tool_names_json, auto_context_files, run_control, created_at, updated_at, archived_at
				)
				SELECT
					id, profile_name, display_name, description, native_tools_json, skills_json, context_files_json,
					subagents_json, mcp_servers_json, pi_packages_json, main_model_json, subagent_model_json,
					thinking_level, main_thinking_level, subagent_thinking_level, fast, main_fast, subagent_fast,
					builtin_tools, builtin_tool_names_json, auto_context_files, run_control, created_at, updated_at, archived_at
				FROM chat_agents;
				DROP TABLE chat_agents;
				ALTER TABLE chat_agents_ownerless RENAME TO chat_agents;
			`);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
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
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("auto_context_files")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN auto_context_files INTEGER NOT NULL DEFAULT 1").run();
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
}

export function createDefaultCustomAgentStore(_cwd?: string): CustomAgentStore {
	return new CustomAgentStore(piboHomePath("chat-agents.sqlite"));
}

function agentFromRow(row: AgentRow): CustomAgentDefinition {
	return {
		id: row.id,
		profileName: row.profile_name,
		displayName: row.display_name,
		description: row.description ?? undefined,
		nativeTools: parseStringArray(row.native_tools_json),
		skills: parseStringArray(row.skills_json),
		contextFiles: parseStringArray(row.context_files_json),
		subagents: parseSubagents(row.subagents_json),
		mcpServers: parseStringArray(row.mcp_servers_json),
		piPackages: parseStringArray(row.pi_packages_json),
		mainModel: parseModelProfile(row.main_model_json),
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
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		archivedAt: row.archived_at ?? undefined,
	};
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

function sanitizePiPackages(value: readonly string[]): string[] {
	const packages = uniqueStrings(value);
	for (const pkg of packages) {
		if (!findPiPackage(pkg)) throw new Error(`Unknown Pi package "${pkg}"`);
	}
	return packages;
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

function sanitizeModelProfile(value: ModelProfile | undefined): ModelProfile | undefined {
	if (!value) return undefined;
	if (typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
	const provider = value.provider.trim();
	const id = value.id.trim();
	if (!provider || !id) return undefined;
	return { provider, id };
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
