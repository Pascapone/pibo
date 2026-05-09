import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import { importLegacyChatData } from "./legacy-importer.js";

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
	{ name: "sessions", file: "pibo-sessions.sqlite", tables: ["pibo_sessions"] },
	{ name: "chat", file: "web-chat.sqlite", tables: ["chat_events", "web_chat_events", "web_chat_sessions", "pibo_rooms", "chat_session_reads"] },
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
	if (args[0] === "compare") {
		const json = args.includes("--json");
		const root = optionValue(args, "--root") ?? process.env.PIBO_HOME;
		const sessionId = optionValue(args, "--session");
		if (!sessionId) throw new Error("pibo data compare requires --session <piboSessionId>");
		const comparison = compareSession(root, sessionId);
		if (json) console.log(JSON.stringify(comparison, null, 2));
		else printComparison(comparison);
		return;
	}
	if (args[0] === "import" && args[1] === "legacy-chat") {
		const json = args.includes("--json");
		const root = optionValue(args, "--root") ?? process.env.PIBO_HOME;
		const from = optionValue(args, "--from");
		const to = optionValue(args, "--to");
		const payloadRootDir = optionValue(args, "--payload-root");
		const report = importLegacyChatData({ root, from, to, payloadRootDir });
		if (json) console.log(JSON.stringify(report, null, 2));
		else printImportReport(report);
		return;
	}
	throw new Error(`Unknown pibo data command "${args[0]}". Run pibo data --help.`);
}

function collectInventory(root?: string): StoreInventory[] {
	return INVENTORY_STORES.map((store) => inventoryStore(store.name, store.file, store.tables, root));
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

type SessionComparison = {
	sessionId: string;
	stores: {
		legacy: { path: string; exists: boolean; events: number; byType: Record<string, number> };
		v2: { path: string; exists: boolean; events: number; messages: number; observations: number; byType: Record<string, number>; byRole: Record<string, number>; byObservationKind: Record<string, number> };
	};
	deltas: {
		events: number;
		messagesMinusLegacyChatMessages: number;
		observationsMinusLegacyTraceEvents: number;
	};
};

function compareSession(root: string | undefined, sessionId: string): SessionComparison {
	const legacyPath = dataPath(root, "web-chat.sqlite");
	const v2Path = dataPath(root, "pibo.sqlite");
	const legacy = compareLegacySession(legacyPath, sessionId);
	const v2 = compareV2Session(v2Path, sessionId);
	const legacyChatMessages = (legacy.byType.message_queued ?? 0) + (legacy.byType.assistant_message ?? 0);
	const legacyTraceEvents = Object.entries(legacy.byType)
		.filter(([type]) => type !== "assistant_delta" && type !== "thinking_delta" && type !== "tool_execution_updated")
		.reduce((sum, [, count]) => sum + count, 0);
	return {
		sessionId,
		stores: { legacy, v2 },
		deltas: {
			events: v2.events - legacy.events,
			messagesMinusLegacyChatMessages: v2.messages - legacyChatMessages,
			observationsMinusLegacyTraceEvents: v2.observations - legacyTraceEvents,
		},
	};
}

function compareLegacySession(path: string, sessionId: string): SessionComparison["stores"]["legacy"] {
	const result: SessionComparison["stores"]["legacy"] = { path, exists: existsSync(path), events: 0, byType: {} };
	if (!result.exists) return result;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		if (!hasTable(db, "chat_events")) return result;
		result.events = countWhere(db, "chat_events", "pibo_session_id", sessionId);
		result.byType = countBy(db, "chat_events", "event_type", "pibo_session_id", sessionId);
	} finally {
		db.close();
	}
	return result;
}

