import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import { getSharedAppLegacyOwnerScope } from "../shared-app.js";

export type SharedAppMigrationMode = "inspect" | "dry-run" | "apply";

type LegacyColumnKind = "owner_scope" | "principal_id" | "technical_session_owner";

type LegacyColumnPlan = {
	column: string;
	kind: LegacyColumnKind;
	targetValue?: string;
	plannedMutation: boolean;
};

type SharedAppMigrationTableSpec = {
	name: string;
	columns: LegacyColumnPlan[];
};

type SharedAppMigrationStoreSpec = {
	name: string;
	file: string;
	description: string;
	tables: SharedAppMigrationTableSpec[];
};

export type SharedAppOwnerValueCount = {
	value: string;
	count: number;
};

export type SharedAppMigrationConflict = {
	indexName: string;
	columns: string[];
	legacyColumns: string[];
	groups: number;
	rows: number;
};

export type SharedAppMigrationTableReport = {
	table: string;
	exists: boolean;
	rowCount: number;
	columns: Array<{
		column: string;
		kind: LegacyColumnKind;
		targetValue?: string;
		plannedMutation: boolean;
		counts: SharedAppOwnerValueCount[];
		plannedUpdates: number;
	}>;
	conflicts: SharedAppMigrationConflict[];
};

export type SharedAppMigrationStoreReport = {
	store: string;
	file: string;
	path: string;
	description: string;
	exists: boolean;
	bytes: number;
	tables: SharedAppMigrationTableReport[];
	totalRows: number;
	totalPlannedUpdates: number;
	totalConflicts: number;
};

export type SharedAppMigrationActionReport = {
	store: string;
	file: string;
	table: string;
	action: string;
	planned: number;
	applied: number;
	details?: Record<string, unknown>;
};

type AuxiliaryStoreMigrationSpec = {
	store: string;
	file: string;
	ownerTables: string[];
	targetTables?: string[];
	customAgentProfileNames?: boolean;
};

export type SharedAppMigrationPostCheck = {
	store: string;
	file: string;
	checks: Record<string, unknown>;
};

export type SharedAppMigrationReport = {
	kind: "shared-app-migration";
	mode: SharedAppMigrationMode;
	root: string;
	generatedAt: string;
	dryRun: boolean;
	willWrite: boolean;
	stores: SharedAppMigrationStoreReport[];
	actions: SharedAppMigrationActionReport[];
	postChecks: SharedAppMigrationPostCheck[];
	summary: {
		stores: number;
		existingStores: number;
		tables: number;
		existingTables: number;
		rows: number;
		plannedUpdates: number;
		appliedUpdates: number;
		conflicts: number;
	};
	backup: {
		requiredForApply: boolean;
		providedPath?: string;
		providedPathExists?: boolean;
		rollbackInstructions: string;
	};
	warnings: string[];
};

type SharedAppMigrationOptions = {
	root?: string;
	mode: SharedAppMigrationMode;
	backupPath?: string;
};

const SHARED_APP_VALUE = getSharedAppLegacyOwnerScope();

const AUXILIARY_MIGRATION_STORES: readonly AuxiliaryStoreMigrationSpec[] = [
	{ store: "pibo", file: "pibo.sqlite", ownerTables: ["workflow_lifecycle_events", "workflow_prompt_assets", "workflow_prompt_asset_revisions", "workflow_ui_drafts"] },
	{ store: "chat-agents", file: "chat-agents.sqlite", ownerTables: ["chat_agents"], customAgentProfileNames: true },
	{ store: "ralph", file: "pibo-ralph.sqlite", ownerTables: ["pibo_ralph_jobs", "pibo_ralph_runs", "pibo_ralph_run_facts"], targetTables: ["pibo_ralph_jobs"] },
	{ store: "cron", file: "pibo-cron.sqlite", ownerTables: ["pibo_cron_jobs", "pibo_cron_runs"], targetTables: ["pibo_cron_jobs"] },
	{ store: "web-annotations", file: "web-annotations.sqlite", ownerTables: ["web_annotation_bindings", "web_annotations"] },
	{ store: "web-projects", file: "web-projects.sqlite", ownerTables: ["projects"] },
];

const MIGRATION_STORES: readonly SharedAppMigrationStoreSpec[] = [
	{
		name: "pibo",
		file: "pibo.sqlite",
		description: "primary Pibo sessions, rooms, navigation, read-state, and workflow persistence",
		tables: [
			ownerTable("sessions"),
			ownerTable("rooms"),
			ownerTable("session_navigation"),
			principalTable("room_members"),
			principalTable("principal_session_stats"),
			principalTable("principal_room_stats"),
			ownerTable("workflow_lifecycle_events"),
			ownerTable("workflow_prompt_assets"),
			ownerTable("workflow_prompt_asset_revisions"),
			ownerTable("workflow_ui_drafts"),
		],
	},
	{
		name: "chat-agents",
		file: "chat-agents.sqlite",
		description: "custom Agent Designer profiles",
		tables: [ownerTable("chat_agents")],
	},
	{
		name: "ralph",
		file: "pibo-ralph.sqlite",
		description: "Ralph jobs, runs, and run facts",
		tables: [ownerTable("pibo_ralph_jobs"), ownerTable("pibo_ralph_runs"), ownerTable("pibo_ralph_run_facts")],
	},
	{
		name: "cron",
		file: "pibo-cron.sqlite",
		description: "Cron schedules and run history",
		tables: [ownerTable("pibo_cron_jobs"), ownerTable("pibo_cron_runs")],
	},
	{
		name: "web-annotations",
		file: "web-annotations.sqlite",
		description: "Web Annotation bindings and annotations",
		tables: [ownerTable("web_annotation_bindings"), ownerTable("web_annotations")],
	},
	{
		name: "web-projects",
		file: "web-projects.sqlite",
		description: "legacy standalone Project store if present",
		tables: [ownerTable("projects")],
	},
	{
		name: "reliability",
		file: "pibo-events.sqlite",
		description: "reliable event core and yielded-run lifecycle state",
		tables: [
			{
				name: "pibo_runs",
				columns: [{ column: "owner_pibo_session_id", kind: "technical_session_owner", plannedMutation: false }],
			},
		],
	},
];

