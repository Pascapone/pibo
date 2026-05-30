import type { DatabaseSync } from "node:sqlite";

export function sqliteTableExists(db: DatabaseSync, tableName: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { name: string } | undefined;
	return Boolean(row);
}

export function sqliteTableColumns(db: DatabaseSync, tableName: string): Set<string> {
	if (!sqliteTableExists(db, tableName)) return new Set();
	return new Set((db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
