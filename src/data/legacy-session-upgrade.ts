import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PluginMigrationJournal, type PluginMigrationStage } from "../plugins/migration-journal.js";
import { PluginConflictError, pluginErrorMessage, pluginJson } from "../plugins/store.js";
import { PiboDataStore } from "./pibo-store.js";

type LegacySessionRow = {
	id: string;
	pi_session_id: string | null;
	channel: string;
	kind: string;
	profile: string;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	metadata_json: string | null;
	active_model_json: string | null;
	created_at: string;
	updated_at: string;
};

type LegacyBindingRow = {
	pibo_session_id: string;
	runtime_instance_id: string;
	runtime_adapter_id: string;
	native_session_id: string | null;
	binding_state: string;
	protocol: string | null;
	protocol_version?: string | null;
	adapter_version?: string | null;
	locator_json?: string | null;
	metadata_json?: string | null;
	revision?: number;
	created_at: string;
	updated_at: string;
};

type TargetSessionRow = {
	id: string;
	pi_session_id: string | null;
	room_id: string | null;
	root_session_id: string;
	parent_id: string | null;
	origin_id: string | null;
	channel: string;
	kind: string;
	profile: string;
	active_model_json: string | null;
	workspace: string | null;
	title: string;
	status: string;
	metadata_json: string;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
};

type TargetBindingRow = {
	pibo_session_id: string;
	runtime_instance_id: string;
	runtime_adapter_id: string;
	native_session_id: string | null;
	binding_state: string;
	protocol: string | null;
	protocol_version: string | null;
	adapter_version: string | null;
	locator_json: string | null;
	metadata_json: string;
	revision: number;
	created_at: string;
	updated_at: string;
};

export type LegacySessionUpgradeResult = {
	sourcePath: string;
	targetPath: string;
	inputExists: boolean;
	read: number;
	migrated: number;
	alreadyApplied: number;
	blocked: Array<{ piboSessionId: string; diagnostic: string; repair: string }>;
};

export async function migrateLegacySessionDatabaseAtStartup(options: {
	sourcePath: string;
	targetPath: string;
	backupRoot?: string;
	afterStageWrite?: (stageId: string) => void | Promise<void>;
}): Promise<LegacySessionUpgradeResult> {
	const sourcePath = resolve(options.sourcePath);
	const targetPath = resolve(options.targetPath);
	const result: LegacySessionUpgradeResult = { sourcePath, targetPath, inputExists: existsSync(sourcePath), read: 0, migrated: 0, alreadyApplied: 0, blocked: [] };
	if (!result.inputExists || sourcePath === targetPath) return result;

	const source = new DatabaseSync(sourcePath, { readOnly: true });
	let sessions: LegacySessionRow[];
	let bindings: LegacyBindingRow[];
	try {
		if (!hasTable(source, "pibo_sessions")) {
			throw new Error(`Automatic Pibo 4.0 session migration cannot read "${sourcePath}": required table "pibo_sessions" is missing. Preserve the file and inspect it with "pibo data inventory --root ${dirname(sourcePath)}" before retrying.`);
		}
		sessions = source.prepare("SELECT * FROM pibo_sessions ORDER BY created_at ASC, id ASC").all() as LegacySessionRow[];
		bindings = hasTable(source, "pibo_session_runtime_bindings")
			? source.prepare("SELECT * FROM pibo_session_runtime_bindings ORDER BY pibo_session_id ASC").all() as LegacyBindingRow[]
			: [];
	} finally {
		source.close();
	}
	result.read = sessions.length;
	const sessionIds = new Set(sessions.map((session) => session.id));
	for (const binding of bindings) {
		if (sessionIds.has(binding.pibo_session_id)) continue;
		result.blocked.push({
			piboSessionId: binding.pibo_session_id,
			diagnostic: `Legacy runtime binding ${binding.pibo_session_id} has no source Session row`,
			repair: `The orphan binding remains in "${sourcePath}" and in the private logical backup. Restore or identify its Session row before retrying; do not attach it to another Session by inference.`,
		});
	}
	const bindingBySession = new Map(bindings.map((binding) => [binding.pibo_session_id, binding]));
	const logicalBackup = new TextEncoder().encode(pluginJson({ schemaVersion: 1, sourcePath, sessions, bindings }));
	const sourceIdentity = createHash("sha256").update(sourcePath).digest("hex").slice(0, 16);
	const data = new PiboDataStore(targetPath);
	try {
		const journal = new PluginMigrationJournal(data.plugins);
		for (const session of orderParentsBeforeChildren(sessions)) {
			const expectedSession = targetSession(session);
			const expectedBinding = targetBinding(session, bindingBySession.get(session.id));
			const stage: PluginMigrationStage = {
				id: `legacy-session:${session.id}:${createHash("sha256").update(pluginJson({ expectedSession, expectedBinding })).digest("hex")}`,
				isApplied: () => sessionMatches(data, expectedSession) && bindingMatches(data, expectedBinding),
				apply: () => applySession(data, expectedSession, expectedBinding),
			};
			const wasApplied = await stage.isApplied();
			try {
				await runJournalWithCasRetry(journal, {
					id: `pibo4-session-upgrade:${sourceIdentity}:${session.id}`,
					backup: logicalBackup,
					backupRoot: options.backupRoot ?? join(dirname(targetPath), "plugins", "migration-backups", "pibo-4", "sessions"),
					stages: [stage],
					afterStageWrite: options.afterStageWrite,
				});
				if (wasApplied) result.alreadyApplied += 1;
				else result.migrated += 1;
			} catch (error) {
				result.blocked.push({
					piboSessionId: session.id,
					diagnostic: pluginErrorMessage(error, "Legacy session migration failed"),
					repair: `The source remains at "${sourcePath}" and its private logical backup is retained. Reconcile the existing target session/binding for ${session.id}; then restart Pibo. Do not delete or replace either database.`,
				});
			}
		}
	} finally {
		data.close();
	}
	return result;
}

