import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";

export type DebugSqlRow = Record<string, unknown>;

export type DebugTableColumn = {
	name: string;
	type: string;
	notNull: boolean;
	primaryKey: boolean;
};

export type DebugTableIndex = {
	name: string;
	unique: boolean;
	origin: string;
	partial: boolean;
};

export type DebugTableSchema = {
	name: string;
	columns: DebugTableColumn[];
	indexes: DebugTableIndex[];
};

export type DebugQueryResult = {
	store: string;
	path: string;
	rows: DebugSqlRow[];
	limited: boolean;
};

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 1000;
const MUTATING_KEYWORDS = new Set([
	"alter",
	"attach",
	"create",
	"delete",
	"detach",
	"drop",
	"insert",
	"replace",
	"update",
	"vacuum",
]);
const READ_ONLY_PRAGMAS = new Set(["table_info", "index_list", "index_info"]);

type SqliteValue = string | number | bigint | Uint8Array | null;

type TableInfoRow = {
	name: string;
	type: string;
	notnull: number;
	pk: number;
};

type IndexListRow = {
	name: string;
	unique: number;
	origin: string;
	partial: number;
};

export function normalizeLimit(value: string | number | undefined): number {
	const raw = value === undefined ? DEFAULT_QUERY_LIMIT : Number(value);
	if (!Number.isInteger(raw) || raw < 1) {
		throw new Error("Limit must be a positive integer");
	}
	return Math.min(raw, MAX_QUERY_LIMIT);
}

export function listTables(store: ResolvedPiboDebugStore): string[] {
	return withReadOnlyDatabase(store, (db) =>
		(
			db
				.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
				.all() as Array<{ name: string }>
		).map((row) => row.name),
	);
}

export function getStoreSchema(store: ResolvedPiboDebugStore): DebugTableSchema[] {
	return withReadOnlyDatabase(store, (db) => {
		const tables = listTablesFromDb(db);
		return tables.map((table) => ({
			name: table,
			columns: (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as TableInfoRow[]).map((column) => ({
				name: column.name,
				type: column.type,
				notNull: column.notnull === 1,
				primaryKey: column.pk > 0,
			})),
			indexes: (db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as IndexListRow[]).map((index) => ({
				name: index.name,
				unique: index.unique === 1,
				origin: index.origin,
				partial: index.partial === 1,
			})),
		}));
	});
}

export function runReadOnlyQuery(
	store: ResolvedPiboDebugStore,
	sql: string,
	options: { limit?: string | number } = {},
): DebugQueryResult {
	const limit = normalizeLimit(options.limit);
	const statement = validateReadOnlySql(sql);
	return withReadOnlyDatabase(store, (db) => {
		const hasLimit = hasToken(statement, "limit");
		const isPragma = firstToken(statement) === "pragma";
		const query = hasLimit || isPragma ? statement : `SELECT * FROM (${statement}) LIMIT ?`;
		const params: SqliteValue[] = hasLimit || isPragma ? [] : [limit + 1];
		const rows = db.prepare(query).all(...params) as DebugSqlRow[];
		const limited = rows.length > limit;
		return {
			store: store.name,
			path: store.path,
			rows: rows.slice(0, limit),
			limited,
		};
	});
}

export function formatRows(rows: DebugSqlRow[], options: { limited?: boolean } = {}): string {
	if (rows.length === 0) return "rows: 0";
	const columns = Object.keys(rows[0] ?? {});
	const lines = [columns.join("\t")];
	for (const row of rows) {
		lines.push(columns.map((column) => formatCell(row[column])).join("\t"));
	}
	lines.push(`rows: ${rows.length}${options.limited ? " (limited)" : ""}`);
	return lines.join("\n");
}

export function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function openReadOnlyDebugDatabase(store: ResolvedPiboDebugStore): DatabaseSync {
	if (!store.exists) {
		throw new Error(`Debug store "${store.name}" not found at ${store.defaultPath}`);
	}
	const db = new DatabaseSync(store.path, { readOnly: true });
	db.exec("PRAGMA busy_timeout = 5000");
	return db;
}

function withReadOnlyDatabase<T>(store: ResolvedPiboDebugStore, action: (db: DatabaseSync) => T): T {
	const db = openReadOnlyDebugDatabase(store);
	try {
		return action(db);
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function withStorePath(error: unknown, store: ResolvedPiboDebugStore): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith("Debug store ")) return error instanceof Error ? error : new Error(message);
	if (!/database is locked/i.test(message)) return error instanceof Error ? error : new Error(message);
	return new Error(`Debug store "${store.name}" at ${store.path} is locked: ${message}`);
}

function listTablesFromDb(db: DatabaseSync): string[] {
	return (
		db
			.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all() as Array<{ name: string }>
	).map((row) => row.name);
}

function validateReadOnlySql(sql: string): string {
	const statement = normalizeSingleStatement(sql);
	const token = firstToken(statement);
	if (token === "pragma") {
		const match = /^pragma\s+([a-z_][a-z0-9_]*)\s*\(/i.exec(statement);
		if (!match || !READ_ONLY_PRAGMAS.has(match[1].toLowerCase())) {
			throw new Error("Only read-only PRAGMA table_info(...), index_list(...), and index_info(...) are allowed");
		}
		return statement;
	}
	const tokens = readSqlTokens(statement);
	for (const item of tokens) {
		if (MUTATING_KEYWORDS.has(item)) {
			throw new Error(`Mutating SQL is not allowed: ${item}`);
		}
	}
	if (token === "select") return statement;
	if (token === "with" && tokens.includes("select")) return statement;
	throw new Error("Only SELECT, WITH ... SELECT, and read-only PRAGMA statements are allowed");
}

function normalizeSingleStatement(sql: string): string {
	let statement = sql.trim();
	if (!statement) throw new Error("SQL query is required");
	if (statement.endsWith(";")) statement = statement.slice(0, -1).trim();
	if (containsSemicolon(statement)) {
		throw new Error("Only one SQL statement is allowed");
	}
	return statement;
}

function firstToken(sql: string): string {
	return readSqlTokens(sql)[0] ?? "";
}

function hasToken(sql: string, token: string): boolean {
	return readSqlTokens(sql).includes(token);
}

function readSqlTokens(sql: string): string[] {
	const tokens: string[] = [];
	let quote: "'" | '"' | "`" | null = null;
	let current = "";
	for (let index = 0; index < sql.length; index += 1) {
		const char = sql[index];
		const next = sql[index + 1];
		if (quote) {
			if (char === quote) {
				if (next === quote) {
					index += 1;
				} else {
					quote = null;
				}
			}
			continue;
		}
		if (char === "-" && next === "-") {
			index += 2;
			while (index < sql.length && sql[index] !== "\n") index += 1;
			flushToken();
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
			index += 1;
			flushToken();
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			flushToken();
			quote = char;
			continue;
		}
		if (/[A-Za-z0-9_]/.test(char)) {
			current += char.toLowerCase();
			continue;
		}
		flushToken();
	}
	flushToken();
	return tokens;

	function flushToken(): void {
		if (!current) return;
		tokens.push(current);
		current = "";
	}
}

function containsSemicolon(sql: string): boolean {
	let quote: "'" | '"' | "`" | null = null;
	for (let index = 0; index < sql.length; index += 1) {
		const char = sql[index];
		const next = sql[index + 1];
		if (quote) {
			if (char === quote) {
				if (next === quote) index += 1;
				else quote = null;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			continue;
		}
		if (char === ";") return true;
	}
	return false;
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function formatCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value).replaceAll("\n", "\\n");
}