function ownerTable(name: string): SharedAppMigrationTableSpec {
	return { name, columns: [{ column: "owner_scope", kind: "owner_scope", targetValue: SHARED_APP_VALUE, plannedMutation: true }] };
}

function principalTable(name: string): SharedAppMigrationTableSpec {
	return { name, columns: [{ column: "principal_id", kind: "principal_id", targetValue: SHARED_APP_VALUE, plannedMutation: true }] };
}

function validateApplyBackup(root: string, backupPath: string | undefined): void {
	if (!backupPath) throw new Error("pibo data shared-app apply requires --backup <backup-path> before any mutation can run");
	if (!existsSync(backupPath)) throw new Error(`pibo data shared-app apply backup path does not exist: ${backupPath}`);
	const backupStat = statSync(backupPath);
	if (!backupStat.isDirectory()) throw new Error(`pibo data shared-app apply backup path must be a directory: ${backupPath}`);
	const checkedFiles = new Set<string>();
	for (const store of MIGRATION_STORES) {
		if (checkedFiles.has(store.file)) continue;
		checkedFiles.add(store.file);
		const sourcePath = resolve(root, store.file);
		if (!existsSync(sourcePath)) continue;
		const backupFilePath = resolve(backupPath, store.file);
		if (!existsSync(backupFilePath)) throw new Error(`pibo data shared-app apply backup is missing required SQLite copy: ${backupFilePath}`);
		const fileStat = statSync(backupFilePath);
		if (!fileStat.isFile()) throw new Error(`pibo data shared-app apply backup entry is not a file: ${backupFilePath}`);
		assertSqliteQuickCheck(backupFilePath);
	}
}

