import type { DatabaseSync } from "node:sqlite";

/** One-time v4 upgrade: session identity already owns every exposure and authorization. */
export function migratePreviewSessionOwnership(db: DatabaseSync): void {
	const columns = db.prepare("PRAGMA table_info(preview_exposures)").all() as Array<{ name: string }>;
	if (columns.some((column) => column.name === "project_id")) {
		db.exec("ALTER TABLE preview_exposures DROP COLUMN project_id");
	}
}
