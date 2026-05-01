import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BuiltinToolsMode, PiboSubagentExecutionMode } from "../../core/profiles.js";

export type CustomAgentSubagent = {
	name: string;
	description?: string;
	targetProfile: string;
	executionMode?: PiboSubagentExecutionMode;
	timeoutMs?: number;
	maxDepth?: number;
};

export type CustomAgentDefinition = {
	id: string;
	profileName: string;
	ownerScope: string;
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgentSubagent[];
	builtinTools: BuiltinToolsMode;
	runControl: boolean;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
};

const CUSTOM_AGENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type CreateCustomAgentInput = {
	ownerScope: string;
	displayName: string;
	description?: string;
	nativeTools?: string[];
	skills?: string[];
	contextFiles?: string[];
	subagents?: CustomAgentSubagent[];
	builtinTools?: BuiltinToolsMode;
	runControl?: boolean;
};

export type UpdateCustomAgentInput = Partial<Omit<CreateCustomAgentInput, "ownerScope">>;

type AgentRow = {
	id: string;
	profile_name: string;
	owner_scope: string;
	display_name: string;
	description: string | null;
	native_tools_json: string;
	skills_json: string;
	context_files_json: string;
	subagents_json: string;
	builtin_tools: BuiltinToolsMode;
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
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chat_agents (
				id TEXT PRIMARY KEY,
				profile_name TEXT NOT NULL UNIQUE,
				owner_scope TEXT NOT NULL,
				display_name TEXT NOT NULL,
				description TEXT,
				native_tools_json TEXT NOT NULL,
				skills_json TEXT NOT NULL,
				context_files_json TEXT NOT NULL,
				subagents_json TEXT NOT NULL,
				builtin_tools TEXT NOT NULL,
				run_control INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				archived_at TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_chat_agents_owner
				ON chat_agents(owner_scope, updated_at);
		`);
		this.migrateArchivedAtColumn();
		this.migrateLegacyProfileNames();
	}

	list(ownerScope?: string, options: { includeArchived?: boolean } = {}): CustomAgentDefinition[] {
		this.migrateLegacyProfileNames();
		const archivedClause = options.includeArchived ? "" : " AND archived_at IS NULL";
		const rows = ownerScope
			? this.db.prepare(`SELECT * FROM chat_agents WHERE owner_scope = ?${archivedClause} ORDER BY updated_at DESC`).all(ownerScope)
			: this.db.prepare(`SELECT * FROM chat_agents WHERE 1 = 1${archivedClause} ORDER BY updated_at DESC`).all();
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
			ownerScope: input.ownerScope,
			displayName: input.displayName,
			description: input.description,
			nativeTools: [...(input.nativeTools ?? [])],
			skills: [...(input.skills ?? [])],
			contextFiles: [...(input.contextFiles ?? [])],
			subagents: [...(input.subagents ?? [])],
			builtinTools: input.builtinTools ?? "default",
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
			subagents: input.subagents ? [...input.subagents] : existing.subagents,
			builtinTools: input.builtinTools ?? existing.builtinTools,
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
					builtin_tools = ?,
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
				JSON.stringify(updated.subagents),
				updated.builtinTools,
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
					owner_scope,
					display_name,
					description,
					native_tools_json,
					skills_json,
					context_files_json,
				subagents_json,
				builtin_tools,
				run_control,
				created_at,
				updated_at,
				archived_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				agent.id,
				agent.profileName,
				agent.ownerScope,
				agent.displayName,
				agent.description ?? null,
				JSON.stringify(agent.nativeTools),
				JSON.stringify(agent.skills),
				JSON.stringify(agent.contextFiles),
				JSON.stringify(agent.subagents),
				agent.builtinTools,
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

	private migrateArchivedAtColumn(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(chat_agents)").all() as Array<{ name: string }>).map((column) => column.name),
		);
		if (!columns.has("archived_at")) {
			this.db.prepare("ALTER TABLE chat_agents ADD COLUMN archived_at TEXT").run();
		}
	}
}

export function createDefaultCustomAgentStore(cwd = process.cwd()): CustomAgentStore {
	return new CustomAgentStore(resolve(cwd, ".pibo/chat-agents.sqlite"));
}

function agentFromRow(row: AgentRow): CustomAgentDefinition {
	return {
		id: row.id,
		profileName: row.profile_name,
		ownerScope: row.owner_scope,
		displayName: row.display_name,
		description: row.description ?? undefined,
		nativeTools: parseStringArray(row.native_tools_json),
		skills: parseStringArray(row.skills_json),
		contextFiles: parseStringArray(row.context_files_json),
		subagents: parseSubagents(row.subagents_json),
		builtinTools: row.builtin_tools,
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

function parseSubagents(value: string): CustomAgentSubagent[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is CustomAgentSubagent => {
					if (!item || typeof item !== "object") return false;
					const candidate = item as CustomAgentSubagent;
					return typeof candidate.name === "string" && typeof candidate.targetProfile === "string";
				})
			: [];
	} catch {
		return [];
	}
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

function uniqueAgentName(baseName: string, used: Set<string>): string {
	let name = baseName;
	let suffix = 2;
	while (used.has(name)) {
		name = `${baseName}-${suffix}`;
		suffix += 1;
	}
	return name;
}