function assertSqliteQuickCheck(path: string): void {
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
		if (row?.quick_check !== "ok") throw new Error(`quick_check returned ${row?.quick_check ?? "no result"}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`pibo data shared-app apply backup SQLite quick_check failed for ${path}: ${message}`);
	} finally {
		db.close();
	}
}

function validateNoUnresolvedApplyConflicts(root: string): void {
	const unresolved = MIGRATION_STORES.flatMap((store) => inspectStore(root, store).tables.flatMap((table) =>
		table.conflicts
			.filter((conflict) => !isHandledApplyConflict(store.name, table.table, conflict))
			.map((conflict) => `${store.name}.${table.table}.${conflict.indexName}`)
	));
	if (unresolved.length > 0) {
		throw new Error(`pibo data shared-app apply found unresolved unique-index conflicts after owner/principal normalization: ${unresolved.join(", ")}. Run dry-run, resolve these conflicts, then retry.`);
	}
}

function isHandledApplyConflict(store: string, table: string, conflict: SharedAppMigrationConflict): boolean {
	if (store === "pibo" && ["room_members", "principal_session_stats", "principal_room_stats"].includes(table)) return true;
	if (store === "chat-agents" && table === "chat_agents" && conflict.columns.includes("profile_name")) return true;
	return false;
}

export function inspectSharedAppMigration(options: SharedAppMigrationOptions): SharedAppMigrationReport {
	const root = options.root ? resolve(options.root) : piboHomePath("").replace(/[\\/]$/, "");
	const warnings: string[] = [];
	if (options.mode === "apply") {
		validateApplyBackup(root, options.backupPath);
		validateNoUnresolvedApplyConflicts(root);
	}
	const apply = options.mode === "apply";
	const piboMigration = planOrApplyPiboSqliteMigration(root, apply);
	const auxiliaryMigration = planOrApplyAuxiliaryMigrations(root, apply);
	warnings.push(...piboMigration.warnings, ...auxiliaryMigration.warnings);
	const actions = [...piboMigration.actions, ...auxiliaryMigration.actions];
	const postChecks = [...piboMigration.postChecks, ...auxiliaryMigration.postChecks];
	const stores = MIGRATION_STORES.map((store) => inspectStore(root, store));
	const appliedUpdates = actions.reduce((sum, action) => sum + action.applied, 0);
	const summary = stores.reduce(
		(acc, store) => {
			acc.stores++;
			if (store.exists) acc.existingStores++;
			acc.tables += store.tables.length;
			acc.existingTables += store.tables.filter((table) => table.exists).length;
			acc.rows += store.totalRows;
			acc.plannedUpdates += store.totalPlannedUpdates;
			acc.conflicts += store.totalConflicts;
			return acc;
		},
		{ stores: 0, existingStores: 0, tables: 0, existingTables: 0, rows: 0, plannedUpdates: 0, appliedUpdates, conflicts: 0 },
	);
	return {
		kind: "shared-app-migration",
		mode: options.mode,
		root,
		generatedAt: new Date().toISOString(),
		dryRun: options.mode !== "apply",
		willWrite: options.mode === "apply" && appliedUpdates > 0,
		stores,
		actions,
		postChecks,
		summary,
		backup: {
			requiredForApply: true,
			providedPath: options.backupPath,
			providedPathExists: options.backupPath ? existsSync(options.backupPath) : undefined,
			rollbackInstructions: "Before mutation, create a fresh backup of the Pibo home or affected SQLite files. To roll back, stop Pibo, restore the affected SQLite files from that backup, then restart through the Pibo gateway CLI.",
		},
		warnings,
	};
}

type PiboSqliteMigrationResult = {
	actions: SharedAppMigrationActionReport[];
	postChecks: SharedAppMigrationPostCheck[];
	warnings: string[];
};

type AuxiliaryMigrationResult = PiboSqliteMigrationResult;

type TargetJsonMigrationPlan = {
	planned: number;
	activeJobs: number;
	updates: Array<{ id: string; targetJson: string }>;
};

function planOrApplyAuxiliaryMigrations(root: string, apply: boolean): AuxiliaryMigrationResult {
	const actions: SharedAppMigrationActionReport[] = [];
	const postChecks: SharedAppMigrationPostCheck[] = [];
	const warnings: string[] = [];
	for (const spec of AUXILIARY_MIGRATION_STORES) {
		const path = resolve(root, spec.file);
		if (!existsSync(path)) continue;
		const db = new DatabaseSync(path, apply ? {} : { readOnly: true });
		try {
			if (!apply) db.exec("PRAGMA query_only = ON");
			const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
			const columns = new Map<string, TableColumns>();
			const tableColumns = (table: string): TableColumns => {
				let value = columns.get(table);
				if (!value) {
					value = tables.has(table) ? new Set((db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>).map((row) => row.name)) : new Set();
					columns.set(table, value);
				}
				return value;
			};
			const collectActions = () => {
				if (spec.customAgentProfileNames) actions.push(planCustomAgentProfileNameNormalization(db, spec.store, spec.file, tables, tableColumns, apply));
				for (const table of spec.ownerTables) actions.push(planGenericOwnerScopeNormalization(db, spec.store, spec.file, table, tables, tableColumns, apply));
				for (const table of spec.targetTables ?? []) actions.push(planPersonalTargetNormalization(db, spec.store, spec.file, table, tables, tableColumns, apply));
			};
			if (apply) {
				db.exec("BEGIN IMMEDIATE");
				try {
					collectActions();
					db.exec("COMMIT");
				} catch (error) {
					db.exec("ROLLBACK");
					throw error;
				}
			} else {
				collectActions();
			}
			postChecks.push(buildAuxiliaryPostCheck(db, spec, tables, tableColumns));
			if ((spec.store === "ralph" || spec.store === "cron") && tables.has(spec.store === "ralph" ? "pibo_ralph_jobs" : "pibo_cron_jobs")) {
				warnings.push(`${spec.store} migration is metadata-only: owner_scope and personal target principal values are normalized without changing job/run ids, status, schedules, prompts, resources, or working directories.`);
			}
		} finally {
			db.close();
		}
	}
	return { actions, postChecks, warnings: uniqueStrings(warnings) };
}

function planGenericOwnerScopeNormalization(db: DatabaseSync, store: string, file: string, table: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	if (!tables.has(table) || !tableColumns(table).has("owner_scope")) return storeAction(store, file, table, "normalize-owner-scope", 0, 0);
	const planned = countRows(db, `SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE owner_scope IS NULL OR owner_scope != ?`, [SHARED_APP_VALUE]);
	let applied = 0;
	if (apply && planned > 0) {
		applied = Number(db.prepare(`UPDATE ${quoteIdent(table)} SET owner_scope = ? WHERE owner_scope IS NULL OR owner_scope != ?`).run(SHARED_APP_VALUE, SHARED_APP_VALUE).changes ?? 0);
	}
	return storeAction(store, file, table, "normalize-owner-scope", planned, applied);
}

function planPersonalTargetNormalization(db: DatabaseSync, store: string, file: string, table: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	const columns = tableColumns(table);
	if (!tables.has(table) || !columns.has("id") || !columns.has("target_json")) return storeAction(store, file, table, "normalize-personal-target", 0, 0);
	const plan = buildTargetJsonMigrationPlan(db, table, columns.has("state_json"));
	let applied = 0;
	if (apply && plan.updates.length > 0) {
		const update = db.prepare(`UPDATE ${quoteIdent(table)} SET target_json = ? WHERE id = ?`);
		for (const item of plan.updates) applied += Number(update.run(item.targetJson, item.id).changes ?? 0);
	}
	return storeAction(store, file, table, "normalize-personal-target", plan.planned, applied, { activeJobs: plan.activeJobs });
}

function buildTargetJsonMigrationPlan(db: DatabaseSync, table: string, hasStateJson: boolean): TargetJsonMigrationPlan {
	const rows = db.prepare(`SELECT id, target_json, ${hasStateJson ? "state_json" : "NULL AS state_json"} FROM ${quoteIdent(table)} ORDER BY id ASC`).all() as Array<{ id: string; target_json: string | null; state_json: string | null }>;
	const updates: TargetJsonMigrationPlan["updates"] = [];
	let activeJobs = 0;
	for (const row of rows) {
		const state = parseJsonObject(row.state_json);
		if (typeof state.runningAt === "string" && state.runningAt.length > 0) activeJobs++;
		const target = parseJsonObject(row.target_json);
		if (target.kind !== "personal" || target.principalId === SHARED_APP_VALUE) continue;
		updates.push({ id: row.id, targetJson: JSON.stringify({ ...target, principalId: SHARED_APP_VALUE }) });
	}
	return { planned: updates.length, activeJobs, updates };
}

function planCustomAgentProfileNameNormalization(db: DatabaseSync, store: string, file: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	const table = "chat_agents";
	const columns = tableColumns(table);
	if (!tables.has(table) || !columns.has("id") || !columns.has("profile_name")) return storeAction(store, file, table, "rename-duplicate-profile-names", 0, 0);
	const rows = db.prepare(`SELECT id, profile_name, ${columns.has("owner_scope") ? "owner_scope" : "NULL AS owner_scope"}, ${columns.has("display_name") ? "display_name" : "NULL AS display_name"}, ${columns.has("created_at") ? "created_at" : "NULL AS created_at"}, ${columns.has("updated_at") ? "updated_at" : "NULL AS updated_at"} FROM ${quoteIdent(table)} ORDER BY profile_name ASC, id ASC`).all() as Array<Record<string, unknown>>;
	const byName = groupRows(rows, "profile_name");
	const used = new Set(rows.map((row) => String(row.profile_name ?? "")));
	const renames: Array<{ id: string; from: string; to: string }> = [];
	for (const group of byName.values()) {
		if (group.length <= 1) continue;
		const canonical = chooseCanonicalCustomAgent(group);
		for (const row of group) {
			if (String(row.id) === String(canonical.id)) continue;
			used.delete(String(row.profile_name ?? ""));
			const from = String(row.profile_name ?? "agent");
			const to = uniqueProfileName(`${from} legacy ${shortLegacyHash(`${row.owner_scope ?? ""}:${row.id ?? ""}`)}`, used);
			used.add(to);
			renames.push({ id: String(row.id), from, to });
		}
	}
	let applied = 0;
	if (apply && renames.length > 0) {
		const sql = columns.has("display_name")
			? `UPDATE ${quoteIdent(table)} SET profile_name = ?, display_name = ? WHERE id = ?`
			: `UPDATE ${quoteIdent(table)} SET profile_name = ? WHERE id = ?`;
		const update = db.prepare(sql);
		for (const rename of renames) {
			applied += columns.has("display_name")
				? Number(update.run(rename.to, rename.to, rename.id).changes ?? 0)
				: Number(update.run(rename.to, rename.id).changes ?? 0);
		}
	}
	return storeAction(store, file, table, "rename-duplicate-profile-names", renames.length, applied, { renames });
}

function chooseCanonicalCustomAgent(group: Array<Record<string, unknown>>): Record<string, unknown> {
	return [...group].sort((a, b) => {
		const ownerCompare = (a.owner_scope === SHARED_APP_VALUE ? 0 : 1) - (b.owner_scope === SHARED_APP_VALUE ? 0 : 1);
		if (ownerCompare !== 0) return ownerCompare;
		const updatedCompare = String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
		if (updatedCompare !== 0) return updatedCompare;
		const createdCompare = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
		if (createdCompare !== 0) return createdCompare;
		return String(a.id ?? "").localeCompare(String(b.id ?? ""));
	})[0];
}

function buildAuxiliaryPostCheck(db: DatabaseSync, spec: AuxiliaryStoreMigrationSpec, tables: Set<string>, tableColumns: (table: string) => TableColumns): SharedAppMigrationPostCheck {
	const checks: Record<string, unknown> = {};
	for (const table of spec.ownerTables) {
		checks[`${table}.nonSharedOwnerRows`] = tables.has(table) && tableColumns(table).has("owner_scope") ? countRows(db, `SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE owner_scope IS NULL OR owner_scope != ?`, [SHARED_APP_VALUE]) : 0;
	}
	for (const table of spec.targetTables ?? []) {
		checks[`${table}.nonSharedPersonalTargetRows`] = tables.has(table) && tableColumns(table).has("target_json") ? buildTargetJsonMigrationPlan(db, table, tableColumns(table).has("state_json")).planned : 0;
	}
	if (spec.customAgentProfileNames && tables.has("chat_agents") && tableColumns("chat_agents").has("profile_name")) {
		const rows = db.prepare("SELECT profile_name FROM chat_agents").all() as Array<{ profile_name: string }>;
		checks["chat_agents.duplicateProfileNameGroups"] = [...groupRows(rows as Array<Record<string, unknown>>, "profile_name").values()].filter((group) => group.length > 1).length;
	}
	return { store: spec.store, file: spec.file, checks };
}

function uniqueProfileName(candidate: string, used: Set<string>): string {
	let next = candidate;
	let suffix = 2;
	while (used.has(next)) next = `${candidate} ${suffix++}`;
	return next;
}

function shortLegacyHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

type DefaultRoomRow = {
	id: string;
	owner_scope: string | null;
	name: string | null;
	metadata_json: string | null;
	updated_at: string | null;
};

type TableColumns = Set<string>;

function planOrApplyPiboSqliteMigration(root: string, apply: boolean): PiboSqliteMigrationResult {
	const file = "pibo.sqlite";
	const path = resolve(root, file);
	if (!existsSync(path)) return { actions: [], postChecks: [], warnings: [] };
	const db = new DatabaseSync(path, apply ? {} : { readOnly: true });
	const actions: SharedAppMigrationActionReport[] = [];
	const warnings: string[] = [];
	try {
		if (!apply) db.exec("PRAGMA query_only = ON");
		const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
		const columns = new Map<string, TableColumns>();
		const tableColumns = (table: string): TableColumns => {
			let value = columns.get(table);
			if (!value) {
				value = tables.has(table) ? new Set((db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>).map((row) => row.name)) : new Set();
				columns.set(table, value);
			}
			return value;
		};
		const collectActions = () => {
			actions.push(...planDefaultRoomNormalization(db, file, tables, tableColumns, apply));
			for (const table of ["sessions", "rooms", "session_navigation"]) actions.push(planOwnerScopeNormalization(db, file, table, tables, tableColumns, apply));
			actions.push(planRoomMemberNormalization(db, file, tables, tableColumns, apply));
			actions.push(planPrincipalStatsNormalization(db, file, "principal_session_stats", "session_id", tables, tableColumns, apply));
			actions.push(planPrincipalStatsNormalization(db, file, "principal_room_stats", "room_id", tables, tableColumns, apply));
		};
		if (apply) {
			db.exec("BEGIN IMMEDIATE");
			try {
				collectActions();
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		} else {
			collectActions();
		}
		return { actions, postChecks: [buildPiboSqlitePostCheck(db, file, tables, tableColumns)], warnings };
	} finally {
		db.close();
	}
}

function planOwnerScopeNormalization(db: DatabaseSync, file: string, table: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	if (!tables.has(table) || !tableColumns(table).has("owner_scope")) return action(file, table, "normalize-owner-scope", 0, 0);
	const planned = countRows(db, `SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE owner_scope IS NULL OR owner_scope != ?`, [SHARED_APP_VALUE]);
	let applied = 0;
	if (apply && planned > 0) {
		applied = Number(db.prepare(`UPDATE ${quoteIdent(table)} SET owner_scope = ? WHERE owner_scope IS NULL OR owner_scope != ?`).run(SHARED_APP_VALUE, SHARED_APP_VALUE).changes ?? 0);
	}
	return action(file, table, "normalize-owner-scope", planned, applied);
}

function planDefaultRoomNormalization(db: DatabaseSync, file: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport[] {
	if (!tables.has("rooms") || !tableColumns("rooms").has("metadata_json")) return [];
	const roomColumns = tableColumns("rooms");
	const rooms = db.prepare(`SELECT id, owner_scope, name, metadata_json, ${roomColumns.has("updated_at") ? "updated_at" : "NULL AS updated_at"} FROM rooms ORDER BY id ASC`).all() as DefaultRoomRow[];
	const defaultRooms = rooms.filter((room) => parseJsonObject(room.metadata_json).default === true);
	if (defaultRooms.length <= 1) return [action(file, "rooms", "retire-duplicate-default-rooms", 0, 0, { defaultRooms: defaultRooms.length })];
	const canonical = [...defaultRooms].sort((a, b) => {
		const ownerCompare = (a.owner_scope === SHARED_APP_VALUE ? 0 : 1) - (b.owner_scope === SHARED_APP_VALUE ? 0 : 1);
		if (ownerCompare !== 0) return ownerCompare;
		const updatedCompare = String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
		if (updatedCompare !== 0) return updatedCompare;
		return a.id.localeCompare(b.id);
	})[0];
	const duplicates = defaultRooms.filter((room) => room.id !== canonical.id);
	let applied = 0;
	if (apply) {
		const update = roomColumns.has("updated_at")
			? db.prepare("UPDATE rooms SET metadata_json = ?, updated_at = ? WHERE id = ?")
			: db.prepare("UPDATE rooms SET metadata_json = ? WHERE id = ?");
		const now = new Date().toISOString();
		for (const duplicate of duplicates) {
			const metadata = parseJsonObject(duplicate.metadata_json);
			delete metadata.default;
			const nextMetadata = JSON.stringify({ ...metadata, legacyDefaultRoomRetiredAt: now, legacyDefaultRoomCanonicalId: canonical.id });
			const result = roomColumns.has("updated_at") ? update.run(nextMetadata, now, duplicate.id) : update.run(nextMetadata, duplicate.id);
			applied += Number(result.changes ?? 0);
		}
	}
	return [action(file, "rooms", "retire-duplicate-default-rooms", duplicates.length, applied, { canonicalRoomId: canonical.id, duplicateRoomIds: duplicates.map((room) => room.id) })];
}

function planRoomMemberNormalization(db: DatabaseSync, file: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	const table = "room_members";
	if (!tables.has(table)) return action(file, table, "merge-principal-rows", 0, 0);
	const columns = tableColumns(table);
	if (!columns.has("room_id") || !columns.has("principal_id")) return action(file, table, "merge-principal-rows", 0, 0);
	const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)} ORDER BY room_id ASC, principal_id ASC`).all() as Array<Record<string, unknown>>;
	const groups = groupRows(rows, "room_id");
	const changedGroups = [...groups.values()].filter((group) => groupNeedsPrincipalNormalization(group));
	let applied = 0;
	if (apply) {
		const deleteRows = db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE room_id = ?`);
		const insertColumns = ["room_id", "principal_id", ...(columns.has("role") ? ["role"] : []), ...(columns.has("joined_at") ? ["joined_at"] : [])];
		const insert = db.prepare(`INSERT INTO ${quoteIdent(table)} (${insertColumns.map(quoteIdent).join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`);
		for (const group of changedGroups) {
			const merged = mergeRoomMemberRows(group);
			deleteRows.run(String(merged.room_id));
			const values = insertColumns.map((column) => sqlValue(merged[column]));
			applied += Number(insert.run(...values).changes ?? 0);
		}
	}
	return action(file, table, "merge-principal-rows", changedGroups.length, applied, { rows: changedGroups.reduce((sum, group) => sum + group.length, 0) });
}

function planPrincipalStatsNormalization(db: DatabaseSync, file: string, table: string, keyColumn: string, tables: Set<string>, tableColumns: (table: string) => TableColumns, apply: boolean): SharedAppMigrationActionReport {
	if (!tables.has(table)) return action(file, table, "merge-principal-stats", 0, 0);
	const columns = tableColumns(table);
	if (!columns.has(keyColumn) || !columns.has("principal_id")) return action(file, table, "merge-principal-stats", 0, 0);
	const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)} ORDER BY ${quoteIdent(keyColumn)} ASC, principal_id ASC`).all() as Array<Record<string, unknown>>;
	const groups = groupRows(rows, keyColumn);
	const changedGroups = [...groups.values()].filter((group) => groupNeedsPrincipalNormalization(group));
	let applied = 0;
	if (apply) {
		const deleteRows = db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(keyColumn)} = ?`);
		const insertColumns = [
			keyColumn,
			"principal_id",
			...(columns.has("unread_count") ? ["unread_count"] : []),
			...(columns.has("last_read_stream_id") ? ["last_read_stream_id"] : []),
			...(columns.has("last_read_message_sequence") ? ["last_read_message_sequence"] : []),
			...(columns.has("last_read_at") ? ["last_read_at"] : []),
			...(columns.has("updated_at") ? ["updated_at"] : []),
		];
		const insert = db.prepare(`INSERT INTO ${quoteIdent(table)} (${insertColumns.map(quoteIdent).join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`);
		for (const group of changedGroups) {
			const merged = mergePrincipalStatsRows(group, keyColumn);
			deleteRows.run(String(merged[keyColumn]));
			applied += Number(insert.run(...insertColumns.map((column) => sqlValue(merged[column]))).changes ?? 0);
		}
	}
	return action(file, table, "merge-principal-stats", changedGroups.length, applied, { rows: changedGroups.reduce((sum, group) => sum + group.length, 0) });
}

function groupNeedsPrincipalNormalization(group: Array<Record<string, unknown>>): boolean {
	return group.length > 1 || group.some((row) => String(row.principal_id ?? "") !== SHARED_APP_VALUE);
}

function mergeRoomMemberRows(group: Array<Record<string, unknown>>): Record<string, unknown> {
	const roleRank: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
	const bestRole = group.reduce((best, row) => roleRank[String(row.role ?? "")] > roleRank[best] ? String(row.role) : best, "viewer");
	const joinedAt = minString(group.map((row) => nullableString(row.joined_at))) ?? new Date(0).toISOString();
	return { room_id: group[0].room_id, principal_id: SHARED_APP_VALUE, role: bestRole, joined_at: joinedAt };
}

function mergePrincipalStatsRows(group: Array<Record<string, unknown>>, keyColumn: string): Record<string, unknown> {
	const latest = [...group].sort((a, b) => {
		const updated = String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
		if (updated !== 0) return updated;
		return String(a.principal_id ?? "").localeCompare(String(b.principal_id ?? ""));
	})[0];
	return {
		[keyColumn]: group[0][keyColumn],
		principal_id: SHARED_APP_VALUE,
		unread_count: numberValue(latest.unread_count),
		last_read_stream_id: maxNumber(group.map((row) => row.last_read_stream_id)),
		last_read_message_sequence: maxNumber(group.map((row) => row.last_read_message_sequence)),
		last_read_at: maxString(group.map((row) => nullableString(row.last_read_at))),
		updated_at: maxString(group.map((row) => nullableString(row.updated_at))) ?? new Date().toISOString(),
	};
}

function buildPiboSqlitePostCheck(db: DatabaseSync, file: string, tables: Set<string>, tableColumns: (table: string) => TableColumns): SharedAppMigrationPostCheck {
	const checks: Record<string, unknown> = {};
	for (const table of ["sessions", "rooms", "session_navigation"]) {
		checks[`${table}.nonSharedOwnerRows`] = tables.has(table) && tableColumns(table).has("owner_scope") ? countRows(db, `SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE owner_scope IS NULL OR owner_scope != ?`, [SHARED_APP_VALUE]) : 0;
	}
	for (const table of ["room_members", "principal_session_stats", "principal_room_stats"]) {
		checks[`${table}.nonSharedPrincipalRows`] = tables.has(table) && tableColumns(table).has("principal_id") ? countRows(db, `SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE principal_id IS NULL OR principal_id != ?`, [SHARED_APP_VALUE]) : 0;
	}
	if (tables.has("rooms") && tableColumns("rooms").has("metadata_json")) {
		const rows = db.prepare("SELECT metadata_json FROM rooms").all() as Array<{ metadata_json: string | null }>;
		checks["rooms.defaultRoomRows"] = rows.filter((row) => parseJsonObject(row.metadata_json).default === true).length;
	}
	return { store: "pibo", file, checks };
}

function action(file: string, table: string, actionName: string, planned: number, applied: number, details?: Record<string, unknown>): SharedAppMigrationActionReport {
	return storeAction("pibo", file, table, actionName, planned, applied, details);
}

function storeAction(store: string, file: string, table: string, actionName: string, planned: number, applied: number, details?: Record<string, unknown>): SharedAppMigrationActionReport {
	return { store, file, table, action: actionName, planned, applied, ...(details ? { details } : {}) };
}

function groupRows(rows: Array<Record<string, unknown>>, key: string): Map<string, Array<Record<string, unknown>>> {
	const groups = new Map<string, Array<Record<string, unknown>>>();
	for (const row of rows) {
		const value = String(row[key] ?? "<null>");
		groups.set(value, [...(groups.get(value) ?? []), row]);
	}
	return groups;
}

function countRows(db: DatabaseSync, sql: string, bindings: unknown[] = []): number {
	return Number((db.prepare(sql).get(...bindings.map(sqlValue)) as { count?: number | bigint } | undefined)?.count ?? 0);
}

function sqlValue(value: unknown): string | number | bigint | null | Uint8Array {
	if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value === null || value instanceof Uint8Array) return value;
	if (value === undefined) return null;
	return JSON.stringify(value);
}

function numberValue(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	return Number(value ?? 0);
}

function maxNumber(values: unknown[]): number {
	return Math.max(0, ...values.map(numberValue));
}

function nullableString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function minString(values: Array<string | undefined>): string | undefined {
	return values.filter((value): value is string => Boolean(value)).sort((a, b) => a.localeCompare(b))[0];
}

function maxString(values: Array<string | undefined>): string | undefined {
	return values.filter((value): value is string => Boolean(value)).sort((a, b) => b.localeCompare(a))[0];
}

function inspectStore(root: string, spec: SharedAppMigrationStoreSpec): SharedAppMigrationStoreReport {
	const path = resolve(root, spec.file);
	const exists = existsSync(path);
	const report: SharedAppMigrationStoreReport = {
		store: spec.name,
		file: spec.file,
		path,
		description: spec.description,
		exists,
		bytes: exists ? statSync(path).size : 0,
		tables: spec.tables.map((table) => ({ table: table.name, exists: false, rowCount: 0, columns: table.columns.map((column) => ({ ...column, counts: [], plannedUpdates: 0 })), conflicts: [] })),
		totalRows: 0,
		totalPlannedUpdates: 0,
		totalConflicts: 0,
	};
	if (!exists) return report;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		db.exec("PRAGMA query_only = ON");
		const existingTables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
		report.tables = spec.tables.map((table) => inspectTable(db, table, existingTables));
		report.totalRows = report.tables.reduce((sum, table) => sum + table.rowCount, 0);
		report.totalPlannedUpdates = report.tables.reduce((sum, table) => sum + table.columns.reduce((columnSum, column) => columnSum + column.plannedUpdates, 0), 0);
		report.totalConflicts = report.tables.reduce((sum, table) => sum + table.conflicts.reduce((conflictSum, conflict) => conflictSum + conflict.groups, 0), 0);
	} finally {
		db.close();
	}
	return report;
}

function inspectTable(db: DatabaseSync, spec: SharedAppMigrationTableSpec, existingTables: Set<string>): SharedAppMigrationTableReport {
	if (!existingTables.has(spec.name)) {
		return {
			table: spec.name,
			exists: false,
			rowCount: 0,
			columns: spec.columns.map((column) => ({ ...column, counts: [], plannedUpdates: 0 })),
			conflicts: [],
		};
	}
	const existingColumns = new Set((db.prepare(`PRAGMA table_info(${quoteIdent(spec.name)})`).all() as Array<{ name: string }>).map((row) => row.name));
	const rowCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(spec.name)}`).get() as { count?: number | bigint } | undefined)?.count ?? 0);
	const columns = spec.columns.map((column) => inspectColumn(db, spec.name, column, existingColumns));
	return {
		table: spec.name,
		exists: true,
		rowCount,
		columns,
		conflicts: inspectConflicts(db, spec.name, spec.columns, existingColumns),
	};
}

function inspectColumn(db: DatabaseSync, table: string, column: LegacyColumnPlan, existingColumns: Set<string>): SharedAppMigrationTableReport["columns"][number] {
	if (!existingColumns.has(column.column)) return { ...column, counts: [], plannedUpdates: 0 };
	const columnSql = quoteIdent(column.column);
	const rows = db.prepare(`
		SELECT COALESCE(CAST(${columnSql} AS TEXT), '<null>') AS value, COUNT(*) AS count
		FROM ${quoteIdent(table)}
		GROUP BY COALESCE(CAST(${columnSql} AS TEXT), '<null>')
		ORDER BY count DESC, value ASC
	`).all() as Array<{ value: string; count: number | bigint }>;
	const counts = rows.map((row) => ({ value: row.value, count: Number(row.count) }));
	const plannedUpdates = column.plannedMutation && column.targetValue
		? Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE ${columnSql} IS NULL OR ${columnSql} != ?`).get(column.targetValue) as { count?: number | bigint } | undefined)?.count ?? 0)
		: 0;
	return { ...column, counts, plannedUpdates };
}

function inspectConflicts(db: DatabaseSync, table: string, columns: LegacyColumnPlan[], existingColumns: Set<string>): SharedAppMigrationConflict[] {
	const normalizingColumns = columns.filter((column) => column.plannedMutation && column.targetValue && existingColumns.has(column.column));
	if (!normalizingColumns.length) return [];
	const uniqueIndexes = (db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all() as Array<{ name: string; unique: number }>).filter((index) => Number(index.unique) === 1);
	const conflicts: SharedAppMigrationConflict[] = [];
	for (const index of uniqueIndexes) {
		const indexedColumns = (db.prepare(`PRAGMA index_info(${quoteIdent(index.name)})`).all() as Array<{ name: string | null }>).map((row) => row.name).filter((name): name is string => Boolean(name));
		const legacyColumns = indexedColumns.filter((column) => normalizingColumns.some((legacyColumn) => legacyColumn.column === column));
		if (!legacyColumns.length) continue;
		const expressions = indexedColumns.map((column) => {
			const legacyColumn = normalizingColumns.find((candidate) => candidate.column === column);
			return legacyColumn?.targetValue ? `? AS ${quoteIdent(column)}` : quoteIdent(column);
		});
		const bindings = indexedColumns.flatMap((column) => {
			const legacyColumn = normalizingColumns.find((candidate) => candidate.column === column);
			return legacyColumn?.targetValue ? [legacyColumn.targetValue] : [];
		});
		const normalizedRowsSql = `SELECT ${expressions.join(", ")} FROM ${quoteIdent(table)}`;
		const groupBySql = indexedColumns.map(quoteIdent).join(", ");
		const conflictRows = db.prepare(`
			SELECT COUNT(*) AS rows
			FROM (
				SELECT ${groupBySql}, COUNT(*) AS duplicate_count
				FROM (${normalizedRowsSql}) normalized
				GROUP BY ${groupBySql}
				HAVING duplicate_count > 1
			)
		`).all(...bindings) as Array<{ rows: number | bigint }>;
		const groups = Number(conflictRows[0]?.rows ?? 0);
		if (groups <= 0) continue;
		const duplicateRows = db.prepare(`
			SELECT SUM(duplicate_count) AS rows
			FROM (
				SELECT ${groupBySql}, COUNT(*) AS duplicate_count
				FROM (${normalizedRowsSql}) normalized
				GROUP BY ${groupBySql}
				HAVING duplicate_count > 1
			)
		`).get(...bindings) as { rows?: number | bigint } | undefined;
		conflicts.push({
			indexName: index.name,
			columns: indexedColumns,
			legacyColumns,
			groups,
			rows: Number(duplicateRows?.rows ?? 0),
		});
	}
	return conflicts;
}

export function formatSharedAppMigrationText(report: SharedAppMigrationReport): string {
	const lines = [
		`shared-app migration ${report.mode}`,
		`root\t${report.root}`,
		`dryRun\t${report.dryRun}`,
		`willWrite\t${report.willWrite}`,
		`backupRequiredForApply\t${report.backup.requiredForApply}`,
	];
	if (report.backup.providedPath) lines.push(`backup\t${report.backup.providedPath}\texists=${report.backup.providedPathExists}`);
	lines.push(`summary\tstores=${report.summary.existingStores}/${report.summary.stores}\ttables=${report.summary.existingTables}/${report.summary.tables}\trows=${report.summary.rows}\tplannedUpdates=${report.summary.plannedUpdates}\tappliedUpdates=${report.summary.appliedUpdates}\tconflicts=${report.summary.conflicts}`);
	for (const warning of report.warnings) lines.push(`warning\t${warning}`);
	if (report.actions.length) {
		lines.push("action\tstore\ttable\taction\tplanned\tapplied\tdetails");
		for (const migrationAction of report.actions) lines.push(`action\t${migrationAction.store}\t${migrationAction.table}\t${migrationAction.action}\t${migrationAction.planned}\t${migrationAction.applied}\t${migrationAction.details ? JSON.stringify(migrationAction.details) : "-"}`);
	}
	if (report.postChecks.length) {
		lines.push("postCheck\tstore\tchecks");
		for (const postCheck of report.postChecks) lines.push(`postCheck\t${postCheck.store}\t${JSON.stringify(postCheck.checks)}`);
	}
	lines.push("store\ttable\tcolumn\trows\tplannedUpdates\tvalues\tconflicts\tpath");
	for (const store of report.stores) {
		for (const table of store.tables) {
			if (!table.exists) {
				lines.push(`${store.store}\t${table.table}\t-\t0\t0\tmissing\t0\t${store.path}`);
				continue;
			}
			for (const column of table.columns) {
				const values = column.counts.map((count) => `${count.value}:${count.count}`).join(",") || "-";
				const conflicts = table.conflicts.map((conflict) => `${conflict.indexName}:${conflict.groups}/${conflict.rows}`).join(",") || "0";
				lines.push(`${store.store}\t${table.table}\t${column.column}\t${table.rowCount}\t${column.plannedUpdates}\t${values}\t${conflicts}\t${store.path}`);
			}
		}
	}
	lines.push(`rollback\t${report.backup.rollbackInstructions}`);
	return lines.join("\n");
}

function parseJsonObject(json: string | null | undefined): Record<string, unknown> {
	if (!json) return {};
	try {
		const value = JSON.parse(json);
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function quoteIdent(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}