async function runJournalWithCasRetry(journal: PluginMigrationJournal, input: Parameters<PluginMigrationJournal["run"]>[0]) {
	for (let attempt = 0; ; attempt += 1) {
		try { return await journal.run(input); }
		catch (error) {
			if (!(error instanceof PluginConflictError) || attempt >= 2) throw error;
		}
	}
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function targetSession(row: LegacySessionRow): TargetSessionRow {
	const metadata = parseObject(row.metadata_json);
	const roomId = typeof metadata.chatRoomId === "string" ? metadata.chatRoomId : null;
	const rootSessionId = row.parent_id ? (typeof metadata.rootSessionId === "string" ? metadata.rootSessionId : row.parent_id) : row.id;
	return {
		id: row.id,
		pi_session_id: row.pi_session_id,
		room_id: roomId,
		root_session_id: rootSessionId,
		parent_id: row.parent_id,
		origin_id: row.origin_id,
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		active_model_json: row.active_model_json ?? null,
		workspace: row.workspace,
		title: row.title ?? "Untitled Session",
		status: "idle",
		metadata_json: JSON.stringify(metadata),
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_activity_at: row.updated_at,
	};
}

function targetBinding(session: LegacySessionRow, binding: LegacyBindingRow | undefined): TargetBindingRow {
	if (binding) return {
		pibo_session_id: binding.pibo_session_id,
		runtime_instance_id: binding.runtime_instance_id,
		runtime_adapter_id: binding.runtime_adapter_id,
		native_session_id: binding.native_session_id,
		binding_state: binding.binding_state,
		protocol: binding.protocol,
		protocol_version: binding.protocol_version ?? null,
		adapter_version: binding.adapter_version ?? null,
		locator_json: binding.locator_json ?? null,
		metadata_json: JSON.stringify(parseObject(binding.metadata_json)),
		revision: Number.isSafeInteger(binding.revision) && Number(binding.revision) > 0 ? Number(binding.revision) : 1,
		created_at: binding.created_at,
		updated_at: binding.updated_at,
	};
	return {
		pibo_session_id: session.id,
		runtime_instance_id: "pi",
		runtime_adapter_id: "pi",
		native_session_id: session.pi_session_id,
		binding_state: session.pi_session_id ? "bound" : "unbound",
		protocol: "pi-sdk",
		protocol_version: null,
		adapter_version: null,
		locator_json: null,
		metadata_json: "{}",
		revision: 1,
		created_at: session.created_at,
		updated_at: session.updated_at,
	};
}

function sessionMatches(data: PiboDataStore, expected: TargetSessionRow): boolean {
	const row = data.db.prepare(`SELECT id,pi_session_id,room_id,root_session_id,parent_id,origin_id,channel,kind,profile,active_model_json,workspace,title,status,metadata_json,created_at,updated_at,last_activity_at FROM sessions WHERE id=?`).get(expected.id) as TargetSessionRow | undefined;
	return Boolean(row) && pluginJson(normalizeSession(row!)) === pluginJson(normalizeSession(expected));
}

function bindingMatches(data: PiboDataStore, expected: TargetBindingRow): boolean {
	const row = data.db.prepare(`SELECT pibo_session_id,runtime_instance_id,runtime_adapter_id,native_session_id,binding_state,protocol,protocol_version,adapter_version,locator_json,metadata_json,revision,created_at,updated_at FROM session_runtime_bindings WHERE pibo_session_id=?`).get(expected.pibo_session_id) as TargetBindingRow | undefined;
	if (!row) return false;
	const identity = (value: TargetBindingRow) => ({
		pibo_session_id: value.pibo_session_id,
		runtime_instance_id: value.runtime_instance_id,
		runtime_adapter_id: value.runtime_adapter_id,
		native_session_id: value.native_session_id,
		binding_state: value.binding_state,
		protocol: value.protocol,
		protocol_version: value.protocol_version,
		adapter_version: value.adapter_version,
		locator_json: parseJson(value.locator_json),
		created_at: value.created_at,
	});
	if (pluginJson(identity(row)) !== pluginJson(identity(expected)) || row.revision < expected.revision || row.updated_at < expected.updated_at) return false;
	const actualMetadata = parseObject(row.metadata_json);
	return Object.entries(parseObject(expected.metadata_json)).every(([key, value]) => pluginJson(actualMetadata[key] ?? null) === pluginJson(value));
}

function normalizeSession(row: TargetSessionRow) {
	return { ...row, metadata_json: parseObject(row.metadata_json), active_model_json: parseJson(row.active_model_json) };
}
function parseJson(value: string | null | undefined): unknown {
	if (!value) return null;
	try { return JSON.parse(value); } catch { return value; }
}

function applySession(data: PiboDataStore, session: TargetSessionRow, binding: TargetBindingRow): void {
	data.transaction(() => {
		const existingSession = data.db.prepare("SELECT id FROM sessions WHERE id=?").get(session.id);
		if (existingSession) {
			if (!sessionMatches(data, session)) throw new PluginConflictError(`Automatic migration cannot overwrite divergent target session ${session.id}`);
		} else {
			if (session.parent_id && !data.db.prepare("SELECT 1 FROM sessions WHERE id=?").get(session.parent_id)) {
				throw new PluginConflictError(`Automatic migration cannot attach ${session.id}: parent session ${session.parent_id} is unavailable`);
			}
			data.db.prepare(`INSERT INTO sessions (id,pi_session_id,room_id,root_session_id,parent_id,origin_id,channel,kind,profile,active_model_json,workspace,title,status,metadata_json,created_at,updated_at,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
				session.id, session.pi_session_id, session.room_id, session.root_session_id, session.parent_id, session.origin_id,
				session.channel, session.kind, session.profile, session.active_model_json, session.workspace, session.title,
				session.status, session.metadata_json, session.created_at, session.updated_at, session.last_activity_at,
			);
		}
		const existingBinding = data.db.prepare("SELECT pibo_session_id FROM session_runtime_bindings WHERE pibo_session_id=?").get(session.id);
		if (existingBinding && bindingMatches(data, binding)) return;
		if (existingBinding && existingSession) throw new PluginConflictError(`Automatic migration cannot overwrite divergent runtime binding for session ${session.id}`);
		if (existingBinding) data.db.prepare("DELETE FROM session_runtime_bindings WHERE pibo_session_id=?").run(session.id);
		data.db.prepare(`INSERT INTO session_runtime_bindings (pibo_session_id,runtime_instance_id,runtime_adapter_id,native_session_id,binding_state,protocol,protocol_version,adapter_version,locator_json,metadata_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
			binding.pibo_session_id, binding.runtime_instance_id, binding.runtime_adapter_id, binding.native_session_id,
			binding.binding_state, binding.protocol, binding.protocol_version, binding.adapter_version, binding.locator_json,
			binding.metadata_json, binding.revision, binding.created_at, binding.updated_at,
		);
	});
}

function orderParentsBeforeChildren(rows: readonly LegacySessionRow[]): LegacySessionRow[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const ordered: LegacySessionRow[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (row: LegacySessionRow) => {
		if (visited.has(row.id)) return;
		if (visiting.has(row.id)) return;
		visiting.add(row.id);
		const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
		if (parent) visit(parent);
		visiting.delete(row.id);
		visited.add(row.id);
		ordered.push(row);
	};
	for (const row of rows) visit(row);
	return ordered;
}
