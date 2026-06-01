import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import { PiboDataStore } from "./pibo-store.js";

type StoreInventory = {
	name: string;
	path: string;
	exists: boolean;
	bytes: number;
	walBytes: number;
	integrity?: string;
	tables: Record<string, number>;
	freelistPages?: number;
	pageCount?: number;
	pageSize?: number;
};

const INVENTORY_STORES = [
	{ name: "v2", file: "pibo.sqlite", tables: ["sessions", "rooms", "chat_messages", "event_log", "observations", "payloads", "session_navigation"] },
	{ name: "v2-shadow", file: "pibo-chat-v2.sqlite", tables: ["sessions", "rooms", "chat_messages", "event_log", "observations", "payloads", "session_navigation"] },
	{ name: "legacy-sessions", file: "pibo-sessions.sqlite", tables: ["pibo_sessions"] },
	{ name: "legacy-chat", file: "web-chat.sqlite", tables: ["chat_events", "web_chat_events", "web_chat_sessions", "pibo_rooms", "chat_session_reads"] },
	{ name: "reliability", file: "pibo-events.sqlite", tables: ["pibo_event_stream", "pibo_jobs", "pibo_runs"] },
	{ name: "auth", file: "auth.sqlite", tables: [] },
];

export async function runDataCli(argv: string[]): Promise<void> {
	const args = argv.slice(2);
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDataHelp();
		return;
	}
	if (args[0] === "inventory") {
		const json = args.includes("--json");
		const root = optionValue(args, "--root") ?? process.env.PIBO_HOME;
		const inventory = collectInventory(root);
		if (json) console.log(JSON.stringify({ stores: inventory }, null, 2));
		else printInventory(inventory);
		return;
	}
	if (args[0] === "final-cutover") {
		await runFinalCutoverCommand(args.slice(1));
		return;
	}
	if (args[0] === "migrate" && args[1] === "sessions-to-v2") {
		const json = args.includes("--json");
		const root = optionValue(args, "--root") ?? process.env.PIBO_HOME;
		const from = optionValue(args, "--from") ?? dataPath(root, "pibo-sessions.sqlite");
		const to = optionValue(args, "--to") ?? dataPath(root, "pibo.sqlite");
		const report = migrateSessionsToV2({ from, to });
		if (json) console.log(JSON.stringify(report, null, 2));
		else printSessionMigrationReport(report);
		return;
	}
	throw new Error(`Unknown pibo data command "${args[0]}". Run pibo data --help.`);
}

function collectInventory(root?: string): StoreInventory[] {
	return INVENTORY_STORES.map((store) => inventoryStore(store.name, store.file, store.tables, root));
}

function dataPath(root: string | undefined, file: string): string {
	return root ? resolve(root, file) : piboHomePath(file);
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function inventoryStore(name: string, file: string, expectedTables: string[], root?: string): StoreInventory {
	const path = root ? resolve(root, file) : piboHomePath(file);
	const exists = existsSync(path);
	const result: StoreInventory = {
		name,
		path,
		exists,
		bytes: exists ? statSync(path).size : 0,
		walBytes: existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0,
		tables: {},
	};
	if (!exists) return result;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		result.integrity = String((db.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined)?.integrity_check ?? "unknown");
		result.freelistPages = Number((db.prepare("PRAGMA freelist_count").get() as Record<string, unknown> | undefined)?.freelist_count ?? 0);
		result.pageCount = Number((db.prepare("PRAGMA page_count").get() as Record<string, unknown> | undefined)?.page_count ?? 0);
		result.pageSize = Number((db.prepare("PRAGMA page_size").get() as Record<string, unknown> | undefined)?.page_size ?? 0);
		const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
		for (const table of expectedTables) {
			if (!tables.has(table)) continue;
			result.tables[table] = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get() as Record<string, unknown>).count ?? 0);
		}
	} finally {
		db.close();
	}
	return result;
}