function compareV2Session(path: string, sessionId: string): SessionComparison["stores"]["v2"] {
	const result: SessionComparison["stores"]["v2"] = { path, exists: existsSync(path), events: 0, messages: 0, observations: 0, byType: {}, byRole: {}, byObservationKind: {} };
	if (!result.exists) return result;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		if (hasTable(db, "event_log")) {
			result.events = countWhere(db, "event_log", "session_id", sessionId);
			result.byType = countBy(db, "event_log", "type", "session_id", sessionId);
		}
		if (hasTable(db, "chat_messages")) {
			result.messages = countWhere(db, "chat_messages", "session_id", sessionId);
			result.byRole = countBy(db, "chat_messages", "role", "session_id", sessionId);
		}
		if (hasTable(db, "observations")) {
			result.observations = countWhere(db, "observations", "session_id", sessionId);
			result.byObservationKind = countBy(db, "observations", "kind", "session_id", sessionId);
		}
	} finally {
		db.close();
	}
	return result;
}

function dataPath(root: string | undefined, file: string): string {
	return root ? resolve(root, file) : piboHomePath(file);
}

function hasTable(db: DatabaseSync, table: string): boolean {
	return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function countWhere(db: DatabaseSync, table: string, column: string, value: string): number {
	return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} = ?`).get(value) as Record<string, unknown>).count ?? 0);
}

function countBy(db: DatabaseSync, table: string, groupColumn: string, whereColumn: string, whereValue: string): Record<string, number> {
	const rows = db.prepare(`SELECT ${quoteIdent(groupColumn)} AS name, COUNT(*) AS count FROM ${quoteIdent(table)} WHERE ${quoteIdent(whereColumn)} = ? GROUP BY ${quoteIdent(groupColumn)} ORDER BY ${quoteIdent(groupColumn)} ASC`).all(whereValue) as Array<{ name: string | null; count: number }>;
	return Object.fromEntries(rows.map((row) => [row.name ?? "", Number(row.count)]));
}

function printComparison(comparison: SessionComparison): void {
	console.log(`session\t${comparison.sessionId}`);
	console.log(`store\texists\tevents\tmessages\tobservations\ttypes\tpath`);
	console.log(`legacy\t${comparison.stores.legacy.exists}\t${comparison.stores.legacy.events}\t-\t-\t${formatCounts(comparison.stores.legacy.byType)}\t${comparison.stores.legacy.path}`);
	console.log(`v2\t${comparison.stores.v2.exists}\t${comparison.stores.v2.events}\t${comparison.stores.v2.messages}\t${comparison.stores.v2.observations}\t${formatCounts(comparison.stores.v2.byType)}\t${comparison.stores.v2.path}`);
	console.log(`delta.events\t${comparison.deltas.events}`);
	console.log(`delta.messagesMinusLegacyChatMessages\t${comparison.deltas.messagesMinusLegacyChatMessages}`);
	console.log(`delta.observationsMinusLegacyTraceEvents\t${comparison.deltas.observationsMinusLegacyTraceEvents}`);
}

function printImportReport(report: ReturnType<typeof importLegacyChatData>): void {
	console.log(`legacyRoot\t${report.legacyRoot}`);
	console.log(`v2Path\t${report.v2Path}`);
	console.log(`input.sessions\t${report.inputs.sessions.exists}\t${report.inputs.sessions.path}`);
	console.log(`input.chat\t${report.inputs.chat.exists}\t${report.inputs.chat.path}`);
	console.log("kind\timported\tskipped");
	for (const key of Object.keys(report.imported) as Array<keyof typeof report.imported>) {
		console.log(`${key}\t${report.imported[key]}\t${report.skipped[key]}`);
	}
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
  inventory           Read-only row counts, sizes, WAL sizes, and integrity checks
  compare             Compare legacy Chat DB counts with V2 for one session
  import legacy-chat  Import legacy Chat Web data into pibo.sqlite idempotently

Options:
  --json              Print machine-readable JSON
  --root DIR          Inspect a specific Pibo home directory instead of ~/.pibo
  --from DIR          Legacy import source root
  --to FILE           Legacy import target pibo.sqlite path
  --payload-root DIR  V2 payload directory for import
  --session SESSION   Session id for compare

Next:
  pibo data inventory --json
  pibo data import legacy-chat --json
  pibo data compare --session <piboSessionId> --json
`);
}