type LegacySessionRow = {
	id: string;
	pi_session_id: string;
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

type SessionMigrationReport = {
	from: string;
	to: string;
	inputExists: boolean;
	read: number;
	inserted: number;
	updated: number;
	skipped: number;
};

function migrateSessionsToV2(input: { from: string; to: string }): SessionMigrationReport {
	const report: SessionMigrationReport = { from: input.from, to: input.to, inputExists: existsSync(input.from), read: 0, inserted: 0, updated: 0, skipped: 0 };
	if (!report.inputExists) return report;
	const source = new DatabaseSync(input.from, { readOnly: true });
	const target = new PiboDataStore(input.to);
	try {
		if (!hasTable(source, "pibo_sessions")) return report;
		const rows = source.prepare("SELECT * FROM pibo_sessions ORDER BY created_at ASC").all() as LegacySessionRow[];
		report.read = rows.length;
		for (const row of rows) {
			const existing = target.db.prepare("SELECT updated_at FROM sessions WHERE id = ?").get(row.id) as { updated_at: string } | undefined;
			const metadata = parseJsonObject(row.metadata_json);
			const rootSessionId = row.parent_id ? (typeof metadata.rootSessionId === "string" ? metadata.rootSessionId : row.parent_id) : row.id;
			if (!existing) {
				const columns = [
					"id", "pi_session_id", "room_id", "root_session_id", "parent_id", "origin_id",
					"channel", "kind", "profile", "active_model_json", "workspace", "title", "status",
					"metadata_json", "created_at", "updated_at", "last_activity_at",
				];
				target.db.prepare(`
					INSERT INTO sessions (${columns.join(", ")})
					VALUES (${columns.map(() => "?").join(", ")})
				`).run(
					row.id,
					row.pi_session_id,
					typeof metadata.chatRoomId === "string" ? metadata.chatRoomId : null,
					rootSessionId,
					row.parent_id,
					row.origin_id,
					row.channel,
					row.kind,
					row.profile,
					row.active_model_json,
					row.workspace,
					row.title ?? "Untitled Session",
					"idle",
					JSON.stringify(metadata),
					row.created_at,
					row.updated_at,
					row.updated_at,
				);
				report.inserted++;
			} else if (row.updated_at > existing.updated_at) {
				target.db.prepare(`
					UPDATE sessions SET
						pi_session_id = ?, root_session_id = ?, parent_id = ?, origin_id = ?,
						channel = ?, kind = ?, profile = ?, active_model_json = ?, workspace = ?, title = ?,
						metadata_json = ?, updated_at = ?, last_activity_at = MAX(last_activity_at, ?)
					WHERE id = ?
				`).run(
					row.pi_session_id,
					rootSessionId,
					row.parent_id,
					row.origin_id,
					row.channel,
					row.kind,
					row.profile,
					row.active_model_json,
					row.workspace,
					row.title ?? "Untitled Session",
					JSON.stringify(metadata),
					row.updated_at,
					row.updated_at,
					row.id,
				);
				report.updated++;
			} else {
				report.skipped++;
			}
		}
	} finally {
		source.close();
		target.close();
	}
	return report;
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

function printSessionMigrationReport(report: SessionMigrationReport): void {
	console.log(`from\t${report.from}`);
	console.log(`to\t${report.to}`);
	console.log(`inputExists\t${report.inputExists}`);
	console.log(`read\t${report.read}`);
	console.log(`inserted\t${report.inserted}`);
	console.log(`updated\t${report.updated}`);
	console.log(`skipped\t${report.skipped}`);
}

async function runFinalCutoverCommand(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printFinalCutoverHelp();
		return;
	}
	const command = args[0];
	if (command !== "inspect" && command !== "dry-run" && command !== "apply") {
		throw new Error(`Unknown pibo data final-cutover command "${command}". Run pibo data final-cutover --help.`);
	}
	const { formatFinalAppSpaceCutoverReport, inspectFinalAppSpaceCutoverMigration } = await import("./final-app-space-cutover-migration.js");
	const json = args.includes("--json");
	const report = inspectFinalAppSpaceCutoverMigration({ mode: command, root: optionValue(args, "--root"), backupPath: optionValue(args, "--backup") });
	if (json) console.log(JSON.stringify(report, null, 2));
	else console.log(formatFinalAppSpaceCutoverReport(report));
}

function formatCounts(counts: Record<string, number>): string {
	return Object.entries(counts).map(([name, count]) => `${name}:${count}`).join(",") || "-";
}

function quoteIdent(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function optionValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	return args[index + 1];
}

function printInventory(stores: StoreInventory[]): void {
	console.log("store\texists\tbytes\twalBytes\tintegrity\ttables\tpath");
	for (const store of stores) {
		const tables = Object.entries(store.tables).map(([name, count]) => `${name}:${count}`).join(",") || "-";
		console.log(`${store.name}\t${store.exists}\t${store.bytes}\t${store.walBytes}\t${store.integrity ?? "-"}\t${tables}\t${store.path}`);
	}
}

function printDataHelp(): void {
	console.log(`pibo data - inspect and maintain Pibo data stores

Commands:
  inventory           Read-only row counts, sizes, WAL sizes, and integrity checks; legacy-* rows are archived stores
  final-cutover       Inspect or dry-run the final app-space SQLite cutover against an isolated root
  migrate sessions-to-v2  Import an explicit legacy pibo-sessions.sqlite into pibo.sqlite idempotently

Options:
  --json              Print machine-readable JSON
  --root DIR          Inspect a specific Pibo home directory instead of ~/.pibo
  --to FILE           Target pibo.sqlite path for migration or repair

Next:
  pibo data inventory --json
  pibo data final-cutover --help
  pibo data migrate sessions-to-v2 --from /path/to/pibo-sessions.sqlite --json
`);
}

function printFinalCutoverHelp(): void {
	console.log(`pibo data final-cutover - inspect isolated SQLite homes before final app-space cutover

Commands:
  inspect   Read-only affected-file, table, column, index, row-count, legacy-value, and conflict report
  dry-run   Read-only planned table rebuild, merge, rename, and blocker report; writes nothing
  apply     Backup-gated transactional apply for Docker fixture or sandbox roots only

Options:
  --json        Print machine-readable JSON
  --root DIR    Required unless PIBO_MIGRATION_SANDBOX_HOME points at a Docker sandbox or temporary fixture root
  --backup DIR  Required by apply; verified backup directory containing copies of existing affected DB files

Safety:
  Refuses /root/.pibo and paths under it. This command is for Docker sandboxes and fixture roots only.

Next:
  pibo data final-cutover inspect --root /workspace/.pibo/ralph-migration-sandbox --json
  pibo data final-cutover dry-run --root /workspace/.pibo/ralph-migration-sandbox --json
  pibo data final-cutover apply --root /tmp/pibo-fixture-home --backup /tmp/pibo-fixture-backup --json
`);
}

